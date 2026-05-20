# Phase 0 Research: Ephemeral Checkout Draft

**Feature**: `043-checkout-ephemeral-draft` | **Date**: 2026-05-19

The spec's Clarifications session resolved every functional unknown (in-memory
draft, submission boundary, audit scope, exit control). The remaining open item
is the one the spec explicitly handed to planning: **the checkout route shape**.
This document records that decision plus the supporting design decisions needed
to write `tasks.md`.

---

## R1. Route shape

**Decision**: Two routes.

- `app/(studio)/checkout/page.tsx` — **paramless `/checkout`**. Renders the
  ephemeral draft cart directly (no redirect, no DB ticket). Every entry —
  sidebar link and dashboard "new sale" CTA — lands here. The `?fresh=1` query
  param is removed; every entry is fresh by construction.
- `app/(studio)/checkout/[ticketId]/page.tsx` — **persisted-ticket `/checkout/[ticketId]`**.
  Unchanged in structure. Branches `paid → DoneScreen`, `discarded → placeholder`,
  `open → CheckoutScreen` hydrated from the DB. This is the post-submission
  surface: done screen, card-waiting, split-tender continuation, failed-payment
  retry.

On the first payment-initiating action the submission server action persists the
ticket and returns its id; the client calls `router.replace(\`/checkout/${ticketId}\`)`.

**Rationale**: keeping `[ticketId]` for persisted tickets means card-waiting
refresh, late-capture recovery, and the done screen all rehydrate from the DB
with **zero new code** — the existing `[ticketId]/page.tsx` parallel reads and
`initialItems`/`initialLegs` hydration already cover "reload in the middle." This
preserves FR-008/FR-009 for free. The paramless `/checkout` cleanly expresses
"no ticket exists yet."

**Alternatives considered**:
- *Single `/checkout` route, done screen rendered client-side from in-memory
  state*: rejected — a refresh during card-waiting would drop the waiting UI and
  the operator would never see settlement (the webhook still settles in the
  background). That is a regression against today's refresh-rehydrates behavior.
- *Keep `[ticketId]` with a sentinel id (`/checkout/new`)*: rejected — uglier,
  and the existing UUID-shape guard already `notFound()`s non-UUID segments.

## R2. One CheckoutScreen component, two data modes

**Decision**: A single client component (`checkout-screen.client.tsx`, moved up
to `app/(studio)/checkout/` so both routes import it) with a `ticketId: string | null`
prop.

- `ticketId === null` → **ephemeral mode**: cart edits (add/remove service,
  set price, assign tech, add/remove discount) mutate **local React state only**
  — no server action, no DB write. Exit control labeled "Cancel".
- `ticketId !== null` → **persisted mode**: cart edits go through the existing
  per-edit server actions exactly as today. Exit control labeled "Discard".

The rendered DOM, styling, controls, steps, and timing are **identical** in both
modes — only the data layer differs. Satisfies FR-003 (no visible change) and
FR-019 (single context-aware exit control).

**Rationale**: the client already holds the full cart in local React state
(`lines`, `legs`) and only syncs minimal deltas; the optimistic-UI path already
appends lines with temporary ids before the server confirms. Ephemeral mode is
essentially "stop syncing each edit; keep the local state." Reusing one component
prevents UI divergence between the two routes.

## R3. Persistence primitive — `pos_create_ticket_from_draft` RPC

**Decision**: One new Postgres RPC, `pos_create_ticket_from_draft(p_operator uuid,
p_items jsonb)` in migration `0020_checkout_ephemeral_draft.sql`.

In a single transaction it: INSERTs the `tickets` row (`status='open'`,
`opened_by_staff_id = p_operator`), INSERTs every `ticket_items` row from
`p_items`, computes and writes `subtotal_cents`/`total_cents`, INSERTs the
`ticket.created` audit row, and returns `{ ticket_id, subtotal_cents, total_cents }`.
All-or-nothing (FR-006). `security definer`; `revoke all from public` +
`grant execute to service_role` — matches the `pos_take_cash` convention.

`p_items` is the **already-validated, fully-resolved** row set produced by the TS
server action (see R4). The RPC is an atomic writer, not a validator — it does
not read the catalog.

`subtotal_cents = sum(unit_price_cents) where kind='service'`;
`total_cents = greatest(0, subtotal + sum(unit_price_cents) where kind='discount')`.
`tax_cents` stays 0. This satisfies `tickets_total_matches_subtotal_chk`.

**Rationale**: one writer primitive, invoked as the first step of every
payment-initiating action, keeps the existing payment RPCs (`pos_take_cash`,
`pos_compose_payment_draft`, `pos_activate_cash_draft`, `pos_record_*`) **byte-for-byte
untouched** (FR-008).

## R4. Draft validation & snapshot authority

**Decision**: The client sends the whole cart as a draft payload at submission.
The TS server action (in `actions.ts`, helper in `_cart-draft.ts`):

1. Reads the service catalog and active staff once.
2. Validates every line: the referenced service row exists; assigned staff is
   active; `unit_price_cents` is a positive integer for service lines; discount
   shape/value/note are in range; **no line has `priceUnconfirmed === true`**
   (FR-015 guard, now run against the draft).
3. Re-derives `name_snapshot` for service lines from the catalog by `serviceId`
   — the service name is **not** operator-editable, so the client string is
   never trusted.
