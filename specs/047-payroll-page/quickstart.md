# Quickstart: Payroll Page

How to build, run, and verify the Payroll feature. Read alongside `plan.md`, `data-model.md`, and `contracts/`.

## Prerequisites

- Local Supabase stack running (`supabase start`).
- Worktree set up per CLAUDE.md ("Worktree setup"): `.env.*` copied, `npm ci` run.
- Branch `047-payroll-page`.

## Build order

Follow the user-story priority — each story is an independently shippable slice.

1. **Foundation**
   - Vendor the prototype → `design-system/prototypes/payroll/` (FR-036, R12). Do this first: Constitution I requires UI to adapt a prototype that lives there.
   - Migration `supabase/migrations/0021_payroll.sql` — enums, `staff` columns, `pay_periods`, `payroll_payouts`, RLS, indexes, the three RPCs (`data-model.md`, `contracts/database-rpcs.md`).
   - Extend `supabase/seed.sql` — seeded rates + one open + one closed period.
   - `supabase db reset` to apply, then regenerate types: `npx supabase gen types typescript --local > lib/db/types.ts`.
   - Extend `lib/auth/audit.ts` — `payroll.*` actions + `payroll` entity-type mapping.

2. **US1 — Ledger** (P1)
   - `lib/payroll/window.ts`, `lib/payroll/aggregate.ts`, `lib/payroll/queries.ts`, `lib/payroll/csv.ts`.
   - **Write `tests/unit/payroll/aggregate.test.ts` and `window.test.ts` first** (Constitution IV — money math is test-first).
   - `app/(studio)/payroll/page.tsx` + `components/lacquer/payroll/` ledger components (header, KPIs, ledger table, filters, period switcher, export, empty state).
   - Add the **Payroll** nav item to `components/lacquer/sidebar/nav-items.ts` (Operations group, `roles: ["owner","manager"]`, a Lucide icon).

3. **US2 — Tech detail** (P2)
   - `app/(studio)/payroll/[staffId]/page.tsx` + detail components (header, daily chart, breakdown, back/prev-next nav).

4. **US3 — Record payouts** (P3)
   - `app/(studio)/payroll/actions.ts` → `recordPayout`, `undoPayout`. Pay-action component + receipt.

5. **US4 — Close period & history** (P4)
   - `closePeriod` action, close-confirmation dialog, history view.

6. **US5 — Rate config** (P5)
   - `staff` migration columns already exist from step 1; build `components/lacquer/staff/payroll-rates-section.client.tsx`, extend `updateStaff` + `_validation.ts` + `permissions.ts` (owner-only).

7. **Tests & wiring**
   - `tests/e2e/payroll.spec.ts` — `describe` blocks `US1:` … `US5:` (per-tech assertions on worker-fixture staff, R11).
   - Add `tests/e2e/_affected-map.mjs` entries: `app/(studio)/payroll/**`, `lib/payroll/**`, `components/lacquer/payroll/**` → `tests/e2e/payroll.spec.ts`.

## Manual verification

With the local stack seeded, sign in as the owner (`owner@tangnails.dev`):

| Check | Expected |
|-------|----------|
| Sidebar → **Payroll** (Operations group) | Opens `/payroll` on the open period (May 16 – 31, 2026). |
| Ledger | One row per active tech; income / after-split / tips / after-split / check / cash columns; footer totals reconcile to the row sums. |
| KPI cards | Gross service income, card tips, owed to techs (check + cash), progress. |
| Filters | All / To pay / Paid change the visible rows. |
| Export CSV | Downloads `Payroll-May 16 – 31, 2026.csv` with every row + totals. |
| Click a tech row | Routes to `/payroll/<staffId>` — daily chart, quick stats, breakdown; prev/next move between techs; back returns to the ledger. |
| Mark a tech paid (cash/Zelle/check) | State → Paid, receipt shown; reload → still Paid; undo → back to Pending. |
| Switch to the closed period (May 1 – 15) | Read-only; no pay/undo/close actions; figures stable. |
| Close the open period with unpaid techs | Warning naming the unpaid techs; closes only after confirmation. |
| Settings → Staff → a tech | Service commission %, tip split %, check portion are editable (owner). Change one → `/payroll` recomputes that tech. |
| Sign in as a non-owner/manager and open `/payroll` | Redirected to `/dashboard`. As a manager: rate fields and the close button are unavailable. |

## Final quality gate

Per CLAUDE.md, before claiming the feature done:

```bash
npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:e2e
```

Plus a side-by-side comparison of `/payroll` and `/payroll/[staffId]` against `design-system/prototypes/payroll/Payroll.html` (Variation 3 — Pulse), confirming every color, spacing, radius, and type value traces to `styles/tokens.css` (Constitution I; `speckit-design-auditor`).
