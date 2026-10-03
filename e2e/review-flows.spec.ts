import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@libsql/client";

const sessions = JSON.parse(readFileSync(".local/e2e-sessions.json", "utf8"));
const database = () => createClient({ url: "file:" + resolve(".local/e2e.db") });
async function login(page: Page, cookie: string) {
  await page.context().clearCookies();
  await page.context().addCookies([
    {
      name: cookie.split("=")[0],
      value: cookie.split("=").slice(1).join("="),
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}
async function update(sql: string, args: Array<string | number> = []) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const client = database();
    try {
      await client.execute({ sql, args });
      return;
    } catch (e: unknown) {
      if (attempt < 9 && String((e as Error)?.message ?? "").includes("SQLITE_BUSY")) {
        await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
        continue;
      }
      throw e;
    } finally {
      client.close();
    }
  }
}
async function signup(page: Page, name: string) {
  const response = await page.request.post("/api/v1/auth/borrower", {
    headers: { Origin: "http://127.0.0.1:5188" },
    data: {
      name,
      email: name.replaceAll(" ", "-").toLowerCase() + "@example.test",
      phone: "+216 12345678",
      password: "Browser-test-password-2026",
      membership: "IEEE",
    },
  });
  expect(response.ok()).toBeTruthy();
  return (await page.context().cookies()).find(
    (cookie) => cookie.name === "better-auth.session_token"
  )!;
}
async function requestLoan(page: Page, quantity = 1) {
  const now = Date.now();
  const response = await page.request.post("/api/v1/reservations", {
    headers: { Origin: "http://127.0.0.1:5188" },
    data: {
      borrowerType: "PERSON",
      pickupAt: new Date(now + 60_000).toISOString(),
      returnAt: new Date(now + 3_600_000).toISOString(),
      items: [{ equipmentItemId: "e2e-meter", quantity }],
    },
  });
  expect(response.status()).toBe(201);
  return response.json();
}

test("direct sticker links open the scanner and preserve the destination through staff login", async ({
  page,
}) => {
  await page.goto("/scan/" + sessions.qrToken);
  await expect(page).toHaveURL(/board\/scan\?token=/);
  await expect(page.getByRole("heading", { name: "Board Staff Sign In" })).toBeVisible();
  await page.locator("#staff-email").fill("e2e-board@example.test");
  await page.locator("#staff-password").fill("Isolated-test-password-2026");
  await page.getByRole("button", { name: /^Sign In$/i }).click();
  await expect(page.getByRole("heading", { name: "Scan equipment" })).toBeVisible();
  await expect(page).toHaveURL(/board\/scan\?token=/);
  await expect(
    page.getByPlaceholder("Paste reservation QR URL or material QR token...")
  ).toHaveValue(sessions.qrToken);
});

test("borrower filters retain overdue, partial return and declined reservations", async ({
  page,
}) => {
  await login(page, sessions.memberCookie);
  const base = {
    requestedBy: { id: "e2e-member", name: "Alex", email: "a@example.test" },
    borrower: { type: "PERSON", id: "e2e-member", name: "Alex" },
    items: [{ lineId: "line", equipmentItemId: "e2e-meter", name: "Filter Meter", quantity: 2 }],
    pickupAt: new Date().toISOString(),
    returnAt: new Date().toISOString(),
    note: null,
    collectedCount: 2,
    returnedCount: 1,
    totalQuantity: 2,
    createdAt: new Date().toISOString(),
  };
  await page.route("**/api/v1/reservations", (route) =>
    route.fulfill({
      json: [
        { ...base, id: "partial", status: "APPROVED", derivedStatus: "PARTIALLY_RETURNED" },
        { ...base, id: "overdue", status: "APPROVED", derivedStatus: "OVERDUE" },
        { ...base, id: "declined", status: "DECLINED", derivedStatus: "DECLINED" },
      ],
    })
  );
  await page.goto("/app/reservations");
  await page.getByRole("button", { name: "Currently Borrowed", exact: true }).click();
  await expect(page.getByText("Filter Meter", { exact: true })).toHaveCount(2);
  await page.getByRole("button", { name: "Past", exact: true }).click();
  await expect(page.getByText("Filter Meter", { exact: true })).toHaveCount(1);
});

test("notifications, quantity approval, manual pickup, QR returns and borrower history work together", async ({
  page,
}) => {
  const borrowerCookie = await signup(page, "Notification Borrower");
  const loan = await requestLoan(page, 2);
  await login(page, sessions.boardCookie);
  await page.goto("/board/reservations");
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Notifications" })
      .getByText(/Notification Borrower/)
      .first()
  ).toBeVisible();
  await page.getByRole("button", { name: /^Notifications/ }).click();
  const article = page.locator("article").filter({ hasText: "Notification Borrower" });
  await article.getByRole("button", { name: /Approve reservation/i }).click();
  await expect(article.getByText("Approved", { exact: true })).toBeVisible();
  const client = database();
  try {
    expect(
      (
        await client.execute({
          sql: "SELECT id FROM reservation_assets WHERE reservation_id=?",
          args: [loan.id],
        })
      ).rows
    ).toHaveLength(0);
  } finally {
    client.close();
  }
  await login(page, borrowerCookie.name + "=" + borrowerCookie.value);
  await page.goto("/app/reservations");
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Notifications" })
      .getByText("Reservation approved", { exact: true })
  ).toBeVisible();
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await page.getByRole("button", { name: "Show Handover QR" }).click();
  await expect(page.getByRole("heading", { name: "Desk Handover QR" })).toBeVisible();
  await expect(page.getByRole("dialog").locator("svg").first()).toBeVisible();
  await update("UPDATE reservations SET pickup_at=?,return_at=? WHERE id=?", [
    Date.now() - 60_000,
    Date.now() + 1_800_000,
    loan.id,
  ]);
  await login(page, sessions.boardCookie);
  await page.goto("/board/reservations");
  await article.getByRole("button", { name: "Mark as handed over" }).click();
  await page.getByRole("checkbox", { name: "E2E-METER-01", exact: true }).check();
  await page.getByRole("checkbox", { name: "E2E-METER-02", exact: true }).check();
  await page.getByRole("button", { name: "Confirm handover", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Confirm equipment handover" })).not.toBeVisible();
  await login(page, borrowerCookie.name + "=" + borrowerCookie.value);
  await page.goto("/app/reservations");
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Notifications" })
      .getByText(/return.*soon|return.*due|return.*equipment/i)
      .first()
  ).toBeVisible();
  await update("UPDATE reservations SET return_at=? WHERE id=?", [Date.now() - 1000, loan.id]);
  await page.reload();
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Notifications" })
      .getByText(/overdue/i)
      .first()
  ).toBeVisible();
  await page.getByRole("button", { name: "Mark all as read" }).click();
  await expect(page.getByRole("button", { name: "Notifications", exact: true })).toBeVisible();
  await login(page, sessions.boardCookie);
  await update("UPDATE assets SET last_scan_at=?", [Date.now() - 4000]);
  await page.goto("/board/scan?res=" + loan.id);
  await page
    .getByPlaceholder("Paste reservation QR URL or material QR token...")
    .fill(sessions.qrToken);
  await page.getByRole("button", { name: "Record Handover", exact: true }).click();
  await expect(page.getByText("2/2 collected · 1/2 returned")).toBeVisible();
  await page
    .getByPlaceholder("Paste reservation QR URL or material QR token...")
    .fill("http://127.0.0.1:5188/scan/" + sessions.secondQrToken);
  await page.getByRole("button", { name: "Record Handover", exact: true }).click();
  await expect(page.getByText("2/2 collected · 2/2 returned")).toBeVisible();
  await page.goto("/board/reservations");
  await page
    .getByRole("button", { name: "View borrower details for Notification Borrower" })
    .click();
  await expect(page.getByRole("heading", { name: "Borrower information" })).toBeVisible();
  await expect(page.getByText("notification-borrower@example.test", { exact: true })).toBeVisible();
  await expect(page.getByText("+216 12345678", { exact: true })).toBeVisible();
  await expect(page.getByText("2 materials collected in total · 0 still borrowed")).toBeVisible();
  const db = database();
  try {
    const assignments = await db.execute({
      sql: "SELECT state,checked_out_by_user_id,checked_in_by_user_id FROM reservation_assets WHERE reservation_id=?",
      args: [loan.id],
    });
    expect(assignments.rows).toHaveLength(2);
    for (const row of assignments.rows)
      expect(row).toMatchObject({
        state: "RETURNED",
        checked_out_by_user_id: "e2e-board",
        checked_in_by_user_id: "e2e-board",
      });
    expect((await db.execute("PRAGMA foreign_key_check")).rows).toHaveLength(0);
  } finally {
    db.close();
  }
});

