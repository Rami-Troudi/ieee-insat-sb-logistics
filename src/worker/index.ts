import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { schema } from "./database";
import type { CurrentUser, Env } from "./env";
import { createAuth, signCookieValue, trustedAuthOrigin } from "./auth";
import { hashPassword } from "better-auth/crypto";
import { requireBoard, requireSuperadmin, requireUser, resolveIdentity } from "./identity";
import {
  approveReservation,
  availableQuantity,
  assertCanReduceCapacity,
  boardDashboard,
  calendarEvents,
  cancelReservation,
  createQrToken,
  createReservation,
  declineReservation,
  findAvailableAssets,
  forceDeleteReservation,
  getReservation,
  handoverReservation,
  listBoardAudit,
  listBoardReservations,
  listCatalogue,
  listReservations,
  one,
  randomId,
  refreshReturnNotificationsForUser,
  rescheduleReservation,
  runReservationMaintenance,
  scanAsset,
  write,
} from "./domain";
import type { SqlExecutor } from "./domain";
import { DomainError, isRateLimited, jsonError, requestIp, sameOrigin } from "./security";

type Variables = { actor: CurrentUser };
export const app = new Hono<{ Bindings: Env; Variables: Variables }>();
const millisIso = z
  .string()
  .refine(
    (value) => /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)),
    "Use an ISO timestamp with an explicit timezone."
  );

app.use("*", requestId());
app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
    strictTransportSecurity: "max-age=31536000; includeSubDomains; preload",
    referrerPolicy: "no-referrer",
    xFrameOptions: "DENY",
  })
);
app.use("*", async (c, next) => {
  c.header("Permissions-Policy", "camera=(self)");
  await next();
});
app.use("/api/*", sameOrigin);
app.use(
  "/api/*",
  bodyLimit({
    maxSize: 64 * 1024,
    onError: (c) => jsonError(c, 413, "BODY_TOO_LARGE", "Request body is too large."),
  })
);
app.use("/api/*", async (c, next) => {
  const limited = await isRateLimited(
    c.env,
    `api:${requestIp(c)}`,
    c.env.API_RATE_LIMIT_PER_MINUTE
  );
  if (limited) return jsonError(c, 429, "RATE_LIMITED", "Too many requests. Try again shortly.");
  c.header("Cache-Control", "no-store");
  c.header("X-Request-Id", c.get("requestId"));
  await next();
});

app.onError((error, c) => {
  const requestIdValue = c.get("requestId");
  if (error instanceof DomainError) return jsonError(c, error.status, error.code, error.message);
  // Request bodies, cookies, QR tokens, and provider messages stay out of logs.
  console.error("request_failed", {
    requestId: requestIdValue,
    type: error.name,
    message: error.message,
  });
  return jsonError(c, 500, "INTERNAL", "The request could not be completed.");
});

app.get("/api/health", async (c) => {
  await c.env.CLIENT.execute("SELECT 1");
  return c.json({ status: "ok" });
});

app.get("/api/cron/return-reminders", async (c) => {
  if (!c.env.CRON_SECRET) {
    return jsonError(c, 503, "CRON_NOT_CONFIGURED", "The reminder job is not configured.");
  }
  if (c.req.header("Authorization") !== "Bearer " + c.env.CRON_SECRET) {
    return jsonError(c, 401, "UNAUTHENTICATED", "Invalid cron authorization.");
  }
  return c.json(await runReservationMaintenance(c.env));
});

app.all("/api/auth/*", async (c) => {
  if (await isRateLimited(c.env, `auth:${requestIp(c)}`, c.env.AUTH_RATE_LIMIT_PER_MINUTE)) {
    return jsonError(c, 429, "RATE_LIMITED", "Too many sign-in attempts. Try again shortly.");
  }
  return createAuth(c.env, trustedAuthOrigin(c.env, c.req.url, c.req.header("Origin"))).handler(
    c.req.raw
  );
});

app.post("/api/v1/auth/borrower", async (c) => {
  if (await isRateLimited(c.env, "auth:" + requestIp(c), c.env.AUTH_RATE_LIMIT_PER_MINUTE)) {
    return jsonError(c, 429, "RATE_LIMITED", "Too many sign-in attempts. Try again shortly.");
  }
  const body = await c.req
    .json<{
      firstName?: string;
      lastName?: string;
      name?: string;
      email?: string;
      phone?: string;
      membership?: "IEEE" | "EXTERNAL";
    }>()
    .catch(() => null);
  if (
    !body ||
    typeof body.email !== "string" ||
    !/^\S+@\S+\.\S+$/.test(body.email.trim()) ||
    typeof body.name !== "string" ||
    body.name.trim().length < 2 ||
    body.name.trim().length > 120
  ) {
    return jsonError(c, 400, "VALIDATION", "Valid member details are required.");
  }
  if (body.phone && (typeof body.phone !== "string" || body.phone.trim().length > 50)) {
    return jsonError(c, 400, "VALIDATION", "Phone number is too long.");
  }
  const email = body.email.trim().toLowerCase();
  const name = body.name.trim();
  const phone = typeof body.phone === "string" ? body.phone.trim().slice(0, 50) || null : null;
  const membership =
    body.membership === "IEEE" || body.membership === "EXTERNAL" ? body.membership : null;
  const now = new Date();

  const existing = await c.env.DB.select()
    .from(schema.authUsers)
    .where(eq(schema.authUsers.email, email))
    .limit(1);

  let userId: string;
  let user: typeof schema.authUsers.$inferSelect;
  if (existing.length > 0) {
    if (existing[0].role !== "USER") {
      return jsonError(
        c,
        403,
        "PRIVILEGED_ACCOUNT",
        "Privileged accounts cannot use borrower sign-in."
      );
    }
    if (existing[0].disabledAt) {
      return jsonError(c, 403, "ACCOUNT_DISABLED", "Your account access has been disabled.");
    }
    userId = existing[0].id;
    await c.env.DB.update(schema.authUsers)
      .set({
        name,
        phone: phone ?? existing[0].phone,
        membership: membership ?? existing[0].membership,
        updatedAt: now,
      })
      .where(eq(schema.authUsers.id, userId));
    user = {
      ...existing[0],
      name,
      phone: phone ?? existing[0].phone,
      membership: membership ?? existing[0].membership,
      updatedAt: now,
    };
  } else {
    userId = crypto.randomUUID();
    const [newUser] = await c.env.DB.insert(schema.authUsers)
      .values({
        id: userId,
        name,
        email,
        phone,
        membership,
        emailVerified: true,
        role: "USER",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    user = newUser;
  }

  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const sessionId = "sess_" + crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60_000);
  await c.env.DB.insert(schema.authSessions).values({
    id: sessionId,
    expiresAt,
    token,
    createdAt: now,
    updatedAt: now,
    ipAddress: requestIp(c),
    userAgent: c.req.header("User-Agent") ?? null,
    userId,
  });

  const isHttps = c.req.url.startsWith("https:");
  const signedToken = await signCookieValue(token, c.env.BETTER_AUTH_SECRET);
  const maxAge = 30 * 24 * 60 * 60; // 30 days
  const response = c.json({ ok: true, user });

  // Standard session cookie
  response.headers.append(
    "Set-Cookie",
    `better-auth.session_token=${signedToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps ? "; Secure" : ""}`
  );
  // __Secure- prefixed cookie for HTTPS / production environments
  if (isHttps) {
    response.headers.append(
      "Set-Cookie",
      `__Secure-better-auth.session_token=${signedToken}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${maxAge}`
    );
  }
  return response;
});

app.post("/api/v1/auth/board-login", async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>().catch(() => null);
  if (!body || !body.email || !body.password) {
    return jsonError(c, 400, "VALIDATION", "Staff email and password are required.");
  }
  const email = body.email.trim().toLowerCase();
  const auth = createAuth(c.env, trustedAuthOrigin(c.env, c.req.url, c.req.header("Origin")));
  const res = await auth.api
    .signInEmail({
      body: { email, password: body.password },
      headers: c.req.raw.headers,
      asResponse: true,
    })
    .catch(() => null);
  if (!res || !res.ok) {
    return jsonError(c, 401, "UNAUTHENTICATED", "Invalid email or password.");
  }
  const [user] = await c.env.DB.select()
    .from(schema.authUsers)
    .where(eq(schema.authUsers.email, email))
    .limit(1);
  if (!user || (user.role !== "BOARD" && user.role !== "SUPERADMIN")) {
    return jsonError(c, 403, "FORBIDDEN", "This account does not have Board staff access.");
  }
  const response = c.json({ ok: true, user });
  const setCookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : res.headers.get("set-cookie")
        ? [res.headers.get("set-cookie")!]
        : [];
  for (const cookie of setCookies) {
    response.headers.append("Set-Cookie", cookie);
  }
  return response;
});

