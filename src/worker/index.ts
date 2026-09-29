import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { schema } from "./database";
import type { CurrentUser, Env } from "./env";
import { createAuth, trustedAuthOrigin } from "./auth";
import { requireBoard, requireSuperadmin, requireUser, resolveIdentity } from "./identity";
import {
  approveReservation,
  boardDashboard,
  calendarEvents,
  cancelReservation,
  createQrToken,
  createReservation,
  declineReservation,
  findAvailableAssets,
  getReservation,
  listBoardAudit,
  listBoardReservations,
  listCatalogue,
  listReservations,
  randomId,
  rescheduleReservation,
  scanAsset,
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
  console.error("request_failed", { requestId: requestIdValue, type: error.name });
  return jsonError(c, 500, "INTERNAL", "The request could not be completed.");
});

app.get("/api/health", async (c) => {
  await c.env.CLIENT.execute("SELECT 1");
  return c.json({ status: "ok" });
});

app.all("/api/auth/*", async (c) => {
  if (await isRateLimited(c.env, `auth:${requestIp(c)}`, c.env.AUTH_RATE_LIMIT_PER_MINUTE)) {
    return jsonError(c, 429, "RATE_LIMITED", "Too many sign-in attempts. Try again shortly.");
  }
  return createAuth(c.env, trustedAuthOrigin(c.env, c.req.url)).handler(c.req.raw);
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

app.get("/api/v1/chapters", async (c) => {
  const chapters = await c.env.DB.select({
    id: schema.chapters.id,
    name: schema.chapters.name,
    shortCode: schema.chapters.shortCode,
  })
    .from(schema.chapters)
    .where(eq(schema.chapters.active, true))
    .orderBy(asc(schema.chapters.name));
  return c.json(chapters);
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
  const availableAssets = await findAvailableAssets(
    c.env.CLIENT as unknown as SqlExecutor,
    item[0].id,
    pickupAt,
    returnAt
  );
  return c.json({ availableQuantity: availableAssets.length });
});

app.use("/api/v1/reservations", requireUser);
app.use("/api/v1/reservations/*", requireUser);

const createReservationSchema = z
  .object({
    borrowerType: z.enum(["PERSON", "CHAPTER"]),
    chapterId: z.string().min(1).optional(),
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
  return c.json(await cancelReservation(c.env, c.get("actor"), c.req.param("id")));
});

app.get("/api/v1/notifications", async (c) => {
  const actor = await resolveIdentity(c);
  if (!actor) return jsonError(c, 401, "UNAUTHENTICATED", "Sign in to continue.");
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
    .limit(100);
  return c.json(notifications);
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
app.get("/api/v1/board/reservations", async (c) => c.json(await listBoardReservations(c.env)));

app.get("/api/v1/board/reservations/:id", async (c) => {
  const reservation = await getReservation(c.env, c.req.param("id"), true);
  if (!reservation) return jsonError(c, 404, "NOT_FOUND", "Reservation not found.");
  const candidates = await Promise.all(
    reservation.items.map(async (item) => ({
      lineId: item.lineId,
      assets:
        reservation.status === "PENDING"
          ? (
              await findAvailableAssets(
                c.env.CLIENT as unknown as SqlExecutor,
                item.equipmentItemId,
                Date.parse(reservation.pickupAt),
                Date.parse(reservation.returnAt)
              )
            ).map((asset) => ({
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
  return c.json(await cancelReservation(c.env, c.get("actor"), c.req.param("id"), true));
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
    .object({ qrToken: z.string().min(1).max(256) })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return jsonError(c, 400, "INVALID_ASSET", "This QR code is not valid.");
  const idempotencyKey = c.req.header("Idempotency-Key") ?? "";
  return c.json(await scanAsset(c.env, actor, parsed.data.qrToken, idempotencyKey));
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
  const result = await c.env.DB.update(schema.equipmentItems)
    .set({ active: parsed.data.active, updatedAt: Date.now() })
    .where(eq(schema.equipmentItems.id, c.req.param("id")));
  if (!result.rowsAffected) return jsonError(c, 404, "NOT_FOUND", "Equipment not found.");
  await c.env.CLIENT.execute({
    sql: "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES(?,?,?,?,?,?,?)",
    args: [
      randomId("audit"),
      c.get("actor").id,
      "EQUIPMENT",
      c.req.param("id"),
      parsed.data.active ? "EQUIPMENT_ACTIVATED" : "EQUIPMENT_DISABLED",
      Date.now(),
      JSON.stringify({ active: parsed.data.active }),
    ],
  });
  return c.json({ ok: true });
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
  const asset = await c.env.DB.select({ state: schema.assets.state, active: schema.assets.active })
    .from(schema.assets)
    .where(eq(schema.assets.id, c.req.param("id")))
    .limit(1);
  if (!asset[0]) return jsonError(c, 404, "NOT_FOUND", "Asset not found.");
  if (asset[0].state === "BORROWED" || asset[0].state === "RESERVED")
    return jsonError(
      c,
      409,
      "RESERVATION_CONFLICT",
      "Return or release the asset before changing its state."
    );
  if (asset[0].state === "RETIRED" && parsed.data.state !== "RETIRED")
    return jsonError(c, 409, "INVALID_ASSET", "Retired assets cannot be restored.");
  await c.env.DB.update(schema.assets)
    .set({
      state: parsed.data.state,
      active: parsed.data.state !== "RETIRED",
      updatedAt: Date.now(),
    })
    .where(eq(schema.assets.id, c.req.param("id")));
  await c.env.CLIENT.execute({
    sql: "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES(?,?,?,?,?,?,?)",
    args: [
      randomId("audit"),
      c.get("actor").id,
      "ASSET",
      c.req.param("id"),
      parsed.data.state === "RETIRED" ? "ASSET_DISABLED" : "ASSET_STATE_CHANGED",
      Date.now(),
      JSON.stringify({ state: parsed.data.state }),
    ],
  });
  return c.json({ ok: true });
});

app.get("/api/v1/board/chapters", async (c) => {
  const chapters = await c.env.DB.select().from(schema.chapters).orderBy(asc(schema.chapters.name));
  return c.json(chapters);
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

app.get("/api/v1/board/users", requireSuperadmin, async (c) => {
  const users = await c.env.DB.select({
    id: schema.authUsers.id,
    name: schema.authUsers.name,
    email: schema.authUsers.email,
    role: schema.authUsers.role,
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
    })
    .strict()
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return jsonError(c, 400, "VALIDATION", "Enter a name, email, and valid Board role.");
  const userId = randomId("user");
  const timestamp = Date.now();
  await c.env.CLIENT.execute({
    sql: "INSERT INTO user(id,name,email,emailVerified,role,createdAt,updatedAt) VALUES(?,?,?,0,?,?,?)",
    args: [
      userId,
      parsed.data.name,
      parsed.data.email.toLowerCase(),
      parsed.data.role,
      timestamp,
      timestamp,
    ],
  });
  await c.env.CLIENT.execute({
    sql: "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES(?,?,?,?,?,?,?)",
    args: [
      randomId("audit"),
      c.get("actor").id,
      "USER",
      userId,
      "ROLE_CHANGED",
      timestamp,
      JSON.stringify({ role: parsed.data.role, email: parsed.data.email.toLowerCase() }),
    ],
  });
  return c.json(
    {
      id: userId,
      name: parsed.data.name,
      email: parsed.data.email.toLowerCase(),
      role: parsed.data.role,
      emailVerified: false,
    },
    201
  );
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

app.get("/api/v1/board/audit", async (c) => c.json(await listBoardAudit(c.env)));

app.notFound((c) => jsonError(c, 404, "NOT_FOUND", "API endpoint not found."));

export default app;
