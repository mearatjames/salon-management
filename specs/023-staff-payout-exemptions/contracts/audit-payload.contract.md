# Contract: Audit-log payload — `staff.updated` extension

**Feature**: `023-staff-payout-exemptions` · **Date**: 2026-05-17

The audit-payload contract for the extended `staff.updated` row. No new action verbs, no audit-log schema change — content-only extension of the existing JSONB `payload` column.

---

## 1. No new action verbs

The migration does NOT add new entries to `AuditAction` in `lib/auth/audit.ts`. Reused: `staff.updated`. The three new fields are diff content within the existing payload shape.

Rationale: per 006, `staff.updated` already represents "any mutation to a staff row that isn't structural (add/deactivate/remove)". The three new fields are mutations of the same row — same verb is correct. Adding three new verbs (`staff.card_fee_exempt_changed`, etc.) would inflate the audit-log vocabulary for zero analytical gain.

---

## 2. Payload shape

The `payload` column of `audit_log` for a `staff.updated` row is a JSONB object of shape:

```ts
type StaffUpdatedPayload = {
  before: Partial<StaffSnapshot>;
  after: Partial<StaffSnapshot>;
  changes: readonly (keyof StaffSnapshot)[];
};

type StaffSnapshot = {
  display_name: string;
  role: StudioRole;
  color_token: string;
  active: boolean;
  card_fee_exempt: boolean;             // NEW in 023
  supply_mode: 'apply' | 'partial' | 'exempt'; // NEW in 023
  supply_except: readonly string[];      // NEW in 023 — raw uuids only
};
```

- `before` and `after` are scoped projections of the StaffSnapshot — only the keys that changed appear.
- `changes` is the ordered list of changed keys in `STAFF_DIFF_KEYS` order (display_name first, supply_except last).
- When a save is a no-op (no key differs), NO audit row is written.

## 3. STAFF_DIFF_KEYS order (canonical)

Implementation MUST use this exact array order in `_audit-diff.ts`:

```ts
export const STAFF_DIFF_KEYS = [
  "display_name",
  "role",
  "color_token",
  "active",
  "card_fee_exempt",
  "supply_mode",
  "supply_except",
] as const;
```

The order is consumed by the audit viewer (downstream) when rendering the diff — preserving order makes diff readability consistent across audit rows. New fields appended (not interleaved) so existing diff payload readers continue to work.

## 4. `supply_except` diff entries — raw uuids only

When `supply_except` changes, the diff stores **raw uuids**:

```jsonc
{
  "before": { "supply_except": ["aaaa-...", "bbbb-..."] },
  "after":  { "supply_except": ["aaaa-..."] },
  "changes": ["supply_except"]
}
```

The audit viewer (downstream, NOT built in this feature) resolves uuids to current `supply_types.name` values at render time. If a uuid has been archived in the catalog by the time of viewing, the viewer MUST display the current name with a muted "Archived" pill (per FR-015) — this is a viewer-side responsibility, NOT a write-time concern.

Why raw uuids (not name snapshots): renames of supply types should propagate to historical audit rows automatically. Snapshotting names would freeze the display value at write time, causing "Chrome powder" to forever appear in old audit rows even after it was renamed to "Chrome powders" — the operator would see two names for the same thing and be confused about which one was current.

## 5. Array-equality semantics for `supply_except`

Two `supply_except` arrays are considered equal iff they contain the same set of uuids (order-insensitive). This is the rule the diff predicate uses:

```ts
function arrayEquals(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return [...a].sort().join(',') === [...b].sort().join(',');
}
```

The validator (`validateSupplyExcept`) dedupes via `Set` before save, so the persisted array contains no duplicates. The order-insensitive comparison is robust against the rare case where the DB returns elements in a different order than they were inserted.

## 6. Diff entry examples

### 6.1 Card-fee toggle off → on (back to default)

```jsonc
{
  "action": "staff.updated",
  "entity_id": "<staff_id>",
  "actor_user_id": "<viewer.user.id>",
  "acting_as_staff_id": "<viewer.staff.id>",
  "payload": {
    "before": { "card_fee_exempt": true },
    "after": { "card_fee_exempt": false },
    "changes": ["card_fee_exempt"]
  }
}
```

### 6.2 Supply mode apply → partial with two ticks

```jsonc
{
  "action": "staff.updated",
  "entity_id": "<staff_id>",
  "actor_user_id": "<viewer.user.id>",
  "acting_as_staff_id": "<viewer.staff.id>",
  "payload": {
    "before": {
      "supply_mode": "apply",
      "supply_except": []
    },
    "after": {
      "supply_mode": "partial",
      "supply_except": ["aaaa-...", "bbbb-..."]
    },
    "changes": ["supply_mode", "supply_except"]
  }
}
```

### 6.3 Supply mode partial → exempt (array wipes)

```jsonc
{
  "action": "staff.updated",
  "entity_id": "<staff_id>",
  "actor_user_id": "<viewer.user.id>",
  "acting_as_staff_id": "<viewer.staff.id>",
  "payload": {
    "before": {
      "supply_mode": "partial",
      "supply_except": ["aaaa-...", "bbbb-..."]
    },
    "after": {
      "supply_mode": "exempt",
      "supply_except": []
    },
    "changes": ["supply_mode", "supply_except"]
  }
}
```

### 6.4 Combined: rename + card-fee + supply mode

```jsonc
{
  "action": "staff.updated",
  "entity_id": "<staff_id>",
  "actor_user_id": "<viewer.user.id>",
  "acting_as_staff_id": "<viewer.staff.id>",
  "payload": {
    "before": {
      "display_name": "Maya R.",
      "card_fee_exempt": false,
      "supply_mode": "apply"
    },
    "after": {
      "display_name": "Maya Reyes",
      "card_fee_exempt": true,
      "supply_mode": "exempt"
    },
    "changes": ["display_name", "card_fee_exempt", "supply_mode"]
  }
}
```

Note `supply_except` is NOT in the diff — it stayed `[]` across the change (apply → exempt; both have empty `supply_except`).

## 7. Recording rules

- `await recordAudit(...)` MUST occur after a successful Postgres UPDATE and BEFORE `revalidatePath + redirect`. If the audit insert fails (DB outage), the error is logged and swallowed — the page still revalidates (the existing behavior per `lib/auth/audit.ts`).
- No audit row is written when `changes.length === 0` (no-op save).
- The audit row is written via the service-role client, NOT the cookie-aware client. This is the existing pattern (audit_log has no INSERT policy for authenticated).
- `actor_user_id` is the device user (`auth.uid()`); `acting_as_staff_id` is the operator id; `entity_id` is the affected staff row's id. For self-edits, `acting_as_staff_id === entity_id`.

## 8. `audit_log` schema — UNCHANGED

This contract does NOT add columns to `audit_log`, drop columns, change column types, or change indexes. The payload extension is content-only — three new keys inside the existing JSONB column.

## 9. Backward compatibility

Existing `staff.updated` rows in the audit log (written by 006 and forward through 022) have payloads with the existing four diff keys (`display_name`, `role`, `color_token`, `active`). The audit viewer renders these correctly today; adding three new keys is additive and the viewer will gracefully render rows that only have the old keys.

The reverse — viewing a new (post-023) row with old-only-aware viewer code — is also fine: extra JSONB keys are simply ignored. The contract is forward-additive, not migration-required.
