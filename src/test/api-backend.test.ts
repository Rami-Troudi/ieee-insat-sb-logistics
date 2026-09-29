// @vitest-environment node
import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { serializeSignedCookie } from "better-call";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../worker/index";
import { createAuthDatabase, LibSqlD1Database } from "../worker/database";
import type { Env } from "../worker/env";

const origin = "https://app.test";
const authSecret = "test-secret-with-more-than-thirty-two-bytes-long";
let client: Client;
let db: LibSqlD1Database;
let env: Env;
let sentEmails: Array<Record<string, any>>;

async function seedUser({
  id,
  email,
  role = "MEMBER",
  clearance = "III",
}: {
  id: string;
  email: string;
  role?: string;
  clearance?: string;
}) {
  const timestamp = Date.now();
  await client.execute({
    sql: "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,?,?)",
    args: [id, email, id, timestamp, timestamp],
  });
  await client.execute({
    sql: `INSERT INTO app_users(id,email,name,role,clearance,affiliation,claimed_affiliation,affiliation_verified,
      status,data,created_at,updated_at) VALUES(?,?,?, ?,?,'IEEE','IEEE',1,'ACTIVE','{}',?,?)`,
    args: [id, email, id, role, clearance, timestamp, timestamp],
  });
  const token = `session-${id}`;
  await client.execute({
    sql: "INSERT INTO session(id,expiresAt,token,createdAt,updatedAt,userId) VALUES(?,?,?,?,?,?)",
    args: [`session-row-${id}`, timestamp + 60 * 60_000, token, timestamp, timestamp, id],
  });
  const cookie = await serializeSignedCookie(
    "__Secure-better-auth.session_token",
    token,
    authSecret,
    { path: "/", httpOnly: true, secure: true }
  );
  return { cookie: cookie.split(";")[0], id };
}

async function seedFreshBoardSession(userId: string) {
  const timestamp = Date.now();
  await client.execute({
    sql: "INSERT INTO staff_sessions(user_id,expires_at,fresh_until,revoked_at) VALUES(?,?,?,NULL)",
    args: [userId, timestamp + 8 * 60 * 60_000, timestamp + 10 * 60_000],
  });
}

async function addInventory(id: string, equipmentClass: string, visible = true) {
  const item = {
    id,
    name: `Item ${id}`,
    description: "test",
    category: "Tools",
    equipmentClass,
    trackingMode: "QUANTITY",
    totalQuantity: 1,
    availableQuantity: 1,
    allocatedQuantity: 0,
    borrowedQuantity: 0,
    damagedQuantity: 0,
    maintenanceQuantity: 0,
    lostQuantity: 0,
    borrowerVisible: visible,
    assets: [],
  };
  await client.execute({
    sql: `INSERT INTO inventory(id,name,category,equipment_class,tracking_mode,total_quantity,available_quantity,
      allocated_quantity,borrowed_quantity,damaged_quantity,maintenance_quantity,lost_quantity,borrower_visible,data,updated_at)
      VALUES(?,?,? ,?,'QUANTITY',1,1,0,0,0,0,0,?,?,?)`,
    args: [
      id,
      item.name,
      item.category,
      equipmentClass,
      visible ? 1 : 0,
      JSON.stringify(item),
      Date.now(),
    ],
  });
}

async function request(path: string, options: RequestInit = {}, cookie?: string) {
  const headers = new Headers(options.headers);
  if (cookie) headers.set("Cookie", cookie);
  if (options.method && options.method !== "GET") headers.set("Origin", origin);
  return app.request(`${origin}${path}`, { ...options, headers }, env);
}

