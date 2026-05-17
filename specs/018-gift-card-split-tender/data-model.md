# Phase 1 — Data Model: Gift Card Redemption & Split-Tender Checkout

**Feature**: 018-gift-card-split-tender · **Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Research**: [research.md](./research.md)

This document is the contract for migration `supabase/migrations/0010_gift_card_split_tender.sql`. The migration ships in one file, applied automatically by the two GitHub Actions per Constitution v1.0.3 § "Schema drift forbidden".

---

## 1. `gift_cards` (new table)

Cache of every gift card the salon has encountered. Square is the source of truth — this row exists so the cart can render a card's last-known balance quickly and so audit rows can reference a stable id without storing the full GAN.

```sql
create table if not exists public.gift_cards (
  id                       uuid primary key default gen_random_uuid(),
  square_gift_card_id      text not null unique,                  -- stable Square id; the only cross-system correlation key
  last4_mask               text not null check (last4_mask ~ '^[0-9]{4}$'),  -- per-clarifications Q1 — mask only
  balance_cents_cached     int  not null check (balance_cents_cached >= 0),
  state                    text not null check (state in ('ACTIVE','PENDING','BLOCKED','DEACTIVATED')),
  last_synced_at           timestamptz not null default now(),    -- when the cached balance was last refreshed from Square
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

alter table public.gift_cards enable row level security;

drop policy if exists gift_cards_select_authenticated on public.gift_cards;
create policy gift_cards_select_authenticated
  on public.gift_cards for select to authenticated using (true);
```

**Notes**:
- No FK from `payments` is documented here yet; that arrives in section 3 below.
- The full GAN MUST NOT appear in this row or anywhere else in the salon's datastore (per Clarifications session Q1).
- `state` is the upstream Square gift-card lifecycle state. The salon does not modify it; it is refreshed on every `lookupGiftCard` action.
- The `updated_at` column is maintained by a trigger consistent with the existing `tickets_set_updated_at_trg` pattern.

---

## 2. Enum extensions

### 2.a `payment_method` enum gains `'gift'`

```sql
alter type public.payment_method add value if not exists 'gift';
```

The enum now holds three values: `'cash'`, `'card'` (added by 0008), `'gift'` (this migration). The `payment_method` is the leg's primary classifier — every payment row has exactly one method.

### 2.b `payment_status` enum gains `'draft'`

```sql
alter type public.payment_status add value if not exists 'draft';
```

The enum now holds four values: `'draft'` (new), `'pending'`, `'succeeded'`, `'failed'`. Semantics:

| Status | Meaning |
|--------|---------|
| `'draft'` | Composed in split mode but not yet activated. No upstream call has been made. Discardable by the operator or by a cart edit. |
| `'pending'` | Activated. An upstream call is in flight (card on terminal, or gift-card `payments.create` awaiting webhook confirmation). At most one per ticket (unique-in-flight index — section 6). |
| `'succeeded'` | Settled. Counts toward `tickets.total_cents`. Cannot be modified by the checkout flow (refund flow only). |
| `'failed'` | Activated but settled to failure (card declined, terminal timeout, gift-card REJECTED). Operator may remove it from the cart and compose a fresh leg. |

Cash legs skip `'pending'` and transition `draft → succeeded` directly on activation.

---

## 3. `payments` column additions

```sql
alter table public.payments
  add column if not exists gift_card_id                  uuid references public.gift_cards(id),
  add column if not exists square_gift_card_payment_id   text;
```

| Column | Populated for | Notes |
|--------|---------------|-------|
| `gift_card_id` | gift-card legs only | FK into the cache table; nullable for non-gift legs. |
| `square_gift_card_payment_id` | gift-card legs only | The upstream Square Payment id created by `payments.create` with `source_id = gift_card_id`. The webhook lookup key. Nullable for non-gift legs. |

Existing column `square_payment_id` (added by 0008 for terminal/card payments) is **not** reused for gift-card payment ids — gift-card and card are separate Square objects with different APIs. Keeping the columns distinct preserves the receipt-render query's ability to format methods differently without needing to inspect the `method` enum.

---

## 4. Constraint relaxation

The existing constraint from 0004 enforces "cash payments are always succeeded":

```sql
constraint payments_cash_status_succeeded_chk
  check (method != 'cash' or status = 'succeeded')
```

With split-tender, a cash leg starts as `'draft'` and transitions to `'succeeded'` on activation — there is still no async `'pending'` state for cash. The constraint relaxes to:

```sql
alter table public.payments drop constraint if exists payments_cash_status_succeeded_chk;
alter table public.payments add constraint payments_cash_status_succeeded_chk
  check (method != 'cash' or status in ('draft','succeeded'));
```

Cash legs that fail are not a thing — cash is recorded at the moment it's accepted; there is no asynchronous "cash settlement" to fail. The `'failed'` state remains forbidden for cash legs by this constraint.

