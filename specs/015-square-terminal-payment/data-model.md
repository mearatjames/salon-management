# Phase 1 — Data Model: Square Terminal Card Payment

This document specifies every schema change shipped by `supabase/migrations/0008_square_terminal_payment.sql`. The migration is auto-applied to the hosted preview project on PR open/synchronize and to production on push to `main` (Constitution § Schema drift forbidden).

---

## 1. New table: `public.square_oauth`

Singleton (single-salon app): holds the salon's encrypted Square OAuth credentials. Exactly zero or one row.

```sql
create table if not exists public.square_oauth (
  id                              boolean primary key default true,            -- singleton enforcement: only one row allowed (id = true)
  merchant_id                     text not null,                                -- Square's merchant identifier
  merchant_name                   text not null,                                -- friendly business name for the settings header
  access_token_encrypted          bytea not null,                               -- pgp_sym_encrypt(plain, app.square_oauth_key)
  refresh_token_encrypted         bytea not null,
  access_token_expires_at         timestamptz not null,                         -- driven by Square's token response; daily cron compares against now() + 7d
  scope                           text not null,                                -- granted scope string (e.g., "PAYMENTS_WRITE PAYMENTS_READ ...")
  connected_at                    timestamptz not null default now(),
  connected_by_staff_id           uuid not null references public.staff(id),
  refresh_failed_at               timestamptz,                                  -- non-null means the daily refresh has failed; UI shows reconnect banner
  last_refreshed_at               timestamptz,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),
  constraint square_oauth_singleton_chk check (id is true)
);

alter table public.square_oauth enable row level security;
drop policy if exists square_oauth_select_authenticated on public.square_oauth;
create policy square_oauth_select_authenticated
  on public.square_oauth for select to authenticated using (true);
```

**Notes**
- The `id boolean primary key default true` + check constraint pattern enforces "exactly one row" at the database level — INSERT of a second row fails on the primary key.
- Encrypted columns are `bytea` to align with `pgp_sym_encrypt`'s return type. They are NEVER selectable in plaintext through normal queries; reads go through the `decrypt_square_token(bytea)` SQL function (see §6) which requires the `app.square_oauth_key` GUC to be set.
- `connected_by_staff_id` carries the owner who authorized; required for audit completeness (Constitution Principle III).
- `refresh_failed_at` is a flag the UI's reconnect banner reads. The daily cron sets it on failure; a successful refresh clears it back to `null`.
- `last_refreshed_at` is set by every successful refresh — useful for owner-facing "Last refreshed" copy if needed, and for diagnostics.

---

## 2. New table: `public.square_devices`

One row per paired Square Terminal device. `(merchant_id, square_device_id)` is unique; rows are created/refreshed by `lib/square/terminal.ts:listDevices()` whenever the settings page loads.

```sql
create table if not exists public.square_devices (
  id                       uuid primary key default gen_random_uuid(),
  square_device_id         text not null unique,                                -- Square-assigned (e.g., "device:XXXX...")
  friendly_name            text not null,                                       -- defaults to the Square-provided name on first insert; owner-editable
  is_default               boolean not null default false,                      -- at most one row may have this true (enforced by partial unique index below)
  last_seen_at             timestamptz not null default now(),                  -- bumped on each listDevices refresh
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

alter table public.square_devices enable row level security;
drop policy if exists square_devices_select_authenticated on public.square_devices;
create policy square_devices_select_authenticated
  on public.square_devices for select to authenticated using (true);

-- At most one row may be marked default.
create unique index if not exists square_devices_one_default_idx
  on public.square_devices ((true)) where is_default = true;

-- Fast lookup by Square's id (used by webhook routing).
create index if not exists square_devices_by_square_id_idx
  on public.square_devices (square_device_id);
```

**Notes**
- The partial unique index `square_devices_one_default_idx` ensures the FR-010a invariant: at most one default device per salon. `set_default_device(device_id)` is therefore a two-step transaction: clear any existing default, then set the new one.
- `friendly_name` is required (`not null`); on first insert it defaults to the Square-provided device name; the owner can edit it freely (FR-004).
- `last_seen_at` lets the settings UI show a soft "last seen 5m ago" indicator without making a Square round-trip on every render; the indicator updates as a side effect of the existing `listDevices` call.

