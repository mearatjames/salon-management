# Phase 1 — Data Model: End of Day Cash Count

## New table: `public.cash_drawer_sessions`

```sql
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
  variance_cents        int,                       -- signed: positive=over, negative=short
  notes                 text,
  business_day          date not null,             -- salon-local date the session is for
  created_at            timestamptz not null default now(),

  constraint cash_drawer_close_consistency_chk check (
    (closed_at is null
        and closed_by_staff_id is null
        and counted_cents is null
        and variance_cents is null)
    or
    (closed_at is not null
        and closed_by_staff_id is not null
        and expected_cents is not null
        and counted_cents is not null
        and variance_cents = counted_cents - (opening_cents + expected_cents))
  ),

  constraint cash_drawer_notes_required_when_variance_chk check (
    closed_at is null
    or variance_cents = 0
    or (notes is not null and length(btrim(notes)) > 0)
  )
);
```

**RLS**: `enable row level security` + a single `select to authenticated using (true)` policy (matches the project pattern). No insert/update/delete policies — all writes go through the service-role client via the close RPC.

**Indexes**:

```sql
-- At most one open session at a time. Single-tenant simplification: no
-- salon_id column, so the predicate alone is the uniqueness key.
create unique index cash_drawer_sessions_one_open_idx
  on public.cash_drawer_sessions ((true))
  where closed_at is null;

-- Fast lookup of today's session row (open or just closed).
create index cash_drawer_sessions_business_day_idx
  on public.cash_drawer_sessions (business_day desc);
```

The `((true))` expression-index trick gives us a unique index on a constant: at most one row can satisfy the partial predicate. This is the same technique used for `square_devices.is_default`'s "one-true-row" guarantee.

### Field semantics

| Field | Meaning |
|------|---------|
| `id` | Surrogate key. |
| `opened_at` | When the row was created. Set by `default now()` at insert. |
| `opened_by_staff_id` | The operator who triggered the lazy open. In v1, this is the operator who pressed Close Out Day (since open is lazy-inside-close). |
| `opening_cents` | Float in the drawer at open. Always `0` in v1 — no opening-cash UI. The column is `not null default 0` so a future "Open the day with $X" feature is a pure additive change. |
| `closed_at` | When the close was recorded. `NULL` while open. |
| `closed_by_staff_id` | The operator who performed the close. |
| `expected_cents` | Server-computed expected total at close time. Frozen value, not recomputed later. |
| `counted_cents` | Operator-entered counted amount at close. |
| `variance_cents` | `counted_cents − (opening_cents + expected_cents)`. Signed. Enforced by check constraint to match the formula. |
| `notes` | Operator's explanation of a non-zero variance. Required by check constraint when `variance_cents != 0`. |
| `business_day` | Salon-local date the session belongs to. Set by the close RPC from `current_setting('app.salon_tz')` (or from the RPC's `p_business_day` argument). |
| `created_at` | Audit timestamp; survives if `opened_at` is ever made nullable. |

### State machine

```
   (no row)
       │
       │  pos_close_cash_drawer (lazy open)
       ▼
   ┌────────┐                                  ┌────────┐
   │  open  │── pos_close_cash_drawer ────────▶│ closed │
   └────────┘                                  └────────┘
                                                    │
                                                    │  (no transitions out — closed is terminal in v1)
                                                    ▼
                                                 (terminal)
```

In v1 there is no "reopen" transition. A reopen would require a manager-PIN audit verb and a UI flow that the spec explicitly excludes.

## New RPCs

### `public.pos_close_cash_drawer(p_counted_cents int, p_expected_cents int, p_notes text, p_operator uuid, p_business_day date) returns uuid`

Returns the closed session's `id`. Atomic: insert-on-conflict the open row, lock it, re-check expected, write the close, write the audit row, all in one transaction. See `contracts/rpc-pos-close-cash-drawer.md` for the full contract including error codes.

`security definer; set search_path = public, pg_temp; revoke all from public; grant execute to service_role`. Mirrors `pos_take_cash`.

## Existing tables read by this feature

| Table | Columns read | Why |
|-------|-------------|------|
| `payments` | `id, ticket_id, method, kind, amount_cents, processed_at, taken_by_staff_id` | Source rows for the left-panel list and the expected-total computation. Filter: `method='cash' AND status='succeeded' AND processed_at IN [start, end)`. |
| `tickets` | `id, total_cents, closed_at` | Each payment's ticket; populates the per-row total in the prototype. |
| `ticket_items` | `id, ticket_id, kind, label, service_id, qty, unit_amount_cents` | Service-name summary in the meta line (joined `+` for two; `first +N` for three or more). |
| `services` | `id, name` | Resolves `ticket_items.service_id` → display name. |
| `appointments` | `id, client_id, staff_id` | The owning appointment of the ticket; used to pick the client and the primary tech for the row. (Cash-sale tickets in v1 may not have an appointment; in that case, fall back to `payments.taken_by_staff_id` as the lone tech.) |
| `clients` | `id, first_name, last_name` | Client name in each row. |
| `staff` | `id, display_name, color_token` | Tech pill rendering. |
| `settings` | `salon.timezone` row | Salon timezone for `todayWindow()`. Read via existing `getSalonTimezone()`. |
| `audit_log` | INSERT only (in RPC) | One `cash_drawer.closed` row per close. |

## Audit vocabulary additions

In `lib/auth/audit.ts`:

```ts
export type AuditAction =
  // … existing …
  // Added by feature 019 (entity_type "cash_drawer")
  | "cash_drawer.closed";
```

`deriveEntityType` dispatch is extended:

```ts
if (action.startsWith("cash_drawer.")) return "cash_drawer";
```

Return type union adds `"cash_drawer"`.

**Note**: `cash_drawer.opened` is NOT added (R1 — opens are lazy inside the close RPC; there is no separate open UI to attribute in v1).

## Migration plan

One new migration: `supabase/migrations/0014_end_of_day_cash.sql`.

Sections, in order:
1. Create `public.cash_drawer_sessions` (table, RLS, indexes).
2. Define `public.pos_close_cash_drawer` (function body in `research.md` R3).
3. Revoke/grant on the function.

No backfill needed — no existing data to migrate. The `cash_drawer_sessions` table starts empty; the first close creates its first row.

## Validation rules surfaced from spec

| FR | Where enforced |
|----|----------------|
| FR-001 (owner/manager only) | `page.tsx` + Server Action (R4) |
| FR-002 (list cash payments today) | `loadCashCount` query (lib/end-of-day/cash-count.ts) |
| FR-003 (expected = sales − refunds) | `aggregate.ts` |
| FR-004 (numpad rules) | `cash-count.client.tsx` numpad reducer + Vitest tests |
| FR-005 (live comparison) | `cash-count.client.tsx` derived state |
| FR-006 (CTA disabled rules) | `cash-count.client.tsx` `canSubmit` derived state |
| FR-007 (persist + audit) | `pos_close_cash_drawer` RPC |
| FR-008 (one close per day under concurrency) | `cash_drawer_sessions_one_open_idx` + RPC `FOR UPDATE` |
| FR-009 (confirmation screen) | `done-screen.tsx` |
| FR-010 (auto-open `opening_cents=0`) | RPC's insert-on-conflict |
| FR-011 (formatting) | Existing `formatCurrency`/`tnum` patterns |
| FR-012 (reject stale snapshot) | RPC's expected re-check |
