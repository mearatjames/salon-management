-- 0026_void_refund.sql
-- Feature 052 — Privileged Action Overrides (Void & Refund)
-- (specs/052-privileged-action-overrides/)
--
-- The new enum values (ticket_status void/refunded/partially_refunded,
-- payment_kind refund) are added in 0025_void_refund_enums.sql — a
-- separate, earlier migration. Postgres forbids using a freshly-added
-- enum value for non-function DML (e.g. the `where kind = 'refund'` index
-- predicate below) in the SAME transaction (enum-add-then-use rule,
-- research D3; SQLSTATE 55P04). Splitting the ALTER TYPEs into 0025 means
-- they are durably committed before this file's transaction runs.
--
-- Schema deltas (data-model.md):
--   - payments gains refunds_payment_id (self-FK) + square_refund_id
--   - two partial indexes (refund-of lookup; unique square_refund_id)
--   - tickets_closed_consistency_chk widened to allow the three new
--     closed outcomes
--
-- Two-phase reversal RPCs (research D4): a *prepare* RPC creates the
-- kind='refund' mirror rows (cash legs land succeeded, card/gift legs
-- land pending) and returns them; the server action fires the Square
-- refunds; ONLY THEN the *finalize* RPC flips card/gift legs to
-- succeeded + square_refund_id, advances the ticket status, and writes
-- the audit row. A Square failure therefore never leaves a half-reversed
-- ticket.
--
-- audit_log impact: two new AuditAction verbs — payment.void_issued /
-- payment.refund_issued (entity_type 'payment' via the payment. prefix
-- dispatch in lib/auth/audit.ts; no dispatch edit needed).

-- ----------------------------------------------------------------------
-- T002 — payments columns, indexes, ticket constraint
-- ----------------------------------------------------------------------

-- payments new columns.
--    refunds_payment_id: on a kind='refund' row, points at the original
--      payment it reverses; NULL on kind='payment' rows.
--    square_refund_id:   Square's refund id, set after refundPayment
--      confirms (card/gift); NULL for cash refunds and originals.
alter table public.payments
  add column if not exists refunds_payment_id uuid references public.payments(id),
  add column if not exists square_refund_id   text;

-- 3. Indexes.
--    Refund-of lookup (the per-payment remaining math joins on this).
create index if not exists payments_refunds_of_idx
  on public.payments (refunds_payment_id)
  where kind = 'refund';

--    A given Square refund id maps to exactly one payments row.
create unique index if not exists payments_unique_square_refund_idx
  on public.payments (square_refund_id)
  where square_refund_id is not null;

-- 4. Widen the closed-consistency constraint to allow the three new
--    closed outcomes (void / refunded / partially_refunded). The
--    original lived in 0004_checkout_cash_sale.sql.
alter table public.tickets drop constraint if exists tickets_closed_consistency_chk;
alter table public.tickets add constraint tickets_closed_consistency_chk check (
     (status = 'open'               and closed_at is null     and closed_by_staff_id is null)
  or (status = 'paid'               and closed_at is not null and closed_by_staff_id is not null)
  or (status = 'discarded'          and closed_at is not null and closed_by_staff_id is not null)
  or (status = 'void'               and closed_at is not null and closed_by_staff_id is not null)
  or (status = 'refunded'           and closed_at is not null and closed_by_staff_id is not null)
  or (status = 'partially_refunded' and closed_at is not null and closed_by_staff_id is not null)
);

