# Contract — Server Actions

**Feature**: 018-gift-card-split-tender · **Plan**: [../plan.md](../plan.md) · **Data model**: [../data-model.md](../data-model.md) · **Research**: [../research.md](../research.md)

This document is the contract for the new Server Actions added to `app/(studio)/checkout/actions.ts` and the new typed errors added to `app/(studio)/checkout/_errors.ts`.

All actions follow the existing prelude from `specs/011-cash-sale-checkout/contracts/server-actions.md`:

1. `requireStudioSession()` — auth resolver; throws `AuthRedirectError`
2. Parse + validate args (zod / `assertUuid` / manual)
3. Load + status-check the ticket
4. Mutate via the service-role client
5. `recordAudit(...)` with the controlled-vocab verb
6. Return the typed result

---

## 1. `lookupGiftCard`

```ts
export async function lookupGiftCard(
  gan: string
): Promise<LookupGiftCardResult>;

export type LookupGiftCardResult =
  | { kind: "found";          giftCardId: string; last4Mask: string; balanceCents: number; state: "ACTIVE" }
  | { kind: "zero_balance";   giftCardId: string; last4Mask: string; balanceCents: 0;      state: "ACTIVE" }
  | { kind: "not_redeemable"; giftCardId: string; last4Mask: string; state: "PENDING" | "BLOCKED" | "DEACTIVATED" }
  | { kind: "not_found" };
```

**Side effects**:
- Calls Square `client.giftCards.retrieveGiftCardFromGAN({ gan })`.
- On any kind except `'not_found'`, UPSERTs into `public.gift_cards` (insert with the masked tail + current balance + state; existing row updates `balance_cents_cached`, `state`, `last_synced_at`).
- Emits one `gift_card.balance_looked_up` audit row with payload `{ last4_mask, square_gift_card_id (if any), state, balance_cents (if any) }`.

**Errors**:
- `SquareGiftCardLookupFailedError` — Square unreachable / 5xx / unhandled status. UI surfaces a retryable "Couldn't reach Square — try again".
- `SquareNotConnectedError` — reuses the existing error from feature 015. UI sends the operator to `/settings/square`.