The existing `tip_cents >= 0` constraint (relaxed in 0008) is unchanged. Gift-card payments are charged with `tip_money.amount = 0` (no tip flow in this phase per the spec's Assumptions).

---

## 5. New indexes

### 5.a Unique-in-flight per ticket (FR-019a + FR-022)

```sql
create unique index if not exists payments_one_in_flight_per_ticket_idx
  on public.payments (ticket_id)
  where status = 'pending';
```

Prevents two devices (or two browser tabs) from concurrently activating a second leg on the same ticket. The application catches `23505 unique_violation` on activation and translates to `TicketAlreadyBeingChargedError`. Draft and succeeded rows are unaffected.

### 5.b Gift-card webhook idempotency backstop

```sql
create unique index if not exists payments_unique_succeeded_gift_card_payment_idx
  on public.payments (square_gift_card_payment_id)
  where status = 'succeeded' and square_gift_card_payment_id is not null;
```

Mirrors the existing `payments_unique_succeeded_terminal_checkout_idx` from 0008. A second `payment.updated` webhook event for the same Square gift-card payment id cannot create a duplicate succeeded row (the RPC's `status = 'pending'` predicate is the first line of defense; this index is the database backstop).

---

## 6. New RPCs

All four RPCs are `security definer`, `set search_path = public, pg_temp`, `revoke all from public`, `grant execute to service_role`. Each runs in a single transaction so partial failures roll back atomically.

### 6.a `pos_compose_payment_draft`

```sql
create or replace function public.pos_compose_payment_draft(
  p_ticket_id   uuid,
  p_operator    uuid,
  p_method      public.payment_method,
  p_amount      int
) returns uuid
```

**Steps**:

1. Lock the ticket (`select 1 from tickets where id = $1 and status = 'open' for update`); refuse if not open.
2. Refuse if any `ticket_items` has `price_unconfirmed = true` (mirrors `pos_take_cash` — drafts can't be composed against an unpriced cart).
3. Compute `remaining_owed = tickets.total_cents - sum(amount_cents) FROM payments WHERE ticket_id = $1 AND status IN ('draft','pending','succeeded')`. Refuse with `legs_must_fit_remaining` if `p_amount > remaining_owed` or `p_amount <= 0`.
4. Insert a payment row with `status = 'draft'`, `kind = 'payment'`, the provided method, amount, and `p_operator`. For `method = 'cash'` and `method = 'gift'`, `tip_cents = 0`. For `method = 'card'`, `tip_cents = 0` (the actual tip is captured at terminal-settlement time and updated by `pos_record_card_payment`).
5. Insert `audit_log` row: `action = 'payment.draft_created'`, `entity_type = 'payment'`, `entity_id = new payment id`, `payload = {ticket_id, method, amount_cents, remaining_owed_cents}` per [contracts/audit.contract.md § 3.a](./contracts/audit.contract.md).
6. Return the new payment id.

### 6.b `pos_remove_payment_draft`

```sql
create or replace function public.pos_remove_payment_draft(
  p_payment_id  uuid,
  p_operator    uuid
) returns void
```

**Steps**:

1. Lock the payment (`select status, ticket_id, method, amount_cents from payments where id = $1 for update`).
2. Refuse with `draft_leg_not_found` if not found or `status != 'draft'`.
3. `delete from payments where id = $1`.
4. Insert `audit_log` row: `action = 'payment.draft_removed'`, `entity_type = 'payment'`, `entity_id = $1`, `payload = {ticket_id, method, amount_cents, reason: 'operator_removed'}`.

### 6.c `pos_activate_cash_draft`

```sql
create or replace function public.pos_activate_cash_draft(
  p_payment_id  uuid,
  p_operator    uuid
) returns table (ticket_id uuid, ticket_flipped_to_paid boolean)
```

**Steps**:

1. Lock the payment (`for update`); refuse with `draft_leg_not_found` if not found or `status != 'draft'` or `method != 'cash'`.
2. Lock the ticket; refuse if not `'open'`.
3. Verify the legs-sum-equals-total guard (FR-012, FR-016): `sum(amount_cents from non-failed legs) == tickets.total_cents`. Refuse with `legs_must_sum_to_total` if not.
4. Flip the payment to `'succeeded'` with `processed_at = now()`.
5. Recompute `succeeded_sum = sum(amount_cents) FROM payments WHERE ticket_id = $1 AND status = 'succeeded'`.
6. If `succeeded_sum >= tickets.total_cents`, flip the ticket to `'paid'` with `closed_by_staff_id = p_operator`, `closed_at = now()`, `updated_at = now()`. Set `v_ticket_flipped := true`.
7. Insert `audit_log` row: `action = 'payment.captured'`, `entity_type = 'payment'`, `entity_id = $1`, `payload = {ticket_id, method: 'cash', amount_cents, tip_cents: 0, leg_index: <ordinal>}`.
8. Return `(ticket_id, v_ticket_flipped)`.

### 6.d `pos_record_gift_payment`

```sql
create or replace function public.pos_record_gift_payment(
  p_payment_id              uuid,
  p_new_status              public.payment_status,    -- 'succeeded' | 'failed'
  p_square_gift_card_id     text,
  p_square_payment_id       text,
  p_raw                     jsonb,
  p_failure_reason          text
) returns table (ticket_id uuid, ticket_flipped_to_paid boolean)
```

Mirrors `pos_record_card_payment` (from 0008) almost exactly, with two differences:
- Writes `square_gift_card_payment_id` (not `square_payment_id` or `square_terminal_checkout_id`).
- Resolves `gift_card_id` by lookup on `square_gift_card_id`.

**Steps**:

1. Lock the payment (`for update`); refuse with `payment_not_found` if not found.
2. Idempotency: if `status != 'pending'`, return `(ticket_id, false)` — replayed webhook is a no-op. (No escape hatch for `'expired'` here because gift-card payments settle synchronously and don't have the 5-min lazy-expiration that terminal checkouts have.)
3. Resolve `v_gift_card_id` via `select id from gift_cards where square_gift_card_id = p_square_gift_card_id`.
4. Update the payment row: `status = p_new_status`, `square_gift_card_payment_id = p_square_payment_id`, `gift_card_id = v_gift_card_id`, `raw = p_raw`, `failure_reason = ...`, `processed_at = now()`.
5. If `p_new_status = 'succeeded'`: legs-sum-to-total check + ticket-paid flip, same shape as section 6.c steps 5–6.
6. Insert `audit_log` row: `action = (succeeded ? 'gift_card.redeemed' : 'payment.failed')`, `entity_type = (succeeded ? 'gift_card' : 'payment')`, `entity_id = $1`, payload includes `{ticket_id, method: 'gift', amount_cents, square_gift_card_id, last4_mask, failure_reason}` where `last4_mask` is read from `gift_cards.last4_mask`.
7. Return `(ticket_id, v_ticket_flipped)`.

---

## 7. State-machine summary

| Method | Status sequence | Notes |
|--------|-----------------|-------|
| cash   | `draft → succeeded`          | One-step activation; no `pending` intermediate. |
| card   | `draft → pending → succeeded` | `pending → succeeded` via webhook; same RPC as feature 015 (`pos_record_card_payment`). `pending → failed` on decline/cancel. |
| gift   | `draft → pending → succeeded` | `pending → succeeded` via `payment.updated` webhook; new RPC `pos_record_gift_payment`. |

Ticket states: `open` (default) → `paid` (when sum of succeeded legs ≥ `tickets.total_cents`) → terminal. `paid` rejects all further leg activations.

---

## 8. `discardDraftLegs` helper (application layer, not SQL)

Per R5, this lives in `app/(studio)/checkout/_drafts.ts`. It is invoked from the existing line-mutation Server Actions (`addServiceLine`, `removeLine`, `setLinePrice`, `addDiscountLine`, `removeDiscountLine`) as the first step, before the line mutation runs.

**Pseudocode** (not SQL — this is TS):

```ts
async function discardDraftLegs(
  ticketId: string,
  operatorStaffId: string,
  supabase: SupabaseServiceRoleClient
): Promise<{ discardedCount: number }> {
  // 1) Refuse mutation if any leg is in-flight (FR-019a)
  const { data: inFlight } = await supabase
    .from("payments")
    .select("id")
    .eq("ticket_id", ticketId)
    .eq("status", "pending")
    .limit(1);
  if (inFlight && inFlight.length > 0) {
    throw new TicketAlreadyBeingChargedError();
  }

  // 2) Read drafts, audit each, then delete in one round-trip.
  const { data: drafts } = await supabase
    .from("payments")
    .select("id, method, amount_cents")
    .eq("ticket_id", ticketId)
    .eq("status", "draft");

  for (const d of drafts ?? []) {
    await recordAudit(
      "payment.draft_removed",
      /* device user resolved by caller */,
      d.id,
      { ticket_id: ticketId, method: d.method, amount_cents: d.amount_cents, reason: "cart_edit_invalidated" },
      operatorStaffId
    );
  }

  if ((drafts ?? []).length > 0) {
    await supabase.from("payments").delete().eq("ticket_id", ticketId).eq("status", "draft");
  }

  return { discardedCount: (drafts ?? []).length };
}
```

The five calling actions add `draftsDiscarded` to their existing success-result shape so the client UI can surface a toast.

---

## 9. Migration ordering

1. `create extension if not exists pgcrypto;` — already in 0008; not re-applied.
2. Enum extensions (`payment_method += 'gift'`, `payment_status += 'draft'`). **NOTE**: Postgres requires enum-add to commit before the new value can be used. The migration file must either (a) use two transactions (separator `commit; begin;`) or (b) split into two migrations. We use (a) — matching the pattern from 0008's `add value if not exists 'card'` which committed before being used by the constraint changes.
3. Constraint relaxation (`payments_cash_status_succeeded_chk`).
4. Column additions (`gift_card_id`, `square_gift_card_payment_id`).
5. `gift_cards` table + RLS policy.
6. Two new partial indexes.
7. Four new RPCs.
8. Revoke + grant on each RPC.

---

## 10. Type regeneration

After the migration applies in CI's preview Supabase, regenerate `lib/db/types.ts` via `supabase gen types typescript`. The new types make `gift_card_id` and `square_gift_card_payment_id` nullable on `payments`, expose the four new RPCs, and surface the `gift_cards` row type.
