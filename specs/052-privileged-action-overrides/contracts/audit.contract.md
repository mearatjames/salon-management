# Contract: Audit Vocabulary

Add to the `AuditAction` union in `lib/auth/audit.ts` (entity_type `payment` via the existing `payment.` prefix dispatch in `deriveEntityType` — no dispatch edit needed):

```ts
// Added by feature 052 (entity_type "payment")
| "payment.void_issued"
| "payment.refund_issued"
```

Inserted directly inside the settlement RPCs (like `pos_record_card_payment`), `acting_as_staff_id` = the acting owner/manager (`p_operator`).

## `payment.void_issued`

- `entity_id`: the voided ticket's id (the action concerns the whole ticket).
- `payload`:
  ```json
  {
    "ticket_id": "<uuid>",
    "reversed_total_cents": 4500,
    "refunds": [
      { "payment_id": "<original uuid>", "refund_payment_id": "<uuid>", "method": "card", "amount_cents": 4500 }
    ]
  }
  ```

## `payment.refund_issued`

- `entity_id`: the ticket id.
- `payload`:
  ```json
  {
    "ticket_id": "<uuid>",
    "resulting_status": "partially_refunded",
    "refunded_cents": 2000,
    "lines": [
      { "original_payment_id": "<uuid>", "refund_payment_id": "<uuid>", "method": "cash", "amount_cents": 2000 }
    ]
  }
  ```

## E2E assertion

Via `getAuditLogRowsSince(cursor, "payment.void_issued", [ownerStaffId])` / `"payment.refund_issued"` from `tests/e2e/_db.ts`:
- exactly one row per completed action,
- `acting_as_staff_id` = the acting owner/manager,
- payload `resulting_status` / `reversed_total_cents` match the reversal.
