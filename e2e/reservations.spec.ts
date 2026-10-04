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
  await expect(page.getByRole("heading", { name: "Equipment catalogue" })).toBeVisible();
  await expect(page.getByText("E2E Digital Multimeter")).toBeVisible();
  await page
    .getByRole("button", { name: /Select item/i })
    .first()
    .click();
  await page.getByRole("link", { name: /View selection/i }).click();
  await expect(page.getByRole("heading", { name: "Selected items" })).toBeVisible();
  await page.getByRole("button", { name: /Send reservation request/i }).click();
  await expect(page).toHaveURL(/\/app\/reservations/);
  await expect(page.getByText("Pending", { exact: true }).first()).toBeVisible();

  await signIn(page, sessions.boardCookie);
  await page.goto("/board/reservations");
  await expect(page.getByRole("heading", { name: "Reservation requests" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Alex Member" })).toBeVisible();
  await page.getByRole("button", { name: /Approve reservation/i }).click();
  await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark as handed over" })).toBeVisible();
  const response = await page.request.get("/api/v1/board/reservations");
  const reservations = await response.json();
  const reservation = reservations.find(
    (entry: { borrower: { name: string } }) => entry.borrower.name === "Alex Member"
  );
  await page.goto("/board/scan?res=" + reservation.id);
  await expect(page.getByRole("heading", { name: "Scan equipment" })).toBeVisible();
  await expect(page.getByText("0/1 collected · 0/1 returned")).toBeVisible();
  await page.goto("/board/calendar");
  await page.getByRole("button", { name: "Next week" }).click();
  await expect(page.getByText(/1× E2E Digital Multimeter/)).toBeVisible();
});

test("guest can sign up passwordlessly and the layout works at a narrow viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app");
  await page
    .getByRole("button", { name: /Select item/i })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: /Sign in to reserve/i })).toBeVisible();
  await page.locator("#borrower-first-name").fill("Browser");
  await page.locator("#borrower-last-name").fill("Borrower");
  await page.getByLabel("Email address").fill("guest@example.test");
  await page.locator("#borrower-phone").fill("+216 98765432");
  await page.locator('form button[type="submit"]').click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const identity = await page.request.get("/api/v1/me");
  expect((await identity.json()).user.email).toBe("guest@example.test");
  await expect(page.locator(".app-shell")).toHaveCSS("display", "block");
});
