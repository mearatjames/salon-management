# Contract: Server Actions — staff mutations

**Feature**: `023-staff-payout-exemptions` · **Date**: 2026-05-17

The Server Action contract for the extended `updateStaff` action. The other five staff actions (`addStaff`, `setStaffPin`, `deactivateStaff`, `reactivateStaff`, `removeStaff`) are unchanged from 006/007/etc.; this contract documents only the delta.

---

## Shared prelude (unchanged from 006)

Every Server Action follows the eight-step prelude documented in 006's `server-actions.contract.md`:

1. `requireStudioSession()` — auth resolver; throws `AuthRedirectError` on unauthenticated requests.
2. `assertCanEnterSettings(viewer)` — operator-role gate (owner or manager). Redirects non-privileged operators to `/dashboard?error=forbidden`.
3. Parse + validate FormData via `_validation.ts`.
4. Load target + `isLastOwner` via Supabase server client.
5. `assertMutationAllowed(ctx, action, ...args)` — permission-matrix trust boundary; throws `PermissionError` on disallowed actions.
6. Mutate via service-role client.
7. `await recordAudit(...)` — no row commits before audit row commits.
8. `revalidatePath + redirect` — success: `?toast=updated&selected=<id>`; failure: `?error=<code>&selected=<id>` (selected preserved across failures).

This contract preserves every step; the delta is in steps 3 (new FormData fields + validators), 5 (new action label), 6 (new column writes), and 7 (extended audit payload).

---

## 1. `updateStaff(formData: FormData): Promise<void>` — extended

### 1.1 FormData fields (existing + NEW)

| Field             | Type / shape                                | Origin                                         | Required? | Notes                                                                                                                                          |
|-------------------|---------------------------------------------|------------------------------------------------|-----------|------------------------------------------------------------------------------------------------------------------------------------------------|
| `staff_id`        | UUID string                                  | Hidden form input                              | Yes       | Target row id. Existing field.                                                                                                                  |
| `display_name`    | string                                       | Form input                                     | Yes       | Existing field. Validated by `validateDisplayName`.                                                                                            |
| `role`            | `'owner'\|'manager'\|'technician'\|'front_desk'` | Select                                         | Yes       | Existing field. Validated by `validateRole`.                                                                                                    |
| `color_token`     | `'--avatar-*'`                               | Color picker                                   | Yes       | Existing field. Validated by `validateColor`.                                                                                                   |
| `active`          | `'on'` / missing                             | Switch                                         | Optional  | Existing field. Parsed as `formData.get('active') === 'on'`.                                                                                    |
| `card_fee_exempt` | `'on'` / missing                             | **NEW** — Switch (Pay & deductions section)    | Optional  | Parsed as `formData.get('card_fee_exempt') === 'on'`. NO validator needed (boolean shape).                                                       |
| `supply_mode`     | `'apply' \| 'partial' \| 'exempt'`           | **NEW** — `<ToggleGroup>` (Pay & deductions)    | Yes (when section visible) | Validated by `validateSupplyMode`. If absent or invalid: `?error=invalid_supply_mode`.                                                          |
| `supply_except`   | Repeated UUID strings                        | **NEW** — Picker (`<input type="checkbox" name="supply_except" value="<id>">` per ticked row) | Optional  | Read via `formData.getAll('supply_except') as string[]`. Validated by `validateSupplyExcept(raw, allowedIds)` — drops unknown ids silently, dedupes, caps at 64. |

### 1.2 Mode-vs-array wipe rule

After validation, the action computes:

```ts
const persistedSupplyExcept =
  validatedMode === "partial" ? validatedSupplyExcept : [];
```

Regardless of what the form submitted, when the saved mode is `apply` or `exempt`, `supply_except` is persisted as `[]`. This guards against the case where the operator switched the segmented control from `partial` → `apply` but the picker's checked-state DOM still serialized into the FormData (e.g., due to a hidden checkbox bug or hand-crafted submission). The DB CHECK is the backstop; this app-layer wipe is the primary enforcement.

### 1.3 Permission gate

After parsing + validating, before mutating:

```ts
// 5: permission matrix. Action label depends on whether any of the new
// fields actually changed — saves that only touch existing fields use the
// existing per-field action labels (update_name / update_role / etc.).
const fieldsChanged: StaffAction[] = computeChangedActions(target, draft);
for (const action of fieldsChanged) {
  assertMutationAllowed(
    { operator: viewer.staff, target, isLastOwner },
    action,
    action === "update_role" ? validatedRole : undefined
  );
}
```

`computeChangedActions` returns the set of action labels that correspond to fields whose values differ from the target's persisted values. The set includes any of:

- `"update_name"` (when display_name changed)
- `"update_role"` (when role changed)
- `"update_color"` (when color_token changed)
- `"update_active"` (when active changed)
- `"update_pay_deductions"` (NEW — when ANY of card_fee_exempt / supply_mode / supply_except changed)

The new `'update_pay_deductions'` action label:

