<!--
SYNC IMPACT REPORT
==================
Version change: 1.0.1 → 1.0.2
Bump rationale: PATCH — clarification of an existing CI gate. The "CI gates"
  bullet in § Development Workflow & Quality Gates already required type
  checking, Vitest, and Playwright, but omitted `npm run format:check` and
  `npm run lint`. The repo's CI workflow runs both and PR #6 (006-staff-management)
  was bounced for a format-check failure that should have been caught locally
  before push. This amendment names every CI command explicitly so the same
  miss can't repeat. No principle, section, or governance rule changed; the
  underlying CI behavior is unchanged.

Templates requiring updates: none — quality-gate enumeration only touches
  CLAUDE.md (synced in the same change set with a "Pre-push quality gates"
  block).

--- Prior entry (1.0.1) -------------------------------------------------------
Version change: 1.0.0 → 1.0.1
Bump rationale: PATCH — non-semantic factual correction. The preamble named the
  web framework as "Next.js 15"; the scaffolding feature (001) generated the repo
  with `create-next-app@latest`, which now resolves to Next.js 16. No principle,
  section, or governance rule changed. No dependent templates require updates.

--- Prior entry (1.0.0) -------------------------------------------------------
Version change: (none) → 1.0.0
Bump rationale: Initial ratification of the Tang Nails project constitution.
  No prior versioned constitution existed; the file held only template placeholders.

Modified principles: n/a (initial adoption)
Added principles:
  - I. Design System Fidelity (NON-NEGOTIABLE)
  - II. Server-Authoritative Architecture
  - III. Auditability & Money Integrity (NON-NEGOTIABLE)
  - IV. Test-First for Critical Paths
  - V. Scope Discipline & Cost Restraint
Added sections:
  - Security & Data Integrity Constraints
  - Development Workflow & Quality Gates
Removed sections: none

Templates requiring updates:
  - .specify/templates/plan-template.md          ⚠ pending — add a Constitution Check
                                                   referencing Principles I–V
  - .specify/templates/spec-template.md          ⚠ pending — ensure scope sections cite
                                                   the v1 in/out boundary (Principle V)
  - .specify/templates/tasks-template.md         ⚠ pending — add task categories for
                                                   design-system verification, audit/idempotency,
                                                   and Playwright/Vitest coverage
  - CLAUDE.md                                    ✅ aligned — design-system rules already match
                                                   Principle I; no edit required
  - docs/system-design.md                        ✅ aligned — constitution derived from it;
                                                   no edit required

Follow-up TODOs: none — all placeholders resolved.
-->

# Tang Nails Constitution

Tang Nails is a single-salon management web app (Calendar, Clients, Checkout/POS,
Walk-in/Kiosk, End of Day) built on Next.js 16, Supabase, and the Square SDK, dressed
in the Lacquer design system. This constitution governs how the v1 build is specified,
implemented, reviewed, and shipped. `docs/system-design.md` is the approved technical
source of truth; this document is the set of non-negotiable rules that protect it.

## Core Principles

### I. Design System Fidelity (NON-NEGOTIABLE)

All UI work MUST conform to the vendored Lacquer design system in `design-system/`.

- Every color, spacing, radius, shadow, type size, and weight MUST resolve to a token
  defined in `styles/tokens.css` (copied verbatim from `design-system/colors_and_type.css`).
  Raw hex codes, off-scale spacing, and custom font weights are prohibited.
- UI surfaces MUST adapt the matching prototype in `design-system/ui_kits/` or
  `design-system/prototypes/` (see the mapping in `docs/system-design.md`). Layouts are
  adapted, never redrawn from scratch.
- Components MUST be shadcn/ui primitives in `components/ui/*` composed into
  `components/lacquer/*`. No second component library may be introduced.
- Icons are Lucide only (1.5px stroke, sized 16/20/24). No emoji in chrome.
- A UI task is complete only after a side-by-side comparison against the canonical
  `design-system/preview/*.html` and confirmation that every value traces to a token.

