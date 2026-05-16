# Contract: Audit-Log Vocabulary — Checkout (Cash-Only Sale)

**Module**: `lib/auth/audit.ts`

Tang Nails' `audit_log` schema uses a free-form `text` `action` column, with the controlled vocabulary enforced by a TypeScript union (`AuditAction`) and a prefix-dispatch helper (`deriveEntityType`). This file documents the additions this feature makes. The convention is established by feature 008 — see the header comment of `lib/auth/audit.ts`.

## New `AuditAction` values

Six verbs are added by this feature, in two prefix families:

```ts
// Added in 011 (entity_type "ticket")
| "ticket.created"
| "ticket.line_added"
| "ticket.line_removed"
| "ticket.line_tech_assigned"
| "ticket.discarded"

// Added in 011 (entity_type "payment")
| "payment.captured"
```

## `deriveEntityType` extensions

The function gains two new prefix branches:

```ts
function deriveEntityType(action: AuditAction): "service" | "staff" | "auth" | "ticket" | "payment" {
  if (action.startsWith("service.")) return "service";
  if (action.startsWith("ticket.")) return "ticket";
  if (action.startsWith("payment.")) return "payment";
  // ... existing staff.* / auth.* fall-throughs
}
```

The return type of `deriveEntityType` widens to include `"ticket" | "payment"`.

## Per-verb contract

| Action | Emitted by | `entity_id` | Required `payload` keys |
|---|---|---|---|
| `ticket.created` | `createEmptyTicket` Server Action (and indirectly by `resumeOrCreateTicket` when it falls through) | the new `tickets.id` | `{ created_by_entry_point: 'dashboard_cta' \| 'sidebar_resume_or_create' \| 'done_screen_new_sale' \| 'unspecified' }` |
| `ticket.line_added` | `addServiceLine` Server Action | the new `ticket_items.id` | `{ ticket_id, service_id, unit_price_cents, price_unconfirmed }` |
| `ticket.line_removed` | `removeLine` Server Action | the deleted `ticket_items.id` | `{ ticket_id, service_id, unit_price_cents }` |
| `ticket.line_tech_assigned` | `setLineTech` Server Action | the `ticket_items.id` whose tech changed | `{ ticket_id, previous_staff_id, new_staff_id }` |
| `ticket.discarded` | `discardTicket` Server Action | the `tickets.id` being discarded | `{ subtotal_cents_at_discard, line_count_at_discard }` |
| `payment.captured` | `pos_take_cash` SQL function (NOT the `takeCash` action) | the new `payments.id` | `{ ticket_id, amount_cents }` |

### Why `payment.captured` is emitted from SQL

The audit row is written inside the same `BEGIN…COMMIT` boundary as the `payments` insert and the `tickets.status='paid'` flip. This closes the otherwise-possible window where a successful payment commit could be observed by readers before the audit row arrives (or vice versa). See research.md § R1 for the full atomic-write justification.

The `takeCash` Server Action does NOT also call `audit()` — double-emission would corrupt the `audit_log` invariant of "one row per discrete write." The SQL function is the single emitter for `payment.captured`.

## `acting_as_staff_id` and `actor_user_id`

- **SQL-emitted rows** (`payment.captured`): the function takes `p_operator` as a parameter and writes it into `acting_as_staff_id`. `actor_user_id` is NOT populated by the SQL function (the function does not have `auth.uid()` available — it runs as `service_role`). This is consistent with how the existing `lib/auth/audit.ts` documents the optional `actingAsStaffId` argument: in service-role contexts, the operator is the truth and the device user is recorded by the calling Server Action (which writes its OWN entries for the same flow's other steps).
- **Action-emitted rows** (all others): the existing `audit()` helper populates BOTH `actor_user_id` (from `auth.uid()` of the current session) and `acting_as_staff_id` (from the signed cookie).

For `takeCash`, the Server Action emits no extra audit row — the SQL-side `payment.captured` row is the canonical record. The action's normal logging (e.g., structured app-log) records the device user for ops/debugging, but does NOT write to `audit_log`.

## Compliance traceability

This contract preserves Constitution Principle III's "every mutation … traceable and reconcilable" guarantee:

| Mutation | Audit row written? |
|---|---|
| Create a ticket | yes (`ticket.created`) |
| Add a cart line | yes (`ticket.line_added`) |
| Remove a cart line | yes (`ticket.line_removed`) |
| Reassign a line's tech | yes (`ticket.line_tech_assigned`) |
| Discard a ticket | yes (`ticket.discarded`) |
| Cash payment captured | yes (`payment.captured`, from SQL) |

The action set is exhaustive for this feature — there is no mutation surface that bypasses the table above.

## Out of vocab for this phase

The following audit verbs are NOT added in this feature; they belong to later phases:

- `payment.refunded` — phase 8 (refunds)
- `payment.voided` — phase 8 (voids)
- `ticket.tip_split_set` — phase 7 (tip split)
- `cash_drawer.opened` / `cash_drawer.closed` — phase 9
- `payment.failed` — phase 5 (Square card; cash never has a `failed` status in this phase, so no audit row needed)

When those land, they follow the same prefix-dispatch convention.
