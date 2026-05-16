# Contract: Server Actions

Five entry points exported from `app/(studio)/services/actions.ts`. Each follows the **shared prelude** below before its action-specific body. Implementations that skip a prelude step are bugs.

The read helper `loadServiceWithAssignments(id)` is exported from the same file as a **typed projection over RSC-fetched data**, not a network round-trip — see `research.md § R10`.

---

## Shared prelude (applies to every write action)

1. `requireStudioSession()` — auth resolver. Throws `AuthRedirectError` (middleware catches → redirect to `/login`).
2. `assertCanWriteCatalog(viewer.staff.role)` — owner OR manager. On failure: `redirect('/services?error=forbidden')`.
3. Parse + validate `FormData` (per-action; via `_validation.ts` validators). On `ValidationError`: `redirect('/services?error=<code>'+selectedSuffix)`.
4. Load target row (skipped for `addService`).
5. Permission matrix is currently a single rule (`canWriteCatalog`) — there is no per-target check (no analogue to the staff feature's owner-special-case). The `assertCanWriteCatalog` call in step 2 is the entire check.
6. Mutate via `createSupabaseServiceRoleClient()`. Service-role bypasses RLS.
7. `await recordAudit('service.<verb>', viewer.deviceUserId, service.id, payload)` — awaited before redirect (Constitution III: audit row commits before success line).
8. `revalidatePath('/services')` + `redirect('/services?selected=<id>&toast=<key>&name=<encoded>')` on success; `redirect('/services?error=<code>'+selectedSuffix)` on failure.

`selectedSuffix` is `&selected=<id>` when a target id is in scope; preserved on every error redirect so the drawer stays open on the failing row.

---

## 1. `addService(formData: FormData): Promise<void>`

### Input

| FormData key | Type | Notes |
|---|---|---|
| `name` | string | Validated by `validateName` |
| `category` | string | Validated by `validateCategory`; pre-filled with `Other` by the UI |
| `duration_min` | string (integer) | Validated by `validateDurationMin` |
| `price` | string (decimal dollars) | Used iff `variable_price` is unchecked; → cents via `validateFixedPriceDollars` |
| `color_token` | string | One of 8 `--avatar-*`; validated by `validateColor` |
| `taxable` | `"on"` \| absent | FormData boolean convention |
| `variable_price` | `"on"` \| absent | Determines which price branch is required |
| `price_from` | string (decimal dollars, optional) | Iff `variable_price`; via `validateBoundDollars` |
| `price_to` | string (decimal dollars, optional) | Iff `variable_price`; via `validateBoundDollars` |
| `variable_price_note` | string (optional) | Iff `variable_price` |
| `staff_ids[]` | string[] | Zero or more — `staff.id` UUIDs to assign |
| `override_min[<staff_id>]` | string (integer, optional) | Per-tech override; `validateOverrideMin` (positive int or empty) |

### Body

1. Validate every present field; if `variable_price` is on, also enforce `validateBoundsConsistency`.
2. Compute the persisted `price_cents`:
   - `variable_price = false`: `price_cents = round(parseFloat(price) * 100)`.
   - `variable_price = true`: `price_cents = price_from_cents ?? 0` (see `research.md § R1`).
3. Open a transaction (Postgres autocommit per-statement — wrap the INSERT + assignment INSERTs via a single SQL function call or via the supabase-js transactional pattern; if not available, run them sequentially and roll back the service INSERT on assignment failure by deleting it. The implementation file may pick either; the contract is that the user-visible outcome is "both succeed or both fail").
4. INSERT into `services`. If error: log + `redirect('?error=db_failure')`.
5. For each `staff_id` in `staff_ids[]`, INSERT into `staff_services` with `duration_min_override = parseOrNull(override_min[id])`. If any single INSERT fails, roll back the service INSERT and `redirect('?error=db_failure')`.
6. `await recordAudit('service.added', viewer.deviceUserId, newId, payload)` (payload shape in `audit.contract.md § 1`).
7. `revalidatePath('/services')`.
8. Redirect: `/services?selected=<newId>&toast=service_added&name=<encoded>`. If `staff_ids[]` is empty, append `&secondary=no_techs_assigned` so the URL-toast bridge fires the secondary toast as well.

### Failure URLs

- Validation error → `?error=<code>` (codes per `data-model.md § 4`).
- Authorization failure (operator is not owner/manager) → `?error=forbidden`.
- DB failure (insert error) → `?error=db_failure`.

---

## 2. `updateService(formData: FormData): Promise<void>`

### Input

Same FormData shape as `addService` plus:

| FormData key | Type | Notes |
|---|---|---|
| `service_id` | string (UUID) | The target service id |

### Body

1. Parse `service_id`; if missing → `redirect('?error=not_found')`.
2. Load target row + current `staff_services` rows for the target (one SQL round-trip via two parallel queries on the service-role client).
3. Validate every field per the same rules as `addService`.
4. Compute the proposed `services` patch by diffing baseline vs. proposed (per `data-model.md § 5.2`); if nothing changed (no field, no assignment add/remove/override change) → `redirect('?selected=<id>&error=no_changes')`.
5. Compute the proposed `staff_services` diff (the four operations table in `data-model.md § 5.2`). If `staff_ids[]` is empty after the diff, the action still proceeds (no error) but the redirect adds `&secondary=no_techs_assigned` if the **final state** has zero assignments.
6. Inside one transaction:
   - UPDATE `services` with the changed columns only.
   - For each diff op in {delete, insert, update}, run the matching `staff_services` write.
   - If any statement errors: roll back, `redirect('?selected=<id>&error=db_failure')`.
7. `await recordAudit('service.updated', viewer.deviceUserId, target.id, payload)` (payload shape in `audit.contract.md § 2` — includes `changes` diff plus before/after assignment id sets).
8. `revalidatePath('/services')`.
9. Redirect: `/services?selected=<id>&toast=changes_saved` (plus optional `&secondary=no_techs_assigned`).

### Failure URLs

Same set as `addService` plus `?error=no_changes` (when the diff is empty).

---

## 3. `archiveService(formData: FormData): Promise<void>`

### Input

| FormData key | Type | Notes |
|---|---|---|
| `service_id` | string (UUID) | Target |

### Body

1. Parse `service_id`; load target row.
2. Pre-check: if `active = false` already → `redirect('?selected=<id>&error=no_changes')` (defense in depth against a stale-tab re-submit).
3. UPDATE `services` set `active = false`.
4. `await recordAudit('service.archived', viewer.deviceUserId, target.id, { name: target.name })` (payload in `audit.contract.md § 3`).
5. `revalidatePath('/services')`.
6. Redirect: `/services?selected=<id>&toast=service_archived&name=<encoded>`.

### Failure URLs

`?error=forbidden`, `?error=not_found`, `?error=no_changes`, `?error=db_failure`.

---

## 4. `restoreService(formData: FormData): Promise<void>`

### Input

| FormData key | Type | Notes |
|---|---|---|
| `service_id` | string (UUID) | Target |

### Body

1. Parse `service_id`; load target row.
2. Pre-check: if `active = true` already → `redirect('?selected=<id>&error=no_changes')`.
3. UPDATE `services` set `active = true`.
4. `await recordAudit('service.restored', viewer.deviceUserId, target.id, { name: target.name })`.
5. `revalidatePath('/services')`.
6. Redirect: `/services?selected=<id>&toast=service_restored&name=<encoded>`.

### Failure URLs

`?error=forbidden`, `?error=not_found`, `?error=no_changes`, `?error=db_failure`.

---

## 5. `loadServiceWithAssignments(id)` — typed projection (NOT a Server Action endpoint)

`actions.ts` exports a typed read helper that projects RSC-fetched data into the `ServiceDraftBaseline` shape. This is NOT marked `"use server"`; it has no FormData input and no redirect path. The page calls it directly on the server.

```ts
export function loadServiceWithAssignments(
  catalog: CatalogService[],
  assignments: { service_id: string; staff_id: string; duration_min_override: number | null }[],
  id: string
): ServiceDraftBaseline | null;
```

Returns `null` when `id` is not in `catalog` (the `?selected=` value points at an archived service that's hidden from the current view, or a deleted row from an old URL). The page then renders the empty drawer state instead.

---

## 6. Error code catalog

| Code | Source | Cause |
|---|---|---|
| `name_too_short` | `validateName` | `length(trim(name)) < 2` |
| `category_required` | `validateCategory` | `length(trim(category)) < 1` |
| `invalid_duration` | `validateDurationMin` | Not a positive integer |
| `invalid_price` | `validateFixedPriceDollars` | Not a non-negative decimal with ≤ 2 fractional digits |
| `invalid_bound` | `validateBoundDollars` | One of `price_from` / `price_to` is non-empty but not a non-negative decimal |
| `bounds_inverted` | `validateBoundsConsistency` | Both bounds set and `to < from` |
| `invalid_color` | `validateColor` | Not one of 8 `--avatar-*` tokens |
| `invalid_override` | `validateOverrideMin` | A per-tech override is non-empty but not a positive integer |
| `forbidden` | `assertCanWriteCatalog` | Operator is not owner or manager |
| `not_found` | step 2/3 | `service_id` is missing, malformed, or doesn't exist |
| `no_changes` | `updateService` / `archiveService` / `restoreService` | Diff is empty / state is already the target |
| `db_failure` | service-role mutation | Postgres returned an error not covered above; logged via `console.error` |
