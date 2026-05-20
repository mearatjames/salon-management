#!/usr/bin/env node
// Wrapper for `npm run test:e2e` — resets the local Supabase database
// (migrate + reseed) before the full Playwright suite runs, then runs
// Playwright with any forwarded CLI args.
//
// Why: the e2e suite mutates shared Supabase tables (services, tickets,
// payments, audit_log, staff, …) and never cleans up. Without a reset,
// successive local runs accumulate rows and specs that assert against
// the seed baseline start failing (issue #92). CI is unaffected — it
// resets in its own job step and calls `playwright test` directly.
//
// Invoked inside the existing `flock /tmp/tang-nails-e2e.lock` critical
// section (see package.json `test:e2e`), so the reset and the Playwright
// run share ONE lock: parallel Claude Code sessions stay serialized and
// the reset fully completes before Playwright's `webServer` boots.
//
// Guard: when the local Supabase stack is unreachable the reset is
// skipped and Playwright still runs — database-dependent specs self-skip
// (mirrors `supabaseIsReachable()` in tests/e2e/*.spec.ts).
//
// `npm run test:e2e:dev` (single-spec iteration) intentionally does NOT
// use this wrapper — a reset would wipe the state you're iterating on.

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SUPABASE_HEALTH_URL = "http://127.0.0.1:54321/auth/v1/health";

async function supabaseIsReachable() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(SUPABASE_HEALTH_URL, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

if (await supabaseIsReachable()) {
  console.log("Resetting local Supabase database (migrate + reseed) before e2e run…");
  const reset = spawnSync("supabase", ["db", "reset"], { stdio: "inherit", cwd: ROOT });
  if (reset.error) {
    console.error(`Failed to run \`supabase db reset\`: ${reset.error.message}`);
    process.exit(1);
  }
  if (reset.status !== 0) {
    console.error(`\`supabase db reset\` exited ${reset.status} — aborting e2e run.`);
    process.exit(reset.status ?? 1);
  }
} else {
  console.log(
    "Supabase not reachable at 127.0.0.1:54321 — skipping db reset. " +
      "Database-dependent specs will self-skip."
  );
}

const playwrightArgs = process.argv.slice(2);
const result = spawnSync("npx", ["playwright", "test", ...playwrightArgs], {
  stdio: "inherit",
  cwd: ROOT,
});
process.exit(result.status ?? 1);
