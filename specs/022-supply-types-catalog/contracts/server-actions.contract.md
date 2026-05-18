# Server Actions Contract — Supply types catalog

**Feature**: `022-supply-types-catalog` · **Date**: 2026-05-17 · **Authority**: `data-model.md § 2, 3, 6` · `research.md § R3, R4, R6`

Six Server Actions in this contract: four new in `app/(studio)/settings/policy/actions.ts`, two modified in `app/(studio)/services/actions.ts`. All six share the prelude established by 008/021:

```
1. requireStudioSession           (auth — throws AuthRedirectError on miss)
2. assertCanWriteCatalog          (owner OR manager — throws PermissionError)
3. parse + validate FormData      (per-action; via _validation.ts)
4. load target row                (skipped for createSupplyType + addService)
5. (no per-target matrix here — step 2 is the entire check)
6. mutate via service-role client (RLS-bypassing INSERT/UPDATE)
7. await recordAudit              (no redirect until audit row commits)
8. revalidatePath × 2 + redirect  (success: ?toast=…; failure: ?error=…)
```

The `revalidateSupplyTypeConsumers()` helper at step 8 calls `revalidatePath('/services')` AND `revalidatePath('/settings/staff')` (per research § R6). Each catalog action calls it exactly once before its `redirect`.

---

## 1. Create — two callable shapes (share internals)

The picker on the service edit panel is rendered INSIDE the outer service `<form>`. Nested `<form>` elements are invalid HTML and the redirect-based URL bridge ("come back via `?supply_type_id=<new>`") would clobber any other in-progress form fields the operator typed. The picker's inline-create therefore uses a **programmatic** action that returns a JSON result via React 19's `useActionState`. The EditPolicySheet's "+ Add supply type" row, which is a standalone surface with no surrounding form, keeps the simpler form-based redirect shape.

Both shapes share an internal helper (`_createSupplyTypeImpl(name, viewer)`) that does the validation + INSERT + audit + revalidate. They differ only at the boundary (FormData parse + redirect vs. typed args + JSON return).

### 1a. `createSupplyType(formData: FormData): Promise<void>` — form-based, redirects

**Route**: `app/(studio)/settings/policy/actions.ts`

**Used by**: the EditPolicySheet's "+ Add supply type" row (a standalone form inside the section, NOT inside any other form).

**FormData keys**:

| Key                      | Required | Validation                                                 |
|--------------------------|----------|------------------------------------------------------------|
| `name`                   | yes      | `validateSupplyTypeName` (trim, collapse, [2, 64], non-empty) |

No `return_to` param, no `selected_service_id` — this shape is reachable only from the sheet, so success always returns to the sheet.

**Error codes** (redirect: `?error=<code>`):

- `name_too_short` — < 2 chars after trim+collapse.
- `name_too_long` — > 64 chars after trim+collapse.
- `name_taken` — case-insensitive collision with an active type. (Mapped from Postgres `23505` on the partial unique index.)
- `db_failure` — any other PG error.
- `forbidden` — `assertCanWriteCatalog` threw.

**Success redirect**: `/services?policy=open&toast=supply_type_created&name=<encoded>`.

**Audit** (via the shared impl):

```ts
await recordAudit(
  "supply_type.created",
  viewer.deviceUserId,
  newId,
  { name },
  viewer.staff.id
);
```

### 1b. `createSupplyTypeForPicker(prevState, formData: FormData): Promise<CreateResult>` — programmatic, returns JSON

**Route**: `app/(studio)/settings/policy/actions.ts`

**Used by**: the `<SupplyTypePicker>` inline-create flow on the service edit panel (both the **add new service** and **edit existing service** code paths). Invoked via `useActionState(createSupplyTypeForPicker, { kind: 'idle' })` so the picker receives the new id without a page navigation.

**Signature**: a Server Action compatible with `useActionState` takes `(prevState, formData)` and returns the next state.

**FormData keys**:

| Key   | Required | Validation                            |
|-------|----------|----------------------------------------|
| `name`| yes      | `validateSupplyTypeName`              |

No `selected_service_id` — the picker doesn't need to round-trip the service id because there's no redirect.

**Return shape** (`CreateResult`):

```ts
type CreateResult =
  | { kind: "idle" }
  | { kind: "ok"; id: string; name: string }
  | { kind: "error"; code: "name_too_short" | "name_too_long" | "name_taken" | "db_failure" | "forbidden" };
```

