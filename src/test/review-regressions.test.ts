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
  await client.executeMultiple(
    await readFile(
      new URL("../../drizzle/0006_email_leases_and_maintenance.sql", import.meta.url),
      "utf8"
    )
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
    ).toMatchObject({ status: "APPROVED", collectedCount: 1, returnedCount: 1, totalQuantity: 2 });
    await reconcileExpiredReservations(env);
    expect(
      (await client.execute("SELECT status FROM reservations WHERE id=?", [r.id])).rows[0].status
    ).toBe("COMPLETED");
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

describe("approved October review corrections", () => {
  async function createLoan() {
    const now = Date.now();
    const response = await request(
      "/api/v1/reservations",
      sendJson({
        pickupAt: new Date(now + 60_000).toISOString(),
        returnAt: new Date(now + 7_200_000).toISOString(),
        items: [{ equipmentItemId: itemId, quantity: 1 }],
      }),
      memberCookie
    );
    expect(response.status).toBe(201);
    return (await response.json()).id as string;
  }
  async function approveLoan(id: string) {
    expect(
      (await request(`/api/v1/board/reservations/${id}/approve`, sendJson({}), boardCookie)).status
    ).toBe(200);
  }
  async function scan(id: string, key: string) {
    return request(
      "/api/v1/board/scan",
      {
        ...sendJson({ qrToken, reservationId: id }),
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      },
      boardCookie
    );
  }
  async function auditFailure() {
    await client.executeMultiple(
      "CREATE TRIGGER fail_required_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'injected audit failure'); END;"
    );
  }
  it("limits the exact staff login route by normalized account across IPs", async () => {
    env.AUTH_RATE_LIMIT_PER_MINUTE = 2;
    for (let i = 0; i < 3; i++) {
      const response = await request("/api/v1/auth/board-login", {
        ...sendJson({
          email: i % 2 ? " BOARD@example.test " : "board@example.test",
          password: "incorrect-password",
        }),
        headers: { "Content-Type": "application/json", "x-forwarded-for": `192.0.2.${i}` },
      });
      expect(response.status).toBe(i < 2 ? 401 : 429);
    }
  });
  it("limits staff attempts by IP across different accounts", async () => {
    env.AUTH_RATE_LIMIT_PER_MINUTE = 2;
    for (let i = 0; i < 3; i++)
      expect(
        (
          await request(
            "/api/v1/auth/board-login",
            sendJson({ email: `person${i}@example.test`, password: "incorrect-password" })
          )
        ).status
      ).toBe(i < 2 ? 401 : 429);
  });
  it("rejects prefixed preview hosts, wrong schemes and ports", () => {
    env.APP_ORIGIN = "https://logistics-example.vercel.app";
    const url = env.APP_ORIGIN + "/api/v1/me";
    for (const origin of [
      "https://logistics-example-attacker.vercel.app",
      "http://logistics-example.vercel.app",
      "https://logistics-example.vercel.app:444",
    ])
      expect(isAllowedOrigin(origin, env, url)).toBe(false);
    env.APP_ORIGIN = undefined;
    expect(
      isAllowedOrigin("https://unknown.vercel.app", env, "https://unknown.vercel.app/api")
    ).toBe(false);
    env.VERCEL_URL = "known.vercel.app";
    expect(isAllowedOrigin("https://known.vercel.app", env, "https://known.vercel.app/api")).toBe(
      true
    );
  });
  it.each(["manual", "qr"])(
    "rejects overdue first pickup transactionally through %s",
    async (mode) => {
      const id = await createLoan();
      await approveLoan(id);
      await client.execute("UPDATE reservations SET pickup_at=? WHERE id=?", [
        Date.now() - 31 * 60_000,
        id,
      ]);
      const response =
        mode === "qr"
          ? await scan(id, "cutoff-test-key-0001")
          : await request(
              `/api/v1/board/reservations/${id}/handover`,
              sendJson({ assetIds: ["asset-one"] }),
              boardCookie
            );
      expect(response.status).toBe(409);
      expect(
        (await client.execute("SELECT state FROM assets WHERE id='asset-one'")).rows[0].state
      ).toBe("AVAILABLE");
      expect(
        (
          await client.execute(
            "SELECT COUNT(*) AS count FROM reservation_assets WHERE reservation_id=?",
            [id]
          )
        ).rows[0].count
      ).toBe(0);
    }
  );
  it("does not mutate a reservation when an unauthorized borrower reads it", async () => {
    const id = await createLoan();
    await approveLoan(id);
    await client.execute("UPDATE reservations SET pickup_at=?,return_at=? WHERE id=?", [
      Date.now() - 7_200_000,
      Date.now() - 3_600_000,
      id,
    ]);
    const other = await seedUser("other-reader", "USER");
    expect((await request(`/api/v1/reservations/${id}`, {}, other)).status).toBe(404);
    expect(
      (await client.execute("SELECT status FROM reservations WHERE id=?", [id])).rows[0].status
    ).toBe("APPROVED");
    await reconcileExpiredReservations(env);
    expect(
      (await client.execute("SELECT status FROM reservations WHERE id=?", [id])).rows[0].status
    ).toBe("CANCELLED");
    expect(
      (
        await client.execute(
          "SELECT COUNT(*) AS count FROM notifications WHERE type='PICKUP_EXPIRED' AND reservation_id=?",
          [id]
        )
      ).rows[0].count
    ).toBe(1);
  });
  it.each(["manual", "qr"])(
    "supports an approved inactive equipment type through %s",
    async (mode) => {
      const id = await createLoan();
      await approveLoan(id);
      await client.execute("UPDATE reservations SET pickup_at=? WHERE id=?", [
        Date.now() - 1000,
        id,
      ]);
      await client.execute("UPDATE equipment_items SET active=0 WHERE id=?", [itemId]);
      const response =
        mode === "qr"
          ? await scan(id, "inactive-type-test-0001")
          : await request(
              `/api/v1/board/reservations/${id}/handover`,
              sendJson({ assetIds: ["asset-one"] }),
              boardCookie
            );
      expect(response.status).toBe(200);
    }
  );
  it.each(["RETIRED", "OUT_OF_SERVICE"])(
    "retains physical material safety for %s",
    async (state) => {
      const id = await createLoan();
      await approveLoan(id);
      await client.execute("UPDATE reservations SET pickup_at=? WHERE id=?", [
        Date.now() - 1000,
        id,
      ]);
      await client.execute("UPDATE assets SET state=? WHERE id='asset-one'", [state]);
      expect((await scan(id, "physical-safety-key-0001")).status).toBe(409);
    }
  );
  it.each([
    "equipment",
    "asset",
    "chapter-create",
    "chapter-update",
    "chapter-delete",
    "role",
    "password",
  ])("rolls back %s when required audit fails", async (kind) => {
    const admin = await seedUser("admin-review", "SUPERADMIN");
    const before = (await client.execute("SELECT role FROM user WHERE id='member'")).rows[0].role;
    await auditFailure();
    const routes: Record<string, [string, RequestInit]> = {
      equipment: [
        "/api/v1/board/equipment",
        sendJson({ name: "Audit atomicity", category: "Test" }),
      ],
      asset: [`/api/v1/board/equipment/${itemId}/assets`, sendJson({ assetCode: "ATOMIC-NEW" })],
      "chapter-create": [
        "/api/v1/board/chapters",
        sendJson({ name: "New chapter", shortCode: "NEW" }),
      ],
      "chapter-update": [
        "/api/v1/board/chapters/chapter-robotics",
        { ...sendJson({ active: false }), method: "PATCH" },
      ],
      "chapter-delete": ["/api/v1/board/chapters/chapter-robotics", { method: "DELETE" }],
      role: [
        "/api/v1/board/users/member/role",
        { ...sendJson({ role: "BOARD" }), method: "PATCH" },
      ],
      password: [
        "/api/v1/board/users/member/password",
        { ...sendJson({ password: "updated-long-password" }), method: "PUT" },
      ],
    };
    const [path, options] = routes[kind];
    expect((await request(path, options, admin)).status).toBe(500);
    expect(
      (
        await client.execute(
          "SELECT COUNT(*) AS count FROM equipment_items WHERE name='Audit atomicity'"
        )
      ).rows[0].count
    ).toBe(0);
    expect(
      (await client.execute("SELECT COUNT(*) AS count FROM assets WHERE asset_code='ATOMIC-NEW'"))
        .rows[0].count
    ).toBe(0);
    expect(
      (await client.execute("SELECT active FROM chapters WHERE id='chapter-robotics'")).rows[0]
        .active
    ).toBe(1);
    expect(
      (await client.execute("SELECT COUNT(*) AS count FROM chapters WHERE short_code='NEW'"))
        .rows[0].count
    ).toBe(0);
    expect((await client.execute("SELECT role FROM user WHERE id='member'")).rows[0].role).toBe(
      before
    );
    expect(
      (await client.execute("SELECT COUNT(*) AS count FROM account WHERE userId='member'")).rows[0]
        .count
    ).toBe(0);
    expect(
      (await client.execute("SELECT COUNT(*) AS count FROM session WHERE userId='member'")).rows[0]
        .count
    ).toBe(1);
  });
  it("retains staff pickup/return/approval attribution while disabling login", async () => {
    const admin = await seedUser("delete-admin", "SUPERADMIN");
    const id = await createLoan();
    await approveLoan(id);
    await client.execute("UPDATE reservations SET pickup_at=? WHERE id=?", [Date.now() - 1000, id]);
    expect((await scan(id, "staff-attribution-checkout")).status).toBe(200);
    await client.execute("UPDATE assets SET last_scan_at=?", [Date.now() - 4000]);
    expect((await scan(id, "staff-attribution-return")).status).toBe(200);
    expect((await request("/api/v1/board/users/board", { method: "DELETE" }, admin)).status).toBe(
      200
    );
    expect(
      (await client.execute("SELECT approved_by_user_id FROM reservations WHERE id=?", [id]))
        .rows[0].approved_by_user_id
    ).toBe("board");
    expect(
      (
        await client.execute(
          "SELECT checked_out_by_user_id,checked_in_by_user_id FROM reservation_assets WHERE reservation_id=?",
          [id]
        )
      ).rows[0]
    ).toMatchObject({ checked_out_by_user_id: "board", checked_in_by_user_id: "board" });
    expect((await request("/api/v1/board/dashboard", {}, boardCookie)).status).toBe(401);
  });
  it("skips cancelled approvals and obsolete overdue email without provider submission", async () => {
    const id = await createLoan();
    await approveLoan(id);
    await client.execute("UPDATE reservations SET status='CANCELLED' WHERE id=?", [id]);
    await client.execute(
      "INSERT INTO notifications(id,user_id,reservation_id,type,title,message,created_at) VALUES('obsolete-overdue','member',?,'RETURN_OVERDUE','Overdue','obsolete',?)",
      [id, Date.now()]
    );
    await client.execute(
      "INSERT INTO notification_emails(notification_id) VALUES('obsolete-overdue')"
    );
    env.BREVO_API_KEY = "test-only";
    env.BREVO_SENDER_EMAIL = "test@example.test";
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      expect((await deliverNotificationEmails(env)).skipped).toBe(2);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("claims emails once across concurrent workers and recovers expired leases", async () => {
    const now = Date.now();
    await client.execute(
      "INSERT INTO notifications(id,user_id,type,title,message,created_at) VALUES('claim-mail','member','OTHER','title','body',?)",
      [now]
    );
    await client.execute(
      "INSERT INTO notification_emails(notification_id,status,lease_until,lease_token) VALUES('claim-mail','SENDING',?,'abandoned')",
      [now - 1000]
    );
    env.BREVO_API_KEY = "test-only";
    env.BREVO_SENDER_EMAIL = "test@example.test";
    const fetchMock = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return new Response("", { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const results = await Promise.allSettled([
        deliverNotificationEmails(env),
        deliverNotificationEmails(env),
      ]);
      expect(results.filter((result) => result.status === "fulfilled").length).toBeGreaterThan(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(payload.headers.idempotencyKey).toBe("claim-mail");
      expect(
        (
          await client.execute(
            "SELECT status FROM notification_emails WHERE notification_id='claim-mail'"
          )
        ).rows[0].status
      ).toBe("SENT");
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("keeps the excluded session promotion behavior unchanged", async () => {
    const admin = await seedUser("promotion-admin", "SUPERADMIN");
    expect(
      (
        await request(
          "/api/v1/board/users/member/role",
          { ...sendJson({ role: "SUPERADMIN" }), method: "PATCH" },
          admin
        )
      ).status
    ).toBe(200);
    expect((await request("/api/v1/board/users", {}, memberCookie)).status).toBe(200);
  });
  it("keeps automatic second-scan returns and inferred cross-reservation returns unchanged", async () => {
    const a = await createLoan();
    const b = await createLoan();
    await approveLoan(a);
    await client.execute("UPDATE reservations SET pickup_at=? WHERE id=?", [Date.now() - 1000, a]);
    expect((await scan(a, "excluded-auto-checkout")).status).toBe(200);
    await client.execute("UPDATE assets SET last_scan_at=?", [Date.now() - 4000]);
    const returned = await scan(b, "excluded-auto-return");
    expect(returned.status).toBe(200);
    expect(await returned.json()).toMatchObject({ operation: "RETURNED", reservationId: a });
  });
});

describe("complete histories and transient retention", () => {
  it("paginates borrower history past 200 and batches an entire board page", async () => {
    const now = Date.now();
    const tx = await client.transaction("write");
    try {
      for (let index = 0; index < 205; index++) {
        await tx.execute({
          sql: "INSERT INTO reservations(id,requested_by_user_id,borrower_type,borrower_user_id,pickup_at,return_at,status,created_at,updated_at) VALUES(?,'member','PERSON','member',?,?,'PENDING',?,?)",
          args: [
            `history-${String(index).padStart(3, "0")}`,
            now + 60_000,
            now + 120_000,
            now,
            now,
          ],
        });
        await tx.execute({
          sql: "INSERT INTO reservation_lines(id,reservation_id,equipment_item_id,quantity) VALUES(?,?,?,1)",
          args: [`history-line-${index}`, `history-${String(index).padStart(3, "0")}`, itemId],
        });
      }
      await tx.commit();
    } finally {
      tx.close();
    }
    const pages = [];
    for (const offset of [0, 100, 200])
      pages.push(
        ...(await (await request(`/api/v1/reservations?offset=${offset}`, {}, memberCookie)).json())
      );
    expect(pages).toHaveLength(205);
    expect(new Set(pages.map((row) => row.id)).size).toBe(205);
    const { listBoardReservations } = await import("../worker/domain");
    const spy = vi.spyOn(client, "execute");
    expect(await listBoardReservations(env)).toHaveLength(100);
    expect(spy).toHaveBeenCalledTimes(3);
    spy.mockRestore();
  });
  it("paginates account and audit histories beyond the old caps", async () => {
    const admin = await seedUser("history-admin", "SUPERADMIN");
    const now = Date.now();
    const tx = await client.transaction("write");
    try {
      for (let index = 0; index < 505; index++)
        await tx.execute({
          sql: "INSERT INTO user(id,name,email,emailVerified,role,createdAt,updatedAt) VALUES(?,?,?,0,'USER',?,?)",
          args: [
            `history-user-${index}`,
            `History ${index}`,
            `history-${index}@example.test`,
            now,
            now,
          ],
        });
      for (let index = 0; index < 105; index++)
        await tx.execute({
          sql: "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES(?,'board','USER','member','TEST',?,'{}')",
          args: [`history-audit-${index}`, now],
        });
      await tx.commit();
    } finally {
      tx.close();
    }
    const accounts = [];
    for (let offset = 0; ; offset += 100) {
      const page = await (await request(`/api/v1/board/users?offset=${offset}`, {}, admin)).json();
      accounts.push(...page);
      if (page.length < 100) break;
    }
    expect(accounts).toHaveLength(508);
    const audit = [];
    for (const offset of [0, 100])
      audit.push(
        ...(await (await request(`/api/v1/board/audit?offset=${offset}`, {}, boardCookie)).json())
      );
    expect(audit).toHaveLength(105);
  });
  it("cleans transient data while retaining durable loans and audit events", async () => {
    const now = Date.now();
    await client.execute(
      "INSERT INTO rate_limit_buckets(key_hash,window_start,count) VALUES('expired',?,1)",
      [now - 2 * 24 * 60 * 60_000]
    );
    await client.execute(
      "INSERT INTO idempotency_keys(actor_id,operation,key,response,created_at) VALUES('board','ASSET_SCAN','expired','{}',?)",
      [now - 8 * 24 * 60 * 60_000]
    );
    await client.execute(
      "INSERT INTO notifications(id,user_id,type,title,message,created_at) VALUES('expired-note','member','OTHER','old','old',?)",
      [now - 91 * 24 * 60 * 60_000]
    );
    await client.execute(
      "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES('durable-audit','board','USER','member','TEST',?,'{}')",
      [now - 365 * 24 * 60 * 60_000]
    );
    const { runReservationMaintenance } = await import("../worker/domain");
    await runReservationMaintenance(env);
    expect(
      (
        await client.execute(
          "SELECT COUNT(*) AS count FROM rate_limit_buckets WHERE key_hash='expired'"
        )
      ).rows[0].count
    ).toBe(0);
    expect(
      (await client.execute("SELECT COUNT(*) AS count FROM idempotency_keys WHERE key='expired'"))
        .rows[0].count
    ).toBe(0);
    expect(
      (await client.execute("SELECT COUNT(*) AS count FROM notifications WHERE id='expired-note'"))
        .rows[0].count
    ).toBe(0);
    expect(
      (await client.execute("SELECT COUNT(*) AS count FROM audit_events WHERE id='durable-audit'"))
        .rows[0].count
    ).toBe(1);
  });
});

describe("email submission recovery", () => {
  async function queue(id: string) {
    env.BREVO_API_KEY = "test-only";
    env.BREVO_SENDER_EMAIL = "test@example.test";
    await client.execute(
      "INSERT INTO notifications(id,user_id,type,title,message,created_at) VALUES(?,'member','OTHER','title','body',?)",
      [id, Date.now()]
    );
    await client.execute("INSERT INTO notification_emails(notification_id) VALUES(?)", [id]);
  }
  it("recovers provider acceptance followed by failed SENT persistence using the same provider key", async () => {
    await queue("uncertain-mail");
    await client.executeMultiple(
      "CREATE TRIGGER fail_sent BEFORE UPDATE ON notification_emails WHEN NEW.status='SENT' BEGIN SELECT RAISE(ABORT,'sent persistence failure'); END;"
    );
    const mock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 201 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: "duplicate_parameter" }), { status: 400 })
      );
    vi.stubGlobal("fetch", mock);
    try {
      expect((await deliverNotificationEmails(env)).sent).toBe(0);
      expect(
        (
          await client.execute(
            "SELECT status FROM notification_emails WHERE notification_id='uncertain-mail'"
          )
        ).rows[0].status
      ).toBe("SENDING");
      await client.execute("DROP TRIGGER fail_sent");
      await client.execute(
        "UPDATE notification_emails SET lease_until=? WHERE notification_id='uncertain-mail'",
        [Date.now() - 1]
      );
      expect((await deliverNotificationEmails(env)).sent).toBe(1);
      expect(mock).toHaveBeenCalledTimes(2);
      expect(JSON.parse(mock.mock.calls[0][1].body).headers.idempotencyKey).toBe(
        JSON.parse(mock.mock.calls[1][1].body).headers.idempotencyKey
      );
      expect(
        (
          await client.execute(
            "SELECT status FROM notification_emails WHERE notification_id='uncertain-mail'"
          )
        ).rows[0].status
      ).toBe("SENT");
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("records old ambiguous submissions for investigation without redelivery", async () => {
    await queue("old-uncertain-mail");
    await client.execute(
      "UPDATE notification_emails SET status='SENDING',first_attempt_at=?,lease_until=?",
      [Date.now() - 15 * 60_000, Date.now() - 1]
    );
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    try {
      expect((await deliverNotificationEmails(env)).skipped).toBe(1);
      expect(mock).not.toHaveBeenCalled();
      expect(
        (
          await client.execute(
            "SELECT status,skip_reason FROM notification_emails WHERE notification_id='old-uncertain-mail'"
          )
        ).rows[0]
      ).toMatchObject({ status: "SKIPPED", skip_reason: "DELIVERY_UNCERTAIN" });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
