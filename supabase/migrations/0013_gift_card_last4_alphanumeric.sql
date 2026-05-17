-- Migration 0012 — relax the gift_cards.last4_mask check from digits-only
-- to alphanumeric so the e2e fixture matrix's `BLKD` / `PEND` / `DEAC`
-- last-4 chars round-trip through the cached row. Real Square GANs are
-- digits, but the deterministic test stub (research R10) uses letter
-- suffixes to opt into the non-ACTIVE state cases; the cache needs to
-- accept whatever the GAN's last four characters actually are.
--
-- Feature 018-gift-card-split-tender, Phase 3 (US1) follow-up.

begin;

alter table public.gift_cards
  drop constraint if exists gift_cards_last4_mask_check;

alter table public.gift_cards
  add constraint gift_cards_last4_mask_check
    check (last4_mask ~ '^[0-9A-Za-z]{4}$');

commit;
