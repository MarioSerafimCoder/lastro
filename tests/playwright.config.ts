import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "ui.spec.ts",
  workers: 1,
  outputDir: "../.wrangler/ui-results",
  use: {
    channel: "chrome",
    baseURL: "http://127.0.0.1:5175",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run web:dev -- --port 5175",
    url: "http://127.0.0.1:5175",
    reuseExistingServer: false,
  },
});
