-- 0025_void_refund_enums.sql
-- Feature 052 — Privileged Action Overrides (Void & Refund)
-- (specs/052-privileged-action-overrides/)
--
-- Enum extensions ONLY. Split into its own migration so the new values
-- commit before 0026_void_refund.sql references them in an index
-- predicate (`where kind = 'refund'`) — Postgres forbids using a
-- freshly-added enum value for non-function DML (including an index
-- predicate) in the SAME transaction (enum-add-then-use rule, research
-- D3; SQLSTATE 55P04). Each migration file runs in its own transaction,
-- so the ALTER TYPEs here are durably committed before 0026 runs.
--
-- These are additive, safe changes.
alter type public.ticket_status add value if not exists 'void';
alter type public.ticket_status add value if not exists 'refunded';
alter type public.ticket_status add value if not exists 'partially_refunded';
alter type public.payment_kind  add value if not exists 'refund';
