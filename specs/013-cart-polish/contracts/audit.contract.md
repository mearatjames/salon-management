# Contract: Audit-Log Vocabulary — Checkout (Cart Polish)

**Module**: `lib/auth/audit.ts`

Tang Nails' `audit_log` schema uses a free-form `text` `action` column, with the controlled vocabulary enforced by the TypeScript `AuditAction` union and a prefix-dispatch helper (`deriveEntityType`). This file documents the additions this phase makes. The convention is established by feature 008 and extended by feature 011; this is the third extension.

## New `AuditAction` values

Four verbs are added by this feature, all under `entity_type = 'ticket'`:

```ts
// Added in 013 (entity_type "ticket")
| "line.price_set"
| "discount.added"
| "discount.removed"
| "bill.emailed"
```

## `deriveEntityType` extensions

The function gains three new prefix branches (the existing four — `service.*`, `ticket.*`, `payment.*`, `staff.*`, `auth.*` — stay):

```ts
function deriveEntityType(
  action: AuditAction
): "service" | "ticket" | "payment" | "staff" | "auth" {
  if (action.startsWith("ticket."))   return "ticket";
  if (action.startsWith("payment."))  return "payment";
  if (action.startsWith("service."))  return "service";
  // NEW in this phase — all map to "ticket":
  if (action.startsWith("line."))     return "ticket";
  if (action.startsWith("discount.")) return "ticket";
  if (action.startsWith("bill."))     return "ticket";
  // … existing staff.* / auth.* fall-throughs unchanged.
}
```

Mapping all three new prefixes to `"ticket"` keeps the audit query surface narrow: "show me everything that happened to this ticket" is one `entity_type = 'ticket' AND entity_id = $1` query. (A `line` row is identified by its `ticket_items.id`, not its ticket's id, but the entity-type axis is "which kind of entity is this row about" — and all three of these are about a ticket's state.)

## Per-verb contract

| Action | Emitted by | `entity_id` | Required `payload` keys |
|---|---|---|---|
| `line.price_set` | `setLinePrice` Server Action | the affected `ticket_items.id` | `{ ticket_id, previous_unit_price_cents, new_unit_price_cents, was_unconfirmed }` |
| `discount.added` | `addDiscountLine` Server Action | the new `ticket_items.id` | `{ ticket_id, shape: 'flat'\|'percent', value: number, note: string \| null }` |
| `discount.removed` | `removeDiscountLine` Server Action | the deleted `ticket_items.id` | `{ ticket_id, shape: 'flat'\|'percent', value: number, note: string \| null }` |
| `bill.emailed` | `emailBillStub` Server Action | the `tickets.id` being billed | `{ address: string, line_snapshot: BillSnapshot }` (snapshot shape per `contracts/server-actions.md § 4`) |

### Payload shape notes

- **`line.price_set.payload.was_unconfirmed`** disambiguates the two open paths from the spec (US1 vs US2) at audit-read time without requiring an extra verb. `true` means the operator pressed Save on the auto-opened sheet (or on an unconfirmed row); `false` means an override on a confirmed row.
- **`discount.added.value`**: for `shape='flat'` this is the entered positive integer cents (NOT the stored-negative `unit_price_cents`); for `shape='percent'` this is the entered whole percent (`15` for 15%). Storing the entered value makes the audit row trivially explainable ("operator added a 15% discount") without needing to invert the sign or back out the percent from the computed amount.
- **`discount.removed.value`**: same shape as `discount.added`. Reconstructed from the row before delete: for percent rows it's `discount_pct`; for flat rows it's `-unit_price_cents` (the original positive entry).
- **`bill.emailed.line_snapshot`**: the entire bill snapshot the operator was looking at when they pressed Email. Includes the line list, the service subtotal, the discount total, the total, and the snapshot's `capturedAt` ISO timestamp. This is large by design — the audit row is the only record of what was emailed.

## `acting_as_staff_id` and `actor_user_id`

All four verbs are emitted from Node Server Actions (not from SQL), so the existing `audit()` helper populates BOTH:

- `actor_user_id` from `auth.uid()` of the current Supabase session (= `viewer.deviceUserId`).
- `acting_as_staff_id` from the signed `acting_as_staff_id` cookie (= `viewer.staff.id`).

There is no analog to phase 2's "emitted from SQL" pattern in this phase — none of the four new verbs has a money-atomicity boundary that requires emitting from inside a Postgres function.

## Compliance traceability

This contract preserves Constitution Principle III's "every mutation … traceable and reconcilable" guarantee:

| Mutation | Audit row written? |
|---|---|
| Set or override a line's price | yes (`line.price_set`) |
| Add a discount line | yes (`discount.added`) |
| Remove a discount line | yes (`discount.removed`) |
| Email the bill (stub) | yes (`bill.emailed`) |
| Print the bill | no — no server signal; `window.print()` is a browser dialog (spec explicitly requires audit only for Email) |
| Open the bill sheet | no — read-only, no mutation |
| Cancel the price sheet | no — no write happened |

The mutation set is exhaustive for this feature's new surface; phase 2's existing verbs (`ticket.line_added`, `ticket.line_removed`, `ticket.line_tech_assigned`, `payment.captured`, `ticket.discarded`, `ticket.created`) remain the audit trail for the underlying cart and payment operations.

## Out of vocab for this phase

The following audit verbs are NOT added in this feature; they belong to later phases:

- `discount.threshold_overridden` (or similar) — phase 8 (refunds/approvals), when the manager-PIN gate UI lands.
- `bill.printed` — out (no server signal; would require a JS roundtrip just to audit the operator's local print dialog).
- `bill.sent_email` — out for this phase by design (the dispatched-mail equivalent of `bill.emailed`; post-v1 may swap the verbs once real mail lands, or may keep `bill.emailed` and add a `bill.delivery_status` to track downstream provider state — that decision is a post-v1 design call).

When those land, they follow the same prefix-dispatch convention.
