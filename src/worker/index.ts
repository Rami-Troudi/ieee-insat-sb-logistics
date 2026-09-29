import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { requestId } from "hono/request-id";
import type { AppUser, D1PreparedStatement, Env } from "./env";
import { dispatchBoardRpc } from "./board-rpc";
import { createAuth, trustedAuthOrigin } from "./auth";
import { requireBoard, requireMember, resolveIdentity } from "./identity";
import { digest, jsonError, rateLimit, sameOrigin, verifyTurnstile } from "./security";

type Vars = { actor: AppUser };
export const app = new Hono<{ Bindings: Env; Variables: Vars }>();
const now = () => Date.now();
const iso = (time = now()) => new Date(time).toISOString();
const uuid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const parseJson = <T>(value: string): T => JSON.parse(value) as T;
app.use("*", requestId());
app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://challenges.cloudflare.com"],
      frameSrc: ["https://challenges.cloudflare.com"],
      connectSrc: ["'self'", "https://challenges.cloudflare.com"],
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
    permissionsPolicy: { camera: false, microphone: false, geolocation: false },
  })
);
app.use("/api/*", sameOrigin);
app.use("/api/*", async (c, next) => {
  const key = c.req.header("CF-Connecting-IP") ?? "unknown";
  const decision = await c.env.API_RATE_LIMITER.limit({ key });
  if (!decision.success)
    return jsonError(c, 429, "RATE_LIMITED", "Too many requests; slow down and try again");
  c.header("Cache-Control", "no-store");
  c.header("X-Request-Id", c.get("requestId"));
  await next();
});
app.use(
  "/api/*",
  bodyLimit({
    maxSize: 64 * 1024,
    onError: (c) => jsonError(c, 413, "BODY_TOO_LARGE", "Request body is too large"),
  })
);

// Hobby Cron runs at most once daily. Release due stock on catalogue reads too,
// so an overdue allocation never stays unavailable while waiting for maintenance.
app.use("/api/v1/catalog*", async (c, next) => {
  await expireAllocations(c.env);
  await next();
});
app.use("/api/v1/board/inventory", async (c, next) => {
  await expireAllocations(c.env);
  await next();
});

app.onError((error, c) => {
  const requestIdValue = c.get("requestId");
  // Do not log request bodies, identities, tokens, or provider responses.
  console.error("request_failed", { requestId: requestIdValue, type: error.name });
  return jsonError(c, 500, "INTERNAL", "The request could not be completed");
});

app.get("/api/health", (c) => c.json({ status: "ok" }));
app.get("/api/v1/config", (c) => c.json({ turnstileSiteKey: c.env.TURNSTILE_SITE_KEY }));

app.get("/api/cron/maintenance", async (c) => {
  const expected = c.env.CRON_SECRET;
  const received = c.req.header("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected)
    return jsonError(c, 503, "MAINTENANCE_DISABLED", "Scheduled maintenance is not configured");
  if (!timingSafeEqual(received, expected))
    return jsonError(c, 401, "UNAUTHENTICATED", "Scheduled maintenance authorization failed");
  await expireAllocations(c.env);
  await cleanExpiredSecurityData(c.env);
  return c.json({ ok: true });
});

app.all("/api/auth/*", async (c) => {
  const pathname = new URL(c.req.url).pathname;
  if (c.req.method === "POST" && pathname.endsWith("/sign-in/magic-link")) {
    const workerLimit = await c.env.AUTH_RATE_LIMITER.limit({
      key: c.req.header("CF-Connecting-IP") ?? "unknown",
    });
    if (!workerLimit.success)
      return jsonError(c, 429, "RATE_LIMITED", "Too many sign-in attempts; try again later");
    const body = (await c.req.raw
      .clone()
      .json()
      .catch(() => ({}))) as { email?: string; callbackURL?: string; turnstileToken?: string };
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "invalid";
    const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
    if (!(await rateLimit(c.env.DB, `magic:${email}:${ip}`, 3, 3600)))
      return jsonError(
        c,
        429,
        "RATE_LIMITED",
        "Please wait before requesting another sign-in link"
      );
    if (
      !(await verifyTurnstile(c.env, body.turnstileToken, ip, trustedAuthOrigin(c.env, c.req.url)))
    )
      return jsonError(c, 403, "CHALLENGE_FAILED", "Complete the security check and try again");
    const callback = body.callbackURL;
    if (callback) {
      try {
        if (new URL(callback).origin !== trustedAuthOrigin(c.env, c.req.url))
          return jsonError(c, 400, "VALIDATION", "Invalid sign-in destination");
      } catch {
        return jsonError(c, 400, "VALIDATION", "Invalid sign-in destination");
      }
    }
    const allowed = await c.env.DB.prepare(
      `SELECT user.id FROM user INNER JOIN app_users ON app_users.id=user.id
      WHERE user.email=? COLLATE NOCASE AND app_users.role IN ('OPERATOR','SUPERADMIN') AND app_users.status='ACTIVE'`
    )
      .bind(email)
      .first();
    if (!allowed) return c.json({ status: true }, 200);
  }
  return createAuth(c.env, trustedAuthOrigin(c.env, c.req.url)).handler(c.req.raw);
});

app.post("/api/v1/auth/borrower", async (c) => {
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  const rateDecision = await c.env.AUTH_RATE_LIMITER.limit({ key: `borrower-auth:${ip}` });
  if (!rateDecision.success)
    return jsonError(c, 429, "RATE_LIMITED", "Too many authentication attempts; try again later");

  const body = await c.req
    .json<{
      firstName?: string;
      lastName?: string;
      name?: string;
      email?: string;
      phone?: string;
      membership?: string;
    }>()
    .catch(() => null);

  if (
    !body ||
    typeof body.email !== "string" ||
    !/^\S+@\S+\.\S+$/.test(body.email.trim()) ||
    typeof body.name !== "string" ||
    body.name.trim().length < 3 ||
    body.name.length > 120
  )
    return jsonError(c, 400, "VALIDATION", "Valid member details are required");

  const email = body.email.trim().toLowerCase();
  const name = body.name.trim();
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const membership = ["IEEE", "AEROBOTIX", "EXTERNAL"].includes(body.membership ?? "")
    ? body.membership!
    : "EXTERNAL";
  const timestamp = now();

  let user = await c.env.DB.prepare("SELECT * FROM app_users WHERE email=? COLLATE NOCASE")
    .bind(email)
    .first<AppUser>();

  const existing = await c.env.DB.prepare("SELECT * FROM app_users WHERE email=? COLLATE NOCASE")
    .bind(email)
    .first<AppUser>();

  if (!existing) {
    const userId = `borrower-${await digest(email)}`;
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,?,?)"
      ).bind(userId, name, email, timestamp, timestamp),
      c.env.DB.prepare(
        "INSERT INTO app_users(id,email,name,phone,role,clearance,affiliation,claimed_affiliation,affiliation_verified,status,data,created_at,updated_at) VALUES(?,?,?,?,'MEMBER','I','EXTERNAL',?,0,'ACTIVE','{}',?,?)"
      ).bind(userId, email, name, phone, membership, timestamp, timestamp),
    ]);
  } else {
    await c.env.DB.prepare(
      "UPDATE app_users SET name=?,phone=?,claimed_affiliation=?,updated_at=? WHERE id=?"
    ).bind(name, phone, membership, timestamp, existing.id).run();
  }

  const origin = trustedAuthOrigin(c.env, c.req.url);
  try {
    await createAuth(c.env, origin).api.signInMagicLink({
      body: { email, name, callbackURL: `${origin}/app` },
      headers: c.req.raw.headers,
    });
  } catch {
    return jsonError(c, 503, "AUTH_UNAVAILABLE", "The sign-in link could not be sent");
  }

  user = await c.env.DB.prepare("SELECT * FROM app_users WHERE email=? COLLATE NOCASE")
    .bind(email)
    .first<AppUser>();
  if (!user) return jsonError(c, 500, "INTERNAL", "Member account could not be loaded");

  return c.json({
    ok: true,
    magicLinkSent: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      clearance: user.clearance,
      affiliation: user.affiliation,
      isProcessed: user.affiliation_verified === 1,
      status: user.status,
      strikesCount: 0,
    },
  }, 202);
});

