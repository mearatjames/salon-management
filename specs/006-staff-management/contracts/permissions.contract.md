# Permissions contract — 006-staff-management

The permission matrix is the trust boundary for every staff-management
mutation. It replaces the previously-planned manager-PIN inline override
(removed per Clarifications Q1).

Lives in `app/(studio)/settings/staff/permissions.ts` as pure functions
with no I/O. Consumed by:

- The page Server Component (to compute per-control disabled state for
  the edit panel before any client JS runs).
- The edit-panel client island (to keep the disabled state coherent as
  drafts change locally).
- Every Server Action (as the trust boundary, before any DB write).

## The matrix

| Operator role | Target role / kind                              | Allowed actions                                                                                                                          |
|---------------|-------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------|
| `owner`       | any                                             | add, update (any field), setStaffPin, deactivate, reactivate, remove                                                                     |
| `manager`     | `manager` / `technician` / `front_desk`         | add (role within {manager, technician, front_desk}), update (role within same set), setStaffPin, deactivate, reactivate, remove          |
| `manager`     | `owner`                                         | **none** — every mutation rejected with `?error=forbidden_target` (Clarifications Q4)                                                    |
| any           | self                                            | rename, recolor, reset own PIN — but **NOT** change own role or active (FR-024)                                                          |

Self constraints layer on top of role-asymmetry constraints (an
owner-operator on themselves still cannot change own role).

The matrix is **role-driven** — there are no per-staff ACLs.

## Public API

```ts
// permissions.ts

export type StudioRole = "owner" | "manager" | "technician" | "front_desk";

export type StaffAction =
  | "add"
  | "update_name"
  | "update_role"
  | "update_color"
  | "update_active"
  | "set_pin"
  | "deactivate"
  | "reactivate"
  | "remove";

export type PermissionContext = {
  operator: { id: string; role: StudioRole };
  target: { id: string; role: StudioRole; active: boolean } | null; // null for `add`
  isLastOwner: boolean;
};

/** Throws PermissionError if the action is not allowed. Otherwise returns. */
export function assertMutationAllowed(
  ctx: PermissionContext,
  action: StaffAction,
  // For role mutations only: the role value being set.
  newRole?: StudioRole
): void;

/** Non-throwing variant used by the UI. */
export function isMutationAllowed(
  ctx: PermissionContext,
  action: StaffAction,
  newRole?: StudioRole
): boolean;

/** What roles can the operator grant when assigning a role? */
export function roleOptionsFor(operatorRole: StudioRole): StudioRole[];

/** Compose a full StaffTargetPermissions object for the edit panel. */
export function computeTargetPermissions(
  ctx: PermissionContext
): StaffTargetPermissions;
```

`PermissionError` carries a stable string code (`"forbidden_target"`,
`"self_edit_blocked"`, `"last_owner"`, `"invalid_role"`) that the Server
Action prelude maps directly to a `?error=` redirect.

## Decision tree (per action)

For each action, the matrix is evaluated in this order; first failure
wins:

1. **Operator role gate** — `operator.role` must be `owner` or `manager`.
   Failure → `forbidden_target` (this is a defense-in-depth check; the
   route gate already enforced it).
2. **Role-asymmetry gate (`manager` × `owner`)** — if
   `operator.role === 'manager' && target?.role === 'owner'`, every
   action fails. Failure → `forbidden_target`.
3. **Role-set scope** — for role-mutating actions
   (`add` with role, `update_role`), `newRole` must be in
   `roleOptionsFor(operator.role)`. Failure → `invalid_role`.
4. **Self-edit gate** — if `target?.id === operator.id`:
   - `update_role`, `update_active`, `deactivate`, `remove` →
     `self_edit_blocked`.
   - all other actions allowed.
5. **Last-owner gate** — if `isLastOwner === true` and the action would
   reduce the active-owner count:
   - `update_role` with `newRole !== 'owner'` → `last_owner`.
   - `update_active` to `false` → `last_owner`.
   - `deactivate` → `last_owner`.
   - `remove` → `last_owner`.

If all five gates pass, the action commits.

## Examples

```ts
// Owner promoting a technician to manager — allowed.
assertMutationAllowed(
  { operator: { id: "o1", role: "owner" },
    target:   { id: "t1", role: "technician", active: true },
    isLastOwner: false },
  "update_role",
  "manager"
); // no throw

// Manager attempting to rename an owner — rejected.
assertMutationAllowed(
  { operator: { id: "m1", role: "manager" },
    target:   { id: "o1", role: "owner", active: true },
    isLastOwner: false },
  "update_name"
); // throws PermissionError("forbidden_target")

// Manager promoting a tech to owner — rejected at role-set scope.
assertMutationAllowed(
  { operator: { id: "m1", role: "manager" },
    target:   { id: "t1", role: "technician", active: true },
    isLastOwner: false },
  "update_role",
  "owner"
); // throws PermissionError("invalid_role")

// Last owner tries to demote themselves — rejected at last-owner gate.
assertMutationAllowed(
  { operator: { id: "o1", role: "owner" },
    target:   { id: "o1", role: "owner", active: true },
    isLastOwner: true },
  "update_role",
  "manager"
); // throws PermissionError("self_edit_blocked") — self gate fires first
```

(Note the last example: when both self-edit and last-owner gates would
fire, self-edit wins by ordering. The user-facing toast is the same
class of "you can't do that" message; the underlying code differs for
audit/test inspection.)

## Test coverage requirement

`tests/unit/staff/permissions.test.ts` MUST cover every cell of the
matrix:

- 2 operator roles (owner, manager)
- 4 target roles (owner, manager, technician, front_desk)
- 9 actions
- 3 modifier combinations (self / last-owner / both / neither)
- For `update_role` and `add`, all 4 candidate `newRole` values

= ~864 logical cells, but most collapse into ≤ 60 distinct assertions
once the early-exit ordering is applied. The test file's organization
follows the decision tree above, with one `describe` block per gate.

## What the matrix does NOT cover

- **Field-shape validation** (display_name length, color_token enum, PIN
  shape) — that's per-action input validation in
  `app/(studio)/settings/staff/_validation.ts`.
- **Concurrent edits** (someone else modified the row between read and
  write) — last-write-wins per spec; no transactional lock.
- **PIN entropy / dictionary check** — out of scope; bcrypt cost-11 is
  the only brake per FR-030 + feature 003 contract.