**Validation**:
- `gan.length >= 4 && gan.length <= 19` (Square's documented GAN range — whitespace stripped before validation).
- Numeric only — letters/symbols rejected with a client-side guard and a server-side `InvalidGanError`.

---

## 2. `composeDraftLeg`

```ts
export async function composeDraftLeg(
  ticketId: string,
  method: "cash" | "card" | "gift",
  amountCents: number
): Promise<{ paymentId: string; status: "draft"; amountCents: number }>;
```

**Behaviour**:
- Calls the `pos_compose_payment_draft(p_ticket_id, p_operator, p_method, p_amount)` RPC ([data-model § 6.a](../data-model.md#6a-pos_compose_payment_draft)).
- Returns the new payment id.

**Errors**:
- `TicketNotOpenError` — ticket is `'paid'` or `'discarded'`.
- `TicketHasUnpricedItemsError` — `price_unconfirmed` line exists.
- `LegAmountInvalidError` — `amountCents <= 0` or `amountCents > remaining_owed` (the RPC raises `legs_must_fit_remaining`).
- `TicketAlreadyBeingChargedError` — a `'pending'` leg exists for this ticket (composing a new leg while one is in flight is refused).

---

## 3. `removeDraftLeg`

```ts
export async function removeDraftLeg(
  paymentId: string
): Promise<{ removed: true }>;
```

**Behaviour**:
- Calls the `pos_remove_payment_draft(p_payment_id, p_operator)` RPC ([data-model § 6.b](../data-model.md#6b-pos_remove_payment_draft)).
- Returns `{removed: true}`.

**Errors**:
- `DraftLegNotFoundError` — payment row doesn't exist, or its status is not `'draft'` (operator tried to remove a succeeded / pending / failed leg). UI surfaces "This leg can't be removed — it's already been charged".

---

## 4. `activateCashDraft`

```ts
export async function activateCashDraft(
  paymentId: string
): Promise<{ paymentId: string; status: "succeeded"; ticketFlippedToPaid: boolean }>;
```

**Behaviour**:
- Calls `pos_activate_cash_draft(p_payment_id, p_operator)` ([data-model § 6.c](../data-model.md#6c-pos_activate_cash_draft)).
- On success, returns the leg's settled state and whether this activation flipped the ticket to paid.

**Errors**:
- `DraftLegNotFoundError` — row missing or not `(status='draft', method='cash')`.
- `LegSumMismatchError` — RPC raised `legs_must_sum_to_total`. UI surfaces "Add more legs to cover the bill before charging".
- `TicketAlreadyBeingChargedError` — partial-unique-index race (a card or gift leg was activated between the operator opening this view and tapping Activate). UI surfaces the spec's "ticket already being charged" copy.
- `TicketNotOpenError` — ticket flipped to paid/discarded by a concurrent action.

---

## 5. `activateGiftDraft`

```ts
export async function activateGiftDraft(
  paymentId: string,
  gan: string
): Promise<{
  paymentId: string;
  status: "pending";                                  // settles via webhook
  squareGiftCardPaymentId: string;
}>;
```

**Behaviour**:
- Validates `paymentId` is a `(status='draft', method='gift')` row owned by an open ticket.
- Looks up the gift card via `client.giftCards.retrieveGiftCardFromGAN({gan})` (uses the cached row's `square_gift_card_id` to verify the GAN matches the cached card; refreshes the cached balance + state).
- Refuses with `GiftCardNotRedeemableError` if the card's current state is not `'ACTIVE'`.
- Refuses with `GiftCardInsufficientBalanceError` if the card's current balance < the leg's amount (the operator may have tried to activate after balance shifted under them).
- Atomically transitions the row to `status = 'pending'` (this is what the unique-in-flight index gates on).
- Calls `client.payments.create({ idempotencyKey: buildIdempotencyKey(ticketId, paymentId), sourceId: giftCardId, amountMoney: { amount: amountCents, currency: 'USD' }, referenceId: ticketId, tipMoney: { amount: 0n, currency: 'USD' } })`.
- Persists `square_gift_card_payment_id` + `gift_card_id` on the row.
- The actual settlement (`status = 'pending' → 'succeeded'`) arrives via `payment.updated` webhook → `pos_record_gift_payment` ([data-model § 6.d](../data-model.md#6d-pos_record_gift_payment)). The polling fallback at `/api/square/payment/[paymentId]` is the safety net if the webhook is delayed.

**Errors**:
- `DraftLegNotFoundError`
- `TicketAlreadyBeingChargedError`
- `GiftCardNotRedeemableError`
- `GiftCardInsufficientBalanceError`
- `SquareGiftCardPaymentFailedError` — Square `payments.create` 4xx/5xx. The row is reverted to `'failed'` with `failure_reason` set, the error is thrown.

---

## 6. `redeemGiftCardWholeTicket`

The convenience action that powers the "Gift" payment tile (Story 1 + Story 3 in one atomic sequence).

```ts
export async function redeemGiftCardWholeTicket(
  ticketId: string,
  gan: string
): Promise<RedeemGiftCardResult>;

export type RedeemGiftCardResult =
  | { kind: "fully_paid";                  paymentId: string; ticketFlippedToPaid: true }
  | { kind: "partial_split";               paymentId: string; nextDraftPaymentId: string; nextDraftAmountCents: number }
  | { kind: "lookup_zero_balance";         last4Mask: string }
  | { kind: "lookup_not_redeemable";       last4Mask: string; state: "PENDING" | "BLOCKED" | "DEACTIVATED" }
  | { kind: "lookup_not_found" };
```

**Behaviour** (per [R6](../research.md#r6--partial-gift-auto-split-flow-story-3--fr-006)):

1. Refuse with `TicketAlreadyBeingChargedError` if a `'pending'` leg exists on this ticket.
2. Run the lookup (delegates to `lookupGiftCard` internally; emits one `gift_card.balance_looked_up` audit row).
3. If `kind in {not_found, zero_balance, not_redeemable}`: return the `lookup_*` shape; no payment row created.
4. If `kind = 'found'`:
   - `remainingOwed = ticket.total_cents - sum(succeeded legs for this ticket)`
   - `amountToCharge = min(balanceCents, remainingOwed)`
   - Wipe any existing draft legs for this ticket (calls `discardDraftLegs` — the operator picked Gift as a fresh path; old drafts are stale).
   - Compose a gift-card draft for `amountToCharge` (via `pos_compose_payment_draft`).
   - Activate it via `activateGiftDraft(paymentId, gan)`.
   - If `amountToCharge < remainingOwed` (partial coverage): compose a second draft for `remainingOwed - amountToCharge`, method `'cash'` as the placeholder per [R6 sub-decision](../research.md#r6--partial-gift-auto-split-flow-story-3--fr-006). The audit payload includes `auto_split_from_gift: true, pending_method_pick: true`. Return `{kind: 'partial_split', ...}`.
   - Else return `{kind: 'fully_paid', ...}` — the activation's eventual webhook will flip the ticket to paid.

**Why one action, not two**: the spec's SC-003 demands "at most one staff tap between the gift-card success and the second method's entry screen". Splitting this into "lookup" + "redeem" + "compose-second-draft" actions would require the UI to chain three round-trips with conditional logic; bundling them ensures atomicity and a single round-trip.

**Errors**:
- All errors from `lookupGiftCard`, `composeDraftLeg`, `activateGiftDraft`.
- `TicketAlreadyBeingChargedError` (step 1).

---

## 7. `activateCardDraft` (delegates to existing `sendCardToTerminal`)

For a card draft, activation reuses the existing card-on-terminal flow from feature 015. The existing `sendCardToTerminal(ticketId)` action ([actions.ts:1219](../../../app/(studio)/checkout/actions.ts)) is extended to accept an optional `existingDraftId` argument: when present, the action transitions the existing draft row to `'pending'` instead of inserting a fresh row.

```ts
export async function sendCardToTerminal(
  ticketId: string,
  options?: { deviceId?: string; existingDraftId?: string }
): Promise<{ paymentId: string; squareTerminalCheckoutId: string }>;
```

When `options.existingDraftId` is provided:
- The action loads that draft row and verifies `(ticket_id = ticketId, status = 'draft', method = 'card')`.
- Transitions to `'pending'` atomically (gated by the unique-in-flight index).
- Proceeds with the existing Square `terminals.createCheckout` flow.

When `options.existingDraftId` is omitted (existing call shape from feature 015 — single-tender Card flow):
- The action inserts a fresh `'pending'` row directly, then proceeds — same as today.

**Errors**:
- Existing card-flow errors from feature 015 (`SquareCheckoutCreateFailedError`, `TerminalDeviceRequiredError`, etc.) are unchanged.
- New: `DraftLegNotFoundError` when `existingDraftId` is provided but the row doesn't match.

---

## 8. Modifications to existing line-mutation actions

The five line-mutation actions in `app/(studio)/checkout/actions.ts` add a single call to `discardDraftLegs(ticketId, operatorStaffId, supabase)` as the **first step** of their existing prelude (after `requireStudioSession` + `assertUuid`, before the line mutation). Their existing success-result shape gains an optional `draftsDiscarded?: number` field so the client can toast when drafts were wiped.

| Action | New first-step call | Result shape change |
|--------|--------------------|---------------------|
| `addServiceLine` | `discardDraftLegs(...)` | `+ draftsDiscarded?: number` |
| `removeLine` | `discardDraftLegs(...)` | `+ draftsDiscarded?: number` |
| `setLinePrice` | `discardDraftLegs(...)` | `+ draftsDiscarded?: number` |
| `addDiscountLine` | `discardDraftLegs(...)` | `+ draftsDiscarded?: number` |
| `removeDiscountLine` | `discardDraftLegs(...)` | `+ draftsDiscarded?: number` |

The existing `takeCash` action is **not** modified — a single-tender cash sale is still its own one-shot path (`pos_take_cash` from 0004) that bypasses the draft lifecycle. If split tender is active (one or more drafts exist), the UI does not surface the legacy `takeCash` CTA; the operator must activate cash legs individually via `activateCashDraft`.

---

## 9. New typed errors (added to `app/(studio)/checkout/_errors.ts`)

```ts
export class GiftCardNotFoundError              extends Error { name = "GiftCardNotFoundError"; }
export class GiftCardNotRedeemableError         extends Error { state: "PENDING" | "BLOCKED" | "DEACTIVATED"; }
export class GiftCardZeroBalanceError           extends Error { name = "GiftCardZeroBalanceError"; }
export class GiftCardInsufficientBalanceError   extends Error { name = "GiftCardInsufficientBalanceError"; }
export class InvalidGanError                    extends Error { name = "InvalidGanError"; }
export class SquareGiftCardLookupFailedError    extends Error { name = "SquareGiftCardLookupFailedError"; }
export class SquareGiftCardPaymentFailedError   extends Error { name = "SquareGiftCardPaymentFailedError"; }

export class TicketAlreadyBeingChargedError     extends Error { name = "TicketAlreadyBeingChargedError"; }
export class LegSumMismatchError                extends Error { name = "LegSumMismatchError"; expected: number; actual: number; }
export class LegAmountInvalidError              extends Error { name = "LegAmountInvalidError"; }
export class DraftLegNotFoundError              extends Error { name = "DraftLegNotFoundError"; }
```

All errors are constructed at the action layer; the client island narrows via `instanceof` per the existing convention.

---

## 10. Idempotency invariant

Every Server Action that calls Square uses `buildIdempotencyKey(ticketId, paymentId)` from `lib/square/terminal.ts:47`. The `paymentId` is the per-attempt entropy source — a retry of the **same** action with the **same** paymentId is safe (Square dedupes); a fresh attempt (new paymentId after a failed row) yields a brand-new charge per the per-attempt-row contract from feature 015 (FR-015).
