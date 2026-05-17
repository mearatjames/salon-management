# Contract: Migration `0016_services_deductions.sql`

## 1. Columns added to `public.services`

| Column                    | Type      | Nullable | Default     | App enforces       | DB CHECK |
|---------------------------|-----------|----------|-------------|---------------------|----------|
| `card_fee_mode`           | `text`    | NO       | `'default'` | `validateCardFeeMode` | `services_card_fee_mode_chk` |
| `card_fee_custom_cents`   | `int`     | YES      | —           | `validateCardFeeCustomDollars` (when mode=custom) | `services_card_fee_custom_pair_chk` |
| `supply_amount_cents`     | `int`     | YES      | —           | `validateSupplyAmountDollars` (when supply on) | `services_supply_pair_chk` |
| `supply_label`            | `text`    | YES      | —           | `validateSupplyLabel` (when supply on) | `services_supply_pair_chk` |

## 2. CHECK constraints

### 2.1 `services_card_fee_mode_chk`

```sql
check (card_fee_mode in ('default', 'custom', 'exempt'))
```

Defensive — every write goes through `validateCardFeeMode` upstream. The default `'default'` keeps existing rows valid at migration time.

### 2.2 `services_card_fee_custom_pair_chk`

```sql
check (
  (card_fee_mode = 'custom'
   and card_fee_custom_cents is not null
   and card_fee_custom_cents between 0 and 5000)
  or
  (card_fee_mode <> 'custom'
   and card_fee_custom_cents is null)
)
```

Enforces FR-009/FR-010 at the DB layer. Cap of 5000 cents matches Clarifications Q2.

### 2.3 `services_supply_pair_chk`

```sql
check (
  (supply_amount_cents is null and supply_label is null)
  or
  (supply_amount_cents is not null
   and supply_label is not null
   and supply_amount_cents between 1 and 5000
   and length(trim(supply_label)) between 1 and 64)
)
```

Enforces FR-016/FR-019/FR-020 at the DB layer. The strictly-positive (`between 1 and 5000`) bound rejects `supply_amount_cents = 0` because the toggle-off state is the legitimate "no supply" path.

## 3. Backfill behavior

| Existing row state | After migration |
|---|---|
| Any row | `card_fee_mode = 'default'` (column default), three nullable columns = `null` |

No explicit `UPDATE` statement is required. The migration runs as a single set of DDL statements; Postgres backfills the default-bearing column immediately.

## 4. Idempotency

The migration uses `add column if not exists` and `drop constraint if exists` + `add constraint` so re-running it is safe. This matches the convention of `0003_services_catalog.sql` and the rest of `supabase/migrations/`.

## 5. RLS posture

Unchanged from 008. `public.services` has:

```sql
alter table public.services enable row level security;
create policy services_read_any_authenticated
  on public.services for select to authenticated using (true);
```

The four new columns inherit the table's row-level security automatically. The kiosk JWT (which does not authenticate as `authenticated`) gets no access. Writes continue to flow through the service-role client invoked by the Server Action — no `insert` / `update` policy is added.

## 6. Type regeneration

After the migration is applied locally:

```bash
supabase db reset
npx supabase gen types typescript --local > lib/db/types.ts
```

Expected delta in `lib/db/types.ts`:
- `services.Row` gains `card_fee_mode: "default" | "custom" | "exempt"`, `card_fee_custom_cents: number | null`, `supply_amount_cents: number | null`, `supply_label: string | null`.
- `services.Insert` and `services.Update` mirror with the appropriate `?:` and `null | undefined` nuances.

## 7. Deployment

Per Constitution v1.0.3 "Schema drift forbidden":

- The migration is applied by `.github/workflows/db-migrate-preview.yml` on PR open/synchronize.
- The migration is applied by `.github/workflows/db-migrate-prod.yml` on push to `main`.
- **Do NOT run `supabase db push` against hosted projects by hand.** Manual application is reserved for CI recovery scenarios.

## 8. Constraint failure modes (operator-facing)

The Server Action's validation layer catches every realistic input shape before it reaches the DB. Constraint violations from the DB would surface as the generic `?error=db_failure` redirect — but the validators upstream make this path effectively unreachable for normal use. The constraints are the trust boundary against (a) direct SQL writes, (b) future Server Action regressions, and (c) edge-case rounding errors in the dollars-to-cents conversion.

## 9. Reversal

If this migration needs to be reversed:

```sql
-- 0016_services_deductions_reversal.sql (hypothetical; do not commit unless instructed)
alter table public.services drop constraint if exists services_supply_pair_chk;
alter table public.services drop constraint if exists services_card_fee_custom_pair_chk;
alter table public.services drop constraint if exists services_card_fee_mode_chk;
alter table public.services drop column if exists supply_label;
alter table public.services drop column if exists supply_amount_cents;
alter table public.services drop column if exists card_fee_custom_cents;
alter table public.services drop column if exists card_fee_mode;
```

Note: dropping the columns is destructive — any deduction values entered by operators are lost. Coordinate with the maintainer before adding a reversal migration; usually a forward-fix migration is the right answer.
