-- Migration: 0024_square_order_id.sql
-- Feature: 051-square-itemized-order
--
-- Adds two nullable text columns supporting the itemized-Square-order
-- checkout path:
--
--   1. `payments.square_order_id text null` — audit trace pointer from a
--      Tang Nails payment row to its corresponding Square Order. Populated
--      only on the single-tender card path; NULL on split-tender card-leg,
--      cash, and gift-card payments. No default, no index, no constraint.
--      RLS inherits from `payments`.
--   2. `square_oauth.location_id text null` — cache of the salon's primary
--      Square `Location.id`, required by `orders.create`. Populated lazily
--      on the first itemized checkout (single-row table, service-role-only
--      via inherited RLS). No default, no index, no constraint.
--
-- Both columns are nullable with no default and no backfill — existing
-- rows continue to satisfy schema with NULL. Rollback is a clean
-- `drop column` on each (no data loss because the columns are new).

alter table public.payments
  add column if not exists square_order_id text null;

alter table public.square_oauth
  add column if not exists location_id text null;
