# Phase 1 — Data Model: Checkout — Cart Polish

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Research**: [research.md](./research.md)

This document specifies the schema deltas applied by `supabase/migrations/0005_cart_polish.sql` — three column extensions plus one CHECK on `ticket_items`, one column extension on `services`, one new `settings` table, and a `CREATE OR REPLACE` on the existing `pos_take_cash` RPC (no behavioral change; the re-emit keeps grants/permissions stable across the migration set).

The migration is forward-only. Down-migration is not supported in this repo (matches the convention from `0001`–`0004`).

---

## 0. Entity overview (deltas only)

```text
                         ┌──────────────┐
                         │  settings    │   NEW — key/jsonb-value table
                         └──────────────┘

services ─── + presets jsonb (nullable)
   ▲
   │ ref_id (was NOT NULL; now NULL for kind='discount')
   │
ticket_items ─── + kind enum value 'discount'
                + discount_pct numeric(5,2) NULL
                + note text NULL (max 80)
                  ref_id and assigned_staff_id relaxed to NULL
                  CHECK ticket_items_kind_columns_chk
   │
   │ ticket_id (NN, unchanged)
   ▼
 tickets (unchanged)
   │
   │ ticket_id (NN, unchanged)
   ▼
 payments (unchanged)

pos_take_cash(uuid, uuid) — CREATE OR REPLACE; body identical to 0004
```

`audit_log` is unchanged at the schema layer — the new verbs (`line.price_set`, `discount.added`, `discount.removed`, `bill.emailed`) live in the TypeScript `AuditAction` union (see contracts/audit.contract.md and research.md § R17).

---

## 1. `public.ticket_items` (extended)

### Enum extension

```sql
alter type public.ticket_item_kind add value 'discount';
```

Postgres requires the `ALTER TYPE … ADD VALUE` to commit before any DDL that references the new value. The migration places this statement at the very top of the file, and the dependent CHECK constraint and seed data are added later in the same migration (Postgres reads new enum values immediately after commit; running everything in a single `psql` invocation is safe).

### Column additions

```sql
alter table public.ticket_items
  add column discount_pct numeric(5,2) null,
  add column note text null;
```

