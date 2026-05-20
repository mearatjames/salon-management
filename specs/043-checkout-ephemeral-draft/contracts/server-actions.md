# Contract: Checkout server-action surface changes

**Feature**: `043-checkout-ephemeral-draft`
**File**: `app/(studio)/checkout/actions.ts`

What the `/speckit-plan` decisions change in the exported server-action surface.
Actions not listed are **unchanged**.

## Removed

| Action | Reason |
|--------|--------|
| `createEmptyTicket(entryPoint)` | No ticket is created on page open (FR-001). |
| `resumeOrCreateTicket()` | Resume is removed; every entry is a fresh draft (FR-013). |

The `/checkout/page.tsx` redirect dispatch that called these is removed — the
page renders the draft cart directly.

## Changed — payment-initiating actions accept a draft

Each of these gains a discriminated input: it can be given an **ephemeral draft**
(persist-then-pay) or an **already-persisted ticket id** (pay directly). Every
return value gains the resolved `ticketId`.

```ts
type PaymentTarget =
  | { from: "draft"; draft: CheckoutDraft }
  | { from: "ticket"; ticketId: string };
```

| Action | New input | Behavior |
|--------|-----------|----------|
| `takeCash` | `PaymentTarget` | Draft path: validate+resolve draft → `pos_create_ticket_from_draft` → `pos_take_cash`. Ticket path: `pos_take_cash` directly. Returns `{ ticketId, paymentId, chargedCents }`. |
| `sendCardToTerminal` | `PaymentTarget` (+ existing `deviceId?` / `existingDraftId?`) | Draft path: persist first, then today's pending-row + Square `createCheckout` logic. Returns `{ ticketId, paymentId, squareTerminalCheckoutId }`. |
| `composeDraftLeg` | `PaymentTarget` (+ `method`, `amountCents`) | Draft path: persist first, then `pos_compose_payment_draft`. Composing the first split leg is a payment-initiating action (FR-005). Returns `{ ticketId, paymentId, status, amountCents }`. |
| `redeemGiftCardWholeTicket` | `PaymentTarget` (+ `gan`) | Draft path: persist first, then today's gift redemption. Returns include `ticketId`. |

The persist step inside the draft path resolves the operator from the session and
runs the `_cart-draft.ts` validation/resolution helper before the RPC. The empty-cart
and unconfirmed-price refusals surface with **today's messaging** (FR-015) —
reuse `TicketEmptyError` / `TicketHasUnpricedItemsError`; no new error class is
needed.

`lookupGiftCard(gan)` is **unchanged** — it is read-only and persists no ticket.

## Changed — `startNewSale`

`startNewSale()` (the DoneScreen "new sale" button action) drops the
`createEmptyTicket()` call and becomes `redirect("/checkout")`.

## Unchanged actions (operate only on persisted tickets)

These already require a persisted ticket and are reached only in **persisted
mode** (`/checkout/[ticketId]`, after a payment was initiated). Their signatures
and bodies are untouched:

`addServiceLine`, `removeLine`, `setLineTech`, `setLinePrice`, `addDiscountLine`,
`removeDiscountLine`, `discardTicket`, `cancelTerminalPayment`, `removeDraftLeg`,
`activateCashDraft`, `activateGiftDraft`, `emailBillStub`.

Their per-edit `recordAudit` calls remain — they simply do not fire during
ephemeral cart building (no writes happen there). They fire only when the cart is
edited after a ticket has been persisted (split-tender continuation,
failed-payment retry).

## Client navigation contract

After any successful draft-path submission the client calls
`router.replace(\`/checkout/${ticketId}\`)`. The destination route's existing
SSR (`[ticketId]/page.tsx`) rehydrates the done screen, card-waiting stage, or
split-tender footer from `initialItems` / `initialLegs` — exactly as a
refresh-in-the-middle does today. No new client rehydration code is required.

## Webhooks, polling, realtime

`app/api/webhooks/square/route.ts`, `app/api/square/terminal-checkout/[id]/route.ts`,
`app/api/square/payment/[paymentId]/route.ts`, and the Realtime subscription all
key off persisted `payments` rows and are **unchanged** (FR-008, FR-009).
