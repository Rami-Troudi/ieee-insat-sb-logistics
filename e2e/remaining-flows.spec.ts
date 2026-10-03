import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@libsql/client";
const sessions = JSON.parse(readFileSync(".local/e2e-sessions.json", "utf8"));
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
test("chapter requests can be declined and borrowers can cancel future reservations", async ({
  page,
}) => {
  const cookie = await signup(page, "Chapter Borrower");
  await page.goto("/app/equipment");
  await page
    .getByRole("button", { name: /Select item/i })
    .first()
    .click();
  await page.getByRole("link", { name: /View selection/i }).click();
  await page.getByRole("button", { name: "Chapter", exact: true }).click();
  await page.locator("select").selectOption("e2e-chapter");
  await expect(page.getByText(/30 minutes/).first()).toBeVisible();
  await page.getByRole("button", { name: /Send reservation request/i }).click();
  await expect(page).toHaveURL(/\/app\/reservations/);
  await login(page, sessions.boardCookie);
  await page.goto("/board/reservations");
  const article = page.locator("article").filter({ hasText: "Robotics Club" });
  await article.getByRole("button", { name: "Decline", exact: true }).click();
  await expect(article.getByText("Declined", { exact: true })).toBeVisible();
  await login(page, cookie.name + "=" + cookie.value);
  const now = Date.now();
  const response = await page.request.post("/api/v1/reservations", {
    headers: { Origin: "http://127.0.0.1:5188" },
    data: {
      borrowerType: "PERSON",
      pickupAt: new Date(now + 60_000).toISOString(),
      returnAt: new Date(now + 3_600_000).toISOString(),
      items: [{ equipmentItemId: "e2e-meter", quantity: 1 }],
    },
  });
  expect(response.status()).toBe(201);
  const reservation = await response.json();
  await page.goto("/app/reservations");
  await page.getByRole("button", { name: "Cancel reservation", exact: true }).click();
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  expect(
    (await (await page.request.get("/api/v1/reservations/" + reservation.id)).json()).status
  ).toBe("CANCELLED");
  await login(page, sessions.boardCookie);
  await page.goto("/board/chapters");
  await page
    .getByPlaceholder("Chapter Name (e.g. Computer Society Chapter)")
    .fill("Browser Chapter");
  await page.getByPlaceholder("Short Code (e.g. CS)").fill("BROW");
  await page.getByRole("button", { name: "Add Chapter", exact: true }).click();
  const chapter = page.locator("div.p-4.rounded-xl").filter({ hasText: "Browser Chapter" }).last();
  await expect(chapter.getByRole("heading", { name: "Browser Chapter" })).toBeVisible();
  await chapter.getByRole("button", { name: "Disable", exact: true }).click();
  await expect(chapter.getByRole("button", { name: "Enable", exact: true })).toBeVisible();
  await chapter.getByRole("button", { name: "Enable", exact: true }).click();
  await expect(chapter.getByRole("button", { name: "Disable", exact: true })).toBeVisible();
});
test("older unread notifications remain accessible and all can be marked read", async ({
  page,
}) => {
  await signup(page, "Inbox Borrower");
  const identity = await (await page.request.get("/api/v1/me")).json();
  const db = createClient({ url: "file:" + resolve(".local/e2e.db") });
  try {
    await db.batch(
      Array.from({ length: 105 }, (_, i) => ({
        sql: "INSERT INTO notifications(id,user_id,type,title,message,created_at) VALUES(?,?,'TEST',?,'Older test notice',?)",
        args: ["browser-inbox-" + i, identity.user.id, "Inbox notice " + i, Date.now() + i],
      })),
      "write"
    );
  } finally {
    db.close();
  }
  await page.goto("/app/reservations");
  await page.getByRole("button", { name: "Notifications, 105 unread", exact: true }).click();
  await page.getByRole("button", { name: "Load older notifications", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Notifications" }).getByText("Inbox notice 0", { exact: true })
  ).toBeVisible();
  await page.getByRole("button", { name: "Mark all as read", exact: true }).click();
  await expect(page.getByRole("button", { name: "Notifications", exact: true })).toBeVisible();
});
test("catalogue errors are recoverable and invalid dates clear stale results", async ({ page }) => {
  await login(page, sessions.memberCookie);
  await page.route("**/api/v1/catalogue?**", (route) =>
    route.fulfill({ status: 503, json: { error: { message: "Temporary catalogue outage" } } })
  );
  await page.goto("/app/equipment");
  await expect(page.getByText("Temporary catalogue outage")).toBeVisible();
  await page.unroute("**/api/v1/catalogue?**");
  await page.reload();
  await expect(page.getByText("E2E Digital Multimeter", { exact: true })).toBeVisible();
  await page.getByLabel("Return", { exact: true }).fill("2020-01-01T10:00");
  await expect(page.getByText("E2E Digital Multimeter", { exact: true })).not.toBeVisible();
});
