-- Migration: 0015_cash_drawer_edits.sql
-- Feature: 020-past-cash-counts
--
-- Adds the post-close edit affordance for `cash_drawer_sessions`. Two
-- changes:
--
--   1. New nullable `updated_at timestamptz` column. NULL on every row
--      created or closed before this migration; set by the edit RPC on
--      each successful update. No DEFAULT and no trigger — we only want
--      to advance the timestamp when an edit actually fires (the
--      detail-view's "Last edited at" surface reads it as-is; absence
--      means "never edited", which matches the audit_log truth).
--
--   2. New `pos_edit_cash_drawer(uuid, int, text, uuid, uuid)` SECURITY
--      DEFINER RPC. Locks the session row, refuses if the session is not
--      yet closed, recomputes variance from `counted - (opening +
--      expected)` (expected is frozen at close time per feature 019, so
--      we do NOT re-derive from payments here), re-asserts the
--      note-required-when-variance rule, updates the row, and writes a
--      `cash_drawer.edited` audit row in the same transaction with full
--      before/after counted/variance/notes payload.
--
-- Concurrency (research R5): the RPC ALWAYS writes an audit_log row,
-- even for no-op edits. The forensic trail is the authority — we do not
-- short-circuit on equality.
--
-- Grants mirror the close RPC: revoked from public, executable only by
-- service_role (Server Action layer uses the service-role client).

-- ----------------------------------------------------------------------
-- 1. updated_at column
-- ----------------------------------------------------------------------
alter table public.cash_drawer_sessions
  add column if not exists updated_at timestamptz;

-- ----------------------------------------------------------------------
-- 2. pos_edit_cash_drawer RPC — atomic edit writer.
-- ----------------------------------------------------------------------
-- Steps (contracts/rpc-pos-edit-cash-drawer.md):
--   1) lock the session row by id (SELECT … FOR UPDATE); raise
--      `cash_drawer_session_missing` if absent; raise
--      `cash_drawer_session_not_closed` if `closed_at IS NULL`.
--   2) recompute variance: counted - (opening + expected). Expected is
--      frozen at close time (feature 019) so we do NOT re-derive it
--      from payments here.
--   3) trim notes; nullif("") so blank-only strings collapse to NULL.
--   4) enforce note-required rule: any non-zero variance requires a
--      non-empty trimmed note → `cash_drawer_note_required`.
--   5) UPDATE counted_cents, variance_cents, notes, updated_at = now().
--   6) INSERT `cash_drawer.edited` audit row with before/after blocks.
--   7) RETURN session id.
create or replace function public.pos_edit_cash_drawer(
  p_session_id     uuid,
  p_counted_cents  int,
  p_notes          text,
  p_operator       uuid,
  p_device_user_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id               uuid;
  v_opening          int;
  v_expected         int;
  v_before_counted   int;
  v_before_variance  int;
  v_before_notes     text;
  v_closed_at        timestamptz;
  v_new_variance     int;
  v_trimmed_notes    text;
begin
  -- 1) Lock the session row for the duration of this transaction so two
  --    concurrent edits serialize cleanly.
  select id,
         opening_cents,
         expected_cents,
         counted_cents,
         variance_cents,
         notes,
         closed_at
    into v_id,
         v_opening,
         v_expected,
         v_before_counted,
         v_before_variance,
         v_before_notes,
         v_closed_at
    from public.cash_drawer_sessions
    where id = p_session_id
    for update;

  if v_id is null then
    raise exception 'cash_drawer_session_missing' using errcode = 'P0001';
  end if;

  if v_closed_at is null then
    raise exception 'cash_drawer_session_not_closed' using errcode = 'P0001';
  end if;

  -- 2) Recompute variance from the frozen opening + expected.
  v_new_variance := p_counted_cents - (v_opening + v_expected);

  -- 3) Trim notes — blank-only collapses to NULL.
  v_trimmed_notes := nullif(btrim(p_notes), '');

  -- 4) Note-required-when-variance rule (mirrors feature 019).
  if v_new_variance != 0 and v_trimmed_notes is null then
    raise exception 'cash_drawer_note_required' using errcode = 'P0001';
  end if;

  -- 5) Persist the edit. updated_at advances on every successful edit;
  --    no trigger — this is the only writer.
  update public.cash_drawer_sessions
    set counted_cents  = p_counted_cents,
        variance_cents = v_new_variance,
        notes          = v_trimmed_notes,
        updated_at     = now()
    where id = p_session_id;

  -- 6) Audit. Same transaction as the update — the row only exists if
  --    the edit persisted. before/after payload mirrors the prior values
  --    + the new values so the change-history surface can render both
  --    blocks without a second query.
  insert into public.audit_log
    (action, actor_user_id, acting_as_staff_id, entity_type, entity_id, payload)
    values (
      'cash_drawer.edited',
      p_device_user_id,
      p_operator,
      'cash_drawer',
      p_session_id,
      jsonb_build_object(
        'before', jsonb_build_object(
          'counted_cents',  v_before_counted,
          'variance_cents', v_before_variance,
          'notes',          v_before_notes
        ),
        'after',  jsonb_build_object(
          'counted_cents',  p_counted_cents,
          'variance_cents', v_new_variance,
          'notes',          v_trimmed_notes
        ),
        'session_id', p_session_id
      )
    );

  return p_session_id;
end;
$$;

revoke all on function public.pos_edit_cash_drawer(uuid, int, text, uuid, uuid) from public;
grant execute on function public.pos_edit_cash_drawer(uuid, int, text, uuid, uuid) to service_role;
