# Phase 0 — Research: Staff management (Settings → Staff)

**Feature**: `006-staff-management` · **Date**: 2026-05-15 (refreshed
post-Clarifications session 2026-05-15)

This document resolves every `NEEDS CLARIFICATION` in the Technical Context
and records the decisions that bind Phase 1. Each decision cites the spec
FR/SC/Clarification it satisfies and the constitution principle it honors.

---

## R1. Routing — where the page lives

**Decision**: One nested route, `app/(studio)/settings/staff/`, plus a
sibling shared layout `app/(studio)/settings/layout.tsx` that renders the
Lacquer Settings tab bar (General · Staff · Notifications · Billing). Only
the **Staff** tab is implemented in this feature; the other three render
the prototype's "Not part of this prototype" placeholder.

**Rationale**: Matches the prototype's left-sidebar Settings shell, keeps
the auth gate from feature 003 by living under `(studio)`, and lets future
Settings features add tabs in place.

**Alternatives considered**:
- `app/(studio)/settings/page.tsx` with a tabbed client island — rejected:
  tabs are URL-driven (`/settings/staff` ↔ `/settings/general`) for
  deep-linkable state and to keep the auth gate doing the work.
- Top-level `app/settings/` outside the `(studio)` group — rejected: would
  bypass the studio topbar the spec presupposes.

---

## R2. Authorization — the permission matrix (replaces the manager-PIN override)

**Decision**: Authorization for every staff-management mutation is a pure
function over `(operatorRole, targetRole, action)`. No inline PIN re-prompt
(Clarifications Q1). The function lives in
`app/(studio)/settings/staff/permissions.ts` and is consumed in two places:

1. **Server-side (trust boundary)**: Every Server Action invokes
   `assertMutationAllowed(operator, target, action)` before any DB write.
   Rejection is `?error=forbidden_target` with **zero audit rows written**
   (no mutation attempted, nothing to audit).
2. **Client-side (UX)**: The edit panel calls the same module to decide
   which controls render disabled and which role-select options to offer,
   so a manager opening an owner row sees every control greyed out before
   any submit attempt.

### Permission matrix

| Operator role | Target role        | Allowed actions                                                                                          |
|---------------|--------------------|----------------------------------------------------------------------------------------------------------|
| `owner`       | any                | add, update (any field), setStaffPin, deactivate, reactivate, remove                                     |
| `manager`     | `manager` / `technician` / `front_desk` | add (role within {manager, technician, front_desk}), update (role within same set), setStaffPin, deactivate, reactivate, remove |
| `manager`     | `owner`            | **none** — every mutation rejected with `?error=forbidden_target` (Clarifications Q4)                    |
| any           | self               | rename, recolor, reset own PIN — but **NOT** change own role or active (FR-024)                          |

### Self constraints layered on top

- Operator cannot promote / demote themselves regardless of operator role
  (the self-edit check fires before the role-asymmetry check).
- Operator cannot deactivate or remove themselves regardless of operator
  role.
- Operator can reset their own PIN (always allowed; no override needed).

### Role-select scope (Clarifications Q3 + FR-038a)

The role select on Add staff and Edit panel renders only the options the
operator is allowed to grant:

- Operator is `owner` → options: `owner, manager, technician, front_desk`.
- Operator is `manager` → options: `manager, technician, front_desk` (no
  `owner`).

Server Actions reject any role value outside the operator's allowed set.

**Rationale**: Replaces the previously-planned inline PIN re-prompt with a
pure-function permission matrix. The matrix is testable in isolation
(no DB, no client state), enforced server-side as the trust boundary, and
mirrored client-side as the UX. Audit rows still record `acting_as_staff_id`
on every successful mutation — accountability is preserved without needing
a second-actor approval.

**Alternatives considered**:
- Keep the inline PIN override (the original plan) — rejected per
  Clarifications Q1; user explicitly opted out.
