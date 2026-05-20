// Maps touched-path globs → e2e spec globs that should run when files
// under those paths change.
//
// Why this exists: Playwright's `--only-changed` walks the spec import
// graph. Tang Nails specs mostly exercise UI and APIs over HTTP and
// Supabase (no direct imports), so a change to
// `components/lacquer/checkout/*` or `app/api/square/**` produces no
// `--only-changed` match. This map closes that gap with explicit,
// hand-maintained entries.
//
// Keep it small. If a path doesn't appear here, the wrapper still runs
// any specs Playwright considers changed via `--only-changed`; the only
// cost of an omitted mapping is "the per-phase gate missed a spec the
// final full-suite gate caught." That trade-off is fine — the final
// gate (`npm run test:e2e`) remains the safety net.
//
// Conventions:
//   - Path globs are matched against `git diff --name-only` output (POSIX
//     paths, repo-root relative). `**` matches any depth, `*` matches
//     within a path segment.
//   - Spec globs are resolved with `globSync` against the repo root.
//   - Changes to anything under `tests/e2e/_*` or `playwright.config.ts`
//     fall through to a full-suite run inside the wrapper — don't list
//     them here.
//
// @typedef {Record<string, readonly string[]>} AffectedMap
// @type {AffectedMap}
export const AFFECTED_MAP = {
  // Checkout flow + payment specs (Square interactions are exercised
  // primarily from checkout, so checkout-only changes still need card +
  // gift-card coverage).
  "components/lacquer/checkout/**": [
    "tests/e2e/checkout-*.spec.ts",
    "tests/e2e/split-tender-*.spec.ts",
    "tests/e2e/card-payment-*.spec.ts",
    "tests/e2e/gift-card-*.spec.ts",
    "tests/e2e/concurrent-charge-blocked.spec.ts",
  ],
  "app/(studio)/checkout/**": [
    "tests/e2e/checkout-*.spec.ts",
    "tests/e2e/split-tender-*.spec.ts",
    "tests/e2e/card-payment-*.spec.ts",
    "tests/e2e/gift-card-*.spec.ts",
    "tests/e2e/concurrent-charge-blocked.spec.ts",
  ],
  "lib/pos/**": ["tests/e2e/checkout-*.spec.ts", "tests/e2e/split-tender-*.spec.ts"],

  // Ephemeral-draft persistence RPC (migration 0020). Every draft-path
  // payment runs `pos_create_ticket_from_draft`, so a change to the
  // migration needs the full checkout payment set. (The draft module
  // `app/(studio)/checkout/_cart-draft.ts` and the checkout routes are
  // already covered by the `app/(studio)/checkout/**` entry above.)
  "supabase/migrations/0020_checkout_ephemeral_draft.sql": [
    "tests/e2e/checkout-*.spec.ts",
    "tests/e2e/split-tender-*.spec.ts",
    "tests/e2e/card-payment-*.spec.ts",
    "tests/e2e/gift-card-*.spec.ts",
    "tests/e2e/concurrent-charge-blocked.spec.ts",
  ],

  // Square server-side + settings.
  "app/api/square/**": [
    "tests/e2e/card-payment-*.spec.ts",
    "tests/e2e/gift-card-*.spec.ts",
    "tests/e2e/split-tender-*.spec.ts",
    "tests/e2e/concurrent-charge-blocked.spec.ts",
    "tests/e2e/checkout-discard-with-inflight-payment.spec.ts",
    "tests/e2e/checkout-discard-during-waiting.spec.ts",
  ],
  "lib/square/**": [
    "tests/e2e/card-payment-*.spec.ts",
    "tests/e2e/gift-card-*.spec.ts",
    "tests/e2e/split-tender-*.spec.ts",
    "tests/e2e/concurrent-charge-blocked.spec.ts",
    "tests/e2e/square-oauth.spec.ts",
  ],
  "app/(studio)/settings/square/**": ["tests/e2e/square-oauth.spec.ts"],
  "components/lacquer/settings/square/**": ["tests/e2e/square-oauth.spec.ts"],

  // End-of-day cash.
  "components/lacquer/eod/**": [
    "tests/e2e/end-of-day-cash.spec.ts",
    "tests/e2e/past-cash-counts.spec.ts",
  ],
  "app/(studio)/end-of-day/**": [
    "tests/e2e/end-of-day-cash.spec.ts",
    "tests/e2e/past-cash-counts.spec.ts",
  ],
  "lib/end-of-day/**": ["tests/e2e/end-of-day-cash.spec.ts", "tests/e2e/past-cash-counts.spec.ts"],

  // Services catalog + supply types.
  "components/lacquer/services/**": [
    "tests/e2e/services.spec.ts",
    "tests/e2e/services-deductions.spec.ts",
    "tests/e2e/supply-types-catalog.spec.ts",
  ],
  "app/(studio)/services/**": [
    "tests/e2e/services.spec.ts",
    "tests/e2e/services-deductions.spec.ts",
    "tests/e2e/supply-types-catalog.spec.ts",
  ],
  "lib/services/**": ["tests/e2e/services.spec.ts", "tests/e2e/services-deductions.spec.ts"],

  // Staff management. Top-level lacquer/staff-*.tsx files are
  // matched per-file so we don't accidentally pull in unrelated chrome.
  "components/lacquer/staff/**": ["tests/e2e/staff*.spec.ts"],
  "components/lacquer/staff-roster.tsx": ["tests/e2e/staff*.spec.ts"],
  "components/lacquer/staff-tile.tsx": ["tests/e2e/staff*.spec.ts"],
  "components/lacquer/tech-avatar.tsx": ["tests/e2e/staff*.spec.ts"],
  "components/lacquer/tech-stack.tsx": ["tests/e2e/staff*.spec.ts"],
  "components/lacquer/switch-staff-button.tsx": [
    "tests/e2e/staff*.spec.ts",
    "tests/e2e/auth.spec.ts",
  ],
  "app/(studio)/settings/staff/**": ["tests/e2e/staff*.spec.ts"],

  // Onboarding (staff invite/onboard flows + kiosk).
  "components/lacquer/onboarding/**": [
    "tests/e2e/onboarding.spec.ts",
    "tests/e2e/staff-add-wizard.spec.ts",
  ],
  "app/(studio)/settings/onboarding/**": [
    "tests/e2e/onboarding.spec.ts",
    "tests/e2e/staff-add-wizard.spec.ts",
  ],
  "lib/onboarding/**": ["tests/e2e/onboarding.spec.ts", "tests/e2e/staff-add-wizard.spec.ts"],
  "app/kiosk/**": ["tests/e2e/onboarding.spec.ts"],

  // Auth / sign-in.
  "app/(auth)/**": ["tests/e2e/auth.spec.ts"],
  "app/auth/**": ["tests/e2e/auth.spec.ts"],
  "lib/auth/**": [
    "tests/e2e/auth.spec.ts",
    "tests/e2e/onboarding.spec.ts",
    "tests/e2e/staff*.spec.ts",
  ],

  // Sidebar chrome. The transactions nav item is role-gated via the sidebar,
  // so sidebar changes also exercise the transactions spec's role gating.
  "components/lacquer/sidebar/**": ["tests/e2e/sidebar.spec.ts", "tests/e2e/transactions.spec.ts"],

  // Transactions page (feature 045).
  "app/(studio)/transactions/**": ["tests/e2e/transactions.spec.ts"],
  "components/lacquer/transactions/**": ["tests/e2e/transactions.spec.ts"],
  "lib/transactions/**": ["tests/e2e/transactions.spec.ts"],

  // Dashboard.
  "app/(studio)/dashboard/**": ["tests/e2e/dashboard.spec.ts"],
  "components/lacquer/period-summary.client.tsx": ["tests/e2e/dashboard.spec.ts"],
  "components/lacquer/period-toggle.tsx": ["tests/e2e/dashboard.spec.ts"],
  "components/lacquer/payment-mix-card.tsx": ["tests/e2e/dashboard.spec.ts"],
  // The dashboard feed's "View all" links to /transactions, so changes here
  // affect both the dashboard spec and the transactions spec.
  "components/lacquer/recent-transactions-feed.tsx": [
    "tests/e2e/dashboard.spec.ts",
    "tests/e2e/transactions.spec.ts",
  ],
  "components/lacquer/stat-card.tsx": ["tests/e2e/dashboard.spec.ts"],

  // Shared utilities used across specs.
  "lib/time/**": [
    "tests/e2e/dashboard.spec.ts",
    "tests/e2e/end-of-day-cash.spec.ts",
    "tests/e2e/past-cash-counts.spec.ts",
    "tests/e2e/supply-types-catalog.spec.ts",
  ],
  "lib/policy/**": [
    "tests/e2e/dashboard.spec.ts",
    "tests/e2e/supply-types-catalog.spec.ts",
    "tests/e2e/services*.spec.ts",
  ],
  "lib/settings/**": ["tests/e2e/services*.spec.ts", "tests/e2e/end-of-day-cash.spec.ts"],
};
