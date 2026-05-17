-- Migration: 0014_end_of_day_cash.sql
-- Feature: 019-end-of-day-cash
--
-- Creates the `cash_drawer_sessions` table plus the atomic
-- `pos_close_cash_drawer` RPC. The cash-drawer concept is intentionally
-- LAZY-OPEN per research.md R1: there is never an explicit "open the
-- drawer" UI; the first close of the day inserts the row and immediately
-- closes it. The partial unique index `cash_drawer_sessions_one_open_idx`
-- enforces "at most one open row across the whole table" so a future
-- open-on-first-cash flow can be added without touching this schema.
--
-- RLS: one `select to authenticated using (true)` policy; no
-- insert/update/delete policies. All writes go through the SECURITY
-- DEFINER RPC invoked from the service-role client.
--
-- audit_log: untouched. The RPC inserts a `cash_drawer.closed` row into
-- the existing audit_log shape, matching the AuditAction vocabulary in
-- lib/auth/audit.ts.

-- ----------------------------------------------------------------------
-- 1. cash_drawer_sessions
-- ----------------------------------------------------------------------
create table if not exists public.cash_drawer_sessions (
  id                    uuid primary key default gen_random_uuid(),
  opened_at             timestamptz not null default now(),
  opened_by_staff_id    uuid not null references public.staff(id),
  opening_cents         int not null default 0
                        check (opening_cents >= 0),
  closed_at             timestamptz,
  closed_by_staff_id    uuid references public.staff(id),
  expected_cents        int
                        check (expected_cents is null or expected_cents >= 0),
  counted_cents         int
                        check (counted_cents is null or counted_cents >= 0),
  variance_cents        int,
  notes                 text,
  business_day          date not null,
  created_at            timestamptz not null default now(),

  constraint cash_drawer_close_consistency_chk check (
    (closed_at is null and closed_by_staff_id is null and counted_cents is null and variance_cents is null)
    or
    (closed_at is not null and closed_by_staff_id is not null and expected_cents is not null
        and counted_cents is not null
        and variance_cents = counted_cents - (opening_cents + expected_cents))
  ),

  constraint cash_drawer_notes_required_when_variance_chk check (
    closed_at is null or variance_cents = 0
    or (notes is not null and length(btrim(notes)) > 0)
  )
);

alter table public.cash_drawer_sessions enable row level security;

drop policy if exists cash_drawer_sessions_select_all on public.cash_drawer_sessions;
create policy cash_drawer_sessions_select_all
  on public.cash_drawer_sessions for select to authenticated using (true);

-- At-most-one-open-session invariant (research.md R1). The partial unique
-- index keys on a constant expression so it permits many closed rows but
-- only one row where closed_at is null. The expression must be wrapped in
-- parentheses to satisfy `create unique index` syntax.
create unique index if not exists cash_drawer_sessions_one_open_idx
  on public.cash_drawer_sessions ((true))
  where closed_at is null;

-- "Show me today's row" hot path used by the page-load query.
create index if not exists cash_drawer_sessions_business_day_idx
  on public.cash_drawer_sessions (business_day desc);

