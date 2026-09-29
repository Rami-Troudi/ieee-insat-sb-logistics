// @vitest-environment node
import { createClient, type Client } from "@libsql/client";
import { serializeSignedCookie } from "better-call";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { app } from "../worker/index";
import { createDatabase } from "../worker/database";
import type { Env, UserRole } from "../worker/env";

const origin = "https://app.test";
const secret = "reservation-test-secret-more-than-32-characters";
let client: Client;
let env: Env;
let memberCookie: string;
let boardCookie: string;
let itemId: string;
let qrToken: string;

async function seedUser(id: string, role: UserRole) {
  const now = Date.now();
  const email = id + "@example.test";
  await client.execute({
    sql: "INSERT INTO user(id,name,email,emailVerified,role,createdAt,updatedAt) VALUES(?,?,?,1,?,?,?)",
    args: [id, id, email, role, now, now],
  });
  const token = "session-" + id;
  await client.execute({
    sql: "INSERT INTO session(id,expiresAt,token,createdAt,updatedAt,userId) VALUES(?,?,?,?,?,?)",
    args: ["row-" + id, now + 60 * 60_000, token, now, now, id],
  });
  const cookie = await serializeSignedCookie("__Secure-better-auth.session_token", token, secret, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: true,
  });
  return cookie.split(";")[0];
}

async function request(path: string, options: RequestInit = {}, cookie?: string) {
  const headers = new Headers(options.headers);
  if (cookie) headers.set("Cookie", cookie);
  if (options.method && options.method !== "GET" && !headers.has("Origin"))
    headers.set("Origin", origin);
  return app.request(origin + path, { ...options, headers }, env);
}

const sendJson = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

beforeEach(async () => {
  client = createClient({ url: "file::memory:" });
  await client.execute("PRAGMA foreign_keys = ON");
  const migration = await readFile(
    new URL("../../drizzle/0000_sb_reservations.sql", import.meta.url),
    "utf8"
  );
  await client.executeMultiple(migration);
  env = {
    CLIENT: client,
    DB: createDatabase(client),
    APP_ORIGIN: origin,
    ENVIRONMENT: "test",
    BETTER_AUTH_SECRET: secret,
    API_RATE_LIMIT_PER_MINUTE: 1200,
    AUTH_RATE_LIMIT_PER_MINUTE: 20,
  };
  memberCookie = await seedUser("member", "USER");
  boardCookie = await seedUser("board", "BOARD");
  itemId = "equipment-meter";
  qrToken = "a".repeat(64);
  const now = Date.now();
  await client.execute({
    sql: "INSERT INTO equipment_items(id,name,description,category,active,created_at,updated_at) VALUES(?,?,?,'Measurement',1,?,?)",
    args: [itemId, "Digital multimeter", "Test meter", now, now],
  });
  await client.execute({
    sql: "INSERT INTO assets(id,equipment_item_id,asset_code,qr_token,state,active,created_at,updated_at) VALUES('asset-one',?,?,?,'AVAILABLE',1,?,?)",
    args: [itemId, "SB-METER-01", qrToken, now, now],
  });
  await client.execute({
    sql: "INSERT INTO chapters(id,name,short_code,active,created_at,updated_at) VALUES('chapter-robotics','Robotics Club','ROBO',1,?,?)",
    args: [now, now],
  });
});

afterEach(() => client.close());

