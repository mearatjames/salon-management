# Implementation Plan: Checkout — Cash-Only Sale

**Branch**: `011-cash-sale-wip` | **Date**: 2026-05-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/011-cash-sale-checkout/spec.md`

## Summary

Stand up the single-screen cash-only checkout: front desk taps "New transaction" (dashboard) or "Checkout" (sidebar), lands in a standalone empty ticket, picks a tech, taps services from the tile grid, takes cash, and lands on a "Charged $X" confirmation. Same-day open tickets resume from the sidebar; abandoned tickets can be explicitly discarded; failed payments leave the ticket open with an inline error and never produce partial state. A minimal browser-printable receipt is rendered server-side per ticket.

**Technical approach**: introduce the first POS schema in `supabase/migrations/0004_checkout_cash_sale.sql` — `appointments` (schema only this phase), `tickets`, `ticket_items`, and `payments` — sized to the existing `docs/system-design.md` data model verbatim, plus one new ticket status value (`discarded`) added per clarification Q5. Cash payment is a single Server Action that writes the `payments` row and flips `tickets.status` to `paid` inside one Postgres transaction (Principle III). The page at `app/(studio)/checkout/page.tsx` runs the resume-or-create Server Action and `redirect()`s to `/checkout/[ticketId]`. The single-screen UI at `app/(studio)/checkout/[ticketId]/page.tsx` is a Server Component that fetches the ticket + cart and renders a client island composed from new `components/lacquer/checkout/*` pieces (`TxHeader`, `TechAvatarRow`, `ServiceTiles`, `CartRowWithTech`, `PaymentTiles`, `Totals`, `DoneScreen`), each adapted from `design-system/prototypes/transaction/FlowSingle.jsx`. Receipt is a separate server-rendered route `/checkout/[ticketId]/receipt` that gates on the existing `requireStudioSession()` (no public URL). No Realtime, no optimistic-only client writes, no Square, no drawer-session gating; an inline `// TODO(phase-9)` marker at the cash boundary holds the place for the future drawer increment.

## Technical Context

**Language/Version**: TypeScript 5 on Node.js 22 (Next.js 16 App Router; Server Components + Server Actions).

**Primary Dependencies**: Next.js 16, React 19, shadcn/ui (Radix primitives), Tailwind CSS, `lucide-react` (icons), `@supabase/supabase-js` (existing typed clients in `lib/db/`), `zod` (action input validation, already in repo). No new runtime dependencies.

**Storage**: Supabase Postgres (hosted preview + prod). New tables created by migration `0004_checkout_cash_sale.sql`: `appointments`, `tickets`, `ticket_items`, `payments`. `appointments` is schema-only — created to satisfy the `tickets.appointment_id` FK; it is not populated, queried, or surfaced by any UI in this phase. Migrations are auto-applied by the existing `.github/workflows/db-migrate-{preview,prod}.yml` actions (Constitution § Schema drift forbidden).

**Testing**: Vitest + Testing Library (unit) for money math (cart subtotal/total computation, per-line tech assignment, payment-eligibility rule with unconfirmed-price lines) and the resume-or-create Server Action. Playwright (e2e) against a seeded local Supabase for the cash-sale happy path (US1), sidebar resume (US2), per-line tech override (US3), and the printable receipt (US4). The cash-payment atomic write is exercised by an e2e that asserts both `payments` row AND `tickets.status='paid'` post-success, plus a Vitest unit on the action that asserts the transaction is rolled back on a forced failure. Both are mandated by Constitution Principle IV (cash payment is a money critical path).

**Target Platform**: Studio web shell on desktop browsers (Chromium/Safari/Firefox latest), shared salon devices (tablet/laptop class, landscape). Same surface profile as the rest of the studio.

**Project Type**: Web application — single Next.js app (no separate backend repo). Files live under `app/(studio)/checkout/`, `components/lacquer/checkout/`, `lib/auth/`, `styles/`, `supabase/migrations/`, and `tests/`.

**Performance Goals**: Cold load of `/checkout/[ticketId]` under 1s perceived latency on a typical front-desk device (SC-002). Tap-to-line-added under 100ms perceived latency for fixed-price services (cart mutation is a single Server Action; optimistic UI is permitted per spec but the server result reconciles before the user could tap a second tile). Cash payment Server Action completes (DB roundtrip + redirect) in well under 1s under normal preview-DB conditions.

**Constraints**: Constitution Principle I — every visual value resolves to a token in `styles/tokens.css`; icons are Lucide at 1.5px stroke, sized 16/20/24; layout adapts `FlowSingle.jsx` (not redrawn). Principle II — every mutation is a Server Action; no direct client writes. Principle III — payments row + ticket status flip are one Postgres transaction; both `audit_log` device-user and operator are recorded for every write; service name and unit price are snapshotted on `ticket_items` (no later catalog edit may rewrite history). Principle IV — Vitest + Playwright coverage as listed above, written before implementation for the money critical path. Principle V — explicit Out of Scope list in the spec is normative; no UI, no compute path, no schema for deferred items.

**Scale/Scope**: One new schema migration (4 tables, RLS), one new route group (`/checkout`, `/checkout/[ticketId]`, `/checkout/[ticketId]/receipt`), one new Server Action module (~7 actions), ~8 new client/server components under `components/lacquer/checkout/`, one new stylesheet, ~6 new test files. Estimated ~900–1200 LOC net change including the migration.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Gates derived from `.specify/memory/constitution.md` v1.0.3.

| Principle | Status | How this plan satisfies it |
|-----------|--------|----------------------------|
| **I. Design System Fidelity (NON-NEGOTIABLE)** | PASS | Every `components/lacquer/checkout/*` component is adapted from a section of `design-system/prototypes/transaction/FlowSingle.jsx` — TxHeader, TechAvatarRow (single-select variant from the prototype), ServiceTiles, CartRowWithTech, PaymentTiles (with non-cash tiles rendered disabled + Lacquer tooltip — visual layout matches the prototype), Totals, DoneScreen. All color/spacing/radius/shadow values resolve to existing tokens in `styles/tokens.css`. Icons are Lucide at 1.5px stroke, sizes 16/20/24. Tabular numerals on every currency render. Side-by-side comparison against the prototype is part of the verification checklist in `quickstart.md`. |
| **II. Server-Authoritative Architecture** | PASS | All seven mutating actions (`createEmptyTicket`, `resumeOrCreateTicket`, `addServiceLine`, `removeLine`, `setLineTech`, `takeCash`, `discardTicket`) are Server Actions colocated under `app/(studio)/checkout/actions.ts`. The single-screen page reads via RSC. No client code writes to Supabase. Authorization is the existing `requireStudioSession()` helper in `lib/auth/session.ts`, which returns `{ deviceUserId, staff: { id, role, … } }` — the operator id is `staff.id`, the device-user id is `deviceUserId`. No new credential surface. Per FR-028 there is no additional role check in this phase. |
| **III. Auditability & Money Integrity (NON-NEGOTIABLE)** | PASS | Snapshotting: `ticket_items.name_snapshot` and `ticket_items.unit_price_cents` are written at the moment of add — catalog edits after that cannot rewrite history. Atomicity: `takeCash` performs the `payments` insert and the `tickets.status='paid'` update in one Postgres transaction via a SQL `BEGIN…COMMIT` issued through the service-role client; on any failure neither persists (FR-018/FR-019). Audit: each of the mutating actions writes an `audit_log` row with both `actor_user_id` (device) and `acting_as_staff_id` (operator) via the existing `lib/auth/audit.ts` helper; new `AuditAction` verbs are added there. Money invariants: the `payments.amount_cents` for a successful cash sale equals `tickets.total_cents` at the moment "Take cash" was activated; this is asserted by an integration test (Principle IV). Idempotency keys: not applicable in this phase because cash sales make no Square call; a `// TODO(phase-9)` is left at the cash boundary noting the cash-drawer increment that phase 9 will wire in (see Out of Scope in spec). |
| **IV. Test-First for Critical Paths** | PASS | Cash payment is a money critical path. Test order: (a) Vitest unit on `cart.computeTotals(items)` (subtotal, tax=0, total invariants, unconfirmed-price exclusion from charge eligibility) — red, then green. (b) Vitest unit on `takeCash` action that mocks a DB failure mid-transaction and asserts neither row persists — red, then green. (c) Playwright e2e `checkout-cash-sale.spec.ts` walking the full US1 flow — red, then green. (d) Playwright e2e `checkout-resume.spec.ts` for US2 same-day resume. (e) Playwright e2e `checkout-discard.spec.ts` for the Discard path and the rule that discarded tickets are NOT resumed by the sidebar. (f) Playwright e2e `checkout-receipt.spec.ts` rendering the receipt + asserting it is gated on auth (anonymous GET → redirect to login). All e2e tests run with `--workers=1` per `CLAUDE.md`. |
| **V. Scope Discipline & Cost Restraint** | PASS (with one tracked extension — see Complexity Tracking) | The spec's Out of Scope section is the normative scope guard for this plan. Specifically: no variable-price modal (placeholder dialog only), no discount lines, no client/appointment attach, no card/gift/split, no tips, no voids/refunds, no drawer-session gating, no Realtime. The `appointments` table is created schema-only with no UI to satisfy the `tickets.appointment_id` FK and is not in the runtime cost path. No new runtime dependencies, no new infrastructure. One scope extension is the addition of `'discarded'` to the ticket status enum, which is not in the system-design baseline; it is recorded under Complexity Tracking with rationale. |

**Initial gate: PASS.** Re-checked after Phase 1 design — see "Post-design Constitution Re-check" below.

## Project Structure

### Documentation (this feature)

```text
specs/011-cash-sale-checkout/
├── plan.md                # This file
├── research.md            # Phase 0 — decisions: atomic-txn shape, snapshot policy, RLS approach, receipt-print stylesheet, prototype mapping, audit-log additions
├── data-model.md          # Phase 1 — tickets / ticket_items / payments / appointments schema, RLS, indexes, status enum
├── contracts/
│   ├── server-actions.md  # Phase 1 — the seven Server Action signatures + invariants
│   └── audit.contract.md  # Phase 1 — new AuditAction verbs added for tickets/payments
├── quickstart.md          # Phase 1 — developer "build, run, verify" walkthrough
├── checklists/
│   └── requirements.md    # Spec quality checklist (from /speckit-specify)
└── spec.md                # /speckit-specify output
```

### Source Code (repository root)

```text
supabase/
└── migrations/
    └── 0004_checkout_cash_sale.sql            # NEW — appointments (schema only), tickets, ticket_items, payments; RLS authenticated-read; service-role-write

app/(studio)/checkout/
├── page.tsx                                   # NEW — server page at /checkout. Calls resumeOrCreateTicket() and redirect()s to /checkout/[ticketId]. Used by sidebar + dashboard CTA.
├── actions.ts                                 # NEW — Server Actions: createEmptyTicket, resumeOrCreateTicket, addServiceLine, removeLine, setLineTech, takeCash, discardTicket. All wrap supabase service-role client + audit.ts.
├── checkout.css                               # NEW — page/screen-scoped tokens-only styles. Receipt has its own @media print rules here.
├── [ticketId]/
│   ├── page.tsx                               # NEW — RSC: loads ticket + items + active staff roster + service catalog; renders <CheckoutScreen/> client island with initial state
│   ├── checkout-screen.client.tsx             # NEW — client island. Holds tech-picked state, cart UI orchestration, optimistic line add (reconciled by server result), Take cash flow, error banner.
│   └── receipt/
│       └── page.tsx                           # NEW — server page rendering <ReceiptView/>. Requires auth via existing requireStudioSession(); never returns receipt body for anonymous requests (FR-026).

components/lacquer/checkout/
├── tx-header.tsx                              # NEW — header with Cancel + Discard buttons (two distinct controls per FR-005)
├── tech-avatar-row.tsx                        # NEW — single-select tech picker; collapses to chip + Change link once a tech is chosen (FR-006/FR-007)
├── service-tiles.tsx                          # NEW — search input + category chips + responsive tile grid (FR-009)
├── cart-row-with-tech.tsx                     # NEW — per-line row: name, price, qty, tech chip (with popover override), remove (FR-013, FR-011)
├── payment-tiles.tsx                          # NEW — cash | card | gift | split tiles; only cash enabled; others disabled with "Coming soon" tooltip (FR-017)
├── totals.tsx                                 # NEW — subtotal / tax (always 0 this phase) / total block (FR-012)
├── done-screen.tsx                            # NEW — "Charged $X" + "New sale" button (FR-022/FR-023)
├── variable-price-placeholder-dialog.tsx      # NEW — placeholder modal opened by the unconfirmed-price line's price control (FR-016)
└── receipt-view.tsx                           # NEW — printable layout, no studio chrome, browser-print friendly (FR-024/FR-025)

lib/auth/
└── audit.ts                                   # MODIFY — extend AuditAction with: "ticket.created", "ticket.line_added", "ticket.line_removed", "ticket.line_tech_assigned", "payment.captured", "ticket.discarded". Extend deriveEntityType to map "ticket.*" → "ticket" and "payment.*" → "payment".

lib/db/
└── types.ts                                   # MODIFY — regenerate from updated schema (existing convention; produced by `supabase gen types typescript`).

app/(studio)/dashboard/                        # NO CHANGE — NewTransactionCTA already routes to /checkout (verified in repo today).
components/lacquer/sidebar/nav-items.ts        # NO CHANGE — "Checkout" item already routes to /checkout.

tests/
├── unit/
│   └── checkout/
│       ├── cart-totals.test.ts                # NEW — subtotal/total/eligibility math
│       └── take-cash-action.test.ts           # NEW — asserts atomic rollback on mid-transaction failure (mocked supabase client)
└── e2e/
    ├── checkout-cash-sale.spec.ts             # NEW — US1 happy path: entry → tech → service → cash → confirmation
    ├── checkout-resume.spec.ts                # NEW — US2: same-day resume; cross-day no-resume; discarded not resumed
    ├── checkout-discard.spec.ts               # NEW — Discard transitions ticket to non-resumable terminal state; excluded from any sales count
    └── checkout-receipt.spec.ts               # NEW — US4 printable receipt; FR-026 anonymous GET rejected

CLAUDE.md                                      # MODIFY — point the SPECKIT marker to specs/011-cash-sale-checkout/plan.md
```

**Structure Decision**: Single Next.js project — Option 1 from the template. No new top-level directories. The feature is one route group (`/checkout` + `/checkout/[ticketId]` + receipt subroute), one Server Actions module, a co-located client island, and the checkout component subfolder under `components/lacquer/`. This matches the established repo convention (`components/lacquer/staff/`, `components/lacquer/services/`, `components/lacquer/settings/`).

## Phase 0 — Research

See [research.md](./research.md). Summary:

1. **Atomic cash-payment transaction shape**: a Server Action calls a Postgres function `pos_take_cash(p_ticket_id uuid, p_amount_cents int, p_operator uuid)` that performs `BEGIN; INSERT into payments; UPDATE tickets SET status='paid'; INSERT into audit_log; COMMIT;` and returns the new payment id. RPC is preferred over multi-roundtrip from Node because (a) it gives us a true single-statement transaction without depending on PostgREST's prepared-statement semantics, (b) it co-locates the money invariant in the database where it's easiest to assert, and (c) it avoids a partial state if the Node process is killed between roundtrips. Failures surface as Postgres exceptions caught by the action and translated into an inline error banner.
2. **Snapshotting policy**: on `addServiceLine`, the Server Action looks up the service row, reads `name`, `price_cents`, and the `variable_price` flag, and inserts a `ticket_items` row carrying `name_snapshot`, `unit_price_cents`, and `price_unconfirmed = variable_price`. Later edits to the `services` row never propagate (FR-010).
3. **RLS approach**: matches the existing `0003_services_catalog.sql` pattern — `authenticated`-read on every table except the never-readable cohort (none here); all writes go through the service-role client inside Server Actions. Three policies per table (select-authenticated, insert-service-role, update-service-role). Auth is enforced in the app layer (Constitution Principle II), RLS is the backstop.
4. **Receipt-print stylesheet**: a single `@media print { body { background: white; } .studio-chrome { display: none; } }` block in `checkout.css`, plus `<html data-print="receipt">` on the receipt route's layout so the print CSS scopes cleanly. No PDF library, no thermal-printer-specific tweaks in this phase. Validation: open `/checkout/[ticketId]/receipt` in Chromium → File → Print → preview shows clean single page.
5. **Prototype mapping**: `FlowSingle.jsx` exports the seven UI pieces we need (TxHeader, TechAvatarRow, ServiceTiles, CartRowWithTech, PaymentTiles, Totals, DoneScreen). The plan adapts each one-for-one into `components/lacquer/checkout/`. The prototype's `stage` state machine (`cart | waiting | cash-tip | done`) collapses to `cart | done` in this phase — no `waiting` (Square only) and no `cash-tip` (no tip capture).
6. **Audit-log additions**: extends the controlled-vocab union in `lib/auth/audit.ts` and `deriveEntityType` (see contracts/audit.contract.md). No schema change to `audit_log` (the `action` column is plain `text`; the type union is the enforcement layer per the existing convention).
7. **Drawer-TODO placeholder**: a single inline `// TODO(phase-9): increment open cash_drawer_sessions.expected_cents by p_amount_cents` placed inside the `pos_take_cash` SQL function (commented out — Postgres ignores comments inside functions) AND mirrored in the Server Action wrapper so phase 9 can grep for it from either layer.

## Phase 1 — Design & Contracts

**Prerequisites**: `research.md` complete.

### Entities → data-model.md

See [data-model.md](./data-model.md). Four entities are added by `0004_checkout_cash_sale.sql`:

- **tickets** — id, appointment_id (nullable FK, unused this phase), status (`open|paid|discarded`), subtotal_cents, tax_cents (always 0 v1), total_cents, opened_by_staff_id, closed_by_staff_id (nullable), closed_at (nullable), created_at, updated_at. Indexes: `(opened_by_staff_id, status, created_at DESC)` for the resume query; `(status)` partial index where `status='open'`.
- **ticket_items** — id, ticket_id (FK), kind (`service`), ref_id (service id), name_snapshot, unit_price_cents, qty (default 1), assigned_staff_id, price_unconfirmed (boolean, default false), created_at.
- **payments** — id, ticket_id (FK), method (`cash` only this phase; enum already includes the rest from the design for forward-compat), kind (`payment` only this phase), amount_cents, status (`succeeded` for cash), processed_at, taken_by_staff_id, created_at.
- **appointments** — schema only. Created with the columns from `docs/system-design.md` so the `tickets.appointment_id` FK is satisfied. No UI, no seed data, no queries in this phase.

The discard rule from FR-005 manifests as: `tickets.status = 'discarded'` is a terminal state; the resume query (FR-003) filters on `status = 'open' AND date_trunc('day', created_at AT TIME ZONE salon_tz) = current_date`.

### Interface contracts → contracts/

See [contracts/server-actions.md](./contracts/server-actions.md) and [contracts/audit.contract.md](./contracts/audit.contract.md).

The seven Server Actions and their invariants:

| Action | Invariant |
|---|---|
| `createEmptyTicket()` | Always inserts a new `tickets` row with `status='open'`, no `appointment_id`, `opened_by_staff_id = current operator`. Returns the new id. |
| `resumeOrCreateTicket()` | If a same-day open ticket exists for the operator (per FR-003), returns its id. Otherwise calls `createEmptyTicket()` and returns the new id. Never opens a stale (prior-day) or discarded ticket. |
| `addServiceLine(ticketId, serviceId)` | Refuses if no tech is picked in the in-memory client state (the client passes the current tech id; the server validates it belongs to active staff). Inserts a snapshotted `ticket_items` row; recomputes and stores `tickets.{subtotal,total}_cents`. |
| `removeLine(ticketId, lineId)` | Removes the row; recomputes totals. |
| `setLineTech(ticketId, lineId, staffId)` | Updates one row's `assigned_staff_id` only; does not retroactively reassign other lines. |
| `takeCash(ticketId)` | Pre-check: ticket is open, total > 0, no `price_unconfirmed=true` lines. Calls `pos_take_cash` RPC. On success returns the new payment id (caller redirects to the confirmation). On failure surfaces the Postgres error code so the client can render an inline banner (FR-019). |
| `discardTicket(ticketId)` | Sets `tickets.status='discarded'`. Refuses if the ticket is already paid or discarded. Audited. |

No public HTTP API, no webhook, no CLI — this is a studio-internal feature. Receipt rendering at `/checkout/[ticketId]/receipt` is a server page, not a JSON endpoint.

### Quickstart → quickstart.md

See [quickstart.md](./quickstart.md). It walks an implementer through migration apply, seed data, running the dev server, completing the US1 cash sale by hand, opening the printable receipt, and the local gate set (`format:check`, `lint`, `typecheck`, `test`, `test:e2e --workers=1`).

### Agent context update

`CLAUDE.md`'s `<!-- SPECKIT START -->` block is updated to point at this plan in the same change set (the final write of `/speckit-plan`):

```text
<!-- SPECKIT START -->
Active feature plan: `specs/011-cash-sale-checkout/plan.md` — read it for the
current feature's technical context, project structure, and build steps.
<!-- SPECKIT END -->
```

### Post-design Constitution Re-check

| Principle | Re-check | Notes |
|-----------|----------|-------|
| I. Design System Fidelity | PASS | The Phase 1 artifacts (data-model.md, contracts/, quickstart.md) name only existing tokens. Component shapes are 1:1 from `FlowSingle.jsx` sub-components. |
| II. Server-Authoritative | PASS | All seven actions are Server Actions; the data-model adds three new policies per table consistent with `0003`. |
| III. Auditability & Money Integrity | PASS | Atomic-txn shape (Phase 0 R1) and snapshot policy (R2) are now concrete. `audit.contract.md` lists every new verb. The cash-drawer TODO is placed and grep-able. |
| IV. Test-First | PASS | quickstart.md sequences red→green for `cart-totals.test.ts`, `take-cash-action.test.ts`, then the four Playwright specs. |
| V. Scope Discipline | PASS (with one entry below) | All Out-of-Scope items remain out. The one extension (`tickets.status = 'discarded'`) is recorded under Complexity Tracking. |

**Re-check: PASS.**

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Extend `tickets.status` enum with `'discarded'` beyond the `docs/system-design.md` baseline (`open\|paid\|partially_refunded\|refunded\|void`). | Clarification Q5 in `spec.md` requires a non-resumable terminal state for in-progress tickets explicitly thrown away by the operator (customer walked out, wrong cart). Without this, the sidebar resume rule (FR-003) would either silently resume an abandoned ticket the next morning or require a separate sentinel ("cleared cart" boolean on `tickets`) that fragments the lifecycle. | Reusing `'void'` was considered and rejected: `void` semantically means "a closed/paid ticket was reversed same-day" in the system-design's POS flow, and is paired with a `kind='refund'` payment row to reverse the money. A discarded never-paid ticket has no payment row to reverse and conflates two operationally distinct moments. Adding a dedicated `'discarded'` value keeps the enum honest, keeps the End-of-Day cash drawer reconciliation's "voids" total accurate when that lands in phase 8, and gives reporting a clean filter for "abandoned" vs "refunded" vs "voided." When the next constitution amendment lands, the system-design enum should be updated to match. |