app.post("/api/v1/staff/challenge", async (c) => {
  const actor = await resolveIdentity(c);
  if (!actor || !["OPERATOR", "SUPERADMIN"].includes(actor.role) || actor.status !== "ACTIVE")
    return jsonError(c, 403, "FORBIDDEN", "Board access is not enabled for this account");
  const email = actor.email;
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  if (!(await rateLimit(c.env.DB, `staff-code:${actor.id}:${ip}`, 3, 3600)))
    return jsonError(c, 429, "RATE_LIMITED", "Please wait before requesting another code");
  const entropy = new Uint32Array(1);
  let value: number;
  do {
    crypto.getRandomValues(entropy);
    value = entropy[0];
  } while (value >= Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000);
  const code = String(value % 1_000_000).padStart(6, "0");
  const codeHash = await otpHash(c.env, actor.id, code);
  const created = now();
  await c.env.DB.prepare(
    "INSERT INTO staff_challenges(id,user_id,code_hash,expires_at,attempts,created_at) VALUES(?,?,?,?,0,?)"
  )
    .bind(crypto.randomUUID(), actor.id, codeHash, created + 10 * 60_000, created)
    .run();
  await sendStaffCode(c.env, email, code);
  return c.json(
    { ok: true, message: "A verification code has been sent to your staff email." },
    202
  );
});

app.get("/api/v1/board/session", async (c) => {
  const actor = await resolveIdentity(c);
  if (!actor || !["OPERATOR", "SUPERADMIN"].includes(actor.role) || actor.status !== "ACTIVE")
    return jsonError(c, 403, "FORBIDDEN", "Board access is not enabled for this account");
  const session = await c.env.DB.prepare(
    "SELECT expires_at,fresh_until,revoked_at FROM staff_sessions WHERE user_id=?"
  )
    .bind(actor.id)
    .first<{ expires_at: number; fresh_until: number; revoked_at: number | null }>();
  return c.json({
    active: Boolean(session && !session.revoked_at && session.expires_at > now()),
    fresh: Boolean(session && !session.revoked_at && session.fresh_until > now()),
    expiresAt: session?.expires_at ?? null,
    freshUntil: session?.fresh_until ?? null,
  });
});

app.post("/api/v1/staff/verify", async (c) => {
  const actor = await resolveIdentity(c);
  if (!actor || !["OPERATOR", "SUPERADMIN"].includes(actor.role) || actor.status !== "ACTIVE")
    return jsonError(c, 403, "FORBIDDEN", "Board access is not enabled for this account");
  const body = await c.req.json<{ code?: string }>().catch(() => null);
  if (!body || !/^\d{6}$/.test(body.code ?? ""))
    return jsonError(c, 400, "VALIDATION", "Enter the six-digit code");
  const challenge = await c.env.DB.prepare(
    `SELECT id,code_hash,expires_at,attempts FROM staff_challenges
    WHERE user_id=? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`
  )
    .bind(actor.id)
    .first<{ id: string; code_hash: string; expires_at: number; attempts: number }>();
  if (!challenge || challenge.expires_at <= now() || challenge.attempts >= 5)
    return jsonError(c, 401, "CHALLENGE_EXPIRED", "Request a new verification code");
  const hash = await otpHash(c.env, actor.id, body.code ?? "");
  if (!timingSafeEqual(hash, challenge.code_hash)) {
    await c.env.DB.prepare(
      "UPDATE staff_challenges SET attempts=attempts+1 WHERE id=? AND attempts<5"
    )
      .bind(challenge.id)
      .run();
    return jsonError(c, 401, "CHALLENGE_INVALID", "The code is incorrect or expired");
  }
  const timestamp = now();
  const batch = await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE staff_challenges SET consumed_at=? WHERE id=? AND consumed_at IS NULL AND attempts<5"
    ).bind(timestamp, challenge.id),
    c.env.DB.prepare(
      `INSERT INTO staff_sessions(user_id,expires_at,fresh_until,revoked_at) VALUES(?,?,?,NULL)
      ON CONFLICT(user_id) DO UPDATE SET expires_at=excluded.expires_at,fresh_until=excluded.fresh_until,revoked_at=NULL`
    ).bind(actor.id, timestamp + 8 * 60 * 60_000, timestamp + 10 * 60_000),
  ]);
  if (!batch[0]?.success) return jsonError(c, 409, "CONFLICT", "The code was already used");
  return c.json({ ok: true, expiresAt: timestamp + 8 * 60 * 60_000 });
});

app.post("/api/v1/staff/revoke", async (c) => {
  const actor = await requireBoard(c, true);
  if (!actor) return jsonError(c, 403, "FORBIDDEN", "Fresh board verification is required");
  const body = (await c.req.json().catch(() => ({}))) as { userId?: string };
  if (actor.role !== "SUPERADMIN" || !body.userId)
    return jsonError(c, 403, "FORBIDDEN", "Superadmin access is required");
  await c.env.DB.prepare("UPDATE staff_sessions SET revoked_at=? WHERE user_id=?")
    .bind(now(), body.userId)
    .run();
  return c.json({ ok: true });
});

