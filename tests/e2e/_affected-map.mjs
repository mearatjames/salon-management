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
    // Feature 052 — void/refund Server Actions live in the checkout +
    // transactions actions modules.
    "tests/e2e/void-sale.spec.ts",
    "tests/e2e/refund-ticket.spec.ts",
  ],
  "lib/pos/**": ["tests/e2e/checkout-*.spec.ts", "tests/e2e/split-tender-*.spec.ts"],

  // Feature 052 — pure ticket-status math used by the void/refund flows.
  "lib/payments/**": ["tests/e2e/void-sale.spec.ts", "tests/e2e/refund-ticket.spec.ts"],

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
    // Feature 052 — `lib/square/refunds.ts` is exercised by the
    // void/refund flows.
    "tests/e2e/void-sale.spec.ts",
    "tests/e2e/refund-ticket.spec.ts",
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
    "tests/e2e/mobile-shell.spec.ts",
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
  // The operator-menu actions module — `signOut` + `switchStaff`. No spec
  // imports it directly (e2e drives them via form submits), so map it
  // explicitly. The US6 sign-out cases and US3 switch-staff cases in
  // auth.spec.ts are the regression net for this file.
  "app/(studio)/actions.ts": ["tests/e2e/auth.spec.ts"],
  // The /set-pin route group + the reset-password redirect change
  // (048-invitee-self-set-pin) are exercised by the set-pin spec.
  "app/(auth)/set-pin/**": ["tests/e2e/set-pin.spec.ts"],
  // The reset-password form is the surface every recovery / invite flow ends
  // on, so a change there pulls all three round-trip specs.
  "app/(auth)/reset-password/**": [
    "tests/e2e/auth.spec.ts",
    "tests/e2e/set-pin.spec.ts",
    "tests/e2e/recovery-callback.spec.ts",
  ],
  // `/auth/recovery-callback` is the admin-password-reset landing page
  // (issue #126); `/auth/invite-callback` and `/auth/callback` also live
  // here. The recovery-callback spec guards the new route directly.
  "app/auth/**": ["tests/e2e/auth.spec.ts", "tests/e2e/recovery-callback.spec.ts"],
  "lib/auth/**": [
    "tests/e2e/auth.spec.ts",
    "tests/e2e/onboarding.spec.ts",
    "tests/e2e/staff*.spec.ts",
  ],

  // Sidebar chrome. The transactions + report nav items are role-gated via the
  // sidebar, so sidebar changes also exercise those specs' role gating. The
  // shared `studio-nav-list` also drives the mobile drawer (Issue #160).
  "components/lacquer/sidebar/**": [
    "tests/e2e/sidebar.spec.ts",
    "tests/e2e/transactions.spec.ts",
    "tests/e2e/report.spec.ts",
    "tests/e2e/mobile-shell.spec.ts",
  ],

  // Responsive studio shell (Issue #160) — topbar hamburger + off-canvas
  // drawer. The shell layout, the chrome CSS, and the topbar controls all feed
  // the mobile shell spec.
  "components/lacquer/mobile-nav.tsx": ["tests/e2e/mobile-shell.spec.ts"],
  "components/lacquer/operator-chip.tsx": [
    "tests/e2e/mobile-shell.spec.ts",
    "tests/e2e/auth.spec.ts",
  ],
  "app/(studio)/layout.tsx": ["tests/e2e/mobile-shell.spec.ts", "tests/e2e/sidebar.spec.ts"],
  "styles/studio.css": ["tests/e2e/mobile-shell.spec.ts", "tests/e2e/sidebar.spec.ts"],

  // Transactions page (feature 045). Feature 052 adds the void/refund
  // Server Actions here (the transactions surface is where past sales are
  // reversed), so a change pulls the reversal specs too.
  "app/(studio)/transactions/**": [
    "tests/e2e/transactions.spec.ts",
    "tests/e2e/void-sale.spec.ts",
    "tests/e2e/refund-ticket.spec.ts",
  ],
  "components/lacquer/transactions/**": ["tests/e2e/transactions.spec.ts"],
  "lib/transactions/**": ["tests/e2e/transactions.spec.ts"],

  // Report page (feature 046). Feature 053 (R1) decoupled revenue from
  // payroll by widening the shared `lib/report/queries.ts` fetch — payroll
  // earnings + the reversal specs now flow through the report lib, so a
  // change there must also exercise the payroll/refund/void specs.
  "app/(studio)/report/**": ["tests/e2e/report.spec.ts"],
  "components/lacquer/report/**": ["tests/e2e/report.spec.ts"],
  "lib/report/**": [
    "tests/e2e/report.spec.ts",
    "tests/e2e/payroll.spec.ts",
    "tests/e2e/refund-ticket.spec.ts",
    "tests/e2e/void-sale.spec.ts",
  ],

  // Payroll page (feature 047).
  "app/(studio)/payroll/**": ["tests/e2e/payroll.spec.ts"],
  "lib/payroll/**": ["tests/e2e/payroll.spec.ts"],
  "components/lacquer/payroll/**": ["tests/e2e/payroll.spec.ts"],

  // Feature 053 — the payout-adjustments table + SECURITY DEFINER RPCs
  // (migration 0028) are driven only over Supabase from the adjustment
  // Server Actions; no spec imports the SQL, so map it explicitly.
  "supabase/migrations/0029_payout_adjustments.sql": ["tests/e2e/payroll.spec.ts"],

  // Dashboard.
  "app/(studio)/dashboard/**": [
    "tests/e2e/dashboard.spec.ts",
    "tests/e2e/dashboard-mobile.spec.ts",
  ],
  // Phone-layout chrome (issue #161) — restacks the feed, stat grid, and CTA
  // at the 640px breakpoint; the mobile spec asserts that layout.
  "styles/dashboard.css": ["tests/e2e/dashboard.spec.ts", "tests/e2e/dashboard-mobile.spec.ts"],
  "components/lacquer/period-summary.client.tsx": ["tests/e2e/dashboard.spec.ts"],
  "components/lacquer/period-toggle.tsx": ["tests/e2e/dashboard.spec.ts"],
  "components/lacquer/payment-mix-card.tsx": ["tests/e2e/dashboard.spec.ts"],
  // The dashboard feed's "View all" links to /transactions, so changes here
  // affect both the dashboard spec and the transactions spec; the phone card
  // layout adds the mobile spec.
  "components/lacquer/recent-transactions-feed.tsx": [
    "tests/e2e/dashboard.spec.ts",
    "tests/e2e/dashboard-mobile.spec.ts",
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