The picker reads `state.kind` after each submit: on `'ok'` it selects the new type locally and calls `router.refresh()` to re-render the page's RSC so the catalog list includes the new row. On `'error'` it surfaces the code as inline copy via the same `toasts.ts` error-code map used by the redirect-based actions.

**Audit + revalidate**: same shared impl — `recordAudit('supply_type.created', …, { name })` + `revalidateSupplyTypeConsumers()` (cache-invalidation is independent of redirect, so it fires for both shapes).

**No URL bridge required.** The previously-documented `?supply_type_id=<new>` query param on the services page is removed from the design — the picker handles selection locally via the action's return value.

---

## 2. `renameSupplyType(formData: FormData): Promise<void>`

**Route**: `app/(studio)/settings/policy/actions.ts`

**FormData keys**:

| Key                | Required | Validation                                       |
|--------------------|----------|--------------------------------------------------|
| `supply_type_id`   | yes      | `validateSupplyTypeId` (UUID-loose shape)        |
| `name`             | yes      | `validateSupplyTypeName`                         |

**Error codes**:

- `name_too_short`, `name_too_long`, `name_taken`, `db_failure`, `forbidden` (same as createSupplyType).
- `type_not_found` — the id doesn't exist (defense in depth — race or stale tab).
- `type_archived` — the target type is archived; rename is rejected because archived types are excluded from the picker and the operator should reactivate first. (Sheet UI never offers Rename on archived rows, but defense-in-depth.)
- `no_changes` — the new name canonicalizes to the same value as the current name. Treated as a no-op success path (still redirects with `?toast=` so the optimistic UI's "saved" hint fires).

**Success redirect**: `/services?policy=open&toast=supply_type_renamed`.

**Audit**:

```ts
await recordAudit(
  "supply_type.renamed",
  viewer.deviceUserId,
  supplyTypeId,
  { before: { name: existingRow.name }, after: { name } },
  viewer.staff.id
);
```

---

## 3. `archiveSupplyType(formData: FormData): Promise<void>`

**Route**: `app/(studio)/settings/policy/actions.ts`

**FormData keys**:

| Key                | Required | Validation                                |
|--------------------|----------|-------------------------------------------|
| `supply_type_id`   | yes      | `validateSupplyTypeId`                    |

**Error codes**:

- `type_not_found`, `db_failure`, `forbidden`.
- `type_in_use` — at least one active service references this type. Pre-checked via `select count(*) from services where supply_type_id = $1 and active = true` before the UPDATE. If > 0, redirect with `?error=type_in_use&blocked_count=<n>` so the UI tooltip can name the count (US3 AC1).
- `type_already_archived` — defense-in-depth against a stale-tab re-submit.

**Success redirect**: `/services?policy=open&toast=supply_type_archived&name=<encoded>`.

**Audit**:

```ts
await recordAudit(
  "supply_type.archived",
  viewer.deviceUserId,
  supplyTypeId,
  { name: targetRow.name },
  viewer.staff.id
);
```

---

## 4. `reactivateSupplyType(formData: FormData): Promise<void>`

**Route**: `app/(studio)/settings/policy/actions.ts`

**FormData keys**: same as `archiveSupplyType` (just `supply_type_id`).

**Error codes**:

- `type_not_found`, `db_failure`, `forbidden`.
- `type_already_active` — defense-in-depth.
- `name_taken` — reactivating would collide with an existing active type's canonical name. Mapped from PG `23505`. The UI's tooltip suggests "Rename one of the conflicting types first."

**Success redirect**: `/services?policy=open&toast=supply_type_reactivated&name=<encoded>`.

**Audit**:

```ts
await recordAudit(
  "supply_type.reactivated",
  viewer.deviceUserId,
  supplyTypeId,
  { name: targetRow.name },
  viewer.staff.id
);
```

---

## 5. `addService(formData: FormData)` — modifications only

**Route**: `app/(studio)/services/actions.ts` (existing)

**FormData key swap** (the rest of the action is unchanged from 021):

- REMOVED: `supply_label` (string, ≤ 64).
- ADDED: `supply_type_id` (UUID-loose). Required when `supply_on = "on"`.

**Validator swap inside the prelude**:

```ts
// 022-supply-types-catalog: replace validateSupplyLabel with validateSupplyTypeId.
const supplyOn = formData.get("supply_on") === "on";
if (supplyOn) {
  supplyAmountCents = validateSupplyAmountDollars(String(formData.get("supply_amount") ?? ""));
  supplyTypeId    = validateSupplyTypeId(String(formData.get("supply_type_id") ?? ""));
} else {
  supplyAmountCents = null;
  supplyTypeId    = null;
}
```

**New error code on the union**: `invalid_supply_type` (replaces `invalid_supply_label` + `supply_label_too_long`).

**INSERT payload swap**: `supply_label: …` → `supply_type_id: …`.

**Audit payload swap**: the `supply_label` key in the echo is replaced with `supply_type_id` (see `audit-payload.contract.md § 3`).

**Defensive supply-type-existence check**: between validation and INSERT, the action runs `select id from supply_types where id = $1 limit 1`. If zero rows (FR-016 — type was archived/deleted by a race between picker render and form submit), redirect with `?error=invalid_supply_type&selected=<if-applicable>`.

---

## 6. `updateService(formData: FormData)` — modifications only

**Route**: `app/(studio)/services/actions.ts` (existing)

**Same FormData key swap, validator swap, INSERT/UPDATE payload swap, audit payload swap, and defensive existence check as § 5.**

The baseline row load (`select … from services where id = $1`) projects `supply_type_id` instead of `supply_label`. The `SERVICE_DIFF_KEYS` constant is updated in `_audit-diff.ts` to swap the key (see `audit-payload.contract.md § 3`).

---

## 7. Cross-action invariants

- Every catalog action awaits `recordAudit` before `redirect`. (Same rule as 008/021 — Constitution III.)
- Every catalog action calls `revalidateSupplyTypeConsumers()` (= `revalidatePath('/services')` + `revalidatePath('/settings/staff')`) before `redirect`. (Per research § R6.)
- Every error path's redirect preserves enough URL state for the UI to re-open the correct surface (the Edit Policy sheet stays open on `?policy=open`; the picker re-selects the right service via `?selected=<id>`).
- Every redirect URL is on `/services` (the sheet lives there) — the catalog actions never redirect to a standalone `/settings/policy` page (because no such page exists this phase — see plan.md "Structure Decision").

---

## 8. Permission posture

- All six actions gate on `assertCanWriteCatalog(viewer.staff.role)` (owner OR manager). Same helper as 008/021 — no new role.
- Non-privileged operators (technician, front-desk) see disabled controls on every catalog mutation surface (picker's create row, sheet's rename / archive / reactivate buttons). The disabled tooltip copy is the existing 008 string from `owner-only-tooltip.tsx`.
- The defensive role gate ensures a non-privileged operator who crafts a FormData submission directly (bypass the UI) gets `?error=permission_denied` on the redirect — no DB mutation happens.

---

## 9. Toast keys (extends `toasts.ts`)

The URL-toast bridge (`services-toaster.client.tsx` from 008) auto-fires on `?toast=<key>`. Add to `toasts.ts`:

| Key                          | Variant   | Copy                                                |
|------------------------------|-----------|-----------------------------------------------------|
| `supply_type_created`        | `success` | `Supply type "${name}" created.`                    |
| `supply_type_renamed`        | `success` | `Supply type renamed.`                              |
| `supply_type_archived`       | `success` | `Supply type "${name}" archived.`                   |
| `supply_type_reactivated`    | `success` | `Supply type "${name}" reactivated.`                |

Error-side mappings (for the existing `?error=<code>` channel):

| Code                          | Copy                                                                                 |
|-------------------------------|--------------------------------------------------------------------------------------|
| `name_too_short`              | `Supply type name must be at least 2 characters.`                                    |
| `name_too_long`               | `Supply type name must be 64 characters or fewer.`                                   |
| `name_taken`                  | `A supply type with this name already exists.`                                       |
| `type_not_found`              | `That supply type doesn't exist anymore. Re-pick from the dropdown.`                 |
| `type_in_use`                 | `Remove this type from the services that use it first.`                              |
| `type_already_archived`       | `That supply type is already archived.`                                              |
| `type_already_active`         | `That supply type is already active.`                                                |
| `type_archived`               | `That supply type is archived. Reactivate it first to rename.`                       |
| `invalid_supply_type`         | `Pick a supply type from the dropdown.`                                              |
