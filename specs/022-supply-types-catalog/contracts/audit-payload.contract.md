# Audit Payload Contract — Supply types catalog

**Feature**: `022-supply-types-catalog` · **Date**: 2026-05-17 · **Authority**: `data-model.md § 4` · `research.md § R3`

Four new `supply_type.*` audit verbs; one diff-key swap on the existing `service.added` / `service.updated` payloads. No `audit_log` schema change (per research § R3).

The `recordAudit` helper at `lib/auth/audit.ts` grows by:

1. Four entries in the `AuditAction` TS union.
2. One prefix branch in `deriveEntityType` mapping `supply_type.*` → `'supply_type'`.

---

## 1. `supply_type.created`

**When emitted**: every successful `createSupplyType` Server Action call; once per seeded type at migration time.

**Payload (operator-initiated)**:

```jsonc
{
  "name": "GelX tips & gel"
}
```

**Payload (migration-seeded)**:

```jsonc
{
  "name": "GelX tips & gel",
  "source": "migration:022",
  "from_label": "Gel X Tips & Gel"   // original legacy free-text label (may differ from `name` after whitespace collapse / case canonicalization)
}
```

**Where `source` and `from_label` come from**: only present on rows inserted by the 0017 migration's audit-log INSERT (`contracts/db-migration.contract.md § 4`). Operator-initiated creates omit both fields.

**`audit_log` columns**:

| Column                | Value                                                          |
|-----------------------|----------------------------------------------------------------|
| `action`              | `"supply_type.created"`                                        |
| `actor_user_id`       | viewer's `auth.uid()` — OR `NULL` if migration-seeded          |
| `acting_as_staff_id`  | viewer's `staff.id` — OR `NULL` if migration-seeded            |
| `entity_type`         | `"supply_type"`                                                |
| `entity_id`           | the newly-created `supply_types.id`                            |
| `payload`             | see above                                                       |

---

## 2. `supply_type.renamed`

**When emitted**: every successful `renameSupplyType` Server Action call where the canonical name actually changed (no-op renames return `?error=no_changes` and emit no audit row).

**Payload**:

```jsonc
{
  "before": { "name": "GelX tips & gel" },
  "after":  { "name": "GelX materials" }
}
```

**`audit_log` columns**:

| Column                | Value                                                          |
|-----------------------|----------------------------------------------------------------|
| `action`              | `"supply_type.renamed"`                                        |
| `actor_user_id`       | viewer's `auth.uid()`                                          |
| `acting_as_staff_id`  | viewer's `staff.id`                                            |
| `entity_type`         | `"supply_type"`                                                |
| `entity_id`           | the `supply_types.id` being renamed                            |
| `payload`             | see above                                                       |

---

## 3. `supply_type.archived`

**When emitted**: every successful `archiveSupplyType` Server Action call (i.e., usage_count was 0 at action time).

**Payload**:

```jsonc
{
  "name": "Cat-eye gel"   // captured at archive time so the row reads naturally if the type is later renamed during a reactivate cycle
}
```

**`audit_log` columns**: same shape as § 1 (operator-initiated).

---

## 4. `supply_type.reactivated`

**When emitted**: every successful `reactivateSupplyType` Server Action call.

**Payload**:

```jsonc
{
  "name": "Cat-eye gel"   // the current name at reactivate time
}
```

**`audit_log` columns**: same shape as § 1 (operator-initiated).

---

## 5. Diff-key swap on `service.added` / `service.updated`

The existing payloads from 008/021 carry a `supply_label: string | null` key in their `before` / `after` snapshots and in the `changes` diff map. After this feature ships:

- **REMOVED**: `supply_label` (string).
- **ADDED**: `supply_type_id` (uuid string or null).

Affected places:

- `app/(studio)/services/_audit-diff.ts` — `SERVICE_DIFF_KEYS` constant: replace `"supply_label"` with `"supply_type_id"`; `ServiceDiffSnapshot` type: replace the `supply_label` field with `supply_type_id: string | null`.
- `actions.ts` — the `before` and `after` snapshot builders in `updateService` (and the echoed-fields list in `addService`) swap the key the same way.

**The resolved type NAME is NOT echoed in the service-update payload.** Operators tracing a service's deduction history follow the FK to the `supply_type.renamed` event log for name changes. This is the whole point of stable ids: the service row's audit shows what it was attached to (the id), not what the attachment was called at the time (the name, which can drift via renames). This was implicit in the 022 spec's central design ("renames flow through every consumer") and is made explicit here.

---

## 6. `AuditAction` union extension (in `lib/auth/audit.ts`)

```ts
export type AuditAction =
  // … existing entries …
  // Added by feature 022 (entity_type "supply_type")
  | "supply_type.created"
  | "supply_type.renamed"
  | "supply_type.archived"
  | "supply_type.reactivated";
```

And `deriveEntityType` gains:

```ts
if (action.startsWith("supply_type.")) return "supply_type";
```

(Placed before the `service.` branch in the switch so it matches first — though both prefixes are distinct, ordering is conservative defense.)

The return type of `deriveEntityType` widens to include `"supply_type"`.

---

## 7. Operator query examples

```sql
-- "Where did this type come from?"
select payload
  from public.audit_log
 where entity_type = 'supply_type'
   and entity_id = $1
   and action = 'supply_type.created'
 order by ts asc
 limit 1;

-- "Show me every rename of this type."
select ts, actor_user_id, payload
  from public.audit_log
 where entity_type = 'supply_type'
   and entity_id = $1
   and action = 'supply_type.renamed'
 order by ts asc;

-- "Show me every catalog mutation performed by this operator."
select ts, action, payload
  from public.audit_log
 where entity_type = 'supply_type'
   and acting_as_staff_id = $1
 order by ts desc;

-- "Show me every type that was seeded by the migration."
select entity_id, payload->>'name' as name, payload->>'from_label' as original_label
  from public.audit_log
 where action = 'supply_type.created'
   and payload->>'source' = 'migration:022';
```

---

## 8. Test-side assertions

The Playwright spec (`tests/e2e/supply-types-catalog.spec.ts`) uses `newAuditCursor()` + `getAuditLogRowsSince()` (per the project's audit-cursor convention, CLAUDE.md "Pre-push quality gates" → `tests/e2e/_db.ts`) to assert that:

- US1: after inline-create, exactly one new audit row with `action = 'supply_type.created'`, `payload.name = <typed>`, `actor` channels populated.
- US2: after rename, exactly one new audit row with `action = 'supply_type.renamed'`, payload `before.name` matches the pre-rename, `after.name` matches the post-rename.
- US3: after archive, exactly one new audit row with `action = 'supply_type.archived'`. After reactivate, one with `action = 'supply_type.reactivated'`.
- US5 (post-migration): the audit cursor at the very start of the test run (before any user action) contains N rows of `action = 'supply_type.created'`, all with `payload.source = 'migration:022'`, matching the number of distinct legacy `supply_label` values the seed fixture inserted. SC-007's "no catalog mutation succeeds without an audit row" is verified for migration-seeded rows via this assertion.