app.post("/api/v1/board/users/invite", async (c) => {
  const actor = await requireBoard(c, true);
  if (!actor || actor.role !== "SUPERADMIN")
    return jsonError(c, 403, "FORBIDDEN", "Fresh superadmin verification is required");
  const body = (await c.req.json().catch(() => null)) as { email?: unknown; name?: unknown } | null;
  if (
    !body ||
    typeof body.email !== "string" ||
    body.email.length > 254 ||
    !/^\S+@\S+\.\S+$/.test(body.email) ||
    typeof body.name !== "string" ||
    body.name.trim().length < 3 ||
    body.name.length > 120
  )
    return jsonError(c, 400, "VALIDATION", "Enter the operator name and email");
  const email = body.email.trim().toLowerCase();
  const current = await c.env.DB.prepare(
    "SELECT id,role FROM app_users WHERE email=? COLLATE NOCASE"
  )
    .bind(email)
    .first<{ id: string; role: string }>();
  if (current) return jsonError(c, 409, "CONFLICT", "An account already exists for this email");
  const id = crypto.randomUUID();
  const timestamp = now();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,0,?,?)"
      ).bind(id, body.name.trim(), email, timestamp, timestamp),
      c.env.DB.prepare(
        `INSERT INTO app_users(id,email,name,role,clearance,clearance_source,affiliation,claimed_affiliation,affiliation_verified,status,data,created_at,updated_at)
        VALUES(?,?,?,'OPERATOR','V','OPERATOR_ROLE','RAS_BOARD','RAS_BOARD',1,'ACTIVE','{}',?,?)`
      ).bind(id, email, body.name.trim(), timestamp, timestamp),
      c.env.DB.prepare(
        "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES(?,?,?,?,?,?,?)"
      ).bind(
        uuid("audit"),
        actor.id,
        "USER",
        id,
        "OPERATOR_INVITED",
        timestamp,
        JSON.stringify({ email })
      ),
    ]);
    const origin = trustedAuthOrigin(c.env, c.req.url);
    await createAuth(c.env, origin).api.signInMagicLink({
      body: { email, name: body.name.trim(), callbackURL: `${origin}/board` },
      headers: c.req.raw.headers,
    });
  } catch {
    return jsonError(
      c,
      503,
      "INVITE_UNAVAILABLE",
      "The operator record was created but the sign-in email could not be sent; ask the operator to request a sign-in link"
    );
  }
  return c.json({ ok: true }, 202);
});

app.get("/api/v1/me", async (c) => {
  const user = await resolveIdentity(c);
  if (!user) return jsonError(c, 401, "UNAUTHENTICATED", "Sign in to continue");
  const strikes = await c.env.DB.prepare(
    "SELECT COUNT(*) AS count FROM record_store WHERE kind='strike' AND owner_id=? AND status='ACTIVE'"
  )
    .bind(user.id)
    .first<{ count: number }>();
  return c.json({
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone ?? undefined,
    role: user.role,
    clearance: user.clearance,
    affiliation: user.affiliation,
    claimedAffiliation: user.claimed_affiliation,
    affiliationVerified: user.affiliation_verified === 1,
    isProcessed: user.affiliation_verified === 1 || user.role !== "MEMBER",
    status: user.status,
    strikesCount: strikes?.count ?? 0,
  });
});

app.get("/api/v1/catalog", async (c) => {
  const search = (c.req.query("search") ?? "").trim().slice(0, 100).toLowerCase();
  const category = (c.req.query("category") ?? "").trim().slice(0, 80);
  const rows = await c.env.DB.prepare(
    `SELECT id,name,category,equipment_class,available_quantity,total_quantity,borrower_visible,data
    FROM inventory WHERE borrower_visible=1 ORDER BY name LIMIT 500`
  ).all<{
    id: string;
    name: string;
    category: string;
    equipment_class: string;
    available_quantity: number;
    total_quantity: number;
    borrower_visible: number;
    data: string;
  }>();
  const items = (rows.results ?? [])
    .filter(
      (row) =>
        row.total_quantity > 0 &&
        row.borrower_visible &&
        (!category || row.category === category) &&
        (!search ||
          row.name.toLowerCase().includes(search) ||
          row.category.toLowerCase().includes(search))
    )
    .map((row) => ({
      id: row.id,
      name: row.name,
      description: (parseJson<{ description?: string }>(row.data).description ?? "").slice(0, 2000),
      category: row.category,
      imageUrl: safeImage(parseJson<{ imageUrl?: string }>(row.data).imageUrl),
      availability:
        row.available_quantity > 3
          ? "AVAILABLE"
          : row.available_quantity > 0
            ? "LIMITED"
            : "UNAVAILABLE",
      action: row.available_quantity > 0 ? "REQUEST" : "NONE",
    }));
  const availableOnly = c.req.query("availableOnly") === "true";
  return c.json(
    availableOnly ? items.filter((item) => item.availability !== "UNAVAILABLE") : items
  );
});

