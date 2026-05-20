# Contract: Ephemeral Checkout Draft payload

**Feature**: `043-checkout-ephemeral-draft`

The client → server contract at submission. The checkout client serializes its
in-memory cart into this payload; the server validates it, resolves it against
the catalog, and hands the resolved rows to `pos_create_ticket_from_draft`.

## TypeScript shape (new module `app/(studio)/checkout/_draft.ts`)

```ts
export type DraftServiceLine = {
  kind: "service";
  clientLineId: string;        // crypto.randomUUID(), session-local, never persisted
  serviceId: string;
  unitPriceCents: number;      // operator-authority (override / variable price)
  priceUnconfirmed: boolean;   // must be false at submission
  assignedStaffId: string;
};

export type DraftDiscountLine = {
  kind: "discount";
  clientLineId: string;
  shape: "flat" | "percent";
  value: number;               // flat: cents; percent: whole-number percent
  note: string | null;         // <= 80 chars
};

export type DraftLine = DraftServiceLine | DraftDiscountLine;

export type CheckoutDraft = {
  lines: DraftLine[];
};
```

The operator id is **never** in the payload — it is resolved server-side from the
session (`requireStudioSession()`).

## Server-side validation & resolution

Performed by a helper in `_draft.ts`, called by every draft-path payment action
**before** `pos_create_ticket_from_draft`. Order:

1. **Non-empty**: at least one `service` line, else refuse with the same
   messaging as today's empty-ticket guard (reuse `TicketEmptyError`).
2. **No unconfirmed price**: every `service` line has `priceUnconfirmed === false`,
   else refuse with today's unpriced-items messaging (reuse
   `TicketHasUnpricedItemsError`). This is the FR-015 guard, run against the draft.
3. **Service resolution**: read `services` (no `active` filter — an archived
   service is still a valid row, matching today's "already-added line survives
   archival"). Every `serviceId` must match a row; a non-matching id is a corrupt
   draft → reject. `name_snapshot` is taken from the catalog row, never the client.
4. **Price integrity**: each `service` line's `unitPriceCents` is an integer `> 0`
   (same check as `setLinePrice`).
5. **Staff**: each `assignedStaffId` resolves to an active, non-removed `staff`
   row (same check as `addServiceLine` / `setLineTech`).
6. **Discount integrity**: `shape ∈ {flat, percent}`; `value` in range; `note`
   ≤ 80 chars (same checks as `addDiscountLine`).
7. **Resolve discounts**: fold each discount to a final negative
   `unit_price_cents` using `computeTotals` in `lib/pos/cart.ts` against the
   service subtotal, so the RPC receives ready-to-insert amounts and the
   persisted total equals what the operator saw on screen (FR-007).
8. **Total guard**: the resolved `total_cents` must be `> 0`, else refuse with
   today's empty/zero-total messaging.

Output: a `jsonb`-ready array matching `pos_create_ticket_from_draft`'s `p_items`
contract.

## Authority boundary (Constitution Principle II)

The draft is a **proposal**, not authority. Every field is re-validated at the
persistence boundary. The only values trusted *from* the client are operator-authority
fields the operator can already set through existing per-edit actions —
`unitPriceCents`, `assignedStaffId`, discount `shape`/`value`/`note`. The
non-editable `name_snapshot` is re-derived from the catalog. The operator id and
all timestamps/statuses are server-set.

## Invariants

- A draft never corresponds to any database row until a payment-initiating action
  is taken — opening checkout and building a cart write nothing (FR-001, FR-002).
- The same draft submitted twice would create two tickets; the client prevents
  double-submission with its existing `inflight` guard and the `router.replace`
  away from `/checkout` immediately after the first success.