beforeEach(async () => {
  client = createClient({ url: "file::memory:" });
  await client.executeMultiple(
    await (
      await import("node:fs/promises")
    ).readFile(new URL("../../drizzle/0000_backend.sql", import.meta.url), "utf8")
  );
  await client.executeMultiple(
    await (
      await import("node:fs/promises")
    ).readFile(new URL("../../drizzle/0001_runtime_invariants.sql", import.meta.url), "utf8")
  );
  db = new LibSqlD1Database(client);
  sentEmails = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("siteverify"))
        return Response.json({ success: true, hostname: "app.test" });
      if (String(input).includes("api.brevo.com")) {
        sentEmails.push(JSON.parse(String(init?.body)));
        return Response.json({}, { status: 201 });
      }
      throw new Error(`Unexpected fetch to ${String(input)}`);
    })
  );
  env = {
    DB: db,
    AUTH_DATABASE: createAuthDatabase(client),
    API_RATE_LIMITER: { limit: async () => ({ success: true }) },
    AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
    APP_ORIGIN: origin,
    ENVIRONMENT: "staging",
    BETTER_AUTH_SECRET: authSecret,
    BREVO_API_KEY: "test-key",
    BREVO_SENDER_EMAIL: "board@example.test",
    BREVO_SENDER_NAME: "Board",
    TURNSTILE_SECRET_KEY: "test-turnstile-secret",
    TURNSTILE_SITE_KEY: "test-site-key",
    CRON_SECRET: "cron-test-secret",
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  client.close();
});

