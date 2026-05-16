# Phase 1 — Data Model: Checkout — Cash-Only Sale

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Research**: [research.md](./research.md)

This document specifies the four entities added by `supabase/migrations/0004_checkout_cash_sale.sql`, their columns, constraints, indexes, RLS policies, and lifecycle. The shapes follow `docs/system-design.md` § Data model verbatim, with one extension (the `'discarded'` ticket status — see `plan.md` § Complexity Tracking).

The migration name is `0004_checkout_cash_sale.sql` and follows on from `0003_services_catalog.sql`. All four tables are created in a single migration so the FK chain (`payments → tickets`, `ticket_items → tickets`, `tickets → appointments`) is satisfied without a cross-migration ordering trap.

---

## Entity overview

```text
appointments  (schema only this phase — no UI, no seed)
   ▲
   │ appointment_id (nullable)
   │
tickets ─────────────┐
   ▲                 │
   │ ticket_id (NN)  │ ticket_id (NN)
   │                 ▼
ticket_items     payments
```

Out-of-scope tables (`tip_splits`, `cash_drawer_sessions`, `gift_cards`, `walk_ins`, etc.) are not created by this migration and not referenced.

---

## 1. `public.appointments` (schema only)

**Purpose**: satisfy `tickets.appointment_id`'s FK target. No UI, no seed, no queries this phase. The columns mirror `docs/system-design.md` § Data model so the appointments feature can land later without a destructive migration.

```sql
create table if not exists public.appointments (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null,                            -- FK to clients (table not yet created; constraint added in the appointments feature)
  staff_id              uuid not null references public.staff(id),
  start_at              timestamptz not null,
  end_at                timestamptz not null,
  status                text not null check (
                          status in ('booked','checked_in','in_service','completed','cancelled','no_show')
                        ),
  source                text not null check (source in ('booked','walk_in')),
  notes                 text,
  created_by_user_id    uuid,                                     -- auth.users; nullable for system-created rows
  created_by_staff_id   uuid references public.staff(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint appointments_end_after_start chk check (end_at > start_at)
);

alter table public.appointments enable row level security;

create policy appointments_select_authenticated
  on public.appointments for select to authenticated using (true);

-- No insert/update/delete policies; writes go through service-role client.
```

**Notes**:

- `client_id` is NOT yet wrapped in a FK because `public.clients` does not exist yet (clients land in a later phase). The column is `not null` so when the FK lands later it does not require a backfill.
- `updated_at` trigger is added by the migration using the existing repo convention (the same trigger function created in `0002_staff_management.sql`).

---

## 2. `public.tickets`

**Purpose**: a standalone sale record. Spec §§ FR-002, FR-003, FR-004, FR-005, FR-018, FR-022, Key Entities (Ticket).

```sql
create type public.ticket_status as enum (
  'open',
  'paid',
  'discarded'
  -- The system-design baseline also reserves 'partially_refunded', 'refunded', 'void'
  -- for later phases. They are NOT added in this migration to keep the enum honest
  -- with the actual phase-1 lifecycle; phase 8 (refunds/voids) will extend it via
  -- ALTER TYPE ADD VALUE in its own migration.
);

create table if not exists public.tickets (
  id                    uuid primary key default gen_random_uuid(),
  appointment_id        uuid references public.appointments(id),  -- nullable; unused this phase
  status                public.ticket_status not null default 'open',
  subtotal_cents        int not null default 0 check (subtotal_cents >= 0),
  tax_cents             int not null default 0 check (tax_cents = 0),    -- v1 invariant; will relax in tax phase
  total_cents           int not null default 0 check (total_cents >= 0),
  opened_by_staff_id    uuid not null references public.staff(id),
  closed_by_staff_id    uuid references public.staff(id),
  closed_at             timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint tickets_total_matches_subtotal chk check (total_cents = subtotal_cents + tax_cents),
  constraint tickets_closed_consistency chk check (
    (status = 'open'        and closed_at is null and closed_by_staff_id is null)
    or (status = 'paid'     and closed_at is not null and closed_by_staff_id is not null)
    or (status = 'discarded' and closed_at is not null and closed_by_staff_id is not null)
  )
);

alter table public.tickets enable row level security;

create policy tickets_select_authenticated
  on public.tickets for select to authenticated using (true);

-- Indexes:
-- 1) Resume-or-create hot path (FR-003): operator + status + recency.
create index tickets_open_by_operator_recent_idx
  on public.tickets (opened_by_staff_id, updated_at desc)
  where status = 'open';

-- 2) Generic status filter (for any "list paid tickets today" later).
create index tickets_status_created_at_idx
  on public.tickets (status, created_at desc);
```

