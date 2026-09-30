var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/worker/serverless.ts
import { getRequestListener } from "@hono/node-server";

// src/worker/index.ts
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { and as and2, asc, desc, eq as eq2, inArray } from "drizzle-orm";
import { z } from "zod";

// src/worker/database.ts
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

// src/worker/schema.ts
var schema_exports = {};
__export(schema_exports, {
  assets: () => assets,
  auditEvents: () => auditEvents,
  authAccounts: () => authAccounts,
  authRateLimits: () => authRateLimits,
  authSchema: () => authSchema,
  authSessions: () => authSessions,
  authUsers: () => authUsers,
  authVerifications: () => authVerifications,
  chapters: () => chapters,
  equipmentItems: () => equipmentItems,
  idempotencyKeys: () => idempotencyKeys,
  notifications: () => notifications,
  rateLimitBuckets: () => rateLimitBuckets,
  reservationAssets: () => reservationAssets,
  reservationLines: () => reservationLines,
  reservations: () => reservations,
  schema: () => schema
});
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex
} from "drizzle-orm/sqlite-core";
var authUsers = sqliteTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    emailVerified: integer("emailVerified", { mode: "boolean" }).notNull().default(false),
    image: text("image"),
    role: text("role", { enum: ["USER", "BOARD", "SUPERADMIN"] }).notNull().default("USER"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull()
  },
  (table) => [uniqueIndex("user_email").on(table.email), index("user_role").on(table.role)]
);
var authSessions = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
    ipAddress: text("ipAddress"),
    userAgent: text("userAgent"),
    userId: text("userId").notNull().references(() => authUsers.id, { onDelete: "cascade" })
  },
  (table) => [
    uniqueIndex("session_token").on(table.token),
    index("session_user_id").on(table.userId)
  ]
);
var authAccounts = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("accountId").notNull(),
    providerId: text("providerId").notNull(),
    userId: text("userId").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    accessToken: text("accessToken"),
    refreshToken: text("refreshToken"),
    idToken: text("idToken"),
    accessTokenExpiresAt: integer("accessTokenExpiresAt", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refreshTokenExpiresAt", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull()
  },
  (table) => [index("account_user_id").on(table.userId)]
);
var authVerifications = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
  },
  (table) => [index("verification_identifier").on(table.identifier)]
);
var authRateLimits = sqliteTable(
  "rateLimit",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    count: integer("count").notNull(),
    lastRequest: integer("lastRequest").notNull()
  },
  (table) => [uniqueIndex("rate_limit_key").on(table.key)]
);
var chapters = sqliteTable(
  "chapters",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    shortCode: text("short_code").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [
    uniqueIndex("chapters_name").on(table.name),
    uniqueIndex("chapters_short_code").on(table.shortCode)
  ]
);
var equipmentItems = sqliteTable(
  "equipment_items",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    category: text("category").notNull(),
    imageUrl: text("image_url"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [index("equipment_active_name").on(table.active, table.name)]
);
var assets = sqliteTable(
  "assets",
  {
    id: text("id").primaryKey(),
    equipmentItemId: text("equipment_item_id").notNull().references(() => equipmentItems.id, { onDelete: "restrict" }),
    assetCode: text("asset_code").notNull(),
    qrToken: text("qr_token").notNull(),
    serialNumber: text("serial_number"),
    state: text("state", {
      enum: ["AVAILABLE", "RESERVED", "BORROWED", "OUT_OF_SERVICE", "RETIRED"]
    }).notNull().default("AVAILABLE"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    lastScanAt: integer("last_scan_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [
    uniqueIndex("assets_code").on(table.assetCode),
    uniqueIndex("assets_qr_token").on(table.qrToken),
    uniqueIndex("assets_serial_number").on(table.serialNumber),
    index("assets_item_state").on(table.equipmentItemId, table.state, table.active)
  ]
);
var reservations = sqliteTable(
  "reservations",
  {
    id: text("id").primaryKey(),
    requestedByUserId: text("requested_by_user_id").notNull().references(() => authUsers.id, { onDelete: "restrict" }),
    borrowerType: text("borrower_type", { enum: ["PERSON", "CHAPTER"] }).notNull(),
    borrowerUserId: text("borrower_user_id").references(() => authUsers.id, {
      onDelete: "restrict"
    }),
    chapterId: text("chapter_id").references(() => chapters.id, { onDelete: "restrict" }),
    pickupAt: integer("pickup_at").notNull(),
    returnAt: integer("return_at").notNull(),
    note: text("note"),
    status: text("status", {
      enum: ["PENDING", "APPROVED", "DECLINED", "CANCELLED", "COMPLETED"]
    }).notNull().default("PENDING"),
    approvedByUserId: text("approved_by_user_id").references(() => authUsers.id, {
      onDelete: "set null"
    }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [
    index("reservations_pickup").on(table.pickupAt),
    index("reservations_return").on(table.returnAt),
    index("reservations_status").on(table.status),
    index("reservations_requester_created").on(table.requestedByUserId, table.createdAt),
    check("reservation_time_range", sql`${table.pickupAt} < ${table.returnAt}`),
    check(
      "reservation_borrower_party",
      sql`(${table.borrowerType} = 'PERSON' AND ${table.borrowerUserId} IS NOT NULL AND ${table.chapterId} IS NULL) OR (${table.borrowerType} = 'CHAPTER' AND ${table.borrowerUserId} IS NULL AND ${table.chapterId} IS NOT NULL)`
    )
  ]
);
var reservationLines = sqliteTable(
  "reservation_lines",
  {
    id: text("id").primaryKey(),
    reservationId: text("reservation_id").notNull().references(() => reservations.id, { onDelete: "cascade" }),
    equipmentItemId: text("equipment_item_id").notNull().references(() => equipmentItems.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull()
  },
  (table) => [
    uniqueIndex("reservation_line_equipment").on(table.reservationId, table.equipmentItemId),
    index("reservation_lines_equipment").on(table.equipmentItemId),
    check("reservation_line_quantity", sql`${table.quantity} > 0`)
  ]
);
var reservationAssets = sqliteTable(
  "reservation_assets",
  {
    id: text("id").primaryKey(),
    reservationId: text("reservation_id").notNull().references(() => reservations.id, { onDelete: "restrict" }),
    reservationLineId: text("reservation_line_id").notNull().references(() => reservationLines.id, { onDelete: "restrict" }),
    assetId: text("asset_id").notNull().references(() => assets.id, { onDelete: "restrict" }),
    state: text("state", { enum: ["RESERVED", "BORROWED", "RETURNED", "RELEASED"] }).notNull().default("RESERVED"),
    actualPickupAt: integer("actual_pickup_at"),
    checkedOutByUserId: text("checked_out_by_user_id").references(() => authUsers.id, {
      onDelete: "set null"
    }),
    actualReturnAt: integer("actual_return_at"),
    checkedInByUserId: text("checked_in_by_user_id").references(() => authUsers.id, {
      onDelete: "set null"
    }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [
    uniqueIndex("reservation_asset_once").on(table.reservationId, table.assetId),
    index("reservation_assets_asset").on(table.assetId),
    index("reservation_assets_reservation").on(table.reservationId),
    index("reservation_assets_line").on(table.reservationLineId)
  ]
);
var notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    reservationId: text("reservation_id").references(() => reservations.id, {
      onDelete: "set null"
    }),
    readAt: integer("read_at"),
    createdAt: integer("created_at").notNull()
  },
  (table) => [index("notifications_user_created").on(table.userId, table.createdAt)]
);
var auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id").notNull().references(() => authUsers.id, { onDelete: "restrict" }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    createdAt: integer("created_at").notNull(),
    data: text("data", { mode: "json" }).notNull().default("{}")
  },
  (table) => [
    index("audit_entity_time").on(table.entityType, table.entityId, table.createdAt),
    index("audit_actor_time").on(table.actorUserId, table.createdAt)
  ]
);
var idempotencyKeys = sqliteTable(
  "idempotency_keys",
  {
    actorId: text("actor_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    operation: text("operation").notNull(),
    key: text("key").notNull(),
    response: text("response", { mode: "json" }).notNull(),
    createdAt: integer("created_at").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.actorId, table.operation, table.key] }),
    index("idempotency_created").on(table.createdAt)
  ]
);
var rateLimitBuckets = sqliteTable("rate_limit_buckets", {
  keyHash: text("key_hash").primaryKey(),
  windowStart: integer("window_start").notNull(),
  count: integer("count").notNull()
});
var authSchema = {
  user: authUsers,
  session: authSessions,
  account: authAccounts,
  verification: authVerifications,
  rateLimit: authRateLimits
};
var schema = {
  ...authSchema,
  chapters,
  equipmentItems,
  assets,
  reservations,
  reservationLines,
  reservationAssets,
  notifications,
  auditEvents,
  idempotencyKeys,
  rateLimitBuckets
};

// src/worker/database.ts
function createDatabase(client) {
  return drizzle({ client, schema });
}
function createLibSqlClient(url, authToken) {
  return createClient({ url, authToken });
}

// src/worker/auth.ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";

// src/worker/email.ts
async function sendEmail(env, to, subject, htmlContent) {
  if (!env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL) {
    throw new Error("Email delivery is not configured.");
  }
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "api-key": env.BREVO_API_KEY
    },
    body: JSON.stringify({
      sender: {
        email: env.BREVO_SENDER_EMAIL,
        name: env.BREVO_SENDER_NAME ?? "IEEE INSAT SB Equipment Reservations"
      },
      to: [{ email: to }],
      subject,
      htmlContent
    })
  });
  if (!response.ok) throw new Error("Email delivery failed");
}
function escapeHtml(value) {
  return value.replace(
    /[&<>"']/g,
    (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[character]
  );
}

// src/worker/auth.ts
function isAllowedOrigin(origin, env, requestUrl) {
  let trusted;
  try {
    trusted = trustedAuthOrigin(env, requestUrl);
  } catch {
    return false;
  }
  if (origin === trusted) return true;
  try {
    const originUrl = new URL(origin);
    const trustedUrl = new URL(trusted);
    const localHostnames = ["localhost", "127.0.0.1"];
    const isOriginLocal = localHostnames.includes(originUrl.hostname);
    const isTrustedLocal = localHostnames.includes(trustedUrl.hostname);
    if (originUrl.hostname.endsWith(".vercel.app") && (trustedUrl.hostname.endsWith(".vercel.app") || Boolean(env.APP_ORIGIN?.includes(".vercel.app")))) {
      return true;
    }
    if (isOriginLocal && isTrustedLocal && originUrl.protocol === trustedUrl.protocol) {
      const allowedPorts = /* @__PURE__ */ new Set([
        originUrl.port,
        trustedUrl.port,
        "5173",
        "5174",
        "5175",
        "5188",
        "8787"
      ]);
      if (allowedPorts.has(originUrl.port) && allowedPorts.has(trustedUrl.port)) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}
function trustedAuthOrigin(env, requestUrl, originHeader) {
  const requestOrigin = new URL(requestUrl);
  const configuredHosts = new Set(
    [env.VERCEL_URL, env.VERCEL_PROJECT_PRODUCTION_URL].filter((host) => Boolean(host)).map((host) => host.replace(/^https?:\/\//, ""))
  );
  const local = ["localhost", "127.0.0.1"].includes(requestOrigin.hostname);
  if (originHeader && isAllowedOrigin(originHeader, env, requestUrl)) {
    return new URL(originHeader).origin;
  }
  if (env.APP_ORIGIN) {
    const appOrigin = new URL(env.APP_ORIGIN);
    if (appOrigin.pathname !== "/" || appOrigin.search || appOrigin.hash || appOrigin.username || appOrigin.password) {
      throw new Error("APP_ORIGIN must be an origin without a path.");
    }
    if (appOrigin.protocol !== "https:" && !local) throw new Error("APP_ORIGIN must use HTTPS.");
    if (!local && requestOrigin.origin !== appOrigin.origin) {
      if (requestOrigin.hostname.endsWith(".vercel.app") && appOrigin.hostname.endsWith(".vercel.app")) {
        return appOrigin.origin;
      }
      throw new Error("Untrusted application origin.");
    }
    if (local && (env.ENVIRONMENT === "development" || env.ENVIRONMENT === "test") && ["localhost", "127.0.0.1"].includes(appOrigin.hostname)) {
      return appOrigin.origin;
    }
    return local ? requestOrigin.origin : appOrigin.origin;
  }
  if (local) return requestOrigin.origin;
  if (!configuredHosts.has(requestOrigin.host) && !requestOrigin.hostname.endsWith(".vercel.app")) {
    throw new Error("Untrusted deployment origin.");
  }
  return requestOrigin.origin;
}
function createAuth(env, origin) {
  let isLocal = false;
  try {
    const u = new URL(origin);
    isLocal = ["localhost", "127.0.0.1"].includes(u.hostname);
  } catch {
    isLocal = false;
  }
  const trustedOrigins = [origin];
  if (isLocal) {
    trustedOrigins.push(
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:5174",
      "http://127.0.0.1:5174",
      "http://localhost:5188",
      "http://127.0.0.1:5188",
      "http://localhost:8787",
      "http://127.0.0.1:8787"
    );
  }
  return betterAuth({
    appName: "IEEE INSAT SB Equipment Reservations",
    baseURL: origin,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(env.DB, { provider: "sqlite", schema: schema_exports.authSchema }),
    trustedOrigins,
    user: {
      additionalFields: {
        role: {
          type: "string",
          required: false,
          defaultValue: "USER",
          input: false
        }
      }
    },
    advanced: {
      useSecureCookies: origin.startsWith("https://"),
      defaultCookieAttributes: {
        httpOnly: true,
        secure: origin.startsWith("https://"),
        sameSite: "lax",
        path: "/"
      }
    },
    session: {
      expiresIn: 30 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
      cookieCache: { enabled: false }
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: env.AUTH_RATE_LIMIT_PER_MINUTE,
      storage: "database"
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128
    },
    plugins: [
      magicLink({
        expiresIn: 10 * 60,
        storeToken: "hashed",
        sendMagicLink: async ({ email, url }) => {
          await sendEmail(
            env,
            email,
            "Your IEEE INSAT SB sign-in link",
            `<p>Use this single-use link within 10 minutes to sign in:</p><p><a href="${escapeHtml(url)}">Sign in</a></p><p>If you did not request this email, you can ignore it.</p>`
          );
        }
      })
    ]
  });
}
async function makeCookieSignature(value, secret) {
  const secretBuf = typeof secret === "string" ? new TextEncoder().encode(secret) : secret;
  const key = await crypto.subtle.importKey(
    "raw",
    secretBuf,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}
async function signCookieValue(value, secret) {
  const signature = await makeCookieSignature(value, secret);
  return encodeURIComponent(`${value}.${signature}`);
}

// src/worker/index.ts
import { hashPassword } from "better-auth/crypto";

// src/worker/identity.ts
import { createMiddleware } from "hono/factory";
import { and, eq, gt } from "drizzle-orm";
async function resolveIdentity(c) {
  let userId = null;
  try {
    const origin = trustedAuthOrigin(c.env, c.req.url, c.req.header("Origin"));
    const session = await createAuth(c.env, origin).api.getSession({ headers: c.req.raw.headers });
    userId = session?.user?.id;
  } catch {
  }
  if (!userId) {
    try {
      const cookieHeader = c.req.header("Cookie") || "";
      const tokenMatch = cookieHeader.match(/(?:__Secure-)?better-auth\.session_token=([^;]+)/);
      if (tokenMatch) {
        const rawVal = decodeURIComponent(tokenMatch[1]);
        const token = rawVal.split(".")[0];
        if (token) {
          const now = /* @__PURE__ */ new Date();
          const [session] = await c.env.DB.select({
            userId: schema_exports.authSessions.userId
          }).from(schema_exports.authSessions).where(and(eq(schema_exports.authSessions.token, token), gt(schema_exports.authSessions.expiresAt, now))).limit(1);
          if (session?.userId) {
            userId = session.userId;
          }
        }
      }
    } catch {
    }
  }
  if (!userId) return null;
  const [user] = await c.env.DB.select({
    id: schema_exports.authUsers.id,
    name: schema_exports.authUsers.name,
    email: schema_exports.authUsers.email,
    role: schema_exports.authUsers.role
  }).from(schema_exports.authUsers).where(eq(schema_exports.authUsers.id, userId)).limit(1);
  if (!user || !["USER", "BOARD", "SUPERADMIN"].includes(user.role)) return null;
  return { ...user, role: user.role };
}
var requireUser = createMiddleware(async (c, next) => {
  const actor = await resolveIdentity(c);
  if (!actor)
    return c.json({ error: { code: "UNAUTHENTICATED", message: "Sign in to continue." } }, 401);
  if (actor.role !== "USER") {
    return c.json({ error: { code: "FORBIDDEN", message: "A user account is required." } }, 403);
  }
  c.set("actor", actor);
  await next();
});
var requireBoard = createMiddleware(async (c, next) => {
  const actor = await resolveIdentity(c);
  if (!actor)
    return c.json({ error: { code: "UNAUTHENTICATED", message: "Sign in to continue." } }, 401);
  if (actor.role !== "BOARD" && actor.role !== "SUPERADMIN") {
    return c.json({ error: { code: "FORBIDDEN", message: "Board access is required." } }, 403);
  }
  c.set("actor", actor);
  await next();
});
var requireSuperadmin = createMiddleware(async (c, next) => {
  const actor = await resolveIdentity(c);
  if (!actor)
    return c.json({ error: { code: "UNAUTHENTICATED", message: "Sign in to continue." } }, 401);
  if (actor.role !== "SUPERADMIN") {
    return c.json({ error: { code: "FORBIDDEN", message: "Superadmin access is required." } }, 403);
  }
  c.set("actor", actor);
  await next();
});

// src/worker/domain.ts
import { DateTime } from "luxon";

// src/worker/security.ts
var DomainError = class extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
};
function jsonError(c, status, code, message) {
  return c.json({ error: { code, message } }, status);
}
async function sameOrigin(c, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(c.req.method)) return next();
  const origin = c.req.header("Origin");
  if (!origin || !isAllowedOrigin(origin, c.env, c.req.url)) {
    return jsonError(c, 403, "FORBIDDEN", "Request origin is not allowed.");
  }
  await next();
}
async function isRateLimited(env, key, max, windowMs = 6e4) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  const keyHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const timestamp = Date.now();
  const result = await env.CLIENT.execute({
    sql: `INSERT INTO rate_limit_buckets(key_hash,window_start,count) VALUES(?,?,1)
      ON CONFLICT(key_hash) DO UPDATE SET
        window_start=CASE WHEN rate_limit_buckets.window_start + ? <= excluded.window_start THEN excluded.window_start ELSE rate_limit_buckets.window_start END,
        count=CASE WHEN rate_limit_buckets.window_start + ? <= excluded.window_start THEN 1 ELSE rate_limit_buckets.count + 1 END
      RETURNING count`,
    args: [keyHash, timestamp, windowMs, windowMs]
  });
  return Number(result.rows[0]?.count ?? max + 1) > max;
}
function requestIp(c) {
  const forwarded = c.req.header("x-forwarded-for")?.split(",", 1)[0]?.trim();
  return forwarded || c.req.header("x-real-ip") || "unknown";
}

// src/worker/domain.ts
var DISPLAY_TIME_ZONE = "Africa/Tunis";
var DUPLICATE_SCAN_WINDOW_MS = 3e3;
var id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
var opaqueToken = () => [...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
async function rows(executor, sql2, args = []) {
  const result = await executor.execute({ sql: sql2, args });
  return result.rows;
}
async function one(executor, sql2, args = []) {
  return (await rows(executor, sql2, args))[0] ?? null;
}
async function write(env, operation) {
  const transaction = await env.CLIENT.transaction("write");
  try {
    const result = await operation(transaction);
    await transaction.commit();
    return result;
  } catch (error) {
    await transaction.rollback().catch(() => void 0);
    throw error;
  } finally {
    transaction.close();
  }
}
function audit(tx, actorId, entityType, entityId, action, data = {}) {
  return tx.execute({
    sql: "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES(?,?,?,?,?,?,?)",
    args: [id("audit"), actorId, entityType, entityId, action, Date.now(), JSON.stringify(data)]
  });
}
function notify(tx, userId, type, title, message, reservationId = null) {
  return tx.execute({
    sql: "INSERT INTO notifications(id,user_id,type,title,message,reservation_id,created_at) VALUES(?,?,?,?,?,?,?)",
    args: [id("notification"), userId, type, title, message, reservationId, Date.now()]
  });
}
async function notifyBoard(tx, type, title, message, reservationId) {
  const boardUsers = await rows(
    tx,
    "SELECT id FROM user WHERE role IN ('BOARD','SUPERADMIN')"
  );
  for (const user of boardUsers) await notify(tx, user.id, type, title, message, reservationId);
}
async function findAvailableAssets(executor, equipmentItemId, pickupAt, returnAt) {
  return rows(
    executor,
    `SELECT a.id,a.asset_code,a.serial_number,a.state
       FROM assets a
       INNER JOIN equipment_items e ON e.id=a.equipment_item_id
      WHERE a.equipment_item_id=? AND e.active=1 AND a.active=1
        AND a.state NOT IN ('BORROWED','OUT_OF_SERVICE','RETIRED')
        AND NOT EXISTS (
          SELECT 1
            FROM reservation_assets ra
            INNER JOIN reservations r ON r.id=ra.reservation_id
           WHERE ra.asset_id=a.id
             AND (ra.state='BORROWED' OR (ra.state='RESERVED' AND r.status='APPROVED'
               AND r.pickup_at < ? AND ? < r.return_at))
        )
      ORDER BY a.asset_code ASC`,
    [equipmentItemId, returnAt, pickupAt]
  );
}
async function availableQuantity(tx, equipmentId, pickupAt, returnAt, excludeReservationId = "") {
  const capacity = await one(
    tx,
    "SELECT COUNT(*) AS count FROM assets a JOIN equipment_items e ON e.id=a.equipment_item_id WHERE a.equipment_item_id=? AND a.active=1 AND e.active=1 AND a.state NOT IN ('OUT_OF_SERVICE','RETIRED')",
    [equipmentId]
  );
  const loans = await rows(
    tx,
    "SELECT r.id,r.pickup_at,r.return_at,l.quantity,(SELECT COUNT(*) FROM reservation_assets ra WHERE ra.reservation_line_id=l.id AND ra.state='RETURNED') AS returned,(SELECT COUNT(*) FROM reservation_assets ra WHERE ra.reservation_line_id=l.id AND ra.state='BORROWED') AS borrowed FROM reservations r JOIN reservation_lines l ON l.reservation_id=r.id WHERE l.equipment_item_id=? AND r.id<>? AND (r.status='APPROVED' OR EXISTS (SELECT 1 FROM reservation_assets ra WHERE ra.reservation_line_id=l.id AND ra.state='BORROWED'))",
    [equipmentId, excludeReservationId]
  );
  const events = [];
  for (const loan of loans) {
    const overlaps = Number(loan.pickup_at) < returnAt && pickupAt < Number(loan.return_at);
    const held = overlaps ? Math.max(Number(loan.borrowed), Number(loan.quantity) - Number(loan.returned)) : Number(loan.borrowed);
    if (!held) continue;
    events.push({
      time: overlaps ? Math.max(pickupAt, Number(loan.pickup_at)) : pickupAt,
      delta: held
    });
    events.push({
      time: overlaps ? Math.min(returnAt, Number(loan.return_at)) : returnAt,
      delta: -held
    });
  }
  events.sort((a, b) => a.time - b.time || a.delta - b.delta);
  let used = 0, peak = 0;
  for (const event of events) {
    used += event.delta;
    peak = Math.max(peak, used);
  }
  return Math.max(0, Number(capacity?.count ?? 0) - peak);
}
async function checkQuantities(tx, reservationId, pickupAt, returnAt) {
  const lines = await rows(
    tx,
    "SELECT equipment_item_id,quantity FROM reservation_lines WHERE reservation_id=?",
    [reservationId]
  );
  for (const line of lines) {
    if (await availableQuantity(tx, line.equipment_item_id, pickupAt, returnAt, reservationId) < Number(line.quantity))
      throw new DomainError(
        409,
        "RESERVATION_CONFLICT",
        "The requested equipment quantity is no longer available for this window."
      );
  }
}
async function listCatalogue(env, pickupAt, returnAt) {
  const items = await rows(
    env.CLIENT,
    "SELECT id,name,description,category,image_url AS imageUrl FROM equipment_items WHERE active=1 ORDER BY category,name"
  );
  return Promise.all(
    items.map(async (item) => ({
      ...item,
      availableQuantity: await availableQuantity(
        env.CLIENT,
        item.id,
        pickupAt,
        returnAt
      )
    }))
  );
}
async function getReservation(env, reservationId, includeAssets = false) {
  const executor = env.CLIENT;
  const reservation = await one(
    executor,
    `SELECT r.id,r.requested_by_user_id,u.name AS requester_name,u.email AS requester_email,
            r.borrower_type,r.borrower_user_id,r.chapter_id,bu.name AS borrower_name,ch.name AS chapter_name,
            r.pickup_at,r.return_at,r.note,r.status,r.created_at
       FROM reservations r
       INNER JOIN user u ON u.id=r.requested_by_user_id
       LEFT JOIN user bu ON bu.id=r.borrower_user_id
       LEFT JOIN chapters ch ON ch.id=r.chapter_id
      WHERE r.id=?`,
    [reservationId]
  );
  if (!reservation) return null;
  const lineRows = await rows(
    executor,
    `SELECT l.id,l.equipment_item_id,e.name AS equipment_name,l.quantity,
            ra.asset_id,a.asset_code,ra.state AS asset_state,a.state AS asset_state_now
       FROM reservation_lines l
       INNER JOIN equipment_items e ON e.id=l.equipment_item_id
       LEFT JOIN reservation_assets ra ON ra.reservation_line_id=l.id
       LEFT JOIN assets a ON a.id=ra.asset_id
      WHERE l.reservation_id=?
      ORDER BY e.name,a.asset_code`,
    [reservationId]
  );
  const grouped = /* @__PURE__ */ new Map();
  const assignmentStates = [];
  for (const line of lineRows) {
    let item = grouped.get(line.id);
    if (!item) {
      item = {
        lineId: line.id,
        equipmentItemId: line.equipment_item_id,
        name: line.equipment_name,
        quantity: Number(line.quantity),
        ...includeAssets ? { assignedAssets: [] } : {}
      };
      grouped.set(line.id, item);
    }
    if (line.asset_state) {
      assignmentStates.push(line.asset_state);
      if (includeAssets && line.asset_id && line.asset_code) {
        item.assignedAssets.push({
          id: line.asset_id,
          assetCode: line.asset_code,
          state: line.asset_state
        });
      }
    }
  }
  const now = Date.now();
  const borrowedCount = assignmentStates.filter((state) => state === "BORROWED").length;
  const returnedCount = assignmentStates.filter((state) => state === "RETURNED").length;
  const collectedCount = assignmentStates.filter(
    (state) => state !== "RESERVED" && state !== "RELEASED"
  ).length;
  let derivedStatus = reservation.status === "COMPLETED" ? "RETURNED" : reservation.status;
  if (borrowedCount > 0 && now > Number(reservation.return_at)) derivedStatus = "OVERDUE";
  else if (borrowedCount > 0 && returnedCount > 0) derivedStatus = "PARTIALLY_RETURNED";
  else if (borrowedCount > 0) derivedStatus = "BORROWED";
  else if (reservation.status === "COMPLETED") derivedStatus = "RETURNED";
  return {
    id: reservation.id,
    requestedBy: {
      id: reservation.requested_by_user_id,
      name: reservation.requester_name,
      email: reservation.requester_email
    },
    borrower: {
      type: reservation.borrower_type,
      id: reservation.borrower_type === "PERSON" ? reservation.borrower_user_id : reservation.chapter_id,
      name: reservation.borrower_type === "PERSON" ? reservation.borrower_name ?? reservation.requester_name : reservation.chapter_name ?? "Inactive chapter"
    },
    items: [...grouped.values()],
    pickupAt: new Date(Number(reservation.pickup_at)).toISOString(),
    returnAt: new Date(Number(reservation.return_at)).toISOString(),
    note: reservation.note,
    status: reservation.status,
    derivedStatus,
    collectedCount,
    returnedCount,
    totalQuantity: [...grouped.values()].reduce((sum, item) => sum + item.quantity, 0),
    createdAt: new Date(Number(reservation.created_at)).toISOString()
  };
}
async function listReservations(env, ownerId) {
  const ids = await rows(
    env.CLIENT,
    "SELECT id FROM reservations WHERE requested_by_user_id=? ORDER BY pickup_at DESC LIMIT 200",
    [ownerId]
  );
  return Promise.all(ids.map(({ id: reservationId }) => getReservation(env, reservationId)));
}
async function listBoardReservations(env) {
  const ids = await rows(
    env.CLIENT,
    "SELECT id FROM reservations ORDER BY CASE status WHEN 'PENDING' THEN 0 WHEN 'APPROVED' THEN 1 ELSE 2 END,pickup_at ASC LIMIT 500"
  );
  return Promise.all(ids.map(({ id: reservationId }) => getReservation(env, reservationId, true)));
}
function validateWindow(pickupAt, returnAt, allowStarted = false) {
  if (!Number.isFinite(pickupAt) || !Number.isFinite(returnAt) || pickupAt >= returnAt) {
    throw new DomainError(
      400,
      "INVALID_TIME_RANGE",
      "Choose a pickup time before the return time."
    );
  }
  if (!allowStarted && pickupAt < Date.now()) {
    throw new DomainError(400, "INVALID_TIME_RANGE", "Pickup cannot be in the past.");
  }
}
async function createReservation(env, actor, input) {
  validateWindow(input.pickupAt, input.returnAt);
  if (!input.items.length || input.items.some((item) => !Number.isInteger(item.quantity) || item.quantity < 1)) {
    throw new DomainError(400, "VALIDATION", "Add at least one item with a positive quantity.");
  }
  if (input.borrowerType === "CHAPTER" && !input.chapterId) {
    throw new DomainError(400, "VALIDATION", "Choose a chapter to borrow this equipment.");
  }
  if (input.borrowerType === "PERSON" && input.chapterId) {
    throw new DomainError(400, "VALIDATION", "A personal reservation cannot name a chapter.");
  }
  const duplicateItems = new Set(input.items.map((item) => item.equipmentItemId));
  if (duplicateItems.size !== input.items.length) {
    throw new DomainError(
      400,
      "VALIDATION",
      "Combine duplicate equipment lines into one quantity."
    );
  }
  const reservationId = id("reservation");
  await write(env, async (tx) => {
    if (input.borrowerType === "CHAPTER") {
      const chapter = await one(
        tx,
        "SELECT id FROM chapters WHERE id=? AND active=1",
        [input.chapterId]
      );
      if (!chapter)
        throw new DomainError(
          400,
          "VALIDATION",
          "That chapter is unavailable for new reservations."
        );
    }
    for (const line of input.items) {
      const equipment = await one(
        tx,
        "SELECT id FROM equipment_items WHERE id=? AND active=1",
        [line.equipmentItemId]
      );
      if (!equipment)
        throw new DomainError(
          400,
          "VALIDATION",
          "One of the selected equipment items is unavailable."
        );
      const candidates = await availableQuantity(
        tx,
        line.equipmentItemId,
        input.pickupAt,
        input.returnAt
      );
      if (candidates < line.quantity) {
        throw new DomainError(
          409,
          "NOT_AVAILABLE",
          "There is not enough equipment available for that time range."
        );
      }
    }
    const createdAt = Date.now();
    await tx.execute({
      sql: `INSERT INTO reservations(id,requested_by_user_id,borrower_type,borrower_user_id,chapter_id,pickup_at,return_at,note,status,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?, 'PENDING',?,?)`,
      args: [
        reservationId,
        actor.id,
        input.borrowerType,
        input.borrowerType === "PERSON" ? actor.id : null,
        input.borrowerType === "CHAPTER" ? input.chapterId : null,
        input.pickupAt,
        input.returnAt,
        input.note?.trim() || null,
        createdAt,
        createdAt
      ]
    });
    for (const line of input.items) {
      await tx.execute({
        sql: "INSERT INTO reservation_lines(id,reservation_id,equipment_item_id,quantity) VALUES(?,?,?,?)",
        args: [id("line"), reservationId, line.equipmentItemId, line.quantity]
      });
    }
    await audit(tx, actor.id, "RESERVATION", reservationId, "RESERVATION_CREATED", {
      itemCount: input.items.length
    });
    await notify(
      tx,
      actor.id,
      "RESERVATION_SUBMITTED",
      "Reservation request submitted",
      "Your request is waiting for Board review. We will remind you before borrowed equipment is due back.",
      reservationId
    );
    await notifyBoard(
      tx,
      "NEW_RESERVATION",
      "New reservation",
      `${actor.name} submitted a reservation.`,
      reservationId
    );
  });
  return getReservation(env, reservationId);
}
async function refreshReturnNotificationsForUser(env, userId, now = Date.now()) {
  return write(env, async (tx) => {
    const activeLoans = await rows(
      tx,
      "SELECT r.id,r.return_at,COUNT(ra.id) AS borrowed_count FROM reservations r INNER JOIN reservation_assets ra ON ra.reservation_id=r.id WHERE r.requested_by_user_id=? AND r.status='APPROVED' AND ra.state='BORROWED' GROUP BY r.id,r.return_at",
      [userId]
    );
    const todayStart = tunisDayRange(now).start;
    let created = 0;
    for (const loan of activeLoans) {
      const returnAt = Number(loan.return_at);
      const dueLabel = DateTime.fromMillis(returnAt, { zone: DISPLAY_TIME_ZONE }).toFormat(
        "ccc, d LLL 'at' HH:mm"
      );
      if (returnAt > now && returnAt <= now + 60 * 6e4) {
        const priorReminder = await one(
          tx,
          "SELECT id FROM notifications WHERE user_id=? AND reservation_id=? AND type='RETURN_DUE_SOON' LIMIT 1",
          [userId, loan.id]
        );
        if (!priorReminder) {
          await notify(
            tx,
            userId,
            "RETURN_DUE_SOON",
            "Equipment due back soon",
            "Your borrowed equipment is due back by " + dueLabel + ". Please return it to the Board.",
            loan.id
          );
          created++;
        }
      } else if (returnAt <= now) {
        const priorOverdue = await one(
          tx,
          "SELECT id FROM notifications WHERE user_id=? AND reservation_id=? AND type='RETURN_OVERDUE' AND created_at>=? LIMIT 1",
          [userId, loan.id, todayStart]
        );
        if (!priorOverdue) {
          await notify(
            tx,
            userId,
            "RETURN_OVERDUE",
            "Equipment return overdue",
            "The return time (" + dueLabel + ") has passed. Please return the borrowed equipment to the Board as soon as possible.",
            loan.id
          );
          created++;
        }
      }
    }
    return created;
  });
}
async function refreshAllReturnNotifications(env, now = Date.now()) {
  const borrowers = await rows(
    env.CLIENT,
    "SELECT DISTINCT r.requested_by_user_id AS user_id FROM reservations r INNER JOIN reservation_assets ra ON ra.reservation_id=r.id WHERE r.status='APPROVED' AND ra.state='BORROWED'"
  );
  let created = 0;
  for (const borrower of borrowers) {
    created += await refreshReturnNotificationsForUser(env, borrower.user_id, now);
  }
  return { borrowersChecked: borrowers.length, notificationsCreated: created };
}
async function approveReservation(env, actor, reservationId, _assignments) {
  await write(env, async (tx) => {
    const reservation = await one(
      tx,
      "SELECT status,pickup_at,return_at FROM reservations WHERE id=?",
      [reservationId]
    );
    if (!reservation) throw new DomainError(404, "NOT_FOUND", "Reservation not found.");
    if (reservation.status !== "PENDING")
      throw new DomainError(
        409,
        "RESERVATION_CONFLICT",
        "Only a pending reservation can be approved."
      );
    await checkQuantities(
      tx,
      reservationId,
      Number(reservation.pickup_at),
      Number(reservation.return_at)
    );
    const timestamp = Date.now();
    await tx.execute({
      sql: "UPDATE reservations SET status='APPROVED',approved_by_user_id=?,updated_at=? WHERE id=? AND status='PENDING'",
      args: [actor.id, timestamp, reservationId]
    });
    await audit(tx, actor.id, "RESERVATION", reservationId, "RESERVATION_APPROVED", {
      allocation: "QUANTITY_ONLY"
    });
    const requester = await one(
      tx,
      "SELECT requested_by_user_id FROM reservations WHERE id=?",
      [reservationId]
    );
    if (requester)
      await notify(
        tx,
        requester.requested_by_user_id,
        "RESERVATION_APPROVED",
        "Reservation approved",
        "Your equipment reservation has been approved. Open your reservations and select Show Handover QR. Present it to the Board for pickup and return.",
        reservationId
      );
  });
  return getReservation(env, reservationId, true);
}
async function declineReservation(env, actor, reservationId) {
  await write(env, async (tx) => {
    const reservation = await one(
      tx,
      "SELECT status,requested_by_user_id FROM reservations WHERE id=?",
      [reservationId]
    );
    if (!reservation) throw new DomainError(404, "NOT_FOUND", "Reservation not found.");
    if (reservation.status !== "PENDING")
      throw new DomainError(
        409,
        "RESERVATION_CONFLICT",
        "Only a pending reservation can be declined."
      );
    await tx.execute({
      sql: "UPDATE reservations SET status='DECLINED',updated_at=? WHERE id=?",
      args: [Date.now(), reservationId]
    });
    await audit(tx, actor.id, "RESERVATION", reservationId, "RESERVATION_DECLINED");
    await notify(
      tx,
      reservation.requested_by_user_id,
      "RESERVATION_DECLINED",
      "Reservation declined",
      "The Board declined your equipment reservation.",
      reservationId
    );
  });
  return getReservation(env, reservationId, true);
}
async function cancelReservation(env, actor, reservationId, isBoard = false) {
  await write(env, async (tx) => {
    const reservation = await one(tx, "SELECT status,pickup_at,requested_by_user_id FROM reservations WHERE id=?", [
      reservationId
    ]);
    if (!reservation) throw new DomainError(404, "NOT_FOUND", "Reservation not found.");
    if (!isBoard && reservation.requested_by_user_id !== actor.id)
      throw new DomainError(404, "NOT_FOUND", "Reservation not found.");
    if (!["PENDING", "APPROVED"].includes(reservation.status) || Number(reservation.pickup_at) <= Date.now()) {
      throw new DomainError(
        409,
        "RESERVATION_CONFLICT",
        "This reservation can no longer be cancelled."
      );
    }
    const borrowed = await one(
      tx,
      "SELECT COUNT(*) AS count FROM reservation_assets WHERE reservation_id=? AND state='BORROWED'",
      [reservationId]
    );
    if (Number(borrowed?.count ?? 0) > 0)
      throw new DomainError(
        409,
        "RESERVATION_CONFLICT",
        "A reservation with checked-out equipment cannot be cancelled."
      );
    await tx.execute({
      sql: "UPDATE reservation_assets SET state='RELEASED',updated_at=? WHERE reservation_id=? AND state='RESERVED'",
      args: [Date.now(), reservationId]
    });
    await tx.execute({
      sql: "UPDATE assets SET state='AVAILABLE',updated_at=? WHERE id IN (SELECT asset_id FROM reservation_assets WHERE reservation_id=? AND state='RELEASED') AND state='RESERVED'",
      args: [Date.now(), reservationId]
    });
    await tx.execute({
      sql: "UPDATE reservations SET status='CANCELLED',updated_at=? WHERE id=?",
      args: [Date.now(), reservationId]
    });
    await audit(tx, actor.id, "RESERVATION", reservationId, "RESERVATION_CANCELLED");
    await notify(
      tx,
      reservation.requested_by_user_id,
      "RESERVATION_CANCELLED",
      "Reservation cancelled",
      "Your equipment reservation was cancelled.",
      reservationId
    );
  });
  return getReservation(env, reservationId, isBoard);
}
async function forceDeleteReservation(env, actor, reservationId) {
  return await write(env, async (tx) => {
    const reservation = await one(tx, "SELECT id,status,requested_by_user_id FROM reservations WHERE id=?", [reservationId]);
    if (!reservation) throw new DomainError(404, "NOT_FOUND", "Reservation not found.");
    await tx.execute({
      sql: `UPDATE assets SET state='AVAILABLE', updated_at=?
            WHERE id IN (
              SELECT asset_id FROM reservation_assets
              WHERE reservation_id=? AND state IN ('RESERVED', 'BORROWED')
            ) AND state IN ('RESERVED', 'BORROWED')`,
      args: [Date.now(), reservationId]
    });
    await tx.execute({
      sql: "DELETE FROM reservation_assets WHERE reservation_id=?",
      args: [reservationId]
    });
    await tx.execute({
      sql: "DELETE FROM reservation_lines WHERE reservation_id=?",
      args: [reservationId]
    });
    await tx.execute({
      sql: "UPDATE notifications SET reservation_id=NULL WHERE reservation_id=?",
      args: [reservationId]
    });
    await tx.execute({
      sql: "DELETE FROM reservations WHERE id=?",
      args: [reservationId]
    });
    await audit(tx, actor.id, "RESERVATION", reservationId, "RESERVATION_FORCE_DELETED", {
      previousStatus: reservation.status
    });
    if (reservation.requested_by_user_id !== actor.id) {
      await notify(
        tx,
        reservation.requested_by_user_id,
        "RESERVATION_DELETED",
        "Reservation request removed",
        "Your equipment reservation request was removed by the Board.",
        null
      );
    }
    return { ok: true, id: reservationId };
  });
}
async function assignApprovedReservation(tx, actor, reservationId, pickupAt, returnAt, _assignments) {
  await checkQuantities(tx, reservationId, pickupAt, returnAt);
  await audit(tx, actor.id, "RESERVATION", reservationId, "RESERVATION_RESCHEDULED", {
    pickupAt,
    returnAt,
    allocation: "QUANTITY_ONLY"
  });
}
async function rescheduleReservation(env, actor, reservationId, pickupAt, returnAt, assignments) {
  validateWindow(pickupAt, returnAt);
  await write(env, async (tx) => {
    const reservation = await one(
      tx,
      "SELECT status FROM reservations WHERE id=?",
      [reservationId]
    );
    if (!reservation) throw new DomainError(404, "NOT_FOUND", "Reservation not found.");
    if (reservation.status !== "APPROVED")
      throw new DomainError(
        409,
        "RESERVATION_CONFLICT",
        "Only an approved reservation can be rescheduled."
      );
    const borrowed = await one(
      tx,
      "SELECT COUNT(*) AS count FROM reservation_assets WHERE reservation_id=? AND state='BORROWED'",
      [reservationId]
    );
    if (Number(borrowed?.count ?? 0) > 0)
      throw new DomainError(
        409,
        "RESERVATION_CONFLICT",
        "Return checked-out equipment before changing the reservation time."
      );
    await tx.execute({
      sql: "UPDATE reservation_assets SET state='RELEASED',updated_at=? WHERE reservation_id=? AND state='RESERVED'",
      args: [Date.now(), reservationId]
    });
    await tx.execute({
      sql: "UPDATE assets SET state='AVAILABLE',updated_at=? WHERE id IN (SELECT asset_id FROM reservation_assets WHERE reservation_id=? AND state='RELEASED') AND state='RESERVED'",
      args: [Date.now(), reservationId]
    });
    await tx.execute({
      sql: "UPDATE reservations SET pickup_at=?,return_at=?,updated_at=? WHERE id=?",
      args: [pickupAt, returnAt, Date.now(), reservationId]
    });
    await assignApprovedReservation(tx, actor, reservationId, pickupAt, returnAt, assignments);
    const requester = await one(
      tx,
      "SELECT requested_by_user_id FROM reservations WHERE id=?",
      [reservationId]
    );
    if (requester)
      await notify(
        tx,
        requester.requested_by_user_id,
        "RESERVATION_UPDATED",
        "Reservation time updated",
        "The Board updated your reservation window.",
        reservationId
      );
  });
  return getReservation(env, reservationId, true);
}
async function collectMaterial(tx, actor, reservationId, assetId, timestamp) {
  const reservation = await one(
    tx,
    "SELECT r.status,r.pickup_at,r.return_at,r.requested_by_user_id,CASE WHEN r.borrower_type='PERSON' THEN u.name ELSE ch.name END AS borrower_name FROM reservations r LEFT JOIN user u ON u.id=r.borrower_user_id LEFT JOIN chapters ch ON ch.id=r.chapter_id WHERE r.id=?",
    [reservationId]
  );
  if (!reservation) throw new DomainError(404, "NOT_FOUND", "Reservation not found.");
  if (reservation.status !== "APPROVED")
    throw new DomainError(
      409,
      "INVALID_CHECKOUT",
      "Only approved reservations can collect equipment."
    );
  if (timestamp < Number(reservation.pickup_at))
    throw new DomainError(409, "TOO_EARLY", "The pickup window has not started yet.");
  if (timestamp >= Number(reservation.return_at))
    throw new DomainError(409, "RESERVATION_EXPIRED", "The reservation window has expired.");
  const asset = await one(
    tx,
    "SELECT a.equipment_item_id,a.state,a.active,e.active AS equipment_active FROM assets a JOIN equipment_items e ON e.id=a.equipment_item_id WHERE a.id=?",
    [assetId]
  );
  if (!asset || !asset.active || !asset.equipment_active || !["AVAILABLE", "RESERVED"].includes(asset.state))
    throw new DomainError(409, "ASSET_UNAVAILABLE", "This material is not available for pickup.");
  const existing = await one(
    tx,
    "SELECT id FROM reservation_assets WHERE asset_id=? AND (state='BORROWED' OR (reservation_id=? AND actual_pickup_at IS NOT NULL))",
    [assetId, reservationId]
  );
  if (existing)
    throw new DomainError(409, "INVALID_CHECKOUT", "This material has already been collected.");
  const line = await one(
    tx,
    "SELECT l.id,l.quantity,(SELECT COUNT(*) FROM reservation_assets ra WHERE ra.reservation_line_id=l.id AND ra.actual_pickup_at IS NOT NULL) AS collected FROM reservation_lines l WHERE l.reservation_id=? AND l.equipment_item_id=?",
    [reservationId, asset.equipment_item_id]
  );
  if (!line)
    throw new DomainError(
      409,
      "WRONG_RESERVATION",
      "This equipment type is not part of this reservation."
    );
  if (Number(line.collected) >= Number(line.quantity))
    throw new DomainError(
      409,
      "QUANTITY_REACHED",
      "All requested units of this equipment type have been collected."
    );
  await tx.execute({
    sql: "INSERT INTO reservation_assets(id,reservation_id,reservation_line_id,asset_id,state,actual_pickup_at,checked_out_by_user_id,created_at,updated_at) VALUES(?,?,?,?,'BORROWED',?,?,?,?)",
    args: [
      id("reservation_asset"),
      reservationId,
      line.id,
      assetId,
      timestamp,
      actor.id,
      timestamp,
      timestamp
    ]
  });
  await tx.execute({
    sql: "UPDATE assets SET state='BORROWED',last_scan_at=?,updated_at=? WHERE id=?",
    args: [timestamp, timestamp, assetId]
  });
  await audit(tx, actor.id, "ASSET", assetId, "ASSET_CHECKED_OUT", { reservationId });
  return reservation;
}
async function handoverReservation(env, actor, reservationId, assetIds = []) {
  if (!assetIds.length || new Set(assetIds).size !== assetIds.length)
    throw new DomainError(400, "VALIDATION", "Select the material labels actually handed over.");
  return write(env, async (tx) => {
    const timestamp = Date.now();
    for (const assetId of assetIds)
      await collectMaterial(tx, actor, reservationId, assetId, timestamp);
    const reservation = await one(
      tx,
      "SELECT requested_by_user_id FROM reservations WHERE id=?",
      [reservationId]
    );
    await notify(
      tx,
      reservation.requested_by_user_id,
      "ASSET_CHECKED_OUT",
      "Equipment handed over",
      "Equipment collection has been recorded. Please return it by the reservation deadline.",
      reservationId
    );
    return { ok: true, handedOverCount: assetIds.length };
  });
}
async function scanAsset(env, actor, qrToken, idempotencyKey, reservationId, operation) {
  if (!/^[a-f0-9]{64}$/i.test(qrToken))
    throw new DomainError(400, "INVALID_ASSET", "This QR code is not valid.");
  if (!/^[a-zA-Z0-9_-]{12,120}$/.test(idempotencyKey))
    throw new DomainError(400, "VALIDATION", "A valid scan operation key is required.");
  return write(env, async (tx) => {
    const replay = await one(
      tx,
      "SELECT response FROM idempotency_keys WHERE actor_id=? AND operation='ASSET_SCAN' AND key=?",
      [actor.id, idempotencyKey]
    );
    if (replay) return JSON.parse(replay.response);
    const asset = await one(
      tx,
      "SELECT a.id,a.asset_code,a.state,a.active,a.last_scan_at,a.equipment_item_id,e.name AS equipment_name FROM assets a INNER JOIN equipment_items e ON e.id=a.equipment_item_id WHERE a.qr_token=?",
      [qrToken]
    );
    if (!asset) throw new DomainError(404, "INVALID_ASSET", "No equipment matches this QR code.");
    if (reservationId && operation === "RETURNED") {
      const assignment = await one(
        tx,
        "SELECT id FROM reservation_assets WHERE reservation_id=? AND asset_id=? AND state='BORROWED'",
        [reservationId, asset.id]
      );
      if (!assignment)
        throw new DomainError(
          409,
          "INVALID_RETURN",
          "This material is not awaiting return for this reservation."
        );
    }
    if (operation === "CHECKED_OUT" && asset.state === "BORROWED")
      throw new DomainError(409, "INVALID_CHECKOUT", "This material is already borrowed.");
    if (!asset.active || asset.state === "RETIRED")
      throw new DomainError(409, "INVALID_ASSET", "This asset has been retired.");
    if (asset.state === "OUT_OF_SERVICE")
      throw new DomainError(409, "OUT_OF_SERVICE", "This asset is out of service.");
    const timestamp = Date.now();
    if (asset.last_scan_at !== null && timestamp - Number(asset.last_scan_at) < DUPLICATE_SCAN_WINDOW_MS) {
      throw new DomainError(
        409,
        "DUPLICATE_SCAN",
        "This QR was just processed. Wait a moment before scanning it again."
      );
    }
    let result;
    if (asset.state === "BORROWED") {
      const assignment = await one(
        tx,
        `SELECT ra.id,ra.reservation_id,r.return_at,r.requested_by_user_id,
                CASE WHEN r.borrower_type='PERSON' THEN bu.name ELSE ch.name END AS borrower_name
           FROM reservation_assets ra
           INNER JOIN reservations r ON r.id=ra.reservation_id
           LEFT JOIN user bu ON bu.id=r.borrower_user_id
           LEFT JOIN chapters ch ON ch.id=r.chapter_id
          WHERE ra.asset_id=? AND ra.state='BORROWED' ORDER BY ra.updated_at DESC LIMIT 1`,
        [asset.id]
      );
      if (!assignment)
        throw new DomainError(409, "ALREADY_RETURNED", "This asset has no active checkout.");
      await tx.execute({
        sql: "UPDATE reservation_assets SET state='RETURNED',actual_return_at=?,checked_in_by_user_id=?,updated_at=? WHERE id=? AND state='BORROWED'",
        args: [timestamp, actor.id, timestamp, assignment.id]
      });
      const nextReservation = await one(
        tx,
        `SELECT r.id FROM reservation_assets ra INNER JOIN reservations r ON r.id=ra.reservation_id
          WHERE ra.asset_id=? AND ra.state='RESERVED' AND r.status='APPROVED' AND r.pickup_at<=? AND ?<r.return_at LIMIT 1`,
        [asset.id, timestamp, timestamp]
      );
      await tx.execute({
        sql: "UPDATE assets SET state=?,last_scan_at=?,updated_at=? WHERE id=?",
        args: [nextReservation ? "RESERVED" : "AVAILABLE", timestamp, timestamp, asset.id]
      });
      const unfinished = await one(
        tx,
        "SELECT (SELECT COALESCE(SUM(quantity),0) FROM reservation_lines WHERE reservation_id=?) - (SELECT COUNT(*) FROM reservation_assets WHERE reservation_id=? AND state='RETURNED') AS count",
        [assignment.reservation_id, assignment.reservation_id]
      );
      if (Number(unfinished?.count ?? 0) === 0) {
        await tx.execute({
          sql: "UPDATE reservations SET status='COMPLETED',updated_at=? WHERE id=? AND status IN ('APPROVED','CANCELLED')",
          args: [timestamp, assignment.reservation_id]
        });
      }
      await audit(tx, actor.id, "ASSET", asset.id, "ASSET_RETURNED", {
        reservationId: assignment.reservation_id
      });
      await notify(
        tx,
        assignment.requested_by_user_id,
        "ASSET_RETURNED",
        "Equipment returned",
        `${asset.equipment_name} ${asset.asset_code} was returned.`,
        assignment.reservation_id
      );
      result = {
        operation: "RETURNED",
        assetName: asset.equipment_name,
        assetCode: asset.asset_code
      };
    } else {
      if (!reservationId)
        throw new DomainError(
          400,
          "RESERVATION_REQUIRED",
          "Scan the borrower's reservation QR before collecting materials."
        );
      const collected = await collectMaterial(tx, actor, reservationId, asset.id, timestamp);
      const activeAssignment = { ...collected, reservation_id: reservationId };
      await notify(
        tx,
        activeAssignment.requested_by_user_id,
        "ASSET_CHECKED_OUT",
        "Equipment checked out",
        `${asset.equipment_name} ${asset.asset_code} was checked out.`,
        activeAssignment.reservation_id
      );
      result = {
        operation: "CHECKED_OUT",
        assetName: asset.equipment_name,
        assetCode: asset.asset_code,
        borrowerName: activeAssignment.borrower_name,
        returnAt: new Date(Number(activeAssignment.return_at)).toISOString()
      };
    }
    await tx.execute({
      sql: "INSERT INTO idempotency_keys(actor_id,operation,key,response,created_at) VALUES(?,'ASSET_SCAN',?,?,?)",
      args: [actor.id, idempotencyKey, JSON.stringify(result), timestamp]
    });
    return result;
  });
}
function tunisDayRange(timestamp = Date.now()) {
  const localStart = DateTime.fromMillis(timestamp, { zone: DISPLAY_TIME_ZONE }).startOf("day");
  return {
    start: localStart.toUTC().toMillis(),
    end: localStart.plus({ days: 1 }).toUTC().toMillis()
  };
}
async function boardDashboard(env) {
  const now = Date.now();
  const { start, end } = tunisDayRange(now);
  const [pickups, returns, borrowed, overdue, nextPickups, nextReturns] = await Promise.all([
    one(
      env.CLIENT,
      "SELECT COUNT(DISTINCT r.id) AS count FROM reservations r WHERE r.status='APPROVED' AND r.pickup_at>=? AND r.pickup_at<?",
      [start, end]
    ),
    one(
      env.CLIENT,
      "SELECT COUNT(DISTINCT r.id) AS count FROM reservations r JOIN reservation_assets ra ON ra.reservation_id=r.id WHERE ra.state='BORROWED' AND r.return_at>=? AND r.return_at<?",
      [start, end]
    ),
    one(
      env.CLIENT,
      "SELECT COUNT(*) AS count FROM assets WHERE state='BORROWED' AND active=1"
    ),
    one(
      env.CLIENT,
      "SELECT COUNT(DISTINCT ra.asset_id) AS count FROM reservation_assets ra JOIN reservations r ON r.id=ra.reservation_id WHERE ra.state='BORROWED' AND r.return_at<?",
      [now]
    ),
    rows(
      env.CLIENT,
      "SELECT id FROM reservations WHERE status='APPROVED' AND pickup_at>=? ORDER BY pickup_at LIMIT 5",
      [now]
    ),
    rows(
      env.CLIENT,
      "SELECT DISTINCT r.id FROM reservations r JOIN reservation_assets ra ON ra.reservation_id=r.id WHERE ra.state='BORROWED' AND r.return_at>=? ORDER BY r.return_at LIMIT 5",
      [now]
    )
  ]);
  return {
    pickupsToday: Number(pickups?.count ?? 0),
    returnsToday: Number(returns?.count ?? 0),
    currentlyBorrowed: Number(borrowed?.count ?? 0),
    overdue: Number(overdue?.count ?? 0),
    nextPickups: await Promise.all(
      nextPickups.map(({ id: reservationId }) => getReservation(env, reservationId, true))
    ),
    nextReturns: await Promise.all(
      nextReturns.map(({ id: reservationId }) => getReservation(env, reservationId, true))
    )
  };
}
async function calendarEvents(env, start, end, filters = {}) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || end - start > 93 * 864e5) {
    throw new DomainError(400, "INVALID_TIME_RANGE", "Choose a calendar range under 93 days.");
  }
  const ids = await rows(
    env.CLIENT,
    `SELECT DISTINCT r.id FROM reservations r
       LEFT JOIN reservation_assets ra ON ra.reservation_id=r.id
      WHERE ((r.status='APPROVED' AND r.pickup_at < ? AND ? < r.return_at) OR ra.state='BORROWED')
      ORDER BY r.pickup_at`,
    [end, start]
  );
  const reservations2 = await Promise.all(
    ids.map(({ id: reservationId }) => getReservation(env, reservationId, true))
  );
  return reservations2.filter((reservation) => Boolean(reservation)).flatMap(
    (reservation) => reservation.items.flatMap(
      (item) => (item.assignedAssets?.length ? item.assignedAssets : [{ id: item.lineId, assetCode: String(item.quantity) + " units", state: "RESERVED" }]).filter((asset) => asset.state === "RESERVED" || asset.state === "BORROWED").filter(
        () => !filters.equipmentItemId || item.equipmentItemId === filters.equipmentItemId
      ).filter(() => !filters.borrower || reservation.borrower.id === filters.borrower).filter(
        () => !filters.status || reservation.derivedStatus === filters.status || reservation.status === filters.status
      ).map((asset) => ({
        id: `${reservation.id}:${asset.id}`,
        reservationId: reservation.id,
        assetId: asset.id,
        title: `${item.name} ${asset.assetCode} \xB7 ${reservation.borrower.name}`,
        equipmentName: item.name,
        assetCode: asset.assetCode,
        borrowerName: reservation.borrower.name,
        requesterName: reservation.requestedBy.name,
        start: reservation.pickupAt,
        end: reservation.returnAt,
        status: reservation.derivedStatus
      }))
    )
  );
}
async function listBoardAudit(env) {
  return rows(
    env.CLIENT,
    `SELECT a.id,a.entity_type AS entityType,a.entity_id AS entityId,a.action,a.created_at AS createdAt,
            a.data,u.name AS actorName
       FROM audit_events a INNER JOIN user u ON u.id=a.actor_user_id
      ORDER BY a.created_at DESC LIMIT 100`
  );
}
function createQrToken() {
  return opaqueToken();
}
function randomId(prefix) {
  return id(prefix);
}

// src/worker/index.ts
var app = new Hono();
var millisIso = z.string().refine(
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
      frameAncestors: ["'none'"]
    },
    strictTransportSecurity: "max-age=31536000; includeSubDomains; preload",
    referrerPolicy: "no-referrer",
    xFrameOptions: "DENY"
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
    onError: (c) => jsonError(c, 413, "BODY_TOO_LARGE", "Request body is too large.")
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
  console.error("request_failed", { requestId: requestIdValue, type: error.name });
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
  return c.json(await refreshAllReturnNotifications(c.env));
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
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.email !== "string" || !/^\S+@\S+\.\S+$/.test(body.email.trim()) || typeof body.name !== "string" || body.name.trim().length < 2 || typeof body.password !== "string" || body.password.length < 12 || body.password.length > 128) {
    return jsonError(
      c,
      400,
      "VALIDATION",
      "Enter a valid name and email, and choose a password between 12 and 128 characters."
    );
  }
  const email = body.email.trim().toLowerCase();
  const name = body.name.trim();
  const phone = typeof body.phone === "string" ? body.phone.trim().slice(0, 50) || null : null;
  const now = /* @__PURE__ */ new Date();
  const existing = await c.env.DB.select().from(schema_exports.authUsers).where(eq2(schema_exports.authUsers.email, email)).limit(1);
  let userId;
  let user;
  if (existing.length > 0) {
    userId = existing[0].id;
    if (existing[0].role !== "USER") {
      return jsonError(c, 409, "ACCOUNT_EXISTS", "This email belongs to a Board account.");
    }
    const [credential] = await c.env.DB.select().from(schema_exports.authAccounts).where(
      and2(
        eq2(schema_exports.authAccounts.userId, userId),
        eq2(schema_exports.authAccounts.providerId, "credential")
      )
    ).limit(1);
    if (credential?.password) {
      return jsonError(
        c,
        409,
        "ACCOUNT_EXISTS",
        "An account already exists with this email. Switch to Sign in."
      );
    }
    await c.env.DB.update(schema_exports.authUsers).set({ name, phone, updatedAt: now }).where(eq2(schema_exports.authUsers.id, userId));
    user = { ...existing[0], name, phone, updatedAt: now };
  } else {
    userId = crypto.randomUUID();
    const [newUser] = await c.env.DB.insert(schema_exports.authUsers).values({
      id: userId,
      name,
      email,
      phone,
      emailVerified: true,
      role: "USER",
      createdAt: now,
      updatedAt: now
    }).returning();
    user = newUser;
  }
  const passwordHash = await hashPassword(body.password);
  const [existingCredential] = await c.env.DB.select().from(schema_exports.authAccounts).where(
    and2(eq2(schema_exports.authAccounts.userId, userId), eq2(schema_exports.authAccounts.providerId, "credential"))
  ).limit(1);
  if (existingCredential) {
    await c.env.DB.update(schema_exports.authAccounts).set({ password: passwordHash, updatedAt: now }).where(eq2(schema_exports.authAccounts.id, existingCredential.id));
  } else {
    await c.env.DB.insert(schema_exports.authAccounts).values({
      id: crypto.randomUUID(),
      accountId: userId,
      providerId: "credential",
      userId,
      password: passwordHash,
      createdAt: now,
      updatedAt: now
    });
  }
  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const sessionId = "sess_" + crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 6e4);
  await c.env.DB.insert(schema_exports.authSessions).values({
    id: sessionId,
    expiresAt,
    token,
    createdAt: now,
    updatedAt: now,
    ipAddress: requestIp(c),
    userAgent: c.req.header("User-Agent") ?? null,
    userId
  });
  const isHttps = c.req.url.startsWith("https:");
  const signedToken = await signCookieValue(token, c.env.BETTER_AUTH_SECRET);
  const maxAge = 30 * 24 * 60 * 60;
  const response = c.json({ ok: true, user });
  response.headers.append(
    "Set-Cookie",
    `better-auth.session_token=${signedToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps ? "; Secure" : ""}`
  );
  if (isHttps) {
    response.headers.append(
      "Set-Cookie",
      `__Secure-better-auth.session_token=${signedToken}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${maxAge}`
    );
  }
  return response;
});
app.post("/api/v1/auth/borrower-login", async (c) => {
  if (await isRateLimited(c.env, "auth:" + requestIp(c), c.env.AUTH_RATE_LIMIT_PER_MINUTE)) {
    return jsonError(c, 429, "RATE_LIMITED", "Too many sign-in attempts. Try again shortly.");
  }
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.email !== "string" || typeof body.password !== "string") {
    return jsonError(c, 400, "VALIDATION", "Borrower email and password are required.");
  }
  const email = body.email.trim().toLowerCase();
  const [user] = await c.env.DB.select().from(schema_exports.authUsers).where(eq2(schema_exports.authUsers.email, email)).limit(1);
  if (!user || user.role !== "USER") {
    return jsonError(c, 401, "UNAUTHENTICATED", "Invalid email or password.");
  }
  const auth = createAuth(c.env, trustedAuthOrigin(c.env, c.req.url, c.req.header("Origin")));
  const res = await auth.api.signInEmail({
    body: { email, password: body.password },
    headers: c.req.raw.headers,
    asResponse: true
  }).catch(() => null);
  if (!res || !res.ok) {
    return jsonError(c, 401, "UNAUTHENTICATED", "Invalid email or password.");
  }
  const response = c.json({ ok: true, user });
  const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : res.headers.get("set-cookie") ? [res.headers.get("set-cookie")] : [];
  for (const cookie of setCookies) response.headers.append("Set-Cookie", cookie);
  return response;
});
app.post("/api/v1/auth/board-login", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || !body.email || !body.password) {
    return jsonError(c, 400, "VALIDATION", "Staff email and password are required.");
  }
  const email = body.email.trim().toLowerCase();
  const auth = createAuth(c.env, trustedAuthOrigin(c.env, c.req.url, c.req.header("Origin")));
  const res = await auth.api.signInEmail({
    body: { email, password: body.password },
    headers: c.req.raw.headers,
    asResponse: true
  }).catch(() => null);
  if (!res || !res.ok) {
    return jsonError(c, 401, "UNAUTHENTICATED", "Invalid email or password.");
  }
  const [user] = await c.env.DB.select().from(schema_exports.authUsers).where(eq2(schema_exports.authUsers.email, email)).limit(1);
  if (!user || user.role !== "BOARD" && user.role !== "SUPERADMIN") {
    return jsonError(c, 403, "FORBIDDEN", "This account does not have Board staff access.");
  }
  const response = c.json({ ok: true, user });
  const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : res.headers.get("set-cookie") ? [res.headers.get("set-cookie")] : [];
  for (const cookie of setCookies) {
    response.headers.append("Set-Cookie", cookie);
  }
  return response;
});
app.post("/api/v1/auth/sign-out", async (c) => {
  const origin = trustedAuthOrigin(c.env, c.req.url, c.req.header("Origin"));
  const auth = createAuth(c.env, origin);
  let currentUserId = null;
  try {
    const user = await resolveIdentity(c);
    if (user?.id) currentUserId = user.id;
  } catch {
  }
  try {
    await auth.api.signOut({
      headers: c.req.raw.headers,
      asResponse: true
    });
  } catch {
  }
  const cookieHeader = c.req.header("Cookie") || "";
  const match = cookieHeader.match(/(?:__Secure-)?better-auth\.session_token=([^;]+)/);
  if (match) {
    const rawToken = decodeURIComponent(match[1]).split(".")[0];
    try {
      await c.env.DB.delete(schema_exports.authSessions).where(eq2(schema_exports.authSessions.token, rawToken));
    } catch {
    }
  }
  if (currentUserId) {
    try {
      await c.env.DB.delete(schema_exports.authSessions).where(
        eq2(schema_exports.authSessions.userId, currentUserId)
      );
    } catch {
    }
  }
  const response = c.json({ ok: true });
  const isHttps = c.req.url.startsWith("https:");
  const secure = isHttps ? "; Secure" : "";
  const clearCookieAttrs = [
    `better-auth.session_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`,
    `better-auth.session_data=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`,
    `better-auth.dont_remember=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`,
    `__Secure-better-auth.session_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure`,
    `__Secure-better-auth.session_data=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure`
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
function intervalFromQuery(params) {
  const pickup = params.get("pickupAt");
  const returns = params.get("returnAt");
  if (!pickup && !returns) return { pickupAt: Date.now(), returnAt: Date.now() + 60 * 6e4 };
  if (!pickup || !returns || !/(?:Z|[+-]\d{2}:\d{2})$/.test(pickup) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(returns)) {
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
  const chapters2 = await c.env.DB.select({
    id: schema_exports.chapters.id,
    name: schema_exports.chapters.name,
    shortCode: schema_exports.chapters.shortCode
  }).from(schema_exports.chapters).where(eq2(schema_exports.chapters.active, true)).orderBy(asc(schema_exports.chapters.name));
  return c.json(chapters2);
});
app.get("/api/v1/equipment/:id/availability", async (c) => {
  const { pickupAt, returnAt } = intervalFromQuery(new URL(c.req.url).searchParams);
  const item = await c.env.DB.select({ id: schema_exports.equipmentItems.id }).from(schema_exports.equipmentItems).where(
    and2(eq2(schema_exports.equipmentItems.id, c.req.param("id")), eq2(schema_exports.equipmentItems.active, true))
  ).limit(1);
  if (!item.length) return jsonError(c, 404, "NOT_FOUND", "Equipment not found.");
  const availableAssets = await findAvailableAssets(
    c.env.CLIENT,
    item[0].id,
    pickupAt,
    returnAt
  );
  return c.json({ availableQuantity: availableAssets.length });
});
app.use("/api/v1/reservations", requireUser);
app.use("/api/v1/reservations/*", requireUser);
var createReservationSchema = z.object({
  borrowerType: z.enum(["PERSON", "CHAPTER"]),
  chapterId: z.string().min(1).optional(),
  pickupAt: millisIso,
  returnAt: millisIso,
  note: z.string().max(500).optional(),
  items: z.array(
    z.object({
      equipmentItemId: z.string().min(1),
      quantity: z.number().int().positive().max(100)
    })
  ).min(1).max(40)
}).strict();
app.get(
  "/api/v1/reservations",
  async (c) => c.json(await listReservations(c.env, c.get("actor").id))
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
    returnAt: Date.parse(parsed.data.returnAt)
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
  const notifications2 = await c.env.DB.select({
    id: schema_exports.notifications.id,
    type: schema_exports.notifications.type,
    title: schema_exports.notifications.title,
    message: schema_exports.notifications.message,
    reservationId: schema_exports.notifications.reservationId,
    readAt: schema_exports.notifications.readAt,
    createdAt: schema_exports.notifications.createdAt
  }).from(schema_exports.notifications).where(eq2(schema_exports.notifications.userId, actor.id)).orderBy(desc(schema_exports.notifications.createdAt)).limit(100);
  return c.json(notifications2);
});
app.post("/api/v1/notifications/refresh", async (c) => {
  const actor = await resolveIdentity(c);
  if (!actor) return jsonError(c, 401, "UNAUTHENTICATED", "Sign in to continue.");
  const created = actor.role === "USER" ? await refreshReturnNotificationsForUser(c.env, actor.id) : 0;
  return c.json({ ok: true, notificationsCreated: created });
});
app.patch("/api/v1/notifications/:id/read", async (c) => {
  const actor = await resolveIdentity(c);
  if (!actor) return jsonError(c, 401, "UNAUTHENTICATED", "Sign in to continue.");
  const result = await c.env.DB.update(schema_exports.notifications).set({ readAt: Date.now() }).where(
    and2(eq2(schema_exports.notifications.id, c.req.param("id")), eq2(schema_exports.notifications.userId, actor.id))
  );
  return c.json({ ok: true, changes: result.rowsAffected });
});
app.use("/api/v1/board", requireBoard);
app.use("/api/v1/board/*", requireBoard);
app.get("/api/v1/board/dashboard", async (c) => c.json(await boardDashboard(c.env)));
app.get("/api/v1/board/reservations", async (c) => c.json(await listBoardReservations(c.env)));
app.get("/api/v1/board/reservations/:id/borrower", async (c) => {
  const reservation = await getReservation(c.env, c.req.param("id"));
  if (!reservation) return jsonError(c, 404, "NOT_FOUND", "Reservation not found.");
  const userId = reservation.borrower.type === "PERSON" ? reservation.borrower.id : reservation.requestedBy.id;
  const [person] = await c.env.DB.select({
    name: schema_exports.authUsers.name,
    email: schema_exports.authUsers.email,
    phone: schema_exports.authUsers.phone
  }).from(schema_exports.authUsers).where(eq2(schema_exports.authUsers.id, userId)).limit(1);
  if (!person) return jsonError(c, 404, "NOT_FOUND", "Borrower not found.");
  const count = await c.env.CLIENT.execute({
    sql: "SELECT COUNT(DISTINCT r.id) AS count FROM reservations r WHERE " + (reservation.borrower.type === "PERSON" ? "r.borrower_type='PERSON' AND r.borrower_user_id=?" : "r.borrower_type='CHAPTER' AND r.chapter_id=?") + " AND EXISTS (SELECT 1 FROM reservation_assets ra WHERE ra.reservation_id=r.id AND ra.actual_pickup_at IS NOT NULL)",
    args: [reservation.borrower.id]
  });
  return c.json({
    ...person,
    borrowingCount: Number(count.rows[0]?.count ?? 0),
    chapterName: reservation.borrower.type === "CHAPTER" ? reservation.borrower.name : null
  });
});
app.get("/api/v1/board/reservations/:id", async (c) => {
  const reservation = await getReservation(c.env, c.req.param("id"), true);
  if (!reservation) return jsonError(c, 404, "NOT_FOUND", "Reservation not found.");
  const candidates = await Promise.all(
    reservation.items.map(async (item) => ({
      lineId: item.lineId,
      assets: reservation.status === "APPROVED" ? (await findAvailableAssets(
        c.env.CLIENT,
        item.equipmentItemId,
        Date.parse(reservation.pickupAt),
        Date.parse(reservation.returnAt)
      )).filter(
        (asset) => !item.assignedAssets?.some((collected) => collected.id === asset.id)
      ).map((asset) => ({
        id: asset.id,
        assetCode: asset.asset_code,
        serialNumber: asset.serial_number,
        state: asset.state
      })) : []
    }))
  );
  return c.json({ ...reservation, allocationCandidates: candidates });
});
var assignmentsSchema = z.record(z.string(), z.array(z.string()));
app.post("/api/v1/board/reservations/:id/handover", async (c) => {
  const parsed = z.object({ assetIds: z.array(z.string().min(1)).min(1).max(500) }).safeParse(await c.req.json().catch(() => null));
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
  const parsed = z.object({ pickupAt: millisIso, returnAt: millisIso, assignments: assignmentsSchema.optional() }).safeParse(await c.req.json().catch(() => null));
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
      status: c.req.query("status")
    })
  );
});
app.post("/api/v1/board/scan", async (c) => {
  const actor = c.get("actor");
  if (await isRateLimited(c.env, `scan:${actor.id}`, 180))
    return jsonError(c, 429, "RATE_LIMITED", "Scanner is busy. Wait a moment and try again.");
  const parsed = z.object({
    qrToken: z.string().min(1).max(256),
    reservationId: z.string().min(1).optional(),
    operation: z.enum(["CHECKED_OUT", "RETURNED"]).optional()
  }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return jsonError(c, 400, "INVALID_ASSET", "This QR code is not valid.");
  const idempotencyKey = c.req.header("Idempotency-Key") ?? "";
  if (Boolean(parsed.data.reservationId) !== Boolean(parsed.data.operation))
    return jsonError(
      c,
      400,
      "VALIDATION",
      "Choose a reservation and pickup or return operation together."
    );
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
    id: schema_exports.equipmentItems.id,
    name: schema_exports.equipmentItems.name,
    description: schema_exports.equipmentItems.description,
    category: schema_exports.equipmentItems.category,
    imageUrl: schema_exports.equipmentItems.imageUrl,
    active: schema_exports.equipmentItems.active
  }).from(schema_exports.equipmentItems).orderBy(asc(schema_exports.equipmentItems.category), asc(schema_exports.equipmentItems.name));
  const assets2 = await c.env.CLIENT.execute({
    sql: `SELECT a.id,a.equipment_item_id AS equipmentItemId,a.asset_code AS assetCode,a.qr_token AS qrToken,
                 a.serial_number AS serialNumber,a.state,a.active,a.last_scan_at AS lastScanAt,e.name AS equipmentName
            FROM assets a INNER JOIN equipment_items e ON e.id=a.equipment_item_id ORDER BY e.name,a.asset_code`
  });
  const grouped = new Map(
    equipment.map((item) => [item.id, { ...item, assets: [] }])
  );
  for (const raw of assets2.rows) {
    const item = grouped.get(String(raw.equipmentItemId));
    if (!item) continue;
    const assignment = await c.env.CLIENT.execute({
      sql: `SELECT r.pickup_at AS pickupAt,r.return_at AS returnAt,
                   CASE WHEN r.borrower_type='PERSON' THEN u.name ELSE ch.name END AS borrowerName
              FROM reservation_assets ra INNER JOIN reservations r ON r.id=ra.reservation_id
              LEFT JOIN user u ON u.id=r.borrower_user_id LEFT JOIN chapters ch ON ch.id=r.chapter_id
             WHERE ra.asset_id=? AND ra.state IN ('RESERVED','BORROWED') AND r.status IN ('APPROVED','CANCELLED')
             ORDER BY r.pickup_at LIMIT 1`,
      args: [String(raw.id)]
    });
    const nextReservation = assignment.rows[0];
    item.assets.push({
      id: raw.id,
      assetCode: raw.assetCode,
      qrUrl: new URL(`/scan/${String(raw.qrToken)}`, origin).toString(),
      serialNumber: raw.serialNumber,
      state: raw.state,
      active: Boolean(raw.active),
      nextReservation: nextReservation ? {
        pickupAt: new Date(Number(nextReservation.pickupAt)).toISOString(),
        returnAt: new Date(Number(nextReservation.returnAt)).toISOString(),
        borrowerName: nextReservation.borrowerName
      } : null
    });
  }
  return c.json([...grouped.values()]);
});
var equipmentSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().max(1e3).default(""),
  category: z.string().trim().min(1).max(80),
  imageUrl: z.string().url().max(1e3).nullable().optional()
}).strict();
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
      timestamp
    ]
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
      "{}"
    ]
  });
  return c.json({ id: itemId, ...parsed.data, active: true, assets: [] }, 201);
});
app.patch("/api/v1/board/equipment/:id", async (c) => {
  const parsed = z.object({ active: z.boolean() }).strict().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return jsonError(c, 400, "VALIDATION", "Choose whether this equipment is active.");
  const result = await c.env.DB.update(schema_exports.equipmentItems).set({ active: parsed.data.active, updatedAt: Date.now() }).where(eq2(schema_exports.equipmentItems.id, c.req.param("id")));
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
      JSON.stringify({ active: parsed.data.active })
    ]
  });
  return c.json({ ok: true });
});
app.delete("/api/v1/board/equipment/:id", requireBoard, async (c) => {
  const id2 = c.req.param("id");
  const activeAssets = await c.env.DB.select({ id: schema_exports.assets.id, state: schema_exports.assets.state }).from(schema_exports.assets).where(
    and2(
      eq2(schema_exports.assets.equipmentItemId, id2),
      inArray(schema_exports.assets.state, ["BORROWED", "RESERVED"])
    )
  ).limit(1);
  if (activeAssets.length > 0)
    return jsonError(
      c,
      409,
      "RESERVATION_CONFLICT",
      "Cannot delete equipment while some of its assets are currently borrowed or reserved."
    );
  await c.env.DB.delete(schema_exports.assets).where(eq2(schema_exports.assets.equipmentItemId, id2));
  const result = await c.env.DB.delete(schema_exports.equipmentItems).where(
    eq2(schema_exports.equipmentItems.id, id2)
  );
  if (!result.rowsAffected) return jsonError(c, 404, "NOT_FOUND", "Equipment not found.");
  await c.env.CLIENT.execute({
    sql: "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES(?,?,?,?,?,?,?)",
    args: [
      randomId("audit"),
      c.get("actor").id,
      "EQUIPMENT",
      id2,
      "EQUIPMENT_DELETED",
      Date.now(),
      "{}"
    ]
  });
  return c.json({ ok: true });
});
app.post("/api/v1/board/equipment/:id/assets", async (c) => {
  const parsed = z.object({
    assetCode: z.string().trim().min(1).max(80),
    serialNumber: z.string().trim().max(120).nullable().optional()
  }).strict().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return jsonError(c, 400, "VALIDATION", "Enter a valid asset code.");
  const equipment = await c.env.DB.select({
    id: schema_exports.equipmentItems.id,
    active: schema_exports.equipmentItems.active,
    name: schema_exports.equipmentItems.name
  }).from(schema_exports.equipmentItems).where(eq2(schema_exports.equipmentItems.id, c.req.param("id"))).limit(1);
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
      timestamp
    ]
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
      JSON.stringify({ assetCode: parsed.data.assetCode })
    ]
  });
  const origin = trustedAuthOrigin(c.env, c.req.url);
  return c.json(
    {
      id: assetId,
      assetCode: parsed.data.assetCode,
      qrUrl: new URL(`/scan/${qrToken}`, origin).toString(),
      state: "AVAILABLE",
      active: true
    },
    201
  );
});
app.patch("/api/v1/board/assets/:id", async (c) => {
  const parsed = z.object({ state: z.enum(["AVAILABLE", "OUT_OF_SERVICE", "RETIRED"]) }).strict().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return jsonError(c, 400, "VALIDATION", "Choose a valid asset state.");
  const asset = await c.env.DB.select({ state: schema_exports.assets.state, active: schema_exports.assets.active }).from(schema_exports.assets).where(eq2(schema_exports.assets.id, c.req.param("id"))).limit(1);
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
  await c.env.DB.update(schema_exports.assets).set({
    state: parsed.data.state,
    active: parsed.data.state !== "RETIRED",
    updatedAt: Date.now()
  }).where(eq2(schema_exports.assets.id, c.req.param("id")));
  await c.env.CLIENT.execute({
    sql: "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES(?,?,?,?,?,?,?)",
    args: [
      randomId("audit"),
      c.get("actor").id,
      "ASSET",
      c.req.param("id"),
      parsed.data.state === "RETIRED" ? "ASSET_DISABLED" : "ASSET_STATE_CHANGED",
      Date.now(),
      JSON.stringify({ state: parsed.data.state })
    ]
  });
  return c.json({ ok: true });
});
app.delete("/api/v1/board/assets/:id", requireBoard, async (c) => {
  const id2 = c.req.param("id");
  const asset = await c.env.DB.select({ state: schema_exports.assets.state }).from(schema_exports.assets).where(eq2(schema_exports.assets.id, id2)).limit(1);
  if (!asset[0]) return jsonError(c, 404, "NOT_FOUND", "Asset not found.");
  if (asset[0].state === "BORROWED" || asset[0].state === "RESERVED")
    return jsonError(
      c,
      409,
      "RESERVATION_CONFLICT",
      "Cannot delete an asset that is currently borrowed or reserved."
    );
  await c.env.DB.delete(schema_exports.assets).where(eq2(schema_exports.assets.id, id2));
  await c.env.CLIENT.execute({
    sql: "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES(?,?,?,?,?,?,?)",
    args: [randomId("audit"), c.get("actor").id, "ASSET", id2, "ASSET_DELETED", Date.now(), "{}"]
  });
  return c.json({ ok: true });
});
app.get("/api/v1/board/chapters", async (c) => {
  const chapters2 = await c.env.DB.select().from(schema_exports.chapters).orderBy(asc(schema_exports.chapters.name));
  return c.json(chapters2);
});
app.post("/api/v1/board/chapters", async (c) => {
  const parsed = z.object({
    name: z.string().trim().min(1).max(120),
    shortCode: z.string().trim().min(2).max(24).regex(/^[A-Za-z0-9-]+$/)
  }).strict().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return jsonError(c, 400, "VALIDATION", "Enter a chapter name and short code.");
  const timestamp = Date.now();
  const chapterId = randomId("chapter");
  await c.env.CLIENT.execute({
    sql: "INSERT INTO chapters(id,name,short_code,active,created_at,updated_at) VALUES(?,?,?,1,?,?)",
    args: [chapterId, parsed.data.name, parsed.data.shortCode.toUpperCase(), timestamp, timestamp]
  });
  return c.json(
    { id: chapterId, ...parsed.data, shortCode: parsed.data.shortCode.toUpperCase(), active: true },
    201
  );
});
app.patch("/api/v1/board/chapters/:id", async (c) => {
  const parsed = z.object({ active: z.boolean() }).strict().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return jsonError(c, 400, "VALIDATION", "Choose whether this chapter is active.");
  const result = await c.env.DB.update(schema_exports.chapters).set({ active: parsed.data.active, updatedAt: Date.now() }).where(eq2(schema_exports.chapters.id, c.req.param("id")));
  if (!result.rowsAffected) return jsonError(c, 404, "NOT_FOUND", "Chapter not found.");
  return c.json({ ok: true });
});
app.delete("/api/v1/board/chapters/:id", requireBoard, async (c) => {
  const id2 = c.req.param("id");
  const reservations2 = await c.env.DB.select({ id: schema_exports.reservations.id }).from(schema_exports.reservations).where(eq2(schema_exports.reservations.chapterId, id2)).limit(1);
  if (reservations2.length > 0)
    return jsonError(
      c,
      409,
      "RESERVATION_CONFLICT",
      "Cannot delete a chapter that has reservations. Deactivate it instead."
    );
  const result = await c.env.DB.delete(schema_exports.chapters).where(eq2(schema_exports.chapters.id, id2));
  if (!result.rowsAffected) return jsonError(c, 404, "NOT_FOUND", "Chapter not found.");
  await c.env.CLIENT.execute({
    sql: "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES(?,?,?,?,?,?,?)",
    args: [
      randomId("audit"),
      c.get("actor").id,
      "CHAPTER",
      id2,
      "CHAPTER_DELETED",
      Date.now(),
      "{}"
    ]
  });
  return c.json({ ok: true });
});
app.get("/api/v1/board/users", requireSuperadmin, async (c) => {
  const users = await c.env.DB.select({
    id: schema_exports.authUsers.id,
    name: schema_exports.authUsers.name,
    email: schema_exports.authUsers.email,
    role: schema_exports.authUsers.role,
    emailVerified: schema_exports.authUsers.emailVerified,
    createdAt: schema_exports.authUsers.createdAt
  }).from(schema_exports.authUsers).orderBy(asc(schema_exports.authUsers.name)).limit(500);
  return c.json(users);
});
app.post("/api/v1/board/users", requireSuperadmin, async (c) => {
  const parsed = z.object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().email().max(320),
    role: z.enum(["BOARD", "SUPERADMIN"]).default("BOARD"),
    password: z.string().min(12).max(128)
  }).strict().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return jsonError(
      c,
      400,
      "VALIDATION",
      parsed.error.issues[0]?.message ?? "Enter a name, email, password (min 12 chars), and role."
    );
  const existing = await c.env.DB.select({ id: schema_exports.authUsers.id }).from(schema_exports.authUsers).where(eq2(schema_exports.authUsers.email, parsed.data.email.toLowerCase())).limit(1);
  if (existing.length > 0)
    return jsonError(c, 409, "RESERVATION_CONFLICT", "An account with that email already exists.");
  const passwordHash = await hashPassword(parsed.data.password);
  const userId = randomId("user");
  const timestamp = Date.now();
  await c.env.CLIENT.execute({
    sql: "INSERT INTO user(id,name,email,emailVerified,role,createdAt,updatedAt) VALUES(?,?,?,1,?,?,?)",
    args: [
      userId,
      parsed.data.name,
      parsed.data.email.toLowerCase(),
      parsed.data.role,
      timestamp,
      timestamp
    ]
  });
  await c.env.CLIENT.execute({
    sql: "INSERT INTO account(id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)",
    args: [
      randomId("account"),
      userId,
      // accountId must equal userId for credential provider
      "credential",
      userId,
      passwordHash,
      timestamp,
      timestamp
    ]
  });
  await c.env.CLIENT.execute({
    sql: "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES(?,?,?,?,?,?,?)",
    args: [
      randomId("audit"),
      c.get("actor").id,
      "USER",
      userId,
      "USER_CREATED",
      timestamp,
      JSON.stringify({ role: parsed.data.role, email: parsed.data.email.toLowerCase() })
    ]
  });
  return c.json(
    {
      id: userId,
      name: parsed.data.name,
      email: parsed.data.email.toLowerCase(),
      role: parsed.data.role,
      emailVerified: true
    },
    201
  );
});
app.put("/api/v1/board/users/:id/password", requireSuperadmin, async (c) => {
  const parsed = z.object({ password: z.string().min(12).max(128) }).strict().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return jsonError(c, 400, "VALIDATION", "Password must be at least 12 characters.");
  const targetId = c.req.param("id");
  const user = await c.env.DB.select({ id: schema_exports.authUsers.id, email: schema_exports.authUsers.email }).from(schema_exports.authUsers).where(eq2(schema_exports.authUsers.id, targetId)).limit(1);
  if (!user[0]) return jsonError(c, 404, "NOT_FOUND", "Account not found.");
  const passwordHash = await hashPassword(parsed.data.password);
  const acct = await c.env.CLIENT.execute({
    sql: "SELECT id FROM account WHERE userId=? AND providerId='credential' LIMIT 1",
    args: [targetId]
  });
  if (acct.rows.length > 0) {
    await c.env.CLIENT.execute({
      sql: "UPDATE account SET password=?,updatedAt=? WHERE userId=? AND providerId='credential'",
      args: [passwordHash, Date.now(), targetId]
    });
  } else {
    await c.env.CLIENT.execute({
      sql: "INSERT INTO account(id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)",
      args: [
        randomId("account"),
        targetId,
        // accountId must equal userId for credential provider
        "credential",
        targetId,
        passwordHash,
        Date.now(),
        Date.now()
      ]
    });
  }
  await c.env.DB.delete(schema_exports.authSessions).where(eq2(schema_exports.authSessions.userId, targetId));
  await c.env.CLIENT.execute({
    sql: "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES(?,?,?,?,?,?,?)",
    args: [
      randomId("audit"),
      c.get("actor").id,
      "USER",
      targetId,
      "PASSWORD_RESET",
      Date.now(),
      "{}"
    ]
  });
  return c.json({ ok: true });
});
app.patch("/api/v1/board/users/:id/role", requireSuperadmin, async (c) => {
  const parsed = z.object({ role: z.enum(["USER", "BOARD", "SUPERADMIN"]) }).strict().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return jsonError(c, 400, "VALIDATION", "Choose a valid account role.");
  const targetId = c.req.param("id");
  if (targetId === c.get("actor").id && parsed.data.role !== "SUPERADMIN")
    return jsonError(
      c,
      409,
      "RESERVATION_CONFLICT",
      "You cannot remove your own superadmin access."
    );
  const previous = await c.env.DB.select({ role: schema_exports.authUsers.role }).from(schema_exports.authUsers).where(eq2(schema_exports.authUsers.id, targetId)).limit(1);
  if (!previous[0]) return jsonError(c, 404, "NOT_FOUND", "Account not found.");
  await c.env.DB.update(schema_exports.authUsers).set({ role: parsed.data.role, updatedAt: /* @__PURE__ */ new Date() }).where(eq2(schema_exports.authUsers.id, targetId));
  await c.env.CLIENT.execute({
    sql: "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES(?,?,?,?,?,?,?)",
    args: [
      randomId("audit"),
      c.get("actor").id,
      "USER",
      targetId,
      "ROLE_CHANGED",
      Date.now(),
      JSON.stringify({ before: previous[0].role, after: parsed.data.role })
    ]
  });
  return c.json({ ok: true, role: parsed.data.role });
});
app.delete("/api/v1/board/users/:id", requireSuperadmin, async (c) => {
  const targetId = c.req.param("id");
  if (targetId === c.get("actor").id) {
    return jsonError(c, 400, "BAD_REQUEST", "You cannot delete your own account.");
  }
  const existing = await c.env.DB.select().from(schema_exports.authUsers).where(eq2(schema_exports.authUsers.id, targetId)).limit(1);
  if (!existing[0]) return jsonError(c, 404, "NOT_FOUND", "Account not found.");
  const activeRes = await c.env.DB.select({ id: schema_exports.reservations.id }).from(schema_exports.reservations).where(
    and2(
      eq2(schema_exports.reservations.requestedByUserId, targetId),
      inArray(schema_exports.reservations.status, ["PENDING", "APPROVED"])
    )
  ).limit(1);
  if (activeRes.length > 0) {
    return jsonError(
      c,
      409,
      "ACTIVE_RESERVATIONS",
      "Cannot delete a user with active or pending reservations."
    );
  }
  await c.env.DB.delete(schema_exports.authSessions).where(eq2(schema_exports.authSessions.userId, targetId));
  await c.env.CLIENT.execute({
    sql: "DELETE FROM account WHERE userId=?",
    args: [targetId]
  });
  await c.env.DB.delete(schema_exports.authUsers).where(eq2(schema_exports.authUsers.id, targetId));
  await c.env.CLIENT.execute({
    sql: "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES(?,?,?,?,?,?,?)",
    args: [
      randomId("audit"),
      c.get("actor").id,
      "USER",
      targetId,
      "USER_DELETED",
      Date.now(),
      JSON.stringify({ email: existing[0].email, name: existing[0].name, role: existing[0].role })
    ]
  });
  return c.json({ ok: true });
});
app.get("/api/v1/board/audit", async (c) => c.json(await listBoardAudit(c.env)));
app.notFound((c) => jsonError(c, 404, "NOT_FOUND", "API endpoint not found."));