app.get("/api/v1/catalog/:id", async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT id,name,category,equipment_class,available_quantity,total_quantity,borrower_visible,data
    FROM inventory WHERE id=?`
  )
    .bind(c.req.param("id"))
    .first<{
      id: string;
      name: string;
      category: string;
      equipment_class: string;
      available_quantity: number;
      total_quantity: number;
      borrower_visible: number;
      data: string;
    }>();
  if (!row || !row.borrower_visible || row.total_quantity < 1)
    return jsonError(c, 404, "NOT_FOUND", "Catalogue item not found");
  const data = parseJson<any>(row.data);
  return c.json({
    id: row.id,
    name: row.name,
    description: String(data.description ?? "").slice(0, 2000),
    category: row.category,
    imageUrl: safeImage(data.imageUrl),
    ...(data.datasheetUrl ? { datasheetUrl: safeImage(data.datasheetUrl) } : {}),
    availability:
      row.available_quantity > 3
        ? "AVAILABLE"
        : row.available_quantity > 0
          ? "LIMITED"
          : "UNAVAILABLE",
    action: ["C", "E"].includes(row.equipment_class)
      ? row.available_quantity > 0
        ? "REQUEST"
        : "NONE"
      : "ASK_OPERATOR",
  });
});

app.get("/api/v1/profile", async (c) => {
  const actor = await resolveIdentity(c);
  if (!actor) return jsonError(c, 401, "UNAUTHENTICATED", "Sign in to continue");
  const [requestCount, activeLoans, strikeRows] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) AS count FROM requests WHERE user_id=?")
      .bind(actor.id)
      .first<{ count: number }>(),
    c.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM record_store WHERE kind='loan' AND owner_id=? AND status IN ('ACTIVE','OVERDUE')"
    )
      .bind(actor.id)
      .first<{ count: number }>(),
    c.env.DB.prepare(
      "SELECT data FROM record_store WHERE kind='strike' AND owner_id=? ORDER BY updated_at DESC LIMIT 100"
    )
      .bind(actor.id)
      .all<{ data: string }>(),
  ]);
  const strikes = (strikeRows.results ?? []).map((row) => parseJson<any>(row.data));
  return c.json({
    id: actor.id,
    name: actor.name,
    email: actor.email,
    phone: actor.phone ?? "",
    role: actor.role,
    clearance: actor.clearance,
    affiliation: actor.affiliation,
    claimedAffiliation: actor.claimed_affiliation ?? undefined,
    verifiedAffiliation: actor.affiliation_verified ? actor.affiliation : undefined,
    clearanceSource: actor.clearance_source ?? undefined,
    isProcessed: actor.affiliation_verified === 1,
    status: actor.status,
    strikesCount: strikes.filter((s) => s.status === "ACTIVE").length,
    strikes: strikes.map((s) => ({
      id: s.id,
      date: s.issuedAt,
      reason: s.reason,
      severity: s.level >= 4 ? "SUSPENSION" : s.level >= 2 ? "RESTRICTION" : "WARNING",
      resolved: s.status !== "ACTIVE",
      level: s.level,
    })),
    joinedDate: iso(actor.created_at ?? now()),
    activeLoansCount: activeLoans?.count ?? 0,
    totalRequestsCount: requestCount?.count ?? 0,
  });
});

app.patch("/api/v1/profile", async (c) => {
  const actor = await resolveIdentity(c);
  if (!actor) return jsonError(c, 401, "UNAUTHENTICATED", "Sign in to continue");
  const body = (await c.req.json().catch(() => null)) as { phone?: unknown } | null;
  if (
    !body ||
    (body.phone !== undefined &&
      (typeof body.phone !== "string" || body.phone.length < 8 || body.phone.length > 40))
  )
    return jsonError(c, 400, "VALIDATION", "Contact information is invalid");
  if (body.phone !== undefined)
    await c.env.DB.prepare("UPDATE app_users SET phone=?,updated_at=? WHERE id=?")
      .bind(body.phone.trim(), now(), actor.id)
      .run();
  return c.json({ ...actor, phone: body.phone === undefined ? actor.phone : body.phone.trim() });
});

app.get("/api/v1/loans", async (c) => {
  const actor = await requireMember(c);
  if (!actor) return jsonError(c, 401, "UNAUTHENTICATED", "Sign in to continue");
  const rows = await c.env.DB.prepare(
    "SELECT data FROM record_store WHERE kind='loan' AND owner_id=? ORDER BY updated_at DESC LIMIT 200"
  )
    .bind(actor.id)
    .all<{ data: string }>();
  return c.json((rows.results ?? []).map((row) => parseJson(row.data)));
});
app.get("/api/v1/loans/:id", async (c) => {
  const actor = await requireMember(c);
  if (!actor) return jsonError(c, 401, "UNAUTHENTICATED", "Sign in to continue");
  const row = await c.env.DB.prepare(
    "SELECT data FROM record_store WHERE kind='loan' AND id=? AND owner_id=?"
  )
    .bind(c.req.param("id"), actor.id)
    .first<{ data: string }>();
  return row ? c.json(parseJson(row.data)) : jsonError(c, 404, "NOT_FOUND", "Loan not found");
});

app.get("/api/v1/notifications", async (c) => {
  const actor = await resolveIdentity(c);
  if (!actor) return jsonError(c, 401, "UNAUTHENTICATED", "Sign in to continue");
  const rows = await c.env.DB.prepare(
    "SELECT data FROM record_store WHERE kind='notification' AND owner_id=? ORDER BY updated_at DESC LIMIT 200"
  )
    .bind(actor.id)
    .all<{ data: string }>();
  return c.json((rows.results ?? []).map((row) => parseJson(row.data)));
});
app.patch("/api/v1/notifications/:id", async (c) => {
  const actor = await resolveIdentity(c);
  if (!actor) return jsonError(c, 401, "UNAUTHENTICATED", "Sign in to continue");
  const row = await c.env.DB.prepare(
    "SELECT data FROM record_store WHERE kind='notification' AND id=? AND owner_id=?"
  )
    .bind(c.req.param("id"), actor.id)
    .first<{ data: string }>();
  if (!row) return jsonError(c, 404, "NOT_FOUND", "Notification not found");
  const notification = parseJson<any>(row.data);
  notification.read = true;
  await c.env.DB.prepare(
    "UPDATE record_store SET status='READ',data=?,updated_at=? WHERE kind='notification' AND id=? AND owner_id=?"
  )
    .bind(JSON.stringify(notification), now(), notification.id, actor.id)
    .run();
  return c.body(null, 204);
});
app.post("/api/v1/notifications/read-all", async (c) => {
  const actor = await resolveIdentity(c);
  if (!actor) return jsonError(c, 401, "UNAUTHENTICATED", "Sign in to continue");
  const rows = await c.env.DB.prepare(
    "SELECT id,data FROM record_store WHERE kind='notification' AND owner_id=? AND status<>'READ' LIMIT 500"
  )
    .bind(actor.id)
    .all<{ id: string; data: string }>();
  await c.env.DB.batch(
    (rows.results ?? []).map((row) => {
      const value = parseJson<any>(row.data);
      value.read = true;
      return c.env.DB.prepare(
        "UPDATE record_store SET status='READ',data=?,updated_at=? WHERE kind='notification' AND id=? AND owner_id=?"
      ).bind(JSON.stringify(value), now(), row.id, actor.id);
    })
  );
  return c.body(null, 204);
});

app.get("/api/v1/projects", async (c) => {
  const actor = await requireMember(c);
  if (!actor) return jsonError(c, 401, "UNAUTHENTICATED", "Sign in to continue");
  const rows = await c.env.DB.prepare(
    "SELECT data FROM record_store WHERE kind='project' AND status='ACTIVE' ORDER BY updated_at DESC LIMIT 200"
  ).all<{ data: string }>();
  return c.json((rows.results ?? []).map((row) => parseJson(row.data)));
});
app.get("/api/v1/projects/mine", async (c) => {
  const actor = await requireMember(c);
  if (!actor) return jsonError(c, 401, "UNAUTHENTICATED", "Sign in to continue");
  const rows = await c.env.DB.prepare(
    "SELECT data FROM record_store WHERE kind='project' AND status='ACTIVE' ORDER BY updated_at DESC LIMIT 200"
  ).all<{ data: string }>();
  return c.json(
    (rows.results ?? [])
      .map((row) => parseJson<any>(row.data))
      .filter((project) => Array.isArray(project.memberIds) && project.memberIds.includes(actor.id))
  );
});

app.get("/api/v1/requests", async (c) => {
  const actor = await requireMember(c);
  if (!actor) return jsonError(c, 401, "UNAUTHENTICATED", "Sign in to continue");
  const rows = await c.env.DB.prepare(
    "SELECT data FROM requests WHERE user_id=? ORDER BY created_at DESC LIMIT 200"
  )
    .bind(actor.id)
    .all<{ data: string }>();
  return c.json((rows.results ?? []).map((row) => parseJson(row.data)));
});

app.get("/api/v1/requests/:id", async (c) => {
  const actor = await requireMember(c);
  if (!actor) return jsonError(c, 401, "UNAUTHENTICATED", "Sign in to continue");
  const row = await c.env.DB.prepare("SELECT data FROM requests WHERE id=? AND user_id=?")
    .bind(c.req.param("id"), actor.id)
    .first<{ data: string }>();
  if (!row) return jsonError(c, 404, "NOT_FOUND", "Request not found");
  return c.json(parseJson(row.data));
});

app.post("/api/v1/requests", async (c) => {
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  const abuse = await c.env.AUTH_RATE_LIMITER.limit({ key: `borrow-request:${ip}` });
  if (!abuse.success)
    return jsonError(
      c,
      429,
      "RATE_LIMITED",
      "Too many requests from this connection; try again later"
    );
  const idempotencyKey = c.req.header("Idempotency-Key");
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 128)
    return jsonError(c, 400, "VALIDATION", "A valid idempotency key is required");
  const body = await c.req
    .json<{
      contactEmail?: string;
      items?: { itemId: string; quantity: number }[];
      note?: string;
      expectedReturnDate?: string;
      borrowerName?: string;
      borrowerPhone?: string;
      borrowerAffiliation?: string;
    }>()
    .catch(() => null);
  if (
    !body ||
    !Array.isArray(body.items) ||
    body.items.length < 1 ||
    body.items.length > 40 ||
    new Set(body.items.map((item) => item?.itemId)).size !== body.items.length ||
    body.items.some(
      (item) =>
        !item ||
        typeof item.itemId !== "string" ||
        item.itemId.length > 100 ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > 99
    ) ||
    typeof body.contactEmail !== "string" ||
    body.contactEmail.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.contactEmail.trim()) ||
    typeof body.expectedReturnDate !== "string" ||
    !Number.isFinite(Date.parse(body.expectedReturnDate)) ||
    (body.note !== undefined && (typeof body.note !== "string" || body.note.length > 2000))
  )
    return jsonError(c, 400, "VALIDATION", "The request details are invalid");
  const email = body.contactEmail.trim().toLowerCase();
  const emailLimit = await rateLimit(c.env.DB, `borrower-request:${email}`, 5, 3600);
  if (!emailLimit)
    return jsonError(
      c,
      429,
      "RATE_LIMITED",
      "Too many requests for this contact email; try again later"
    );
  const existing = await c.env.DB.prepare(
    "SELECT id,name,clearance FROM app_users WHERE email=? COLLATE NOCASE"
  )
    .bind(email)
    .first<{ id: string; name: string; clearance: string }>();
  const borrowerId = existing?.id ?? `borrower-${await digest(email)}`;
  const borrowerName = body.borrowerName?.trim() || existing?.name || "Unverified borrower";
  const key = await digest(`${borrowerId}:${idempotencyKey}`);
  const replay = await c.env.DB.prepare(
    "SELECT response FROM idempotency_keys WHERE key=? AND actor_id=?"
  )
    .bind(key, borrowerId)
    .first<{ response: string }>();
  if (replay) return c.json(parseJson(replay.response));
  const requestedItems = await Promise.all(
    body.items.map(async (line) => {
      const item = await c.env.DB.prepare(
        "SELECT id,name,category,equipment_class,available_quantity,borrower_visible FROM inventory WHERE id=?"
      )
        .bind(line.itemId)
        .first<{
          id: string;
          name: string;
          category: string;
          equipment_class: string;
          available_quantity: number;
          borrower_visible: number;
        }>();
      if (
        !item ||
        !item.borrower_visible ||
        item.available_quantity < 1
      )
        throw new Error("INELIGIBLE_ITEM");
      const isRestricted = !["C", "E"].includes(item.equipment_class);
      const flagReason = isRestricted
        ? `Class restriction: Class ${item.equipment_class} requires manual board approval`
        : undefined;
      return {
        itemId: item.id,
        itemName: item.name,
        category: item.category,
        equipmentClass: item.equipment_class,
        requestedQuantity: line.quantity,
        approvedQuantity: 0,
        handedOverQuantity: 0,
        returnedQuantity: 0,
        damagedQuantity: 0,
        lostQuantity: 0,
        status: "PENDING",
        flagged: isRestricted,
        ...(flagReason ? { flagReason } : {}),
      };
    })
  ).catch(() => null);
  if (!requestedItems)
    return jsonError(
      c,
      400,
      "INELIGIBLE_ITEM",
      "One or more requested items are currently unavailable or not in catalogue"
    );
  const id = uuid("REQ");
  const createdAt = iso();
  const request = {
    id,
    userId: borrowerId,
    userName: borrowerName,
    userEmail: email,
    contactEmailVerified: false,
    userClearance: existing?.clearance ?? "I",
    ...(body.note?.trim() ? { note: body.note.trim() } : {}),
    expectedReturnDate: body.expectedReturnDate,
    decisionStatus: "PENDING",
    handoverStatus: "WAITING",
    lifecycleStatus: "ACTIVE",
    status: "PENDING",
    flagged: requestedItems.some((line) => line.flagged),
    ...(requestedItems.some((line) => line.flagged)
      ? { flagReason: "One or more requested items require higher clearance" }
      : {}),
    items: requestedItems.map((line, index) => ({ ...line, id: `${id}-line-${index + 1}` })),
    createdAt,
    updatedAt: createdAt,
    timeline: [
      {
        status: "PENDING",
        timestamp: createdAt,
        description: requestedItems.some((line) => line.flagged)
          ? "Request sent with Level restriction flag. Waiting for logistics review."
          : "Request sent. Waiting for logistics review. Contact email and borrower identity are unverified.",
        actor: borrowerName,
      },
    ],
  };
  const affiliation = ["IEEE", "AEROBOTIX", "EXTERNAL"].includes(body.borrowerAffiliation ?? "")
    ? (body.borrowerAffiliation as string)
    : "EXTERNAL";
  const phone = body.borrowerPhone?.trim() || "";
  const clearance = existing?.clearance ?? "I";

  const statements = [
    ...(existing
      ? [
          c.env.DB.prepare(
            "UPDATE app_users SET name=COALESCE(NULLIF(?,''),name), phone=COALESCE(NULLIF(?,''),phone), claimed_affiliation=COALESCE(NULLIF(?,''),claimed_affiliation), updated_at=? WHERE id=?"
          ).bind(
            body.borrowerName?.trim() || "",
            phone,
            affiliation,
            Date.parse(createdAt),
            existing.id
          ),
        ]
      : [
          c.env.DB.prepare(
            "INSERT OR IGNORE INTO app_users(id,email,name,phone,role,clearance,affiliation,claimed_affiliation,affiliation_verified,status,data,created_at,updated_at) VALUES(?,?,?,?,'MEMBER',?,?,?,0,'PENDING','{}',?,?)"
          ).bind(
            borrowerId,
            email,
            borrowerName,
            phone,
            clearance,
            affiliation,
            affiliation,
            Date.parse(createdAt),
            Date.parse(createdAt)
          ),
        ]),
    c.env.DB.prepare(
      "INSERT INTO requests(id,user_id,status,created_at,data) VALUES(?,?,?,?,?)"
    ).bind(id, borrowerId, request.status, Date.parse(createdAt), JSON.stringify(request)),
    ...request.items.map((line) =>
      c.env.DB.prepare(
        "INSERT INTO request_lines(id,request_id,item_id,equipment_class,quantity,data) VALUES(?,?,?,?,?,?)"
      ).bind(
        line.id,
        id,
        line.itemId,
        line.equipmentClass,
        line.requestedQuantity,
        JSON.stringify(line)
      )
    ),
    c.env.DB.prepare(
      "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES(?,?,?,?,?,?,?)"
    ).bind(
      uuid("audit"),
      borrowerId,
      "REQUEST",
      id,
      "REQUEST_CREATED",
      Date.parse(createdAt),
      JSON.stringify({ id, itemCount: request.items.length })
    ),
    c.env.DB.prepare(
      "INSERT INTO idempotency_keys(key,actor_id,response,created_at) VALUES(?,?,?,?)"
    ).bind(key, borrowerId, JSON.stringify(request), now()),
  ];
  try {
    await c.env.DB.batch(statements);
  } catch {
    const retry = await c.env.DB.prepare(
      "SELECT response FROM idempotency_keys WHERE key=? AND actor_id=?"
    )
      .bind(key, borrowerId)
      .first<{ response: string }>();
    if (retry) return c.json(parseJson(retry.response));
    return jsonError(
      c,
      409,
      "CONFLICT",
      "Request could not be committed; verify your request and retry"
    );
  }
  return c.json(request, 201);
});

app.delete("/api/v1/requests/:id", async (c) => {
  const actor = await requireMember(c);
  if (!actor) return jsonError(c, 401, "UNAUTHENTICATED", "Sign in to continue");
  const row = await c.env.DB.prepare("SELECT data FROM requests WHERE id=? AND user_id=?")
    .bind(c.req.param("id"), actor.id)
    .first<{ data: string }>();
  if (!row) return jsonError(c, 404, "NOT_FOUND", "Request not found");
  const request = parseJson<any>(row.data);
  if (request.decisionStatus !== "PENDING" || request.lifecycleStatus !== "ACTIVE")
    return jsonError(c, 409, "CONFLICT", "Only pending requests can be cancelled");
  request.lifecycleStatus = "CANCELLED";
  request.status = "CANCELLED";
  request.updatedAt = iso();
  request.timeline.push({
    status: "CANCELLED",
    timestamp: request.updatedAt,
    description: "Request cancelled by member",
    actor: actor.name,
  });
  const batch = await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE requests SET status='CANCELLED',data=? WHERE id=? AND user_id=? AND status='PENDING'"
    ).bind(JSON.stringify(request), request.id, actor.id),
    c.env.DB.prepare(
      "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES(?,?,?,?,?,?,?)"
    ).bind(uuid("audit"), actor.id, "REQUEST", request.id, "REQUEST_CANCELLED", now(), "{}"),
  ]);
  if (!batch[0]?.meta?.changes)
    return jsonError(c, 409, "CONFLICT", "Request is no longer pending");
  return c.json(request);
});

app.get("/api/v1/board/requests", async (c) => {
  const actor = await requireBoard(c);
  if (!actor) return jsonError(c, 403, "FORBIDDEN", "Verified board access is required");
  const status = c.req.query("decisionStatus");
  const rows = await c.env.DB.prepare(
    `SELECT data FROM requests ${status && status !== "ALL" ? "WHERE status=?" : ""} ORDER BY created_at DESC LIMIT 500`
  )
    .bind(...(status && status !== "ALL" ? [status] : []))
    .all<{ data: string }>();
  return c.json((rows.results ?? []).map((row) => parseJson(row.data)));
});

app.get("/api/v1/board/requests/:id", async (c) => {
  const actor = await requireBoard(c);
  if (!actor) return jsonError(c, 403, "FORBIDDEN", "Verified board access is required");
  const row = await c.env.DB.prepare("SELECT data FROM requests WHERE id=?")
    .bind(c.req.param("id"))
    .first<{ data: string }>();
  return row ? c.json(parseJson(row.data)) : jsonError(c, 404, "NOT_FOUND", "Request not found");
});

app.post("/api/v1/board/inventory", async (c) => {
  const actor = await requireBoard(c, true);
  if (!actor) return jsonError(c, 403, "FORBIDDEN", "Fresh board verification is required");
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (
    !body ||
    typeof body.name !== "string" ||
    body.name.trim().length < 1 ||
    body.name.length > 160 ||
    typeof body.category !== "string" ||
    body.category.length > 80 ||
    !["A", "B", "C", "D", "E", "F", "G"].includes(String(body.equipmentClass)) ||
    !Number.isInteger(body.totalQuantity) ||
    Number(body.totalQuantity) < 0 ||
    Number(body.totalQuantity) > 100_000 ||
    !["QUANTITY", "INDIVIDUAL_ASSET"].includes(String(body.trackingMode ?? "QUANTITY"))
  )
    return jsonError(c, 400, "VALIDATION", "Inventory details are invalid");
  const itemId = typeof body.id === "string" ? body.id.slice(0, 100) : uuid("item");
  const timestamp = now();
  const trackingMode = String(body.trackingMode ?? "QUANTITY");
  const inputAssets = Array.isArray(body.assets) ? body.assets : [];
  if (
    (trackingMode === "INDIVIDUAL_ASSET" && inputAssets.length !== Number(body.totalQuantity)) ||
    (trackingMode === "QUANTITY" && inputAssets.length > 0) ||
    inputAssets.some(
      (asset: any) =>
        !asset ||
        typeof asset.serialNumber !== "string" ||
        !asset.serialNumber.trim() ||
        asset.serialNumber.length > 120
    ) ||
    new Set(inputAssets.map((asset: any) => asset.serialNumber.trim())).size !== inputAssets.length
  )
    return jsonError(
      c,
      400,
      "VALIDATION",
      "Enter a unique serial number for every individually tracked asset"
    );
  const item = {
    ...body,
    id: itemId,
    name: body.name.trim(),
    category: body.category.trim(),
    equipmentClass: body.equipmentClass,
    itemClass: body.equipmentClass,
    trackingMode,
    totalQuantity: Number(body.totalQuantity),
    availableQuantity: Number(body.totalQuantity),
    allocatedQuantity: 0,
    borrowedQuantity: 0,
    damagedQuantity: 0,
    maintenanceQuantity: 0,
    lostQuantity: 0,
    borrowerVisible:
      typeof body.borrowerVisible === "boolean"
        ? body.borrowerVisible
        : ["C", "E"].includes(String(body.equipmentClass)),
    assets: inputAssets.map((asset: any) => ({
      id: uuid("asset"),
      serialNumber: asset.serialNumber.trim(),
      condition: asset.condition ?? "GOOD",
      state: "AVAILABLE",
    })),
  };
  const statements = [
    c.env.DB.prepare(
      `INSERT INTO inventory(id,name,category,equipment_class,tracking_mode,total_quantity,available_quantity,allocated_quantity,borrowed_quantity,damaged_quantity,maintenance_quantity,lost_quantity,borrower_visible,data,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      itemId,
      item.name,
      item.category,
      item.equipmentClass,
      item.trackingMode,
      item.totalQuantity,
      item.totalQuantity,
      0,
      0,
      0,
      0,
      0,
      item.borrowerVisible ? 1 : 0,
      JSON.stringify(item),
      timestamp
    ),
    c.env.DB.prepare(
      "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES(?,?,?,?,?,?,?)"
    ).bind(
      uuid("audit"),
      actor.id,
      "INVENTORY",
      itemId,
      "INVENTORY_CREATED",
      timestamp,
      JSON.stringify({ itemId })
    ),
    ...item.assets.map((asset: any) =>
      c.env.DB.prepare(
        "INSERT INTO inventory_assets(id,item_id,serial_number,state,data) VALUES(?,?,?,?,?)"
      ).bind(asset.id, itemId, asset.serialNumber, asset.state, JSON.stringify(asset))
    ),
  ];
  try {
    await c.env.DB.batch(statements);
  } catch {
    return jsonError(c, 409, "CONFLICT", "Inventory item or serial number already exists");
  }
  return c.json(item, 201);
});

