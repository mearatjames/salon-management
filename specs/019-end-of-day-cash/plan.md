# Implementation Plan: End of Day Cash Count

**Branch**: `019-end-of-day-cash` | **Date**: 2026-05-17 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/019-end-of-day-cash/spec.md`

## Summary

Surface the `/end-of-day` route as the cash-count screen exactly as designed in `design-system/prototypes/transaction/End of Day Cash.html`. Owner/manager-role staff see today's cash payments (and any cash refunds, as negative rows) on the left, count the drawer on the right with a numpad, see a live Expected/Counted/Difference comparison, and tap **Close Out Day** to persist a closed `cash_drawer_sessions` row with an audit entry. A non-zero variance requires an explanatory note. The server recomputes the expected total on submit and rejects stale snapshots with a "please recount" banner.

Technical approach: one new migration (`0014_end_of_day_cash.sql`) introduces the `cash_drawer_sessions` table, two `SECURITY DEFINER` RPCs (`pos_ensure_cash_drawer_session`, `pos_close_cash_drawer`), a partial unique index for single-open-session-per-day, and two new `audit_log` actions. A thin RSC page + a client island consume an in-repo query helper (`lib/end-of-day/cash-count.ts`); the close path is a Server Action wrapping the close RPC. UI composes existing Lacquer primitives (`tech-avatar`, `empty-feed-state`, the `tnum` typography pattern) and vendors the prototype's CSS into `styles/end-of-day.css`.

## Technical Context

**Language/Version**: TypeScript 5.x on Node 20 (current repo target).

**Primary Dependencies**: Next.js 16 App Router (RSC + Server Actions), `@supabase/supabase-js` (server-cookie-aware client for reads, service-role client for the close RPC), shadcn/ui + Lucide. No new runtime dependencies.

**Storage**: Supabase Postgres. One new table (`cash_drawer_sessions`) and two new RPCs added by migration `0014_end_of_day_cash.sql`. Two new `AuditAction` enum values appended in `lib/auth/audit.ts`.

**Testing**: Vitest unit suite for the close-RPC wrapper, the aggregation/sort helper, and the numpad input rules. Playwright e2e (`tests/e2e/end-of-day-cash.spec.ts`) for US1/US2/US3 against the seeded local Supabase.

**Target Platform**: Studio tablets (1024×720 primary). Page is part of the existing `(studio)` route group, gated by `requireStudioSession()` plus an in-action role check (owner/manager only).

**Project Type**: Single Next.js web app (existing). No new app, no monorepo split.

**Performance Goals**: SC-002 sets the bar — comparison block updates ≤ 150 ms per keystroke. The numpad is a client island so updates are local; no roundtrip per key. The page-load query targets ≤ 250 ms cold (one indexed read against `payments` filtered to today's UTC window in salon tz).

**Constraints**:
- Server-authoritative writes only: the close goes through `pos_close_cash_drawer` via the existing `lib/db/admin.ts` service-role client (mirrors `pos_take_cash`).
- Audit logging is mandatory for `cash_drawer.closed` (Principle III) and is written inside the same RPC transaction as the row close.
- At most one open `cash_drawer_sessions` row per business day per salon, enforced by a partial unique index (single-tenant: `WHERE closed_at IS NULL`).
- The `payment_kind` enum currently has only `'payment'`; the refund-display path in this feature is forward-compatible — it correctly renders zero refund rows today and starts rendering them automatically when the refund feature later adds `'refund'`.

**Scale/Scope**: Single salon, single page, single Server Action, single migration. Roughly 1 new RSC page, 1 client island, 2 leaf components, 1 confirmation component, 1 stylesheet, 1 SQL migration, 4–5 test files.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Note |
|-----------|--------|------|
| I. Design System Fidelity (NON-NEGOTIABLE) | ✅ Pass | Page is an adaptation of `design-system/prototypes/transaction/End of Day Cash.html` + `EndOfDay.jsx`. All colors, spacing, radii, type, and animation come from the existing `styles/tokens.css`. Numpad reuses the `tnum` numeric pattern from the dashboard. Icons (`Check`, `Backspace`) are Lucide. A side-by-side compare against `design-system/preview/transaction-end-of-day-cash.html` (or the matching `preview/*.html` rendered from this prototype) is part of the Phase 7 design auditor pass. |
| II. Server-Authoritative Architecture | ✅ Pass | The cash-list read is an RSC query through the cookie-aware Supabase client (RLS-bound to `authenticated`). The close write is a Server Action that calls a `SECURITY DEFINER` RPC via the service-role client; no client-side writes. Role gating (owner/manager only) lives inside the Server Action AND the page wrapper; RLS is a backstop. No Square call is made in this feature, so the rule trivially holds. |
| III. Auditability & Money Integrity (NON-NEGOTIABLE) | ✅ Pass | Every close inserts an `audit_log` row with `action='cash_drawer.closed'`, both `actor_user_id` and `acting_as_staff_id`, and a payload of `{expected_cents, counted_cents, variance_cents, notes}`. The partial unique index enforces single-open-session-per-day; the RPC double-checks the expected total against the operator's snapshot to prevent stale closes. Variance is computed, never guessed (FR-005, Principle III bullet on variance). The new `audit_log` action verbs (`cash_drawer.opened`, `cash_drawer.closed`) are added to the controlled vocabulary in `lib/auth/audit.ts`. |
| IV. Test-First for Critical Paths | ✅ Pass | Close-RPC wrapper is treated as money/auth logic — Vitest tests are written first (covering happy path, variance+note, stale-data rejection, concurrency idempotency, role gating). The aggregation helper has a unit test for refund handling (forward-compat) and time-window correctness. Playwright e2e covers US1/US2/US3 against seeded local Supabase. The numpad input rules (decimal cap, two-decimal cap, clear, backspace) have a small Vitest + RTL unit test. |
| V. Scope Discipline & Cost Restraint | ✅ Pass | Out of scope (explicit in spec.md Assumptions): day report, tip-allocation review, opening-cash-count UI, PIN-gating the close. No new infra, no new paid dependency, no new external service. One migration, no schema reservations expanded. |

No violations to record in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/019-end-of-day-cash/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── server-action.md       # closeCashDrawerAction contract
│   ├── rpc-pos-close-cash-drawer.md   # SQL RPC signature, error codes, idempotency
│   └── audit.md               # New audit actions + payload shapes
├── checklists/
│   └── requirements.md  # already created by /speckit-specify
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
salon-management/
├── app/
│   └── (studio)/
│       └── end-of-day/
│           ├── page.tsx                   # NEW — RSC: role gate, loads cash list, renders client island
│           ├── actions.ts                 # NEW — closeCashDrawerAction Server Action
│           └── _state.ts                  # NEW (if needed) — small types shared with the client island
├── components/
│   └── lacquer/
│       └── eod/
│           ├── cash-list.tsx              # NEW — left panel; renders today's cash rows + footer total
│           ├── cash-row.tsx               # NEW — one tx row (sale or refund styling)
│           ├── cash-count.client.tsx      # NEW — right panel: numpad + display + comparison + note + CTA
│           ├── numpad-buttons.tsx         # NEW — pure presentational 3×4 grid (server-renderable)
│           └── done-screen.tsx            # NEW — post-close confirmation
├── lib/
│   ├── end-of-day/
│   │   ├── cash-count.ts                  # NEW — loadCashCount(supabase, tz, now): query layer
│   │   ├── aggregate.ts                   # NEW — pure: rows + totals from raw payment rows
│   │   └── close.ts                       # NEW — server-action wrapper around the close RPC
│   ├── auth/
│   │   └── audit.ts                       # EDIT — add 'cash_drawer.opened' and 'cash_drawer.closed'
│   └── db/
│       └── types.ts                       # REGENERATE — picks up the new table + RPCs
├── styles/
│   └── end-of-day.css                     # NEW — vendored from prototype (.eod-* class set)
├── supabase/
│   ├── migrations/
│   │   └── 0014_end_of_day_cash.sql       # NEW — table + indexes + RPCs + audit-vocab nothing (vocab is TS-only)
│   └── seed.sql                            # EDIT (if needed) — add a couple of seeded cash payments for the e2e
└── tests/
    ├── unit/
    │   ├── end-of-day/
    │   │   ├── aggregate.test.ts          # NEW — totals, refund rows, ordering, empty-day
    │   │   ├── close-action.test.ts       # NEW — happy / variance+note / stale / concurrent / role-gate
    │   │   └── numpad.test.tsx            # NEW — decimal cap, two-decimal cap, clear, backspace
    │   └── time/
    │       └── period-windows.test.ts     # EXISTING — no edit; todayWindow already covered
    └── e2e/
        └── end-of-day-cash.spec.ts        # NEW — US1, US2, US3 against seeded local Supabase
```

**Structure Decision**: Continues the established `app/(studio)/<route>/` + `components/lacquer/<feature>/` + `lib/<feature>/` triad used by the dashboard (`016-dashboard-data-wiring`) and the checkout split-tender (`018-gift-card-split-tender`). The new `lib/end-of-day/` module keeps the cash-count read model isolated; when the future day-report and tip-allocation features land they extend this folder rather than carving a separate one. The migration filename continues the sequential `0014_*` numbering on top of `main`'s most recent `0013_*`.

## Complexity Tracking

> No constitution violations to justify. Leave this table empty.