-- ----------------------------------------------------------------------
-- 2. pos_close_cash_drawer RPC — atomic close-out writer.
-- ----------------------------------------------------------------------
-- Steps (contracts/rpc-pos-close-cash-drawer.md):
--   1) lazy-open: insert a session row for the business day if none open
--   2) lock the (latest) session for this business day; refuse if closed
--   3) re-derive expected_cents from payments inside the salon-local day
--      window (payments are server-authoritative; never trust the client)
--   4) stale-data check: if recomputed != p_expected_cents, raise
--   5) compute variance; require a non-empty note when variance != 0
--   6) write the close (sets closed_at + closed_by + counted/variance/notes)
--   7) write a `cash_drawer.closed` audit row in the same transaction
--
-- security definer so RLS does not block the writes; the service_role-only
-- grant below ensures only the Server Action (via lib/db/admin.ts) can
-- invoke it.
create or replace function public.pos_close_cash_drawer(
  p_counted_cents  int,
  p_expected_cents int,
  p_notes          text,
  p_operator       uuid,
  p_device_user_id uuid,
  p_business_day   date
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tz text;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_session_id uuid;
  v_opening int;
  v_closed_at timestamptz;
  v_recomputed_expected int;
  v_variance int;
  v_trimmed_notes text;
begin
  -- 0) Resolve the salon's timezone. Stored as a JSON string via
  --    to_jsonb(text), so `value #>> '{}'` extracts the scalar.
  --    Falls back to America/Los_Angeles per FR-008 if the row is missing.
  select coalesce(value #>> '{}', 'America/Los_Angeles')
    into v_tz
    from public.settings
    where key = 'salon.timezone';
  if v_tz is null then
    v_tz := 'America/Los_Angeles';
  end if;

  -- Compute the UTC bounds of the salon-local business day. The
  -- `at time zone` operator on a `timestamp` interprets it as wall time
  -- in v_tz and returns the corresponding `timestamptz`.
  v_day_start := (p_business_day::timestamp) at time zone v_tz;
  v_day_end   := ((p_business_day + 1)::timestamp) at time zone v_tz;

  -- 1) Lazy open. If no row exists for this business day, insert one
  --    (which then becomes the open row guarded by the partial unique
  --    index). ON CONFLICT DO NOTHING because the partial unique index
  --    will reject a second open row.
  insert into public.cash_drawer_sessions (opened_by_staff_id, business_day)
    select p_operator, p_business_day
    where not exists (
      select 1 from public.cash_drawer_sessions
      where business_day = p_business_day
    );

  -- 2) Lock the latest session row for this business day (newest first,
  --    so a re-open-after-close future flow would target the freshest
  --    row). Refuse if it's already closed.
  select id, opening_cents, closed_at
    into v_session_id, v_opening, v_closed_at
    from public.cash_drawer_sessions
    where business_day = p_business_day
    order by opened_at desc
    limit 1
    for update;

  if v_session_id is null then
    raise exception 'cash_drawer_session_missing' using errcode = 'P0001';
  end if;

  if v_closed_at is not null then
    raise exception 'cash_drawer_already_closed' using errcode = 'P0001';
  end if;

  -- 3) Re-derive the expected cents from payments inside the local-day
  --    window. Refunds (kind='refund' — synthetic for now; payment_kind
  --    only has 'payment' today) subtract; everything else adds.
  select coalesce(
           sum(
             case when kind::text = 'refund'
                  then -amount_cents
                  else amount_cents
             end
           ),
           0
         )
    into v_recomputed_expected
    from public.payments
    where method = 'cash'
      and status = 'succeeded'
      and processed_at >= v_day_start
      and processed_at <  v_day_end;

  -- 4) Stale-data guard: if the page-load expected drifted from the now-
  --    recomputed expected, refuse so the operator recounts.
  if v_recomputed_expected != p_expected_cents then
    raise exception 'cash_drawer_expected_changed' using errcode = 'P0001';
  end if;

  -- 5) Variance + note rule. variance = counted - (opening + expected).
  --    Any non-zero variance requires a non-empty trimmed note.
  v_variance := p_counted_cents - (v_opening + v_recomputed_expected);
  v_trimmed_notes := nullif(btrim(p_notes), '');

  if v_variance != 0 and v_trimmed_notes is null then
    raise exception 'cash_drawer_note_required' using errcode = 'P0001';
  end if;

  -- 6) Write the close.
  update public.cash_drawer_sessions
    set closed_at         = now(),
        closed_by_staff_id = p_operator,
        expected_cents    = v_recomputed_expected,
        counted_cents     = p_counted_cents,
        variance_cents    = v_variance,
        notes             = v_trimmed_notes
    where id = v_session_id;

  -- 7) Audit. Same transaction as the update, so the row only exists if
  --    the close persisted. `actor_user_id` is the device account;
  --    `acting_as_staff_id` is the operator (the staff doing the close).
  insert into public.audit_log
    (action, actor_user_id, acting_as_staff_id, entity_type, entity_id, payload)
    values (
      'cash_drawer.closed',
      p_device_user_id,
      p_operator,
      'cash_drawer',
      v_session_id,
      jsonb_build_object(
        'expected_cents', v_recomputed_expected,
        'counted_cents',  p_counted_cents,
        'variance_cents', v_variance,
        'notes',          v_trimmed_notes,
        'session_id',     v_session_id
      )
    );

  return v_session_id;
end;
$$;

revoke all on function public.pos_close_cash_drawer(int, int, text, uuid, uuid, date) from public;
grant execute on function public.pos_close_cash_drawer(int, int, text, uuid, uuid, date) to service_role;