app.post("/api/v1/auth/sign-out", async (c) => {
  const origin = trustedAuthOrigin(c.env, c.req.url, c.req.header("Origin"));
  const auth = createAuth(c.env, origin);

  // 1. Identify user before session deletion to ensure full cleanup
  let currentUserId: string | null = null;
  try {
    const user = await resolveIdentity(c);
    if (user?.id) currentUserId = user.id;
  } catch {
    // Ignore resolution error
  }

  // 2. Call Better Auth sign-out
  try {
    await auth.api.signOut({
      headers: c.req.raw.headers,
      asResponse: true,
    });
  } catch {
    // Ignore signOut API error
  }

  // 3. Purge session from DB by token
  const cookieHeader = c.req.header("Cookie") || "";
  const match = cookieHeader.match(/(?:__Secure-)?better-auth\.session_token=([^;]+)/);
  if (match) {
    const rawToken = decodeURIComponent(match[1]).split(".")[0];
    try {
      await c.env.DB.delete(schema.authSessions).where(eq(schema.authSessions.token, rawToken));
    } catch {
      // Ignore DB delete error
    }
  }

  // 4. If user was identified, delete all active sessions for this user
  if (currentUserId) {
    try {
      await c.env.DB.delete(schema.authSessions).where(
        eq(schema.authSessions.userId, currentUserId)
      );
    } catch {
      // Ignore DB delete error
    }
  }

  // 5. Explicitly clear all session cookies with Max-Age=0
  const response = c.json({ ok: true });
  const isHttps = c.req.url.startsWith("https:");
  const secure = isHttps ? "; Secure" : "";

  const clearCookieAttrs = [
    `better-auth.session_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`,
    `better-auth.session_data=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`,
    `better-auth.dont_remember=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`,
    `__Secure-better-auth.session_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure`,
    `__Secure-better-auth.session_data=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure`,
  ];

  for (const cookie of clearCookieAttrs) {
    response.headers.append("Set-Cookie", cookie);
  }

  return response;
});

app.get("/api/v1/me", async (c) => {
  const user = await resolveIdentity(c);
  return c.json({ user });
});

function intervalFromQuery(params: URLSearchParams) {
  const pickup = params.get("pickupAt");
  const returns = params.get("returnAt");
  if (!pickup && !returns) return { pickupAt: Date.now(), returnAt: Date.now() + 60 * 60_000 };
  if (
    !pickup ||
    !returns ||
    !/(?:Z|[+-]\d{2}:\d{2})$/.test(pickup) ||
    !/(?:Z|[+-]\d{2}:\d{2})$/.test(returns)
  ) {
    throw new DomainError(400, "INVALID_TIME_RANGE", "Choose a valid pickup and return time.");
  }
  const pickupAt = Date.parse(pickup);
  const returnAt = Date.parse(returns);
  if (!Number.isFinite(pickupAt) || !Number.isFinite(returnAt) || pickupAt >= returnAt) {
    throw new DomainError(
      400,
      "INVALID_TIME_RANGE",
      "Choose a pickup time before the return time."
    );
  }
  return { pickupAt, returnAt };
}

app.get("/api/v1/catalogue", async (c) => {
  const { pickupAt, returnAt } = intervalFromQuery(new URL(c.req.url).searchParams);
  return c.json(await listCatalogue(c.env, pickupAt, returnAt));
});

app.get("/api/v1/equipment/:id/availability", async (c) => {
  const { pickupAt, returnAt } = intervalFromQuery(new URL(c.req.url).searchParams);
  const item = await c.env.DB.select({ id: schema.equipmentItems.id })
    .from(schema.equipmentItems)
    .where(
      and(eq(schema.equipmentItems.id, c.req.param("id")), eq(schema.equipmentItems.active, true))
    )
    .limit(1);
  if (!item.length) return jsonError(c, 404, "NOT_FOUND", "Equipment not found.");
  const qty = await availableQuantity(
    c.env.CLIENT as unknown as SqlExecutor,
    item[0].id,
    pickupAt,
    returnAt
  );
  return c.json({ available: qty > 0 });
});

app.use("/api/v1/reservations", requireUser);
app.use("/api/v1/reservations/*", requireUser);

const createReservationSchema = z
  .object({
    borrowerType: z.literal("PERSON").optional(),
    pickupAt: millisIso,
    returnAt: millisIso,
    note: z.string().max(500).optional(),
    items: z
      .array(
        z.object({
          equipmentItemId: z.string().min(1),
          quantity: z.number().int().positive().max(100),
        })
      )
      .min(1)
      .max(40),
  })
  .strict();

app.get("/api/v1/reservations", async (c) =>
  c.json(await listReservations(c.env, c.get("actor").id))
);

app.post("/api/v1/reservations", async (c) => {
  const parsed = createReservationSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return jsonError(
      c,
      400,
      "VALIDATION",
      parsed.error.issues[0]?.message ?? "Check the reservation details."
    );
  const reservation = await createReservation(c.env, c.get("actor"), {
    ...parsed.data,
    pickupAt: Date.parse(parsed.data.pickupAt),
    returnAt: Date.parse(parsed.data.returnAt),
  });
  return c.json(reservation, 201);
});

