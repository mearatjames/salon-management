# Phase 0 Research: Ephemeral Cart

**Feature**: 042-ephemeral-cart | **Date**: 2026-05-18

This phase has no `NEEDS CLARIFICATION` markers from the spec — `/speckit-clarify` already resolved the two genuinely consequential ambiguities (customer linkage timing and cart preservation on commit failure), and the five draft-prompt open questions are documented as Assumptions in the spec. The research below records technology and pattern decisions that affect Phase 1 design.

## Decisions

### D1. Cart state container — React Context + `useReducer`

**Decision**: Hold ephemeral cart state in a React Context provider that owns a `useReducer` over the `EphemeralCart` shape. The provider is rendered by the new `app/(studio)/checkout/page.tsx` only; navigating to any other route unmounts it and discards the cart, satisfying FR-004 by construction.

**Rationale**:
- Matches the "destroyed when leaving the route" assumption with no additional code: unmount IS clear.
- No new dependency (no Zustand / Jotai / Redux). Constitution V (cost restraint) and the salon's "simplest mechanism" preference.
- The cart's reducer-shaped mutations (add service, remove item, set discount, change tech, set customer) are clean to test as pure functions in `_cart.ts`.
- The Server Actions can accept the cart as a plain serializable payload — no need to round-trip a class instance.

**Alternatives considered**:
- **Plain `useState` array of items**: rejected — every cart-edit handler would need a callback identity-preserving wrapper, and we lose central type discipline.
- **Zustand / Jotai store**: rejected — adds a dependency for one screen's draft state. State outliving the route would be a feature, not a benefit, and would silently re-introduce the "stale cart from yesterday" problem the design explicitly avoids.
- **URL search params / route state**: rejected — putting cart contents in the URL makes them quasi-persistent (history back button), which contradicts FR-011.

### D2. Atomic commit — one server action per commit path, single Postgres transaction inside

**Decision**: Implement four new Server Actions — `submitCashFromCart`, `submitGiftFromCart`, `sendCardToTerminalFromCart`, `splitTenderFromCart` — each opening a single Postgres transaction that does `INSERT INTO tickets ... RETURNING id`, bulk-inserts `ticket_items`, and either calls the relevant existing `pos_*` RPC (which itself inserts the first `payments` row) or composes the initial split-tender draft state via `pos_compose_payment_draft`. The whole thing succeeds or fails atomically.

**Rationale**:
- Constitution Principle III (Auditability & Money Integrity) requires that money operations be atomic and traceable. A single transaction is the natural fit.
- Existing RPCs (`pos_take_cash`, `pos_record_card_payment`, `pos_record_gift_payment`) already implement the in-flight uniqueness and snapshot rules; we reuse them rather than reinventing.
- Idempotency keys for Square (`${ticket_id}:${payment_id}`) work identically whether the IDs are pre-existing or freshly minted in the same transaction — both rows are visible to the Square call once `COMMIT` runs.

**Alternatives considered**:
- **Two-step: create ticket → call existing `addServiceLine` per item → call existing payment action**: rejected — multiple round trips, no atomicity, exactly the model we're trying to escape.
- **Single new RPC `pos_commit_cart`**: considered but deferred. The current `pos_*` RPCs are well-tested; a new umbrella RPC adds surface area without solving any problem the Server Action's transaction can't solve. Revisit if Phase 2 task analysis shows otherwise.

### D3. Square Terminal failure rollback — explicit DELETE in the same Server Action

**Decision**: When `sendCardToTerminalFromCart` has just created the ticket + items + pending payment rows and the subsequent Square API call returns an error, the Server Action immediately runs `DELETE FROM payments WHERE id = ?; DELETE FROM ticket_items WHERE ticket_id = ?; DELETE FROM tickets WHERE id = ?` (in that order, foreign keys permitting). No audit event is emitted because the rows never persisted past the failed transaction boundary in the operator's experience.

**Rationale**:
- The spec's Assumption explicitly chose this path (system rollback, not operator-facing discard).
- Bypasses `discardTicket` and its `pending`-payment guard from prerequisite issue #26, which is correct: this is NOT an operator-initiated discard.
- The operator's in-memory cart is preserved (per FR-013 + the second clarification), so retry has zero rebuild cost.

**Alternatives considered**:
- **Mark payment `failed` then call `discardTicket`**: rejected — produces a `ticket.discarded` audit event for a ticket the operator never saw, which clutters the audit log.
- **Leave rows in place + show retry affordance**: rejected — leaves orphan rows that the SC-003 invariant would catch as a violation (open ticket with `pending` payment and 1+ items but no successful commit).

### D4. Route topology — `/checkout` is cart-building (no `ticketId`); `/checkout/<id>` is post-commit only

**Decision**: The route `/checkout` (no segment) becomes the cart-building entry point and renders the new `CartBuildingScreen` client component with the cart context provider. The route `/checkout/<ticketId>` continues to exist but is now reachable only via redirect from a successful commit; its `page.tsx` enforces this by returning 404 (or a guarded redirect to `/checkout`) when the ticket is in a state inconsistent with the post-commit flow (`status='open'` AND zero items).