---

## 3. Modifications to `public.payments`

This is the existing payments table (migration `0004_checkout_cash_sale.sql`). Changes are additive except for the `tip_cents` check constraint relaxation.

```sql
-- 3a. Add the 'card' method (enum extension; safe additive change).
alter type public.payment_method add value if not exists 'card';

-- 3b. New columns (all nullable; populated only for card payments).
alter table public.payments
  add column if not exists square_payment_id             text,
  add column if not exists square_terminal_checkout_id   text,
  add column if not exists raw                           jsonb,                  -- raw webhook payload; permanent audit
  add column if not exists failure_reason                text;                   -- 'declined' | 'device_offline' | 'cancelled_by_operator' | 'expired' | 'unknown' (free-text but app-controlled vocabulary)

-- 3c. Relax tip_cents constraint to allow card tips.
alter table public.payments drop constraint if exists payments_tip_cents_zero_chk;       -- migration 0004 named it this way; verify exact name during implementation
alter table public.payments add constraint payments_tip_cents_nonneg_chk
  check (tip_cents >= 0);

-- 3d. Webhook idempotency: unique partial index ensures at most one
--     succeeded row per Square terminal checkout, even under racing webhook
--     deliveries. The application-level status='pending' predicate is the
--     first line of defense; this index is the database-level backstop.
create unique index if not exists payments_unique_succeeded_terminal_checkout_idx
  on public.payments (square_terminal_checkout_id)
  where status = 'succeeded' and square_terminal_checkout_id is not null;

-- 3e. Cash check constraint stays as-is (payments_cash_status_succeeded_chk).
--     The pending+failed transitions only apply to card payments; cash
--     payments are always succeeded on insert by pos_take_cash.
```

**Notes**
- `square_payment_id` is the Square `Payment.id` returned in the webhook's `payment_ids` array; `square_terminal_checkout_id` is the `TerminalCheckout.id` returned by `terminals.createCheckout`. Both nullable because cash rows do not have them.
- `raw` is the **full** webhook payload (or, for a card row inserted before the webhook arrives, the synthetic `{ "kind": "pre_webhook", "checkout_id": "..." }` placeholder). Set to the real payload on successful resolution; useful for refund traces (phase 8) and dispute investigations.
- `failure_reason` is application-controlled vocabulary, not a DB enum, to keep the migration small. The TS-side `FailureReason` type lives in `lib/square/terminal.ts`.
- The unique partial index ensures **at most one** `succeeded` row per Square `square_terminal_checkout_id` even if two webhook deliveries race past the application predicate. INSERTing the same `square_terminal_checkout_id` as `succeeded` twice would fail on the constraint and roll back the transaction — the second handler returns 200 with no-op, the first wins.

---

## 4. New RPC: `pos_record_card_payment`

Atomic writer for card payment settlement: updates the existing `pending` payment row, flips the ticket to `paid` if total payments cover the ticket, and audits — all in one transaction.

