# Contract — Audit log additions

This feature introduces **one** new `audit_log.action` value. No new entity-type prefix — `cash_drawer.*` was added by feature 019 and the existing `deriveEntityType` dispatch already routes the new verb correctly.

## New action

| Action | Entity type | When emitted | `entity_id` | `actor_user_id` | `acting_as_staff_id` |
|--------|-------------|--------------|-------------|------------------|-----------------------|
| `cash_drawer.edited` | `cash_drawer` | Inside `pos_edit_cash_drawer` on every successful edit (including no-op edits per research R5). | The edited `cash_drawer_sessions.id`. | The device's `auth.uid()` (passed by the Server Action as `p_device_user_id`). | The editing operator's `staff.id` (passed as `p_operator`). |

## Payload shape

```jsonc
{
  "before": {
    "counted_cents": 16450,                 // value before this edit
    "variance_cents": 0,                    // value before this edit
    "notes": null                           // value before this edit (string or null)
  },
  "after": {
    "counted_cents": 16250,                 // value after this edit
    "variance_cents": -200,                 // recomputed; signed
    "notes": "Gave change for $100 bill."   // trimmed; null if empty after trim
  },
  "session_id": "uuid"                       // == entity_id; convenience copy
}
```

`audit_log.payload` is jsonb. Reads remain RLS-guarded — `payload` is not readable by ordinary authenticated clients (constitution § Security & Data Integrity Constraints).

The two server-side readers of this payload are:

1. `lib/end-of-day/history.ts` `loadCashHistoryDetail(sessionId)` — selects every `audit_log` row for `(action = 'cash_drawer.edited', entity_id = sessionId)` ordered by `created_at desc`, joins to `staff` for the editor display name, and returns them as the change-history list (FR-010).
2. The same query also produces the "Edited" pill flag (`count > 0`) and the "Last edited" line (`max(created_at)`, plus the corresponding editor) for the detail header (FR-009).

The list query (`loadCashHistoryList(opts)`) uses a lighter aggregate against `audit_log` for the per-row "Edited" pill only.

## `deriveEntityType` dispatch — unchanged

The existing rule from feature 019:

```ts
if (action.startsWith("cash_drawer.")) return "cash_drawer";
```

routes both `cash_drawer.closed` and `cash_drawer.edited` to `"cash_drawer"`. No edit to `deriveEntityType` is required.

## Test coverage (Vitest)

- `deriveEntityType("cash_drawer.edited")` returns `"cash_drawer"` (existing test extended with the new case).
- The edit RPC's audit-insert path produces a row whose `payload` JSON shape matches the schema above (covered by the RPC integration test in `contracts/rpc-pos-edit-cash-drawer.md`).
- The history query layer correctly aggregates `cash_drawer.edited` rows for the "Edited" pill flag and the "Last edited" timestamp.

## Out of scope

- `cash_drawer.reopened` — no reopen transition in v1 (research). If a future feature adds one, that feature's plan adds the verb to the vocabulary.
- A dedicated `cash_drawer.note_amended` verb for note-only edits. Rejected — the single `cash_drawer.edited` verb's payload already records the before/after of every editable field; a downstream auditor can filter by "counted unchanged AND notes changed" if they want note-only edits specifically.
