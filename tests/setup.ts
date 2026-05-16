import "@testing-library/jest-dom";

// Load .env.local so DB-talking unit tests (e.g. staff/last_owner_trigger)
// see NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY without requiring
// the test runner to be invoked with a flag. Next.js loads it for runtime;
// Vitest does not — this bridges that gap. We do NOT override values that
// are already in process.env (CI sets them via env: in the workflow).
import { readFileSync } from "node:fs";
import { join } from "node:path";

try {
  const raw = readFileSync(join(process.cwd(), ".env.local"), "utf-8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) {
      process.env[k] = v;
    }
  }
} catch {
  // .env.local missing — fine in CI when env is passed via workflow.
}