app.get("/api/v1/reservations/:id", async (c) => {
  const reservation = await getReservation(c.env, c.req.param("id"));
  if (!reservation || reservation.requestedBy.id !== c.get("actor").id)
    return jsonError(c, 404, "NOT_FOUND", "Reservation not found.");
  return c.json(reservation);
});

app.delete("/api/v1/reservations/:id", async (c) => {
  const force = c.req.query("force") === "true";
  if (force) {
    const res = await getReservation(c.env, c.req.param("id"));
    if (!res || res.requestedBy.id !== c.get("actor").id) {
      return jsonError(c, 404, "NOT_FOUND", "Reservation not found.");
    }
    if (res.status !== "PENDING") {
      return jsonError(
        c,
        400,
        "BAD_REQUEST",
        "Only pending reservation requests can be force deleted."
      );
    }
    return c.json(await forceDeleteReservation(c.env, c.get("actor"), c.req.param("id")));
  }
  return c.json(await cancelReservation(c.env, c.get("actor"), c.req.param("id")));
});

app.get("/api/v1/notifications", async (c) => {
  const actor = await resolveIdentity(c);
  if (!actor) return jsonError(c, 401, "UNAUTHENTICATED", "Sign in to continue.");
  const offset = Math.max(0, Number(c.req.query("offset") ?? 0));
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? 100)));
  const notifications = await c.env.DB.select({
    id: schema.notifications.id,
    type: schema.notifications.type,
    title: schema.notifications.title,
    message: schema.notifications.message,
    reservationId: schema.notifications.reservationId,
    readAt: schema.notifications.readAt,
    createdAt: schema.notifications.createdAt,
  })
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, actor.id))
    .orderBy(desc(schema.notifications.createdAt))
    .offset(offset)
    .limit(limit);
  return c.json(notifications);
});

app.get("/api/v1/notifications/summary", async (c) => {
  const actor = await resolveIdentity(c);
  if (!actor) return jsonError(c, 401, "UNAUTHENTICATED", "Sign in to continue.");
  const rows = await c.env.CLIENT.execute({
    sql: "SELECT COUNT(*) AS total, SUM(CASE WHEN read_at IS NULL THEN 1 ELSE 0 END) AS unread FROM notifications WHERE user_id=?",
    args: [actor.id],
  });
  const row = rows.rows[0];
  return c.json({
    total: Number(row?.total ?? 0),
    unread: Number(row?.unread ?? 0),
  });
});

app.post("/api/v1/notifications/refresh", async (c) => {
  const actor = await resolveIdentity(c);
  if (!actor) return jsonError(c, 401, "UNAUTHENTICATED", "Sign in to continue.");
  const created =
    actor.role === "USER" ? await refreshReturnNotificationsForUser(c.env, actor.id) : 0;
  return c.json({ ok: true, notificationsCreated: created });
});

app.patch("/api/v1/notifications/read-all", async (c) => {
  const actor = await resolveIdentity(c);
  if (!actor) return jsonError(c, 401, "UNAUTHENTICATED", "Sign in to continue.");
  const result = await c.env.CLIENT.execute({
    sql: "UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL",
    args: [Date.now(), actor.id],
  });
  return c.json({ ok: true, changes: result.rowsAffected });
});

app.patch("/api/v1/notifications/:id/read", async (c) => {
  const actor = await resolveIdentity(c);
  if (!actor) return jsonError(c, 401, "UNAUTHENTICATED", "Sign in to continue.");
  const result = await c.env.DB.update(schema.notifications)
    .set({ readAt: Date.now() })
    .where(
      and(eq(schema.notifications.id, c.req.param("id")), eq(schema.notifications.userId, actor.id))
    );
  return c.json({ ok: true, changes: result.rowsAffected });
});

app.use("/api/v1/board", requireBoard);
app.use("/api/v1/board/*", requireBoard);

app.get("/api/v1/board/dashboard", async (c) => c.json(await boardDashboard(c.env)));
app.get("/api/v1/board/reservations", async (c) => {
  const startStr = c.req.query("start");
  const endStr = c.req.query("end");
  let start: number | undefined;
  let end: number | undefined;
  if (startStr !== undefined || endStr !== undefined) {
    if (
      !startStr ||
      !endStr ||
      !Number.isFinite(Date.parse(startStr)) ||
      !Number.isFinite(Date.parse(endStr))
    ) {
      return jsonError(c, 400, "VALIDATION", "Valid start and end dates are required.");
    }
    start = Date.parse(startStr);
    end = Date.parse(endStr);
    if (start >= end) {
      return jsonError(c, 400, "VALIDATION", "Start date must be before end date.");
    }
  }
  const offset = Math.max(0, Number(c.req.query("offset") ?? 0));
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? 100)));
  return c.json(await listBoardReservations(c.env, { offset, limit, start, end }));
});

app.get("/api/v1/board/reservations/:id/borrower", async (c) => {
  const reservation = await getReservation(c.env, c.req.param("id"));
  if (!reservation) return jsonError(c, 404, "NOT_FOUND", "Reservation not found.");
  const userId =
    reservation.borrower.type === "PERSON" ? reservation.borrower.id : reservation.requestedBy.id;
  const [person] = await c.env.DB.select({
    name: schema.authUsers.name,
    email: schema.authUsers.email,
    phone: schema.authUsers.phone,
  })
    .from(schema.authUsers)
    .where(eq(schema.authUsers.id, userId))
    .limit(1);
  if (!person) return jsonError(c, 404, "NOT_FOUND", "Borrower not found.");
  const count = await c.env.CLIENT.execute({
    sql:
      "SELECT COUNT(DISTINCT r.id) AS count FROM reservations r WHERE " +
      (reservation.borrower.type === "PERSON"
        ? "r.borrower_type='PERSON' AND r.borrower_user_id=?"
        : "r.borrower_type='CHAPTER' AND r.chapter_id=?") +
      " AND EXISTS (SELECT 1 FROM reservation_assets ra WHERE ra.reservation_id=r.id AND ra.actual_pickup_at IS NOT NULL)",
    args: [reservation.borrower.id],
  });
  const materials = await c.env.CLIENT.execute({
    sql:
      "SELECT COUNT(CASE WHEN ra.actual_pickup_at IS NOT NULL THEN 1 END) AS collected_count, " +
      "COUNT(CASE WHEN ra.state='BORROWED' THEN 1 END) AS borrowed_count " +
      "FROM reservations r INNER JOIN reservation_assets ra ON ra.reservation_id=r.id WHERE " +
      (reservation.borrower.type === "PERSON"
        ? "r.borrower_type='PERSON' AND r.borrower_user_id=?"
        : "r.borrower_type='CHAPTER' AND r.chapter_id=?"),
    args: [reservation.borrower.id],
  });
  const collectedTotal = Number(materials.rows[0]?.collected_count ?? 0);
  const borrowedNow = Number(materials.rows[0]?.borrowed_count ?? 0);
  return c.json({
    ...person,
    borrowingCount: Number(count.rows[0]?.count ?? 0),
    chapterName: reservation.borrower.type === "CHAPTER" ? reservation.borrower.name : null,
    totalCollected: collectedTotal,
    stillBorrowed: borrowedNow,
  });
});

