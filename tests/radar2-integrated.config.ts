import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "radar2-integrated.spec.ts",
  workers: 1,
  timeout: 45000,
  outputDir: "../.wrangler/radar2-integrated-results",
  use: {
    channel: "chrome",
    baseURL: "http://localhost:5196",
    trace: "retain-on-failure",
  },
});
