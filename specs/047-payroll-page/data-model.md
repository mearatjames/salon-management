# Phase 1 Data Model: Payroll Page

Migration file: `supabase/migrations/0021_payroll.sql`. Conventions follow the existing migration set (4-digit prefix; integer cents; `timestamptz`; inline `check`; `SECURITY DEFINER` RPCs with `search_path = public, pg_temp`; RLS = `select … to authenticated using (true)`, no write policies). Regenerate `lib/db/types.ts` afterward.

## Enums

```sql
create type public.pay_period_status as enum ('open', 'closed');
create type public.payout_method     as enum ('cash', 'zelle', 'check');
```

## Extended entity — `staff` (3 new columns)

Added via `alter table … add column if not exists` (the spec-018 pattern).

| Column | Type | Constraint | Meaning |
|--------|------|-----------|---------|
| `service_commission_pct` | `numeric(5,4)` | `not null default 0` · `check (between 0 and 1)` | Share of commissionable service income the tech keeps (e.g. `0.6500`). |
| `tip_split_pct` | `numeric(5,4)` | `not null default 0` · `check (between 0 and 1)` | Share of the tech's card tips the tech keeps. |
| `check_portion_cents` | `int` | `not null default 0` · `check (>= 0)` | Dollar amount (cents) paid each period by physical check as W-2 wage. |

These are the *current* rates. Closed periods never read them (they read frozen payout snapshots — see R8). Editing is owner-only, through the existing `updateStaff` Server Action.

## New entity — `pay_periods`

One row per semi-monthly window. Created lazily on first access (R4).

```sql
create table public.pay_periods (
  id                  uuid primary key default gen_random_uuid(),
  starts_on           date not null,                       -- 1st or 16th
  ends_on             date not null,                       -- 15th or month-end
  pay_date            date not null,                       -- ends_on + 2 days
  status              public.pay_period_status not null default 'open',
  closed_at           timestamptz,
  closed_by_staff_id  uuid references public.staff(id),
  created_at          timestamptz not null default now(),
  constraint pay_periods_starts_on_unique unique (starts_on),
  constraint pay_periods_range_chk  check (ends_on >= starts_on),
  constraint pay_periods_closed_consistency_chk check (
    (status = 'open'   and closed_at is null     and closed_by_staff_id is null)
    or
    (status = 'closed' and closed_at is not null and closed_by_staff_id is not null)
  )
);
create index pay_periods_starts_on_idx on public.pay_periods (starts_on desc);
```

- **Label** (`"May 1 – 15, 2026"`) and **short label** are derived in TS — not stored.
- `starts_on` uniqueness guarantees one row per half-month.

### State transitions

```
(no row) ──lazy create──▶ open ──payroll_close_period──▶ closed   [terminal in v1]
```

Reopening a closed period is out of scope (spec Assumptions).

## New entity — `payroll_payouts`

One row per (period, tech) that has been **recorded** — either marked paid, or frozen at period close. A pending tech in an *open* period has **no row** (row exists ⇔ recorded).

```sql
create table public.payroll_payouts (
  id                       uuid primary key default gen_random_uuid(),
  pay_period_id            uuid not null references public.pay_periods(id) on delete cascade,
  staff_id                 uuid not null references public.staff(id),

  paid                     boolean not null default true,        -- false ⇒ frozen-unpaid at close
  method                   public.payout_method,                 -- null unless paid
  paid_on                  date,                                 -- null unless paid
  recorded_by_staff_id     uuid references public.staff(id),      -- null unless paid
  paid_at                  timestamptz,                          -- when mark-paid happened

  -- Immutable figure snapshot (integer cents) taken at record time
  commissionable_cents       int not null check (commissionable_cents >= 0),
  income_after_split_cents   int not null check (income_after_split_cents >= 0),
  card_tips_cents            int not null check (card_tips_cents >= 0),
  tips_after_split_cents     int not null check (tips_after_split_cents >= 0),
  check_portion_cents        int not null check (check_portion_cents >= 0),
  cash_payment_cents         int not null check (cash_payment_cents >= 0),

  -- Rate snapshot (for receipt / closed-period display — FR-023)
  service_commission_pct   numeric(5,4) not null,
  tip_split_pct            numeric(5,4) not null,

  created_at               timestamptz not null default now(),

  constraint payroll_payouts_unique unique (pay_period_id, staff_id),
  constraint payroll_payouts_paid_consistency_chk check (
    (paid = true  and method is not null and paid_on is not null
                   and recorded_by_staff_id is not null and paid_at is not null)
    or
    (paid = false and method is null and paid_on is null
                   and recorded_by_staff_id is null and paid_at is null)
  )
);
create index payroll_payouts_period_idx on public.payroll_payouts (pay_period_id);
```