app.get("/api/v1/board/reservations/:id", async (c) => {
  const reservation = await getReservation(c.env, c.req.param("id"), true);
  if (!reservation) return jsonError(c, 404, "NOT_FOUND", "Reservation not found.");
  const candidates = await Promise.all(
    reservation.items.map(async (item) => ({
      lineId: item.lineId,
      assets:
        reservation.status === "APPROVED"
          ? (
              await findAvailableAssets(
                c.env.CLIENT as unknown as SqlExecutor,
                item.equipmentItemId,
                Date.parse(reservation.pickupAt),
                Date.parse(reservation.returnAt)
              )
            )
              .filter(
                (asset) => !item.assignedAssets?.some((collected) => collected.id === asset.id)
              )
              .map((asset) => ({
                id: asset.id,
                assetCode: asset.asset_code,
                serialNumber: asset.serial_number,
                state: asset.state,
              }))
          : [],
    }))
  );
  return c.json({ ...reservation, allocationCandidates: candidates });
});

const assignmentsSchema = z.record(z.string(), z.array(z.string()));
app.post("/api/v1/board/reservations/:id/handover", async (c) => {
  const parsed = z
    .object({ assetIds: z.array(z.string().min(1)).min(1).max(500) })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return jsonError(c, 400, "VALIDATION", "Select the material labels actually handed over.");
  return c.json(
    await handoverReservation(c.env, c.get("actor"), c.req.param("id"), parsed.data.assetIds)
  );
});

app.post("/api/v1/board/reservations/:id/approve", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = z.object({ assignments: assignmentsSchema.optional() }).safeParse(body);
  if (!parsed.success) return jsonError(c, 400, "VALIDATION", "Asset assignments are invalid.");
  return c.json(
    await approveReservation(c.env, c.get("actor"), c.req.param("id"), parsed.data.assignments)
  );
});

app.post("/api/v1/board/reservations/:id/decline", async (c) => {
  return c.json(await declineReservation(c.env, c.get("actor"), c.req.param("id")));
});

app.delete("/api/v1/board/reservations/:id", async (c) => {
  const force = c.req.query("force") === "true";
  if (force) {
    return c.json(await forceDeleteReservation(c.env, c.get("actor"), c.req.param("id")));
  }
  return c.json(await cancelReservation(c.env, c.get("actor"), c.req.param("id"), true));
});

app.delete("/api/v1/board/reservations/:id/force", async (c) => {
  return c.json(await forceDeleteReservation(c.env, c.get("actor"), c.req.param("id")));
});

app.patch("/api/v1/board/reservations/:id/window", async (c) => {
  const parsed = z
    .object({ pickupAt: millisIso, returnAt: millisIso, assignments: assignmentsSchema.optional() })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return jsonError(
      c,
      400,
      "VALIDATION",
      parsed.error.issues[0]?.message ?? "Choose a valid reservation window."
    );
  return c.json(
    await rescheduleReservation(
      c.env,
      c.get("actor"),
      c.req.param("id"),
      Date.parse(parsed.data.pickupAt),
      Date.parse(parsed.data.returnAt),
      parsed.data.assignments
    )
  );
});

app.get("/api/v1/board/calendar", async (c) => {
  const start = c.req.query("start");
  const end = c.req.query("end");
  if (!start || !end)
    return jsonError(c, 400, "INVALID_TIME_RANGE", "Choose a calendar date range.");
  return c.json(
    await calendarEvents(c.env, Date.parse(start), Date.parse(end), {
      equipmentItemId: c.req.query("equipmentItemId"),
      borrower: c.req.query("borrower"),
      status: c.req.query("status"),
    })
  );
});

app.post("/api/v1/board/scan", async (c) => {
  const actor = c.get("actor");
  if (await isRateLimited(c.env, `scan:${actor.id}`, 180))
    return jsonError(c, 429, "RATE_LIMITED", "Scanner is busy. Wait a moment and try again.");
  const parsed = z
    .object({
      qrToken: z.string().min(1).max(256),
      reservationId: z.string().min(1).optional(),
      operation: z.enum(["CHECKED_OUT", "RETURNED"]).optional(),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return jsonError(c, 400, "INVALID_ASSET", "This QR code is not valid.");
  const idempotencyKey = c.req.header("Idempotency-Key") || crypto.randomUUID();
  return c.json(
    await scanAsset(
      c.env,
      actor,
      parsed.data.qrToken,
      idempotencyKey,
      parsed.data.reservationId,
      parsed.data.operation
    )
  );
});

app.get("/api/v1/board/inventory", async (c) => {
  const origin = trustedAuthOrigin(c.env, c.req.url);
  const equipment = await c.env.DB.select({
    id: schema.equipmentItems.id,
    name: schema.equipmentItems.name,
    description: schema.equipmentItems.description,
    category: schema.equipmentItems.category,
    imageUrl: schema.equipmentItems.imageUrl,
    active: schema.equipmentItems.active,
  })
    .from(schema.equipmentItems)
    .orderBy(asc(schema.equipmentItems.category), asc(schema.equipmentItems.name));
  const assets = await c.env.CLIENT.execute({
    sql: `SELECT a.id,a.equipment_item_id AS equipmentItemId,a.asset_code AS assetCode,a.qr_token AS qrToken,
                 a.serial_number AS serialNumber,a.state,a.active,a.last_scan_at AS lastScanAt,e.name AS equipmentName
            FROM assets a INNER JOIN equipment_items e ON e.id=a.equipment_item_id ORDER BY e.name,a.asset_code`,
  });
  const grouped = new Map(
    equipment.map((item) => [item.id, { ...item, assets: [] as Array<Record<string, unknown>> }])
  );
  for (const raw of assets.rows as unknown as Array<Record<string, unknown>>) {
    const item = grouped.get(String(raw.equipmentItemId));
    if (!item) continue;
    const assignment = await c.env.CLIENT.execute({
      sql: `SELECT r.pickup_at AS pickupAt,r.return_at AS returnAt,
                   CASE WHEN r.borrower_type='PERSON' THEN u.name ELSE ch.name END AS borrowerName
              FROM reservation_assets ra INNER JOIN reservations r ON r.id=ra.reservation_id
              LEFT JOIN user u ON u.id=r.borrower_user_id LEFT JOIN chapters ch ON ch.id=r.chapter_id
             WHERE ra.asset_id=? AND ra.state IN ('RESERVED','BORROWED') AND r.status IN ('APPROVED','CANCELLED')
             ORDER BY r.pickup_at LIMIT 1`,
      args: [String(raw.id)],
    });
    const nextReservation = assignment.rows[0] as unknown as Record<string, unknown> | undefined;
    item.assets.push({
      id: raw.id,
      assetCode: raw.assetCode,
      qrUrl: new URL(`/scan/${String(raw.qrToken)}`, origin).toString(),
      serialNumber: raw.serialNumber,
      state: raw.state,
      active: Boolean(raw.active),
      nextReservation: nextReservation
        ? {
            pickupAt: new Date(Number(nextReservation.pickupAt)).toISOString(),
            returnAt: new Date(Number(nextReservation.returnAt)).toISOString(),
            borrowerName: nextReservation.borrowerName,
          }
        : null,
    });
  }
  return c.json([...grouped.values()]);
});

const equipmentSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    description: z.string().max(1000).default(""),
    category: z.string().trim().min(1).max(80),
    imageUrl: z.string().url().max(1000).nullable().optional(),
  })
  .strict();

