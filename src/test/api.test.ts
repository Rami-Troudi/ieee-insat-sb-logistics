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
  await client.executeMultiple(
    await readFile(new URL("../../drizzle/0001_borrower_phone.sql", import.meta.url), "utf8")
  );
  await client.executeMultiple(
    await readFile(new URL("../../drizzle/0002_quantity_reservations.sql", import.meta.url), "utf8")
  );
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
  it("lets borrowers choose a password and sign in with it", async () => {
    const profile = {
      name: "New Borrower",
      email: "new@example.test",
      password: "My-chosen-password-2026",
    };
    expect(
      (await request("/api/v1/auth/borrower", sendJson({ ...profile, password: "short" }))).status
    ).toBe(400);
    const signup = await request("/api/v1/auth/borrower", sendJson(profile));
    expect(signup.status).toBe(200);
    expect(signup.headers.get("set-cookie")).toContain("session_token");
    expect((await request("/api/v1/auth/borrower", sendJson(profile))).status).toBe(409);
    expect(
      (
        await request(
          "/api/v1/auth/borrower-login",
          sendJson({ ...profile, password: "wrong-password-2026" })
        )
      ).status
    ).toBe(401);
    const login = await request("/api/v1/auth/borrower-login", sendJson(profile));
    expect(login.status).toBe(200);
    expect(login.headers.get("set-cookie")).toContain("session_token");
    const hashes = await client.execute(
      "SELECT password FROM account WHERE providerId='credential'"
    );
    expect(hashes.rows[0]?.password).not.toBe(profile.password);
  });

  it("notifies the Board on requests and borrowers before and after the return deadline", async () => {
    const now = Date.now();
    const response = await request(
      "/api/v1/reservations",
      sendJson({
        borrowerType: "PERSON",
        pickupAt: new Date(now + 60_000).toISOString(),
        returnAt: new Date(now + 1_800_000).toISOString(),
        items: [{ equipmentItemId: itemId, quantity: 1 }],
      }),
      memberCookie
    );
    const created = await response.json();
    expect(response.status).toBe(201);
    const boardNotifications = await client.execute(
      "SELECT type FROM notifications WHERE user_id='board'"
    );
    expect(boardNotifications.rows).toContainEqual(
      expect.objectContaining({ type: "NEW_RESERVATION" })
    );
    await request(
      "/api/v1/board/reservations/" + created.id + "/approve",
      sendJson({}),
      boardCookie
    );
    await client.execute("UPDATE reservations SET pickup_at=? WHERE id=?", [
      now - 1000,
      created.id,
    ]);
    await request(
      "/api/v1/board/reservations/" + created.id + "/handover",
      sendJson({ assetIds: ["asset-one"] }),
      boardCookie
    );
    await request("/api/v1/notifications/refresh", sendJson({}), memberCookie);
    await request("/api/v1/notifications/refresh", sendJson({}), memberCookie);
    await client.execute("UPDATE reservations SET pickup_at=?,return_at=? WHERE id=?", [
      now - 60_000,
      now - 1000,
      created.id,
    ]);
    await request("/api/v1/notifications/refresh", sendJson({}), memberCookie);
    await request("/api/v1/notifications/refresh", sendJson({}), memberCookie);
    const notices = await client.execute(
      "SELECT type,COUNT(*) AS count FROM notifications WHERE user_id='member' AND type IN ('RETURN_DUE_SOON','RETURN_OVERDUE') GROUP BY type"
    );
    expect(notices.rows).toHaveLength(2);
    for (const notice of notices.rows) expect(Number(notice.count)).toBe(1);
  });

  it("records manual pickup once and saves the Board member", async () => {
    const response = await request(
      "/api/v1/reservations",
      sendJson({
        borrowerType: "PERSON",
        pickupAt: new Date(Date.now() + 60_000).toISOString(),
        returnAt: new Date(Date.now() + 3_600_000).toISOString(),
        items: [{ equipmentItemId: itemId, quantity: 1 }],
      }),
      memberCookie
    );
    const created = await response.json();
    expect(response.status).toBe(201);
    await request(
      "/api/v1/board/reservations/" + created.id + "/approve",
      sendJson({}),
      boardCookie
    );
    const path = "/api/v1/board/reservations/" + created.id + "/handover";
    expect((await request(path, sendJson({ assetIds: ["asset-one"] }), memberCookie)).status).toBe(
      403
    );
    expect((await request(path, sendJson({ assetIds: ["asset-one"] }), boardCookie)).status).toBe(
      409
    );
    await client.execute("UPDATE reservations SET pickup_at=? WHERE id=?", [
      Date.now() - 1000,
      created.id,
    ]);
    expect(
      await (await request(path, sendJson({ assetIds: ["asset-one"] }), boardCookie)).json()
    ).toMatchObject({
      handedOverCount: 1,
    });
    expect((await request(path, sendJson({ assetIds: ["asset-one"] }), boardCookie)).status).toBe(
      409
    );
    const assignment = await client.execute(
      "SELECT state,checked_out_by_user_id,actual_pickup_at FROM reservation_assets WHERE reservation_id=?",
      [created.id]
    );
    expect(assignment.rows[0]).toMatchObject({
      state: "BORROWED",
      checked_out_by_user_id: "board",
      actual_pickup_at: expect.any(Number),
    });
  });

  it("scans all reservation materials for pickup and return, rejecting repeat pickups", async () => {
    const now = Date.now();
    const secondToken = "b".repeat(64);
    await client.execute({
      sql: "INSERT INTO assets(id,equipment_item_id,asset_code,qr_token,state,active,created_at,updated_at) VALUES('asset-two',?,?,?,'AVAILABLE',1,?,?)",
      args: [itemId, "SB-METER-02", secondToken, now, now],
    });
    const response = await request(
      "/api/v1/reservations",
      sendJson({
        borrowerType: "PERSON",
        pickupAt: new Date(now + 60_000).toISOString(),
        returnAt: new Date(now + 3_600_000).toISOString(),
        items: [{ equipmentItemId: itemId, quantity: 2 }],
      }),
      memberCookie
    );
    const created = await response.json();
    expect(response.status).toBe(201);
    expect(
      (
        await request(
          "/api/v1/board/reservations/" + created.id + "/approve",
          sendJson({}),
          boardCookie
        )
      ).status
    ).toBe(200);
    await client.execute("UPDATE reservations SET pickup_at=? WHERE id=?", [
      now - 1000,
      created.id,
    ]);
    const scan = (token: string, operation: string, reservationId = created.id) =>
      request(
        "/api/v1/board/scan",
        {
          ...sendJson({ qrToken: token, operation, reservationId }),
          headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        },
        boardCookie
      );
    expect((await scan(qrToken, "CHECKED_OUT", "wrong-reservation")).status).toBe(404);
    expect((await scan(qrToken, "CHECKED_OUT")).status).toBe(200);
    expect((await scan(qrToken, "CHECKED_OUT")).status).toBe(409);
    expect((await scan(secondToken, "CHECKED_OUT")).status).toBe(200);
    await client.execute("UPDATE assets SET last_scan_at=?", [now - 4000]);
    expect((await scan(qrToken, "RETURNED")).status).toBe(200);
    const partial = await request("/api/v1/board/reservations/" + created.id, {}, boardCookie);
    expect(await partial.json()).toMatchObject({ status: "APPROVED", returnedCount: 1 });
    expect((await scan(qrToken, "RETURNED")).status).toBe(409);
    expect((await scan(secondToken, "RETURNED")).status).toBe(200);
    expect(
      await (await request("/api/v1/board/reservations/" + created.id, {}, boardCookie)).json()
    ).toMatchObject({ status: "COMPLETED", returnedCount: 2 });
    const records = await client.execute(
      "SELECT checked_out_by_user_id,checked_in_by_user_id,actual_pickup_at,actual_return_at FROM reservation_assets WHERE reservation_id=?",
      [created.id]
    );
    expect(records.rows).toHaveLength(2);
    for (const record of records.rows)
      expect(record).toMatchObject({
        checked_out_by_user_id: "board",
        checked_in_by_user_id: "board",
        actual_pickup_at: expect.any(Number),
        actual_return_at: expect.any(Number),
      });
  });

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
      items: [{ assignedAssets: [] }],
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
      { title: expect.stringContaining("1 units"), assetCode: "1 units" },
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
        ...sendJson({ qrToken, reservationId: created.id, operation: "CHECKED_OUT" }),
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
        ...sendJson({ qrToken, reservationId: created.id, operation: "CHECKED_OUT" }),
        headers: { "Content-Type": "application/json", "Idempotency-Key": "checkout-key-0002" },
      },
      boardCookie
    );
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).error.code).toBe("INVALID_CHECKOUT");

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

  it("force deletes a reservation and releases allocated assets back to available", async () => {
    const pickupAt = new Date(Date.now() + 48 * 60 * 60_000).toISOString();
    const returnAt = new Date(Date.parse(pickupAt) + 2 * 60 * 60_000).toISOString();

    const createdRes = await request(
      "/api/v1/reservations",
      sendJson({
        borrowerType: "PERSON",
        pickupAt,
        returnAt,
        items: [{ equipmentItemId: itemId, quantity: 1 }],
      }),
      memberCookie
    );
    expect(createdRes.status).toBe(201);
    const created = await createdRes.json();

    const approvedRes = await request(
      `/api/v1/board/reservations/${created.id}/approve`,
      sendJson({}),
      boardCookie
    );
    expect(approvedRes.status).toBe(200);

    // Verify asset is now RESERVED
    const assetCheckBefore = await client.execute("SELECT state FROM assets WHERE id='asset-one'");
    expect(assetCheckBefore.rows[0]?.state).toBe("AVAILABLE");

    // Force delete as board
    const deleteRes = await request(
      `/api/v1/board/reservations/${created.id}/force`,
      { method: "DELETE" },
      boardCookie
    );
    expect(deleteRes.status).toBe(200);
    expect(await deleteRes.json()).toMatchObject({ ok: true, id: created.id });

    // Verify asset is restored to AVAILABLE
    const assetCheckAfter = await client.execute("SELECT state FROM assets WHERE id='asset-one'");
    expect(assetCheckAfter.rows[0]?.state).toBe("AVAILABLE");

    // Verify reservation and child records are completely gone
    const resRow = await client.execute("SELECT * FROM reservations WHERE id=?", [created.id]);
    expect(resRow.rows.length).toBe(0);
    const linesRow = await client.execute(
      "SELECT * FROM reservation_lines WHERE reservation_id=?",
      [created.id]
    );
    expect(linesRow.rows.length).toBe(0);
    const assetsRow = await client.execute(
      "SELECT * FROM reservation_assets WHERE reservation_id=?",
      [created.id]
    );
    expect(assetsRow.rows.length).toBe(0);

    // Verify audit log
    const auditRow = await client.execute(
      "SELECT action FROM audit_events WHERE entity_id=? AND action='RESERVATION_FORCE_DELETED'",
      [created.id]
    );
    expect(auditRow.rows.length).toBe(1);
  });
});
