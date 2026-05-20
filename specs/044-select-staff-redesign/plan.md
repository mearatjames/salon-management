# Implementation Plan: Select staff redesign — avatar grid + modal keypad

**Branch**: `044-select-staff-redesign` | **Date**: 2026-05-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/044-select-staff-redesign/spec.md`

## Summary

Rebuild `/select-staff` as **Option D — Avatar grid + modal keypad**: a full-viewport
grid of compact avatar tiles, an as-you-type search field, and a centered modal keypad
that opens when a staff member taps their avatar. The screen leaves the shared `(auth)`
two-panel brand shell (the narrow form panel is the root cause of the scrolling problem)
and gets its own full-bleed layout via a new `(device)` route group.

The roster read, PIN verification, audit logging, operator-cookie session, and the
`next`-destination contract are **reused unchanged**. The one server-side change:
`submitPin` returns a `{ ok: false }` result on a failed attempt instead of redirecting,
so the modal can stay open for an immediate retry (FR-017) — the audit write on both the
success and failure branches is preserved verbatim (FR-020, SC-007).

## Technical Context

**Language/Version**: TypeScript 5.x, React 19, Next.js 16 (App Router — RSC + Server Actions)

**Primary Dependencies**: Next.js 16, React 19, shadcn/ui (`components/ui/dialog.tsx` →
Radix Dialog primitive), Tailwind, Lucide icons, `@supabase/ssr` server client

**Storage**: Supabase Postgres — existing `staff` and `audit_log` tables. **No schema
change** (no migration in `supabase/migrations/**`).

**Testing**: Vitest (unit — `verifyPin`/auth helpers, unchanged), Playwright (e2e —
`tests/e2e/auth.spec.ts`, rewritten for the modal flow + new search coverage)

**Target Platform**: Salon tablet (iPad) in landscape, primary; modern evergreen
browsers; layout degrades gracefully at other widths.

**Project Type**: Web application — single Next.js project (`app/`, `components/`,
`styles/`, `lib/`, `tests/`).

**Performance Goals**: Search narrows a ≤25-row roster with no perceptible delay
(SC-004 — synchronous `useMemo` filter, no debounce). Modal open ≤300ms, dialog
animation per design-system motion tokens. PIN verification latency = bcrypt cost only
(unchanged — FR-024).

**Constraints**: Every visual value resolves to a Lacquer token (Constitution I,
FR-026). No horizontal scroll on tablet landscape (SC-003). Modal open/closed state is
transient client state — a page refresh closes it (replaces today's `?selectedTileId=`
URL parameter). The roster and keypad never compete for vertical space (SC-002).

**Scale/Scope**: Single salon; realistic roster up to ~25 staff. One redesigned route,
~4 new components, 1 new stylesheet, 1 new route-group layout.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Assessment |
|-----------|------------|
| **I. Design System Fidelity** (NON-NEGOTIABLE) | PASS — adapts the vendored Option D prototype (`design-system/prototypes/select-staff/select-staff-variants.jsx`, `VariantAvatarGrid`) rather than redrawing (FR-027); every color/spacing/radius/shadow/type traces to a `styles/tokens.css` token (FR-026); modal uses the shadcn `Dialog` primitive (no second library); icons are Lucide. Verification: side-by-side vs `design-system/prototypes/select-staff/Select Staff Redesign.html`. |
| **II. Server-Authoritative Architecture** | PASS — roster read stays an RSC Supabase query; PIN verification, cookie issuance, and `next` sanitization stay inside the `submitPin` Server Action. No client DB writes. The redesign changes only how `submitPin` *reports* a failure (return value vs redirect) — authority and verification stay server-side. |
| **III. Auditability & Money Integrity** (NON-NEGOTIABLE) | PASS — `recordAuth("staff.signed_in" / "staff.pin_failed")` is preserved on both branches and still `await`ed before the action returns/redirects (FR-020, SC-007). No money paths touched. |
| **IV. Test-First for Critical Paths** | PASS — auth is a critical path. `verifyPin`/cookie unit tests are unchanged; the `submitPin` return-shape change is covered by a failing test written first; the Playwright e2e block is rewritten for the modal flow before the UI lands. Reviewer confirms II/III/IV (auth-touching PR). |
| **V. Scope Discipline & Cost Restraint** | PASS — no new data, services, or dependencies; reuses staff records, PIN/audit/session machinery. Dropping the brand panel for `/select-staff` only is an explicit recommendation in the design file (spec Assumptions). |

**Result**: No violations. Complexity Tracking table omitted.

## Project Structure

### Documentation (this feature)

```text
specs/044-select-staff-redesign/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions
├── data-model.md        # Phase 1 — roster view shape (no schema change)
├── quickstart.md        # Phase 1 — run + verify
├── contracts/
│   └── submit-pin.contract.md   # Phase 1 — submitPin Server Action contract
├── checklists/          # Pre-existing (from /speckit-specify)
└── tasks.md             # Phase 2 — created by /speckit-tasks (NOT this command)
```

### Source Code (repository root)

```text
app/
├── (device)/                         # NEW route group — full-bleed, no brand shell
│   ├── layout.tsx                    # NEW — minimal layout; imports styles/select-staff.css
│   └── select-staff/
│       ├── page.tsx                  # MOVED + rewritten — RSC: device-session check,
│       │                             #   roster query, empty-state, renders the client screen
│       └── actions.ts                # MOVED + edited — submitPin returns {ok:false} on
│                                     #   failure instead of redirecting
└── (auth)/
    ├── layout.tsx                    # unchanged — still wraps /login + /reset-password
    └── select-staff/                 # REMOVED (folder moved to (device)/)

components/lacquer/select-staff/       # NEW component set
├── select-staff-screen.client.tsx    # Orchestrator island — search state + modal state,
│                                     #   header (wordmark + sign out), avatar grid
├── staff-avatar-tile.tsx             # One avatar tile: initials avatar, name, role,
│                                     #   admin-PIN-reset notice (FR-021)
├── pin-entry-modal.client.tsx        # shadcn Dialog — avatar/name/role, 4-dot indicator,
│                                     #   keypad; calls submitPin, handles {ok:false}
└── pin-pad.tsx                       # 12-key callback keypad (0–9, Clear, Backspace)

components/lacquer/
├── staff-roster.tsx                  # REMOVED (dead after redesign — select-staff-only)
├── staff-tile.tsx                    # REMOVED (dead after redesign — select-staff-only)
└── pin-keypad.tsx                    # REMOVED (dead after redesign — select-staff-only)

styles/
├── select-staff.css                  # NEW — full-viewport screen + tile + modal + keypad
└── auth.css                          # EDITED — drop the select-staff-only rule block
                                      #   (.auth-roster/.auth-keypad*/.auth-staff-tile/
                                      #   .auth-headline/.auth-form-row/.auth-form-actions)