app.post("/api/v1/board/equipment", async (c) => {
  const parsed = equipmentSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return jsonError(
      c,
      400,
      "VALIDATION",
      parsed.error.issues[0]?.message ?? "Equipment details are invalid."
    );
  const timestamp = Date.now();
  const itemId = randomId("equipment");
  await c.env.CLIENT.execute({
    sql: "INSERT INTO equipment_items(id,name,description,category,image_url,active,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)",
    args: [
      itemId,
      parsed.data.name,
      parsed.data.description,
      parsed.data.category,
      parsed.data.imageUrl ?? null,
      timestamp,
      timestamp,
    ],
  });
  await c.env.CLIENT.execute({
    sql: "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES(?,?,?,?,?,?,?)",
    args: [
      randomId("audit"),
      c.get("actor").id,
      "EQUIPMENT",
      itemId,
      "EQUIPMENT_CREATED",
      timestamp,
      "{}",
    ],
  });
  return c.json({ id: itemId, ...parsed.data, active: true, assets: [] }, 201);
});

app.patch("/api/v1/board/equipment/:id", async (c) => {
  const parsed = z
    .object({ active: z.boolean() })
    .strict()
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return jsonError(c, 400, "VALIDATION", "Choose whether this equipment is active.");
  const id = c.req.param("id");

  return c.json(
    await write(c.env, async (tx) => {
      const equipment = await one<{ id: string; active: number }>(
        tx,
        "SELECT id, active FROM equipment_items WHERE id=?",
        [id]
      );
      if (!equipment) throw new DomainError(404, "NOT_FOUND", "Equipment not found.");

      if (!parsed.data.active && equipment.active) {
        const capacityRow = await one<{ count: number }>(
          tx,
          "SELECT COUNT(*) AS count FROM assets WHERE equipment_item_id=? AND active=1 AND state NOT IN ('OUT_OF_SERVICE','RETIRED')",
          [id]
        );
        const usableCount = Number(capacityRow?.count ?? 0);
        await assertCanReduceCapacity(tx, id, usableCount, "deactivate this equipment");
      }

      const timestamp = Date.now();
      await tx.execute({
        sql: "UPDATE equipment_items SET active=?, updated_at=? WHERE id=?",
        args: [parsed.data.active ? 1 : 0, timestamp, id],
      });
      await tx.execute({
        sql: "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES(?,?,?,?,?,?,?)",
        args: [
          randomId("audit"),
          c.get("actor").id,
          "EQUIPMENT",
          id,
          parsed.data.active ? "EQUIPMENT_ACTIVATED" : "EQUIPMENT_DISABLED",
          timestamp,
          JSON.stringify({ active: parsed.data.active }),
        ],
      });
      return { ok: true };
    })
  );
});

app.delete("/api/v1/board/equipment/:id", requireBoard, async (c) => {
  const id = c.req.param("id");

  return c.json(
    await write(c.env, async (tx) => {
      const equipment = await one<{ id: string }>(tx, "SELECT id FROM equipment_items WHERE id=?", [
        id,
      ]);
      if (!equipment) throw new DomainError(404, "NOT_FOUND", "Equipment not found.");

      const borrowed = await one<{ count: number }>(
        tx,
        "SELECT COUNT(*) AS count FROM assets WHERE equipment_item_id=? AND state='BORROWED'",
        [id]
      );
      if (Number(borrowed?.count ?? 0) > 0) {
        throw new DomainError(
          409,
          "RESERVATION_CONFLICT",
          "Cannot delete equipment while some of its assets are currently borrowed."
        );
      }

      const capacityRow = await one<{ count: number }>(
        tx,
        "SELECT COUNT(*) AS count FROM assets WHERE equipment_item_id=? AND active=1 AND state NOT IN ('OUT_OF_SERVICE','RETIRED')",
        [id]
      );
      const usableCount = Number(capacityRow?.count ?? 0);
      await assertCanReduceCapacity(tx, id, usableCount, "delete this equipment");

      const lines = await one<{ count: number }>(
        tx,
        "SELECT COUNT(*) AS count FROM reservation_lines WHERE equipment_item_id=?",
        [id]
      );
      if (Number(lines?.count ?? 0) > 0) {
        throw new DomainError(
          409,
          "RESERVATION_CONFLICT",
          "Cannot delete equipment associated with existing reservations."
        );
      }

      await tx.execute({ sql: "DELETE FROM assets WHERE equipment_item_id=?", args: [id] });
      await tx.execute({ sql: "DELETE FROM equipment_items WHERE id=?", args: [id] });
      await tx.execute({
        sql: "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES(?,?,?,?,?,?,?)",
        args: [
          randomId("audit"),
          c.get("actor").id,
          "EQUIPMENT",
          id,
          "EQUIPMENT_DELETED",
          Date.now(),
          "{}",
        ],
      });
      return { ok: true };
    })
  );
});

app.post("/api/v1/board/equipment/:id/assets", async (c) => {
  const parsed = z
    .object({
      assetCode: z.string().trim().min(1).max(80),
      serialNumber: z.string().trim().max(120).nullable().optional(),
    })
    .strict()
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return jsonError(c, 400, "VALIDATION", "Enter a valid asset code.");
  const equipment = await c.env.DB.select({
    id: schema.equipmentItems.id,
    active: schema.equipmentItems.active,
    name: schema.equipmentItems.name,
  })
    .from(schema.equipmentItems)
    .where(eq(schema.equipmentItems.id, c.req.param("id")))
    .limit(1);
  if (!equipment[0] || !equipment[0].active)
    return jsonError(c, 404, "NOT_FOUND", "Active equipment was not found.");
  const assetId = randomId("asset");
  const qrToken = createQrToken();
  const timestamp = Date.now();
  await c.env.CLIENT.execute({
    sql: "INSERT INTO assets(id,equipment_item_id,asset_code,qr_token,serial_number,state,active,created_at,updated_at) VALUES(?,?,?,?,?,'AVAILABLE',1,?,?)",
    args: [
      assetId,
      c.req.param("id"),
      parsed.data.assetCode,
      qrToken,
      parsed.data.serialNumber ?? null,
      timestamp,
      timestamp,
    ],
  });
  await c.env.CLIENT.execute({
    sql: "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES(?,?,?,?,?,?,?)",
    args: [
      randomId("audit"),
      c.get("actor").id,
      "ASSET",
      assetId,
      "ASSET_CREATED",
      timestamp,
      JSON.stringify({ assetCode: parsed.data.assetCode }),
    ],
  });
  const origin = trustedAuthOrigin(c.env, c.req.url);
  return c.json(
    {
      id: assetId,
      assetCode: parsed.data.assetCode,
      qrUrl: new URL(`/scan/${qrToken}`, origin).toString(),
      state: "AVAILABLE",
      active: true,
    },
    201
  );
});