-- ----------------------------------------------------------------------
-- T003 — same-day VOID: pos_void_ticket (prepare) + pos_finalize_void
-- ----------------------------------------------------------------------
-- pos_void_ticket: lock the ticket + its succeeded payments FOR UPDATE,
-- refuse with ticket_not_void_eligible unless status='paid' AND closed_at
-- falls on the current salon-local calendar day AND nothing has been
-- reversed yet. Then insert a kind='refund' mirror row for each succeeded
-- payment (cash->succeeded, card/gift->pending), and return the created
-- rows so the action can fire Square refunds for the card/gift legs.
-- DROP first: the return-table shape carries `original_payment_id`, so a
-- CREATE OR REPLACE over a prior definition with a different OUT signature
-- would error ("Row type defined by OUT parameters is different"). Harmless
-- on a fresh DB where the function doesn't exist yet.
drop function if exists public.pos_void_ticket(uuid, uuid);
create or replace function public.pos_void_ticket(
  p_ticket_id uuid,
  p_operator  uuid
) returns table (
  refund_payment_id   uuid,
  original_payment_id uuid,
  method              public.payment_method,
  square_payment_id   text,
  amount_cents        int
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
-- The return-table OUT params (method, square_payment_id, amount_cents)
-- collide with `public.payments` column names inside the INSERT ... RETURNING
-- below. Tell PL/pgSQL to resolve such ambiguities to the COLUMN, not the
-- variable — the only place we read those OUT params is via `return query`,
-- which assigns positionally, so column-preference is safe here.
#variable_conflict use_column
declare
  v_tz            text;
  v_status        public.ticket_status;
  v_closed_at     timestamptz;
  v_today_start   timestamptz;
  v_today_end     timestamptz;
  v_today         date;
  v_reversed_cnt  int;
begin
  -- Resolve the salon timezone (data stored as a JSON string scalar;
  -- `value #>> '{}'` extracts it). Falls back to America/Los_Angeles.
  select coalesce(value #>> '{}', 'America/Los_Angeles')
    into v_tz
    from public.settings
    where key = 'salon.timezone';
  if v_tz is null then
    v_tz := 'America/Los_Angeles';
  end if;

  -- 1) Lock the ticket; read status + closed_at.
  select status, closed_at
    into v_status, v_closed_at
    from public.tickets
    where id = p_ticket_id
    for update;
  if not found then
    raise exception 'ticket_not_void_eligible' using errcode = 'P0001';
  end if;

  -- 2) Lock the ticket's succeeded payment rows so concurrent reversals
  --    serialize. (Acquires row locks; the rows are re-read below.)
  perform 1
    from public.payments
    where ticket_id = p_ticket_id and status = 'succeeded'
    for update;

  -- 3) Eligibility: must be paid, closed today (salon-local), unreversed.
  if v_status <> 'paid' then
    raise exception 'ticket_not_void_eligible' using errcode = 'P0001';
  end if;

  -- Current salon-local calendar day, as UTC bounds.
  v_today       := (now() at time zone v_tz)::date;
  v_today_start := (v_today::timestamp) at time zone v_tz;
  v_today_end   := ((v_today + 1)::timestamp) at time zone v_tz;
  if v_closed_at is null or v_closed_at < v_today_start or v_closed_at >= v_today_end then
    raise exception 'ticket_not_void_eligible' using errcode = 'P0001';
  end if;

  -- Already reversed? (any refund leg on this ticket's payments).
  select count(*)
    into v_reversed_cnt
    from public.payments r
    join public.payments o on o.id = r.refunds_payment_id
    where o.ticket_id = p_ticket_id and r.kind = 'refund';
  if v_reversed_cnt > 0 then
    raise exception 'ticket_not_void_eligible' using errcode = 'P0001';
  end if;

  -- 4) Insert a mirror kind='refund' row per succeeded original payment.
  --    cash -> succeeded immediately; card/gift -> pending until Square
  --    confirms. tip_cents=0; same method as original; positive amount.
  --
  --    The refund row itself never carries the ORIGINAL's `square_payment_id`
  --    (that column stays null on the refund leg), so an INSERT ... RETURNING
  --    can't surface it. We instead RETURNING the new row + its
  --    `refunds_payment_id` (the original id) via a CTE, then join back to the
  --    original payment to expose BOTH the original id and the original's
  --    `square_payment_id` — the latter is what the server action feeds to
  --    Square's refundPayment, and the former is the idempotency-key seed.
  -- The return-table OUT params (method, square_payment_id, amount_cents)
  -- share names with `public.payments` columns, so every output reference
  -- below is aliased to a `r_*` name inside the CTE + final SELECT to keep
  -- PL/pgSQL from flagging "column reference is ambiguous" (SQLSTATE 42702).
  return query
  with inserted as (
    insert into public.payments (
      ticket_id, method, kind, amount_cents, tip_cents, status,
      taken_by_staff_id, refunds_payment_id
    )
    select
      o.ticket_id,
      o.method,
      'refund'::public.payment_kind,
      o.amount_cents,
      0,
      case when o.method = 'cash' then 'succeeded'::public.payment_status
           else 'pending'::public.payment_status end,
      p_operator,
      o.id
    from public.payments o
    where o.ticket_id = p_ticket_id
      and o.kind = 'payment'
      and o.status = 'succeeded'
    returning
      id                 as r_refund_payment_id,
      method             as r_method,
      amount_cents       as r_amount_cents,
      refunds_payment_id as r_original_payment_id
  )
  select
    ins.r_refund_payment_id,
    ins.r_original_payment_id,
    ins.r_method,
    orig.square_payment_id,
    ins.r_amount_cents
  from inserted ins
  join public.payments orig on orig.id = ins.r_original_payment_id;