**Rationale**:
- Cleanly separates pre-commit and post-commit responsibilities; each page has one job.
- Existing post-commit flows (mid-split-tender, Square Terminal waiting, completed-sale receipt) all already operate against a specific ticket ID; they continue to work unchanged.
- The defensive check at `/checkout/<id>` catches any future bug that would re-introduce an empty open ticket — a belt-and-braces guard for SC-003.

**Alternatives considered**:
- **Keep `/checkout/<id>` as the only checkout route, use a query param like `?ephemeral=1`**: rejected — query-param semantics is a code smell here; the two views are different in structure (no ticket data dependency vs. ticket-data-driven).
- **Use `/checkout/new` as the cart-building page**: rejected — `/checkout` is the natural URL operators bookmark; adding `/new` is a needless nav surprise.

### D5. Server Action input validation — Zod

**Decision**: Define a Zod schema for the `EphemeralCart` payload at the boundary of each new Server Action. The schema validates: at least one cart item, every `service_id` is a UUID, every `staff_id` is a UUID and references an active staff member (resolved server-side), customer_id is either null or a UUID, discount references are well-formed.

**Rationale**:
- Constitution Principle II — the client is never trusted, so Server Actions validate.
- Zod is already used in the repo (see existing actions).
- Schema lives next to the action and is exported for the test suite to construct test fixtures.

**Alternatives considered**:
- **No schema, type-only**: rejected — `'use server'` actions receive untrusted input over the wire; type narrowing on the server doesn't validate.

### D6. Cart-level price/total preview — client-side compute, server-side authoritative

**Decision**: The cart-building UI computes a preview total (services subtotal + discounts) client-side using `_cart.ts` pure helpers, against the same catalog snapshot it loaded for the service-tile picker. At commit time, the Server Action re-resolves prices from the database (the catalog snapshot in `services` table) and inserts the canonical snapshot into `ticket_items`. If a service was edited or deactivated between cart-build and commit, the server uses the current price and the operator sees the actual total on the receipt screen.

**Rationale**:
- Operators expect to see live totals as they build the cart — purely server-driven totals would be sluggish.
- Money authority remains on the server (Principle II + III).
- Snapshot semantics for `ticket_items` are unchanged from today.

**Alternatives considered**:
- **Server-driven preview via debounced Server Action call**: rejected — adds round trips for a calculation that doesn't need them, and reintroduces "the cart talks to the server during build" semantics we're trying to avoid.

### D7. Removal of `createEmptyTicket` and `resumeOrCreateTicket`

**Decision**: Both Server Actions remain in `actions.ts` for now but are no longer called by the production code path. They stay because the mid-split-tender flow may still rely on `resumeOrCreateTicket` for in-progress ticket resumption; final removal is a follow-up cleanup task (Phase 7 or later) once we verify no production caller remains. The dashboard CTA, sidebar Checkout link, and DoneScreen "New sale" link are all updated to point at `/checkout` (no eager-create) — see `_affected-map.mjs` for the test coverage.

**Rationale**:
- Minimizes blast radius of the refactor.
- Lets us verify (via grep + e2e) that no caller is missed before deleting.
- A follow-up "remove dead code" task is cleaner than risking a regression here.

**Alternatives considered**:
- **Delete in this PR**: rejected — the spec's success criteria are about behavior, not dead-code removal; bundling the delete adds risk for no spec-level benefit.

### D8. Audit log — no new event types

**Decision**: No new `audit_log.action` values are introduced. Existing post-commit events (`ticket.paid`, `payment.captured`, `payment.captured_after_discard`, etc.) continue to fire from inside the same Server Actions and RPCs they fire from today. Pre-commit activity emits no audit events (per spec Assumption).

**Rationale**:
- Spec already resolved this.
- Avoids a controlled-vocabulary migration to the audit-log enum (which would need a migration — out of scope).

## Open items resolved

| Concern | Resolution |
|---|---|
| Cart state container | D1 — React Context + useReducer |
| Atomicity of commit | D2 — single Server Action with single Postgres transaction |
| Square Terminal handoff failure | D3 — direct DELETE rollback; cart preserved |
| Route topology | D4 — `/checkout` for build, `/checkout/<id>` for post-commit only |
| Server input validation | D5 — Zod schemas at action boundary |
| Preview total computation | D6 — client preview, server authoritative |
| Old action deprecation | D7 — keep for now; follow-up cleanup task |
| Audit log shape | D8 — no new event types |

## Risk register (carry-forwards for tasks.md)

| Risk | Mitigation |
|---|---|
| Two-tab same-device: operator builds in tab A, commits in tab B, then commits in tab A → two tickets for one customer | Existing one-in-flight-payment-per-ticket index doesn't apply (different tickets). Acceptable — UI treats each tab as an independent operator session. Documented in spec Edge Cases. |
| Stale service catalog in browser at commit time (service deactivated mid-cart-build) | Server re-resolves price + activity at commit; if a referenced service no longer exists, commit fails with a clear error and the cart is preserved (FR-013). |
| Operator builds large cart, network drops between commit click and server response | Server Action's transaction either commits or rolls back; client times out and shows retry. FR-013 keeps cart. |
| Defensive 404 on `/checkout/<id>` for empty-open tickets accidentally hides legit mid-split-tender tickets | The split-tender draft inserts at least one item BEFORE the URL transition. The defensive check is "status='open' AND zero items" — never true for a real mid-split-tender ticket. |
