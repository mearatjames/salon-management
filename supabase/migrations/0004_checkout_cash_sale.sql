-- Migration: 0004_checkout_cash_sale.sql
-- Feature: 011-cash-sale-checkout
--
-- Creates the four POS-side tables for the phase-1 cash-sale flow plus the
-- atomic `pos_take_cash` RPC that turns an open ticket into a paid one.
--
-- Shapes follow `docs/system-design.md` § Data model verbatim, with one
-- extension (the `'discarded'` ticket status — see plan.md § Complexity
-- Tracking) and a single in-phase enum scope: only the values actually
-- exercised by this feature are added. Later phases ALTER TYPE ADD VALUE
-- as they need them.
--
-- RLS: every new table gets exactly ONE policy — `select to authenticated
-- using (true)`. There are no insert/update/delete policies; all writes go
-- through the service-role client (`lib/db/admin.ts`).
--
-- audit_log: untouched. Rows are inserted into it from inside `pos_take_cash`
-- using its existing shape (`actor_user_id` nullable, `acting_as_staff_id`,
-- `action`, `entity_type`, `entity_id`, `payload`). The controlled vocabulary
-- lives in the TS `AuditAction` union in `lib/auth/audit.ts`.

-- ----------------------------------------------------------------------
-- 1. appointments  (schema only — no UI, no seed, no queries this phase)
-- ----------------------------------------------------------------------
-- Exists to satisfy `tickets.appointment_id`'s FK target so the future
-- appointments feature can land without a destructive migration. `client_id`
-- is intentionally NOT yet wrapped in a FK because `public.clients` does
-- not exist yet; the column stays `not null` so the FK can be added later
-- without a backfill.
create table if not exists public.appointments (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null,
  staff_id              uuid not null references public.staff(id),
  start_at              timestamptz not null,
  end_at                timestamptz not null,
  status                text not null check (
                          status in ('booked','checked_in','in_service','completed','cancelled','no_show')
                        ),
  source                text not null check (source in ('booked','walk_in')),
  notes                 text,
  created_by_user_id    uuid,
  created_by_staff_id   uuid references public.staff(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint appointments_end_after_start_chk check (end_at > start_at)
);

alter table public.appointments enable row level security;

drop policy if exists appointments_select_authenticated on public.appointments;
create policy appointments_select_authenticated
  on public.appointments for select to authenticated using (true);

-- ----------------------------------------------------------------------
-- 2. tickets
-- ----------------------------------------------------------------------
create type public.ticket_status as enum (
  'open',
  'paid',
  'discarded'
);

create table if not exists public.tickets (
  id                    uuid primary key default gen_random_uuid(),
  appointment_id        uuid references public.appointments(id),
  status                public.ticket_status not null default 'open',
  subtotal_cents        int not null default 0 check (subtotal_cents >= 0),
  tax_cents             int not null default 0 check (tax_cents = 0),
  total_cents           int not null default 0 check (total_cents >= 0),
  opened_by_staff_id    uuid not null references public.staff(id),
  closed_by_staff_id    uuid references public.staff(id),
  closed_at             timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint tickets_total_matches_subtotal_chk
    check (total_cents = subtotal_cents + tax_cents),
  constraint tickets_closed_consistency_chk check (
    (status = 'open'        and closed_at is null     and closed_by_staff_id is null)
    or (status = 'paid'      and closed_at is not null and closed_by_staff_id is not null)
    or (status = 'discarded' and closed_at is not null and closed_by_staff_id is not null)
  )
);

alter table public.tickets enable row level security;

drop policy if exists tickets_select_authenticated on public.tickets;
create policy tickets_select_authenticated
  on public.tickets for select to authenticated using (true);

-- Resume-or-create hot path (FR-003): operator + status + recency.
create index if not exists tickets_open_by_operator_recent_idx
  on public.tickets (opened_by_staff_id, updated_at desc)
  where status = 'open';

-- Generic status filter (powers any "list paid tickets today" later).
create index if not exists tickets_status_created_at_idx
  on public.tickets (status, created_at desc);

-- updated_at trigger — per-table function, matching the convention from
-- 0003_services_catalog.sql (no shared helper exists in this repo).
create or replace function public.tickets_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tickets_set_updated_at_trg on public.tickets;
create trigger tickets_set_updated_at_trg
  before update on public.tickets
  for each row execute function public.tickets_set_updated_at();

-- ----------------------------------------------------------------------
-- 3. ticket_items
-- ----------------------------------------------------------------------
create type public.ticket_item_kind as enum (
  'service'
);

create table if not exists public.ticket_items (
  id                   uuid primary key default gen_random_uuid(),
  ticket_id            uuid not null references public.tickets(id) on delete cascade,
  kind                 public.ticket_item_kind not null,
  ref_id               uuid not null references public.services(id),
  name_snapshot        text not null,
  unit_price_cents     int not null check (unit_price_cents >= 0),
  qty                  int not null default 1 check (qty > 0),
  assigned_staff_id    uuid not null references public.staff(id),
  price_unconfirmed    boolean not null default false,
  created_at           timestamptz not null default now()
);

alter table public.ticket_items enable row level security;

drop policy if exists ticket_items_select_authenticated on public.ticket_items;
create policy ticket_items_select_authenticated
  on public.ticket_items for select to authenticated using (true);

-- "Load this ticket's cart" hot path.
create index if not exists ticket_items_by_ticket_idx
  on public.ticket_items (ticket_id, created_at);

-- ----------------------------------------------------------------------
-- 4. payments
-- ----------------------------------------------------------------------
create type public.payment_method as enum (
  'cash'
);

create type public.payment_kind as enum (
  'payment'
);

create type public.payment_status as enum (
  'succeeded',
  'pending',
  'failed'
);

create table if not exists public.payments (
  id                    uuid primary key default gen_random_uuid(),
  ticket_id             uuid not null references public.tickets(id),
  method                public.payment_method not null,
  kind                  public.payment_kind not null,
  amount_cents          int not null check (amount_cents > 0),
  tip_cents             int not null default 0 check (tip_cents = 0),
  status                public.payment_status not null,
  processed_at          timestamptz not null default now(),
  taken_by_staff_id     uuid not null references public.staff(id),
  created_at            timestamptz not null default now(),
  constraint payments_cash_status_succeeded_chk
    check (method != 'cash' or status = 'succeeded')
);

alter table public.payments enable row level security;

drop policy if exists payments_select_authenticated on public.payments;
create policy payments_select_authenticated
  on public.payments for select to authenticated using (true);

-- "All payments for ticket X" — used by receipt render and money-invariant
-- assertions.
create index if not exists payments_by_ticket_idx
  on public.payments (ticket_id, processed_at);

-- ----------------------------------------------------------------------
-- 5. pos_take_cash RPC — the atomic cash-payment writer.
-- ----------------------------------------------------------------------
-- Steps (research.md § R1):
--   1) lock the ticket row; refuse if not open
--   2) refuse if any line is unconfirmed (FR-015)
--   3) read the trusted server-side total; refuse if <= 0
--   4) insert the cash payment row (status='succeeded')
--   5) flip the ticket to 'paid' with closed_by_staff_id + closed_at
--   6) audit ('payment.captured') in the same transaction
--
-- security definer so RLS does not block the writes; service_role-only grant
-- below keeps it invocable only by the Server Action (via lib/db/admin.ts).
create or replace function public.pos_take_cash(
  p_ticket_id uuid,
  p_operator  uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_total int;
  v_unconfirmed_count int;
  v_payment_id uuid;
begin
  -- 1) Lock the ticket; refuse if not open.
  perform 1 from public.tickets where id = p_ticket_id and status = 'open' for update;
  if not found then
    raise exception 'ticket_not_open' using errcode = 'P0001';
  end if;

  -- 2) Refuse if any line is unconfirmed (FR-015).
  select count(*) into v_unconfirmed_count
    from public.ticket_items
    where ticket_id = p_ticket_id and price_unconfirmed = true;
  if v_unconfirmed_count > 0 then
    raise exception 'ticket_has_unpriced_items' using errcode = 'P0001';
  end if;

  -- 3) Read the trusted server-side total.
  select total_cents into v_total from public.tickets where id = p_ticket_id;
  if v_total <= 0 then
    raise exception 'ticket_empty' using errcode = 'P0001';
  end if;

  -- 4) Insert the cash payment row.
  insert into public.payments (ticket_id, method, kind, amount_cents, status, taken_by_staff_id)
    values (p_ticket_id, 'cash', 'payment', v_total, 'succeeded', p_operator)
    returning id into v_payment_id;

  -- 5) Flip the ticket to paid.
  update public.tickets
    set status = 'paid',
        closed_by_staff_id = p_operator,
        closed_at = now(),
        updated_at = now()
    where id = p_ticket_id;

  -- 6) Audit ('payment.captured' — controlled vocab in lib/auth/audit.ts).
  insert into public.audit_log (acting_as_staff_id, action, entity_type, entity_id, payload)
    values (p_operator, 'payment.captured', 'payment', v_payment_id,
            jsonb_build_object('ticket_id', p_ticket_id, 'amount_cents', v_total));

  -- TODO(phase-9): increment open cash_drawer_sessions.expected_cents by v_total.

  return v_payment_id;
end;
$$;

revoke all on function public.pos_take_cash(uuid, uuid) from public;
grant execute on function public.pos_take_cash(uuid, uuid) to service_role;
