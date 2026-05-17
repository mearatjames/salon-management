-- 0016_services_deductions.sql
-- Feature: 021-services-deductions
-- Adds per-service card-fee mode + supply deduction columns to public.services.
--
-- Contract: specs/021-services-deductions/contracts/db-migration.contract.md
-- Data model: specs/021-services-deductions/data-model.md § 7
--
-- Idempotent — re-applies cleanly via `add column if not exists` +
-- `drop constraint if exists` / `add constraint`. The `card_fee_mode`
-- column carries `not null default 'default'` so existing rows backfill
-- via the column default — no separate UPDATE needed.

alter table public.services
  add column if not exists card_fee_mode text not null default 'default';
alter table public.services
  add column if not exists card_fee_custom_cents int;
alter table public.services
  add column if not exists supply_amount_cents int;
alter table public.services
  add column if not exists supply_label text;

-- card_fee_mode ∈ {default, custom, exempt}
alter table public.services
  drop constraint if exists services_card_fee_mode_chk;
alter table public.services
  add constraint services_card_fee_mode_chk
  check (card_fee_mode in ('default', 'custom', 'exempt'));

-- card_fee_custom_cents is required iff mode = 'custom' (and bounded $0–$50).
alter table public.services
  drop constraint if exists services_card_fee_custom_pair_chk;
alter table public.services
  add constraint services_card_fee_custom_pair_chk check (
    (card_fee_mode = 'custom'
     and card_fee_custom_cents is not null
     and card_fee_custom_cents between 0 and 5000)
    or
    (card_fee_mode <> 'custom'
     and card_fee_custom_cents is null)
  );

-- supply_amount_cents and supply_label are both-or-neither. When both
-- present, amount ∈ [1, 5000] cents and label length (trimmed) ∈ [1, 64].
alter table public.services
  drop constraint if exists services_supply_pair_chk;
alter table public.services
  add constraint services_supply_pair_chk check (
    (supply_amount_cents is null and supply_label is null)
    or
    (supply_amount_cents is not null
     and supply_label is not null
     and supply_amount_cents between 1 and 5000
     and length(trim(supply_label)) between 1 and 64)
  );