```sql
create or replace function public.pos_record_card_payment(
  p_payment_id          uuid,
  p_new_status          public.payment_status,                                    -- 'succeeded' | 'failed'
  p_tip_cents           int,                                                      -- 0 for failures
  p_square_payment_id   text,                                                     -- nullable for failures
  p_raw                 jsonb,                                                    -- the webhook payload
  p_failure_reason      text                                                      -- nullable for succeeded
) returns table (ticket_id uuid, ticket_flipped_to_paid boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ticket_id              uuid;
  v_amount                 int;
  v_ticket_total           int;
  v_succeeded_sum          int;
  v_ticket_flipped         boolean := false;
  v_existing_status        public.payment_status;
begin
  -- 1) Lock the payment row; refuse mutation if not 'pending'.
  --    This is the application-level idempotency guard — duplicate webhooks
  --    find non-'pending' rows and short-circuit.
  select status, ticket_id, amount_cents
    into v_existing_status, v_ticket_id, v_amount
    from public.payments
    where id = p_payment_id
    for update;

  if not found then
    raise exception 'payment_not_found' using errcode = 'P0001';
  end if;

  -- Idempotency: replayed webhook on a 'succeeded' or 'failed' row is a no-op.
  if v_existing_status != 'pending' then
    -- Special case (R5 escape hatch): a late 'succeeded' webhook can
    -- override an 'expired' failure (per the Square-wins clarification).
    if v_existing_status = 'failed'
       and p_new_status = 'succeeded'
       and (select failure_reason from public.payments where id = p_payment_id) = 'expired'
    then
      -- fall through to update; Square wins.
      null;
    else
      return query select v_ticket_id, false;
      return;
    end if;
  end if;

  -- 2) Update the payment row.
  update public.payments
    set status              = p_new_status,
        tip_cents           = p_tip_cents,
        square_payment_id   = coalesce(p_square_payment_id, square_payment_id),
        raw                 = p_raw,
        failure_reason      = case when p_new_status = 'failed' then p_failure_reason else null end,
        processed_at        = now()
    where id = p_payment_id;

  -- 3) If this was a success, check whether the ticket is fully covered.
  if p_new_status = 'succeeded' then
    select total_cents into v_ticket_total
      from public.tickets
      where id = v_ticket_id
      for update;

    select coalesce(sum(amount_cents), 0) into v_succeeded_sum
      from public.payments
      where ticket_id = v_ticket_id and status = 'succeeded';

    if v_succeeded_sum >= v_ticket_total then
      update public.tickets
        set status              = 'paid',
            closed_by_staff_id  = (select taken_by_staff_id from public.payments where id = p_payment_id),
            closed_at           = now(),
            updated_at          = now()
        where id = v_ticket_id and status = 'open';
      v_ticket_flipped := true;
    end if;
  end if;

  -- 4) Audit. payment.captured for success, payment.failed for failure.
  insert into public.audit_log (acting_as_staff_id, action, entity_type, entity_id, payload)
    values (
      (select taken_by_staff_id from public.payments where id = p_payment_id),
      case when p_new_status = 'succeeded' then 'payment.captured' else 'payment.failed' end,
      'payment',
      p_payment_id,
      jsonb_build_object(
        'ticket_id', v_ticket_id,
        'method', 'card',
        'amount_cents', v_amount,
        'tip_cents', p_tip_cents,
        'failure_reason', p_failure_reason,
        'square_payment_id', p_square_payment_id
      )
    );

  return query select v_ticket_id, v_ticket_flipped;
end;
$$;

revoke all on function public.pos_record_card_payment(uuid, public.payment_status, int, text, jsonb, text) from public;
grant execute on function public.pos_record_card_payment(uuid, public.payment_status, int, text, jsonb, text) to service_role;
```

**Invariants this RPC guarantees**
- Money invariant (Principle III): the ticket is only flipped to `paid` when the **sum** of `succeeded` payments covers `tickets.total_cents`. Partial coverage leaves the ticket `open`.
- Idempotency (Principle III): a replayed webhook on a row already in `succeeded` or `failed` (with the documented `expired → succeeded` exception) returns immediately without re-mutating; the unique partial index in §3d catches any database-level race that slips past.
- Square-wins (FR-016a): a `succeeded` webhook against a `failed (reason=expired)` row is the **only** non-pending state that can be overridden. A `failed (reason=cancelled_by_operator)` row that receives a late `succeeded` webhook still settles to `succeeded` because the application's cancel-handler **never** transitions a row out of `pending` until Square confirms (per R2); the cancelled state is observed only after Square's confirmation, by which point the same webhook is the cancel confirmation OR the success confirmation, not both.
- Atomicity: all three actions (payment update, ticket flip, audit insert) succeed together or fail together, since they live in a single `plpgsql` function body and Postgres wraps each function call in an implicit subtransaction.

---

## 5. New SQL function: `decrypt_square_token`

