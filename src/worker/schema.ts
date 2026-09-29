import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const authUsers = sqliteTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: integer("emailVerified", { mode: "boolean" }).notNull().default(false),
    image: text("image"),
    role: text("role", { enum: ["USER", "BOARD", "SUPERADMIN"] })
      .notNull()
      .default("USER"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [uniqueIndex("user_email").on(table.email), index("user_role").on(table.role)]
);

export const authSessions = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
    ipAddress: text("ipAddress"),
    userAgent: text("userAgent"),
    userId: text("userId")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("session_token").on(table.token),
    index("session_user_id").on(table.userId),
  ]
);

export const authAccounts = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("accountId").notNull(),
    providerId: text("providerId").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    accessToken: text("accessToken"),
    refreshToken: text("refreshToken"),
    idToken: text("idToken"),
    accessTokenExpiresAt: integer("accessTokenExpiresAt", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refreshTokenExpiresAt", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("account_user_id").on(table.userId)]
);

export const authVerifications = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }),
  },
  (table) => [index("verification_identifier").on(table.identifier)]
);

export const authRateLimits = sqliteTable(
  "rateLimit",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    count: integer("count").notNull(),
    lastRequest: integer("lastRequest").notNull(),
  },
  (table) => [uniqueIndex("rate_limit_key").on(table.key)]
);

export const chapters = sqliteTable(
  "chapters",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    shortCode: text("short_code").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("chapters_name").on(table.name),
    uniqueIndex("chapters_short_code").on(table.shortCode),
  ]
);

export const equipmentItems = sqliteTable(
  "equipment_items",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    category: text("category").notNull(),
    imageUrl: text("image_url"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("equipment_active_name").on(table.active, table.name)]
);

export const assets = sqliteTable(
  "assets",
  {
    id: text("id").primaryKey(),
    equipmentItemId: text("equipment_item_id")
      .notNull()
      .references(() => equipmentItems.id, { onDelete: "restrict" }),
    assetCode: text("asset_code").notNull(),
    qrToken: text("qr_token").notNull(),
    serialNumber: text("serial_number"),
    state: text("state", {
      enum: ["AVAILABLE", "RESERVED", "BORROWED", "OUT_OF_SERVICE", "RETIRED"],
    })
      .notNull()
      .default("AVAILABLE"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    lastScanAt: integer("last_scan_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("assets_code").on(table.assetCode),
    uniqueIndex("assets_qr_token").on(table.qrToken),
    uniqueIndex("assets_serial_number").on(table.serialNumber),
    index("assets_item_state").on(table.equipmentItemId, table.state, table.active),
  ]
);

export const reservations = sqliteTable(
  "reservations",
  {
    id: text("id").primaryKey(),
    requestedByUserId: text("requested_by_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    borrowerType: text("borrower_type", { enum: ["PERSON", "CHAPTER"] }).notNull(),
    borrowerUserId: text("borrower_user_id").references(() => authUsers.id, {
      onDelete: "restrict",
    }),
    chapterId: text("chapter_id").references(() => chapters.id, { onDelete: "restrict" }),
    pickupAt: integer("pickup_at").notNull(),
    returnAt: integer("return_at").notNull(),
    note: text("note"),
    status: text("status", {
      enum: ["PENDING", "APPROVED", "DECLINED", "CANCELLED", "COMPLETED"],
    })
      .notNull()
      .default("PENDING"),
    approvedByUserId: text("approved_by_user_id").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
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
    ),
  ]
);

export const reservationLines = sqliteTable(
  "reservation_lines",
  {
    id: text("id").primaryKey(),
    reservationId: text("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "cascade" }),
    equipmentItemId: text("equipment_item_id")
      .notNull()
      .references(() => equipmentItems.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
  },
  (table) => [
    uniqueIndex("reservation_line_equipment").on(table.reservationId, table.equipmentItemId),
    index("reservation_lines_equipment").on(table.equipmentItemId),
    check("reservation_line_quantity", sql`${table.quantity} > 0`),
  ]
);

export const reservationAssets = sqliteTable(
  "reservation_assets",
  {
    id: text("id").primaryKey(),
    reservationId: text("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "restrict" }),
    reservationLineId: text("reservation_line_id")
      .notNull()
      .references(() => reservationLines.id, { onDelete: "restrict" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "restrict" }),
    state: text("state", { enum: ["RESERVED", "BORROWED", "RETURNED", "RELEASED"] })
      .notNull()
      .default("RESERVED"),
    actualPickupAt: integer("actual_pickup_at"),
    checkedOutByUserId: text("checked_out_by_user_id").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    actualReturnAt: integer("actual_return_at"),
    checkedInByUserId: text("checked_in_by_user_id").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("reservation_asset_once").on(table.reservationId, table.assetId),
    index("reservation_assets_asset").on(table.assetId),
    index("reservation_assets_reservation").on(table.reservationId),
    index("reservation_assets_line").on(table.reservationLineId),
  ]
);

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    reservationId: text("reservation_id").references(() => reservations.id, {
      onDelete: "set null",
    }),
    readAt: integer("read_at"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("notifications_user_created").on(table.userId, table.createdAt)]
);

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    createdAt: integer("created_at").notNull(),
    data: text("data", { mode: "json" }).notNull().default("{}"),
  },
  (table) => [
    index("audit_entity_time").on(table.entityType, table.entityId, table.createdAt),
    index("audit_actor_time").on(table.actorUserId, table.createdAt),
  ]
);

export const idempotencyKeys = sqliteTable(
  "idempotency_keys",
  {
    actorId: text("actor_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    operation: text("operation").notNull(),
    key: text("key").notNull(),
    response: text("response", { mode: "json" }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.actorId, table.operation, table.key] }),
    index("idempotency_created").on(table.createdAt),
  ]
);

export const rateLimitBuckets = sqliteTable("rate_limit_buckets", {
  keyHash: text("key_hash").primaryKey(),
  windowStart: integer("window_start").notNull(),
  count: integer("count").notNull(),
});

export const authSchema = {
  user: authUsers,
  session: authSessions,
  account: authAccounts,
  verification: authVerifications,
  rateLimit: authRateLimits,
};

export const schema = {
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
  rateLimitBuckets,
};
