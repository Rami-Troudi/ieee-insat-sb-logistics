import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

const e2eSecret = "e2e-reservations-secret-at-least-thirty-two-characters";
const e2eDatabase = "file:" + resolve(process.cwd(), ".local/e2e.db");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5188",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "node scripts/e2e-setup.mjs && npm run dev:api",
      url: "http://127.0.0.1:8789/api/health",
      reuseExistingServer: false,
      timeout: 120 * 1000,
      env: {
        API_PORT: "8789",
        TURSO_DATABASE_URL: e2eDatabase,
        BETTER_AUTH_SECRET: e2eSecret,
        APP_ORIGIN: "http://127.0.0.1:5188",
        NODE_ENV: "test",
      },
    },
    {
      command: "npm run dev -- --host 127.0.0.1 --port 5188",
      url: "http://127.0.0.1:5188",
      reuseExistingServer: false,
      timeout: 120 * 1000,
      env: { API_PORT: "8789" },
    },
  ],
});