**Rationale:** the design is the product's finished, approved surface. Drift fragments
the brand and forces rework; the prototypes already encode the intended UX.

### II. Server-Authoritative Architecture

The client is never trusted with business logic, authority, or secrets.

- Reads for read-heavy pages MUST use React Server Components against Supabase.
  Mutations MUST go through Server Actions; client code never writes to the database
  directly except via the kiosk's narrowly scoped JWT path.
- Authorization (role checks for the current `acting_as_staff_id`, manager thresholds,
  refund/void/settings authority) MUST be enforced inside Server Actions. Supabase RLS
  is a backstop that blocks anonymous access — never the primary authorization layer.
- Privileged actions (refunds, voids, settings edits) MUST require a fresh manager-PIN
  inline override at the moment of the action.
- All Square communication MUST be server-side. Square credentials, webhook signature
  keys, and OAuth tokens never reach the browser.

**Rationale:** a single-tenant app on shared devices has a thin trust boundary; keeping
authority on the server is the only place rules can be reliably enforced.

### III. Auditability & Money Integrity (NON-NEGOTIABLE)

Every mutation and every cent MUST be traceable and reconcilable.

- Every write MUST record both the device user (`auth.uid()`) and the operator
  (`acting_as_staff_id`) in `audit_log`, using controlled-vocabulary `action` values.
  Privileged actions additionally record the authorizing manager.
- Historical records MUST be snapshotted: `ticket_items` and `appointment_services`
  carry price/duration snapshots so later catalog edits never rewrite history.
- Every Square call MUST pass a deterministic idempotency key
  (`${ticket_id}:${payment_id}` for terminal checkouts;
  `${payment_id}:refund:${refund_payment_id}` for refunds).
- Money invariants MUST hold: `tip_splits` sum to `payment.tip_cents`; payments on a
  ticket sum to `tickets.total_cents`; cash drawer variance is computed, not guessed;
  at most one cash drawer session is open at a time.
- Refunds and voids MUST create explicit `kind='refund'` payment rows linked to their
  originals — money is never silently deleted or mutated in place.

**Rationale:** this app handles real cash, cards, and tips for real staff. Disputes,
shrinkage, and payroll all depend on an unambiguous, append-only financial record.

### IV. Test-First for Critical Paths

Critical behavior is proven by tests, in CI, before it is considered done.

- Each v1 feature MUST ship with a Playwright end-to-end test running against a seeded
  local Supabase, executed in CI on every PR.
- Unit tests (Vitest) are MANDATORY for: Square SDK wrappers, PIN/auth helpers,
  tip-split math, and refund/cash-drawer accounting.
- For money and auth logic, tests are written and shown to fail before the
  implementation that satisfies them is written.
- A PR that changes a critical path (payments, refunds, auth, tip allocation, audit
  logging) without corresponding test changes MUST be rejected in review.

**Rationale:** the failure modes here (mischarged cards, lost tips, broken auth) are
expensive and erode salon trust; the design doc's verification plan is the contract.

### V. Scope Discipline & Cost Restraint

v1 is exactly the scope in `docs/system-design.md` — no more, no less.

- Deferred items (customer self-booking, SMS/email, multi-tenant, inventory/products,
  gift-card issuance, tax computation, payroll reporting, native wrappers) MUST stay
  deferred. Adding any of them requires a constitution amendment or an explicit,
  documented scope change approved by the maintainer.
- Schema reservations (`tax_cents`, `services.taxable`, reserved `settings` rows) are
  honored in the data model but MUST have no compute path or UI in v1.
- Infrastructure MUST stay on free tiers during the build; production cost MUST stay in
  the ~$25–45/mo envelope. New paid services or dependencies require justification
  against this budget.
- Prefer the simplest mechanism that satisfies the design doc (e.g. webhook + 5s poll
  fallback instead of a cron sweep). Speculative generality is rejected.