test("missed pickup cancellation and notifications are visible in the browser", async ({
  page,
}) => {
  await signup(page, "Expired Borrower");
  const loan = await requestLoan(page);
  await update("UPDATE reservations SET pickup_at=?,return_at=? WHERE id=?", [
    Date.now() - 31 * 60_000,
    Date.now() + 60_000,
    loan.id,
  ]);
  await page.goto("/app/reservations");
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Notifications" })
      .getByText(/pickup.*expired|pickup.*missed|cancelled/i)
      .first()
  ).toBeVisible();
});

test("bulk material QR export and a single label render safely", async ({ page }) => {
  await login(page, sessions.boardCookie);
  await page.goto("/board/inventory");
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Export all QR codes" }).click();
  const popup = await popupPromise;
  await expect(popup.getByRole("heading", { name: /2 QR labels/ })).toBeVisible();
  await expect(popup.locator("article.label")).toHaveCount(2);
  await expect(popup.locator("article.label svg")).toHaveCount(2);
  await popup.close();
  await page.getByRole("button", { name: "Assets (2)" }).click();
  await page.getByRole("button", { name: "Sticker", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Asset Printable QR Sticker" })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PNG" }).click();
  expect((await download).suggestedFilename()).toContain("label.png");
});

test("Board creates equipment, tracks unit state and prints escaped labels under CSP", async ({
  page,
}) => {
  await login(page, sessions.boardCookie);
  await page.goto("/board/inventory");
  await page.getByRole("button", { name: "Add Equipment", exact: true }).click();
  const name = 'Browser <img src=x onerror="alert(1)"> Meter';
  await page.getByPlaceholder("e.g. HDMI Cable 5m").fill(name);
  await page.getByPlaceholder("e.g. Cables & Adapters").fill("Browser Test");
  await page
    .getByPlaceholder("Specifications, details, requirements...")
    .fill("Disposable browser fixture");
  await page.getByRole("button", { name: "Create Equipment", exact: true }).click();
  const article = page.locator("article").filter({ hasText: name });
  await expect(article).toBeVisible();
  await page.getByPlaceholder("New Asset Code (e.g. PRJ-004)").fill("BROWSER-UNIT-01");
  await article.getByRole("button", { name: "Add Asset" }).click();
  await expect(article.getByText("BROWSER-UNIT-01", { exact: true })).toBeVisible();
  await article.locator("select").selectOption("OUT_OF_SERVICE");
  await expect(article.locator("select")).toHaveValue("OUT_OF_SERVICE");
  await article.locator("select").selectOption("AVAILABLE");
  await expect(article.locator("select")).toHaveValue("AVAILABLE");
  await article.getByRole("button", { name: "Disable", exact: true }).click();
  await expect(article.getByRole("button", { name: "Reactivate" })).toBeVisible();
  await article.getByRole("button", { name: "Reactivate" }).click();
  await article.getByRole("button", { name: "Sticker", exact: true }).click();
  await page.context().addInitScript(() => {
    window.print = () => {
      (window as unknown as { printed: boolean }).printed = true;
    };
  });
  await page.evaluate(() => {
    const meta = document.createElement("meta");
    meta.httpEquiv = "Content-Security-Policy";
    meta.content =
      "default-src 'self'; script-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'";
    document.head.append(meta);
  });
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Print Label", exact: true }).click();
  const popup = await popupPromise;
  await expect(popup.locator(".name")).toHaveText(name);
  expect(await popup.locator("script").count()).toBe(0);
  expect(await popup.locator("img").count()).toBe(1);
  await expect
    .poll(() => popup.evaluate(() => Boolean((window as unknown as { printed: boolean }).printed)))
    .toBeTruthy();
  await popup.close();
});

