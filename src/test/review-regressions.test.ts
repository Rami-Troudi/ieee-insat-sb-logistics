// @vitest-environment node
import { createClient, type Client } from "@libsql/client";
import { serializeSignedCookie } from "better-call";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  expireUncollectedReservations,
  reconcileExpiredReservations,
  deliverNotificationEmails,
} from "../worker/domain";
import { isAllowedOrigin } from "../worker/auth";
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
  await client.executeMultiple(
    await readFile(new URL("../../drizzle/0005_system_audit_actor.sql", import.meta.url), "utf8")
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

describe("review regressions", () => {
  async function loan(quantity = 1) {
    const now = Date.now();
    const body = {
      borrowerType: "PERSON",
      pickupAt: new Date(now + 60000).toISOString(),
      returnAt: new Date(now + 3600000).toISOString(),
      items: [{ equipmentItemId: itemId, quantity }],
    };
    const response = await request("/api/v1/reservations", sendJson(body), memberCookie);
    expect(response.status).toBe(201);
    return { body, ...(await response.json()) };
  }
  async function approve(id: string) {
    expect(
      (await request(`/api/v1/board/reservations/${id}/approve`, sendJson({}), boardCookie)).status
    ).toBe(200);
  }
  async function pickup(id: string) {
    await client.execute("UPDATE reservations SET pickup_at=? WHERE id=?", [Date.now() - 1000, id]);
    expect(
      (
        await request(
          `/api/v1/board/reservations/${id}/handover`,
          sendJson({ assetIds: ["asset-one"] }),
          boardCookie
        )
      ).status
    ).toBe(200);
  }
  it("Regression: invalid cookie signature accepted for active Board token", async () => {
    expect(
      (
        await request(
          "/api/v1/board/dashboard",
          {},
          "__Secure-better-auth.session_token=session-board.invalid-signature"
        )
      ).status
    ).toBe(401);
  });
  it("Regression: privileged accounts cannot use borrower sign-in", async () => {
    const boardResponse = await request(
      "/api/v1/auth/borrower",
      sendJson({
        name: "Claimed account",
        email: "board@example.test",
      })
    );
    expect(boardResponse.status).toBe(403);
    const body = (await boardResponse.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("PRIVILEGED_ACCOUNT");

    await seedUser("admin-priv", "SUPERADMIN");
    const superadminResponse = await request(
      "/api/v1/auth/borrower",
      sendJson({
        name: "Claimed account",
        email: "admin-priv@example.test",
      })
    );
    expect(superadminResponse.status).toBe(403);
  });
  it("Regression: existing USER email borrower auth works", async () => {
    const response = await request(
      "/api/v1/auth/borrower",
      sendJson({
        name: "Updated Member Name",
        email: "member@example.test",
      })
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { user: { email: string; name: string } };
    expect(body.user.email).toBe("member@example.test");
    expect(body.user.name).toBe("Updated Member Name");
  });
  it("Regression: quantity hold ignored by availability endpoint", async () => {
    const r = await loan();
    await approve(r.id);
    const query =
      "?pickupAt=" +
      encodeURIComponent(r.body.pickupAt) +
      "&returnAt=" +
      encodeURIComponent(r.body.returnAt);
    const catalogue = (await request("/api/v1/catalogue" + query).then((r) => r.json())) as Array<
      Record<string, unknown>
    >;
    expect(catalogue[0]?.available).toBe(false);
    expect(catalogue[0]?.availableQuantity).toBeUndefined();
    const availability = (await request(`/api/v1/equipment/${itemId}/availability` + query).then(
      (r) => r.json()
    )) as Record<string, unknown>;
    expect(availability).toEqual({ available: false });
  });
  it("Regression: failed equipment deletion has already deleted assets", async () => {
    await loan();
    expect(
      (await request(`/api/v1/board/equipment/${itemId}`, { method: "DELETE" }, boardCookie)).status
    ).toBe(409);
    expect((await client.execute("SELECT id FROM assets")).rows).toHaveLength(1);
    expect((await client.execute("SELECT id FROM equipment_items")).rows).toHaveLength(1);
  });
  it("Regression: force deletion makes physically borrowed asset available", async () => {
    const r = await loan();
    await approve(r.id);
    await pickup(r.id);
    expect(
      (await request(`/api/v1/board/reservations/${r.id}/force`, { method: "DELETE" }, boardCookie))
        .status
    ).toBe(409);
    expect(
      (await client.execute("SELECT state FROM assets WHERE id='asset-one'")).rows[0]?.state
    ).toBe("BORROWED");
    expect((await client.execute("SELECT * FROM reservation_assets")).rows).toHaveLength(1);
  });
  it("Regression: partial collection and full physical return leave approved loan past expiry", async () => {
    const now = Date.now();
    await client.execute(
      "INSERT INTO assets(id,equipment_item_id,asset_code,qr_token,state,active,created_at,updated_at) VALUES('asset-two',?,'SECOND',?,'AVAILABLE',1,?,?)",
      [itemId, "b".repeat(64), now, now]
    );
    const r = await loan(2);
    await approve(r.id);
    await pickup(r.id);
    await client.execute("UPDATE assets SET last_scan_at=?", [now - 4000]);
    expect(
      (
        await request(
          "/api/v1/board/scan",
          {
            ...sendJson({ qrToken, reservationId: r.id, operation: "RETURNED" }),
            headers: { "Content-Type": "application/json", "Idempotency-Key": "audit-return-0001" },
          },
          boardCookie
        )
      ).status
    ).toBe(200);
    await client.execute("UPDATE reservations SET pickup_at=?,return_at=? WHERE id=?", [
      now - 7200000,
      now - 3600000,
      r.id,
    ]);
    expect(
      await (await request(`/api/v1/board/reservations/${r.id}`, {}, boardCookie)).json()
    ).toMatchObject({ status: "COMPLETED", collectedCount: 1, returnedCount: 1, totalQuantity: 2 });
  });
  it("Regression: deleting historical borrower removes credentials then fails", async () => {
    const r = await loan();
    await approve(r.id);
    await pickup(r.id);
    await client.execute("UPDATE assets SET last_scan_at=?", [Date.now() - 4000]);
    await request(
      "/api/v1/board/scan",
      {
        ...sendJson({ qrToken }),
        headers: { "Content-Type": "application/json", "Idempotency-Key": "audit-return-0002" },
      },
      boardCookie
    );
    const adminCookie = await seedUser("admin", "SUPERADMIN");
    await client.execute(
      "INSERT INTO account(id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES('member-account','member','credential','member','placeholder',?,?)",
      [Date.now(), Date.now()]
    );
    expect(
      (await request("/api/v1/board/users/member", { method: "DELETE" }, adminCookie)).status
    ).toBe(409);
    expect((await client.execute("SELECT id FROM user WHERE id='member'")).rows).toHaveLength(1);
    expect(
      (await client.execute("SELECT id FROM account WHERE userId='member'")).rows
    ).toHaveLength(1);
    expect(
      (await client.execute("SELECT id FROM session WHERE userId='member'")).rows
    ).toHaveLength(1);
  });
});

describe("maintenance boundary checks", () => {
  it("releases uncollected reserved units before completing a partial pickup", async () => {
    const now = Date.now();
    for (let i = 2; i <= 5; i++)
      await client.execute({
        sql: "INSERT INTO assets(id,equipment_item_id,asset_code,qr_token,state,active,created_at,updated_at) VALUES(?,?,?,?,'AVAILABLE',1,?,?)",
        args: [`asset-${i}`, itemId, `SB-METER-0${i}`, String(i).repeat(64), now, now],
      });
    const created = await request(
      "/api/v1/reservations",
      sendJson({
        borrowerType: "PERSON",
        pickupAt: new Date(now + 60000).toISOString(),
        returnAt: new Date(now + 3600000).toISOString(),
        items: [{ equipmentItemId: itemId, quantity: 5 }],
      }),
      memberCookie
    );
    expect(created.status).toBe(201);
    const reservation = (await created.json()) as { id: string };
    expect(
      (
        await request(
          `/api/v1/board/reservations/${reservation.id}/approve`,
          sendJson({}),
          boardCookie
        )
      ).status
    ).toBe(200);
    const lineId = String(
      (
        await client.execute("SELECT id FROM reservation_lines WHERE reservation_id=?", [
          reservation.id,
        ])
      ).rows[0]?.id
    );
    const assignedIds = ["asset-one", "asset-2", "asset-3", "asset-4", "asset-5"];
    for (let i = 0; i < assignedIds.length; i++)
      await client.execute({
        sql: "INSERT INTO reservation_assets(id,reservation_id,reservation_line_id,asset_id,state,created_at,updated_at) VALUES(?,?,?,?,'RESERVED',?,?)",
        args: [`assignment-${i + 1}`, reservation.id, lineId, assignedIds[i], now, now],
      });
    await client.execute(
      "UPDATE assets SET state='RESERVED' WHERE id IN ('asset-one','asset-2','asset-3','asset-4','asset-5')"
    );
    const assigned = await client.execute(
      "SELECT asset_id FROM reservation_assets WHERE reservation_id=? ORDER BY asset_id",
      [reservation.id]
    );
    expect(assigned.rows).toHaveLength(5);
    for (const row of assigned.rows.slice(0, 3)) {
      const assetId = String(row.asset_id);
      await client.execute(
        "UPDATE reservation_assets SET state='RETURNED',actual_pickup_at=?,actual_return_at=?,updated_at=? WHERE reservation_id=? AND asset_id=?",
        [now - 2000, now - 1000, now, reservation.id, assetId]
      );
      await client.execute("UPDATE assets SET state='AVAILABLE',updated_at=? WHERE id=?", [
        now,
        assetId,
      ]);
    }
    await client.execute("UPDATE reservations SET pickup_at=?,return_at=? WHERE id=?", [
      now - 3600000,
      now - 500,
      reservation.id,
    ]);
    await reconcileExpiredReservations(env, now);
    expect(
      (await client.execute("SELECT status FROM reservations WHERE id=?", [reservation.id])).rows[0]
        ?.status
    ).toBe("COMPLETED");
    expect(
      Number(
        (
          await client.execute(
            "SELECT COUNT(*) count FROM reservation_assets WHERE reservation_id=? AND state='RELEASED'",
            [reservation.id]
          )
        ).rows[0]?.count
      )
    ).toBe(2);
    expect(
      Number(
        (await client.execute("SELECT COUNT(*) count FROM assets WHERE state='RESERVED'")).rows[0]
          ?.count
      )
    ).toBe(0);
  });

  it("30-minute expiry is idempotent and frees quantity", async () => {
    const now = Date.now();
    const r = await (
      await request(
        "/api/v1/reservations",
        sendJson({
          borrowerType: "PERSON",
          pickupAt: new Date(now + 60000).toISOString(),
          returnAt: new Date(now + 7200000).toISOString(),
          items: [{ equipmentItemId: itemId, quantity: 1 }],
        }),
        memberCookie
      )
    ).json();
    await request("/api/v1/board/reservations/" + r.id + "/approve", sendJson({}), boardCookie);
    const deadline = now + 60000 + 1800000;
    expect(await expireUncollectedReservations(env, deadline - 1)).toBe(0);
    expect(await expireUncollectedReservations(env, deadline)).toBe(1);
    expect(await expireUncollectedReservations(env, deadline + 1)).toBe(0);
    expect(
      (await client.execute("SELECT COUNT(*) count FROM notifications WHERE type='PICKUP_EXPIRED'"))
        .rows[0].count
    ).toBe(1);
    expect(
      (
        await client.execute(
          "SELECT actor_type,actor_id,actor_user_id FROM audit_events WHERE action='RESERVATION_CANCELLED'"
        )
      ).rows[0]
    ).toMatchObject({
      actor_type: "SYSTEM",
      actor_id: "reservation-maintenance",
      actor_user_id: null,
    });
  });
  it("email failures retry without losing outbox rows", async () => {
    const now = Date.now();
    await client.execute(
      "INSERT INTO notifications(id,user_id,type,title,message,created_at) VALUES('audit-mail','member','OTHER','title','body',?)",
      [now]
    );
    await client.execute("INSERT INTO notification_emails(notification_id) VALUES('audit-mail')");
    env.BREVO_API_KEY = "test-only";
    env.BREVO_SENDER_EMAIL = "test@example.test";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response("", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      expect(await deliverNotificationEmails(env, now)).toMatchObject({ sent: 0 });
      expect(
        (await client.execute("SELECT status,attempts FROM notification_emails")).rows[0]
      ).toMatchObject({ status: "PENDING", attempts: 1 });
      expect(await deliverNotificationEmails(env, now + 360000)).toMatchObject({ sent: 1 });
      expect(
        (await client.execute("SELECT status,attempts FROM notification_emails")).rows[0]
      ).toMatchObject({ status: "SENT", attempts: 2 });
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("Regression: unassociated Vercel project allowed by origin check", () => {
    env.APP_ORIGIN = "https://logistics-example.vercel.app";
    expect(
      isAllowedOrigin(
        "https://unrelated-project.vercel.app",
        env,
        env.APP_ORIGIN + "/api/v1/reservations"
      )
    ).toBe(false);
  });
});

describe("validation and capacity checks", () => {
  it("Regression: overlong borrower name becomes 500 rather than validation error", async () => {
    expect(
      (
        await request(
          "/api/v1/auth/borrower",
          sendJson({
            name: "n".repeat(121),
            email: "long@example.test",
          })
        )
      ).status
    ).toBe(400);
  });
  it("Regression: retiring only unit invalidates approved quantity without warning", async () => {
    const now = Date.now();
    const r = await (
      await request(
        "/api/v1/reservations",
        sendJson({
          borrowerType: "PERSON",
          pickupAt: new Date(now + 60000).toISOString(),
          returnAt: new Date(now + 3600000).toISOString(),
          items: [{ equipmentItemId: itemId, quantity: 1 }],
        }),
        memberCookie
      )
    ).json();
    expect(
      (await request("/api/v1/board/reservations/" + r.id + "/approve", sendJson({}), boardCookie))
        .status
    ).toBe(200);
    expect(
      (
        await request(
          "/api/v1/board/assets/asset-one",
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ state: "RETIRED" }),
          },
          boardCookie
        )
      ).status
    ).toBe(409);
    expect(
      (await client.execute("SELECT status FROM reservations WHERE id=?", [r.id])).rows[0].status
    ).toBe("APPROVED");
    expect(
      (
        await client.execute(
          "SELECT COUNT(*) count FROM assets WHERE active=1 AND state NOT IN ('RETIRED','OUT_OF_SERVICE')"
        )
      ).rows[0].count
    ).toBe(1);
  });
});

describe("additional safety and database coverage", () => {
  it("paginates more than 100 reservations and filters the calendar range", async () => {
    const now = Date.now();
    await client.batch(
      Array.from({ length: 105 }, (_, i) => ({
        sql: "INSERT INTO reservations(id,requested_by_user_id,borrower_type,borrower_user_id,pickup_at,return_at,status,created_at,updated_at) VALUES(?,'member','PERSON','member',?,?,'PENDING',?,?)",
        args: ["volume-" + i, now + 86400000 + i, now + 90000000 + i, now, now],
      })),
      "write"
    );
    await client.batch(
      Array.from({ length: 105 }, (_, i) => ({
        sql: "INSERT INTO reservation_lines(id,reservation_id,equipment_item_id,quantity) VALUES(?,?,?,1)",
        args: ["line-" + i, "volume-" + i, itemId],
      })),
      "write"
    );
    expect(
      await (await request("/api/v1/board/reservations", {}, boardCookie)).json()
    ).toHaveLength(100);
    expect(
      await (await request("/api/v1/board/reservations?offset=100", {}, boardCookie)).json()
    ).toHaveLength(5);
    const start = new Date(now + 2 * 86400000).toISOString(),
      end = new Date(now + 3 * 86400000).toISOString();
    expect(
      await (
        await request(
          `/api/v1/board/reservations?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
          {},
          boardCookie
        )
      ).json()
    ).toHaveLength(0);
    expect(
      (await request("/api/v1/board/reservations?start=invalid&end=invalid", {}, boardCookie))
        .status
    ).toBe(400);
    expect((await client.execute("PRAGMA foreign_key_check")).rows).toHaveLength(0);
  });
  async function createLoan() {
    const now = Date.now();
    const response = await request(
      "/api/v1/reservations",
      sendJson({
        borrowerType: "PERSON",
        pickupAt: new Date(now + 60_000).toISOString(),
        returnAt: new Date(now + 3_600_000).toISOString(),
        items: [{ equipmentItemId: itemId, quantity: 1 }],
      }),
      memberCookie
    );
    expect(response.status).toBe(201);
    return response.json();
  }
  it("rolls back equipment and asset deletions if the audit insert fails", async () => {
    await client.executeMultiple(
      "CREATE TRIGGER fail_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'injected failure'); END;"
    );
    expect(
      (await request(`/api/v1/board/equipment/${itemId}`, { method: "DELETE" }, boardCookie)).status
    ).toBe(500);
    expect((await client.execute("SELECT id FROM assets")).rows).toHaveLength(1);
    expect((await client.execute("SELECT id FROM equipment_items")).rows).toHaveLength(1);
  });
  it("rolls back a new staff account when its audit insert fails", async () => {
    const admin = await seedUser("admin", "SUPERADMIN");
    await client.executeMultiple(
      "CREATE TRIGGER fail_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'injected failure'); END;"
    );
    expect(
      (
        await request(
          "/api/v1/board/users",
          sendJson({
            name: "Rollback Staff",
            email: "rollback@example.test",
            password: "Rollback-password-2026",
          }),
          admin
        )
      ).status
    ).toBe(500);
    expect(
      (await client.execute("SELECT id FROM user WHERE email='rollback@example.test'")).rows
    ).toHaveLength(0);
    expect((await client.execute("SELECT id FROM account")).rows).toHaveLength(0);
  });
  it("blocks simultaneous approvals exceeding quantity capacity", async () => {
    const a = await createLoan(),
      b = await createLoan();
    const approve = (id: string) =>
      request(`/api/v1/board/reservations/${id}/approve`, sendJson({}), boardCookie);
    const results = await Promise.all([approve(a.id), approve(b.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });
  it("disabled equipment can still fulfil an existing approved reservation", async () => {
    const loan = await createLoan();
    expect(
      (await request(`/api/v1/board/reservations/${loan.id}/approve`, sendJson({}), boardCookie))
        .status
    ).toBe(200);
    await client.execute({
      sql: "UPDATE equipment_items SET active=0 WHERE id=?",
      args: [itemId],
    });
    const detail = await (
      await request(`/api/v1/board/reservations/${loan.id}`, {}, boardCookie)
    ).json();
    expect(detail.allocationCandidates[0].assets).toHaveLength(1);
    await client.execute({
      sql: "UPDATE reservations SET pickup_at=? WHERE id=?",
      args: [Date.now() - 1000, loan.id],
    });
    expect(
      (
        await request(
          `/api/v1/board/reservations/${loan.id}/handover`,
          sendJson({ assetIds: ["asset-one"] }),
          boardCookie
        )
      ).status
    ).toBe(200);
  });
  it("disabling access revokes sessions while retaining history and credentials", async () => {
    const admin = await seedUser("admin", "SUPERADMIN");
    await createLoan();
    expect(
      (
        await request(
          "/api/v1/board/users/member/access",
          { ...sendJson({ enabled: false }), method: "PATCH" },
          admin
        )
      ).status
    ).toBe(200);
    expect((await request("/api/v1/reservations", {}, memberCookie)).status).toBe(401);
    expect((await client.execute("SELECT id FROM user WHERE id='member'")).rows).toHaveLength(1);
    expect((await client.execute("SELECT id FROM reservations")).rows).toHaveLength(1);
    expect(
      (
        await request(
          "/api/v1/board/users/admin/access",
          { ...sendJson({ enabled: false }), method: "PATCH" },
          admin
        )
      ).status
    ).toBe(409);
  });
  it("password reset invalidates sessions and permits the new password", async () => {
    const admin = await seedUser("admin", "SUPERADMIN");
    expect(
      (
        await request(
          "/api/v1/board/users/board/password",
          { ...sendJson({ password: "Reset-password-2026" }), method: "PUT" },
          admin
        )
      ).status
    ).toBe(200);
    expect((await request("/api/v1/board/dashboard", {}, boardCookie)).status).toBe(401);
    expect(
      (
        await request(
          "/api/v1/auth/board-login",
          sendJson({ email: "board@example.test", password: "Reset-password-2026" })
        )
      ).status
    ).toBe(200);
  });
  it("notification pagination and mark-all cannot affect another user's notifications", async () => {
    for (let i = 0; i < 105; i++)
      await client.execute({
        sql: "INSERT INTO notifications(id,user_id,type,title,message,created_at) VALUES(?,'member','TEST','Test','Message',?)",
        args: ["notification-" + i, Date.now() + i],
      });
    await client.execute({
      sql: "INSERT INTO notifications(id,user_id,type,title,message,created_at) VALUES('board-notice','board','TEST','Board','Message',?)",
      args: [Date.now()],
    });
    expect(await (await request("/api/v1/notifications/summary", {}, memberCookie)).json()).toEqual(
      { total: 105, unread: 105 }
    );
    expect(
      await (await request("/api/v1/notifications?offset=100", {}, memberCookie)).json()
    ).toHaveLength(5);
    expect(
      (await request("/api/v1/notifications/read-all", { method: "PATCH" }, memberCookie)).status
    ).toBe(200);
    expect(await (await request("/api/v1/notifications/summary", {}, memberCookie)).json()).toEqual(
      { total: 105, unread: 0 }
    );
    expect(await (await request("/api/v1/notifications/summary", {}, boardCookie)).json()).toEqual({
      total: 1,
      unread: 1,
    });
  });
  it("stores affiliation and validates oversized phone numbers", async () => {
    const profile = {
      name: "Profile User",
      email: "profile@example.test",
      membership: "EXTERNAL",
    };
    expect(
      (await request("/api/v1/auth/borrower", sendJson({ ...profile, phone: "1".repeat(51) })))
        .status
    ).toBe(400);
    expect(
      (await request("/api/v1/auth/borrower", sendJson({ ...profile, phone: "+21612345678" })))
        .status
    ).toBe(200);
    expect(
      (await client.execute("SELECT membership,phone FROM user WHERE email='profile@example.test'"))
        .rows[0]
    ).toMatchObject({ membership: "EXTERNAL", phone: "+21612345678" });
  });
  it("enforces roles, owner visibility and cron authentication", async () => {
    const loan = await createLoan();
    const other = await seedUser("other", "USER");
    expect((await request(`/api/v1/reservations/${loan.id}`, {}, other)).status).toBe(404);
    expect((await request("/api/v1/board/inventory", {}, memberCookie)).status).toBe(403);
    expect((await request("/api/v1/board/users", {}, boardCookie)).status).toBe(403);
    env.CRON_SECRET = "test-cron-secret";
    expect((await request("/api/cron/return-reminders")).status).toBe(401);
  });
  it("enforces unique credentials, assignment consistency and immutable audit records", async () => {
    const loan = await createLoan();
    await expect(
      client.execute({
        sql: "INSERT INTO reservation_assets(id,reservation_id,reservation_line_id,asset_id,state,created_at,updated_at) VALUES('bad',?,'missing-line','asset-one','BORROWED',?,?)",
        args: [loan.id, Date.now(), Date.now()],
      })
    ).rejects.toThrow();
    await expect(client.execute("UPDATE audit_events SET action='CORRUPTED'")).rejects.toThrow();
    await expect(client.execute("DELETE FROM audit_events")).rejects.toThrow();
    expect((await client.execute("PRAGMA foreign_key_check")).rows).toHaveLength(0);
    expect((await client.execute("PRAGMA integrity_check")).rows[0].integrity_check).toBe("ok");
  });
  it("rejects unconfigured local ports and unrelated preview origins", () => {
    env.APP_ORIGIN = "http://127.0.0.1:5173";
    expect(
      isAllowedOrigin("http://127.0.0.1:9999", env, "http://127.0.0.1:8787/api/v1/reservations")
    ).toBe(false);
    env.APP_ORIGIN = "https://logistics-example.vercel.app";
    expect(
      isAllowedOrigin("https://unrelated.vercel.app", env, env.APP_ORIGIN + "/api/v1/reservations")
    ).toBe(false);
  });
});
