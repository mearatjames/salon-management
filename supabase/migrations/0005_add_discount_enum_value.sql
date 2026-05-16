-- Migration: 0005_add_discount_enum_value.sql
-- Feature: 013-cart-polish (part 1 of 2)
--
-- Splits the `'discount'` enum extension out of 0006_cart_polish.sql so
-- the new label is committed before any CHECK constraint or INSERT in
-- 0006 references it. Postgres rejects `alter type ... add value` followed
-- in the same transaction by code that uses the freshly added value
-- (SQLSTATE 55P04 — "unsafe use of new value …").
--
-- Supabase's migration runner applies each file in its own transaction
-- (verified by the apply rejecting the combined form locally on 2026-05-16),
-- so committing the enum change in its own file makes the new label visible
-- to 0006's body.
--
-- Naming note: the supabase CLI rejects filenames whose numeric prefix
-- contains a letter (e.g. `0005a_…`). We use sequential integer prefixes
-- (`0005`, `0006`) and rely on alphabetical apply order to keep the enum
-- file before the rest of the cart-polish DDL.

alter type public.ticket_item_kind add value if not exists 'discount';
