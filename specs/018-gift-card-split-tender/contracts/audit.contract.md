# Contract — Audit

**Feature**: 018-gift-card-split-tender · **Plan**: [../plan.md](../plan.md) · **Data model**: [../data-model.md](../data-model.md) · **Research**: [../research.md](../research.md)

This document is the contract for the `AuditAction` extension and the `deriveEntityType` extension in `lib/auth/audit.ts`. Every state-changing Server Action emits exactly the audit row this document names.

---

## 1. New `AuditAction` verbs

Added to the controlled-vocabulary union in `lib/auth/audit.ts`:

```ts
export type AuditAction =
  | /* ... existing verbs from features 001..015 ... */
  | "payment.draft_created"
  | "payment.draft_removed"
  | "gift_card.balance_looked_up"
  | "gift_card.redeemed";
```

The existing `payment.captured` / `payment.failed` verbs are **reused** for activation outcomes — no new verbs for those.

---

## 2. `deriveEntityType` extension

The mapping function gains one new branch:

```ts
export function deriveEntityType(action: AuditAction): EntityType {
  if (action.startsWith("gift_card.")) return "gift_card";   // NEW
  if (action.startsWith("integration.")) return "integration"; // from feature 015
  if (action.startsWith("payment.")) return "payment";
  // ... existing prefix dispatch
}
```

The `EntityType` union gains the `"gift_card"` value alongside `"payment"`, `"integration"`, `"staff"`, etc.

---

## 3. Per-verb payload shapes

Every audit row's `payload jsonb` follows the shape below. Tests assert the keys + types via the cursor-scoped audit helper in `tests/e2e/_db.ts`.

### 3.a `payment.draft_created`

Emitted by `pos_compose_payment_draft` (inside the RPC, via `insert into audit_log`).

| Field | Type | Notes |
|-------|------|-------|
| `ticket_id`             | uuid    | The owning ticket. |
| `method`                | text    | `'cash' | 'card' | 'gift'`. |
| `amount_cents`          | int     | The leg's amount. |
| `remaining_owed_cents`  | int     | The ticket's remaining-owed *before* this draft was inserted (for forensic reconstruction). |
| `auto_split_from_gift`  | bool?   | Present and `true` when this draft was synthesized by `redeemGiftCardWholeTicket` as the remainder leg after a partial gift-card charge. Omitted otherwise. |
| `pending_method_pick`   | bool?   | Present and `true` when `auto_split_from_gift = true` — signals to the UI that this draft's method needs to be picked by the operator before activation. |

**entity_type**: `payment`
**entity_id**: the new payment row's id

### 3.b `payment.draft_removed`

Emitted by `pos_remove_payment_draft` (operator-initiated) and by `discardDraftLegs` (cart-edit invalidation).

| Field | Type | Notes |
|-------|------|-------|
| `ticket_id`             | uuid    | The owning ticket. |
| `method`                | text    | The discarded leg's method. |
| `amount_cents`          | int     | The discarded leg's amount. |
| `reason`                | text    | `'operator_removed'` (from `pos_remove_payment_draft`) or `'cart_edit_invalidated'` (from `discardDraftLegs`). |

**entity_type**: `payment`
**entity_id**: the discarded payment row's id

### 3.c `gift_card.balance_looked_up`

Emitted by `lookupGiftCard` and (transitively) by `redeemGiftCardWholeTicket` — one row per lookup attempt, regardless of outcome.

| Field | Type | Notes |
|-------|------|-------|
| `last4_mask`            | text    | Per Clarifications Q1 — `'1234'` style. |
| `square_gift_card_id`   | text?   | Present when the lookup found a card (regardless of redeemability). Omitted on `'not_found'`. |
| `state`                 | text?   | `'ACTIVE' | 'PENDING' | 'BLOCKED' | 'DEACTIVATED'`. Omitted on `'not_found'`. |
| `balance_cents`         | int?    | Present on `'found'` and `'zero_balance'`. Omitted otherwise. |
| `result_kind`           | text    | The discriminated union's `kind` field — `'found' | 'zero_balance' | 'not_redeemable' | 'not_found'`. |

**entity_type**: `gift_card`
**entity_id**: `gift_cards.id` (if a row was upserted) or `null` (on `'not_found'`).

### 3.d `gift_card.redeemed`

Emitted by `pos_record_gift_payment` when the RPC settles a leg to `'succeeded'`.

| Field | Type | Notes |
|-------|------|-------|
| `ticket_id`             | uuid    | The owning ticket. |
| `payment_id`            | uuid    | Our local `payments.id`. |
| `square_gift_card_id`   | text    | Stable Square id. |
| `square_payment_id`     | text    | The Square Payment object id. |
| `last4_mask`            | text    | Read from the joined `gift_cards.last4_mask`. |
| `amount_cents`          | int     | The charged amount. |
| `ticket_flipped_to_paid`| bool    | Whether this leg's settlement closed the ticket. |

**entity_type**: `gift_card`
**entity_id**: `gift_cards.id`

---

## 4. Reused verbs (no payload changes)

The following verbs are emitted by this feature but their payload shapes are inherited from feature 015 unchanged:

- `payment.captured` — emitted by `pos_activate_cash_draft` (when the cash leg succeeds) and by `pos_record_card_payment` (existing terminal flow). Payload: `{ticket_id, method, amount_cents, tip_cents}`. The `method` field disambiguates by leg type.
- `payment.failed` — emitted by `pos_record_gift_payment` (when the gift leg settles `'failed'`), and by the existing card paths. Payload unchanged.

---

## 5. Cursor-scoped assertions in e2e

Per CLAUDE.md and the convention in `tests/e2e/_db.ts`, every e2e spec opens a per-test audit cursor with `newAuditCursor()` before the user actions, and asserts the expected audit-row sequence with `getAuditLogRowsSince(cursor)`. Example (from `gift-card-full-balance.spec.ts`):

```ts
const cursor = await newAuditCursor();

// ... operator redeems a full-balance gift card on a $40 ticket ...

const rows = await getAuditLogRowsSince(cursor);
expect(rows.map((r) => r.action)).toEqual([
  "gift_card.balance_looked_up",   // step 2 of redeemGiftCardWholeTicket
  "payment.draft_created",         // step 4 — the gift-card draft
  // (the gift leg's pending → succeeded transition is asynchronous via webhook)
  "gift_card.redeemed",            // emitted by pos_record_gift_payment on webhook arrival
]);
```
