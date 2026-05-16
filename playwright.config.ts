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
  // Parallel-safe: audit_log assertions use per-test cursors (see _db.ts +
  // spec headers) and the destructive password-reset describe in
  // auth.spec.ts uses a dedicated seeded user so it can't kick concurrent
  // sign-ins. CI runs 2 workers (matches the 2 vCPUs on ubuntu-latest);
  // local defaults to half CPU count.
  workers: process.env.CI ? 2 : undefined,
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