test("Superadmin creates staff, changes roles, resets passwords and revokes access", async ({
  page,
}) => {
  await login(page, sessions.adminCookie);
  await page.goto("/board/accounts");
  await page.getByRole("button", { name: "Add Board Member", exact: true }).click();
  await page.getByPlaceholder("e.g. Rami Ben Ali").fill("Browser Staff");
  await page.getByPlaceholder("e.g. member@insat.ieee.tn").fill("browser-staff@example.test");
  await page.locator("#new-board-password").fill("Browser-staff-password-2026");
  await page.locator("#new-board-password-confirmation").fill("Browser-staff-password-2026");
  await page.getByRole("button", { name: "Create Board Member", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Board Account Provisioned" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Done", exact: true }).click();
  const row = page.locator("tr").filter({ hasText: "browser-staff@example.test" });
  await expect(row).toBeVisible();
  await row.locator("select").selectOption("SUPERADMIN");
  await expect(row.locator("select")).toHaveValue("SUPERADMIN");
  await row.locator("select").selectOption("BOARD");
  await expect(row.locator("select")).toHaveValue("BOARD");
  await row.getByRole("button", { name: "Set Password" }).click();
  await page.locator("#reset-user-password").fill("Browser-reset-password-2026");
  await page.locator("#reset-user-password-confirmation").fill("Browser-reset-password-2026");
  await page.getByRole("dialog").getByRole("button", { name: "Set Password", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Set New Password" })).not.toBeVisible();
  await row.getByRole("button", { name: "Disable access" }).click();
  await expect(row.getByRole("button", { name: "Enable access" })).toBeVisible();
  await row.getByRole("button", { name: "Enable access" }).click();
  await expect(row.getByRole("button", { name: "Disable access" })).toBeVisible();
  await page.goto("/board/audit");
  await expect(page.getByRole("heading", { name: /activity|audit/i }).first()).toBeVisible();
});

test("camera start and stop update the controls and release a simulated media stream", async ({
  page,
}) => {
  await login(page, sessions.boardCookie);
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 480;
      canvas.getContext("2d")!.fillRect(0, 0, 640, 480);
      const stream = canvas.captureStream(30);
      (window as unknown as { testStream: MediaStream }).testStream = stream;
      return stream;
    };
  });
  await page.goto("/board/scan");
  await page.getByRole("button", { name: "Start Camera", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop Camera", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Stop Camera", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start Camera", exact: true })).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as unknown as { testStream: MediaStream }).testStream
        .getTracks()
        .every((track) => track.readyState === "ended")
    )
  ).toBeTruthy();
});