end;
$$;

revoke all on function public.pos_void_ticket(uuid, uuid) from public;
grant execute on function public.pos_void_ticket(uuid, uuid) to service_role;

-- pos_finalize_void: called after the action confirms the Square refunds.
-- p_refund_results is a JSON array of
--   { "refund_payment_id": "<uuid>", "square_refund_id": "<text|null>" }.
-- Flips the card/gift refund legs -> succeeded + square_refund_id (cash
-- legs are already succeeded), sets the ticket to 'void' + closed_*,
-- and inserts the payment.void_issued audit row.
create or replace function public.pos_finalize_void(
  p_ticket_id      uuid,
  p_refund_results jsonb
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_operator       uuid;
  v_reversed_total int;
  v_refunds        jsonb;
begin
  -- 1) Lock the ticket.
  perform 1 from public.tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'ticket_not_void_eligible' using errcode = 'P0001';
  end if;

  -- 2) Flip each card/gift refund leg -> succeeded + square_refund_id.
  --    (Cash legs were inserted succeeded with NULL square_refund_id.)
  update public.payments p
    set status           = 'succeeded',
        square_refund_id = (res->>'square_refund_id'),
        processed_at     = now()
    from jsonb_array_elements(p_refund_results) as res
    where p.id = (res->>'refund_payment_id')::uuid
      and p.kind = 'refund';

  -- 3) Operator + reversed total, for the audit row + closed_by. All refund
  --    legs for this void share one operator (the staff who initiated the
  --    reversal). `taken_by_staff_id` is a uuid (no `min()` aggregate), so we
  --    read it with a separate single-row scalar select rather than mixing a
  --    bare column with the `sum()` aggregate (which would need a GROUP BY).
  select coalesce(sum(amount_cents), 0)
    into v_reversed_total
    from public.payments
    where refunds_payment_id is not null
      and kind = 'refund'
      and ticket_id = p_ticket_id;

  select taken_by_staff_id
    into v_operator
    from public.payments
    where refunds_payment_id is not null
      and kind = 'refund'
      and ticket_id = p_ticket_id
    limit 1;

  -- 4) Set the ticket to void + closed_*.
  update public.tickets
    set status             = 'void',
        closed_by_staff_id = v_operator,
        closed_at          = now(),
        updated_at         = now()
    where id = p_ticket_id;

  -- 5) Audit. payload per contracts/audit.contract.md — entity_id is the
  --    voided ticket; refunds[] mirrors each original->refund leg.
  select jsonb_agg(
           jsonb_build_object(
             'payment_id',        r.refunds_payment_id,
             'refund_payment_id', r.id,
             'method',            r.method,
             'amount_cents',      r.amount_cents
           )
         )
    into v_refunds
    from public.payments r
    where r.ticket_id = p_ticket_id and r.kind = 'refund';

  insert into public.audit_log (acting_as_staff_id, action, entity_type, entity_id, payload)
    values (
      v_operator,
      'payment.void_issued',
      'payment',
      p_ticket_id,
      jsonb_build_object(
        'ticket_id',            p_ticket_id,
        'reversed_total_cents', v_reversed_total,
        'refunds',              coalesce(v_refunds, '[]'::jsonb)
      )
    );
end;
$$;

revoke all on function public.pos_finalize_void(uuid, jsonb) from public;
grant execute on function public.pos_finalize_void(uuid, jsonb) to service_role;