**Lifecycle** (state machine):

```text
        createEmptyTicket()
              │
              ▼
          [ open ]
          /      \
   takeCash()    discardTicket()
       │              │
       ▼              ▼
    [ paid ]    [ discarded ]
   (terminal)    (terminal)
```

There is no transition out of `paid` or `discarded` in this phase. Phase 8 (refunds/voids) introduces the additional transitions `paid → partially_refunded`, `paid → refunded`, `paid → void` via its own migration (`ALTER TYPE … ADD VALUE`).

**Invariants checked in SQL**:

- `total_cents = subtotal_cents + tax_cents` always.
- `tax_cents = 0` in v1 (relaxed in tax phase).
- `closed_at` and `closed_by_staff_id` populated together iff the ticket is in a terminal state.
- The resume-or-create query (R8) depends on `tickets_open_by_operator_recent_idx`.

---

## 3. `public.ticket_items`

**Purpose**: a line in the cart. Spec §§ FR-010, FR-011, FR-013, FR-014, FR-015, Key Entities (Ticket item).

```sql
create type public.ticket_item_kind as enum (
  'service'
  -- 'discount' and 'product' are reserved by docs/system-design.md but not added
  -- this phase; future migrations ADD VALUE.
);

create table if not exists public.ticket_items (
  id                   uuid primary key default gen_random_uuid(),
  ticket_id            uuid not null references public.tickets(id) on delete cascade,
  kind                 public.ticket_item_kind not null,
  ref_id               uuid not null references public.services(id),  -- for kind='service'; future kinds may relax
  name_snapshot        text not null,
  unit_price_cents     int not null check (unit_price_cents >= 0),
  qty                  int not null default 1 check (qty > 0),
  assigned_staff_id    uuid not null references public.staff(id),
  price_unconfirmed    boolean not null default false,
  created_at           timestamptz not null default now()
);

alter table public.ticket_items enable row level security;

create policy ticket_items_select_authenticated
  on public.ticket_items for select to authenticated using (true);

-- Index for the "load this ticket's cart" hot path.
create index ticket_items_by_ticket_idx
  on public.ticket_items (ticket_id, created_at);
```

**Snapshot rule** (research.md § R2): `name_snapshot` and `unit_price_cents` are written at the moment of add from the live `services` row. Subsequent edits to that row never propagate.

**`assigned_staff_id`**:

- On insert, populated from the header-picked tech (the action argument).
- Can be later changed via `setLineTech(ticketId, lineId, staffId)` (FR-013). Other lines are unaffected.

**`price_unconfirmed`**:

- Set on insert from `services.variable_price`.
- Never mutated in this phase (FR-016 — the placeholder dialog does not accept input).
- Used by `takeCash` (R1, step 3) to refuse charging while any line is unconfirmed (FR-015).

**Cascade**: `on delete cascade` from `tickets`. In this phase, tickets are never deleted (terminal states are reached by status flip, not by delete), so the cascade is defensive only.

---

## 4. `public.payments`

**Purpose**: a money-in record attached to a ticket. Spec §§ FR-017, FR-018, FR-019, FR-021, Key Entities (Payment).

