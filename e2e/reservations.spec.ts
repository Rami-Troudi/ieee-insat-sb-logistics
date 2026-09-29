import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const sessions = JSON.parse(
  await readFile(resolve(process.cwd(), ".local/e2e-sessions.json"), "utf8")
) as {
  memberCookie: string;
  boardCookie: string;
  qrToken: string;
};
async function signIn(page: import("@playwright/test").Page, cookie: string) {
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

test("member requests equipment, Board approves it, and the reservation appears in the schedule", async ({
  page,
}) => {
  await signIn(page, sessions.memberCookie);
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: /Make room for your next idea/i })).toBeVisible();
  await expect(page.getByText("E2E Digital Multimeter")).toBeVisible();
  await page
    .getByRole("button", { name: /Add to basket/i })
    .first()
    .click();
  await page.getByRole("link", { name: /View basket/i }).click();
  await expect(page.getByRole("heading", { name: /Build a basket/i })).toBeVisible();
  await page.getByRole("button", { name: /Send reservation request/i }).click();
  await expect(page).toHaveURL(/\/app\/reservations/);
  await expect(page.getByText("Pending", { exact: true }).first()).toBeVisible();

  await signIn(page, sessions.boardCookie);
  await page.goto("/board/reservations");
  await expect(page.getByRole("heading", { name: /Good requests/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Alex Member" })).toBeVisible();
  await page.getByRole("button", { name: /Assign assets/i }).click();
  await expect(page.getByText("Choose the physical units")).toBeVisible();
  await page
    .locator(".allocation-option")
    .filter({ hasText: "E2E-METER-01" })
    .locator("input")
    .uncheck();
  await page
    .locator(".allocation-option")
    .filter({ hasText: "E2E-METER-02" })
    .locator("input")
    .check();
  await page.getByRole("button", { name: /Confirm allocation/i }).click();
  await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();
  await page.goto("/board/calendar");
  await expect(page.getByText(/E2E Digital Multimeter E2E-METER-02/)).toBeVisible();
});

test("guest can request a sign-in link and the layout works at a narrow viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app");
  await page
    .getByRole("button", { name: /Add to basket/i })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: /Sign in to reserve/i })).toBeVisible();
  await page.getByLabel("Email address").fill("guest@example.test");
  await expect(page.getByRole("button", { name: /Email me a sign-in link/i })).toBeVisible();
  await expect(page.locator(".app-shell")).toHaveCSS("display", "block");
});