design-system/prototypes/select-staff/ # Already vendored by /speckit-specify (FR-028) —
                                      #   plan verifies completeness, adds the mapping line

docs/system-design.md                  # EDITED — add prototype→surface mapping line

tests/e2e/auth.spec.ts                 # EDITED — US2/US3/US5 rewritten for the modal flow;
                                      #   new 044-US1/US2/US3 describe blocks
```

**Structure Decision**: Single Next.js project, unchanged. The only structural move is
relocating `select-staff` from the `(auth)` route group into a **new `(device)` route
group** so it can carry its own full-bleed layout — `/login` and `/reset-password` keep
the `(auth)` two-panel shell. Route groups do not change URLs, so `/select-staff` and
every `proxy.ts` / `switchStaff` reference to that path are unaffected.

## Phase 0 — Research

See [research.md](./research.md). Resolved decisions:

1. **Layout escape from the `(auth)` shell** → new `(device)` route group with its own
   `layout.tsx` (idiomatic Next.js; URL unchanged).
2. **Modal primitive** → shadcn `Dialog` (`components/ui/dialog.tsx`) — backdrop,
   Escape, focus-trap, click-outside come free, covering all of FR-018.
3. **Failed-PIN keeps the modal open** → `submitPin` returns `{ ok: false }` on a failed
   attempt instead of `redirect()`; success still `redirect()`s. The keypad calls the
   action imperatively inside a transition and reads the result.
4. **Keypad component** → new `pin-pad.tsx` (12 keys: 0–9 + Clear + Backspace, per
   FR-013) — neither `pin-keypad.tsx` nor `numeric-keypad.client.tsx` has both Clear and
   Backspace, and modifying the shared `numeric-keypad` would ripple into staff settings.
5. **Search** → controlled input + synchronous `useMemo` filter on display name,
   case-insensitive, partial match; no debounce (≤25 rows).
6. **Transient modal state** → client `useState`; the `?selectedTileId=` / `?error=`
   URL params are dropped. `switchStaff`'s `selectedTileId` argument becomes a no-op the
   new page ignores (left in place; out of scope to remove).
7. **Scroll behavior** → header + search are pinned; only the grid scrolls (FR-006) —
   a deliberate refinement over the prototype, which scrolls the whole section.

## Phase 1 — Design & Contracts

- **Data model** — [data-model.md](./data-model.md): no schema change. Documents the
  `StaffRosterEntry` view shape passed from the RSC page to the client screen.
- **Contract** — [contracts/submit-pin.contract.md](./contracts/submit-pin.contract.md):
  the `submitPin` Server Action — inputs, the new `{ ok: false }` failure return, the
  unchanged success redirect, and the preserved audit writes.
- **Quickstart** — [quickstart.md](./quickstart.md): run + manual/automated verification.
- **Agent context** — `CLAUDE.md` SPECKIT marker updated to point at this plan.

## Phase 2 — Next step

Run `/speckit-tasks` to generate `tasks.md`. Suggested phase order: (1) prototype-vendor
verification + route-group scaffold, (2) US1 avatar grid + modal sign-in, (3) US2
search, (4) US3 error/cancel recovery, (5) cleanup of dead components/CSS + docs, (6)
final full gate set.
