# Phase 0 — Research: Gift Card Redemption & Split-Tender Checkout

**Feature**: 018-gift-card-split-tender · **Source**: [spec.md](./spec.md) · **Constitution**: v1.0.3

This document resolves every NEEDS-CLARIFICATION-equivalent decision needed before Phase 1 (data-model / contracts / quickstart) can be written. Each item carries a Decision, Rationale, and Alternatives-Considered block. Where a downstream Phase 1 artifact directly depends on a decision, the artifact is named.

---

## R1 — Draft-leg state machine: where does the "composed-but-not-activated" leg live?

**Decision**: Add a new `'draft'` value to the existing `public.payment_status` enum. A pending unactivated split-tender leg is a row in `public.payments` with `status = 'draft'`. The state machine for a leg is:

```text
   compose                activate           settle (webhook / instant)
draft  ───────►  pending ─────────►  succeeded | failed
   │
   ├─► (operator removes via removeDraftLeg)  → row deleted
   └─► (cart edit invalidates)                → row deleted via discardDraftLegs()
```

Cash legs that auto-record on activation transition `draft → succeeded` directly (no `pending` intermediate — cash doesn't settle asynchronously).

**Rationale**:
- One canonical "list this ticket's legs" query (the cart, the receipt, the End-of-Day report) instead of a UNION across two tables.
- The legs-sum-to-total guard (FR-012, FR-016) is a single `SUM(amount_cents) FROM payments WHERE ticket_id = $1 AND status IN ('draft', 'pending', 'succeeded')`.
- Keeps the per-leg-as-payments-row model from feature 015 intact (`pos_record_card_payment` doesn't change shape).
- The existing payments queries that filter by `status = 'succeeded'` (receipt rendering, End-of-Day totals) naturally ignore drafts, so no caller is silently broken.

**Alternatives considered**:
- Separate `payment_drafts` table — rejected: forces UNION queries; the legs-sum-to-total guard becomes a two-table read inside the RPC; cart UI has to merge two ordered lists.
- Reuse `status = 'pending'` for drafts too — rejected: the unique-in-flight index from R4 needs to fire only on activated legs, not on composed drafts. Conflating the two would either block legitimate multi-draft composition or require a second discriminator column.

**Phase 1 impact**: `data-model.md` documents the enum extension and the new state transitions; `contracts/server-actions.md` documents `composeDraftLeg` / `removeDraftLeg` / `activateCashDraft` shapes.

---

## R2 — Idempotency key for gift-card `payments.create`

**Decision**: Reuse `buildIdempotencyKey(ticketId, paymentId)` from `lib/square/terminal.ts:47` (SHA-256 of `${ticketId}:${paymentId}`, first 32 hex chars). All leg-level Square calls — terminal checkout, gift-card payment, future refunds — share one idempotency-key shape.

**Rationale**:
- Constitution Principle III says the key MUST be deterministic from `(ticket_id, payment_id)`. Reusing the helper preserves the invariant for free.
- Same retry semantics as the existing card path: a retried network call (same paymentId) returns the same Square payment; a fresh attempt (new paymentId after a failed row) produces a fresh Square payment.
- One helper, one test fixture, one place to audit.

**Alternatives considered**:
- Per-method idempotency keys (`gift:${ticket}:${payment}`) — rejected: the discriminator is already implicit in `payments.method`; adding a string prefix to the key serves no purpose and breaks the audit-trail symmetry with the card path.
- Use Square's auto-generated idempotency keys (omit the field) — rejected: violates Constitution Principle III's "deterministic from ticket_id + payment_id" rule and removes our ability to dedupe across our own retries.

**Phase 1 impact**: `lib/square/gift-cards.ts` imports `buildIdempotencyKey` from `terminal.ts`; `contracts/server-actions.md` documents the per-leg idempotency invariant.

---

## R3 — Square gift-card error mapping

**Decision**: `lookupGiftCard(gan)` returns a discriminated-union result of the form:

```ts
type LookupResult =
  | { kind: "found"; giftCardId: string; last4Mask: string; balanceCents: number; state: "ACTIVE" }
  | { kind: "not_redeemable"; giftCardId: string; last4Mask: string; state: "PENDING" | "BLOCKED" | "DEACTIVATED" }
  | { kind: "zero_balance"; giftCardId: string; last4Mask: string; balanceCents: 0; state: "ACTIVE" }
  | { kind: "not_found" };
```

Square's `giftCards.retrieveGiftCardFromGAN` returns either a `GiftCard` object (with a `state` field of `ACTIVE | PENDING | BLOCKED | DEACTIVATED` and a `balance_money` field) or an error envelope. The action maps as follows:

| Square response | Action result |
|-----------------|---------------|
| 200 OK, `state = ACTIVE`, `balance_money.amount > 0` | `{kind: "found", ...}` |
| 200 OK, `state = ACTIVE`, `balance_money.amount = 0` | `{kind: "zero_balance", ...}` |
| 200 OK, `state = PENDING / BLOCKED / DEACTIVATED` | `{kind: "not_redeemable", state, ...}` |
| 404 NOT_FOUND, or 400 INVALID_REQUEST_ERROR with `code = NOT_FOUND` | `{kind: "not_found"}` |
| Other 4xx/5xx | thrown as `SquareGiftCardLookupFailedError` (the UI surfaces a retryable "Couldn't reach Square — try again") |

**Rationale**:
- The UI never sniffs Square's raw status strings — it switches on `kind` (a closed set of three success kinds + one not-found + one thrown error).
- The four redeemability states cover every spec edge case (Story 1, Story 3, the not-found / blocked / zero-balance edge cases) without leaking Square-specific vocabulary into the cart code.
- A `state = ACTIVE` + balance = 0 card distinct from a `BLOCKED` card means the UI copy is honest about WHY redemption can't proceed.

**Alternatives considered**:
- Return Square's raw status string and let the UI do the switch — rejected: violates Constitution Principle II (server is authoritative; client doesn't get Square-shaped objects) and creates a string-sniffing surface that would break silently when Square renames a value.
- Throw on every non-redeemable case — rejected: a zero-balance card is a perfectly normal operational case; throwing turns a normal UX flow into an error UX flow.

**Phase 1 impact**: `lib/square/gift-cards.ts` exports the discriminated-union type; `contracts/server-actions.md` documents `lookupGiftCard`.

---

## R4 — Concurrent-charge protection (FR-022)

**Decision**: Add a unique partial index `create unique index payments_one_in_flight_per_ticket_idx on payments (ticket_id) where status = 'pending';` to the migration. Application-layer catches `23505 unique_violation` on activation and translates to `TicketAlreadyBeingChargedError`.

**Rationale**:
- Single SQL statement enforces: "at most one activated-but-not-yet-settled leg per ticket".
- Survives every kind of concurrency: two browser tabs on the same ticket, two devices on the same ticket, a server-action retry that races with the original.
- Plain English in `\d+ payments` output — the operator-onboarding doc can show it as a screenshot.
- The same constraint enforces FR-019a (cart frozen during in-flight leg) at the database — the client-side disable is then just a UX optimization, not a correctness one.

**Alternatives considered**:
- Per-ticket Postgres advisory lock — rejected: process-scoped, doesn't survive Server Action retries cleanly; harder to observe in production.
- Application-layer check-then-set on a `tickets.active_payment_id` column — rejected: classic check-then-set race; would need a `SELECT ... FOR UPDATE` anyway, at which point the partial index is simpler.
- `payments` row-level lock (`SELECT FOR UPDATE`) without the index — rejected: only locks rows you've already read, not rows about to be inserted by a competing transaction.

**Phase 1 impact**: `data-model.md` documents the index; `contracts/server-actions.md` documents `TicketAlreadyBeingChargedError`.

---

## R5 — Cart-edit invalidation policy

**Decision**: A single helper `discardDraftLegs(ticketId, supabase)` in `app/(studio)/checkout/_drafts.ts`. Each of the five line-mutation Server Actions (`addServiceLine`, `removeLine`, `setLinePrice`, `addDiscountLine`, `removeDiscountLine`) calls it as the first step, before the line mutation runs. The helper:

1. `SELECT id FROM payments WHERE ticket_id = $1 AND status = 'draft' FOR UPDATE`
2. For each row, emit a `payment.draft_removed` audit row (via `recordAudit`).
3. `DELETE FROM payments WHERE ticket_id = $1 AND status = 'draft'`.

Returns `{discardedCount: number}` so the calling action can include it in its success result and the UI can toast "2 split-tender legs cleared because the cart changed".

Succeeded legs (`status = 'succeeded'`) are not touched. Pending legs (`status = 'pending'`) are also not touched — but the existence of any `'pending'` row should make the calling action refuse the mutation entirely (FR-019a), surfaced as `TicketAlreadyBeingChargedError`.

**Rationale**:
- One chokepoint = one audit policy = one test fixture covering all five actions.
- Putting the policy in the action layer (not a DB trigger) lets us emit per-leg audit rows with the operator and device-user attribution that triggers can't see (Constitution Principle III).
- The result shape (`discardedCount`) lets the UI explain to the operator what happened, instead of silently dropping their split composition.

**Alternatives considered**:
- DB trigger on `ticket_items` INSERT/UPDATE/DELETE — rejected: can't emit audit rows with operator/device attribution; can't return a count to the calling action; harder to test in isolation.
- Repeating the policy in each action — rejected: five copies to keep in sync, audit-row drift inevitable.
- Letting drafts survive cart edits (no invalidation) — rejected: a draft composed against a $40 ticket that becomes a $50 ticket would silently let the operator activate a leg that no longer covers the bill.

**Phase 1 impact**: `data-model.md` documents the helper's pseudocode; `contracts/server-actions.md` documents which actions call it and what the action result shape gains.

---

## R6 — Partial-gift auto-split flow (Story 3 / FR-006)

**Decision**: One Server Action `redeemGiftCardWholeTicket(ticketId, gan)` performs the full Story 1 / Story 3 transition atomically:

1. Look up the card via Square (uses the typed result from R3).
2. If `kind = "not_found" | "not_redeemable" | "zero_balance"` → return that to the UI; no DB writes (apart from the `gift_card.balance_looked_up` audit row + the gift-card cache row).
3. If `kind = "found"`:
   - `amountToCharge = min(balanceCents, ticket.total_cents - sumSucceededLegs)`
   - Insert a gift-card payment row at `status = 'draft'`, amount = `amountToCharge`.
   - Activate it via `activateGiftDraft(paymentId, gan)` — which creates the Square payment.
   - If `amountToCharge < ticket.total_cents - sumSucceededLegs` (partial coverage): synthesize a *second* draft row at `amount = remainingOwed`, `method = ?`. **Open question:** what method does the pre-populated draft default to? Spec FR-006: "The staff MUST only need to pick a method and activate that pre-populated leg". So the draft has `amount` set but **no method yet**. Schema impact: `payments.method` is currently NOT NULL — the pre-populated row would need a sentinel value or the column would need to become nullable.
     - **Sub-decision**: keep `payments.method` NOT NULL. The pre-populated leg uses `method = 'cash'` as the placeholder (the most common default in a salon) but is rendered in the UI as "Pick a method" with no amount-edit affordance; tapping it opens the method picker which UPDATEs the row's `method` and then runs the activation flow. The audit row for this transition is `payment.draft_created` with payload `{auto_split_from_gift: true, pending_method_pick: true}`.

**Rationale**:
- Atomicity: the cart never sees a half-applied state. If the activation fails midway, the whole transaction rolls back.
- One round-trip from the UI to "ready to pick second method".
- Matches SC-003 ("at most one staff tap between the gift-card success and the second method's entry screen") — the tap is on the pre-populated leg row, which immediately routes to the method-specific activation flow.

**Alternatives considered**:
- Two separate UI actions (lookup → confirm → activate) — rejected: at least one extra round-trip and one extra tap; would fail SC-003.
- Make `payments.method` nullable for the pre-populated draft — rejected: weakens the schema's invariant that every payment knows its method; existing queries (receipt render, End-of-Day) would have to handle the null case.
- Use a fresh enum value `'unspecified'` for the placeholder method — rejected: adds permanent vocabulary for a transient state. The "method = 'cash' but pending_method_pick = true in the audit" approach keeps the enum clean.

**Phase 1 impact**: `contracts/server-actions.md` documents `redeemGiftCardWholeTicket`'s return shape (it returns the activated leg's status + the new pre-populated draft's id, if any).

---

## R7 — Gift-card webhook handling

**Decision**: Extend the existing `/api/webhooks/square` route to dispatch `payment.updated` events to a new `handlePaymentUpdated(event)` function in `lib/square/webhooks.ts`. The existing `terminal.checkout.updated` path stays unchanged. The dispatcher in the route handler is a small switch:

```ts
switch (event.type) {
  case "terminal.checkout.updated":
    return handleTerminalCheckoutUpdated(event);
  case "payment.updated":
    return handlePaymentUpdated(event);
  default:
    return { ok: true, ignored: true, reason: `unsupported_event_type_${event.type}` };
}
```

`handlePaymentUpdated`:
1. Verify merchant-id match (defense-in-depth, same as `handleTerminalCheckoutUpdated`).
2. Extract `payment.source_type = 'GIFT_CARD'` — if not, return `{ok: true, ignored: true, reason: 'non_gift_card_payment'}` (we don't process card-on-terminal payments via this event; those flow through `terminal.checkout.updated`).
3. Look up the `payments` row by `square_gift_card_payment_id`.
4. Call `pos_record_gift_payment(paymentId, newStatus, raw)` — the RPC handles the `status='pending'` predicate and the ticket-paid flip.

The polling fallback at `/api/square/payment/[paymentId]` returns local DB state only — no live Square call — same shape as the terminal-checkout polling endpoint.

**Rationale**:
- Reuses the entire webhook infrastructure from feature 015 (signature verification, merchant-id check, idempotency invariant, response codes).
- Gift-card payments settle synchronously at Square (the `payments.create` response itself contains the final status); the webhook is confirmation-after-the-fact, not the primary settlement signal. So polling is the primary path and webhook is the eventual-consistency confirmation.
- One dispatcher in one place — the route handler stays small.

**Alternatives considered**:
- A separate `/api/webhooks/square/gift-card` endpoint — rejected: Square sends all event types to one configured URL; splitting forces an extra Square dashboard config and breaks the single-endpoint-to-debug invariant.
- Skip the webhook entirely (rely on `payments.create` response only) — rejected: violates the Constitution's idempotency contract — if our `payments.create` call succeeds at Square but our DB write fails, the webhook is the only mechanism to converge state.

**Phase 1 impact**: `contracts/webhooks.contract.md` documents the dispatcher + the `payment.updated` handler.

---

## R8 — GAN entry & on-disk masking

**Decision**:
- Client-side: the GAN is collected by a modal numpad sheet adapted from `components/lacquer/numeric-keypad.client.tsx`. The numpad accepts 4 to 19 digits (Square's documented GAN range). After the operator commits, the input is dropped from React state; only the masked tail (`••••1234`) is retained for display.
- Server-side: the GAN is sent in the Server Action payload, used immediately to call Square, and never persisted. The cache row in `gift_cards` stores `last4_mask text` (e.g., `'1234'`) and the upstream `square_gift_card_id text unique` — the stable correlation key. The full GAN never reaches Postgres.
- Audit rows reference the masked tail and the `square_gift_card_id` per the Clarifications session (Q1).

**Rationale**:
- Defends against any future leak of the salon's Postgres data — a `pg_dump` exposes only masked tails.
- The `square_gift_card_id` is sufficient to re-look-up the card at Square's dashboard for dispute investigations.
- The numpad pattern is already in the codebase (`numeric-keypad.client.tsx`) so the UX is consistent with PIN entry.

**Alternatives considered**:
- Hash the GAN — rejected: the Clarifications session (Q1) explicitly chose "Mask to last 4 only"; adding a hash creates a custody question (where does the hash key live?) without operational benefit.
- Store the full GAN encrypted at rest — rejected: same Clarifications question rejected this; expands custody surface for an operational win the salon doesn't need.

**Phase 1 impact**: `data-model.md` documents `gift_cards.last4_mask` and `gift_cards.square_gift_card_id`; `contracts/server-actions.md` documents the GAN-in / mask-out shape of `lookupGiftCard`.

---

## R9 — Split-mode persistence (FR-014a)

**Decision**: Drafts are `payments` rows with `status = 'draft'`. They survive reload because they live in Postgres. The checkout-screen RSC loads them at page-load time (alongside the existing succeeded legs) and passes both to the client island. Resumption is automatic — no special "restore from local storage" code path.

When the ticket flips to `paid`, drafts are deleted (defensive — drafts should not remain on a paid ticket, but this is a belt-and-suspenders cleanup). When the ticket is voided (future feature), drafts are deleted in the same RPC.

**Rationale**:
- Aligns with the Clarifications session (Q5) decision "Persisted server-side per ticket".
- Reuses the existing checkout-screen RSC's "load ticket + payments" plumbing — no new endpoint, no new client cache.
- "Open the same ticket on a second device" naturally restores the same drafts (FR-022 still prevents both devices from activating simultaneously).

**Alternatives considered**:
- LocalStorage / IndexedDB on the client — rejected: doesn't survive device switch; explicit no per the Clarifications session.
- A separate `payment_drafts` table — rejected per R1.
- TTL'd persistence (auto-discard after N minutes of inactivity) — rejected per the Clarifications session (option C of Q5).

**Phase 1 impact**: `app/(studio)/checkout/[ticketId]/page.tsx` is documented in `plan.md` § Source Code as the load-and-pass site; no new contract.

---

## R10 — Extending the local Square stub

**Decision**: Extend `tests/e2e/_square-stub.ts` (the existing local Square HTTP stub from feature 015) with two new endpoints:

| Endpoint | Method | Behavior |
|----------|--------|----------|
| `/v2/gift-cards/from-gan` | POST | Returns deterministic fixtures keyed by the GAN's last 4 chars (see fixture matrix below). |
| `/v2/payments` (when `source_type = "GIFT_CARD"`) | POST | Returns a synthesized payment object with `status = "COMPLETED"` and the requested amount. Stores the payment id so the simulated webhook fixture can fire `payment.updated` for it. |

Fixture matrix (GAN-suffix → response):

| Suffix | Response |
|--------|----------|
| `0001` | ACTIVE, balance $60 |
| `0002` | ACTIVE, balance $15 |
| `0003` | ACTIVE, balance $5 |
| `0000` | ACTIVE, balance $0 (zero-balance edge case) |
| `BLKD` | BLOCKED |
| `PEND` | PENDING |
| `DEAC` | DEACTIVATED |
| anything else (incl. `9999`) | NOT_FOUND |

E2E specs construct GANs by suffix — e.g. `"6000 1234 5678 0001"` for "ACTIVE $60", `"6000 1234 5678 BLKD"` for "blocked card". The stub is deterministic and offline.

**Rationale**:
- Mirrors feature 015's testing pattern (the existing `_square-stub.ts` already handles terminal endpoints with similar fixture matrices).
- No live Square sandbox dependency in CI — the e2e suite stays fast and offline-runnable.
- The fixture matrix lines up exactly with the spec's edge cases and user stories, so each spec can declare which fixture it needs at the top.

**Alternatives considered**:
- Live Square Sandbox in CI — rejected: requires shared sandbox credentials, introduces network flakiness, and the sandbox doesn't always honor pre-created card balances under load.
- Per-spec mocks — rejected: would duplicate the stub setup in every e2e file.

**Phase 1 impact**: `quickstart.md` documents the fixture matrix and the GAN-construction convention for new tests.
