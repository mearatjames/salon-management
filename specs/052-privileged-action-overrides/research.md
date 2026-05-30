# Phase 0 Research: Voids & Refunds

All Technical Context items resolved against the existing codebase. No open NEEDS CLARIFICATION remain.

## D1. Authorization mechanism — role gate, server-enforced

- **Decision**: Authorize in the Server Action via `requireStudioSession()` (`lib/auth/session.ts`), then `if (viewer.staff.role !== "owner" && viewer.staff.role !== "manager") throw new PermissionDeniedError()`. Hide the affordance in the UI as defense-in-depth.
- **Rationale**: Exactly the pattern feature 050 (`app/(studio)/transactions/actions.ts:reassignPaidLineTech`) uses for a privileged paid-ticket mutation. `StudioViewer.staff.role` is `"owner" | "manager" | "technician" | "front_desk"`. Reuse `PermissionDeniedError` (already exported from the transactions actions module) — or lift it to a shared module if both checkout + transactions need it.
- **Alternatives considered**: Manager-PIN inline override (original spec / Principle II) — removed by maintainer clarification. RLS-based authorization — rejected; constitution makes RLS a backstop, not the primary authz layer.

## D2. Square refund wrapper — `lib/square/refunds.ts`

- **Decision**: New `refundCardPayment({ squarePaymentId, amountCents, idempotencyKey, reason? })` calling `client.payments.refundPayment(...)` via `getSquareClient(connection.accessToken)` from `readDecryptedTokens()`. Returns `{ squareRefundId, status }`. Used for both **card** and **gift** payments (both store `square_payment_id` on the payment row and both settle through `client.payments`).
- **Rationale**: Mirrors `lib/square/gift-cards.ts:createGiftCardPayment` structure (same client, same `readDecryptedTokens`, same money-shape `{ amount: BigInt(cents), currency: "USD" }`). Cash payments need no Square call.
- **Idempotency key**: Per Principle III the key is literally `${payment_id}:refund:${refund_payment_id}`. Add `buildRefundIdempotencyKey(originalPaymentId, refundPaymentId)` next to `buildIdempotencyKey` in `lib/square/terminal.ts`, hashing to ≤45 chars (Square limit) the same way (`sha256(...).slice(0,45)`), or pass the raw string if ≤45 — chosen: sha256 slice for consistency with the existing helper. The refund payment row's `id` is generated first (so it can seed the key) — see D4.
- **Alternatives considered**: Refunding via Terminal API — rejected; refunds go through the Payments API regardless of how the original was captured.

## D3. Schema deltas — migration `0025_void_refund.sql`

- **Decision**:
  - `ALTER TYPE public.ticket_status ADD VALUE IF NOT EXISTS 'void'`, `'refunded'`, `'partially_refunded'`.
  - `ALTER TYPE public.payment_kind ADD VALUE IF NOT EXISTS 'refund'`.
  - `ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS refunds_payment_id uuid REFERENCES public.payments(id)`, `ADD COLUMN IF NOT EXISTS square_refund_id text`.
  - Relax/replace `tickets_closed_consistency_chk` to allow the three new statuses with `closed_at`/`closed_by_staff_id` set (a void/refund is a "closed" outcome).
  - Partial unique index for refund idempotency backstop: `unique (refunds_payment_id, square_refund_id) where kind='refund'` is **not** sufficient; instead enforce the cash/card refund-once guard inside the RPC (row lock) plus a DB index on `refunds_payment_id` for fast remaining-balance sums.