-- ----------------------------------------------------------------------
-- T004 — partial/full REFUND: pos_refund_payments (prepare) +
--         pos_finalize_refund
-- ----------------------------------------------------------------------
-- pos_refund_payments: lock the ticket + payments. p_lines is a JSON
-- array of { "originalPaymentId": "<uuid>", "amountCents": <int> }. For
-- each line: assert the original belongs to the ticket and is
-- kind='payment' status='succeeded'; assert amountCents <= remaining
-- (Σ original − Σ succeeded refunds, under lock) else
-- refund_exceeds_remaining; assert the running total > 0. Insert a
-- kind='refund' row per line (cash->succeeded, card/gift->pending) and
-- return the created rows.
create or replace function public.pos_refund_payments(
  p_ticket_id uuid,
  p_operator  uuid,
  p_lines     jsonb
) returns table (
  refund_payment_id   uuid,
  original_payment_id uuid,
  method              public.payment_method,
  square_payment_id   text,
  amount_cents        int
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
-- The return-table OUT params (method, square_payment_id, amount_cents)
-- collide with `public.payments` column names. Tell PL/pgSQL to resolve
-- such ambiguities to the COLUMN — the OUT params are only ever assigned
-- via the explicit `refund_payment_id := …` lines below (assignment targets,
-- which PL/pgSQL resolves to the OUT variables regardless of this setting),
-- never read inside a SQL statement, so column-preference is safe and
-- silences SQLSTATE 42702 in the `select … into` + `insert … returning`.
#variable_conflict use_column
declare
  v_line        jsonb;
  v_orig_id     uuid;
  v_amount      int;
  v_orig_method public.payment_method;
  v_orig_amount int;
  v_orig_status public.payment_status;
  v_orig_kind   public.payment_kind;
  v_orig_ticket uuid;
  v_orig_sqpay  text;
  v_refunded    int;
  v_remaining   int;
  v_total       int := 0;
  v_new_id      uuid;
  v_new_status  public.payment_status;
begin
  -- 1) Lock the ticket.
  perform 1 from public.tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'payment_not_on_ticket' using errcode = 'P0001';
  end if;

  -- 2) Lock every payment row on the ticket so concurrent reversals
  --    serialize and the remaining math is consistent.
  perform 1 from public.payments where ticket_id = p_ticket_id for update;

  -- 3) Process each requested line.
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_orig_id := (v_line->>'originalPaymentId')::uuid;
    v_amount  := (v_line->>'amountCents')::int;

    -- 3a) Original must belong to the ticket, be an original payment, and
    --     be succeeded.
    select pmt.method, pmt.amount_cents, pmt.status, pmt.kind, pmt.ticket_id, pmt.square_payment_id
      into v_orig_method, v_orig_amount, v_orig_status, v_orig_kind, v_orig_ticket, v_orig_sqpay
      from public.payments pmt
      where pmt.id = v_orig_id;
    if not found
       or v_orig_ticket <> p_ticket_id
       or v_orig_kind <> 'payment'
       or v_orig_status <> 'succeeded'
    then
      raise exception 'payment_not_on_ticket' using errcode = 'P0001';
    end if;

    -- 3b) Remaining = original amount − Σ succeeded refunds of it.
    select coalesce(sum(pmt.amount_cents), 0)
      into v_refunded
      from public.payments pmt
      where pmt.refunds_payment_id = v_orig_id
        and pmt.kind = 'refund'
        and pmt.status = 'succeeded';
    v_remaining := v_orig_amount - v_refunded;

    if v_amount <= 0 or v_amount > v_remaining then
      raise exception 'refund_exceeds_remaining' using errcode = 'P0001';
    end if;

    v_total := v_total + v_amount;

    -- 3c) Insert the kind='refund' row (cash->succeeded, card/gift->pending).
    v_new_status := case when v_orig_method = 'cash'
                         then 'succeeded'::public.payment_status
                         else 'pending'::public.payment_status end;

    insert into public.payments (
      ticket_id, method, kind, amount_cents, tip_cents, status,
      taken_by_staff_id, refunds_payment_id
    )
    values (
      p_ticket_id, v_orig_method, 'refund', v_amount, 0, v_new_status,
      p_operator, v_orig_id
    )
    returning id into v_new_id;

    refund_payment_id   := v_new_id;
    original_payment_id := v_orig_id;
    method              := v_orig_method;
    square_payment_id   := v_orig_sqpay;
    amount_cents        := v_amount;
    return next;
  end loop;

  -- 4) Total must be positive.
  if v_total <= 0 then
    raise exception 'refund_exceeds_remaining' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.pos_refund_payments(uuid, uuid, jsonb) from public;