- Is NOT in `SELF_BLOCKED_ACTIONS` (self-edit allowed per Clarify Q1 and FR-013).
- IS gated by `canEditAnyField` — manager-on-owner blocked, same as `update_color`.
- Returns one of the existing `PermissionErrorCode` values (`forbidden_target`, `self_edit_blocked`, `last_owner`, `invalid_role`) on rejection. No new error code needed (the only failure mode is manager-on-owner, which surfaces as `forbidden_target`).

### 1.4 Mutation

```ts
// 6: write the diff to Postgres.
const { error } = await admin
  .from("staff")
  .update({
    display_name: draft.display_name,
    role: draft.role,
    color_token: draft.color_token,
    active: draft.active,
    card_fee_exempt: draft.card_fee_exempt,
    supply_mode: draft.supply_mode,
    supply_except: persistedSupplyExcept, // post-wipe value
  })
  .eq("id", staff_id);

if (error) {
  // The two new failure modes from the migration:
  //   - foreign_key_violation: supply_except contains an unknown id (validator should catch this but trigger is the backstop)
  //   - check_violation: supply_except non-empty with supply_mode ≠ partial (validator + wipe should catch this)
  // In both cases, surface as ?error=server_error (the user shouldn't be hitting these in normal use).
  redirect(`${STAFF_PATH}?error=server_error&selected=${staff_id}`);
}
```

### 1.5 Audit

After successful UPDATE, before `revalidatePath`:

```ts
// 7: audit row.
const { before, after, changes } = buildChanges(targetSnapshot, draftSnapshot);
if (changes.length > 0) {
  await recordAudit({
    action: "staff.updated",
    entityId: staff_id,
    actingAsStaffId: viewer.staff.id,
    payload: { before, after, changes },
  });
}
```

`buildChanges` is the new helper in `_audit-diff.ts` (per data-model § 2.3 and audit-payload contract). The audit row uses the existing `staff.updated` action verb — no new verb needed. The payload is the diff projection.

### 1.6 Revalidate + redirect

```ts
// 8: revalidate + redirect.
revalidatePath("/settings/staff");
redirect(`${STAFF_PATH}?toast=updated&selected=${staff_id}`);
```

Unchanged from 006.

---

## 2. Error codes

### 2.1 New `ValidationErrorCode` values

| Code                              | Thrown by                            | When                                                                                  | UI surface                                                                                                              |
|-----------------------------------|--------------------------------------|---------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------|
| `invalid_supply_mode`             | `validateSupplyMode`                  | FormData `supply_mode` is missing or not one of three permitted values.               | `?error=invalid_supply_mode&selected=<id>`. Panel re-renders, Pay & deductions section shows "Supply mode is required.". |
| `invalid_supply_except_shape`     | `validateSupplyExcept`                | FormData `supply_except` (via `getAll`) is not an array — defensive only; FormData's `getAll` always returns an array, so this fires only for non-FormData callers. | `?error=invalid_supply_except_shape&selected=<id>`. Panel re-renders generic save-failed banner.                       |

### 2.2 No new `PermissionErrorCode` values

The new `'update_pay_deductions'` action surfaces the existing four codes (`forbidden_target`, `self_edit_blocked`, `last_owner`, `invalid_role`). In practice only `forbidden_target` is reachable (manager-on-owner); the other three are not reachable by this action label (it's not in `SELF_BLOCKED_ACTIONS`, it doesn't take a role argument, it isn't gated by `isLastOwner`).

---

## 3. The other five staff actions — UNCHANGED

- `addStaff(formData)` — unchanged. New staff rows get the three new column defaults (`card_fee_exempt = false`, `supply_mode = 'apply'`, `supply_except = '{}'`).
- `setStaffPin(formData)` — unchanged.
- `deactivateStaff(formData)` — unchanged.
- `reactivateStaff(formData)` — unchanged.
- `removeStaff(formData)` — unchanged. The three new columns are dropped along with the staff row on hard delete (or marked-deleted on soft delete; the 006 model uses soft delete via `removed_at`).

No other Server Action signature, FormData shape, or audit payload changes in this feature.

---

## 4. Action-source-of-truth

Implementation MUST match this contract exactly:

- File: `app/(studio)/settings/staff/actions.ts` — `updateStaff` extended in place (no new exported function).
- Validators: `app/(studio)/settings/staff/_validation.ts` — `validateSupplyMode` + `validateSupplyExcept` added to existing exports.
- Permissions: `app/(studio)/settings/staff/permissions.ts` — `StaffAction` union extended with `"update_pay_deductions"`; `SELF_BLOCKED_ACTIONS` UNCHANGED (new label NOT added).
- Audit-diff helper: `app/(studio)/settings/staff/_audit-diff.ts` — NEW file, see data-model § 2.3.
- Supply catalog helper: `app/(studio)/settings/staff/_supply-catalog.ts` — NEW file, see data-model § 2.2.

Any divergence between this contract and the implementation MUST be resolved by updating this contract first (so the audit-payload and ui contracts can be reviewed for ripple effects) and then implementing the contract delta.
