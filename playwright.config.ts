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

// Local e2e can opt into the same prebuilt server CI uses (`npm run start`).
// Saves the ~30–90s of Next.js dev-mode JIT compile latency on the first run
// after edits. Default stays `npm run dev` so iterative editing still works.
const localServerCommand =
  process.env.PLAYWRIGHT_PROD === "1" ? "npm run build && npm run start" : "npm run dev";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Single-worker mode (still). The Category A staff-mutation race that
  // forced workers=1 was the original blocker; issue #39 ships the
  // worker-scoped staff fixture (`tests/e2e/_fixtures.ts`) that resolves
  // it, so flipping the workers cap is now safe for Category A specs.
  //
  // Two Category B subsystems still rely on shared resources that
  // collide under `workers > 1`, so the flip is deferred until they get
  // fixture-equivalent isolation:
  //
  //  - **Square stub server** (`tests/e2e/_square-server-stub.ts`) listens
  //    on a fixed `127.0.0.1:4567` matching the Next.js
  //    `SQUARE_API_BASE_URL` env. Two workers running Square-stub specs
  //    in parallel hit `EADDRINUSE`. Needs a per-shard singleton stub
  //    (globalSetup) plus cross-worker state coordination.
  //  - Other pre-existing Category B races (gift-card sandbox state,
  //    Square OAuth state) need parallel-safe seeding before workers>1
  //    is reliable.
  //
  // Follow-up issue: #41 (do not unpin without resolving the stubs first).
  workers: 1,
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
    // The CI workflow runs `npm run build` before this. Locally, set
    // PLAYWRIGHT_PROD=1 to opt into the same prebuilt server.
    command: process.env.CI ? "npm run start" : localServerCommand,
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
