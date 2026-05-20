# Quickstart: Ephemeral Checkout Draft

**Feature**: `043-checkout-ephemeral-draft`

How to build, verify, and reason about this feature.

## What changes

Checkout stops writing to the database when it opens. The cart is an in-memory
draft; a `tickets` row + `ticket_items` rows are written **once**, atomically, at
the first payment-initiating action. Resume is removed — every entry to
`/checkout` opens a fresh cart. The header's "Cancel" and "Discard" buttons
become one context-aware control.

## Build order

1. **Migration** — `supabase/migrations/0020_checkout_ephemeral_draft.sql`:
   add `pos_create_ticket_from_draft`, drop `tickets_open_by_operator_recent_idx`.
2. **Draft module** — `app/(studio)/checkout/_cart-draft.ts`: the `CheckoutDraft`
   type + the server-side validate/resolve helper.
3. **Server actions** — `actions.ts`: delete `createEmptyTicket` /
   `resumeOrCreateTicket`; add the draft path to `takeCash`,
   `sendCardToTerminal`, `composeDraftLeg`, `redeemGiftCardWholeTicket`; simplify
   `startNewSale`.
4. **Routes** — move `checkout-screen.client.tsx` up to
   `app/(studio)/checkout/`; rewrite `page.tsx` to render the draft cart
   directly; keep `[ticketId]/page.tsx` for persisted tickets.
5. **Client** — `checkout-screen.client.tsx`: `ticketId: string | null` prop;
   ephemeral mode (local-only edits) vs persisted mode; single exit control.
6. **Docs** — one-line sync in `docs/system-design.md`.

Tests for the RPC and the submission actions are written **test-first**
(Constitution Principle IV — checkout is a critical money path).

## Manual verification

Run `npm run dev`, sign in, open `/checkout`:

1. **US1 / SC-001** — open `/checkout`, browse the catalog. In a DB console:
   `select count(*) from tickets` and `ticket_items` / `audit_log` are unchanged.
   Add a service, take cash. A `paid` ticket + items + `cash` payment +
   `ticket.created` + `payment.captured` audit rows now exist — and a single
   `created_at` instant, not a spread.
2. **US2 / SC-002** — open `/checkout`, add and remove services, click the
   header control (labeled **Cancel**). Back at the dashboard, no ticket /
   ticket_item / payment / audit rows exist for that session.
3. **US3 / SC-006** — build a partial cart, navigate to the dashboard, return to
   `/checkout` → fresh empty cart. Refresh `/checkout` → fresh empty cart.
4. **US4** — run a Square card sale, a gift-card redemption, and a split-tender
   sale. Each persists its ticket at payment initiation; the URL becomes
   `/checkout/<id>`; settlement completes as today. Refresh during card-waiting →
   the waiting screen rehydrates.
5. **Exit after payment** — start a card charge, let it fail, click the header
   control (now labeled **Discard**) → ticket marked `discarded`,
   `ticket.discarded` audit row written.

## Pre-push gate set (Constitution v1.0.3)

```
npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:e2e
```

The migration **must** be committed in `supabase/migrations/**` so the
`db-migrate-preview` GitHub Action applies `pos_create_ticket_from_draft` to the
preview Supabase project before the Vercel preview deploy is exercised
(Constitution § "Schema drift forbidden").

## Test impact

- **Rewrite** `tests/e2e/checkout-resume.spec.ts` — resume is gone; assert every
  entry opens a fresh cart (US3).
- **Update** `tests/e2e/checkout-cash-sale.spec.ts` — add the "no rows before
  payment" assertions; keep the post-payment assertions unchanged.
- **Add** an e2e spec for US2 (abandon → zero residue).
- **Remove** the `createEmptyTicket` / `resumeOrCreateTicket` unit tests; **add**
  unit tests for `pos_create_ticket_from_draft` and the draft validation helper.
- All "finalized sale" assertions (`checkout-cash-sale`, `card-payment-*`,
  `gift-card-*`, `split-tender-*`) must keep passing unchanged (SC-003, SC-005).