// src/worker/runtime-env.ts
var cachedUrl;
var cachedToken;
var cachedClient;
var cachedDatabase;
function database(url, authToken) {
  if (!cachedClient || cachedUrl !== url || cachedToken !== authToken) {
    cachedClient?.close();
    cachedUrl = url;
    cachedToken = authToken;
    cachedClient = createLibSqlClient(url, authToken);
    cachedDatabase = createDatabase(cachedClient);
  }
  return { CLIENT: cachedClient, DB: cachedDatabase };
}
async function createRuntimeEnv(source = process.env) {
  const url = source.TURSO_DATABASE_URL;
  const authToken = source.TURSO_AUTH_TOKEN;
  const secret = source.BETTER_AUTH_SECRET;
  const remoteDatabase = Boolean(url && !url.startsWith("file:"));
  if (!url || !secret || secret.length < 32 || remoteDatabase && !authToken) {
    throw new Error(
      "Set TURSO_DATABASE_URL, BETTER_AUTH_SECRET (32+ characters), and a remote TURSO_AUTH_TOKEN."
    );
  }
  if (/ieee[-_]?ras[-_]?insat/i.test(url))
    throw new Error("The reservation app refuses to connect to the RAS database.");
  const vercelEnvironment = source.VERCEL_ENV;
  const environment = source.NODE_ENV === "test" ? "test" : vercelEnvironment === "production" ? "production" : vercelEnvironment === "preview" ? "preview" : "development";
  if (environment === "production" && !source.APP_ORIGIN) {
    if (source.VERCEL_PROJECT_PRODUCTION_URL) {
      source.APP_ORIGIN = `https://${source.VERCEL_PROJECT_PRODUCTION_URL}`;
    } else if (source.VERCEL_URL) {
      source.APP_ORIGIN = `https://${source.VERCEL_URL}`;
    } else {
      throw new Error("APP_ORIGIN must be set to the separate IEEE INSAT SB application origin.");
    }
  }
  const { CLIENT, DB } = database(url, authToken);
  await CLIENT.execute("PRAGMA foreign_keys = ON");
  return {
    CLIENT,
    DB,
    APP_ORIGIN: source.APP_ORIGIN,
    ENVIRONMENT: environment,
    BETTER_AUTH_SECRET: secret,
    BREVO_API_KEY: source.BREVO_API_KEY,
    BREVO_SENDER_EMAIL: source.BREVO_SENDER_EMAIL,
    BREVO_SENDER_NAME: source.BREVO_SENDER_NAME,
    CRON_SECRET: source.CRON_SECRET,
    VERCEL_URL: source.VERCEL_URL,
    VERCEL_PROJECT_PRODUCTION_URL: source.VERCEL_PROJECT_PRODUCTION_URL,
    API_RATE_LIMIT_PER_MINUTE: 1200,
    AUTH_RATE_LIMIT_PER_MINUTE: 10
  };
}