- **Rationale**: Matches `docs/system-design.md` reserved design. Additive enum/column changes are safe. **No `authorized_by_staff_id` column** — single-actor model (resolved decision); the acting owner/manager is captured as `payments.taken_by_staff_id` and in `audit_log.acting_as_staff_id`.
- **Gotcha (enum-add-then-use)**: Postgres forbids using a freshly-added enum value in the **same transaction** for non-function DML. The RPCs that reference `'void'`/`'refund'` only *create* functions (PL/pgSQL bodies are validated at first execution, after commit), so they are safe in the same migration. No `INSERT ... 'refund'` or `status = 'void'` static DML runs in the migration itself. Verified against the 0008 precedent (added `'card'` and created a referencing RPC in one file).
- **Alternatives considered**: Storing refunds as negative `amount_cents` — rejected; `payments.amount_cents` has a `> 0` CHECK and Principle III wants explicit `kind='refund'` rows. Refunds carry **positive** `amount_cents` with `kind='refund'`; net = Σpayment − Σrefund.

## D4. Atomicity — two SECURITY DEFINER RPCs

- **Decision**: Mirror `pos_record_card_payment`'s transactional, row-locking style.
  - `pos_void_ticket(p_ticket_id, p_operator)` → locks the ticket + its succeeded payments `FOR UPDATE`; refuses if status not in `('paid')` or not same-day or already reversed; for each succeeded payment inserts a `kind='refund'` row (same method, `refunds_payment_id` = original, `taken_by_staff_id` = operator, `square_refund_id` NULL initially for card/gift); sets `tickets.status='void'`; inserts `void.issued` audit. Returns the list of created refund rows (id, method, square_payment_id, amount) so the action can fire Square refunds **after** the row exists.
  - `pos_refund_payments(p_ticket_id, p_operator, p_lines jsonb)` → validates each line's amount ≤ remaining (Σ original − Σ existing refunds for that payment, computed under lock), inserts `kind='refund'` rows, recomputes ticket status (`refunded` if Σrefunds = Σpayments, else `partially_refunded`), inserts `refund.issued` audit. Returns created refund rows for the Square step.
