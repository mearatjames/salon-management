# Contract: Audit log verbs and payloads

This feature adds four verbs to `lib/auth/audit.ts`'s `AuditAction` union. The DB has no CHECK on `audit_log.action`; the TS union is the trust boundary.

`recordAudit(action, deviceUserId, entityId, payload)` calls — when `action` starts with `service.` — write rows with:

- `entity_type = 'service'`
- `entity_id = <services.id>` (UUID)
- `acting_as_staff_id = viewer.staff.id`
- `actor_user_id = viewer.deviceUserId`
- `payload = jsonb(<per-verb shape below>)`

Every payload is JSON-serializable (no `Date` objects, no BigInts).

---

## 1. `service.added`

Fired by `addService` after a successful insert.

```jsonc
{
  "name": "Gel polish",
  "category": "Manicure",
  "duration_min": 45,
  "price_cents": 3500,
  "color_token": "--avatar-rose",
  "taxable": true,
  "variable_price": false,
  "price_from_cents": null,
  "price_to_cents": null,
  "variable_price_note": null,
  "assigned_staff_ids": ["a1f0…", "b2c1…"]
}
```

All persisted fields are echoed (so future audit consumers can reconstruct the post-add state without joining back to `services`). The `assigned_staff_ids` array preserves insertion order from the FormData; an empty array is permitted.

---

## 2. `service.updated`

Fired by `updateService` after a successful diff-apply.

```jsonc
{
  "changes": {
    "price_cents": [3500, 4000],
    "color_token": ["--avatar-rose", "--avatar-blue"]
  },
  "assignment_changes": {
    "added": ["c3d2…"],
    "removed": ["a1f0…"],
    "overrides_changed": [
      { "staff_id": "b2c1…", "before": null, "after": 60 }
    ]
  },
  "before": {
    "name": "Gel polish",
    "category": "Manicure",
    "duration_min": 45,
    "price_cents": 3500,
    "color_token": "--avatar-rose",
    "taxable": true,
    "active": true,
    "variable_price": false,
    "price_from_cents": null,
    "price_to_cents": null,
    "variable_price_note": null,
    "assignment_ids": ["a1f0…", "b2c1…"]
  },
  "after": {
    "name": "Gel polish",
    "category": "Manicure",
    "duration_min": 45,
    "price_cents": 4000,
    "color_token": "--avatar-blue",
    "taxable": true,
    "active": true,
    "variable_price": false,
    "price_from_cents": null,
    "price_to_cents": null,
    "variable_price_note": null,
    "assignment_ids": ["b2c1…", "c3d2…"]
  }
}
```

Rules:

- `changes` lists only fields whose **value changed**. Each entry is `[before, after]`.
- `assignment_changes` is always present. Empty arrays are permitted.
- `assignment_changes.overrides_changed` includes only staff whose `duration_min_override` actually changed (excluding `added` / `removed` rows; those carry their override in the before/after snapshots).
- `before` and `after` always contain the full snapshot (12 fields plus the assignment id set), so a single audit row is enough to reconstruct the row at that point in time.
- `active` is part of the snapshot but is never changed by `updateService` — archive/restore are separate verbs.

---

## 3. `service.archived`

Fired by `archiveService` after `active = false`.

```jsonc
{
  "name": "Gel polish"
}
```

The name is captured so the audit reads naturally even if the row is later renamed.

---

## 4. `service.restored`

Fired by `restoreService` after `active = true`.

```jsonc
{
  "name": "Gel polish"
}
```

Same shape as `service.archived`.

---

## 5. `AuditAction` helper changes

`lib/auth/audit.ts` updates:

```ts
export type AuditAction =
  | "device.signed_in" | "device.signed_out"
  | "staff.signed_in" | "staff.pin_failed" | "staff.switched"
  | "staff.added" | "staff.updated" | "staff.pin_set"
  | "staff.deactivated" | "staff.reactivated" | "staff.removed"
  // NEW (feature 008)
  | "service.added" | "service.updated" | "service.archived" | "service.restored";
```

The hard-coded `STAFF_ENTITY_ACTIONS` set is replaced with a prefix-based dispatch:

```ts
function deriveEntityType(action: AuditAction): "service" | "staff" | "auth" {
  if (action.startsWith("service.")) return "service";
  if (action === "staff.added"
      || action === "staff.updated"
      || action === "staff.pin_set"
      || action === "staff.deactivated"
      || action === "staff.reactivated"
      || action === "staff.removed") {
    return "staff";
  }
  return "auth";
}
```

Existing call sites (feature 003 sign-in/sign-out/PIN-fail/switch and feature 006 staff mutations) are unaffected. The unit test in `tests/unit/services/audit-service-entity.test.ts` asserts that the four new verbs route to `entity_type = "service"`.
