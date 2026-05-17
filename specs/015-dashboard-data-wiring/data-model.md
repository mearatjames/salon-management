# Data Model: Dashboard — Real Supabase Data Wiring

**Feature**: 015-dashboard-data-wiring
**Date**: 2026-05-16
**Migration**: `supabase/migrations/0008_dashboard_data_wiring.sql`

## Overview

This feature introduces **no new tables, no new columns, and no new RLS policies**. The existing tables (`tickets`, `ticket_items`, `payments`, `staff`, `services`, `settings`) — wired up by migrations `0001`, `0003`, `0004`, `0006`, `0007` — are the authoritative read source. The migration's entire footprint is:

1. One INSERT into the existing `public.settings` key/value table to seed `salon.timezone`.
2. Two CREATE INDEX statements on existing tables to support the dashboard's hot-path aggregates.

The seed-data update in `supabase/seed.sql` adds a small fixture of paid tickets for local development only.

## Migration shape — `0008_dashboard_data_wiring.sql`

```sql
-- Migration: 0008_dashboard_data_wiring.sql
-- Feature: 015-dashboard-data-wiring
--
-- Seeds the salon timezone in public.settings and adds two partial indexes
-- that turn the dashboard's hot aggregate queries into index-only scans.
-- No schema changes; no policy changes.

-- ----------------------------------------------------------------------
-- 1. Seed salon.timezone (idempotent)
-- ----------------------------------------------------------------------
-- The dashboard reads this row to compute calendar windows in the salon's
-- local timezone. Default matches the seeded salon.address from 0007
-- (218 Hayes St, San Francisco — Pacific). A future settings UI can let
-- the operator change this; the dashboard picks up the new value on the
-- next render (no cache; FR-027).

insert into public.settings (key, value) values
  ('salon.timezone', to_jsonb('America/Los_Angeles'::text))
on conflict (key) do nothing;

-- ----------------------------------------------------------------------
-- 2. Partial indexes for the dashboard's hot path
-- ----------------------------------------------------------------------
-- The dashboard reads:
--   - tickets where status = 'paid' and closed_at is in [period_start, now]
--   - payments where status = 'succeeded' and processed_at is in [period_start, now]
-- Partiality keeps the indexes tiny: discarded tickets and failed/pending
-- payments are never queried by the dashboard.

create index if not exists tickets_status_closed_at_idx
  on public.tickets (status, closed_at desc)
  where status = 'paid';

create index if not exists payments_status_processed_at_idx
  on public.payments (status, processed_at desc)
  where status = 'succeeded';
```

## Existing tables read by this feature

For each table, the columns the dashboard *reads* and the rules it filters by. No writes; no changes to the schema.

### `public.tickets` (from `0004_checkout_cash_sale.sql`)

| Column | Used for | Filter |
|---|---|---|
| `id` | join key to `ticket_items` and `payments`; row key for the feed | — |
| `status` | exclude open/discarded | `status = 'paid'` (FR-002) |
| `closed_at` | period-window bound; sort key for the feed | `closed_at BETWEEN period_start AND now` (FR-007, FR-011) |
| `total_cents` | feed row total display | — |
| `appointment_id` | not used (every paid ticket today is `null` per checkout flow; FR-023 confirms the client column is removed) | — |

### `public.ticket_items` (from `0004_checkout_cash_sale.sql` + `0006_add_discount_enum_value.sql`)

| Column | Used for | Filter |
|---|---|---|
| `ticket_id` | join to `tickets` | — |
| `qty` | summed for Services count (FR-003) and `avgServicesPerSale` | excluded when `kind = 'discount'` |
| `kind` | discount-filter for Services count and the service-summary string | `kind != 'discount'` (FR-003, FR-014) |
| `name_snapshot` | source for the feed row's service-summary string (FR-014) | — |
| `assigned_staff_id` | source for the feed row's tech-avatar stack (FR-014) | — |

### `public.payments` (from `0004_checkout_cash_sale.sql`)

| Column | Used for | Filter |
|---|---|---|
| `ticket_id` | join to `tickets`; group key for split-tender detection (FR-014a) | — |
| `status` | exclude failed/pending | `status = 'succeeded'` (FR-004, FR-005, FR-006) |
| `method` | Payment-mix card grouping (FR-006); feed row pill (FR-014a) | — |
| `amount_cents` | Revenue sum (FR-004); Payment-mix slice | — |
| `tip_cents` | Tips sum (FR-005) — currently `0` in prod | — |
| `processed_at` | last-sale time on the header subtitle (FR-010) | the max over today's successful payments |

### `public.staff` (from `0001_auth_schema.sql`)

| Column | Used for | Filter |
|---|---|---|
| `id` | join key from `ticket_items.assigned_staff_id` | — |
| `display_name` | tech avatar title attribute and initials | — |
| `color_token` | tech avatar tone | — |
| `active` | not read by this feature (the techs-on-shift tile is removed; FR-019) | — |

### `public.services` (from `0003_services_catalog.sql`)

This feature *doesn't* read `public.services` directly — the feed uses `ticket_items.name_snapshot` instead, so historical sales remain stable when the catalog later changes. The table is mentioned here only to make explicit that the dashboard never reaches past the snapshot.