app.patch("/api/v1/board/assets/:id", async (c) => {
  const parsed = z
    .object({ state: z.enum(["AVAILABLE", "OUT_OF_SERVICE", "RETIRED"]) })
    .strict()
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return jsonError(c, 400, "VALIDATION", "Choose a valid asset state.");
  const assetId = c.req.param("id");

  return c.json(
    await write(c.env, async (tx) => {
      const asset = await one<{
        id: string;
        equipment_item_id: string;
        state: string;
        active: number;
      }>(tx, "SELECT id, equipment_item_id, state, active FROM assets WHERE id=?", [assetId]);
      if (!asset) throw new DomainError(404, "NOT_FOUND", "Asset not found.");
      if (asset.state === "BORROWED") {
        throw new DomainError(
          409,
          "RESERVATION_CONFLICT",
          "Return the asset before changing its state."
        );
      }
      if (asset.state === "RETIRED" && parsed.data.state !== "RETIRED") {
        throw new DomainError(409, "INVALID_ASSET", "Retired assets cannot be restored.");
      }

      if (
        asset.active &&
        asset.state === "AVAILABLE" &&
        ["OUT_OF_SERVICE", "RETIRED"].includes(parsed.data.state)
      ) {
        await assertCanReduceCapacity(
          tx,
          asset.equipment_item_id,
          1,
          parsed.data.state === "RETIRED" ? "retire this asset" : "mark this asset out of service"
        );
      }

      const timestamp = Date.now();
      await tx.execute({
        sql: "UPDATE assets SET state=?, active=?, updated_at=? WHERE id=?",
        args: [parsed.data.state, parsed.data.state !== "RETIRED" ? 1 : 0, timestamp, assetId],
      });
      await tx.execute({
        sql: "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES(?,?,?,?,?,?,?)",
        args: [
          randomId("audit"),
          c.get("actor").id,
          "ASSET",
          assetId,
          parsed.data.state === "RETIRED" ? "ASSET_DISABLED" : "ASSET_STATE_CHANGED",
          timestamp,
          JSON.stringify({ state: parsed.data.state }),
        ],
      });
      return { ok: true };
    })
  );
});

app.delete("/api/v1/board/assets/:id", requireBoard, async (c) => {
  const assetId = c.req.param("id");

  return c.json(
    await write(c.env, async (tx) => {
      const asset = await one<{
        id: string;
        equipment_item_id: string;
        state: string;
        active: number;
      }>(tx, "SELECT id, equipment_item_id, state, active FROM assets WHERE id=?", [assetId]);
      if (!asset) throw new DomainError(404, "NOT_FOUND", "Asset not found.");
      if (asset.state === "BORROWED") {
        throw new DomainError(
          409,
          "RESERVATION_CONFLICT",
          "Cannot delete an asset that is currently borrowed."
        );
      }

      if (asset.active && asset.state === "AVAILABLE") {
        await assertCanReduceCapacity(tx, asset.equipment_item_id, 1, "delete this asset");
      }

      await tx.execute({ sql: "DELETE FROM assets WHERE id=?", args: [assetId] });
      await tx.execute({
        sql: "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES(?,?,?,?,?,?,?)",
        args: [
          randomId("audit"),
          c.get("actor").id,
          "ASSET",
          assetId,
          "ASSET_DELETED",
          Date.now(),
          "{}",
        ],
      });
      return { ok: true };
    })
  );
});

app.get("/api/v1/board/chapters", async (c) => {
  const chapters = await c.env.DB.select().from(schema.chapters).orderBy(asc(schema.chapters.name));
  return c.json(chapters);
});

app.patch("/api/v1/board/reservations/:id/chapter", async (c) => {
  const parsed = z
    .object({ chapterId: z.string().min(1).nullable() })
    .strict()
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return jsonError(c, 400, "VALIDATION", "Choose a valid project or team.");
  const reservationId = c.req.param("id");
  const reservation = await getReservation(c.env, reservationId);
  if (!reservation) return jsonError(c, 404, "NOT_FOUND", "Reservation not found.");
  const chapterId = parsed.data.chapterId;
  if (chapterId) {
    const chapter = await c.env.DB.select({ id: schema.chapters.id })
      .from(schema.chapters)
      .where(and(eq(schema.chapters.id, chapterId), eq(schema.chapters.active, true)))
      .limit(1);
    if (!chapter.length)
      return jsonError(c, 400, "VALIDATION", "That project or team is unavailable.");
  }
  const actor = c.get("actor");
  const now = Date.now();
  await c.env.CLIENT.execute({
    sql: "UPDATE reservations SET borrower_type=?,borrower_user_id=?,chapter_id=?,updated_at=? WHERE id=?",
    args: [
      chapterId ? "CHAPTER" : "PERSON",
      chapterId ? null : reservation.requestedBy.id,
      chapterId,
      now,
      reservationId,
    ],
  });
  await c.env.CLIENT.execute({
    sql: "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES(?,?,?,?,?,?,?)",
    args: [
      randomId("audit"),
      actor.id,
      "RESERVATION",
      reservationId,
      "RESERVATION_PROJECT_ASSIGNED",
      now,
      JSON.stringify({ chapterId }),
    ],
  });
  return c.json(await getReservation(c.env, reservationId));
});

app.post("/api/v1/board/chapters", async (c) => {
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(120),
      shortCode: z
        .string()
        .trim()
        .min(2)
        .max(24)
        .regex(/^[A-Za-z0-9-]+$/),
    })
    .strict()
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return jsonError(c, 400, "VALIDATION", "Enter a chapter name and short code.");
  const timestamp = Date.now();
  const chapterId = randomId("chapter");
  await c.env.CLIENT.execute({
    sql: "INSERT INTO chapters(id,name,short_code,active,created_at,updated_at) VALUES(?,?,?,1,?,?)",
    args: [chapterId, parsed.data.name, parsed.data.shortCode.toUpperCase(), timestamp, timestamp],
  });
  return c.json(
    { id: chapterId, ...parsed.data, shortCode: parsed.data.shortCode.toUpperCase(), active: true },
    201
  );
});

