import { test, expect } from "@playwright/test";

const viewports = [
  { width: 375, height: 667, name: "mobile-375" },
  { width: 430, height: 932, name: "mobile-430" },
  { width: 768, height: 1024, name: "tablet-768" },
  { width: 1024, height: 768, name: "desktop-1024" },
  { width: 1440, height: 900, name: "desktop-1440" },
];

test.describe("Production shell", () => {
  for (const vp of viewports) {
    test(`catalogue shell renders at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/app/inventory");
      await expect(page.getByRole("heading", { name: "Equipment Catalogue" })).toBeVisible();
      await expect(page.getByRole("link", { name: /IEEE RAS INSAT Logistics Home/i })).toBeVisible();
      if (vp.width < 1024) {
        await expect(page.getByRole("navigation", { name: "Mobile Navigation" })).toBeVisible();
      } else {
        await expect(page.getByRole("navigation", { name: "Sidebar Navigation" })).toBeVisible();
      }
    });
  }

  test("board login uses passwordless authentication", async ({ page }) => {
    await page.goto("/auth/board-login");
    await expect(page.getByRole("heading", { name: "Board & Operator Access" })).toBeVisible();
    await expect(page.getByLabel("Staff email")).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  });
});