grant execute on function public.pos_refund_payments(uuid, uuid, jsonb) to service_role;

-- pos_finalize_refund: called after the action confirms the Square
-- refunds. p_refund_results is a JSON array of
--   { "refund_payment_id": "<uuid>", "square_refund_id": "<text|null>",
--     "original_payment_id": "<uuid>", "method": "<text>",
--     "amount_cents": <int> }.
-- Flips card/gift refund legs -> succeeded + square_refund_id, recomputes
-- the ticket status (refunded iff Σ succeeded refunds = Σ succeeded
-- original payments, else partially_refunded), sets closed_* on the first
-- reversal, and inserts the payment.refund_issued audit row.
create or replace function public.pos_finalize_refund(
  p_ticket_id      uuid,
  p_refund_results jsonb
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_operator         uuid;
  v_orig_sum         int;
  v_refund_sum       int;
  v_refunded_cents   int;
  v_new_status       public.ticket_status;
  v_was_closed       boolean;
  v_lines            jsonb;
begin
  -- 1) Lock the ticket.
  perform 1 from public.tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'payment_not_on_ticket' using errcode = 'P0001';
  end if;

  -- 2) Flip card/gift refund legs -> succeeded + square_refund_id.
  update public.payments p
    set status           = 'succeeded',
        square_refund_id = (res->>'square_refund_id'),
        processed_at     = now()
    from jsonb_array_elements(p_refund_results) as res
    where p.id = (res->>'refund_payment_id')::uuid
      and p.kind = 'refund';

  -- 3) Recompute ticket status from succeeded sums.
  select coalesce(sum(amount_cents), 0)
    into v_orig_sum
    from public.payments
    where ticket_id = p_ticket_id and kind = 'payment' and status = 'succeeded';

  select coalesce(sum(amount_cents), 0)
    into v_refund_sum
    from public.payments
    where ticket_id = p_ticket_id and kind = 'refund' and status = 'succeeded';

  if v_refund_sum >= v_orig_sum then
    v_new_status := 'refunded';
  else
    v_new_status := 'partially_refunded';
  end if;

  -- 4) Operator from this finalize's refund legs (the rows just settled).
  select taken_by_staff_id
    into v_operator
    from public.payments
    where id = ((p_refund_results->0)->>'refund_payment_id')::uuid;

  -- 5) Set status; set closed_* on the first reversal (when the ticket is
  --    still 'paid'). closed_* is left intact on subsequent partials.
  select (status = 'paid') into v_was_closed
    from public.tickets where id = p_ticket_id;

  if v_was_closed then
    update public.tickets
      set status             = v_new_status,
          closed_by_staff_id = v_operator,
          closed_at          = now(),
          updated_at         = now()
      where id = p_ticket_id;
  else
    update public.tickets
      set status     = v_new_status,
          updated_at = now()
      where id = p_ticket_id;
  end if;

  -- 6) Audit (payment.refund_issued). refunded_cents is the amount settled
  --    in THIS call; lines[] mirror each original->refund leg from the
  --    finalize payload.
  select coalesce(sum((res->>'amount_cents')::int), 0)
    into v_refunded_cents
    from jsonb_array_elements(p_refund_results) as res;

  select jsonb_agg(
           jsonb_build_object(
             'original_payment_id', res->>'original_payment_id',
             'refund_payment_id',   res->>'refund_payment_id',
             'method',              res->>'method',
             'amount_cents',        (res->>'amount_cents')::int
           )
         )
    into v_lines
    from jsonb_array_elements(p_refund_results) as res;

  insert into public.audit_log (acting_as_staff_id, action, entity_type, entity_id, payload)
    values (
      v_operator,
      'payment.refund_issued',
      'payment',
      p_ticket_id,
      jsonb_build_object(
        'ticket_id',        p_ticket_id,
        'resulting_status', v_new_status,
        'refunded_cents',   v_refunded_cents,
        'lines',            coalesce(v_lines, '[]'::jsonb)
      )
    );
end;
$$;

revoke all on function public.pos_finalize_refund(uuid, jsonb) from public;
grant execute on function public.pos_finalize_refund(uuid, jsonb) to service_role;
