# Implementation Plan: Staff management (Settings → Staff)

**Branch**: `006-staff-management` | **Date**: 2026-05-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/006-staff-management/spec.md` (with Clarifications session 2026-05-15)

## Summary

Build the **Settings → Staff** surface for Tang Nails: a Lacquer-skinned page
that lets owners and managers see the salon's full roster, add new staff
through a 3-step wizard (Details → Set PIN → Done), edit a member's display
name / role / avatar color / active status, set or change PINs through a
2-step modal, and deactivate / reactivate / remove members through
confirmation dialogs. Authorization is enforced **entirely by the operator's
role on the existing PIN session** — no inline PIN re-prompt is required for
any mutation (Clarifications Q1). Owners can do anything; managers can do
everything to non-owner staff but see **owner** rows as fully read-only
(Clarifications Q4) and can only assign role values within `manager /
technician / front_desk` (Clarifications Q3).

**Technical approach**: One nested route — `app/(studio)/settings/staff/
page.tsx` — fronted by `app/(studio)/settings/layout.tsx`, which renders the
Settings tab bar and enforces the owner-or-manager role gate via the
existing `requireStudioSession()` helper from feature 003. The page is a
Server Component that fetches the roster in a single indexed query
(`staff_roster_idx`) and hydrates a client-island `<StaffTable>` for
search + "Show inactive" filtering (in-memory; ≤ 50 rows). Selection is
URL-driven via `?selected=<uuid>`. Six new Server Actions in
`app/(studio)/settings/staff/actions.ts` cover the lifecycle (`addStaff`,
`updateStaff`, `setStaffPin`, `deactivateStaff`, `reactivateStaff`,
`removeStaff`); each follows a shared prelude (`requireStudioSession` →
re-verify role → permission-matrix check (operator vs target role) →
validate FormData → mutate → `recordAudit` → `revalidatePath` → `redirect`).
The **permission matrix** is the trust boundary that replaces the
previously-planned manager-PIN override: it is enforced both client-side
(controls disabled / role-select options pruned) AND server-side (every
action rejects out-of-matrix mutations with `?error=forbidden_target` and
writes zero audit rows). PIN hashing reuses `lib/auth/pin.ts` from feature
003 (bcryptjs cost 11). One new client island, `<NumericKeypad>`, handles
the 2-step Enter→Confirm flow in two places (Add wizard + Change PIN modal)
without disturbing the existing `/select-staff` keypad. The single migration
— `supabase/migrations/0002_staff_management.sql` — adds `removed_at` for
soft delete, a roster index, a `staff_assert_owner_present` trigger that
guarantees the last-owner invariant at the DB layer, and a one-shot rename
of the legacy `--accent-*` color tokens to the new 8-swatch `--avatar-*`
palette. The existing `AuthAction` enum in `lib/auth/audit.ts` is renamed
`AuditAction` and widened from 5 to 11 verbs, with a one-release back-compat
alias so feature 003's call sites stay unmodified. Audit payloads carry no
`authorizing_staff_id` (the override is gone) — `acting_as_staff_id` is the
sole accountability key on every mutation row. See [research.md](./research.md)
for the full decision record.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 24 LTS (matches the repo's
`engines`, unchanged from feature 003).

**Primary Dependencies**: Next.js 16 (App Router, RSC + Server Actions),
React 19, `@supabase/ssr` + `@supabase/supabase-js` (existing), `bcryptjs`
(existing — reused for PIN hashing only; no longer used for override verify
in this feature), `lucide-react` (existing). Three new shadcn primitives via
`npx shadcn@latest add sheet dialog switch` (Radix-backed). No new runtime
dependencies.

**Storage**: Supabase Postgres via the existing typed clients
(`lib/db/server.ts` + `lib/db/admin.ts`). This feature introduces one
migration, `supabase/migrations/0002_staff_management.sql`, with: (a) a
nullable `removed_at timestamptz` column on `public.staff`; (b) a partial
index `staff_roster_idx on staff (removed_at, role, display_name) where
removed_at is null`; (c) the `staff_assert_owner_present` trigger function +
row-level trigger; (d) a one-shot UPDATE that migrates the seed's
`--accent-{rose,amber,violet}` strings to `--avatar-{rose,amber,purple}`. No
new tables, no new RLS policies. The `audit_log` table is reused unchanged
(`action` is `text`; the controlled vocabulary lives in TypeScript).

**Testing**: Vitest (unit) at `tests/unit/staff/*.test.ts` covering: sort
comparator + role-priority enum, case-insensitive substring filter,
name/role/color/PIN-shape validation, **permission matrix** (which operator
roles can perform which actions against which target roles), audit-payload
shape for all six new verbs, `isSelf` / `isLastOwner` derivations, the
last-owner DB trigger (against a transactional Supabase fixture). Playwright
e2e at `tests/e2e/staff.spec.ts` with one scenario per user story (US1–US7),
plus the negative paths from US6 — technician redirect, self-demote
disabled, manager attempting to mutate an owner row (UI controls disabled +
direct FormData post rejected). Reset pattern reuses feature 003's
`truncateAuditLog()` + a new `resetStaffToSeed()` helper in `tests/e2e/_db.ts`.
Test-first per Constitution IV.3 for the trigger, the permission-matrix
function, the audit extension, and the sort comparator.

**Target Platform**: Web (modern evergreen browsers). The salon counter
laptop and the front-desk iPad are the primary form factors; viewport
range 360 px – 1440 px (matches feature 002/003 baseline).

**Project Type**: Next.js App Router web application (single repo root,
matches features 001–003).

**Performance Goals**: Initial RSC render of a 50-row roster < 200 ms p95
(single indexed query); search keystroke → re-render < 16 ms (one frame,
in-memory on the client island); `addStaff` with PIN < 500 ms p95 (one
INSERT + one `hashPin` at ~150 ms cost-11 + one audit INSERT); `setStaffPin`
< 500 ms p95; `updateStaff` / `deactivateStaff` / `reactivateStaff` /
`removeStaff` < 300 ms p95 each. No per-action override verify cost (the
override is gone). SC-001 < 60 s end-to-end Add and SC-003 < 30 s PIN
reset are comfortable within these budgets. SC-006 < 100 ms search/toggle
is satisfied by in-memory filtering.

**Constraints**:

- **Server-authoritative**: Role gate runs in `app/(studio)/settings/layout.
  tsx` (Server Component). The role check is re-verified inside every
  Server Action (defense in depth — per FR-038), and the per-action
  permission matrix (operator role × target role × action) is enforced
  server-side on every mutation. Client islands disable controls
  pre-emptively but never serve as the trust boundary.
- **Auditable**: Every Server Action writes one `audit_log` row with the
  controlled-vocabulary verb from `lib/auth/audit.ts`'s extended
  `AuditAction` union. `actor_user_id` is the device Supabase user;
  `acting_as_staff_id` is the operator from the cookie. **No
  `authorizing_staff_id`** in any payload (the override is gone). Raw PINs
  never appear in any payload (Constitution III + spec FR-030).
- **Soft-delete**: Removal sets `removed_at = now()`, not `DELETE`. All
  read queries filter `removed_at is null`. Historical foreign keys remain
  valid (`appointments`, `payments`, `tip_splits`, `audit_log`).
- **Last-owner invariant**: Enforced at the DB via the
  `staff_assert_owner_present_trg` trigger AND at the Server Action
  pre-check (R5). The UI disables the relevant controls when
  `isLastOwner`.
- **Self-edit constraints**: Operator cannot change their own role or
  active status (R6). Server Actions repeat the check.
- **Permission matrix (the new trust boundary)**:
  - Owner operating on any target: all actions allowed.
  - Manager operating on owner target: **read-only** — every mutation
    rejected (`?error=forbidden_target`). No mutation, no audit row.
  - Manager operating on manager / technician / front_desk target: all
    actions allowed EXCEPT setting role to `owner` (the role select does
    not offer it; server rejects out-of-set values).
  - Self-edit: any operator can rename / recolor themselves and reset
    their own PIN; cannot change own role or active status.
- **No raw values**: every color, spacing, radius, shadow on every new
  surface resolves to a `var(--*)` Lacquer token (Constitution I). The
  8-swatch avatar palette is added as `--avatar-{rose,blue,green,amber,
  purple,teal,orange,slate}` in `styles/tokens.css` in the same commit as
  the migration.
- **Lucide-only icons** at 1.5 px stroke, sized 16/20/24 (Constitution I.4
  + ui.contract.md § Icons).
- **Sonner singleton**: One toast at a time (FR-040); reuses the existing
  `components/ui/sonner.tsx` instance from feature 003.
- **No realtime sync**: out of scope per spec Assumption + system design
  (R10). Last-write-wins on concurrent admin edits.
- **No new auth primitive**: the permission matrix is a pure function over
  `(operatorRole, targetRole, action)`. No new tables, cookies, or PIN
  prompts.

**Scale/Scope**: One nested route group (`/settings/staff` + 3 placeholder
sibling pages), one shared settings layout, one targeted migration (1
column + 1 index + 1 trigger function + 1 trigger + 1 data backfill
UPDATE), six new Server Actions, one extended `AuditAction` enum, **one
new pure-function module** (`permissions.ts` — the permission matrix and
its `isMutationAllowed` / `roleOptionsFor` / `canDeactivate` /
`canRemove` / `canSetPin` helpers), eight new lacquer components (TabBar,
PageHeader, StaffTable, EditPanel, AddStaffWizard, ChangePinModal,
NumericKeypad, ConfirmDialog — plus StaffAvatar, Badge, ColorPicker,
EmptyState, StaffToaster as supporting), one new shadcn vendoring (`sheet`,
`dialog`, `switch`), one new token block in `styles/tokens.css` (8
`--avatar-*` tokens), one new CSS file (`styles/settings.css`) for
settings-shell-specific layout rules, ~7 unit-test files, 1 e2e spec.
Roughly 1,500–1,900 LoC across implementation + tests (≈300 LoC smaller
than the pre-clarification plan thanks to the dropped override subsystem).
No new runtime dependencies.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Applies? | Status | Notes |
|-----------|----------|--------|-------|
| I. Design System Fidelity | **Yes (load-bearing)** | **PASS** | The feature is fundamentally a UI surface. The `design-system/prototypes/user-management/` prototype is the source layout for every section (see [ui.contract.md § Page → file map](./contracts/ui.contract.md)). Every visual value on the new files resolves to a `var(--*)` token. The 8-swatch avatar palette is added as canonical tokens (`--avatar-*`) rather than left as raw OKLCH literals — see R4. Three new shadcn primitives (`sheet`, `dialog`, `switch`) are vendored; no second component library is introduced. Lucide-only icons at 1.5 px (R12 + ui.contract.md § Icons). The `speckit-design-auditor` agent runs side-by-side against the prototype before merge. |
| II. Server-Authoritative Architecture | **Yes (load-bearing)** | **PASS** | The role gate runs in the Settings `layout.tsx` Server Component (R2). All six mutations are Server Actions. **The permission matrix is the trust boundary** — every mutation re-verifies role (FR-038) and re-runs the operator×target×action matrix check before touching the DB. Client controls disable preemptively but are never trusted. The audit writer uses the service-role client (existing `lib/auth/audit.ts`). |
| III. Auditability & Money Integrity | **Yes (auditability)** | **PASS** | Every successful Server Action writes exactly one `audit_log` row via the extended `AuditAction` controlled vocabulary ([audit.contract.md](./contracts/audit.contract.md)). `acting_as_staff_id` records the operating staff on every mutation row, satisfying Constitution III §1 verbatim. Raw PINs never appear in any payload, log, or error message. Money paths are not exercised. (Note: Constitution III §3 "privileged actions additionally record the authorizing manager" is moot — Clarifications Q1 removed the override; there are no two-actor mutations in this feature.) |
| IV. Test-First for Critical Paths | **Yes (load-bearing)** | **PASS** | The Settings → Staff surface touches auth (role gate, permission matrix, PIN hashing). Per Constitution IV.2 + IV.3, Vitest unit tests for the **last-owner trigger**, the **permission matrix function** (the new trust boundary), the **audit writer extension** (one row per of the six new verbs), and the **sort comparator** are landed red before the implementations. Playwright e2e covers one scenario per user story plus the three US6 negatives (R13). |
| V. Scope Discipline & Cost Restraint | **Yes** | **PASS w/ noted pull-forwards** | Three small in-scope pull-forwards (the Settings shell + tab bar, the `--avatar-*` palette tokens, the `AuditAction` enum widening) are justified in Complexity Tracking. No deferred items (customer self-booking, email/SMS, payroll, etc.) are touched. No new paid services or runtime dependencies. The only schema delta is the minimum needed (one column + one index + one trigger). The deactivation-dialog appointment count is **explicitly deferred** to the future appointments feature (Clarifications Q2) — this feature does not couple to the not-yet-existing `appointments` table. |

**Gate result**: PASS. The three pull-forwards are the smallest shape that
unblocks the spec; documented in Complexity Tracking.

*Post-design re-check (after Phase 1)*: `data-model.md`, `contracts/*`,
and `quickstart.md` add no new abstraction layers beyond what this section
covers. No new runtime dependencies were introduced. The `audit_log` table
schema is unchanged (the only widening is in TypeScript). The six Server
Actions match the existing feature-003 pattern. **Constitution Check still
PASS.**

## Project Structure

### Documentation (this feature)

```text
specs/006-staff-management/
├── plan.md                         # This file
├── spec.md                         # Feature specification + Clarifications session 2026-05-15
├── research.md                     # Phase 0 — 14 decisions (R1–R14)
├── data-model.md                   # Phase 1 — staff column + trigger + AuditAction extension
├── quickstart.md                   # Phase 1 — migrate, seed, run, verify
└── contracts/
    ├── README.md
    ├── routes.contract.md          # /settings/staff URLs + query params
    ├── server-actions.contract.md  # addStaff, updateStaff, setStaffPin, deactivateStaff, reactivateStaff, removeStaff
    ├── audit.contract.md           # 6 new AuditAction verbs + payload shapes (no authorizing_staff_id)
    ├── permissions.contract.md     # NEW (replaces manager-override) — operator × target × action matrix
    └── ui.contract.md              # Page → file map, toast/dialog strings, token mapping, icon catalog
```

### Source Code (repository root)

```text
app/
└── (studio)/
    └── settings/
        ├── layout.tsx                          # NEW — Server Component: role gate + Settings tab bar
        ├── page.tsx                            # NEW — Server Component: redirects to /settings/staff
        ├── staff/
        │   ├── page.tsx                        # NEW — Server Component: fetches roster + renders shell + edit panel slot
        │   ├── actions.ts                      # NEW — addStaff, updateStaff, setStaffPin, deactivateStaff, reactivateStaff, removeStaff
        │   ├── permissions.ts                  # NEW — pure permission matrix (isMutationAllowed, roleOptionsFor, etc.)
        │   ├── toasts.ts                       # NEW — toast string constants (imported by tests + StaffToaster)
        │   └── _validation.ts                  # NEW — name/role/color/pin-shape validators
        ├── general/page.tsx                    # NEW — placeholder "Not part of this prototype"
        ├── notifications/page.tsx              # NEW — placeholder
        └── billing/page.tsx                    # NEW — placeholder

components/
├── ui/                                         # MODIFIED — populated by `npx shadcn@latest add sheet dialog switch`
│   ├── sheet.tsx                               # NEW
│   ├── dialog.tsx                              # NEW
│   └── switch.tsx                              # NEW
└── lacquer/
    ├── badge.tsx                               # NEW — small pill component (status, role)
    ├── numeric-keypad.client.tsx               # NEW — generic 2-step Enter→Confirm keypad; used by 2 places
    ├── settings/
    │   └── tab-bar.tsx                         # NEW — Settings tab bar (General/Staff/Notifications/Billing)
    └── staff/
        ├── page-header.tsx                     # NEW — title + count + show-inactive toggle + Add staff button
        ├── staff-table.client.tsx              # NEW — owns search + show-inactive state; renders rows
        ├── staff-row.tsx                       # NEW — single row (avatar + name + role + PIN + status + added)
        ├── staff-avatar.tsx                    # NEW — initials avatar with --avatar-{color} tint
        ├── color-picker.tsx                    # NEW — 8 swatch radios
        ├── edit-panel.client.tsx               # NEW — owns drafts; computes per-control disabled state via permissions.ts
        ├── add-staff-wizard.client.tsx         # NEW — 3-step Sheet (Details → Set PIN → Done)
        ├── change-pin-modal.client.tsx         # NEW — 2-step PIN modal
        ├── confirm-dialog.tsx                  # NEW — Deactivate/Remove confirmation
        ├── empty-state.tsx                     # NEW — "Select a staff member" placeholder
        └── staff-toaster.client.tsx            # NEW — reads ?toast= once, dispatches Sonner, replace()s URL

lib/
└── auth/
    └── audit.ts                                # MODIFIED — AuthAction → AuditAction (widened); recordAuth alias; same body

styles/
├── tokens.css                                  # MODIFIED — adds 8 --avatar-* tokens
└── settings.css                                # NEW — settings-shell layout rules (every value a token)

supabase/
├── migrations/
│   └── 0002_staff_management.sql               # NEW — removed_at + roster index + last-owner trigger + color-token migrate
└── seed.sql                                    # MODIFIED — emits --avatar-* tokens directly

tests/
├── unit/
│   └── staff/
│       ├── sort.test.ts                        # NEW — role priority + alphabetical
│       ├── filter.test.ts                      # NEW — case-insensitive substring
│       ├── validation.test.ts                  # NEW — name/role/color/pin shape
│       ├── permissions.test.ts                 # NEW — matrix: owner×*, manager×owner=read-only, manager×non-owner=allowed, role-set scope
│       ├── audit.test.ts                       # NEW — payload shape for all 6 verbs (no authorizing_staff_id)
│       └── last_owner_trigger.test.ts          # NEW — DB trigger happy + reject
└── e2e/
    ├── _db.ts                                  # MODIFIED — adds resetStaffToSeed()
    └── staff.spec.ts                           # NEW — one scenario per US + 3 US6 negatives
```

**Structure Decision**: Single Next.js App Router web application (matches
features 001/002/003). The Settings shell lives at `app/(studio)/settings/`
with its own layout (role gate + tab bar); the Staff tab lives at
`app/(studio)/settings/staff/`. The permission matrix is a pure function
module (`permissions.ts`) consumed by both the edit panel client island
(for disabling controls) and every Server Action (for server-side
enforcement). No separate package.

## Phase outputs (for /speckit-tasks)

- **Phase 0**: [research.md](./research.md) — 14 decisions (R1–R14); every
  `NEEDS CLARIFICATION` resolved; reflects Clarifications session 2026-05-15.
- **Phase 1**:
  - [data-model.md](./data-model.md) — `staff` extension, `audit_log`
    enum extension (no `authorizing_staff_id`), last-owner trigger,
    migrations, generated types delta.
  - [contracts/](./contracts) — README + routes + server actions + audit
    + permissions matrix + UI contract.
  - [quickstart.md](./quickstart.md) — migrate, seed, run, smoke-check
    every user story, inspect audit log.

## Complexity Tracking

> Three small items pulled forward into this feature beyond the spec's
> headline scope because they unblock it and they're the smallest shape that
> the spec actually requires.

| Item | Why included here | Simpler alternative rejected because |
|------|-------------------|--------------------------------------|
| Settings shell (`app/(studio)/settings/layout.tsx` + Settings tab bar component) | The spec explicitly describes the page as "Settings → Staff" with the prototype's 4-tab layout (General · Staff · Notifications · Billing). Building the shell here keeps the feature self-contained and gives the other three tabs a real placeholder home to ship into later. The shell is ~80 lines (role gate + nav). | (a) Embed the tab bar inside `/staff/page.tsx` only: would re-render the gate per tab when other tabs ship, fragments the role check; (b) Defer the shell: then `/settings/staff` would render without the tab bar, contradicting every screenshot in the prototype. |
| 8-swatch `--avatar-*` token block in `styles/tokens.css` | The prototype uses 8 distinct avatar colors (FR-010, edge case "Color reuse"), four of which (Purple, Teal, Orange, Slate) are NOT in the canonical Lacquer palette. Adding them as named tokens — rather than leaving four raw OKLCH literals scattered across components — is the only Principle-I-compliant choice. Migrating the existing seed's `--accent-rose`/`--accent-amber`/`--accent-violet` strings to the new names in the same migration keeps the codebase coherent. | (a) Inline OKLCH literals for the four prototype-only colors: violates Constitution I.1; (b) Ship only the 4 semantic tokens and quietly drop the other four: spec explicitly references 8 swatches; (c) Add the colors as `--purple-500` / `--teal-500` etc.: conflates "named brand color" with "avatar swatch", which is the exact ambiguity (`--accent-rose` vs `--rose-500`) that already bit the codebase. |
| `AuthAction` → `AuditAction` enum widening + back-compat alias | Six new audit verbs (one per Server Action) need to land in `lib/auth/audit.ts`. The existing closed union has 5 entries; ignoring the controlled-vocabulary rule (Constitution III) and writing arbitrary strings would defeat the audit invariant. Renaming during the widen is mechanical and the alias keeps feature 003's 4 call sites compiling unchanged for one release. | (a) Add 6 new verbs without renaming the type: `AuthAction` becomes a misnomer (only 5 of 11 verbs are auth-related); (b) Create a separate `StaffAction` union: two parallel enums with no compile-time enforcement that all writes use one or the other — worst of both worlds. |

No other deviations. Standard implementation discipline applies: role gate
runs in the layout's Server Component before any data is fetched; the
permission matrix is the trust boundary for every mutation; PIN hashing
reuses `lib/auth/pin.ts`; the audit writer remains the single point of
truth for the controlled vocabulary; every visual value on every new file
points at a token; the design auditor runs side-by-side against
`design-system/prototypes/user-management/` before merge.