app.patch("/api/v1/board/chapters/:id", async (c) => {
  const parsed = z
    .object({ active: z.boolean() })
    .strict()
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return jsonError(c, 400, "VALIDATION", "Choose whether this chapter is active.");
  const result = await c.env.DB.update(schema.chapters)
    .set({ active: parsed.data.active, updatedAt: Date.now() })
    .where(eq(schema.chapters.id, c.req.param("id")));
  if (!result.rowsAffected) return jsonError(c, 404, "NOT_FOUND", "Chapter not found.");
  return c.json({ ok: true });
});

app.delete("/api/v1/board/chapters/:id", requireBoard, async (c) => {
  const id = c.req.param("id");
  // Check if chapter has any reservations
  const reservations = await c.env.DB.select({ id: schema.reservations.id })
    .from(schema.reservations)
    .where(eq(schema.reservations.chapterId, id))
    .limit(1);
  if (reservations.length > 0)
    return jsonError(
      c,
      409,
      "RESERVATION_CONFLICT",
      "Cannot delete a chapter that has reservations. Deactivate it instead."
    );
  const result = await c.env.DB.delete(schema.chapters).where(eq(schema.chapters.id, id));
  if (!result.rowsAffected) return jsonError(c, 404, "NOT_FOUND", "Chapter not found.");
  await c.env.CLIENT.execute({
    sql: "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES(?,?,?,?,?,?,?)",
    args: [
      randomId("audit"),
      c.get("actor").id,
      "CHAPTER",
      id,
      "CHAPTER_DELETED",
      Date.now(),
      "{}",
    ],
  });
  return c.json({ ok: true });
});

app.get("/api/v1/board/users", requireSuperadmin, async (c) => {
  const users = await c.env.DB.select({
    id: schema.authUsers.id,
    name: schema.authUsers.name,
    email: schema.authUsers.email,
    role: schema.authUsers.role,
    disabledAt: schema.authUsers.disabledAt,
    emailVerified: schema.authUsers.emailVerified,
    createdAt: schema.authUsers.createdAt,
  })
    .from(schema.authUsers)
    .orderBy(asc(schema.authUsers.name))
    .limit(500);
  return c.json(users);
});

app.post("/api/v1/board/users", requireSuperadmin, async (c) => {
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(120),
      email: z.string().trim().email().max(320),
      role: z.enum(["BOARD", "SUPERADMIN"]).default("BOARD"),
      password: z.string().min(12).max(128),
    })
    .strict()
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return jsonError(
      c,
      400,
      "VALIDATION",
      parsed.error.issues[0]?.message ?? "Enter a name, email, password (min 12 chars), and role."
    );

  const passwordHash = await hashPassword(parsed.data.password);
  const userId = randomId("user");
  const timestamp = Date.now();

  try {
    await write(c.env, async (tx) => {
      const existing = await one<{ id: string }>(tx, "SELECT id FROM user WHERE email = ?", [
        parsed.data.email.toLowerCase(),
      ]);
      if (existing)
        throw new DomainError(
          409,
          "RESERVATION_CONFLICT",
          "An account with that email already exists."
        );

      await tx.execute({
        sql: "INSERT INTO user(id,name,email,emailVerified,role,createdAt,updatedAt) VALUES(?,?,?,1,?,?,?)",
        args: [
          userId,
          parsed.data.name,
          parsed.data.email.toLowerCase(),
          parsed.data.role,
          timestamp,
          timestamp,
        ],
      });
      await tx.execute({
        sql: "INSERT INTO account(id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)",
        args: [
          randomId("account"),
          userId,
          "credential",
          userId,
          passwordHash,
          timestamp,
          timestamp,
        ],
      });
      await tx.execute({
        sql: "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES(?,?,?,?,?,?,?)",
        args: [
          randomId("audit"),
          c.get("actor").id,
          "USER",
          userId,
          "USER_CREATED",
          timestamp,
          JSON.stringify({ role: parsed.data.role, email: parsed.data.email.toLowerCase() }),
        ],
      });
    });
  } catch (error) {
    if (error instanceof DomainError) return jsonError(c, error.status, error.code, error.message);
    throw error;
  }

  return c.json(
    {
      id: userId,
      name: parsed.data.name,
      email: parsed.data.email.toLowerCase(),
      role: parsed.data.role,
      emailVerified: true,
    },
    201
  );
});

app.put("/api/v1/board/users/:id/password", requireSuperadmin, async (c) => {
  const parsed = z
    .object({ password: z.string().min(12).max(128) })
    .strict()
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return jsonError(c, 400, "VALIDATION", "Password must be at least 12 characters.");
  const targetId = c.req.param("id");
  const user = await c.env.DB.select({ id: schema.authUsers.id, email: schema.authUsers.email })
    .from(schema.authUsers)
    .where(eq(schema.authUsers.id, targetId))
    .limit(1);
  if (!user[0]) return jsonError(c, 404, "NOT_FOUND", "Account not found.");

  const passwordHash = await hashPassword(parsed.data.password);
  // Upsert password in account table
  const acct = await c.env.CLIENT.execute({
    sql: "SELECT id FROM account WHERE userId=? AND providerId='credential' LIMIT 1",
    args: [targetId],
  });
  if (acct.rows.length > 0) {
    await c.env.CLIENT.execute({
      sql: "UPDATE account SET password=?,updatedAt=? WHERE userId=? AND providerId='credential'",
      args: [passwordHash, Date.now(), targetId],
    });
  } else {
    await c.env.CLIENT.execute({
      sql: "INSERT INTO account(id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)",
      args: [
        randomId("account"),
        targetId, // accountId must equal userId for credential provider
        "credential",
        targetId,
        passwordHash,
        Date.now(),
        Date.now(),
      ],
    });
  }
  // Invalidate all sessions for this user
  await c.env.DB.delete(schema.authSessions).where(eq(schema.authSessions.userId, targetId));
  await c.env.CLIENT.execute({
    sql: "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES(?,?,?,?,?,?,?)",
    args: [
      randomId("audit"),
      c.get("actor").id,
      "USER",
      targetId,
      "PASSWORD_RESET",
      Date.now(),
      "{}",
    ],
  });
  return c.json({ ok: true });
});

app.patch("/api/v1/board/users/:id/role", requireSuperadmin, async (c) => {
  const parsed = z
    .object({ role: z.enum(["USER", "BOARD", "SUPERADMIN"]) })
    .strict()
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return jsonError(c, 400, "VALIDATION", "Choose a valid account role.");
  const targetId = c.req.param("id");
  if (targetId === c.get("actor").id && parsed.data.role !== "SUPERADMIN")
    return jsonError(
      c,
      409,
      "RESERVATION_CONFLICT",
      "You cannot remove your own superadmin access."
    );
  const previous = await c.env.DB.select({ role: schema.authUsers.role })
    .from(schema.authUsers)
    .where(eq(schema.authUsers.id, targetId))
    .limit(1);
  if (!previous[0]) return jsonError(c, 404, "NOT_FOUND", "Account not found.");
  await c.env.DB.update(schema.authUsers)
    .set({ role: parsed.data.role, updatedAt: new Date() })
    .where(eq(schema.authUsers.id, targetId));
  await c.env.CLIENT.execute({
    sql: "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES(?,?,?,?,?,?,?)",
    args: [
      randomId("audit"),
      c.get("actor").id,
      "USER",
      targetId,
      "ROLE_CHANGED",
      Date.now(),
      JSON.stringify({ before: previous[0].role, after: parsed.data.role }),
    ],
  });
  return c.json({ ok: true, role: parsed.data.role });
});