- `discount_pct numeric(5,2)` — holds the percent for percent-shape discount lines (e.g., `15.00` for 15%). NUMERIC rather than INT keeps the door open for fractional percents in a later phase without a type-widening migration; for v1, the UI enforces whole-percent input (FR-015's AS-3 example, "15") and the action-layer schema accepts integers 1–100.
- `note text` — optional operator-entered reason for a discount line (FR-016a). Max 80 chars enforced by a CHECK below.

### Column relaxations

```sql
alter table public.ticket_items
  alter column ref_id           drop not null,
  alter column assigned_staff_id drop not null;
```

Per spec clarification: service lines keep both required; discount lines have both NULL.

### CHECK constraints

```sql
-- 1) Note length (only material for discount rows but applied uniformly).
alter table public.ticket_items
  add constraint ticket_items_note_length_chk
  check (note is null or length(note) <= 80);

-- 2) Kind-conditional column shape.
alter table public.ticket_items
  add constraint ticket_items_kind_columns_chk
  check (
    (kind = 'service'
      and ref_id is not null
      and assigned_staff_id is not null
      and discount_pct is null)
    or
    (kind = 'discount'
      and ref_id is null
      and assigned_staff_id is null)
  );
```

The kind-conditional CHECK is the load-bearing invariant for this migration:

- A service row MUST carry both a catalog reference and a tech assignment, and MUST NOT carry a percent (services don't have percents — their `unit_price_cents` is the snapshot).
- A discount row MUST NOT carry either reference (per clarification — no sentinel service row, no tech attribution). A discount row MAY carry a `discount_pct` (percent-shape) OR not (flat-shape). The CHECK leaves `discount_pct` open for discount rows because both flat and percent shapes are valid.

`name_snapshot` stays NOT NULL for every kind. Service rows get the catalog name; discount rows get a small helper-generated label (`"Discount"` for flat, `"Discount · 15%"` for percent — populated by `addDiscountLine`).

### Existing constraints preserved

- `unit_price_cents int not null check (unit_price_cents >= 0)` — phase 2 had this as `>= 0`. For discount lines the `unit_price_cents` is negative (a flat-discount or a recomputed percent amount). **This CHECK must be relaxed in this migration** to allow negative values on discount rows:

```sql
alter table public.ticket_items
  drop constraint ticket_items_unit_price_cents_check;

alter table public.ticket_items
  add constraint ticket_items_unit_price_cents_chk check (
    (kind = 'service'  and unit_price_cents >= 0)
    or
    (kind = 'discount' and unit_price_cents <= 0)
  );
```

The replacement keeps the non-negative invariant on service lines (a service can't be priced below zero), and enforces that discount lines are non-positive (a discount line that doesn't reduce the total is a bug, not a feature).

> **Note for the migration author**: the original CHECK in `0004_checkout_cash_sale.sql` is `check (unit_price_cents >= 0)` (auto-named by Postgres as `ticket_items_unit_price_cents_check`). Confirm the name with `\d ticket_items` against a local apply of `0001`–`0004`; if Postgres named it differently the `drop constraint` statement above gets adjusted in the same commit.

### Indexes — no changes

The existing `ticket_items_by_ticket_idx` covers the "load this ticket's cart" hot path for both kinds. No new indexes are added; cart totals are recomputed by scanning the ticket's items, which is bounded by the cart size (typically < 10 rows).

---

## 2. `public.services` (extended)

```sql
alter table public.services
  add column presets jsonb null;

alter table public.services
  add constraint services_presets_array_chk check (
    presets is null or jsonb_typeof(presets) = 'array'
  );
```

`presets` is an array of `{ label, price_cents }` objects when populated:

```jsonc
[
  { "label": "Small",  "price_cents": 3500 },
  { "label": "Medium", "price_cents": 4500 },
  { "label": "Large",  "price_cents": 6000 }
]
```

The CHECK only enforces the outer shape (must be a JSON array or NULL). Per-element shape (`label: string, price_cents: integer >= 0`) is validated by the TypeScript layer that reads the column (the `<PriceSheet/>` props type narrows on the array's elements; bad entries are silently dropped at render time rather than failing the migration apply). This matches how `audit_log.payload` already trades schema strictness for forward-compat at the DB layer.

### Seed update

`supabase/seed.sql` is modified in this phase to set `presets` on the existing variable-priced service row(s) — at minimum the `Nail art · medium` row that the variable-price e2e test will target:

```sql
update public.services
   set presets = jsonb_build_array(
     jsonb_build_object('label', 'Small',  'price_cents', 3500),
     jsonb_build_object('label', 'Medium', 'price_cents', 4500),
     jsonb_build_object('label', 'Large',  'price_cents', 6000)
   )
 where name = 'Nail art · medium';
```

No other catalog rows are touched.

---

## 3. `public.settings` (new)

```sql
create table if not exists public.settings (
  key        text primary key check (length(trim(key)) > 0),
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.settings enable row level security;

create policy settings_select_authenticated
  on public.settings for select to authenticated using (true);

-- No insert/update/delete policies. Writes go through the service-role
-- client (matches the 0003/0004 pattern). An admin UI lands in a later
-- feature.
```

### Trigger

```sql
create or replace function public.settings_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists settings_set_updated_at_trg on public.settings;
create trigger settings_set_updated_at_trg
  before update on public.settings
  for each row execute function public.settings_set_updated_at();
```

### Seed rows

The migration ships four rows used by this phase:

```sql
insert into public.settings (key, value) values
  ('salon.name',     to_jsonb('Tang Nails'::text)),
  ('salon.address',  to_jsonb('218 Hayes St · San Francisco, CA'::text)),
  ('salon.phone',    to_jsonb('(415) 555-0140'::text)),
  ('discount.manager_threshold_cents', 'null'::jsonb)
on conflict (key) do nothing;
```

`on conflict (key) do nothing` keeps re-applies idempotent against existing local DBs and against any future migration that re-runs the seed block. The values are intentionally generic so the operator's first action on the (future) admin UI is to overwrite them with their real salon info.

### Why JSONB instead of TEXT

`discount.manager_threshold_cents` is an integer (in cents) or null. The salon-info keys are strings. A single typed column would force either (a) parsing strings to numbers at every read, or (b) a per-type column layout. JSONB hits the simplest natural fit: `value::text` for strings, `(value)::int` for numbers, `value is null` for the v1 "no threshold" sentinel. The cast cost is negligible at the read volume this phase has.

---

## 4. `public.pos_take_cash` (re-emit, no behavioral change)

```sql
create or replace function public.pos_take_cash(
  p_ticket_id   uuid,
  p_operator    uuid
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
  perform 1 from public.tickets where id = p_ticket_id and status = 'open' for update;
  if not found then raise exception 'ticket_not_open' using errcode = 'P0001'; end if;

  select count(*) into v_unconfirmed_count
    from public.ticket_items
    where ticket_id = p_ticket_id
      and price_unconfirmed = true;
  if v_unconfirmed_count > 0 then
    raise exception 'ticket_has_unpriced_items' using errcode = 'P0001';
  end if;

  select total_cents into v_total from public.tickets where id = p_ticket_id;
  if v_total <= 0 then raise exception 'ticket_empty' using errcode = 'P0001'; end if;

  insert into public.payments (ticket_id, method, kind, amount_cents, status, taken_by_staff_id)
    values (p_ticket_id, 'cash', 'payment', v_total, 'succeeded', p_operator)
    returning id into v_payment_id;

  update public.tickets
    set status = 'paid',
        closed_by_staff_id = p_operator,
        closed_at = now(),
        updated_at = now()
    where id = p_ticket_id;

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

**Why re-emit at all**: the `pos_take_cash` body is unchanged from `0004`. We re-emit it in `0005` so the migration set tells a consistent story (anyone reading `0005` sees the function is unchanged but in scope), and so that any future phase that adjusts the function lands in a single migration boundary rather than depending on a possibly-stale `0004` body. `revoke all … from public` and `grant execute … to service_role` are repeated for the same reason — the grants persist across `CREATE OR REPLACE`, but listing them keeps the auth-surface change-set obvious.

**FR-017 floor**: the discount lines' contribution is rolled into `tickets.total_cents` by `recomputeTicketTotals` (the Node helper, see research.md § R11, § R18). The RPC's existing `ticket_empty` guard (`v_total <= 0`) catches the over-discount case — a $0 total disables the charge from both the client (Charge button is disabled) and the server (RPC throws `ticket_empty`).

---

## 5. Migration order

```text
0005_cart_polish.sql:
  -- 1) Enum extension (must commit before dependent CHECKs/seeds reference the value)
  ALTER TYPE public.ticket_item_kind ADD VALUE 'discount';

  -- 2) ticket_items column adds + relaxes
  ALTER TABLE public.ticket_items
    ADD COLUMN discount_pct numeric(5,2) NULL,
    ADD COLUMN note         text         NULL,
    ALTER COLUMN ref_id            DROP NOT NULL,
    ALTER COLUMN assigned_staff_id DROP NOT NULL;

  -- 3) ticket_items CHECK additions + the unit_price_cents relax
  ALTER TABLE public.ticket_items
    DROP CONSTRAINT ticket_items_unit_price_cents_check,
    ADD  CONSTRAINT ticket_items_unit_price_cents_chk CHECK (
      (kind = 'service'  AND unit_price_cents >= 0)
      OR (kind = 'discount' AND unit_price_cents <= 0)
    ),
    ADD  CONSTRAINT ticket_items_note_length_chk CHECK (
      note IS NULL OR length(note) <= 80
    ),
    ADD  CONSTRAINT ticket_items_kind_columns_chk CHECK (
      (kind = 'service'  AND ref_id IS NOT NULL AND assigned_staff_id IS NOT NULL AND discount_pct IS NULL)
      OR (kind = 'discount' AND ref_id IS NULL AND assigned_staff_id IS NULL)
    );

  -- 4) services.presets
  ALTER TABLE public.services
    ADD COLUMN presets jsonb NULL,
    ADD CONSTRAINT services_presets_array_chk CHECK (
      presets IS NULL OR jsonb_typeof(presets) = 'array'
    );

  -- 5) settings table + RLS + trigger + seed
  CREATE TABLE IF NOT EXISTS public.settings (...);
  CREATE POLICY settings_select_authenticated ON public.settings FOR SELECT TO authenticated USING (true);
  CREATE OR REPLACE FUNCTION public.settings_set_updated_at() ...;
  CREATE TRIGGER settings_set_updated_at_trg ...;
  INSERT INTO public.settings (key, value) VALUES (...) ON CONFLICT DO NOTHING;

  -- 6) pos_take_cash re-emit (body unchanged from 0004)
  CREATE OR REPLACE FUNCTION public.pos_take_cash(...) ...;
  REVOKE ALL ON FUNCTION public.pos_take_cash(uuid, uuid) FROM public;
  GRANT EXECUTE ON FUNCTION public.pos_take_cash(uuid, uuid) TO service_role;
