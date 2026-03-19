import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["docker.spec.js"],
  timeout: 120000,
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  }
});
