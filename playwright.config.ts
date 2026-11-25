import { defineConfig, devices } from "playwright/test";

/**
 * Fas 5 smoke + quality suite.
 *
 * Runs against its own server and its own database (`data/e2e`), on a port that
 * is not the dev server, so a run never touches the developer's data. The
 * database is deleted before the server starts, which makes the imported
 * fixture deterministic.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "reports/e2e/results.json" }]],
  use: {
    baseURL: "http://127.0.0.1:3199",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "reports/e2e/state.json",
        launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] },
      },
      dependencies: ["setup"],
    },
    // Opt-in cross-browser gate; the default suite stays Chromium-only so the
    // normal release run does not triple in time. CI can set CROSS_BROWSER=1.
    ...(process.env.CROSS_BROWSER === "1"
      ? [
          {
            name: "firefox",
            use: { ...devices["Desktop Firefox"], storageState: "reports/e2e/state.json" },
            dependencies: ["setup"],
          },
          {
            name: "webkit",
            use: { ...devices["Desktop Safari"], storageState: "reports/e2e/state.json" },
            dependencies: ["setup"],
          },
        ]
      : []),
  ],
  webServer: {
    command:
      "rm -rf data/e2e && mkdir -p data/e2e reports/e2e && DB_PATH=data/e2e/lagerradar.db PORT=3199 APP_ORIGIN=http://127.0.0.1:3199 /Applications/Freebuff.app/Contents/Resources/bun/bun src/server.ts",
    url: "http://127.0.0.1:3199/halsa",
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