```

The seed-data update for `services.presets` lives in `supabase/seed.sql`, not the migration, because seed mutations on existing rows are properly the seed file's responsibility (the migration only ships schema). The settings seed lives in the migration because the rows are required for the v1 read path to function and would be confusing to spread across two files.

---

## 6. Verification against spec

| Spec FR / SC | Where enforced |
|---|---|
| FR-002 / FR-009 (price-sheet open + override) | Application layer (`PriceSheet` component + `setLinePrice` action); no schema constraint. |
| FR-011 (override does not modify catalog) | `setLinePrice` writes only to `ticket_items.unit_price_cents`; never updates `services`. |
| FR-014 / FR-015 (flat / percent discount lines) | `ticket_items.kind='discount'` enum value + `discount_pct` column + `recomputeTicketTotals` writing the percent amount back. |
| FR-016a (note column, max 80) | `ticket_items.note` column + `ticket_items_note_length_chk`. |
| FR-017 (floor total at $0; Charge disabled when $0) | `recomputeTicketTotals` `max(0, …)`; `pos_take_cash` existing `ticket_empty` guard. |
| FR-018 (manager-threshold read wired, no UI) | `lib/settings/read.ts` + `settings` row seeded with `null`; `addDiscountLine` reads it and ignores the return in v1. |
| FR-021 (bill masthead reads salon.* from settings) | `settings` rows seeded; bill RSC fetches all three keys in one go. |
| FR-024 / FR-025 / FR-026 (email stub + audit + server validation) | `emailBillStub` action + `bill.emailed` audit verb in `lib/auth/audit.ts`; address regex in both client and server. |
| FR-028 (ticket_items extensions) | The column adds + relaxes + CHECK above. |
| FR-029 (services.presets) | The `services.presets` column + CHECK. |
| FR-030 (existing variable-price columns surfaced unchanged) | No schema change — `services.variable_price`, `price_from_cents`, `price_to_cents`, `variable_price_note` already exist from `0003`. |
| FR-031 (settings table seeded with defaults) | The `settings` table + seed block. |
| SC-003 (override doesn't change catalog) | `setLinePrice` writes only to `ticket_items`; e2e re-adds the service to a fresh ticket and asserts catalog price. |
| SC-004 (percent recomputes against live subtotal at charge) | `recomputeTicketTotals` runs on every cart mutation; `pos_take_cash` reads the post-recompute `tickets.total_cents`. |
| SC-005 (discount lines persist as ticket_items + percent recorded) | The column adds + CHECK ensure the shape; `addDiscountLine` writes both `unit_price_cents` and `discount_pct`. |
| SC-007 (email writes audit, no real mail) | `emailBillStub` body — `recordAudit("bill.emailed", …)` then `return { ok: true }`. |
| SC-008 (bill is read-only) | No schema changes triggered by Bill open/print/email. |

---

## 7. Out-of-model

Not added in this migration; not referenced by this feature:

- `tip_splits`, `cash_drawer_sessions`, `gift_cards`, `walk_ins`, `clients`, `staff_schedule`, `salon_hours`, `salon_closures`, `mail_outbox`.
- Any new column on `tickets` or `payments` (the existing columns are sufficient for the discount-floored total and the cash payment).
- Any new column on `audit_log` (the controlled-vocab `action` text column + JSONB payload already serve every new verb).
