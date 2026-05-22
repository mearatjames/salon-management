# Implementation Plan: Invitee self-sets their PIN during invite acceptance

**Branch**: `048-invitee-self-set-pin` | **Date**: 2026-05-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/048-invitee-self-set-pin/spec.md`

## Summary

When an invited staff member accepts a **password** invite and finishes setting
their password, route them through a new `/set-pin` step instead of straight to
`/select-staff`. The `/set-pin` page reads the invitee's own `staff` row: if
`pin_hash IS NULL` it shows a "Set your PIN" keypad; if a PIN already exists
(owner set one in thorough mode) it redirects straight to `/select-staff`. The
invitee's chosen PIN is hashed and written by a server action under the
service-role client, an audit row (`user.pin_set`) is recorded with a boolean
witness only, and the invitee continues to `/select-staff` — now visible on the
roster and able to pin in.

The change is purely application-layer: **no schema migration** (the
`audit_log.action` column is plain `text`; `staff.pin_hash` already exists and
the `staff_pin_or_user` CHECK is already satisfied by the invitee's `user_id`).
No new dependencies. The recovery (forgot-password) path is untouched.

## Technical Context

**Language/Version**: TypeScript 5.x, Next.js 16 (App Router — RSC + Server Actions)

**Primary Dependencies**: Next.js 16, `@supabase/supabase-js` + `@supabase/ssr`, `bcryptjs` (existing, for `hashPin`), shadcn/ui + Tailwind, Lucide. No new dependencies.

**Storage**: Supabase Postgres — `staff.pin_hash` (existing, nullable) and `audit_log` (existing). No migration required.

**Testing**: Vitest (unit — server-action behavior), Playwright (e2e — both invite branches end to end).

**Target Platform**: Web. The invite-acceptance + `/set-pin` steps run in the invitee's own browser; `/select-staff` runs on the salon counter device.

**Project Type**: Single Next.js web application.

**Performance Goals**: Invitee completes the PIN step in under 30 s (SC-003). PIN hashing uses the existing bcrypt cost 11 (~150 ms).

**Constraints**: The PIN step MUST run while the invitee's just-authenticated Supabase session (created at password-set) is still valid. No schema drift (Constitution § Development Workflow). All `/set-pin` UI values trace to design-system tokens (Constitution Principle I).

**Scale/Scope**: Single salon; a handful of staff. One new route, one new server action, one new client component, one relocated pure helper.

## Constitution Check

*GATE: evaluated against constitution v1.0.4. Re-checked after Phase 1 design — still passing.*

| Principle | Relevance | Compliance |
|-----------|-----------|------------|
| **I. Design System Fidelity** (NON-NEGOTIABLE) | New `/set-pin` page is a new UI surface. | The page reuses the existing `(auth)` `AuthShell` layout (same as `/reset-password`) and the existing `NumericKeypad` component. No new visual primitives; every value traces to a token. Side-by-side check against `design-system/` is a Phase task. **PASS** |
| **II. Server-Authoritative Architecture** | The PIN write is a privileged mutation. | The PIN is written by a Server Action (`setOwnPin`) using the service-role client — `staff` has no `authenticated` UPDATE RLS policy, so a client write is impossible by construction. Session identity is verified server-side (`supabase.auth.getUser()`); the action writes `pin_hash` only for the staff row whose `user_id` equals the session user (FR-006, FR-007). **PASS** |
| **III. Auditability & Money Integrity** (NON-NEGOTIABLE) | Not money, but auditability applies. | A `user.pin_set` audit row is recorded via `recordAudit`, carrying device user + operator (the invitee's own staff id) and a boolean `pin_set` witness — the raw PIN is hashed and discarded, never logged or audited (FR-011, FR-012, SC-005). Mirrors the existing `inviteUser` / `setStaffPin` witness pattern. **PASS** |
| **IV. Test-First for Critical Paths** | This is an auth/PIN path. | PIN/auth-helper logic gets MANDATORY Vitest unit coverage, written failing first (per principle). The feature ships a Playwright e2e covering both branches (PIN-already-set → skipped; no PIN → step shown and completes). **PASS** |
| **V. Scope Discipline & Cost Restraint** | — | No new dependencies, no new paid services, no schema change, reuses existing PIN primitives (`hashPin`, `validatePinShape`, `NumericKeypad`). Closes a defect within existing v1 onboarding scope. **PASS** |

No violations. **Complexity Tracking** is intentionally empty.

## Project Structure

### Documentation (this feature)

```text
specs/048-invitee-self-set-pin/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output — decisions & rationale
├── data-model.md        # Phase 1 output — entities touched
├── quickstart.md        # Phase 1 output — manual verification walkthrough
├── contracts/
│   └── server-actions.md # Phase 1 output — setOwnPin + updatePassword contract
└── checklists/
    └── requirements.md   # Spec quality checklist (from /speckit-specify)