// src/worker/serverless.ts
var handler = getRequestListener((incomingRequest) => {
  const host = incomingRequest.headers.get("x-forwarded-host") || incomingRequest.headers.get("host") || "localhost";
  const proto = incomingRequest.headers.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
  const requestUrl = new URL(incomingRequest.url ?? "/", `${proto}://${host}`);
  const rewrittenPath = requestUrl.searchParams.get("__api_path");
  requestUrl.searchParams.delete("__api_path");
  if (rewrittenPath !== null) requestUrl.pathname = `/api/${rewrittenPath}`;
  if (!["localhost", "127.0.0.1"].includes(requestUrl.hostname)) {
    requestUrl.protocol = "https:";
  }
  const headers = new Headers(incomingRequest.headers);
  const clientIp = incomingRequest.headers.get("x-vercel-forwarded-for") ?? incomingRequest.headers.get("x-forwarded-for");
  headers.set("CF-Connecting-IP", clientIp?.split(",", 1)[0]?.trim() || "unknown");
  const init = {
    method: incomingRequest.method,
    headers,
    redirect: incomingRequest.redirect
  };
  if (incomingRequest.method !== "GET" && incomingRequest.method !== "HEAD" && incomingRequest.body) {
    Object.assign(init, { body: incomingRequest.body, duplex: "half" });
  }
  return createRuntimeEnv().then((env) => app.fetch(new Request(requestUrl, init), env));
});
var serverless_default = handler;
export {
  serverless_default as default
};