Thin pgcrypto wrapper used by `lib/square/oauth.ts` to read the encrypted columns. Requires the `app.square_oauth_key` GUC to be set (see R3).

```sql
create or replace function public.decrypt_square_token(ciphertext bytea)
returns text
language sql
stable
as $$
  select pgp_sym_decrypt(ciphertext, current_setting('app.square_oauth_key'))::text;
$$;

revoke all on function public.decrypt_square_token(bytea) from public;
grant execute on function public.decrypt_square_token(bytea) to service_role;
```

**Notes**
- `stable` is correct: the function's result depends on the GUC value but is otherwise deterministic for the same input within a single query.
- Grant is `service_role` only — RLS-bound `authenticated` users CANNOT decrypt tokens even if they could SELECT the `bytea` column (RLS allows reading the row but the function call would fail on grant). Defense-in-depth.
- `current_setting('app.square_oauth_key')` raises `42704` if the GUC has never been set in this transaction. The application-side handling logs and returns a 503; never crashes the request.

---

## 6. Migration meta and ordering

- Filename: `supabase/migrations/0008_square_terminal_payment.sql` (next sequential number after `0007_cart_polish.sql`).
- Top-of-file comment block follows the convention from `0004_checkout_cash_sale.sql`: feature link, RLS policy summary, audit_log impact note.
- `create extension if not exists pgcrypto with schema extensions;` — pgcrypto is already available in Supabase Postgres; the `if not exists` guard makes the migration idempotent.
- The migration MUST be in the PR that opens this feature so the preview-deploy GitHub Action applies it before the Vercel preview deploy is exercised (Constitution § Schema drift forbidden).

---

## 7. Entity map (spec → schema)

| Spec entity | Schema realization |
|---|---|
| Square Connection | `square_oauth` (singleton row) |
| Terminal Device | `square_devices` (one row per paired device) |
| Payment (card-attempt) | `payments` row with `method = 'card'`, `kind = 'payment'`; per-attempt — failed rows are retained, retries INSERT new rows |
| Ticket | `tickets` (unchanged shape; transitions to `paid` via the RPC when total coverage is achieved) |

---

## 8. State transitions

**Payment (card attempts)** — strictly forward, with one well-defined exception:

```
                        ┌──────────────────────────────────────┐
                        │                                      │
(INSERT)              ┌─▼─────────┐    SUCCEEDED webhook    ┌──┴────────┐
─────────► pending ─►│   pending   │ ─────────────────────► │ succeeded │
                      └─┬───────┬─┘                          └───────────┘
                        │       │ FAILED webhook
                        │       │ (decline, device offline)
                        │       ▼
                        │     ┌────────────────────────────┐
                        │     │ failed                     │
                        │     │ (failure_reason='declined' │
                        │     │  | 'device_offline' | ...) │
                        │     └────────────────────────────┘
                        │                  ▲
                        │                  │ NO TRANSITION
                        │                  │
                        │                  │ (per-attempt rows; retry INSERTs
                        │                  │  a brand-new row instead)
                        │
                        │ 5 min elapsed without webhook,
                        │ polling endpoint observed
                        ▼
                  ┌────────────────────────────────────────┐
                  │ failed (failure_reason='expired')      │
                  └────────────┬───────────────────────────┘
                               │
                               │ late SUCCEEDED webhook
                               │ (R5 + R2 escape hatch — Square wins)
                               ▼
                          ┌───────────┐
                          │ succeeded │
                          └───────────┘
```

**Ticket** — unchanged from existing schema. `pos_record_card_payment` transitions `open → paid` when total succeeded payments cover the total; no other transition is introduced by this phase.

---

## 9. What this phase does NOT change

- `tickets` table shape (only the `status` value transitions via the RPC).
- `ticket_items` table.
- `appointments` table.
- `pos_take_cash` RPC — untouched. The cash flow's `tip_cents = 0` callsite stays valid under the relaxed `>= 0` constraint.
- `audit_log` table shape — only the `AuditAction` vocabulary expands (see contracts/audit.contract.md).