- Encode the matrix as DB row-level security — rejected: RLS is the
  backstop per Constitution II ("Supabase RLS is a backstop … never the
  primary authorization layer"). Server-side function enforcement matches
  the existing pattern in `requireStudioSession`.
- Inline `if (operator.role === 'manager' && target.role === 'owner')`
  checks in each Server Action — rejected: 6 actions × N target-shape
  permutations gets brittle fast; a single matrix function is one place
  to test and one place to change.

---

## R3. Soft-delete mechanism

**Decision**: Add a `removed_at timestamptz` column to `public.staff` (NULL
= present in roster; non-NULL = soft-removed). All roster queries filter
`removed_at is null`. Foreign keys from `appointments`, `payments`,
`tip_splits`, and `audit_log` remain valid against the row, satisfying the
edge case "Removing a member with payment history" and Constitution III's
"historical records … snapshotted" clause.

**Rationale**: The simplest mechanism honoring referential integrity
(FR-035, spec Assumption "soft delete"). A boolean (`removed`) would lose
the audit trail of when removal happened; the timestamp doubles as audit
context.

**Alternatives considered**:
- Hard `DELETE` with `on delete set null` cascades — rejected: would orphan
  historical tip splits and break per-staff reporting forever.
- Move-to-archive table — rejected: doubles query complexity in every place
  that resolves a staff name, with no offsetting benefit at salon scale.

**Schema delta**: `supabase/migrations/0002_staff_management.sql` adds the
column + an updated partial index (see data-model.md § Migrations).

---

## R4. Avatar palette tokens

**Decision**: Add an 8-color avatar token set to `styles/tokens.css` as
`--avatar-rose`, `--avatar-blue`, `--avatar-green`, `--avatar-amber`,
`--avatar-purple`, `--avatar-teal`, `--avatar-orange`, `--avatar-slate`,
with the exact OKLCH values from the prototype
(StaffManagement.jsx:5-14). The existing seed strings (`--accent-rose`,
`--accent-amber`, `--accent-violet`) are migrated to the new names in the
same migration that adds `removed_at`.

| Token name        | OKLCH                  | Source                        |
|-------------------|------------------------|-------------------------------|
| `--avatar-rose`   | `oklch(0.55 0.12 12)`  | matches `--rose-500`          |
| `--avatar-blue`   | `oklch(0.60 0.13 240)` | matches `--blue-500`          |
| `--avatar-green`  | `oklch(0.62 0.13 150)` | matches `--green-500`         |
| `--avatar-amber`  | `oklch(0.76 0.14 75)`  | matches `--amber-500`         |
| `--avatar-purple` | `oklch(0.55 0.13 270)` | prototype, no prior token     |
| `--avatar-teal`   | `oklch(0.56 0.13 200)` | prototype, no prior token     |
| `--avatar-orange` | `oklch(0.62 0.17 50)`  | prototype, no prior token     |
| `--avatar-slate`  | `oklch(0.44 0.01 90)`  | matches `--neutral-600`       |

Avatar background is `oklch(from var(--avatar-*) l c h / 0.15)` and the
ring/foreground is `var(--avatar-*)` — the same idiom `staff-tile.tsx:48-49`
already uses. The fixed swatch order in the UI is the table order above.

**Rationale**: Avatars are a distinct semantic ("which person") from the
Lacquer accent palette ("which surface tint"); collapsing them produced the
`--accent-rose`/`--accent-violet` ambiguity that's already in the codebase.

**Migration of existing data**: `0002_staff_management.sql` runs a one-shot
`UPDATE public.staff SET color_token = CASE color_token WHEN '--accent-rose'
THEN '--avatar-rose' WHEN '--accent-amber' THEN '--avatar-amber' WHEN
'--accent-violet' THEN '--avatar-purple' ELSE color_token END;`. The seed
is updated to emit the new token names directly.

**Alternatives considered**:
- Re-use `--rose-500` / `--green-500` / `--amber-500` / `--blue-500`
  directly and invent the other four as raw OKLCH — rejected: violates
  Principle I.1 on the four prototype-only colors.
- Drop the four prototype-only colors and ship 4 swatches — rejected: spec
  explicitly references all 8 (FR-010, edge case "Color reuse").

---

## R5. Last-owner invariant

**Decision**: Enforce in two places.

1. **DB**: A `BEFORE UPDATE OR DELETE` trigger
   `staff_assert_owner_present_trg` on `public.staff` raises if the
   operation would leave `(SELECT count(*) FROM public.staff WHERE
   role='owner' AND active=true AND removed_at IS NULL) = 0`.
2. **App**: The edit panel disables the role select and the active toggle
   for the last remaining active owner (`isLastOwner` derived in the
   Server Component) with a tooltip "At least one owner must remain". The
   server action also rejects the mutation with `?error=last_owner` as a
   second line of defense.

**Rationale**: The DB trigger is the trust boundary (Principle II); the UI
state is the friendly stop. Both are cheap.

**Alternatives considered**:
- Application-only — rejected: violates Principle II.
- Counter column on a separate table — rejected: speculative complexity.

---

## R6. Self-edit constraints

**Decision**: The Server Component that renders the edit panel computes
`isSelf = selectedStaffId === viewer.staff.id` and forwards it to the panel
client island. When true, the role select, the active toggle, the
"Deactivate" link, and the "Remove from salon" link are disabled with a
tooltip; the display-name input, color picker, and "Change PIN" action
remain enabled (consistent with edge case "Renaming yourself" in the spec).

The Server Actions repeat the check server-side: any update that changes
`role` or `active` when the target row's id matches the operator's
`acting_as_staff_id` aborts with `?error=self_edit_blocked` and writes no
audit row.

**Rationale**: The UI rule is intuitive; the server check is the trust
boundary.

---

## R7. PIN keypad reuse

**Decision**: Build a new `<NumericKeypad />` client island in
`components/lacquer/numeric-keypad.client.tsx` that supports a 2-step
**Enter → Confirm** flow with on-screen + physical-keyboard input, and use
it in two places: (a) the Add staff wizard's step 2, (b) the standalone
"Set PIN / Change PIN" modal. The existing
`components/lacquer/pin-keypad.tsx` is **not** reused as-is — it hard-codes
the `submitPin` Server Action import and auto-submits a form, which is the
right shape for `/select-staff` but not for the two-step Add wizard or the
modal that needs a render-controlled buffer.

The new component exposes a callback-based API:

```ts
type NumericKeypadProps = {
  length?: 4;
  step: "enter" | "confirm";
  errorMessage?: string | null;
  onSubmit: (digits: string) => void;
  onCancel?: () => void;
};
```

It owns no submit, no form, no Server Action import — just a buffer, dots,
keypad, and the Enter/Backspace/Escape handler.

**Note (vs. pre-clarification plan)**: The keypad is no longer used in a
third place (override dialog) because the override is gone per
Clarifications Q1. Two consumers only.

**Rationale**: Keeps the existing `/select-staff` keypad untouched
(Principle V — no changes to feature 003's shipped contract) while
satisfying the spec's two reuse sites with one client component.

---

## R8. Search & filter performance

**Decision**: Roster is fetched server-side in the page RSC and rendered to
a client island (`<StaffTable client>`) that owns the search-string and
show-inactive state. Filtering is **all in-memory** on the client island —
substring match on the pre-fetched array. The roster is hard-capped at 50
rows (SC-006), so the JS work is < 1 ms per keystroke.

The "Show inactive" toggle state is persisted in `sessionStorage`
(`tn:settings:staff:show-inactive` = `"1"|"0"`) — survives in-tab nav,
resets on tab close (spec FR-005 "MUST persist for the session").

**Rationale**: Avoiding round trips on every keystroke satisfies SC-006
(< 100 ms) trivially. Spec FR-002 sorting is also done server-side once
(SQL `order by`), so the client island never re-sorts.

**Alternatives considered**:
- Server-driven search with `?q=` and partial revalidation — rejected:
  bigger hammer than needed at salon scale.
- LocalStorage for the toggle — rejected: "MUST persist for the session"
  reads as "this tab", not "this device forever".

---

## R9. Toast strings

**Decision**: All toasts go through the existing Sonner instance at
`components/ui/sonner.tsx`. Strings exported from
`app/(studio)/settings/staff/toasts.ts` as constants so unit and e2e tests
can import them verbatim. Toast trigger is **client-side**, fired after
the Server Action redirects back to the page. The page reads a one-time
`?toast=` query param, dispatches the matching toast, and `router.replace`s
the URL clean (mirrors the `?error=` pattern in feature 003's
`/select-staff`).

**Rationale**: Sonner already singletons (FR-040 "only one toast may be
visible at a time"), and the redirect-then-toast pattern keeps the mutation
flow Server-Action-pure with no client revalidation gymnastics.

---

## R10. Realtime sync

**Decision**: None for v1. The spec explicitly defers it (Assumption
"Realtime sync is not required for this surface in v1; … Last-write-wins
is acceptable for concurrent admin edits"). All re-renders happen via
`revalidatePath("/settings/staff")` in the Server Actions; the page is RSC,
so the table reflects DB state on next paint.

**Rationale**: Matches the system design's realtime channels table —
`staff` is not on it. Adding subscription wiring for a single-tenant
settings surface is speculative complexity (Principle V).

---

## R11. Server Actions inventory

**Decision**: Six Server Actions, all in
`app/(studio)/settings/staff/actions.ts`:

| Action               | Audit `action` value | Notes                                          |
|----------------------|----------------------|------------------------------------------------|
| `addStaff`           | `staff.added`        |                                                |
| `updateStaff`        | `staff.updated`      | Diff-aware payload                             |
| `setStaffPin`        | `staff.pin_set`      | Operator can self-reset (no special path)      |
| `deactivateStaff`    | `staff.deactivated`  | Sets `active=false`                            |
| `reactivateStaff`    | `staff.reactivated`  | Sets `active=true`                             |
| `removeStaff`        | `staff.removed`      | Sets `removed_at=now()`                        |

No idempotency keys — all mutations are non-Square. Re-submits are
prevented by the standard "disable Save button while pending" pattern.

Every action's prelude:

```ts
"use server";
const viewer = await requireStudioSession();
assertCanEnterSettings(viewer);                 // owner-or-manager (FR-037+FR-038)
const target = await loadTarget(staff_id);      // skipped for addStaff
assertMutationAllowed(viewer, target, action);  // permission matrix (R2)
// ...validate, mutate, audit, revalidate, redirect
```

A rejected `assertMutationAllowed` produces `?error=forbidden_target` with
no DB write and no audit row.

**Audit writer change**: `lib/auth/audit.ts:13-18` currently types
`AuthAction` as a closed union of five auth verbs. This feature adds six
new verbs. The cleanest move:

1. Rename the type to `AuditAction` and widen the union with the six new
   verbs.
2. Rename the function to `recordAudit`.
3. Keep a thin `export const recordAuth = recordAudit; export type
   AuthAction = AuditAction;` alias for one release so feature 003's call
   sites compile unmodified.

**No `authorizing_staff_id` in any payload** (Clarifications Q1 — the
override is gone). `acting_as_staff_id` is the sole accountability key on
every mutation row.

---

## R12. Missing shadcn primitives — what's needed, what's not

**Decision**: Add three primitives via `npx shadcn@latest add sheet dialog
switch`, plus a hand-rolled `<Table>` (CSS Grid — not the shadcn `Table`
wrapper) and a hand-rolled `<Badge>`.

| Primitive       | Source                                    | Rationale                                                 |
|-----------------|-------------------------------------------|-----------------------------------------------------------|
| Sheet           | shadcn (Radix Dialog variant)             | Add staff right-side drawer                               |
| Dialog          | shadcn (Radix)                            | PIN modal, confirm dialogs                                |
| Switch          | shadcn (Radix)                            | Active toggle, "Show inactive" toggle, PIN toggle (Add)   |
| Badge           | hand-rolled in `components/lacquer/badge.tsx` | Single-purpose pill; smaller than shadcn                  |
| Select (role)   | native `<select>` styled with Lacquer tokens | 4 options, no search; Radix is overkill                |
| Table           | hand-rolled CSS Grid in `<StaffTable>`    | ≤50 rows; no sticky header, no virtualization needed       |

Pre-clarification plan also pulled in shadcn Dialog for the override
dialog; that consumer is gone but Dialog is still needed for the PIN modal
and the deactivate/remove confirm dialogs. Still 3 primitives.

---

## R13. Tests — what runs in CI

**Decision**: Three layers.

| Layer        | Files                                       | Coverage                                                         |
|--------------|---------------------------------------------|------------------------------------------------------------------|
| Vitest unit  | `tests/unit/staff/*.test.ts`                | Sort comparator; search filter; role/color enum validation; **permission matrix** (every cell of the operator × target × action grid); `isLastOwner` derivation; `isSelf` derivation; audit-payload shape for all six verbs (no `authorizing_staff_id`); `recordAudit` writes one row per verb. |
| Vitest unit (DB) | `tests/unit/staff/last_owner_trigger.test.ts` | The DB trigger from R5 — happy path (demote a non-last owner) + rejection path (demote the last owner). Runs against a transactional Supabase fixture. |
| Playwright e2e   | `tests/e2e/staff.spec.ts`                  | One scenario per User Story (1–7). The full sequence: open page as owner → see seeded roster → add Maya → set PIN → see toast → edit her role → confirm Save behavior → set her PIN from the panel → deactivate her → reactivate → remove → verify she's gone. Plus the negative paths: technician redirect (US6); self-demote disabled (R6); manager opens an owner row → every control disabled + direct FormData post to `updateStaff` rejected with `?error=forbidden_target`. |

**Test-first ordering** (Constitution IV): For the **last-owner trigger**,
the **permission-matrix function** (the new trust boundary), the **audit
writer extension**, and the **sort comparator**, the Vitest tests are
landed (red) before the implementation that turns them green. The other
unit tests (filter, isSelf, isLastOwner) are inline with implementation.
E2E follows once the page is clickable.

**Reset pattern**: Each Playwright `beforeEach` truncates `audit_log`
(`tests/e2e/_db.ts` already has `truncateAuditLog()`) and resets the staff
table to the seed via a new helper `resetStaffToSeed()` that re-runs the
INSERT block from `supabase/seed.sql`. Per-test (≤ 200 ms), not a full
`supabase db reset`.

---

## R14. Performance budget

**Decision**:

| Metric                                       | Target                  | How met                                            |
|----------------------------------------------|-------------------------|----------------------------------------------------|
| Initial RSC render (50-row roster)           | < 200 ms p95            | Single `select id, display_name, role, pin_hash IS NOT NULL AS pin_set, active, color_token, created_at from staff where removed_at is null order by role_priority, display_name` — uses `staff_roster_idx` |
| Search keystroke → re-render                 | < 16 ms (one frame)     | In-memory filter on a 50-row array (R8)            |
| Add staff Server Action (no PIN)             | < 300 ms p95            | One INSERT + one audit INSERT                      |
| Add staff Server Action (with PIN)           | < 500 ms p95            | + one `hashPin` call (~150 ms at cost 11)          |
| Set/change PIN Server Action                 | < 500 ms p95            | One `hashPin` + one UPDATE + one audit INSERT      |
| Save changes Server Action                   | < 300 ms p95            | One UPDATE + one audit INSERT                      |
| `assertMutationAllowed`                      | < 0.1 ms                | Pure function, no I/O                              |

Bcrypt cost 11 is the only meaningful CPU cost — already validated by
feature 003. The pre-clarification plan budgeted ~1.5 s worst case for
override candidate verification; that cost is gone entirely.

---

## R15. Accessibility

**Decision**:

- Every modal/sheet/dialog uses the Radix-backed shadcn primitive's
  built-in focus trap.
- The numeric keypad's buttons have `aria-label="Digit {n}"`; the dots
  have `role="img" aria-label="PIN entry, {filled}/4"`.
- The staff table has a `<caption>`-equivalent `<h2>Staff roster</h2>`
  above it and each row is a `<button>` with `aria-pressed={isSelected}`.
- Disabled controls (manager viewing owner row, last-owner protection,
  self-edit) carry a `title` (and Radix tooltip where wrapping exists)
  explaining why.
- All Lucide icons are `aria-hidden="true"` with sibling text labels.
- Color is never the sole conveyor: "Active"/"Inactive" badges carry text;
  the PIN column uses "Set"/"—" not a green/red dot alone.

**Rationale**: WCAG AA is the implicit bar; Lacquer's component library
already wraps Radix where it counts.

---

## Decision summary

15 decisions (R1–R15), 0 unresolved `NEEDS CLARIFICATION`. Phase 1 may
begin.

**Net change vs. pre-clarification research**: R2 (override) replaced
with the permission matrix; R7 keypad has 2 consumers instead of 3; R11
inventory has no `authorizing_staff_id`; R13 e2e exercises the matrix
instead of the override dialog; R14 drops the override verify cost. R3,
R4, R5, R6, R8, R9, R10, R12, R15 unchanged.
