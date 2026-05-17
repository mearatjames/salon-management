-- Migration: 0010_gift_card_split_tender.sql
-- Feature: 018-gift-card-split-tender (part 1 of 2)
--
-- Splits the enum extensions out of 0011_gift_card_split_tender.sql so
-- the new labels are committed before any CHECK constraint or INSERT in
-- 0011 references them. Postgres rejects `alter type ... add value`
-- followed in the same transaction by code that uses the freshly added
-- value (SQLSTATE 55P04 — "unsafe use of new value …").
--
-- Supabase's migration runner applies each file in its own transaction,
-- so committing the enum changes in their own file makes the new labels
-- visible to 0011's body. Pattern mirrors 0006_add_discount_enum_value.sql.
--
-- Naming note: the Supabase CLI rejects filenames whose numeric prefix
-- contains a letter; sequential integer prefixes (`0010`, `0011`) keep
-- alphabetical apply order correct.

-- payment_method gains 'gift' for gift-card legs.
alter type public.payment_method add value if not exists 'gift';

-- payment_status gains 'draft' for split-tender composition (drafts are
-- the in-cart legs the operator builds before activating each).
alter type public.payment_status add value if not exists 'draft';