app.patch("/api/v1/board/users/:id/access", requireSuperadmin, async (c) => {
  const parsed = z
    .object({ enabled: z.boolean() })
    .strict()
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return jsonError(c, 400, "VALIDATION", "Choose whether access is enabled.");
  const targetId = c.req.param("id");
  if (targetId === c.get("actor").id && !parsed.data.enabled) {
    return jsonError(c, 409, "RESERVATION_CONFLICT", "You cannot disable your own access.");
  }
  const user = await c.env.DB.select({ id: schema.authUsers.id })
    .from(schema.authUsers)
    .where(eq(schema.authUsers.id, targetId))
    .limit(1);
  if (!user[0]) return jsonError(c, 404, "NOT_FOUND", "Account not found.");

  const now = Date.now();
  await write(c.env, async (tx) => {
    if (parsed.data.enabled) {
      await tx.execute({
        sql: "UPDATE user SET disabled_at=NULL, updatedAt=? WHERE id=?",
        args: [now, targetId],
      });
    } else {
      await tx.execute({
        sql: "UPDATE user SET disabled_at=?, updatedAt=? WHERE id=?",
        args: [now, now, targetId],
      });
      await tx.execute({
        sql: "DELETE FROM session WHERE userId=?",
        args: [targetId],
      });
    }
    await tx.execute({
      sql: "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES(?,?,?,?,?,?,?)",
      args: [
        randomId("audit"),
        c.get("actor").id,
        "USER",
        targetId,
        parsed.data.enabled ? "USER_ACCESS_ENABLED" : "USER_ACCESS_DISABLED",
        now,
        JSON.stringify({ enabled: parsed.data.enabled }),
      ],
    });
  });
  return c.json({ ok: true, enabled: parsed.data.enabled });
});

app.delete("/api/v1/board/users/:id", requireSuperadmin, async (c) => {
  const targetId = c.req.param("id");
  if (targetId === c.get("actor").id) {
    return jsonError(c, 400, "BAD_REQUEST", "You cannot delete your own account.");
  }
  const existing = await c.env.DB.select()
    .from(schema.authUsers)
    .where(eq(schema.authUsers.id, targetId))
    .limit(1);
  if (!existing[0]) return jsonError(c, 404, "NOT_FOUND", "Account not found.");

  // Check if user has active or pending reservations
  const activeRes = await c.env.DB.select({ id: schema.reservations.id })
    .from(schema.reservations)
    .where(
      and(
        eq(schema.reservations.requestedByUserId, targetId),
        inArray(schema.reservations.status, ["PENDING", "APPROVED"])
      )
    )
    .limit(1);
  if (activeRes.length > 0) {
    return jsonError(
      c,
      409,
      "ACTIVE_RESERVATIONS",
      "Cannot delete a user with active or pending reservations."
    );
  }

  // Check if user has historical borrowing records with physical handover
  const historicalPickup = await c.env.CLIENT.execute({
    sql: `SELECT 1 FROM reservation_assets ra
          JOIN reservations r ON r.id = ra.reservation_id
          WHERE (r.requested_by_user_id = ? OR r.borrower_user_id = ?)
            AND ra.actual_pickup_at IS NOT NULL
          LIMIT 1`,
    args: [targetId, targetId],
  });
  if (historicalPickup.rows.length > 0) {
    return jsonError(
      c,
      409,
      "HISTORICAL_DATA",
      "Historical users with borrowing records cannot be deleted. Disable access instead."
    );
  }

  return c.json(
    await write(c.env, async (tx) => {
      // 1. Delete notifications for this user
      await tx.execute({ sql: "DELETE FROM notifications WHERE user_id=?", args: [targetId] });

      // 2. Anonymize/unlink board actions on other users' reservations
      await tx.execute({
        sql: "UPDATE reservations SET approved_by_user_id=NULL WHERE approved_by_user_id=?",
        args: [targetId],
      });
      await tx.execute({
        sql: "UPDATE reservation_assets SET checked_out_by_user_id=NULL WHERE checked_out_by_user_id=?",
        args: [targetId],
      });
      await tx.execute({
        sql: "UPDATE reservation_assets SET checked_in_by_user_id=NULL WHERE checked_in_by_user_id=?",
        args: [targetId],
      });

      // 3. Delete past (completed/cancelled/rejected) reservations belonging to this user
      const userReservations = await tx.execute({
        sql: "SELECT id FROM reservations WHERE requested_by_user_id=? OR borrower_user_id=?",
        args: [targetId, targetId],
      });
      for (const r of userReservations.rows as unknown as Array<{ id: string }>) {
        await tx.execute({
          sql: "DELETE FROM reservation_assets WHERE reservation_id=?",
          args: [r.id],
        });
        await tx.execute({
          sql: "DELETE FROM reservation_lines WHERE reservation_id=?",
          args: [r.id],
        });
        await tx.execute({
          sql: "DELETE FROM reservations WHERE id=?",
          args: [r.id],
        });
      }

      // 4. Invalidate all sessions for this user
      await tx.execute({ sql: "DELETE FROM session WHERE userId=?", args: [targetId] });

      // 5. Delete credentials from account table
      await tx.execute({ sql: "DELETE FROM account WHERE userId=?", args: [targetId] });

      // 6. Check if user has authored any immutable audit events
      const hasAudit = await tx.execute({
        sql: "SELECT id FROM audit_events WHERE actor_user_id=? LIMIT 1",
        args: [targetId],
      });
      if (hasAudit.rows.length > 0) {
        await tx.execute({
          sql: "UPDATE user SET name='Deleted User', email=?, phone=NULL, role='USER', emailVerified=0, updatedAt=? WHERE id=?",
          args: [`disabled_${targetId}@deleted.local`, Date.now(), targetId],
        });
      } else {
        await tx.execute({ sql: "DELETE FROM user WHERE id=?", args: [targetId] });
      }

      await tx.execute({
        sql: "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES(?,?,?,?,?,?,?)",
        args: [
          randomId("audit"),
          c.get("actor").id,
          "USER",
          targetId,
          "USER_DELETED",
          Date.now(),
          JSON.stringify({
            email: existing[0].email,
            name: existing[0].name,
            role: existing[0].role,
          }),
        ],
      });

      return { ok: true };
    })
  );
});

app.get("/api/v1/board/audit", async (c) => c.json(await listBoardAudit(c.env)));

app.notFound((c) => jsonError(c, 404, "NOT_FOUND", "API endpoint not found."));

export default app;