**Rationale:** near-zero cost and a bounded v1 are explicit project constraints; scope
creep is the primary risk to shipping a single integrated tool the salon can adopt.

## Security & Data Integrity Constraints

- **Two-layer auth.** A long-lived Supabase Auth session identifies the device user;
  a signed, httpOnly `acting_as_staff_id` cookie with a 12-hour hard TTL (no sliding
  extension) identifies the operator. Operator attribution (who pressed the buttons) is
  distinct from tech attribution (who did the work, earns the tip/commission) and both
  MUST be persisted as designed.
- **Kiosk isolation.** The kiosk runs on a separate route with a pairing-issued JWT
  scoped to a single capability: insert `walk_ins` and read its own row. The kiosk runs
  without a service worker so token revocation takes effect on next load. RLS enforces
  this scope.
- **Secrets at rest.** Square OAuth tokens MUST be encrypted via `pgcrypto` with the key
  held in Supabase Vault and exposed only to `lib/square/oauth.ts`. `square_oauth.*`
  encrypted columns and `audit_log.payload` are never readable by ordinary authenticated
  clients.
- **Webhook trust.** Square webhooks MUST be rejected unless the
  `x-square-hmacsha256-signature` verifies against `SQUARE_WEBHOOK_SIGNATURE_KEY`.
- **No anonymous walk-ins.** Every walk-in and appointment references a real `client_id`;
  the kiosk flow always resolves or creates a client (phone + name required).
- **Time correctness.** All timestamps are stored UTC and formatted through the single
  `lib/time/*` helper against `SALON_TZ`. No ad-hoc timezone math.

## Development Workflow & Quality Gates

- **Source of truth.** `docs/system-design.md` governs architecture, data model, flows,
  and build order. `design-system/` governs all visual and component decisions. Specs,
  plans, and tasks MUST cite these rather than re-deciding them.
- **Build order.** Features are built in the dependency order given in the system design
  (§ "Files to create"): scaffolding → tokens → primitives → schema/RLS → db clients →
  time helpers → auth → shell → settings → calendar → clients → walk-in/kiosk → Square
  libs → checkout/webhooks → end-of-day → PWA.
- **Design-system sync.** When the live Lacquer project changes, the re-exported handoff
  replaces `design-system/` and propagates to `styles/tokens.css` and
  `components/lacquer/*` in a single commit — never partially.
- **CI gates.** Every PR MUST pass the full local gate set before push, in this order:
  `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test` (Vitest unit
  suite), and `npm run test:e2e` against a seeded local Supabase. CI runs the same
  commands; a green local run is the contract that the PR will not bounce on a
  formatting or lint nit. PRs touching payments, auth, or audit logging additionally
  require a reviewer to confirm Principles II, III, and IV.
- **Review.** Code review MUST verify constitution compliance. A reviewer cites the
  specific principle when requesting changes. Unjustified complexity is grounds for
  rejection.

## Governance

- This constitution supersedes ad-hoc practice. Where it conflicts with convenience,
  the constitution wins; where it conflicts with an explicit maintainer instruction in
  `CLAUDE.md` or a direct request, the maintainer instruction wins.
- **Amendments** are made by editing this file with a Sync Impact Report, bumping the
  version per the policy below, and propagating changes to dependent templates and docs
  in the same change set.
- **Versioning policy** (semantic):
  - MAJOR — a principle is removed or redefined in a backward-incompatible way, or
    governance is materially restructured.
  - MINOR — a new principle or section is added, or existing guidance is materially
    expanded.
  - PATCH — clarifications, wording, and non-semantic refinements.
- **Compliance review.** Every spec, plan, and task set produced by the Spec Kit
  workflow MUST be checked against these principles before implementation begins.
  Implementation PRs are reviewed for compliance before merge.
- **Runtime guidance.** Use `CLAUDE.md` and `docs/system-design.md` for day-to-day
  implementation guidance; this constitution is the stable layer above them.

**Version**: 1.0.2 | **Ratified**: 2026-05-13 | **Last Amended**: 2026-05-15
