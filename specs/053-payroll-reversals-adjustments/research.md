# Phase 0 Research: Payroll — Reversals & Adjustments

Feature: `053-payroll-reversals-adjustments` · Spec: [spec.md](./spec.md)

All "NEEDS CLARIFICATION" from the spec were resolved in the `/speckit-clarify`
session (permission gate = owner+manager, no PIN; adjustments only on techs with
work; hard delete + audit). The decisions below resolve the **technical**
unknowns the plan depends on, grounded in the existing code.

---

## R1 — Decoupling revenue (net of refunds) from payroll (original amounts)

**Context.** Today both surfaces share `lib/report/queries.ts::loadReportPage`,
whose ticket query is `.eq("status", "paid")` (`lib/report/queries.ts:73`). A
`refunded` / `partially_refunded` ticket has a status other than `paid`, so it
is **excluded entirely** from both Report and payroll:

- Full refund today → ticket excluded → contributes $0. (Coincidentally the
  correct net.)
- **Partial** refund today → ticket excluded → contributes $0, but the correct
  net is original − refunded (e.g. $60 sale, $20 back → $40). **Bug.**
- Payroll today → the refunded sale vanishes, so the tech loses the commission
  they earned. **Bug (the issue's core).**

Refund representation (from migrations 0026/0027, confirmed):
- A refund is a **new `payments` row** with `kind='refund'`, **positive**
  `amount_cents` (the refunded portion), `tip_cents=0` (tips are never
  refunded), `method` copied from the original, `refunds_payment_id` → original
  payment, status `pending → succeeded` (cash is immediately `succeeded`).
- The original `ticket_items` are **left untouched** — original service amounts
  remain readable.
- Ticket status: `refunded` iff Σ succeeded refunds ≥ Σ succeeded original
  payments, else `partially_refunded`.

**Decision.** Make the **shared fetch + `projectReport` refund-aware**, and let
each consumer read the field it needs — payroll the *original* figure, the
Report the *net* figure. One ticket/payment fetch, two explicit outputs.

1. **Widen the ticket fetch** in `loadReportPage`:
   `status IN ('paid','refunded','partially_refunded')` (still
   `closed_at ∈ [start,end)`). `void` and `discarded` stay excluded → a voided
   sale pays $0 and never appears (FR-002), unchanged.
2. **Fetch refund rows.** Extend the payments select to include `kind` and
   `amount_cents`; stop filtering them out (`projectReport` splits by kind).
3. **`projectReport` emits original + refund per tech and per transaction:**
   - `grossCents` / `commissionableCents` / `cardTipsCents` keep their current
     meaning = **original** (pre-refund) amounts, computed from `ticket_items`
     and `kind='payment'` succeeded payments exactly as today.
   - NEW `refundedCents` per `TechnicianReport` and per `ReportTransaction` =
     the succeeded refund total **allocated to that tech**. On a single-tech
     ticket all of it; on a multi-tech ticket, split across the ticket's techs
     **proportionally by service subtotal** using the existing
     `splitCardTip` largest-remainder helper (Σ allocations = ticket refund,
     exact — Money Integrity). Refund rows reference a *payment*, not a service
     line, so proportional allocation is the only attribution available; this
     is the **revenue-only** split and is explicitly **not** per-tech refund
     attribution for *pay* (out of scope — payroll never reads `refundedCents`).
4. **Payroll** keeps consuming `commissionableCents` (original) and
   `cardTipsCents` (unaffected) — `projectPayrollLedger` needs **no math
   change**. Widening the fetch alone makes refunded sales count at original
   amounts; `void` is already excluded. This is the cleanest possible payroll
   fix.
5. **Report** subtracts `refundedCents` at its consumption points to show **net**
   revenue (per-transaction net = `netCents − refundedCents`; per-tech and
   totals net likewise). This is the Report behavior change US1.4 / SC-003
   require (partial refunds now read net instead of vanishing).

**Why this is "decoupled."** Payroll reads `commissionableCents` (original); the
Report reads `commissionableCents − refundedCents` (net). They are different
fields with different values — the two figures can no longer be accidentally
forced equal by a single shared filter. SC-003 ("differ by exactly the refunded
amount") holds by construction.

**Alternatives considered.**
- *Separate payroll earnings query* (new `lib/payroll/earnings.ts` hitting
  tickets a second time). Rejected: double the ticket reads, duplicates the
  deduction/tip math, and the Report **still** has to change to net partial
  refunds (US1.4) — so it doesn't avoid the Report edit, it just adds a query.
- *Make `commissionableCents` net and add `originalCommissionableCents` for
  payroll.* Rejected: silently flips the meaning of a widely-consumed field;
  higher blast radius and easy to misread. Keeping `commissionableCents` =
  original and adding `refundedCents` is the smaller, more legible change.

**Test-first (Constitution IV).** `projectReport`'s refund allocation + net
figures get Vitest cases written-to-fail first (single-tech full/partial,
multi-tech proportional split, void excluded, over-refund clamp). The unchanged
`projectPayrollLedger` gets a fixture proving a refunded-ticket tech keeps full
commission.

---

## R2 — `payout_adjustments` table + write RPCs (Part 2)

**Decision.** A new append-but-mutable-while-open table, written only through
SECURITY DEFINER RPCs, mirroring the `payroll_payouts` access model
(select-only RLS for `authenticated`; all writes via service-role RPC). Migration
**`0028_payout_adjustments.sql`** (next free number after `0027`).

Table `public.payout_adjustments`:

| column | type | notes |
|--------|------|-------|
| `id` | uuid PK default `gen_random_uuid()` | |
| `pay_period_id` | uuid NOT NULL → `pay_periods(id)` | |
| `staff_id` | uuid NOT NULL → `staff(id)` | the target technician |
| `amount_cents` | int NOT NULL, `CHECK (amount_cents <> 0)` | signed: + addition, − deduction |
| `reason` | text NOT NULL, `CHECK (char_length(btrim(reason)) BETWEEN 1 AND 80)` | |
| `created_by_staff_id` | uuid NOT NULL → `staff(id)` | operator |
| `created_by_user_id` | uuid | device auth user (nullable, like audit) |
| `created_at` | timestamptz NOT NULL default `now()` | |
| `updated_at` | timestamptz | set on edit; null = never edited |

Index: `(pay_period_id, staff_id)`. **Hard delete** — no `deleted_at` (clarified);
the audit log is the historical record.

RPCs (all `security definer`, `set search_path = public, pg_temp`, audit via the
in-RPC `insert into public.audit_log (...)` pattern from `payroll_record_payout`):

- `payroll_add_adjustment(p_pay_period_id, p_staff_id, p_amount_cents, p_reason, p_operator, p_device_user_id) returns uuid`
- `payroll_edit_adjustment(p_adjustment_id, p_amount_cents, p_reason, p_operator, p_device_user_id) returns void`
- `payroll_delete_adjustment(p_adjustment_id, p_operator, p_device_user_id) returns void`

**Lock guard (FR-012).** Each RPC asserts the (period, staff) scope is **open**
before mutating, via a shared helper `payroll_assert_adjustable(p_pay_period_id,
p_staff_id)` that raises `payroll_period_not_open` when the `pay_periods` row is
not `status='open'`, and `payroll_payout_exists` when a `payroll_payouts` row
exists for that (period, staff) — i.e. that tech is already paid out. `for
update` locks the `pay_periods` row, matching `payroll_record_payout`. This is
the DB-level backstop; the action re-checks first (defense in depth).

Audit verbs: `payroll.adjustment_added` / `payroll.adjustment_edited` /
`payroll.adjustment_removed` (delete audits **before** the row is gone, payload
carrying the full line — same shape as `payroll_undo_payout`). `entity_type`
derives to `"payroll"` from the `payroll.` prefix — **no `deriveEntityType`
edit** needed; only the `AuditAction` union in `lib/auth/audit.ts` gains three
members.

**Alternatives considered.**
- *Store the adjustment total on `payroll_payouts`.* Rejected: `payroll_payouts`
  is an immutable snapshot; adjustments are independent, multi-row, and editable
  while open. A separate table is the correct shape and keeps the snapshot pure.
- *Soft delete.* Rejected by clarification — hard delete; audit retains history.

---

## R3 — Net payout: fold adjustments into the read model (no payout-schema change)

**Decision.** Net payout = `cashPaymentCents + Σ adjustments(period, staff)`,
computed in the **pure projection**, not stored. `payroll_payouts` is unchanged.

Rationale: once a tech is paid OR the period is closed, the RPC lock (R2) makes
their adjustments immutable, so the **live sum equals the sum at payout/close
time** — there is nothing to "freeze" and no drift risk (Money Integrity holds
without a schema change to the snapshot). The query layer reads
`payout_adjustments` for the period (one query, grouped by staff) and hands the
per-staff lines to `projectPayrollLedger`, which adds `adjustments` and
`netPayoutCents` to each `PayrollLedgerRow` and `adjustmentsCents` /
`netPayoutCents` to totals. Negative net payout is permitted (a deduction may
exceed earnings — spec Edge Cases).

**`recordPayout` pays the net.** The pay-action CTA reads "Mark {net} paid"
(design `TechPayAction`); recording still snapshots the computed
`cash_payment_cents` and the adjustments stay as their own rows (now locked).
`loadPayrollHistory`'s period total gains the period's `Σ adjustments` so the
History "paid" figure stays truthful.

---

## R4 — Adjustment entry chrome = centered Dialog (reuse the existing pattern)

**Decision.** Build the add/edit experience as a centered modal using the **same
primitive the payroll page already uses** —
`components/lacquer/payroll/close-period-dialog.client.tsx` (shadcn `Dialog` in
`components/ui/*`). The design ships three entry variants
(inline/sheet/dialog); per the user we build **only Dialog** (FR-013). New
client component `adjustments-card.client.tsx` owns the list + the
add/edit/delete controls and the dialog; a small `AdjustmentForm` holds the
direction toggle, amount, reason chips + free-text, the live before/after
preview, and Cancel / confirm.

**Design-system fidelity (Constitution I).** The prototype's adjustment styles
in `design-system` (`payroll/extra.css`: `.adj-form`, `.adj-dir`,
`.adj-amount`, `.adj-chip`, `.adj-reason-input`, `.adj-preview`, `.pp-adj-*`,
`.pl-adj`, `.pl-bd-row.adj`, the modal `.adj-modal-*`) already resolve to the
repo's tokens (`var(--space-*)`, `var(--primary)`, `var(--destructive)`,
`var(--radius-*)`). Port them into `styles/payroll.css` verbatim-by-token. **Omit**
`.pl-refund-flag`, `.pr-reversal-note`, and `.pl-bd-note` — the refund-preserved
note/banner/flag is dropped (FR-006). Icons: Lucide `Plus`, `Minus`, `Check`,
`Pencil`, `Trash2`, `Sliders`, `Lock`, `X` at 1.5px stroke.

---

## R5 — Server-action surface mirrors the existing payroll actions

**Decision.** Add `addAdjustment` / `editAdjustment` / `deleteAdjustment` to
`app/(studio)/payroll/actions.ts`, each following the established 8-step
prelude (viewer → role gate → validate → recompute fresh → service-role RPC →
map error → `revalidatePath` → discriminated `ActionResult`). Role gate =
`ROLES_ALLOWED` (owner + manager), the same set `recordPayout` uses — no PIN
override (clarified; and adjustments are not a Principle-II "privileged action"
like refund/void/settings, so no inline manager-PIN is required). Reuse the
`mapRpcError` token map, extended with the new RPC error tokens (the existing
`payroll_period_not_open` → `PERIOD_CLOSED` and `payroll_payout_exists` →
`ALREADY_PAID` already cover the lock cases). Validation: `amount_cents` integer
≠ 0, `|amount| > 0`, `reason` trimmed length 1–80. The action recomputes the
open ledger and refuses if the target row is `no_work` (FR-007 — adjustments
only for techs with work) or the period is read-only / the tech is paid.

---

## R6 — Test & migration footprint

- **Migration:** `supabase/migrations/0028_payout_adjustments.sql` (table + RLS +
  3 RPCs + the assert helper). Applied automatically by the preview/prod
  GitHub Actions (Constitution — schema-drift rule); never `db push` by hand.
- **Unit (Vitest, test-first for money):** extend
  `tests/unit/report/aggregate.test.ts` (refund allocation + net figures) and
  `tests/unit/payroll/aggregate.test.ts` (adjustments fold-in, net payout,
  negative net, refunded-ticket commission preserved).
- **E2E (Playwright):** extend `tests/e2e/payroll.spec.ts` (add/edit/delete
  adjustment via Dialog; net payout; closed-period lock), and
  `tests/e2e/refund-ticket.spec.ts` / `report.spec.ts` (refund keeps commission
  in payroll, nets revenue on the Report; void pays $0). `report.spec.ts` and
  `payroll.spec.ts` assert global aggregates over shared tables → they are
  **baseline** specs; check whether seed changes require updating their
  expected catalog/period totals (CLAUDE.md "Two-phase e2e projects").
- **Seed:** the local seed must contain a refunded (or partially-refunded) sale
  and a void in the current pay period so the e2e and the Report/payroll
  divergence are exercised against real rows.
