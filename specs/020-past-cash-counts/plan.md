# Implementation Plan: Past Cash Counts — View and Edit

**Branch**: `020-past-cash-counts` | **Date**: 2026-05-17 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/020-past-cash-counts/spec.md`

## Summary

Extend feature 019 (End of Day Cash) with two new capabilities the prototype does not cover: (a) a **history view** at `/end-of-day/history` that lists every closed `cash_drawer_sessions` row, and (b) an **edit affordance** on each row's detail view that lets an owner or manager correct the counted amount and notes after the fact. Each edit updates the row in place (no "reopen" transition) and writes a `cash_drawer.edited` audit_log entry in the same transaction so the trail of "who changed what, when" is intact and queryable.

Technical approach: one new migration (`0015_cash_drawer_edits.sql`) adds an `updated_at` column to `cash_drawer_sessions` and one new `SECURITY DEFINER` RPC (`pos_edit_cash_drawer`) that performs the update and the audit insert atomically. One new `AuditAction` enum value (`cash_drawer.edited`) is appended in `lib/auth/audit.ts`. Two new RSC pages — `/end-of-day/history` (list) and `/end-of-day/history/[sessionId]` (detail/edit) — read from a new `lib/end-of-day/history.ts` query layer. The numpad + comparison block from `cash-count.client.tsx` is extracted to a shared `lib/end-of-day/comparison.ts` derivation and a generalized `cash-count-form.client.tsx` so the close screen and the edit screen share the same input affordance without duplication. A "View past counts" link is added to the `/end-of-day` header.

## Technical Context

**Language/Version**: TypeScript 5.x on Node 20 (current repo target).

**Primary Dependencies**: Next.js 16 App Router (RSC + Server Actions), `@supabase/supabase-js` (server-cookie-aware client for reads, service-role client for the edit RPC), shadcn/ui + Lucide. No new runtime dependencies.

**Storage**: Supabase Postgres. One column (`cash_drawer_sessions.updated_at`) and one RPC (`pos_edit_cash_drawer`) added by migration `0015_cash_drawer_edits.sql`. One new `AuditAction` enum value appended in `lib/auth/audit.ts`.

**Testing**: Vitest unit suite for the edit-RPC wrapper, the history query layer, and the (unchanged) comparison derivation now in its own module. Playwright e2e (`tests/e2e/past-cash-counts.spec.ts`) for US1/US2/US3 against the seeded local Supabase.

**Target Platform**: Studio tablets (1024×720 primary), part of the existing `(studio)` route group, gated by `requireStudioSession()` plus an in-action/in-page role check (owner/manager only). Reuses the existing studio layout chrome — no new shell work.

**Project Type**: Single Next.js web app (existing). No new app, no monorepo split.

**Performance Goals**: SC-001 sets the list bar — locating a specific past day in ≤ 15 s, so the list must paint in ≤ 250 ms cold. Targeted: a single indexed read on `cash_drawer_sessions` ordered by `business_day desc` with a left-join count from `audit_log` for the "Edited" pill, limited to the most-recent-90-day window. SC-002 sets the edit bar — full edit round-trip ≤ 60 s; the comparison block keeps the existing 150 ms keystroke responsiveness because we reuse the existing client island's local-derivation pattern.

**Constraints**:
- Server-authoritative writes only: the edit goes through `pos_edit_cash_drawer` via the existing `lib/db/admin.ts` service-role client (mirrors the existing `pos_close_cash_drawer`).
- Audit logging is mandatory for `cash_drawer.edited` (Principle III) and is written inside the same RPC transaction as the row update. The audit row is what backs the "Edited" pill and the "Change history" section — there is no denormalized flag (FR-009 explicit).
- `business_day`, `expected_cents`, `opening_cents`, `opened_at`, `opened_by_staff_id`, `closed_at`, and `closed_by_staff_id` are immutable across edits (FR-007). The check constraint `cash_drawer_close_consistency_chk` continues to hold because the RPC recomputes `variance_cents = counted_cents − (opening_cents + expected_cents)` server-side.
- No "reopen" transition. The existing partial unique index `cash_drawer_sessions_one_open_idx` continues to mean "at most one open session at a time," not "at most one session ever."
- Concurrency: last-write-wins on the row update; both edits emit an audit row so neither is silently lost. No optimistic-lock token in v1 — the audit trail is the safeguard (research R2).

**Scale/Scope**: Single salon. Roughly 2 new RSC pages, 1 new client island (the edit form reusing the numpad), 2–3 new leaf components (history-list row, history-list empty state, change-history accordion), 1 new server module (`history.ts`), 1 new Server Action (`editCashDrawerAction`), 1 SQL migration, 4 new test files. The existing 019 surfaces are not modified except for one header link.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Note |
|-----------|--------|------|
| I. Design System Fidelity (NON-NEGOTIABLE) | ✅ Pass | The history list and detail panel are net-new surfaces — the Lacquer prototype `prototypes/transaction/End of Day Cash.html` covers only the close flow. The new surfaces adapt existing studio chrome: header treatment mirrors `app/(studio)/end-of-day/page.tsx` (`tx-landing-top`); the list uses the same row pattern as the dashboard recent-transactions feed; the detail and edit views reuse the comparison-block + numpad CSS already vendored in `styles/end-of-day.css`. All colors, spacing, radii, type, and animation continue to come from `styles/tokens.css`. Icons (`History`, `Pencil`, `ArrowLeft`) are Lucide. A side-by-side compare against the canonical preview HTML is part of the Phase N design-auditor pass on every UI-touching phase. |
| II. Server-Authoritative Architecture | ✅ Pass | All reads (list, detail, change history) are RSC queries through the cookie-aware Supabase client (RLS-bound to `authenticated`; `cash_drawer_sessions` has the existing `select to authenticated using (true)` policy). The edit write is a Server Action that calls a `SECURITY DEFINER` RPC via the service-role client; no client-side writes. Role gating (owner/manager only) lives inside the page wrapper AND the Server Action; RLS is a backstop. No Square call is made in this feature. |
| III. Auditability & Money Integrity (NON-NEGOTIABLE) | ✅ Pass | Every edit inserts an `audit_log` row with `action='cash_drawer.edited'`, both `actor_user_id` and `acting_as_staff_id`, and a payload of `{before: {counted_cents, variance_cents, notes}, after: {counted_cents, variance_cents, notes}}`. The RPC update and the audit insert are in the same transaction. Variance is recomputed server-side, never trusted from the client (FR-007). The new `AuditAction` verb (`cash_drawer.edited`) joins the controlled vocabulary in `lib/auth/audit.ts`. Money is never silently mutated — the constitution's "refunds create explicit rows, money never silently deleted" rule is honored here because an edit is documented as an audited correction, not a covert overwrite. |
| IV. Test-First for Critical Paths | ✅ Pass | The edit RPC is treated as money/auth logic — Vitest tests are written first covering: happy path, variance+note required, note-clearing only when new variance is zero, role gating, idempotent no-op edits still write audit, concurrent last-write-wins. The history query layer has a unit test for ordering, pagination boundaries, and the `audit_log`-derived "edited" flag. Playwright e2e covers US1 (list + read), US2 (edit), and US3 (edit indicator + change history). |
| V. Scope Discipline & Cost Restraint | ✅ Pass | Out of scope (explicit in spec.md Assumptions): reopen transition, lock-after-deposit window, PIN re-prompt for edits, salon-wide day report, tip-allocation review. No new infra, no new paid dependency, no new external service. One migration, no schema reservations expanded, one new column on the existing table. Forward-compat columns (`updated_at`) chosen over a separate `cash_drawer_edits` history table because the audit_log already carries the per-edit detail (research R3). |

No violations to record in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/020-past-cash-counts/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── server-action.md        # editCashDrawerAction contract
│   ├── rpc-pos-edit-cash-drawer.md   # SQL RPC signature, error codes, idempotency
│   └── audit.md                # New audit action + payload shape
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
│           ├── page.tsx                                # EDIT — add "View past counts" link in header
│           └── history/
│               ├── page.tsx                            # NEW — RSC: role gate, lists closed sessions (US1)
│               ├── [sessionId]/
│               │   ├── page.tsx                        # NEW — RSC: role gate, loads one session + audit trail; renders detail + edit island (US1/US2/US3)
│               │   └── not-found.tsx                   # NEW — 404 for unknown/non-closed session ids
│               └── actions.ts                          # NEW — editCashDrawerAction Server Action
├── components/
│   └── lacquer/
│       └── eod/
│           ├── cash-count.client.tsx                   # KEEP — unchanged; close screen still owns its own state
│           ├── history/
│           │   ├── history-list.tsx                    # NEW — server component: rows, header, "Show earlier" affordance
│           │   ├── history-row.tsx                     # NEW — one row: business day, expected, counted, variance (color), closer, time, optional "Edited" pill
│           │   ├── history-empty.tsx                   # NEW — empty-state per spec (no closed days yet)
│           │   ├── detail-view.tsx                     # NEW — server component: read-only breakdown + change-history accordion + "Edit count" CTA (US1/US3)
│           │   ├── edit-form.client.tsx                # NEW — client island: numpad + notes + Save/Cancel (US2). Imports the existing numpad components.
│           │   └── change-history.tsx                  # NEW — server component: expandable list of prior versions from audit_log rows (US3)
│           └── numpad-buttons.tsx                      # KEEP — already shared-friendly (presentational)
├── lib/
│   ├── end-of-day/
│   │   ├── history.ts                                  # NEW — loadCashHistoryList(supabase, opts), loadCashHistoryDetail(supabase, sessionId): query layer
│   │   ├── edit.ts                                     # NEW — server-action wrapper around the edit RPC
│   │   └── comparison.ts                               # NEW (extracted from cash-count.client.tsx) — pure deriveComparison(counted, expectedCents); shared by both client islands
│   ├── auth/
│   │   └── audit.ts                                    # EDIT — add 'cash_drawer.edited' to the AuditAction union
│   └── db/
│       └── types.ts                                    # REGENERATE — picks up the new column + RPC
├── styles/
│   └── end-of-day.css                                  # EDIT — add .eod-history-* + .eod-detail-* + "edited" pill styles, all token-only
├── supabase/
│   ├── migrations/
│   │   └── 0015_cash_drawer_edits.sql                  # NEW — add updated_at column + pos_edit_cash_drawer RPC
│   └── seed.sql                                         # EDIT — seed two closed sessions (one clean, one short with note) for the e2e
└── tests/
    ├── unit/
    │   └── end-of-day/
    │       ├── history.test.ts                         # NEW — ordering, pagination boundary, audit-derived edited flag
    │       ├── edit-action.test.ts                     # NEW — happy / variance+note / note-clear-when-zero / role-gate / idempotent no-op
    │       └── comparison.test.ts                      # NEW — extracted derivation rules (regression-free re-export from cash-count.client.tsx)
    └── e2e/
        └── past-cash-counts.spec.ts                    # NEW — US1, US2, US3 against seeded local Supabase
```

**Structure Decision**: Continues the established `app/(studio)/<route>/` + `components/lacquer/<feature>/` + `lib/<feature>/` triad used by features 016, 018, and 019. The history view lives under `/end-of-day/history` rather than at a top-level `/cash-history` to keep the End of Day nav surface coherent — operators looking for "yesterday's count" land on the same root they use to close today. The detail page is a route (not a slide-in panel) per research R1 — shareable URLs, simpler RSC composition, native back-button. The shared `comparison.ts` extraction is the smallest change that lets two client islands derive identical comparison state without duplicating the math. The new migration filename continues the sequential `0015_*` numbering on top of `main`'s `0014_*`.

## Complexity Tracking

> No constitution violations to justify. Leave this table empty.