app.get("/api/v1/board/inventory", async (c) => {
  const actor = await requireBoard(c);
  if (!actor) return jsonError(c, 403, "FORBIDDEN", "Verified board access is required");
  const rows = await c.env.DB.prepare("SELECT data FROM inventory ORDER BY name LIMIT 1000").all<{
    data: string;
  }>();
  return c.json((rows.results ?? []).map((row) => parseJson(row.data)));
});

app.patch("/api/v1/board/inventory/:id/visibility", async (c) => {
  const actor = await requireBoard(c, true);
  if (!actor) return jsonError(c, 403, "FORBIDDEN", "Fresh board verification is required");
  const body = await c.req.json<{ visible?: boolean }>().catch(() => null);
  if (!body || typeof body.visible !== "boolean")
    return jsonError(c, 400, "VALIDATION", "Visibility must be true or false");
  const row = await c.env.DB.prepare(
    "SELECT equipment_class,data,updated_at FROM inventory WHERE id=?"
  )
    .bind(c.req.param("id"))
    .first<{ equipment_class: string; data: string; updated_at: number }>();
  if (!row) return jsonError(c, 404, "NOT_FOUND", "Inventory item not found");
  const record = parseJson<any>(row.data);
  record.borrowerVisible = body.visible;
  const stamp = now();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE inventory SET borrower_visible=?,data=?,updated_at=CASE WHEN updated_at=? THEN ? ELSE -1 END WHERE id=?"
      ).bind(
        body.visible ? 1 : 0,
        JSON.stringify(record),
        row.updated_at,
        Math.max(stamp, row.updated_at + 1),
        c.req.param("id")
      ),
      c.env.DB.prepare(
        "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES(?,?,?,?,?,?,?)"
      ).bind(
        uuid("audit"),
        actor.id,
        "INVENTORY",
        c.req.param("id"),
        body.visible ? "VISIBILITY_ENABLED" : "VISIBILITY_DISABLED",
        stamp,
        "{}"
      ),
    ]);
  } catch {
    return jsonError(c, 409, "CONFLICT", "Inventory changed; reload and retry");
  }
  return c.json(record);
});