### `public.settings` (from `0007_cart_polish.sql`)

| Row | Used for | Default |
|---|---|---|
| `salon.timezone` | period-window math; subtitle date/time formatting | `"America/Los_Angeles"` (seeded by this migration) |

## Read-model types

Defined in TypeScript under `lib/dashboard/aggregate.ts` (rewritten) and `lib/dashboard/queries.ts` (new). Shapes preserved from the existing `aggregate.ts` so `app/(studio)/dashboard/page.tsx` and the existing components can drop the new data in without prop-type churn.

### `DashboardData`

```ts
type DashboardData = {
  greeting: {
    eyebrow: "Lacquer Studio · Front desk";
    title: "Today at the salon";
    subtitle: string;  // FR-010 — derived live; e.g. "Saturday, May 16 · Last sale 4:14 PM" or "Saturday, May 16" when empty
  };
  summaries: Record<"today" | "week" | "month", DashboardSummary>;
  staff: readonly Technician[];  // joined for tech avatars
  recent: readonly TransactionRow[];  // FR-011 — pinned to today
  quickActions: readonly QuickAction[];  // unchanged from 002
  // NOTE: `comparisons` (transactionsVsAvg, revenueDelta) removed per FR-020
};
```

### `DashboardSummary`

```ts
type DashboardSummary = {
  period: "today" | "week" | "month";
  count: number;                                  // FR-002
  services: number;                               // FR-003 (excludes kind='discount')
  subtotal: number;
  tip: number;                                    // FR-005 (sum of payments.tip_cents)
  tax: number;                                    // currently 0 — schema has tax_cents but no compute path (Principle V)
  total: number;                                  // FR-004 (sum of payments.amount_cents + tip_cents)
  byMethod: { card: number; cash: number; gift: number };  // FR-006 — three pure methods only
  avgServicesPerSale: number;
  tipPctAvg: number;
};
```

`byMethod` carries only the three pure methods. The `Split` distinction is *per-row in the feed* (FR-014a), not *per-method in aggregate*. A split-tender ticket contributes its `card` amount to `byMethod.card` and its `cash` amount to `byMethod.cash` — the Payment-mix card's three-row legend stays correct.

### `TransactionRow`

```ts
type TransactionRow = {
  id: string;
  time: string;                                  // FR-014 — `closed_at` formatted as "4:14 PM" in salon TZ
  serviceLabel: string;                          // FR-014 — built from non-discount ticket_items.name_snapshot
  techIds: readonly string[];                    // FR-014 — unique assigned_staff_id values from non-discount items
  method: "card" | "cash" | "gift" | "split";    // FR-014a — "split" when payments span ≥2 methods
  total: number;                                 // FR-014 — tickets.total_cents / 100, rendered as $X
  // NOTE: `client` field removed per FR-023
};
```

## Seed-data fixture spec (dev-only)

Appended to `supabase/seed.sql`, wrapped in a `do $$ ... end $$` block guarded by `where exists (select 1 from auth.users where email = 'owner@tangnails.dev')` so the block never runs against production.

The fixture creates **5 paid tickets dated today in salon TZ** with:

| # | Method outcome | Tip | Services | Notes |
|---|---|---|---|---|
| 1 | `card` (1 payment row) | 20% | 1 service | Vanilla card sale |
| 2 | `cash` (1 payment row) | 18% | 2 services | Multi-service ticket |
| 3 | `gift` (1 payment row) | 0% | 1 service | Gift-card redemption |
| 4 | split (`cash` + `card`, 2 payment rows on the same ticket) | 0% | 2 services | Drives the `Split` pill |
| 5 | `card` (1 payment row) | 25% | 3 services + 1 discount line | Drives `+N more` and discount-exclusion |

Techs are randomly assigned from the existing staff roster (`Maya P.`, `Linh T.`, `Aria K.`, …); two tickets use multiple techs.

Each ticket is created by hand-inserting the `tickets`, `ticket_items`, and `payments` rows in the seed SQL — not by calling `pos_take_cash`, because the seed runs before the RPC's network plumbing is available. The hand-inserts mirror the invariants the RPC enforces (`subtotal_cents = sum(item amounts)`, `total_cents = subtotal_cents + tax_cents`, one closed_at per `status='paid'` ticket) so the dashboard's reads see the same shape they would in production.

The fixture's *purpose* is twofold: (1) the Tips tile shows non-zero values in dev so the page is visually verifiable end-to-end before card-payment tips ship via the parallel Square Terminal feature; (2) the seed exercises every non-empty edge case the spec calls out (split-tender, discount line, multi-tech, multi-service, mixed methods) so a developer running `supabase db reset` immediately sees a representative dashboard.

## What this migration does NOT do

- No new table.
- No new column.
- No new enum value.
- No new RLS policy or grant (existing `select-to-authenticated` policies on the tables already cover the dashboard).
- No `clients` table — explicitly out of scope per FR-023; the client column is removed from the feed.
- No `shifts` / `schedules` table — explicitly out of scope per FR-019; the techs-on-shift tile is removed.
- No materialized view, no Postgres function. The dashboard's reads are plain SQL through the typed Supabase client.