```sql
create type public.payment_method as enum (
  'cash'
  -- 'square_card', 'square_egift' reserved per docs/system-design.md;
  -- added by the Square phase migration.
);

create type public.payment_kind as enum (
  'payment'
  -- 'refund' reserved; added by the refunds phase migration.
);

create type public.payment_status as enum (
  'succeeded',
  'pending',
  'failed'
  -- 'pending' and 'failed' are listed for forward-compat with Square checkouts;
  -- cash payments are always 'succeeded' in this phase per FR-018.
);

create table if not exists public.payments (
  id                    uuid primary key default gen_random_uuid(),
  ticket_id             uuid not null references public.tickets(id),
  method                public.payment_method not null,
  kind                  public.payment_kind not null,
  amount_cents          int not null check (amount_cents > 0),
  tip_cents             int not null default 0 check (tip_cents = 0),   -- v1 cash: no tip capture (FR-020)
  status                public.payment_status not null,
  processed_at          timestamptz not null default now(),
  taken_by_staff_id     uuid not null references public.staff(id),
  created_at            timestamptz not null default now(),
  constraint payments_cash_status_succeeded chk check (
    method != 'cash' or status = 'succeeded'
  )
);

alter table public.payments enable row level security;

create policy payments_select_authenticated
  on public.payments for select to authenticated using (true);

-- Hot-path index: "all payments for ticket X" (used by receipt render and money-invariant
-- assertion). Also covers the future "list payments by day".
create index payments_by_ticket_idx
  on public.payments (ticket_id, processed_at);
```

**Notes**:

- Square-related columns (`square_payment_id`, `square_terminal_checkout_id`, `square_refund_id`, `raw jsonb`) from the system-design enum are NOT created this phase — they're reserved for the Square phase migration, which can add them via `ALTER TABLE` without a destructive change (cash rows leave them null).
- Refund columns (`refunds_payment_id`, `authorized_by_staff_id`) likewise deferred.
- `tip_cents = 0` is enforced as a v1 cash invariant (FR-020). The refunds phase relaxes it for Square methods.
- `amount_cents > 0` (strictly positive) — there's no "$0 cash sale" path; the Take cash button is disabled when total is 0 (FR per Edge Cases in spec).
- The cash-payment money invariant — `payments.amount_cents = tickets.total_cents` at the moment of charge — is enforced by `pos_take_cash` (R1) rather than by a CHECK constraint, because `total_cents` is mutable on the ticket until charge.

---

## 5. The `pos_take_cash` RPC

Created in the same migration. The function body is the atomic-write shape from research.md § R1:

```sql
create or replace function public.pos_take_cash(
  p_ticket_id   uuid,
  p_operator    uuid                -- acting_as_staff_id at the moment of the action
) returns uuid
language plpgsql
security definer            -- runs as the function owner so RLS does not block writes inside
set search_path = public, pg_temp
as $$
declare
  v_total int;
  v_unconfirmed_count int;
  v_payment_id uuid;
begin
  -- 1) Lock the ticket; refuse if not open.
  perform 1 from public.tickets where id = p_ticket_id and status = 'open' for update;
  if not found then raise exception 'ticket_not_open' using errcode = 'P0001'; end if;

  -- 2) Refuse if any line is unconfirmed (FR-015).
  select count(*) into v_unconfirmed_count
    from public.ticket_items
    where ticket_id = p_ticket_id and price_unconfirmed = true;
  if v_unconfirmed_count > 0 then
    raise exception 'ticket_has_unpriced_items' using errcode = 'P0001';
  end if;

  -- 3) Read the trusted server-side total.
  select total_cents into v_total from public.tickets where id = p_ticket_id;
  if v_total <= 0 then raise exception 'ticket_empty' using errcode = 'P0001'; end if;

  -- 4) Insert the cash payment row.
  insert into public.payments (ticket_id, method, kind, amount_cents, status, taken_by_staff_id)
    values (p_ticket_id, 'cash', 'payment', v_total, 'succeeded', p_operator)
    returning id into v_payment_id;

  -- 5) Flip the ticket to paid.
  update public.tickets
    set status = 'paid', closed_by_staff_id = p_operator, closed_at = now(), updated_at = now()
    where id = p_ticket_id;

  -- 6) Audit (controlled vocab 'payment.captured' — see contracts/audit.contract.md).
  insert into public.audit_log (acting_as_staff_id, action, entity_type, entity_id, payload)
    values (p_operator, 'payment.captured', 'payment', v_payment_id,
            jsonb_build_object('ticket_id', p_ticket_id, 'amount_cents', v_total));

  -- TODO(phase-9): increment open cash_drawer_sessions.expected_cents by v_total.

  return v_payment_id;
end;
$$;

revoke all on function public.pos_take_cash(uuid, uuid) from public;
grant execute on function public.pos_take_cash(uuid, uuid) to service_role;
```