describe("Vercel API backend on SQLite-compatible storage", () => {
  it("serves health/config and rejects unauthorized member and board operations", async () => {
    const health = await request("/api/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });
    expect((await request("/api/v1/config")).status).toBe(200);

    const publicCatalog = await request("/api/v1/catalog");
    expect(publicCatalog.status).toBe(200);
    expect((await request("/api/v1/catalog/item-1")).status).toBe(404);
    const memberRoutes = [
      "/api/v1/me",
      "/api/v1/profile",
      "/api/v1/loans",
      "/api/v1/loans/loan-1",
      "/api/v1/notifications",
      "/api/v1/projects",
      "/api/v1/projects/mine",
      "/api/v1/requests",
      "/api/v1/requests/request-1",
    ];
    for (const path of memberRoutes) expect((await request(path)).status, path).toBe(401);
    expect(
      (
        await request("/api/v1/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).status
    ).toBe(401);
    expect((await request("/api/v1/requests/request-1", { method: "DELETE" })).status).toBe(401);
    expect(
      (
        await request("/api/v1/notifications/notif-1", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).status
    ).toBe(401);
    expect((await request("/api/v1/notifications/read-all", { method: "POST" })).status).toBe(401);

    const boardRoutes = [
      "/api/v1/board/session",
      "/api/v1/board/requests",
      "/api/v1/board/requests/request-1",
      "/api/v1/board/inventory",
      "/api/v1/board/loans",
    ];
    for (const path of boardRoutes) expect((await request(path)).status, path).toBe(403);
    expect((await request("/api/v1/board/rpc", { method: "POST", body: "{}" })).status).toBe(403);
    expect(
      (
        await request("/api/v1/board/inventory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).status
    ).toBe(403);
    expect(
      (
        await request("/api/v1/board/inventory/item-1/visibility", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).status
    ).toBe(403);
    expect(
      (
        await request("/api/v1/board/rpc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            service: "loan",
            method: "confirmReturn",
            args: [{ loanId: "loan-1" }],
          }),
        })
      ).status
    ).toBe(403);
  });

  it("does not create borrower accounts or issue borrower sign-in links", async () => {
    const response = await request("/api/v1/register-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Test Member",
        email: "member@example.test",
        phone: "+21612345678",
        membership: "IEEE",
        turnstileToken: "valid-test-token",
      }),
    });
    expect(response.status).toBe(404);
    await seedUser({ id: "member-login-disabled", email: "member@example.test" });
    const login = await request("/api/auth/sign-in/magic-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "member@example.test",
        callbackURL: `${origin}/app`,
        turnstileToken: "valid-test-token",
      }),
    });
    expect(login.status).toBe(200);
    expect(sentEmails).toHaveLength(0);
  });

  it("enforces member ownership, C/E request policy, and idempotent transactional request writes", async () => {
    const member = await seedUser({ id: "member-1", email: "member@example.test" });
    await addInventory("item-c", "C");
    await addInventory("item-e", "E");
    await addInventory("item-a", "A");

    const catalogResponse = await request("/api/v1/catalog", {}, member.cookie);
    expect(catalogResponse.status).toBe(200);
    const catalog = (await catalogResponse.json()) as Array<{ id: string; action: string }>;
    expect(catalog.find((item) => item.id === "item-c")?.action).toBe("REQUEST");
    expect(catalog.find((item) => item.id === "item-e")?.action).toBe("REQUEST");

    const baseBody = {
      contactEmail: "member@example.test",
      expectedReturnDate: new Date(Date.now() + 7 * 86400000).toISOString(),
      items: [{ itemId: "item-a", quantity: 1 }],
    };
    const flaggedClass = await request(
      "/api/v1/requests",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "request-key-a-00001",
        },
        body: JSON.stringify(baseBody),
      },
      member.cookie
    );
    expect(flaggedClass.status).toBe(201);
    const flaggedData = (await flaggedClass.json()) as any;
    expect(flaggedData.items[0].flagged).toBe(true);

    const invalidItem = await request(
      "/api/v1/requests",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "request-key-invalid-00001",
        },
        body: JSON.stringify({ ...baseBody, items: [{ itemId: "non-existent-item", quantity: 1 }] }),
      },
      member.cookie
    );
    expect(invalidItem.status).toBe(400);

    const body = { ...baseBody, items: [{ itemId: "item-c", quantity: 1 }] };
    const headers = {
      "Content-Type": "application/json",
      "Idempotency-Key": "request-key-c-00001",
    };
    const created = await request(
      "/api/v1/requests",
      { method: "POST", headers, body: JSON.stringify(body) },
      member.cookie
    );
    expect(created.status).toBe(201);
    const createdValue = (await created.json()) as {
      id: string;
      userId: string;
      contactEmailVerified: boolean;
      userClearance: string;
    };
    expect(createdValue.userId).toBe(member.id);
    expect(createdValue).toMatchObject({ contactEmailVerified: false, userClearance: "III" });

    const replay = await request(
      "/api/v1/requests",
      { method: "POST", headers, body: JSON.stringify(body) },
      member.cookie
    );
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ id: createdValue.id });
    const count = await db
      .prepare("SELECT COUNT(*) AS count FROM requests WHERE user_id=?")
      .bind(member.id)
      .first<{ count: number }>();
    expect(count?.count).toBe(2);

    const other = await seedUser({ id: "member-2", email: "other@example.test" });
    expect((await request(`/api/v1/requests/${createdValue.id}`, {}, other.cookie)).status).toBe(
      404
    );
    expect((await request("/api/v1/board/inventory", {}, member.cookie)).status).toBe(403);
  });

  it("accepts a borrower request with email only and does not expose it by email", async () => {
    await addInventory("public-c", "C");
    const body = {
      contactEmail: "unverified@example.test",
      expectedReturnDate: new Date(Date.now() + 7 * 86400000).toISOString(),
      items: [{ itemId: "public-c", quantity: 1 }],
    };
    const response = await request("/api/v1/requests", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "request-email-only-0001",
      },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as {
      userId: string;
      userEmail: string;
      userName: string;
      contactEmailVerified: boolean;
      userClearance: string;
    };
    expect(created).toMatchObject({
      userEmail: "unverified@example.test",
      userName: "Unverified borrower",
      contactEmailVerified: false,
      userClearance: "I",
    });
    expect((await request("/api/v1/requests")).status).toBe(401);
    const contact = await db
      .prepare("SELECT status,affiliation_verified FROM app_users WHERE email=?")
      .bind("unverified@example.test")
      .first<{ status: string; affiliation_verified: number }>();
    expect(contact).toMatchObject({ status: "PENDING", affiliation_verified: 0 });
  });

  it("enforces staff email-code verification before board authorization", async () => {
    const operator = await seedUser({
      id: "operator-1",
      email: "operator@example.test",
      role: "OPERATOR",
    });
    const challenge = await request("/api/v1/staff/challenge", { method: "POST" }, operator.cookie);
    expect(challenge.status).toBe(202);
    expect(sentEmails).toHaveLength(1);
    const code = String(sentEmails[0].htmlContent).match(/>(\d{6})</)?.[1];
    expect(code).toMatch(/^\d{6}$/);
    const denied = await request("/api/v1/board/inventory", {}, operator.cookie);
    expect(denied.status).toBe(403);

    const verified = await request(
      "/api/v1/staff/verify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      },
      operator.cookie
    );
    expect(verified.status).toBe(200);
    expect((await request("/api/v1/board/session", {}, operator.cookie)).status).toBe(200);
    expect((await request("/api/v1/board/inventory", {}, operator.cookie)).status).toBe(200);
  });

  it("requires the cron secret and expires overdue stock on catalogue access", async () => {
    expect((await request("/api/cron/maintenance")).status).toBe(401);
    const member = await seedUser({ id: "member-expiry", email: "expiry@example.test" });
    const item = {
      id: "expired-item",
      name: "Expired",
      category: "Tools",
      equipmentClass: "C",
      trackingMode: "QUANTITY",
      totalQuantity: 1,
      availableQuantity: 0,
      allocatedQuantity: 1,
      borrowedQuantity: 0,
      damagedQuantity: 0,
      maintenanceQuantity: 0,
      lostQuantity: 0,
      borrowerVisible: true,
      assets: [],
    };
    await client.execute({
      sql: `INSERT INTO inventory(id,name,category,equipment_class,tracking_mode,total_quantity,available_quantity,
      allocated_quantity,borrowed_quantity,damaged_quantity,maintenance_quantity,lost_quantity,borrower_visible,data,updated_at)
      VALUES(?,?,?,'C','QUANTITY',1,0,1,0,0,0,0,1,?,?)`,
      args: [item.id, item.name, item.category, JSON.stringify(item), Date.now()],
    });
    const allocation = {
      id: "allocation-1",
      requestId: "request-expired",
      itemId: item.id,
      quantity: 1,
      status: "ACTIVE",
      assetIds: [],
    };
    await db
      .prepare(
        "INSERT INTO record_store(kind,id,owner_id,status,expires_at,data,updated_at) VALUES('allocation',?,?,'ACTIVE',?,?,?)"
      )
      .bind(allocation.id, item.id, Date.now() - 1, JSON.stringify(allocation), Date.now())
      .run();
    const response = await request("/api/v1/catalog", {}, member.cookie);
    expect(response.status).toBe(200);
    const stock = await db
      .prepare("SELECT available_quantity,allocated_quantity FROM inventory WHERE id=?")
      .bind(item.id)
      .first<{ available_quantity: number; allocated_quantity: number }>();
    expect(stock).toMatchObject({ available_quantity: 1, allocated_quantity: 0 });
  });
});

  it("runs the real request -> allocation -> handover -> return lifecycle", async () => {
    const member = await seedUser({ id: "member-lifecycle", email: "member-lifecycle@example.test" });
    const operator = await seedUser({
      id: "operator-lifecycle",
      email: "operator-lifecycle@example.test",
      role: "OPERATOR",
      clearance: "V",
    });
    await seedFreshBoardSession(operator.id);
    await addInventory("item-lifecycle", "E");

    const create = await request(
      "/api/v1/requests",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "lifecycle-request-0001",
        },
        body: JSON.stringify({
          contactEmail: "member-lifecycle@example.test",
          expectedReturnDate: new Date(Date.now() + 7 * 86400000).toISOString(),
          items: [{ itemId: "item-lifecycle", quantity: 1 }],
        }),
      },
      member.cookie
    );
    expect(create.status).toBe(201);
    const created = (await create.json()) as any;

    const review = await request(
      "/api/v1/board/rpc",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service: "request",
          method: "reviewRequest",
          args: [{
            requestId: created.id,
            lines: [{ lineId: created.items[0].id, approvedQuantity: 1 }],
          }],
        }),
      },
      operator.cookie
    );
    expect(review.status).toBe(200);
    const reviewed = (await review.json()) as any;
    expect(reviewed.decisionStatus).toBe("APPROVED");

    const handover = await request(
      "/api/v1/board/rpc",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service: "request",
          method: "confirmHandover",
          args: [{ requestId: created.id, lineHandoverDetails: [], idempotencyKey: "lifecycle-handover-0001" }],
        }),
      },
      operator.cookie
    );
    expect(handover.status).toBe(200);
    const handoverBody = (await handover.json()) as any;
    expect(handoverBody.loanId).toBeTruthy();

    const loan = await db.prepare("SELECT data FROM record_store WHERE kind='loan' AND id=?")
      .bind(handoverBody.loanId)
      .first<{ data: string }>();
    expect(loan).not.toBeNull();

    const returned = await request(
      "/api/v1/board/rpc",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service: "loan",
          method: "confirmReturn",
          args: [{
            loanId: handoverBody.loanId,
            items: [{ lineItemId: JSON.parse(loan!.data).items[0].id, returnedQuantity: 1 }],
            idempotencyKey: "lifecycle-return-0001",
          }],
        }),
      },
      operator.cookie
    );
    expect(returned.status).toBe(200);
    const returnedLoan = (await returned.json()) as any;
    expect(returnedLoan.lifecycleStatus).toBe("CLOSED");

    const stock = await db.prepare(
      "SELECT available_quantity,allocated_quantity,borrowed_quantity FROM inventory WHERE id=?"
    ).bind("item-lifecycle").first<any>();
    expect(stock).toMatchObject({ available_quantity: 1, allocated_quantity: 0, borrowed_quantity: 0 });
  });

  it("enforces human authorization for clearance changes", async () => {
    const operator = await seedUser({
      id: "operator-clearance",
      email: "operator-clearance@example.test",
      role: "OPERATOR",
      clearance: "V",
    });
    const member = await seedUser({ id: "member-clearance", email: "member-clearance@example.test" });
    await seedFreshBoardSession(operator.id);

    const denied = await request(
      "/api/v1/board/rpc",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service: "user",
          method: "updateClearance",
          args: [{ userId: member.id, newClearance: "V", source: "MANUAL_LEVEL_IV", reason: "human review" }],
        }),
      },
      operator.cookie
    );
    expect(denied.status).toBe(403);
  });

  it("maps verified Eurobot and RAS Board affiliations to Level V during human processing", async () => {
    const operator = await seedUser({
      id: "operator-process",
      email: "operator-process@example.test",
      role: "OPERATOR",
      clearance: "V",
    });
    const member = await seedUser({ id: "member-process", email: "member-process@example.test", clearance: "I" });
    await client.execute("UPDATE app_users SET affiliation='EXTERNAL', affiliation_verified=0 WHERE id=?", [member.id]);
    await seedFreshBoardSession(operator.id);

    const response = await request(
      "/api/v1/board/rpc",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service: "user",
          method: "processUser",
          args: [{ userId: member.id, verifiedAffiliation: "EUROBOT", notes: "Verified by logistics desk" }],
        }),
      },
      operator.cookie
    );
    expect(response.status).toBe(200);
    const processed = (await response.json()) as any;
    expect(processed.clearance).toBe("V");
    expect(processed.affiliation).toBe("EUROBOT");
  });