```

### Source Code (repository root)

```text
app/
├── (auth)/
│   ├── layout.tsx                      # UNCHANGED — AuthShell, reused by /set-pin
│   ├── reset-password/
│   │   └── actions.ts                  # MODIFIED — updatePassword: invite → /set-pin
│   └── set-pin/                        # NEW route
│       ├── page.tsx                    # NEW — session probe + pin_hash gate + render form
│       └── actions.ts                  # NEW — setOwnPin server action
components/
└── lacquer/
    ├── numeric-keypad.client.tsx       # UNCHANGED — reused as-is
    ├── set-pin-form.client.tsx         # NEW — two-phase keypad + hidden action form
    └── staff/
        └── change-pin-modal.client.tsx # MODIFIED — import path for relocated reducer
lib/
└── auth/
    ├── audit.ts                        # MODIFIED — add "user.pin_set" to AuditAction
    ├── pin.ts                          # UNCHANGED — hashPin reused
    └── pin-keypad.ts                   # NEW — relocated pure keypad reducer
app/(studio)/settings/staff/
└── _pin-keypad-state.ts                # DELETED — contents moved to lib/auth/pin-keypad.ts
tests/
├── unit/auth/
│   └── set-pin.test.ts                 # NEW — setOwnPin unit coverage
├── unit/auth/reset-password.test.ts    # MODIFIED — invite redirect now /set-pin
└── e2e/
    ├── set-pin.spec.ts                 # NEW — both branches end to end
    └── _affected-map.mjs               # MODIFIED — map set-pin/reset-password code → set-pin.spec.ts
```

**Structure Decision**: Single Next.js app. The new route lives in the `(auth)`
route group beside `/reset-password` because the invitee holds only a Supabase
auth session at this point (no operator cookie) — the `(studio)` group's
`requireStudioSession()` would reject them, and the `(auth)` `AuthShell` is the
correct centered-card layout for an invite-only step. No `middleware.ts` exists,
so no middleware change is needed.

## Phase 0 — Research

See [research.md](./research.md). All technical unknowns were resolved during
codebase exploration; there are no open `NEEDS CLARIFICATION` items. Key
decisions:

1. **No migration.** `audit_log.action` is plain `text` (per the `0003`
   migration comment); `staff.pin_hash` exists; `staff_pin_or_user` CHECK is
   satisfied by the invitee's non-null `user_id`.
2. **`/set-pin` is the single gate.** `updatePassword` redirects every
   invite-method user to `/set-pin`; the page decides skip-vs-show from
   `pin_hash`. This keeps `updatePassword` a one-line change and gives the
   page one mechanism serving US2 (thorough-mode skip), the direct-nav guard,
   and the "PIN already exists" edge case.
3. **New audit action `user.pin_set`** — distinct from `user.pin_reset`
   (admin recovery) and `staff.pin_set` (settings-panel set). TS-union-only.
4. **Relocate the keypad reducer** to `lib/auth/pin-keypad.ts` so both the
   `(studio)` change-PIN modal and the new `(auth)` set-PIN form import a
   shared helper without crossing a route group's `_`-private boundary.
5. **Magic-link passwordless invites are out of scope** — they never hit
   `updatePassword`. Documented as a known boundary and a one-line follow-up.

## Phase 1 — Design & Contracts

See [data-model.md](./data-model.md) and [contracts/server-actions.md](./contracts/server-actions.md).

- **Data model**: no new entities or columns. `staff.pin_hash` transitions
  `NULL → <bcrypt hash>` for the invitee's row; one `audit_log` row is appended.
- **Contracts**: `setOwnPin(formData)` server action (new) and the
  `updatePassword` redirect change (modified) are specified in
  `contracts/server-actions.md`, including the branch matrix and audit shape.
- **Agent context**: the `<!-- SPECKIT START -->` block in `CLAUDE.md` is
  updated to point at this plan.

### Build sequence

1. **Relocate the keypad reducer** — move `_pin-keypad-state.ts` →
   `lib/auth/pin-keypad.ts`; update the one import in
   `change-pin-modal.client.tsx`. Pure mechanical move, verified by typecheck.
2. **Add the audit action** — extend the `AuditAction` union in
   `lib/auth/audit.ts` with `"user.pin_set"` (entity type derives to `user`).
3. **Write failing unit tests** for `setOwnPin` (Constitution IV — test-first
   for the auth path): valid PIN → hash written + `user.pin_set` audited + raw
   PIN absent from payload; bad shape → `?error=invalid_pin_shape`; no session
   → `?error=expired`; `pin_hash` already set → no overwrite, redirect
   `/select-staff`.
4. **Implement `setOwnPin`** (`app/(auth)/set-pin/actions.ts`) until tests pass.
5. **Implement the `/set-pin` page** (`app/(auth)/set-pin/page.tsx`) — session
   probe, own-staff-row `pin_hash` gate, expired-state card, render the form.
6. **Implement `SetPinForm`** (`components/lacquer/set-pin-form.client.tsx`) —
   `NumericKeypad` two-phase enter/confirm, hidden form posting to `setOwnPin`.
7. **Modify `updatePassword`** — invite method redirects to `/set-pin`; update
   `reset-password.test.ts` accordingly.
8. **e2e** — `set-pin.spec.ts` for both branches; add `_affected-map.mjs` entry.
9. **Design-system check** — side-by-side `/set-pin` vs `design-system/`
   prototypes; confirm every value traces to a token.
10. **Final gate** — full `format:check && lint && typecheck && test && test:e2e`.

## Complexity Tracking

> No constitution violations — section intentionally empty.