describe("reservation API against a real libSQL database", () => {
  it("serves catalogue data and protects member and Board routes", async () => {
    const health = await request("/api/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });
    expect((await request("/api/v1/me")).status).toBe(200);
    expect(await (await request("/api/v1/me", {}, memberCookie)).json()).toMatchObject({
      user: { id: "member", role: "USER" },
    });
    const catalogue = await request("/api/v1/catalogue");
    expect(catalogue.status).toBe(200);
    expect(await catalogue.json()).toMatchObject([
      { id: itemId, name: "Digital multimeter", availableQuantity: 1 },
    ]);
    expect((await request("/api/v1/board/dashboard", {}, memberCookie)).status).toBe(403);
  });

  it("creates, approves, checks out, returns, and rejects an overlapping allocation", async () => {
    const pickupAt = new Date(Date.now() + 60 * 60_000).toISOString();
    const returnAt = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
    const body = {
      borrowerType: "PERSON",
      pickupAt,
      returnAt,
      items: [{ equipmentItemId: itemId, quantity: 1 }],
    };
    const createdResponse = await request("/api/v1/reservations", sendJson(body), memberCookie);
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json();
    const competingResponse = await request("/api/v1/reservations", sendJson(body), memberCookie);
    expect(competingResponse.status).toBe(201);
    const competing = await competingResponse.json();

    const approvedResponse = await request(
      "/api/v1/board/reservations/" + created.id + "/approve",
      sendJson({}),
      boardCookie
    );
    expect(approvedResponse.status).toBe(200);
    expect(await approvedResponse.json()).toMatchObject({
      status: "APPROVED",
      items: [{ assignedAssets: [{ assetCode: "SB-METER-01", state: "RESERVED" }] }],
    });
    const calendar = await request(
      "/api/v1/board/calendar?start=" +
        encodeURIComponent(new Date(Date.now()).toISOString()) +
        "&end=" +
        encodeURIComponent(new Date(Date.now() + 3 * 60 * 60_000).toISOString()),
      {},
      boardCookie
    );
    expect(calendar.status).toBe(200);
    expect(await calendar.json()).toMatchObject([
      { title: expect.stringContaining("SB-METER-01"), assetCode: "SB-METER-01" },
    ]);
    const conflict = await request(
      "/api/v1/board/reservations/" + competing.id + "/approve",
      sendJson({}),
      boardCookie
    );
    expect(conflict.status).toBe(409);

    const now = Date.now();
    await client.execute({
      sql: "UPDATE reservations SET pickup_at=?,return_at=? WHERE id=?",
      args: [now - 1_000, now + 3_600_000, created.id],
    });
    const checkout = await request(
      "/api/v1/board/scan",
      {
        ...sendJson({ qrToken }),
        headers: { "Content-Type": "application/json", "Idempotency-Key": "checkout-key-0001" },
      },
      boardCookie
    );
    expect(checkout.status).toBe(200);
    expect(await checkout.json()).toMatchObject({
      operation: "CHECKED_OUT",
      assetCode: "SB-METER-01",
    });

    const duplicate = await request(
      "/api/v1/board/scan",
      {
        ...sendJson({ qrToken }),
        headers: { "Content-Type": "application/json", "Idempotency-Key": "checkout-key-0002" },
      },
      boardCookie
    );
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).error.code).toBe("DUPLICATE_SCAN");

    await client.execute({
      sql: "UPDATE assets SET last_scan_at=? WHERE id='asset-one'",
      args: [Date.now() - 4_000],
    });
    const returned = await request(
      "/api/v1/board/scan",
      {
        ...sendJson({ qrToken }),
        headers: { "Content-Type": "application/json", "Idempotency-Key": "return-key-0001" },
      },
      boardCookie
    );
    expect(returned.status).toBe(200);
    expect(await returned.json()).toMatchObject({
      operation: "RETURNED",
      assetCode: "SB-METER-01",
    });
    const rows = await client.execute(
      "SELECT state FROM reservation_assets WHERE reservation_id=?",
      [created.id]
    );
    expect(rows.rows[0]?.state).toBe("RETURNED");
    const audit = await client.execute(
      "SELECT COUNT(*) AS count FROM audit_events WHERE entity_type='ASSET'"
    );
    expect(Number(audit.rows[0]?.count)).toBe(2);
  });

  it("supports chapter reservations and blocks requests from another origin", async () => {
    const pickupAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
    const response = await request(
      "/api/v1/reservations",
      sendJson({
        borrowerType: "CHAPTER",
        chapterId: "chapter-robotics",
        pickupAt,
        returnAt: new Date(Date.parse(pickupAt) + 60 * 60_000).toISOString(),
        items: [{ equipmentItemId: itemId, quantity: 1 }],
      }),
      memberCookie
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      borrower: { type: "CHAPTER", name: "Robotics Club" },
    });
    const crossOrigin = await request(
      "/api/v1/reservations",
      {
        ...sendJson({}),
        headers: { "Content-Type": "application/json", Origin: "https://evil.test" },
      },
      memberCookie
    );
    expect(crossOrigin.status).toBe(403);
  });
});