- **Two-phase Square settlement**: The DB row is created first (so its `id` seeds the idempotency key), then the action calls `refundCardPayment` per card/gift refund row, then writes back `square_refund_id` via a follow-up update. **If a Square refund throws, the action rolls back** (deletes the just-created refund rows / aborts) and the ticket status flip is reverted — surfaced as `SquareRefundFailedError`, leaving the ticket recoverable (FR-009/FR-013, SC-007). Cleanest implementation: the RPC creates rows in `status='pending'` for card/gift and the action flips them to `succeeded` + sets `square_refund_id` only after Square confirms; a failed Square call marks the refund row `failed` and the RPC's status flip is conditional on all card/gift legs succeeding. **Decision: do the ticket-status flip in a *second* RPC call (`pos_finalize_refund`) after Square succeeds**, so a failed Square refund never leaves a `void`/`refunded` ticket. (Documented in data-model.md state machine.)
- **Rationale**: Row locks prevent the concurrent double-refund (edge case) and the deterministic idempotency key prevents duplicate Square refunds on retry (SC-004). Splitting the status flip from row creation guarantees SC-007.
- **Alternatives considered**: Single RPC that calls Square (rejected — Postgres can't call Square; SECURITY DEFINER funcs are pure DB). Optimistic flip-then-compensate (rejected — leaves a window where a failed refund shows a `void` ticket).

## D5. Same-day void eligibility

- **Decision**: Eligible when `tickets.status='paid'` AND `tickets.closed_at` is on the current salon-local calendar day (computed via `lib/time/*` against `SALON_TZ`) AND not already a reversal. The `DoneScreen` only renders "Void sale" when the viewer is owner/manager and the ticket is same-day; the RPC re-checks server-side.
- **Rationale**: Resolved decision (spec 2026-05-28). Uses the single `lib/time` helper per the constitution's time-correctness rule. A prior-day ticket falls to the refund path.
- **Alternatives considered**: Tie to an EOD/drawer session — deferred; the drawer session does not exist yet (Principle V: simplest mechanism).

## D6. Refund composition UI surface

- **Decision**: Reuse the existing `ReceiptDrawer` (`components/lacquer/transactions/receipt-drawer.tsx`), which already receives `viewerRole` + `payPeriodFinalized` and computes `canEdit = (owner||manager) && !payPeriodFinalized`. Add a "Refund" entry that reveals a `RefundCompositionSheet` (new) listing the ticket's payments with a per-payment amount input. Dashboard `recent-transactions-feed.tsx` and the EOD day-report list both open the same receipt drawer (the dashboard feed currently has no per-row action — add an owner/manager affordance that opens the drawer for that ticket).
- **Rationale**: One refund surface, three entry points — avoids duplicate composition UIs and reuses 050's role/lock plumbing. `Sheet` primitive matches the design system (16px radius).
- **Alternatives considered**: A bespoke per-surface refund modal (rejected — duplication, drift risk).

## D7. Audit vocabulary

- **Decision**: Add `"void.issued"` and `"refund.issued"` to the `AuditAction` union in `lib/auth/audit.ts`. Both derive `entity_type='...'` — they start with neither `ticket.`/`payment.` prefix as-is, so **name them `payment.void_issued` / `payment.refund_issued`** to route through the existing `payment.` → `"payment"` prefix dispatch (consistent with `deriveEntityType`). Final names: `payment.void_issued`, `payment.refund_issued` (entity_type `payment`).
- **Rationale**: `deriveEntityType` keys off the verb prefix; `void.*`/`refund.*` would fall through to `"auth"`. Prefixing with `payment.` keeps the entity_type correct without editing the dispatch (the helper is "closed against future additions" by design). The RPCs insert audit rows directly (like `pos_record_card_payment`).
- **Payload**: void → `{ ticket_id, refunds: [{payment_id, method, amount_cents}], reversed_total_cents }`; refund → `{ ticket_id, lines: [{original_payment_id, refund_payment_id, method, amount_cents}], resulting_status }`. Operator = `acting_as_staff_id`.
- **Alternatives considered**: Editing `deriveEntityType` to add `void.`/`refund.` prefixes (rejected — unnecessary churn; the `payment.` prefix is semantically correct since refunds are payment rows).

## D8. Testing approach (Principle IV)

- **Unit (Vitest, written-to-fail first)**: `lib/payments/refund-status.ts` (remaining-per-payment, resulting ticket status across full/partial/over-refund); `lib/square/refunds.ts` (idempotency key passed, BigInt money shape, error propagation) — mock the Square client exactly like `tests/unit/square/gift-card-payment.test.ts`.
- **E2E (Playwright)**: `void-sale.spec.ts` (owner voids a same-day cash ticket → status void + refund row + `payment.void_issued` audit via `getAuditLogRowsSince`); `refund-ticket.spec.ts` (partial then full refund from the feed/drawer → `partially_refunded` then `refunded`; technician sees no affordance and a direct action is refused). Use the worker-scoped staff trio from `_fixtures.ts` and audit cursors from `_db.ts`.
- **Baseline-phase consideration**: neither new spec asserts a *global aggregate* over a shared table, so both belong in the parallel `main` project, not a baseline project. They DO mutate `tickets`/`payments` for their own worker's tickets — create dedicated tickets within the spec rather than reusing seeded ones to stay parallel-safe. Add new prod paths (`lib/square/refunds.ts`, `refund-status.ts`, the two actions) to `tests/e2e/_affected-map.mjs`.

## D9. Money invariants under reversal (Principle III)

- **Decision**: Original payments still sum to `tickets.total_cents` (unchanged). Refund rows are a separate `kind`; the reconciliation view is net = Σ(kind=payment, succeeded) − Σ(kind=refund, succeeded). A fully-voided/refunded ticket has net 0. Per-payment remaining = original.amount − Σ(refunds where refunds_payment_id = original.id, succeeded). The `> 0` amount CHECK holds (refund amounts are positive). Tips: a full void refunds the whole payment incl. tip; partial refunds operate on `amount_cents` only (spec assumption) — refund rows carry `tip_cents = 0`.
- **Rationale**: Keeps the existing `tickets_total_matches_subtotal_chk` and payment-sum invariant intact while making reversals explicit and reconcilable.
