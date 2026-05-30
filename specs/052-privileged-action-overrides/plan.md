# Implementation Plan: Privileged-Action Overrides — Voids & Refunds

**Branch**: `052-privileged-action-overrides` | **Date**: 2026-05-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/052-privileged-action-overrides/spec.md`

## Summary

Add two money-reversal paths to the POS, both authorized by the **acting staff's role** (active owner or manager), enforced server-side and hidden in the UI for everyone else — no manager-PIN dialog:

1. **Same-day void** — from the paid/partially-paid checkout `DoneScreen`, an owner/manager can fully reverse a ticket paid on the current salon-local day. The void creates a `kind='refund'` payment row mirroring **each** completed payment (matched by method), issues a Square refund for card/gift payments, records a cash refund row for cash (drawer reconciliation deferred), sets `tickets.status='void'`, and audits `void.issued`.
2. **Post-close refund (full/partial)** — from the dashboard recent-transactions feed and the End-of-Day day report, an owner/manager opens the existing **receipt drawer**, composes per-payment refund amounts (sum ≤ each payment's unrefunded remainder), and submits. The action creates `kind='refund'` rows linked to originals via `refunds_payment_id`, issues Square refunds for card/gift, and sets status to `refunded` or `partially_refunded`. Audits `refund.issued`.

The work reuses feature 050's established privileged-paid-ticket pattern verbatim (`requireStudioSession()` → role gate → service-role mutation → `recordAudit`), the existing `ReceiptDrawer` (`viewerRole` + `payPeriodFinalized` already plumbed), and the Square client/idempotency helpers. New: a `lib/square/refunds.ts` wrapper, a `0025` migration extending the `ticket_status`/`payment_kind` enums and `payments` columns plus two atomic settlement RPCs, and Lacquer UI for the void-confirm dialog and refund-composition controls.

## Technical Context

**Language/Version**: TypeScript 5.x, Next.js 16 (App Router, RSC + Server Actions), React 19.

**Primary Dependencies**: Supabase (Postgres + RLS, service-role client for writes), Square SDK (server-side; `client.payments.refundPayment`), shadcn/ui + Tailwind + Lucide, Zod (action input validation, per existing actions).

**Storage**: Postgres via Supabase. New migration `0025_void_refund.sql`. Tables touched: `tickets` (status enum), `payments` (kind enum + `refunds_payment_id`, `square_refund_id` columns), `audit_log` (two new actions). All writes via service-role per Principle II.

**Testing**: Vitest unit (refund math, Square refund wrapper, status-derivation helper) + Playwright e2e (void from checkout, full/partial refund from dashboard feed & receipt drawer, role-gate denial). Test-first for money/auth paths per Principle IV.

**Target Platform**: Salon-staff web app on shared in-store devices (desktop/tablet browsers).

**Project Type**: Web application (Next.js single project; no separate frontend/backend split).

**Performance Goals**: Interactive POS targets — a same-day full void completes in < 30s of operator time (SC-005); reversal server actions complete within standard interactive latency (no batch/throughput concern; one ticket at a time).

**Constraints**: Money integrity (Principle III) — every reversal is an explicit `kind='refund'` row linked to its original; Square calls carry the deterministic idempotency key `${payment_id}:refund:${refund_payment_id}`; no in-place mutation/deletion of payments; per-payment refunds never exceed the original. Failed Square refund must not leave a ticket `void`/`refunded` (atomic, recoverable). Free-tier infra envelope unchanged (Principle V).

**Scale/Scope**: Single salon. Two user stories, ~3 surfaces (checkout DoneScreen, dashboard feed, EOD day report / shared receipt drawer), one migration, one Square wrapper, two RPCs, ~3 new Lacquer components.

## Constitution Check

*GATE: evaluated pre-Phase 0 and re-checked post-Phase 1.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Design System Fidelity (NON-NEGOTIABLE) | ✅ PASS | New void-confirm + refund-composition UI use shadcn `AlertDialog`/`Sheet` primitives composed in `components/lacquer/*`, Lucide icons, tokens only. Will side-by-side against `design-system/` and dispatch `speckit-design-auditor` (touches `components/`). |
| II. Server-Authoritative Architecture | ⚠️ JUSTIFIED DEVIATION | Authority is enforced in Server Actions (✅), all Square calls server-side (✅), service-role writes (✅). **Deviation:** Principle II requires a "fresh manager-PIN inline override" for refunds/voids; the approved spec gates by **acting-staff role** instead (no PIN). Justified below + recommend constitution amendment. |
| III. Auditability & Money Integrity (NON-NEGOTIABLE) | ⚠️ JUSTIFIED DEVIATION | Explicit `kind='refund'` rows linked to originals (✅), deterministic refund idempotency key `${payment_id}:refund:${refund_payment_id}` (✅), no in-place money mutation (✅), audit records operator (✅). **Deviation:** III says privileged actions "additionally record the authorizing manager" (a second party); the single-actor model records the acting owner/manager as the sole authority. Justified below. |
| IV. Test-First for Critical Paths | ✅ PASS | Refund math, Square refund wrapper, and status-derivation get Vitest unit tests written-to-fail first; each story gets a Playwright e2e (incl. role-gate denial). |
| V. Scope Discipline & Cost Restraint | ✅ PASS | Voids & refunds are in the v1 `docs/system-design.md` scope. Cash-drawer reconciliation for cash refunds is explicitly deferred to the drawer-session work (matches design doc). No new paid infra. |

**Deviation justification (Principles II & III — manager-PIN → role gate, single authorizer):**

The maintainer issued a direct, documented scope change in `/speckit-clarify` (recorded in spec § Clarifications and § Resolved Decisions, 2026-05-28): reversals are gated by the acting staff's owner/manager role rather than an inline manager-PIN, and each reversal is attributed to that single acting owner/manager (no separate `authorized_by` actor/field).

- **Governance authority**: The constitution's Governance section states *"where it conflicts with an explicit maintainer instruction in `CLAUDE.md` or a direct request, the maintainer instruction wins."* This clarification is exactly such a direct request, so the deviation is sanctioned without blocking.
- **Precedent**: Feature 050 (reassign-paid-line-tech) already authorizes a privileged action on a *paid* ticket with a server-side role check and no PIN — the same mechanism this feature reuses. The PIN-on-every-privileged-action rule is already not literally in force for paid-ticket mutations.
- **Spirit preserved**: Authority is still enforced server-side (Principle II's core intent) and the authorizing party (the acting owner/manager) is still recorded in `audit_log` (Principle III's core intent) — the only change is that the authorizer is the operator rather than a distinct second person.
- **Recommendation (non-blocking)**: Amend the constitution — Principle II's "fresh manager-PIN inline override" sentence and Principle III's "additionally record the authorizing manager" clause — to reflect role-based authorization as the v1 mechanism, so the documents stay honest. This is surfaced to the maintainer; it is not a prerequisite for implementation.

**Complexity Tracking**: see table at end — the two deviations are the only entries; no structural/complexity violations.

## Project Structure

### Documentation (this feature)

```text
specs/052-privileged-action-overrides/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions & gotchas
├── data-model.md        # Phase 1 — schema deltas, states, invariants
├── quickstart.md        # Phase 1 — how to exercise void/refund locally
├── contracts/           # Phase 1
│   ├── audit.contract.md          # void.issued / refund.issued payloads
│   ├── server-actions.contract.md # voidSale / refundTicket signatures + errors
│   └── square-refund.contract.md  # lib/square/refunds.ts wrapper contract
├── checklists/
│   └── requirements.md  # from /speckit-specify
└── tasks.md             # /speckit-tasks (NOT created here)
```

### Source Code (repository root)

```text
supabase/migrations/
└── 0025_void_refund.sql            # NEW — enum + column extensions, pos_void_ticket + pos_refund_payments RPCs

lib/square/
└── refunds.ts                      # NEW — refundCardPayment() wrapper (card + gift) over client.payments.refundPayment

lib/payments/
└── refund-status.ts                # NEW — pure: derive ticket status (void|refunded|partially_refunded) + per-payment remaining

app/(studio)/checkout/
├── actions.ts                      # EDIT — add voidSale() server action
└── _errors.ts                      # EDIT — add VoidNotAllowedError, RefundExceedsRemainingError, SquareRefundFailedError, PermissionDeniedError (or reuse transactions' PermissionDeniedError)

app/(studio)/transactions/
└── actions.ts                      # EDIT — add refundTicket() server action (reused by dashboard feed + EOD report + transactions page)

components/lacquer/checkout/
├── done-screen.tsx                 # EDIT — add owner/manager "Void sale" affordance (same-day only)
└── void-confirm-dialog.tsx         # NEW — AlertDialog confirming full reversal

components/lacquer/transactions/
├── receipt-drawer.tsx              # EDIT — add owner/manager "Refund" entry → refund composition
└── refund-composition-sheet.tsx    # NEW — per-payment amount inputs, validation, submit

components/lacquer/
└── recent-transactions-feed.tsx    # EDIT — per-row "Refund" affordance (owner/manager) opening the receipt drawer / sheet

app/(studio)/end-of-day/
└── (day-report surface)            # EDIT — wire "Refund" affordance into the day-report transaction list

lib/auth/audit.ts                   # EDIT — add "void.issued" | "refund.issued" to AuditAction (entity_type "payment")

tests/unit/
├── payments/refund-status.test.ts  # NEW
└── square/refund-payment.test.ts   # NEW

tests/e2e/
├── void-sale.spec.ts               # NEW (same-day void from checkout)
├── refund-ticket.spec.ts           # NEW (full/partial refund from feed + drawer; role-gate denial)
└── _affected-map.mjs               # EDIT — map new prod paths → these specs
```

**Structure Decision**: Single Next.js project (existing layout). The void action lives with checkout (`app/(studio)/checkout/actions.ts`) because it operates on the in-checkout paid ticket; the refund action lives with `app/(studio)/transactions/actions.ts` because it is invoked from three read surfaces (dashboard feed, EOD report, transactions page) that already share the `ReceiptDrawer` and its `viewerRole`/`payPeriodFinalized` plumbing from feature 050. Pure math is isolated in `lib/payments/refund-status.ts` for unit testing per Principle IV.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Principle II — role gate instead of fresh manager-PIN override on void/refund | Direct, documented maintainer scope change (spec § Resolved Decisions, 2026-05-28); governance clause makes the maintainer instruction win. Matches the existing feature-050 paid-ticket pattern. | Implementing a manager-PIN dialog would directly contradict the maintainer's explicit instruction to remove it. |
| Principle III — single acting owner/manager recorded, no separate `authorized_by` | Single-actor authorization model approved in clarification; the authorizer *is* the operator, so a second field would always duplicate `acting_as_staff_id`. | A distinct `authorized_by_staff_id` column would carry redundant data and reintroduce the PIN-second-party concept the maintainer removed. |
