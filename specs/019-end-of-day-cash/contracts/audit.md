# Contract — Audit log additions

This feature introduces **one** new `audit_log.action` value and **one** new entity-type prefix.

## New action

| Action | Entity type | When emitted | `entity_id` | `actor_user_id` | `acting_as_staff_id` |
|--------|-------------|--------------|-------------|------------------|-----------------------|
| `cash_drawer.closed` | `cash_drawer` | Inside `pos_close_cash_drawer` on a successful close. | The closed `cash_drawer_sessions.id`. | The device's `auth.uid()` (passed by the Server Action as `p_device_user_id`). May be `NULL` if the action somehow fires outside a normal session — should not happen in v1. | The closing operator's `staff.id` (passed as `p_operator`). |

## Payload shape

```jsonc
{
  "expected_cents": 12345,        // server-recomputed expected at close
  "counted_cents": 12345,         // operator-entered counted
  "variance_cents": 0,            // counted − (opening + expected); signed
  "notes": "Gave change for $100 bill.",   // or null
  "session_id": "uuid"            // == entity_id; convenience copy
}
```

`audit_log.payload` is jsonb. Reads remain RLS-guarded — `payload` is not readable by ordinary authenticated clients (constitution § Security & Data Integrity Constraints).

## `deriveEntityType` dispatch update

Add a single line near the top of `deriveEntityType` in `lib/auth/audit.ts`:

```ts
if (action.startsWith("cash_drawer.")) return "cash_drawer";
```

Return type union extends to include `"cash_drawer"`.

## Test coverage (Vitest)

- `deriveEntityType("cash_drawer.closed")` returns `"cash_drawer"`.
- The close RPC's audit-insert path produces a row whose `payload` JSON shape matches the schema above (verified in the RPC integration test).

## Out of scope

- `cash_drawer.opened` is **not** added. v1 has no separate open-cash-count flow; the open happens lazily inside the close RPC and has no operator attribution worth a separate audit entry (the same operator and same instant are recorded by `cash_drawer.closed`). When a future "Open the day with $X" feature lands, that feature's plan adds `cash_drawer.opened` to the vocabulary.
- `cash_drawer.reopened` / `cash_drawer.adjusted` — out of scope; v1 closes are terminal.