- **Snapshot immutability**: once written, the figure columns never change (R5, FR-025/FR-031). Undo deletes the whole row (open period only); the audit log keeps the snapshot (R9).
- `cash_payment_cents = max(0, income_after_split + tips_after_split − check_portion)` — the clamp is enforced by the producing Server Action and the `>= 0` check.
- A `paid = false` row exists only after period close, for an eligible tech who was never paid.
- **No-work techs** (zero earnings) never get a row — not when paid (no action offered) and not at close.

### Derived payout state (not stored)

| State | Condition |
|-------|-----------|
| **No work** | Tech's computed earnings for the period = 0 (no tickets / on leave). |
| **Paid** | A `payroll_payouts` row exists with `paid = true`. |
| **Pending** | Eligible (earnings > 0), open period, no row. |
| **Unpaid (closed)** | A `payroll_payouts` row exists with `paid = false` (eligible tech, period closed without payment). |

## RPCs (mutations) — see `contracts/database-rpcs.md`

| RPC | Purpose |
|-----|---------|
| `payroll_record_payout(...)` | Insert a `paid = true` payout row + audit. Validates: period open, not already recorded, snapshot consistent. |
| `payroll_undo_payout(...)` | Audit the full snapshot, then delete the payout row. Validates: period open, row exists. |
| `payroll_close_period(...)` | Insert frozen (`paid = false`) rows for the passed eligible-unpaid techs, set period `status='closed'` + `closed_at` + `closed_by_staff_id`, audit. Validates: period open. |

All three: `SECURITY DEFINER`, `set search_path = public, pg_temp`, `for update` lock on the `pay_periods` row, validate-before-mutate, audit `insert` in the same transaction, `revoke all from public` + `grant execute to service_role`.

## RLS

```sql
alter table public.pay_periods      enable row level security;
alter table public.payroll_payouts  enable row level security;

create policy pay_periods_select_all     on public.pay_periods
  for select to authenticated using (true);
create policy payroll_payouts_select_all on public.payroll_payouts
  for select to authenticated using (true);
```

No `insert`/`update`/`delete` policies — all writes go through the service-role RPCs. Authorization (owner/manager gate; owner-only for close & rate edit) is enforced in the Server Actions (R10).

## Audit actions

Written inside the RPC transactions (the `pos_close_cash_drawer` pattern), `entity_type = 'payroll'`:

| `action` | `entity_id` | Payload highlights |
|----------|-------------|--------------------|
| `payroll.payout_recorded` | `payroll_payouts.id` | period id, staff id, method, all snapshot figures |
| `payroll.payout_undone` | `pay_periods.id` | staff id + **the full deleted snapshot** (R9) |
| `payroll.period_closed` | `pay_periods.id` | period range, frozen-unpaid staff ids, period totals |

Rate edits (US5) are audited through the existing `updateStaff` → `recordAudit("staff.updated", …)` path — the three new fields join its diff payload (FR-035). `lib/auth/audit.ts` gains the three `payroll.*` members in the `AuditAction` union and maps the `payroll.` prefix to `entity_type = 'payroll'`.

## Seed data (`supabase/seed.sql`)

Guarded `do $$ … $$` block, appended after the existing ticket seed, keyed to the seeded staff UUIDs:

1. **Rates** — set `service_commission_pct`, `tip_split_pct`, `check_portion_cents` on the three seed staff (values from the prototype `data.jsx`, e.g. owner 0.90 / 1.00 / $2,500).
2. **Open period** — the half-month containing the seed "today" (2026-05-16 – 2026-05-31), `status='open'`. The existing seeded "today" tickets fall inside it, so US1 renders real figures.
3. **Closed period + payouts** — a prior period (2026-05-01 – 2026-05-15) `status='closed'` with a handful of frozen `payroll_payouts` rows (mixed `paid=true`/`paid=false`), so US4's history view and period switcher are demonstrable without needing seeded historical tickets (closed periods read snapshots, not tickets).

Fixed UUIDs (`'70000000-…'` range) for reproducibility, `on conflict do nothing`.
