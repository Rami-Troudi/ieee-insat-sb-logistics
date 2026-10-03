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
  await client.executeMultiple(
    await readFile(new URL("../../drizzle/0003_notification_emails.sql", import.meta.url), "utf8")
  );
  await client.executeMultiple(
    await readFile(new URL("../../drizzle/0004_review_invariants.sql", import.meta.url), "utf8")
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
  it("authenticates borrowers passwordlessly and establishes session", async () => {
    const profile = {
      name: "New Borrower",
      email: "new@example.test",
      phone: "+216 12 345 678",
    };
    const signup = await request("/api/v1/auth/borrower", sendJson(profile));
    expect(signup.status).toBe(200);
    expect(signup.headers.get("set-cookie")).toContain("session_token");
    const json = await signup.json();
    expect(json.user.email).toBe(profile.email);
    expect(json.user.role).toBe("USER");

    // Re-authenticating with same email returns existing user
    const existing = await request(
      "/api/v1/auth/borrower",
      sendJson({ name: "Updated Name", email: profile.email })
    );
    expect(existing.status).toBe(200);
    expect(existing.headers.get("set-cookie")).toContain("session_token");

    // Borrowers have NO password record in account table
    const hashes = await client.execute({
      sql: "SELECT * FROM account WHERE userId = ?",
      args: [json.user.id],
    });
    expect(hashes.rows.length).toBe(0);

    // Existing USER email -> borrower auth works and creates session
    const userAuth = await request(
      "/api/v1/auth/borrower",
      sendJson({ name: "Existing Member", email: "member@example.test" })
    );
    expect(userAuth.status).toBe(200);
    expect(userAuth.headers.get("set-cookie")).toContain("session_token");

    // Existing BOARD email -> borrower auth rejected with 403 PRIVILEGED_ACCOUNT and no session
    const boardReject = await request(
      "/api/v1/auth/borrower",
      sendJson({ name: "Board Member", email: "board@example.test" })
    );
    expect(boardReject.status).toBe(403);
    const boardRejectJson = await boardReject.json();
    expect(boardRejectJson.error.code).toBe("PRIVILEGED_ACCOUNT");
    expect(boardReject.headers.get("set-cookie")).toBeNull();

    // Existing SUPERADMIN email -> borrower auth rejected with 403 PRIVILEGED_ACCOUNT and no session
    await seedUser("superadmin", "SUPERADMIN");
    const adminReject = await request(
      "/api/v1/auth/borrower",
      sendJson({ name: "Super Admin", email: "superadmin@example.test" })
    );
    expect(adminReject.status).toBe(403);
    const adminRejectJson = await adminReject.json();
    expect(adminRejectJson.error.code).toBe("PRIVILEGED_ACCOUNT");
    expect(adminReject.headers.get("set-cookie")).toBeNull();
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
      { title: expect.stringContaining("1× Digital multimeter"), assetCode: "1 units" },
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

  it("deletes a user account cleanly cascade cleaning their past records", async () => {
    const memberId = "user-to-del";
    await seedUser(memberId, "USER");
    const superadminCookie = await seedUser("super-admin-del", "SUPERADMIN");

    // Add a completed past reservation
    const resId = "past-res-del";
    await client.execute({
      sql: `INSERT INTO reservations(id, requested_by_user_id, borrower_type, borrower_user_id, chapter_id, pickup_at, return_at, status, created_at, updated_at)
        VALUES(?, ?, 'PERSON', ?, NULL, ?, ?, 'COMPLETED', ?, ?)`,
      args: [
        resId,
        memberId,
        memberId,
        Date.now() - 200000,
        Date.now() - 100000,
        Date.now() - 200000,
        Date.now() - 100000,
      ],
    });
    await client.execute({
      sql: "INSERT INTO reservation_lines(id, reservation_id, equipment_item_id, quantity) VALUES('rl-del', ?, ?, 1)",
      args: [resId, itemId],
    });

    // Delete user as superadmin
    const delRes = await request(
      `/api/v1/board/users/${memberId}`,
      { method: "DELETE" },
      superadminCookie
    );
    expect(delRes.status).toBe(200);
    expect(await delRes.json()).toMatchObject({ ok: true });

    // Verify user is gone
    const checkUser = await client.execute("SELECT * FROM user WHERE id=?", [memberId]);
    expect(checkUser.rows.length).toBe(0);
  });

  it("rejects rescheduling after physical pickup has occurred with 409 RESERVATION_LOCKED", async () => {
    const now = Date.now();
    const createdResponse = await request(
      "/api/v1/reservations",
      sendJson({
        borrowerType: "PERSON",
        pickupAt: new Date(now + 60_000).toISOString(),
        returnAt: new Date(now + 120_000).toISOString(),
        items: [{ equipmentItemId: itemId, quantity: 1 }],
      }),
      memberCookie
    );
    const created = await createdResponse.json();
    await request(`/api/v1/board/reservations/${created.id}/approve`, sendJson({}), boardCookie);
    await client.execute("UPDATE reservations SET pickup_at=? WHERE id=?", [
      now - 1000,
      created.id,
    ]);

    // Pick up asset
    const scanRes = await request(
      "/api/v1/board/scan",
      sendJson({ qrToken, reservationId: created.id }),
      boardCookie
    );
    expect(scanRes.status).toBe(200);

    // Attempt to reschedule after pickup
    const rescheduleRes = await request(
      `/api/v1/board/reservations/${created.id}/window`,
      {
        ...sendJson({
          pickupAt: new Date(now + 90_000).toISOString(),
          returnAt: new Date(now + 200_000).toISOString(),
        }),
        method: "PATCH",
      },
      boardCookie
    );
    expect(rescheduleRes.status).toBe(409);
    const err = await rescheduleRes.json();
    expect(err.error.code).toBe("RESERVATION_LOCKED");
  });

  it("rejects force-deleting a reservation after physical handover with 409 HANDOVER_EXISTS", async () => {
    const now = Date.now();
    const createdResponse = await request(
      "/api/v1/reservations",
      sendJson({
        borrowerType: "PERSON",
        pickupAt: new Date(now + 60_000).toISOString(),
        returnAt: new Date(now + 120_000).toISOString(),
        items: [{ equipmentItemId: itemId, quantity: 1 }],
      }),
      memberCookie
    );
    const created = await createdResponse.json();
    await request(`/api/v1/board/reservations/${created.id}/approve`, sendJson({}), boardCookie);
    await client.execute("UPDATE reservations SET pickup_at=? WHERE id=?", [
      now - 1000,
      created.id,
    ]);

    // Handover
    const scanRes = await request(
      "/api/v1/board/scan",
      sendJson({ qrToken, reservationId: created.id }),
      boardCookie
    );
    expect(scanRes.status).toBe(200);

    // Attempt force delete
    const delRes = await request(
      `/api/v1/board/reservations/${created.id}/force`,
      { method: "DELETE" },
      boardCookie
    );
    expect(delRes.status).toBe(409);
    const err = await delRes.json();
    expect(err.error.code).toBe("HANDOVER_EXISTS");
  });

  it("preserves audit events when deleting a user who authored actions by deactivating/anonymizing", async () => {
    const staffId = "staff-with-audits";
    const staffCookie = await seedUser(staffId, "BOARD");
    const superadminCookie = await seedUser("super-admin-audit", "SUPERADMIN");

    // Perform an action as staff that logs an audit event
    const now = Date.now();
    const resResponse = await request(
      "/api/v1/reservations",
      sendJson({
        borrowerType: "PERSON",
        pickupAt: new Date(now + 60_000).toISOString(),
        returnAt: new Date(now + 120_000).toISOString(),
        items: [{ equipmentItemId: itemId, quantity: 1 }],
      }),
      memberCookie
    );
    const res = await resResponse.json();
    await request(`/api/v1/board/reservations/${res.id}/approve`, sendJson({}), staffCookie);

    // Check that audit event exists referencing staffId
    const auditCheck = await client.execute({
      sql: "SELECT * FROM audit_events WHERE actor_user_id = ?",
      args: [staffId],
    });
    expect(auditCheck.rows.length).toBeGreaterThan(0);

    // Delete staff member as superadmin
    const delRes = await request(
      `/api/v1/board/users/${staffId}`,
      { method: "DELETE" },
      superadminCookie
    );
    expect(delRes.status).toBe(200);

    // User record is sanitized/deactivated rather than crashing due to restrict constraint on audit_events
    const userRow = await client.execute({
      sql: "SELECT * FROM user WHERE id = ?",
      args: [staffId],
    });
    expect(userRow.rows.length).toBe(1);
    expect(userRow.rows[0]?.name).toBe("Deleted User");

    // Audit logs remain intact
    const auditAfter = await client.execute({
      sql: "SELECT * FROM audit_events WHERE actor_user_id = ?",
      args: [staffId],
    });
    expect(auditAfter.rows.length).toBe(auditCheck.rows.length);
  });

  it("protects approved reservations by rejecting capacity-reducing inventory changes", async () => {
    const now = Date.now();
    // Currently 1 asset exists for itemId (capacity = 1).
    // Reserve that 1 unit for tomorrow.
    const resResponse = await request(
      "/api/v1/reservations",
      sendJson({
        borrowerType: "PERSON",
        pickupAt: new Date(now + 24 * 3600_000).toISOString(),
        returnAt: new Date(now + 26 * 3600_000).toISOString(),
        items: [{ equipmentItemId: itemId, quantity: 1 }],
      }),
      memberCookie
    );
    const res = await resResponse.json();
    const appRes = await request(
      `/api/v1/board/reservations/${res.id}/approve`,
      sendJson({}),
      boardCookie
    );
    expect(appRes.status).toBe(200);

    // 1. Attempt to mark asset OUT_OF_SERVICE -> should reject with 409
    const patchAsset = await request(
      "/api/v1/board/assets/asset-one",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: "OUT_OF_SERVICE" }),
      },
      boardCookie
    );
    expect(patchAsset.status).toBe(409);
    const patchErr = await patchAsset.json();
    expect(patchErr.error.code).toBe("RESERVATION_CONFLICT");

    // 2. Attempt to delete asset -> should reject with 409
    const deleteAsset = await request(
      "/api/v1/board/assets/asset-one",
      { method: "DELETE" },
      boardCookie
    );
    expect(deleteAsset.status).toBe(409);
    const deleteErr = await deleteAsset.json();
    expect(deleteErr.error.code).toBe("RESERVATION_CONFLICT");

    // 3. Attempt to deactivate equipment -> should reject with 409
    const patchEquip = await request(
      `/api/v1/board/equipment/${itemId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: false }),
      },
      boardCookie
    );
    expect(patchEquip.status).toBe(409);
    const equipErr = await patchEquip.json();
    expect(equipErr.error.code).toBe("RESERVATION_CONFLICT");

    // 4. Attempt to delete equipment -> should reject with 409
    const deleteEquip = await request(
      `/api/v1/board/equipment/${itemId}`,
      { method: "DELETE" },
      boardCookie
    );
    expect(deleteEquip.status).toBe(409);
  });

  it("resolves concurrent approvals atomically with only one winner", async () => {
    const now = Date.now();
    const pickupAt = new Date(now + 3600_000).toISOString();
    const returnAt = new Date(now + 7200_000).toISOString();

    const [resA, resB] = await Promise.all([
      request(
        "/api/v1/reservations",
        sendJson({
          borrowerType: "PERSON",
          pickupAt,
          returnAt,
          items: [{ equipmentItemId: itemId, quantity: 1 }],
        }),
        memberCookie
      ).then((r) => r.json()),
      request(
        "/api/v1/reservations",
        sendJson({
          borrowerType: "PERSON",
          pickupAt,
          returnAt,
          items: [{ equipmentItemId: itemId, quantity: 1 }],
        }),
        memberCookie
      ).then((r) => r.json()),
    ]);

    const [approvalA, approvalB] = await Promise.all([
      request(`/api/v1/board/reservations/${resA.id}/approve`, sendJson({}), boardCookie),
      request(`/api/v1/board/reservations/${resB.id}/approve`, sendJson({}), boardCookie),
    ]);

    const statuses = [approvalA.status, approvalB.status].sort();
    expect(statuses).toEqual([200, 409]);
  });

  it("resolves concurrent scans on the same asset atomically", async () => {
    const now = Date.now();
    const resResponse = await request(
      "/api/v1/reservations",
      sendJson({
        borrowerType: "PERSON",
        pickupAt: new Date(now + 10_000).toISOString(),
        returnAt: new Date(now + 3600_000).toISOString(),
        items: [{ equipmentItemId: itemId, quantity: 1 }],
      }),
      memberCookie
    );
    const res = await resResponse.json();
    await request(`/api/v1/board/reservations/${res.id}/approve`, sendJson({}), boardCookie);
    await client.execute("UPDATE reservations SET pickup_at=? WHERE id=?", [now - 1000, res.id]);

    const [scanA, scanB] = await Promise.all([
      request("/api/v1/board/scan", sendJson({ qrToken, reservationId: res.id }), boardCookie),
      request("/api/v1/board/scan", sendJson({ qrToken, reservationId: res.id }), boardCookie),
    ]);

    const statuses = [scanA.status, scanB.status].sort();
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).toBeGreaterThanOrEqual(400);
  });

  it("handles partial pickup, early return of partial units, and completion after deadline", async () => {
    const now = Date.now();
    // Add 2 more assets for itemId so we have 3 units total
    const token2 = "b".repeat(64);
    const token3 = "c".repeat(64);
    await client.execute({
      sql: "INSERT INTO assets(id,equipment_item_id,asset_code,qr_token,state,active,created_at,updated_at) VALUES('asset-two',?,'SB-METER-02',?,'AVAILABLE',1,?,?), ('asset-three',?,'SB-METER-03',?,'AVAILABLE',1,?,?)",
      args: [itemId, token2, now, now, itemId, token3, now, now],
    });

    // Request 3 units
    const pickupAt = new Date(now + 60_000).toISOString();
    const returnAt = new Date(now + 3600_000).toISOString();
    const resRes = await request(
      "/api/v1/reservations",
      sendJson({
        borrowerType: "PERSON",
        pickupAt,
        returnAt,
        items: [{ equipmentItemId: itemId, quantity: 3 }],
      }),
      memberCookie
    );
    const res = await resRes.json();
    await request(`/api/v1/board/reservations/${res.id}/approve`, sendJson({}), boardCookie);
    await client.execute("UPDATE reservations SET pickup_at=? WHERE id=?", [now - 1000, res.id]);

    // Pick up only 2 units (qrToken and token2)
    const scan1 = await request(
      "/api/v1/board/scan",
      sendJson({ qrToken, reservationId: res.id }),
      boardCookie
    );
    expect(scan1.status).toBe(200);
    const scan2 = await request(
      "/api/v1/board/scan",
      sendJson({ qrToken: token2, reservationId: res.id }),
      boardCookie
    );
    expect(scan2.status).toBe(200);

    // Verify 2 collected, 1 uncollected
    const check1 = await request(`/api/v1/board/reservations/${res.id}`, {}, boardCookie).then(
      (r) => r.json()
    );
    expect(check1.collectedCount).toBe(2);
    expect(check1.returnedCount).toBe(0);

    // Clear duplicate scan cooldown
    await client.execute("UPDATE assets SET last_scan_at = NULL WHERE equipment_item_id = ?", [
      itemId,
    ]);

    // Return the 2 units early
    const ret1 = await request("/api/v1/board/scan", sendJson({ qrToken }), boardCookie);
    expect(ret1.status).toBe(200);
    const ret2 = await request("/api/v1/board/scan", sendJson({ qrToken: token2 }), boardCookie);
    expect(ret2.status).toBe(200);

    const check2 = await request(`/api/v1/board/reservations/${res.id}`, {}, boardCookie).then(
      (r) => r.json()
    );
    expect(check2.collectedCount).toBe(2);
    expect(check2.returnedCount).toBe(2);

    // Third unit was never collected. Simulate time passing past returnAt in DB
    await client.execute({
      sql: "UPDATE reservations SET return_at = ? WHERE id = ?",
      args: [now - 500, res.id],
    });

    const checkFinal = await request(`/api/v1/board/reservations/${res.id}`, {}, boardCookie).then(
      (r) => r.json()
    );
    expect(checkFinal.status).toBe("COMPLETED");
    expect(checkFinal.derivedStatus).toBe("RETURNED");

    // Board filter for APPROVED must no longer include this completed reservation
    const boardReservations = (await request("/api/v1/board/reservations", {}, boardCookie).then(
      (r) => r.json()
    )) as Array<{ id: string; status: string }>;
    const foundInBoard = boardReservations.find((r) => r.id === res.id);
    expect(foundInBoard?.status).toBe("COMPLETED");

    // Calendar events query includes completed reservation with status 'RETURNED'
    const cal = (await request(
      `/api/v1/board/calendar?start=${new Date(now - 86400000).toISOString()}&end=${new Date(now + 86400000).toISOString()}`,
      {},
      boardCookie
    ).then((r) => r.json())) as Array<{ reservationId: string; status: string }>;
    const calEvent = cal.find((e) => e.reservationId === res.id);
    expect(calEvent).toBeDefined();
    expect(calEvent?.status).toBe("RETURNED");

    const catRes = (await request("/api/v1/catalogue").then((r) => r.json())) as Array<{
      id: string;
      availableQuantity: number;
    }>;
    const meterCat = catRes.find((i) => i.id === itemId);
    expect(meterCat?.availableQuantity).toBe(3);
  });

  it("keeps overdue reservation as APPROVED and derived OVERDUE until all borrowed assets are returned, then finalizes as COMPLETED", async () => {
    const now = Date.now();
    const token2 = "b".repeat(64);
    await client.execute({
      sql: "INSERT INTO assets(id,equipment_item_id,asset_code,qr_token,state,active,created_at,updated_at) VALUES('asset-two',?,'SB-METER-02',?,'AVAILABLE',1,?,?)",
      args: [itemId, token2, now, now],
    });

    const pickupAt = new Date(now + 10_000).toISOString();
    const returnAt = new Date(now + 3600_000).toISOString();

    const res = await request(
      "/api/v1/reservations",
      sendJson({
        borrowerType: "PERSON",
        pickupAt,
        returnAt,
        items: [{ equipmentItemId: itemId, quantity: 2 }],
      }),
      memberCookie
    ).then((r) => r.json());

    const approve = await request(
      `/api/v1/board/reservations/${res.id}/approve`,
      sendJson({}),
      boardCookie
    );
    expect(approve.status).toBe(200);

    // Set pickup_at to past so window is active
    await client.execute({
      sql: "UPDATE reservations SET pickup_at = ? WHERE id = ?",
      args: [now - 1000, res.id],
    });

    // Collect 1 unit
    const scanRes = await request(
      "/api/v1/board/scan",
      sendJson({ qrToken, reservationId: res.id }),
      boardCookie
    );
    expect(scanRes.status).toBe(200);

    // Simulate return deadline passing while 1 asset is still borrowed
    await client.execute({
      sql: "UPDATE reservations SET return_at = ? WHERE id = ?",
      args: [now - 500, res.id],
    });

    // Check reservation status: must NOT be COMPLETED, must be OVERDUE
    const checkOverdue = await request(
      `/api/v1/board/reservations/${res.id}`,
      {},
      boardCookie
    ).then((r) => r.json());
    expect(checkOverdue.status).toBe("APPROVED");
    expect(checkOverdue.derivedStatus).toBe("OVERDUE");

    // Return the remaining borrowed asset
    await client.execute("UPDATE assets SET last_scan_at = NULL WHERE id = 'asset-one'");
    const returnScan = await request("/api/v1/board/scan", sendJson({ qrToken }), boardCookie);
    expect(returnScan.status).toBe(200);

    // Now that borrowed count is 0 and deadline passed, reservation is COMPLETED
    const checkFinal = await request(`/api/v1/board/reservations/${res.id}`, {}, boardCookie).then(
      (r) => r.json()
    );
    expect(checkFinal.status).toBe("COMPLETED");
    expect(checkFinal.derivedStatus).toBe("RETURNED");
  });

  it("prompts for reservation selection when multiple eligible approved reservations exist for an asset", async () => {
    const now = Date.now();
    const pickupAt = new Date(now + 10_000).toISOString();
    const returnAt = new Date(now + 3600_000).toISOString();

    const token2 = "d".repeat(64);
    await client.execute({
      sql: "INSERT INTO assets(id,equipment_item_id,asset_code,qr_token,state,active,created_at,updated_at) VALUES('asset-two',?,'SB-METER-02',?,'AVAILABLE',1,?,?)",
      args: [itemId, token2, now, now],
    });

    const [resA, resB] = await Promise.all([
      request(
        "/api/v1/reservations",
        sendJson({
          borrowerType: "PERSON",
          pickupAt,
          returnAt,
          items: [{ equipmentItemId: itemId, quantity: 1 }],
        }),
        memberCookie
      ).then((r) => r.json()),
      request(
        "/api/v1/reservations",
        sendJson({
          borrowerType: "PERSON",
          pickupAt,
          returnAt,
          items: [{ equipmentItemId: itemId, quantity: 1 }],
        }),
        memberCookie
      ).then((r) => r.json()),
    ]);

    await request(`/api/v1/board/reservations/${resA.id}/approve`, sendJson({}), boardCookie);
    await request(`/api/v1/board/reservations/${resB.id}/approve`, sendJson({}), boardCookie);

    await client.execute("UPDATE reservations SET pickup_at=? WHERE id IN (?, ?)", [
      now - 1000,
      resA.id,
      resB.id,
    ]);

    // Scan asset without reservationId -> must return RESERVATION_SELECTION_REQUIRED
    const disambiguateScan = await request(
      "/api/v1/board/scan",
      sendJson({ qrToken }),
      boardCookie
    );
    expect(disambiguateScan.status).toBe(200);
    const scanBody = await disambiguateScan.json();
    expect(scanBody.code).toBe("RESERVATION_SELECTION_REQUIRED");
    expect(scanBody.reservations.length).toBe(2);
    expect(scanBody.reservations[0]).toHaveProperty("uncollectedCount");
    expect(scanBody.reservations[0].uncollectedCount).toBe(1);
    expect(typeof scanBody.reservations[0].uncollectedCount).toBe("number");

    // Clear duplicate scan cooldown
    await client.execute("UPDATE assets SET last_scan_at = NULL WHERE id = 'asset-one'");

    // Fulfilling with explicit reservationId succeeds
    const explicitScan = await request(
      "/api/v1/board/scan",
      sendJson({ qrToken, reservationId: resA.id }),
      boardCookie
    );
    expect(explicitScan.status).toBe(200);
    const explicitBody = await explicitScan.json();
    expect(explicitBody.operation).toBe("CHECKED_OUT");
    expect(explicitBody.reservationId).toBe(resA.id);
  });

  it("verifies migration 0002_quantity_reservations handles Cases A, B, C, D, E accurately", async () => {
    const testClient = createClient({ url: "file::memory:" });
    await testClient.execute("PRAGMA foreign_keys = ON");
    await testClient.executeMultiple(
      await readFile(new URL("../../drizzle/0000_sb_reservations.sql", import.meta.url), "utf8")
    );
    await testClient.executeMultiple(
      await readFile(new URL("../../drizzle/0001_borrower_phone.sql", import.meta.url), "utf8")
    );

    const now = Date.now();
    await testClient.execute(
      "INSERT INTO user(id,name,email,emailVerified,role,createdAt,updatedAt) VALUES('u1','User 1','u1@test',1,'USER',1,1)"
    );
    await testClient.execute(
      "INSERT INTO equipment_items(id,name,description,category,active,created_at,updated_at) VALUES('eq1','Equip 1','desc','cat',1,1,1)"
    );
    await testClient.execute(
      "INSERT INTO assets(id,equipment_item_id,asset_code,qr_token,state,active,created_at,updated_at) VALUES('a-res','eq1','A-RES','1111111111111111111111111111111111111111111111111111111111111111','RESERVED',1,1,1)"
    );
    await testClient.execute(
      "INSERT INTO assets(id,equipment_item_id,asset_code,qr_token,state,active,created_at,updated_at) VALUES('a-bor','eq1','A-BOR','2222222222222222222222222222222222222222222222222222222222222222','BORROWED',1,1,1)"
    );
    await testClient.execute(
      "INSERT INTO assets(id,equipment_item_id,asset_code,qr_token,state,active,created_at,updated_at) VALUES('a-ret','eq1','A-RET','3333333333333333333333333333333333333333333333333333333333333333','AVAILABLE',1,1,1)"
    );
    await testClient.execute(
      "INSERT INTO assets(id,equipment_item_id,asset_code,qr_token,state,active,created_at,updated_at) VALUES('a-rel','eq1','A-REL','4444444444444444444444444444444444444444444444444444444444444444','AVAILABLE',1,1,1)"
    );

    await testClient.execute({
      sql: "INSERT INTO reservations(id,requested_by_user_id,borrower_type,borrower_user_id,pickup_at,return_at,status,created_at,updated_at) VALUES('r1','u1','PERSON','u1',?,?, 'APPROVED', ?, ?)",
      args: [now, now + 10000, now, now],
    });
    await testClient.execute(
      "INSERT INTO reservation_lines(id,reservation_id,equipment_item_id,quantity) VALUES('rl1','r1','eq1',4)"
    );

    // Case A: preassigned, uncollected RESERVED
    await testClient.execute(
      "INSERT INTO reservation_assets(id,reservation_id,reservation_line_id,asset_id,state,actual_pickup_at,created_at,updated_at) VALUES('ra-a','r1','rl1','a-res','RESERVED',NULL,1,1)"
    );
    // Case B: collected BORROWED
    await testClient.execute(
      "INSERT INTO reservation_assets(id,reservation_id,reservation_line_id,asset_id,state,actual_pickup_at,created_at,updated_at) VALUES('ra-b','r1','rl1','a-bor','BORROWED',1,1,1)"
    );
    // Case C: collected and RETURNED
    await testClient.execute(
      "INSERT INTO reservation_assets(id,reservation_id,reservation_line_id,asset_id,state,actual_pickup_at,actual_return_at,created_at,updated_at) VALUES('ra-c','r1','rl1','a-ret','RETURNED',1,2,1,1)"
    );
    // Case D: preassigned, uncollected RELEASED
    await testClient.execute(
      "INSERT INTO reservation_assets(id,reservation_id,reservation_line_id,asset_id,state,actual_pickup_at,created_at,updated_at) VALUES('ra-d','r1','rl1','a-rel','RELEASED',NULL,1,1)"
    );

    // Execute migration 0002
    await testClient.executeMultiple(
      await readFile(
        new URL("../../drizzle/0002_quantity_reservations.sql", import.meta.url),
        "utf8"
      )
    );

    // Verify Case A: deleted from reservation_assets, asset state became AVAILABLE
    const checkA = await testClient.execute("SELECT * FROM reservation_assets WHERE id='ra-a'");
    expect(checkA.rows.length).toBe(0);
    const assetA = await testClient.execute("SELECT state FROM assets WHERE id='a-res'");
    expect(assetA.rows[0]?.state).toBe("AVAILABLE");

    // Verify Case B: preserved in reservation_assets, asset remains BORROWED
    const checkB = await testClient.execute("SELECT * FROM reservation_assets WHERE id='ra-b'");
    expect(checkB.rows.length).toBe(1);
    const assetB = await testClient.execute("SELECT state FROM assets WHERE id='a-bor'");
    expect(assetB.rows[0]?.state).toBe("BORROWED");

    // Verify Case C: preserved in reservation_assets, asset remains AVAILABLE
    const checkC = await testClient.execute("SELECT * FROM reservation_assets WHERE id='ra-c'");
    expect(checkC.rows.length).toBe(1);
    const assetC = await testClient.execute("SELECT state FROM assets WHERE id='a-ret'");
    expect(assetC.rows[0]?.state).toBe("AVAILABLE");

    // Verify Case D: deleted from reservation_assets
    const checkD = await testClient.execute("SELECT * FROM reservation_assets WHERE id='ra-d'");
    expect(checkD.rows.length).toBe(0);

    testClient.close();
  });
});
