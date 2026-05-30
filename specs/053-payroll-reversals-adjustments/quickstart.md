# Quickstart: Payroll — Reversals & Adjustments

## What this feature does

1. **Reversal-aware pay** — a refunded sale keeps the technician's commission on
   the *original* amount; a voided sale pays $0; the Report shows revenue *net*
   of refunds. Revenue and payroll are decoupled.
2. **Manual adjustments** — owners/managers add signed (+/−) adjustment lines to
   a tech's payout for an open period via a centered **Dialog**; they fold into
   net payout and lock once the period closes or the tech is paid.

## Key files

- DB: `supabase/migrations/0029_payout_adjustments.sql` (table + RLS + 3 RPCs +
  `payroll_assert_adjustable`).
- Math (pure, test-first): `lib/report/aggregate.ts` (refund allocation + net),
  `lib/payroll/aggregate.ts` (adjustments fold-in, net payout).
- Queries: `lib/report/queries.ts` (widen ticket filter, fetch refunds),
  `lib/payroll/queries.ts` (load + group adjustments; history total).
- Actions: `app/(studio)/payroll/actions.ts` (`addAdjustment` /
  `editAdjustment` / `deleteAdjustment`).
- Audit: `lib/auth/audit.ts` (+3 `payroll.adjustment_*` verbs).
- UI: `components/lacquer/payroll/adjustments-card.client.tsx` (new) + ledger /
  kpis / breakdown / header / pay-action edits; `styles/payroll.css`.
- Report net-revenue display: `lib/report/csv.ts`, `app/(studio)/report/*`,
  `components/lacquer/report/*`.

## Manual verification (against local Supabase seed)

1. Seed (or create) in the current open period: a $60 single-tech sale (50%
   commission), then refund $20 of it; a second $60 sale then **voided**.
2. `/payroll` → the refunded tech's **Income** still reflects the original $60
   (commission $30); the voided sale contributes $0.
3. `/report` for the same window → the refunded sale reads **$40 net**; the
   payroll figure for it is the original — they differ by exactly $20 (SC-003).
4. Open the tech's `/payroll/{id}` → **Add** (Dialog): pick Deduct, $15, reason
   "Redo on the house" → preview shows net before/after → confirm. Net payout
   drops by $15; the ledger Adj. / Net payout columns + KPIs update.
5. Edit then delete the line — net follows; the line vanishes (hard delete).
6. Record the tech's payout (or close the period) → the adjustments card shows
   **Period closed** / no add-edit-delete; a stale add/edit/delete is refused.

## Gates before "done"

`npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:e2e`
(intermediate phases use the scoped variants per CLAUDE.md). Money math
(`report`/`payroll` aggregate) is **test-first** — write the failing Vitest
cases before the implementation (Constitution IV).
