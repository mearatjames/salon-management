import { readFileSync } from "node:fs";
import { join } from "node:path";

import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for Tang Nails end-to-end tests.
 * See https://playwright.dev/docs/test-configuration.
 */

// Load .env.local for local runs so the test process (which talks to
// Supabase via the service-role client) sees the same env that Next.js
// loads for the dev server. CI sets env via the workflow, so we only
// fall back when CI is unset and the file is present. Mirrors what
// `tests/setup.ts` does for Vitest.
if (!process.env.CI) {
  try {
    const raw = readFileSync(join(process.cwd(), ".env.local"), "utf-8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const k = trimmed.slice(0, eq).trim();
      let v = trimmed.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!(k in process.env)) {
        process.env[k] = v;
      }
    }
  } catch {
    // .env.local missing — fine when running against a deployed target.
  }
}

// Local e2e uses the same prebuilt server CI uses (`npm run start`) by
// default — `npm run test:e2e` sets `PLAYWRIGHT_PROD=1`. That avoids the
// ~30–90s of Next.js dev-mode JIT compile latency that flakes cold paths
// under the full suite. For iteration on a single failing spec, use
// `npm run test:e2e:dev`, which leaves `PLAYWRIGHT_PROD` unset and runs
// `npm run dev` so edits hot-reload.
const localServerCommand =
  process.env.PLAYWRIGHT_PROD === "1" ? "npm run build && npm run start" : "npm run dev";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // CI uses 2 workers; local stays unconstrained (CPU-count default).
  //
  // The Category A staff-mutation race that originally forced workers=1
  // is resolved by the worker-scoped staff fixture in `_fixtures.ts`
  // (#38, #39). The Category B races — Square stub server listening on a
  // fixed port + shared response state — are resolved by the singleton
  // stub model wired in `_global-setup.ts` / `_global-teardown.ts`
  // (#41): the server binds 127.0.0.1:4567 once for the whole run, and
  // Square-using specs acquire `acquireStubLock()` in `beforeAll` so
  // only one of them mutates the shared stub state at a time.
  workers: process.env.CI ? 2 : undefined,
  globalSetup: require.resolve("./tests/e2e/_global-setup"),
  globalTeardown: require.resolve("./tests/e2e/_global-teardown"),
  reporter: "html",
  // Per-test budget. Local timeout is generous (60s) because parallel
  // workers contending on the Next.js prod server can stretch a single
  // form-submit + navigation past 30s in the slowest US5 services test.
  // CI uses 120s for the same reason plus prod-build cold paths.
  timeout: process.env.CI ? 120_000 : 60_000,
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // Production build in CI avoids next-dev's compile-on-first-request
    // latency, which can push individual page loads past the test timeout.
    // The CI workflow runs `npm run build` before this. Locally,
    // `npm run test:e2e` defaults to the same prebuilt server via
    // PLAYWRIGHT_PROD=1; `npm run test:e2e:dev` falls back to `npm run dev`.
    command: process.env.CI ? "npm run start" : localServerCommand,
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
