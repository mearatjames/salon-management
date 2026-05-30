# Phase 1 Data Model: Voids & Refunds

Migration: `supabase/migrations/0025_void_refund.sql`. All writes via service-role (Principle II); reads via `select to authenticated using (true)` policies already on these tables.

## Enum extensions

```sql
ALTER TYPE public.ticket_status  ADD VALUE IF NOT EXISTS 'void';
ALTER TYPE public.ticket_status  ADD VALUE IF NOT EXISTS 'refunded';
ALTER TYPE public.ticket_status  ADD VALUE IF NOT EXISTS 'partially_refunded';
ALTER TYPE public.payment_kind   ADD VALUE IF NOT EXISTS 'refund';
```

`payment_method` already includes `cash | card | gift` (0008, 0010). `payment_status` already includes `succeeded | pending | failed` (0008).

## `payments` — new columns

| Column | Type | Notes |
|--------|------|-------|
| `refunds_payment_id` | `uuid NULL REFERENCES public.payments(id)` | On a `kind='refund'` row, points at the original payment it reverses. NULL on original (`kind='payment'`) rows. |
| `square_refund_id` | `text NULL` | Square's refund id; set after `client.payments.refundPayment` confirms (card/gift). NULL for cash refunds and for original payments. |

- **No `authorized_by_staff_id`** — single-actor model (spec § Resolved Decisions). The acting owner/manager is recorded as `taken_by_staff_id` on the refund row and as `acting_as_staff_id` in the audit row.
- Refund rows carry **positive** `amount_cents` (the `> 0` CHECK holds), `kind='refund'`, `tip_cents = 0`, and the **same `method`** as the original.
- Index: `create index payments_refunds_of_idx on public.payments (refunds_payment_id) where kind = 'refund';` (fast remaining-balance sums).
- Idempotency backstop: `create unique index payments_unique_square_refund_idx on public.payments (square_refund_id) where square_refund_id is not null;` (DB-level dup-refund guard, complements the deterministic key + row lock).

## `tickets` — constraint update

Replace `tickets_closed_consistency_chk` so the three reversal statuses are valid closed outcomes:

```sql
ALTER TABLE public.tickets DROP CONSTRAINT IF EXISTS tickets_closed_consistency_chk;
ALTER TABLE public.tickets ADD CONSTRAINT tickets_closed_consistency_chk CHECK (
     (status = 'open'               and closed_at is null     and closed_by_staff_id is null)
  or (status = 'paid'               and closed_at is not null and closed_by_staff_id is not null)
  or (status = 'discarded'          and closed_at is not null and closed_by_staff_id is not null)
  or (status = 'void'               and closed_at is not null and closed_by_staff_id is not null)
  or (status = 'refunded'           and closed_at is not null and closed_by_staff_id is not null)
  or (status = 'partially_refunded' and closed_at is not null and closed_by_staff_id is not null)
);
```

`total_cents` / `subtotal_cents` are **not** mutated by reversals — history is preserved (Principle III). Reversal is expressed entirely through refund payment rows + status.

## Entities (logical)

### Ticket
- **Statuses**: `open → paid` (existing); `paid → void` (full same-day reversal); `paid → partially_refunded → refunded` (cumulative refunds). `discarded` unchanged.
- A `void` or `refunded` ticket has net money 0. `partially_refunded` has net > 0 and < original.

### Payment (original, `kind='payment'`)
- Unchanged. `remaining(payment) = amount_cents − Σ(refund.amount_cents where refunds_payment_id = payment.id and status='succeeded')`.

### Payment (refund, `kind='refund'`)
- `refunds_payment_id` → original; `method` mirrors original; `amount_cents > 0`; `tip_cents = 0`; `taken_by_staff_id` = acting owner/manager.
- Card/gift: created `status='pending'`, flipped to `succeeded` + `square_refund_id` set after Square confirms; `failed` if Square errors.
- Cash: created directly `status='succeeded'` (no external call; drawer reconciliation deferred).

### Audit record
- `payment.void_issued` / `payment.refund_issued`, `entity_type='payment'`, `acting_as_staff_id` = acting owner/manager, payload per contracts/audit.contract.md.

## State machine — reversal lifecycle

```text
VOID (same-day, full):
  paid ──[pos_void_ticket: create refund rows (cash succeeded; card/gift pending)]──► (rows exist, ticket still paid)
       ──[action: refundCardPayment per card/gift row]──► success?
            ├─ all succeed ──[pos_finalize_void: flip rows→succeeded+square_refund_id, ticket→void, audit]──► void
            └─ any fails   ──[action: mark legs failed, abort]──► paid (recoverable) + SquareRefundFailedError

REFUND (any-time, full/partial):
  paid|partially_refunded ──[pos_refund_payments: validate amounts ≤ remaining; create refund rows]──► (rows exist)
       ──[action: refundCardPayment per card/gift row]──► success?
            ├─ all succeed ──[pos_finalize_refund: flip succeeded+square_refund_id; status = refunded if Σrefunds=Σpayments else partially_refunded; audit]──► refunded | partially_refunded
            └─ any fails   ──[action: mark legs failed, abort status flip]──► unchanged (recoverable) + SquareRefundFailedError
```

**Guarantees**:
- The ticket status flip happens only in the *finalize* step, after every card/gift Square refund confirms → no half-reversed ticket (SC-007).
- Row locks (`FOR UPDATE` on ticket + its payments) serialize concurrent reversals → no double-refund (edge case).
- Deterministic key `${original_payment_id}:refund:${refund_payment_id}` + `square_refund_id` unique index → Square refund issued at most once per refund row (SC-004).

## Validation rules (enforced server-side)

| Rule | Where | Maps to |
|------|-------|---------|
| Only active owner/manager may void/refund | action role gate + (no RLS reliance) | FR-001, FR-002, SC-002 |
| Void only on same-day `paid` ticket, not already reversed | `pos_void_ticket` + DoneScreen gate | FR-004, FR-011 |
| Per-payment refund ≤ remaining unrefunded | `pos_refund_payments` (under lock) | FR-014, SC-003 |
| Refund total > 0 | sheet + RPC | FR-014 |
| One refund row per original per reversal, linked via `refunds_payment_id` | RPCs | FR-005, FR-015, Principle III |
| Card/gift → Square refund once; cash → row only | action + wrapper | FR-006, FR-007, FR-016, SC-004 |
| Status = refunded iff fully reversed else partially_refunded | `lib/payments/refund-status.ts` + finalize RPC | FR-017, SC-006 |
| Failed Square refund ⇒ no status flip | finalize ordering | FR-009, SC-007 |