4. Persists operator-authority values from the draft: `unit_price_cents`
   (operators can already set any price via the price-override flow),
   `assigned_staff_id`, discount shape/value/note. Percent discounts are folded
   to a final negative `unit_price_cents` using `computeTotals` in `lib/pos/cart.ts`.
5. Builds the resolved `ticket_items` row set and passes it to
   `pos_create_ticket_from_draft`.

**Snapshot timing**: today the price/name snapshot is captured at add-time. The
draft carries the snapshot the operator saw on screen; the server persists that
price so the charged total equals what the operator saw — FR-007 "identical for
the same cart." The server validates structural integrity but never silently
re-prices.

**Constitution II note**: the draft is a *proposal*, not authority. The server
re-validates every field at the persistence boundary. Nothing in the draft grants
the client a capability it did not already have — operators can already set
prices, discounts, and tech assignments through the existing per-edit actions.

**Archived-mid-session edge**: a `services` row archived during the session is
still a real row (`active=false`), so the `ticket_items.ref_id` FK is satisfied
and the name re-derivation succeeds. Validation reads the catalog **without** the
`active` filter and rejects only a `serviceId` that matches no row at all (a
corrupt draft). This matches today's behavior where an already-added line
survives the service being archived.

## R5. Payment-action input — draft-or-ticket discriminated union

**Decision**: Each payment-initiating server action accepts a discriminated input:

- `{ from: 'draft', draft }` — ephemeral path: call `pos_create_ticket_from_draft`
  to persist, obtain `ticketId`, then run the payment.
- `{ from: 'ticket', ticketId }` — already-persisted path: run the payment
  directly. Reached post-submission (e.g. switching to cash after a failed card,
  composing a second split leg).

Applies to `takeCash`, `sendCardToTerminal`, `composeDraftLeg`, and
`redeemGiftCardWholeTicket`. Each resolves to a `ticketId` (creating the ticket
if the input is a draft) then proceeds with today's logic unchanged. Every return
value includes the resolved `ticketId` so the client can `router.replace`.

**Rationale**: one action per payment type (no logic duplication); the persist
step is folded server-side. Splitting it into two client-driven round-trips
(persist, then pay) would open a client-controlled non-atomic window — rejected.

**Accepted residual** (per spec Assumptions): composing the first split-tender
leg persists the ticket; if the operator then closes the browser tab without
using the exit control, one open never-paid ticket with its items remains. Far
rarer than the browse-time ghost rows this feature eliminates, and the exit
control ("Discard" once a ticket exists) handles the non-tab-close case.

## R6. Removed — resume behavior and entry dispatch

**Decision**: Delete the `resumeOrCreateTicket` and `createEmptyTicket` server
actions and the `/checkout/page.tsx` redirect dispatch. `startNewSale()` (the
DoneScreen "new sale" button) becomes a plain `redirect('/checkout')`.

The partial index `tickets_open_by_operator_recent_idx` (created solely for the
resume hot path) is **dropped** in migration `0020` — its only reader is gone.
`tickets_status_created_at_idx` is kept (it powers paid-ticket listing).

**Rationale**: FR-013 removes the resume path entirely; every entry opens a fresh
cart. Leaving a dead index is debt; the migration already touches schema.

## R7. Audit scope

**Decision**:
- `pos_create_ticket_from_draft` emits `ticket.created` — a persisted financial
  record is born, so Principle III's "every write is audited" holds. Payload
  changes from `{created_by_entry_point}` (now meaningless) to submission context
  (`{line_count, subtotal_cents}`).
- Per-edit cart audits (`ticket.line_added`, `ticket.line_removed`,
  `ticket.line_tech_assigned`, `line.price_set`, `discount.added`,
  `discount.removed`) are **not emitted during ephemeral building** — there are
  no writes to audit. The per-edit server actions keep their `recordAudit` calls;
  those only fire in persisted mode (post-submission editing on `/checkout/[ticketId]`).
- `payment.captured`, `payment.failed`, `payment.cancelled`, `payment.draft_*`,
  `ticket.discarded`, `gift_card.*` — all unchanged.

**No audit-vocabulary change** is needed: `ticket.created` already exists in the
`AuditAction` union in `lib/auth/audit.ts`.

## R8. Exit-control consolidation (FR-019 / FR-020)

**Decision**: The two header controls today — "Cancel" (`handleCancel` →
`router.push('/dashboard')`) and "Discard" (`handleDiscard` → cancel terminal +
`discardTicket` + redirect) — collapse into **one context-aware control**:

- `ticketId === null` → label "Cancel"; leaves to `/dashboard`; zero DB effect.
- `ticketId !== null` → label "Discard"; runs today's `handleDiscard` (cancel any
  live terminal session, then `discardTicket`, then redirect). The existing
  in-flight-payment refusal (FR-011) still applies.

This is the **one accepted UI change** (FR-003). It reuses the existing
design-system `Button` — no new tokens, no layout change. The design-auditor
reviews it before completion.

## R9. Surfaces confirmed unchanged

Square webhooks, the terminal-checkout and gift-payment polling endpoints,
Supabase Realtime subscriptions, late-capture recovery, the receipt route, and
all dashboard / end-of-day reporting reads operate on **persisted** payment and
ticket rows. They are agnostic to how the ticket was born and need **no change**
(FR-008, FR-009, FR-017). The `[ticketId]/page.tsx` parallel reads and branch
logic stay exactly as today.

## R10. Stale documentation

`docs/system-design.md` describes checkout as "creates ticket if absent" on open.
That line is updated to describe deferred persistence — a one-line doc sync in
the same change set.
