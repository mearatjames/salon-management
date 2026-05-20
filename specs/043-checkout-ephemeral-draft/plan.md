# Implementation Plan: Ephemeral Checkout Draft

**Branch**: `043-checkout-ephemeral-draft` | **Date**: 2026-05-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/043-checkout-ephemeral-draft/spec.md`

## Summary

Checkout currently commits to the database the moment it opens: an empty
`tickets` row on page entry, a `ticket_items` row on every cart edit. This fills
the database with abandoned "ghost" tickets. This feature makes the in-progress
cart an **ephemeral, in-memory draft** — nothing is written while the operator
builds the cart. The `tickets` row and all `ticket_items` are persisted **once,
atomically**, at the first payment-initiating action (cash, card terminal, gift
card, or the first split-tender leg).

Technical approach: a paramless `/checkout` route renders the draft cart with no
database ticket; the existing `/checkout/[ticketId]` route is kept for persisted
tickets (done screen, card-waiting, split continuation). One new Postgres RPC,
`pos_create_ticket_from_draft`, atomically writes the ticket + items + a
`ticket.created` audit row. Each payment-initiating server action gains a
draft-or-ticket input: given a draft it persists first, then runs today's
unchanged payment logic. Resume is removed (FR-013); the two header buttons
collapse into one context-aware exit control (FR-019). All payment machinery,
webhooks, polling, realtime, and reporting surfaces are untouched.

## Technical Context

**Language/Version**: TypeScript 5.x · Next.js 16 (App Router, RSC + Server
Actions) · React 19 · Node.js 24

**Primary Dependencies**: Supabase JS client (Postgres/RLS/Realtime), Square SDK
(server-side), shadcn/ui + Tailwind + Lucide

**Storage**: Supabase Postgres — `tickets`, `ticket_items`, `payments`,
`audit_log` (all unchanged in shape); one new RPC `pos_create_ticket_from_draft`;
one dropped dead index. Migration `0020_checkout_ephemeral_draft.sql`.

**Testing**: Vitest (unit — RPC, draft validation, submission actions) ·
Playwright (e2e against seeded local Supabase)

**Target Platform**: Vercel (web app); modern browsers on shared salon devices

**Project Type**: Web application — single Next.js App Router project

**Performance Goals**: No regression. Submission adds one RPC round-trip before
the payment RPC — sub-second; cart building gets *faster* (no per-edit server
round-trips).

**Constraints**: No operator-visible change within a checkout session except the
two accepted ones — resume removal (FR-012/FR-013) and the Cancel/Discard exit
control consolidation (FR-019/FR-020). Free-tier infra; ~$25–45/mo envelope; no
new paid services or dependencies.

**Scale/Scope**: Single salon; single-digit concurrent operators on shared
devices. ~6 files changed, 1 new module, 1 new migration.

*No NEEDS CLARIFICATION remain — the spec's Clarifications session resolved every
functional unknown; the route shape (the one item the spec deferred to planning)
is decided in research.md R1.*

## Constitution Check

*GATE: evaluated against constitution v1.0.3. Re-checked after Phase 1 design.*

| Principle | Verdict | Notes |
|-----------|---------|-------|
| **I. Design System Fidelity** | PASS | Only one UI surface changes: the header exit control (two buttons → one context-aware control, FR-019). It reuses the existing design-system `Button` — no new tokens, no layout change. The design-auditor reviews it before completion. No other UI surface is touched (FR-003). |
| **II. Server-Authoritative Architecture** | PASS | The ephemeral draft holds no authority — no money, no persisted state. At the persistence boundary the server re-validates the entire draft (service exists, staff active, prices, no unconfirmed lines, totals recomputed) and re-derives non-editable fields from the catalog. Nothing in the draft grants the client a capability it lacks — operators can already set prices/discounts/tech via existing actions. All mutations remain Server Actions; the new RPC is `service_role`-only. |
| **III. Auditability & Money Integrity** | PASS | Ephemeral cart edits perform no writes, so there is nothing to audit (FR-016). `pos_create_ticket_from_draft` emits `ticket.created`; `payment.captured` / `ticket.discarded` are preserved. Money invariants (`total = subtotal + tax`, totals recomputed server-side, clamped ≥ 0) are re-asserted by the RPC and the existing CHECK constraints. Idempotency keys unchanged. |
| **IV. Test-First for Critical Paths** | PASS | Checkout is a critical money path. The new RPC, the draft-validation helper, and the submission-action draft paths get Vitest unit tests written **test-first** (shown failing before implementation). The Playwright e2e suite is updated; the "finalized sale" specs must keep passing unchanged. |
| **V. Scope Discipline & Cost Restraint** | PASS | Pure persistence-timing change plus the two accepted spec deviations. One RPC, one new module, one migration; all payment machinery reused. No new dependency, no new paid service. No data migration (FR-018). |

**Result**: no violations. Complexity Tracking table is empty.

## Project Structure

### Documentation (this feature)

```text
specs/043-checkout-ephemeral-draft/
├── plan.md              # This file
├── research.md          # Phase 0 — route shape + design decisions (R1–R10)
├── data-model.md        # Phase 1 — entities, schema delta
├── quickstart.md        # Phase 1 — build order, verification, gates
├── contracts/           # Phase 1 — interface contracts
│   ├── rpc-pos-create-ticket-from-draft.md
│   ├── checkout-draft.md
│   └── server-actions.md
├── checklists/
│   └── requirements.md  # (pre-existing)
└── tasks.md             # Phase 2 — created by /speckit-tasks
```

### Source Code (repository root)

```text
app/(studio)/checkout/
├── page.tsx                      # CHANGED — renders the draft cart directly (no redirect)
├── checkout-screen.client.tsx    # MOVED here from [ticketId]/ + CHANGED — ticketId nullable, two modes
├── actions.ts                    # CHANGED — remove createEmptyTicket/resumeOrCreateTicket;
│                                 #   draft path on takeCash/sendCardToTerminal/
│                                 #   composeDraftLeg/redeemGiftCardWholeTicket; simplify startNewSale
├── _draft.ts                     # NEW — CheckoutDraft type + server-side validate/resolve helper
├── _drafts.ts                    # unchanged (split-tender draft-leg machinery)
├── _errors.ts                    # unchanged (reuse TicketEmptyError / TicketHasUnpricedItemsError)
├── checkout.css                  # unchanged
└── [ticketId]/
    └── page.tsx                  # unchanged — persisted-ticket render (paid/discarded/open)

supabase/migrations/
└── 0020_checkout_ephemeral_draft.sql   # NEW — pos_create_ticket_from_draft; drop dead index

lib/pos/
└── cart.ts                       # reused — computeTotals folds percent discounts for the draft

docs/
└── system-design.md              # CHANGED — one-line sync of the checkout-open description

tests/
├── unit/checkout/                # remove createEmptyTicket/resumeOrCreateTicket tests;
│                                 #   add pos_create_ticket_from_draft + draft-validation tests
└── e2e/                          # rewrite checkout-resume.spec.ts; update checkout-cash-sale.spec.ts;
                                  #   add an abandon-no-residue spec; finalized-sale specs unchanged
```

**Structure Decision**: Single Next.js App Router project (existing). The
checkout feature lives under `app/(studio)/checkout/`. The client island moves up
one directory so both the new paramless `page.tsx` and the existing
`[ticketId]/page.tsx` import the same component (research.md R2). No new
top-level directories.

## Complexity Tracking

> No constitution violations — table intentionally empty.
