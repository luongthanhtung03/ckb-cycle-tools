import { defineConfig, devices } from "@playwright/test";

/**
 * Browser smoke checks of the demo: the inspector loads, replays a testnet
 * transaction in ckb-debugger (WASM), draws a flamegraph, and logs no errors.
 * Read-only: nothing here signs or sends anything.
 *
 *   npm run e2e                                   # the live demo on Vercel
 *   BASE_URL=http://localhost:3000 npm run e2e    # `npm run demo` running locally
 *
 * Test files are *.e2e.ts, so vitest (its default *.test.ts / *.spec.ts) never
 * picks them up, and e2e/ is outside the package's "files", so npm never packs it.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "*.e2e.ts",
  outputDir: "test-results",
  // The page reads testnet over public RPC: give it time, and one retry in CI so a
  // single slow block does not page anyone. A demo that is really down fails twice.
  timeout: 180_000,
  expect: { timeout: 30_000 },
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]]
    : [["list"]],
  use: {
    baseURL: process.env.BASE_URL ?? "https://ckb-cycle-tools.vercel.app",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