app.get("/api/v1/board/loans", async (c) => {
  const actor = await requireBoard(c);
  if (!actor) return jsonError(c, 403, "FORBIDDEN", "Verified board access is required");
  const rows = await c.env.DB.prepare(
    "SELECT data FROM record_store WHERE kind='loan' ORDER BY updated_at DESC LIMIT 500"
  ).all<{ data: string }>();
  return c.json((rows.results ?? []).map((row) => parseJson(row.data)));
});

app.post("/api/v1/board/rpc", async (c) => {
  const actor = await requireBoard(c);
  if (!actor) return jsonError(c, 403, "FORBIDDEN", "Verified board access is required");
  const body = await c.req.json().catch(() => null);
  const result = await dispatchBoardRpc(c.env, actor, body);
  return c.json(result.body as any, result.status as any);
});

app.notFound((c) =>
  c.req.path.startsWith("/api/")
    ? jsonError(c, 404, "NOT_FOUND", "API route not found")
    : c.text("Not found", 404)
);

async function otpHash(env: Env, userId: string, code: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.BETTER_AUTH_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const data = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${userId}:${code}`));
  return [...new Uint8Array(data)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let value = 0;
  for (let i = 0; i < left.length; i++) value |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return value === 0;
}
function safeImage(value: string | undefined) {
  if (!value) return "";
  const trimmed = value.trim();
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return trimmed;
  }
  if (trimmed.startsWith("data:image/")) {
    return trimmed;
  }
  if (trimmed.startsWith("<svg") && trimmed.includes("</svg>")) {
    return `data:image/svg+xml;utf8,${encodeURIComponent(trimmed)}`;
  }
  try {
    const url = new URL(trimmed);
    return ["https:", "http:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}
async function sendStaffCode(env: Env, email: string, code: string) {
  if (!env.BREVO_API_KEY) return;
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "api-key": env.BREVO_API_KEY,
    },
    body: JSON.stringify({
      sender: {
        email: env.BREVO_SENDER_EMAIL ?? "noreply@ras-insat.org",
        name: env.BREVO_SENDER_NAME ?? "IEEE RAS INSAT",
      },
      to: [{ email }],
      subject: "Your board sign-in code",
      htmlContent: `<p>Your board sign-in code is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p><p>It expires in 10 minutes. Never share this code.</p>`,
    }),
  });
  if (!response.ok) throw new Error("Email delivery failed");
}

async function cleanExpiredSecurityData(env: Env) {
  const nowMs = now();
  const seconds = Math.floor(nowMs / 1000) - 24 * 60 * 60;
  const milliseconds = nowMs - 24 * 60 * 60_000;
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM rate_limit_buckets WHERE key_hash IN (SELECT key_hash FROM rate_limit_buckets WHERE window_start<? LIMIT 500)"
    ).bind(seconds),
    env.DB.prepare(
      "DELETE FROM registration_intents WHERE email IN (SELECT email FROM registration_intents WHERE expires_at<? LIMIT 500)"
    ).bind(nowMs),
    env.DB.prepare(
      "DELETE FROM staff_challenges WHERE id IN (SELECT id FROM staff_challenges WHERE expires_at<? AND created_at<? LIMIT 500)"
    ).bind(milliseconds, milliseconds),
    env.DB.prepare(
      "DELETE FROM idempotency_keys WHERE key IN (SELECT key FROM idempotency_keys WHERE created_at<? LIMIT 500)"
    ).bind(nowMs - 90 * 24 * 60 * 60_000),
    env.DB.prepare(
      "DELETE FROM verification WHERE id IN (SELECT id FROM verification WHERE expiresAt<? LIMIT 500)"
    ).bind(milliseconds),
  ]);
}

async function expireAllocations(env: Env) {
  const expired = await env.DB.prepare(
    "SELECT id,data FROM record_store WHERE kind='allocation' AND status='ACTIVE' AND expires_at<=? LIMIT 100"
  )
    .bind(now())
    .all<{ id: string; data: string }>();
  for (const row of expired.results ?? []) {
    const allocation = parseJson<any>(row.data);
    const inventoryRow = await env.DB.prepare("SELECT data,updated_at FROM inventory WHERE id=?")
      .bind(allocation.itemId)
      .first<{ data: string; updated_at: number }>();
    if (!inventoryRow) continue;
    const item = parseJson<any>(inventoryRow.data);
    item.availableQuantity += allocation.quantity;
    item.allocatedQuantity -= allocation.quantity;
    allocation.status = "EXPIRED";
    allocation.releasedAt = iso();
    const statements: D1PreparedStatement[] = [
      env.DB.prepare(
        "UPDATE inventory SET available_quantity=available_quantity+?,allocated_quantity=CASE WHEN allocated_quantity>=? THEN allocated_quantity-? ELSE -1 END,data=?,updated_at=CASE WHEN updated_at=? THEN ? ELSE -1 END WHERE id=?"
      ).bind(
        allocation.quantity,
        allocation.quantity,
        allocation.quantity,
        JSON.stringify(item),
        inventoryRow.updated_at,
        Math.max(now(), inventoryRow.updated_at + 1),
        allocation.itemId
      ),
      env.DB.prepare(
        "UPDATE record_store SET status='EXPIRED',data=?,updated_at=CASE WHEN status='ACTIVE' THEN ? ELSE -1 END WHERE kind='allocation' AND id=?"
      ).bind(JSON.stringify(allocation), now(), row.id),
      env.DB.prepare(
        "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES(?,?,?,?,?,?,?)"
      ).bind(uuid("audit"), "system", "ALLOCATION", row.id, "ALLOCATION_EXPIRED", now(), "{}"),
    ];
    if (item.trackingMode === "INDIVIDUAL_ASSET")
      for (const assetId of allocation.assetIds ?? []) {
        const asset = item.assets?.find((entry: any) => entry.id === assetId);
        if (!asset || asset.state !== "ALLOCATED")
          throw new Error("Expired allocation asset state is inconsistent");
        asset.state = "AVAILABLE";
        statements.unshift(
          env.DB.prepare(
            "UPDATE inventory_assets SET state=CASE WHEN state='ALLOCATED' THEN 'AVAILABLE' ELSE 'INVALID' END,data=? WHERE id=? AND item_id=?"
          ).bind(JSON.stringify(asset), asset.id, item.id)
        );
      }
    const event = {
      id: uuid("iev"),
      itemId: item.id,
      itemName: item.name,
      type: "RELEASE_ALLOCATION",
      quantity: allocation.quantity,
      beforeState: {
        allocated: item.allocatedQuantity + allocation.quantity,
        available: item.availableQuantity - allocation.quantity,
      },
      afterState: { allocated: item.allocatedQuantity, available: item.availableQuantity },
      reason: "48-hour collection window expired",
      actorUserId: "system",
      actorName: "System",
      timestamp: iso(),
      ...(allocation.assetIds?.length ? { assetIds: allocation.assetIds } : {}),
    };
    statements.push(
      env.DB.prepare(
        "INSERT INTO record_store(kind,id,owner_id,status,expires_at,data,updated_at) VALUES('inventory_event',?,?,'RELEASE_ALLOCATION',NULL,?,?)"
      ).bind(event.id, item.id, JSON.stringify(event), now())
    );
    await env.DB.batch(statements);
    const remaining = await env.DB.prepare(
      "SELECT 1 FROM record_store WHERE kind='allocation' AND json_extract(data,'$.requestId')=? AND status='ACTIVE' LIMIT 1"
    )
      .bind(allocation.requestId)
      .first();
    if (!remaining) {
      const requestRow = await env.DB.prepare("SELECT data FROM requests WHERE id=?")
        .bind(allocation.requestId)
        .first<{ data: string }>();
      if (requestRow) {
        const request = parseJson<any>(requestRow.data);
        if (request.handoverStatus === "WAITING") {
          request.lifecycleStatus = "EXPIRED";
          request.status = "EXPIRED";
          request.updatedAt = iso();
          request.timeline.push({
            status: "EXPIRED",
            timestamp: request.updatedAt,
            description: "The 48-hour collection window expired and reservations were released.",
            actor: "System",
          });
          await env.DB.batch([
            env.DB.prepare(
              "UPDATE requests SET status=CASE WHEN status IN ('APPROVED','PARTIALLY_APPROVED') THEN 'EXPIRED' ELSE 'INVALID' END,data=? WHERE id=?"
            ).bind(JSON.stringify(request), request.id),
            env.DB.prepare(
              "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES(?,?,?,?,?,?,?)"
            ).bind(uuid("audit"), "system", "REQUEST", request.id, "PICKUP_EXPIRED", now(), "{}"),
          ]);
        }
      }
    }
  }
}
