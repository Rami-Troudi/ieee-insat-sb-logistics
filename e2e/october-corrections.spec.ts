import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QRCodeSVG } from "qrcode.react";
const sessions = JSON.parse(readFileSync(".local/e2e-sessions.json", "utf8"));
async function login(page: Page) {
  await page.context().addCookies([
    {
      name: sessions.boardCookie.split("=")[0],
      value: sessions.boardCookie.split("=").slice(1).join("="),
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}
const reservation = (index: number) => ({
  id: `page-${index}`,
  requestedBy: { id: "member", name: `Borrower ${index}`, email: "test@example.test" },
  borrower: { type: "PERSON", id: "member", name: `Borrower ${index}` },
  items: [
    { lineId: `line-${index}`, equipmentItemId: "meter", name: "Pagination Meter", quantity: 1 },
  ],
  pickupAt: new Date(Date.now() + 3600000).toISOString(),
  returnAt: new Date(Date.now() + 7200000).toISOString(),
  note: null,
  status: index === 100 ? "APPROVED" : "PENDING",
  derivedStatus: index === 100 ? "APPROVED" : "PENDING",
  collectedCount: 0,
  returnedCount: 0,
  totalQuantity: 1,
  createdAt: new Date().toISOString(),
});
test("queue and routed calendar include reservations beyond the first 100", async ({ page }) => {
  await login(page);
  const records = Array.from({ length: 101 }, (_, i) => {
    const row = reservation(i);
    const start = new Date();
    start.setHours(10, 0, 0, 0);
    if (i < 100) start.setDate(start.getDate() - 30);
    return {
      ...row,
      pickupAt: start.toISOString(),
      returnAt: new Date(start.getTime() + 3600000).toISOString(),
    };
  });
  await page.route("**/api/v1/board/reservations?*", (route) => {
    const offset = Number(new URL(route.request().url()).searchParams.get("offset"));
    return route.fulfill({ json: records.slice(offset, offset + 100) });
  });
  await page.goto("/board/reservations");
  await expect(page.getByText("Page 1 of 3 · 101 reservations")).toBeVisible();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByText("Page 2 of 3 · 101 reservations")).toBeVisible();
  await page.getByRole("button", { name: "Approved 1" }).click();
  await expect(
    page.getByRole("button", { name: "View borrower details for Borrower 100" })
  ).toBeVisible();
  await page.goto("/board/calendar");
  await expect(page.getByText("Borrower 100 (1× Pagination Meter)").first()).toBeVisible();
});
test("mobile inbox stays within the viewport", async ({ page }) => {
  await login(page);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/board");
    await page.getByRole("button", { name: /^Notifications/ }).click();
    const panel = page.getByRole("dialog", { name: "Notifications" });
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  }
});
test("equipment types have separate QR export alongside global export", async ({ page }) => {
  await login(page);
  const item = (id: string, name: string, code: string) => ({
    id,
    name,
    description: "",
    category: "Test",
    active: true,
    assets: [
      {
        id: `asset-${id}`,
        assetCode: code,
        qrUrl: `http://127.0.0.1:5188/scan/${id.repeat(64)}`,
        serialNumber: null,
        state: "AVAILABLE",
        active: true,
      },
    ],
  });
  await page.route("**/api/v1/board/inventory", (route) =>
    route.fulfill({ json: [item("a", "Meter A", "A-001"), item("b", "Meter B", "B-001")] })
  );
  await page.goto("/board/inventory");
  const [popup] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("button", { name: "Export Meter A QR codes" }).click(),
  ]);
  await expect(popup.getByRole("heading", { name: "Meter A — 1 QR labels" })).toBeVisible();
  await expect(popup.getByText("B-001")).toHaveCount(0);
  await popup.close();
  const [all] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("button", { name: "Export all QR codes" }).click(),
  ]);
  await expect(all.getByRole("heading", { name: "Equipment — 2 QR labels" })).toBeVisible();
  await expect(all.getByText("A-001")).toBeVisible();
  await expect(all.getByText("B-001")).toBeVisible();
});
test("camera uses the newly scanned reservation for the following material QR", async ({
  page,
}) => {
  await login(page);
  const selected = reservation(100);
  await page.route("**/api/v1/board/reservations/camera-reservation", (route) =>
    route.fulfill({ json: { ...selected, id: "camera-reservation" } })
  );
  const scans: Array<{ reservationId?: string }> = [];
  await page.route("**/api/v1/board/scan", (route) => {
    scans.push(route.request().postDataJSON());
    return route.fulfill({
      json: {
        operation: "CHECKED_OUT",
        assetName: "Camera Meter",
        assetCode: "CAM-1",
        borrowerName: "Camera Borrower",
      },
    });
  });
  const qr = (value: string) =>
    "data:image/svg+xml;base64," +
    Buffer.from(
      renderToStaticMarkup(
        createElement(QRCodeSVG, {
          value,
          xmlns: "http://www.w3.org/2000/svg",
          size: 360,
          level: "M",
          marginSize: 4,
        })
      )
    ).toString("base64");
  await page.addInitScript(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    let source = "";
    const image = new Image();
    Object.assign(window, {
      cameraQr: (value: string) => {
        source = value;
        image.src = value;
      },
    });
    const draw = () => {
      const context = canvas.getContext("2d")!;
      context.fillStyle = "white";
      context.fillRect(0, 0, 640, 480);
      if (source && image.complete && image.naturalWidth)
        context.drawImage(image, 140, 60, 360, 360);
      requestAnimationFrame(draw);
    };
    draw();
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => canvas.captureStream(15),
    });
  });
  await page.goto("/board/scan");
  await page.evaluate(
    (value) => (window as unknown as { cameraQr: (value: string) => void }).cameraQr(value),
    qr("http://127.0.0.1:5188/board/scan?res=camera-reservation")
  );
  await page.getByRole("button", { name: "Start Camera" }).click();
  await expect(page.getByText("Borrower 100 · Approved")).toBeVisible();
  await page.waitForTimeout(1700);
  await page.evaluate(
    (value) => (window as unknown as { cameraQr: (value: string) => void }).cameraQr(value),
    qr("a".repeat(64))
  );
  await expect(page.getByText("Camera Meter #CAM-1", { exact: true })).toBeVisible();
  expect(scans[0].reservationId).toBe("camera-reservation");
  await page.getByRole("button", { name: "Stop Camera" }).click();
});