The `service_role`-only grant means only the Server Action (via `lib/db/admin.ts`) can invoke it.

---

## 6. Migration order and reversibility

The full migration file order:

1. `create type … ticket_status / ticket_item_kind / payment_method / payment_kind / payment_status …`
2. `create table appointments (…) + RLS + indexes`
3. `create table tickets (…) + RLS + indexes`
4. `create table ticket_items (…) + RLS + indexes`
5. `create table payments (…) + RLS + indexes`
6. `create or replace function pos_take_cash (…)`
7. `create trigger updated_at_tickets before update on tickets …` (using the helper from `0002`)

The migration is forward-only. Down-migration is not supported in this repo (matches the existing convention from `0001`–`0003`).

---

## 7. Verification against spec

| Spec FR | Where enforced in the model |
|---|---|
| FR-002 / FR-004 (fresh open ticket) | `tickets` default `status='open'`, nullable `appointment_id`. `createEmptyTicket` Server Action inserts with `appointment_id = null`. |
| FR-003 (same-day resume, exclude paid/discarded) | `tickets_open_by_operator_recent_idx` (status='open' partial) + the resume query in research.md § R8. |
| FR-005 (cancel vs discard) | `status='discarded'` enum value + the `closed_consistency` CHECK ensuring `closed_at` is populated. |
| FR-010 (snapshot on add) | `ticket_items.name_snapshot` and `unit_price_cents` are NOT NULL; the action writes both at insert time. |
| FR-011 (per-line remove) | `delete from ticket_items where id = ?` plus a totals recompute in the action. |
| FR-013 (per-line tech override) | `ticket_items.assigned_staff_id` is per-row; `setLineTech` updates only the named row. |
| FR-014 / FR-015 (variable-price gating) | `ticket_items.price_unconfirmed` boolean; `pos_take_cash` refuses while any row has it true. |
| FR-018 (atomic cash) | `pos_take_cash` RPC, single transaction. |
| FR-019 (failure rolls back, no partial state) | A `raise exception` inside the function aborts the implicit `BEGIN…COMMIT` boundary; the Server Action catches the Postgres error and returns it. |
| FR-020 (no cash tip) | `payments.tip_cents = 0` CHECK. |
| FR-022 / FR-023 (confirmation, New sale) | `closed_consistency` CHECK + `closed_at` populated; the client renders DoneScreen from the post-charge state. `createEmptyTicket` re-used for New sale. |
| FR-024 / FR-025 / FR-026 (receipt) | Receipt route reads `tickets` + `ticket_items` + `payments` via RSC; auth gate is the existing studio middleware, not RLS. |
| FR-028 (any signed-in staff) | No additional row-level policy beyond `select-to-authenticated`. |
| SC-004 (payment total = cart total at charge) | Enforced by `pos_take_cash` step 3 reading `tickets.total_cents` inside the locked transaction. |
| SC-008 (discarded → non-resumable, excluded from sales) | `status='discarded'` is filtered out by the resume index's `where status='open'` predicate; any sales-aggregation query in later phases will filter `status='paid'`. |

---

## 8. Out-of-model

- `tip_splits`, `cash_drawer_sessions`, `gift_cards`, `walk_ins`, `clients`, `staff_schedule`, `salon_hours`, `salon_closures`, `settings` — not added in this migration; not referenced by this feature.
- `audit_log` — already exists from `0001_auth_schema.sql`; this migration inserts rows into it via `pos_take_cash` but does not alter its shape.
- `services` and `staff` — read-only references; their existing RLS policies apply.
