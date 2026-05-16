# Phase 0 — Research: Checkout — Cash-Only Sale

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

This document records the technical decisions the plan depends on. Each entry is a Decision / Rationale / Alternatives triple sized to the smallest defensible answer.

---

## R1. Atomic cash-payment transaction shape

**Decision**: Implement the atomic write (FR-018 + FR-019) as a single Postgres function `pos_take_cash(p_ticket_id uuid, p_amount_cents int, p_operator uuid) RETURNS uuid`, invoked from the Server Action via `supabase.rpc('pos_take_cash', …)`. The function performs:

```sql
BEGIN
  -- 1. Lock the ticket row to prevent a parallel discard.
  PERFORM 1 FROM tickets WHERE id = p_ticket_id AND status = 'open' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ticket_not_open'; END IF;

  -- 2. Recompute total from current ticket_items (server-trusted, not client-supplied).
  -- 3. Refuse if any line has price_unconfirmed = true (FR-015).
  -- 4. Insert payments row (method='cash', kind='payment', status='succeeded', amount=total).
  -- 5. Update tickets set status='paid', closed_by_staff_id=p_operator, closed_at=now().
  -- 6. Insert audit_log row (action='payment.captured', payload=jsonb of payment id + amount).
  -- TODO(phase-9): increment open cash_drawer_sessions.expected_cents by amount.
COMMIT
```

The Server Action catches Postgres exceptions (`ticket_not_open`, `ticket_has_unpriced_items`, network) and returns a typed `Result` to the client island for the error banner.

**Rationale**:

- A single SQL function gives us a true single-statement transaction. Doing the insert + update + audit-log as three separate `supabase-js` calls leaves a window where the Node process can die between calls and produce partial state — exactly what FR-019 forbids.
- The money invariant ("payment.amount_cents = tickets.total_cents at the moment of charge") is enforced inside the database, where it is impossible to bypass from a client.
- Locking the ticket row with `FOR UPDATE` blocks a concurrent `discardTicket` on the same ticket — the loser sees `ticket_not_open` and reports the failure cleanly.
- Auditing inside the function guarantees we never have a `payments` row without a matching `audit_log` row, satisfying Principle III's append-only requirement.

**Alternatives considered**:

- **Three Server-Action-orchestrated `supabase-js` calls.** Rejected — no atomic boundary across calls; a webhook-style retry layer would be needed to recover, and we have none in this phase.
- **A single Server Action using a Supabase transaction helper.** `supabase-js` does not expose a true cross-statement transaction over PostgREST; the closest is `rpc()` to a SQL function (what we chose) or running the SQL as one big multi-statement string, which loses parameter safety.
- **Optimistic UI with a background retry.** Rejected directly by clarification Q3 — partial state is forbidden, and a cash receipt that "looked OK" but didn't save is the worst outcome the spec is trying to prevent.

---

## R2. Snapshotting policy

**Decision**: On `addServiceLine(ticketId, serviceId)`, the Server Action:

1. Reads the `services` row (`name`, `price_cents`, `variable_price`).
2. Inserts `ticket_items` with:
   - `kind = 'service'`
   - `ref_id = serviceId`
   - `name_snapshot = services.name`
   - `unit_price_cents = services.price_cents`
   - `qty = 1`
   - `price_unconfirmed = services.variable_price`
   - `assigned_staff_id = <header tech id from action argument>`
3. Recomputes `tickets.subtotal_cents = sum(unit_price_cents * qty)` over the ticket's items where `price_unconfirmed = false`. (Unconfirmed lines contribute 0 to the subtotal in this phase; the Take cash button is disabled anyway, so this is consistent with the on-screen running total.)
4. Sets `tickets.tax_cents = 0` (v1 invariant) and `tickets.total_cents = tickets.subtotal_cents`.

The variable-price placeholder dialog opened by FR-016 does NOT mutate `ticket_items.unit_price_cents` — no price entry is accepted in this phase.

**Rationale**:

- Constitution Principle III: "Historical records MUST be snapshotted: `ticket_items` … carry price/duration snapshots so later catalog edits never rewrite history."
- Storing the `ref_id` alongside the snapshot keeps a forensic link to the catalog row (for reporting later) without making it the source of truth for printed/charged amounts.
- Refreshing `tickets.subtotal/total_cents` on every line mutation means the cash payment action can trust those columns rather than recomputing — matches the FOR UPDATE lock model in R1.

**Alternatives considered**:

- **Compute totals on-the-fly inside `takeCash`.** Rejected for the Take cash hot path: the function still needs to read all line items, so we'd be doing the work twice (once for display, once for charge). Storing totals once per mutation is cheaper and gives a single column to lock against.
- **Skip snapshotting; reference the live `services` row.** Forbidden by Principle III.

---

## R3. RLS approach

**Decision**: Match the pattern established by `supabase/migrations/0003_services_catalog.sql`:

- Enable RLS on all four new tables (`appointments`, `tickets`, `ticket_items`, `payments`).
- Add one read policy per table: `select` allowed for role `authenticated`.
- No client-writeable insert/update/delete policies. All writes go through `lib/db/admin.ts`'s service-role client invoked from Server Actions; the service role bypasses RLS.

**Rationale**:

- Constitution Principle II: "Authorization … MUST be enforced inside Server Actions. Supabase RLS is a backstop that blocks anonymous access — never the primary authorization layer."
- The existing `0001`–`0003` migrations all use this pattern; copying it keeps the code review surface predictable.
- A single-tenant salon has no client-by-client read isolation requirement, so the `authenticated`-read policy is sufficient and the simplest defensible baseline.

**Alternatives considered**:

- **Per-operator row-level policies** (e.g., a tech can only read their own tickets). Rejected — premature; the studio is shared by every operator on shift and the existing UI assumes everyone can see everyone's work for handoff continuity. Adds RLS complexity with no spec-driven need.
- **No RLS at all** (rely entirely on the service-role bypass). Rejected — leaves a hole where a leaked anon key could read everything; the `authenticated`-read default is the cheap correct baseline.

---

## R4. Receipt-print stylesheet

**Decision**: One `@media print` block in `app/(studio)/checkout/checkout.css`:

```css
@media print {
  .studio-chrome { display: none !important; }
  body { background: white; }
  .receipt-page { padding: 12mm; max-width: 80mm; margin: 0 auto; }
  /* tabular numerals for any currency cell, per Constitution Principle I */
}
```

The receipt route renders a top-level `<div class="receipt-page">` and does NOT mount the studio layout's sidebar/topbar (the `app/(studio)/layout.tsx` chrome is intentionally not nested under the receipt route — the receipt is its own route under `[ticketId]/receipt/` with a minimal local layout).

**Rationale**:

- The receipt's only consumer in this phase is the browser's File → Print menu. A targeted `@media print` block is the cheapest defensible approach.
- Avoiding a PDF library (puppeteer-cluster, pdf-lib, etc.) keeps Principle V's "no new runtime dependencies" honest.
- The `80mm max-width` matches typical thermal-receipt printer paper width; using millimeter units lets Chrome's print preview do the right thing for both letter-size and thermal printers without per-printer tweaks.

**Alternatives considered**:

- **A PDF library** (`@react-pdf/renderer`). Rejected — Out of Scope per spec; needs a new dep and a server-rendering path.
- **A thermal-printer-specific endpoint via ESC/POS over a USB bridge.** Rejected — gigantic scope creep; the spec explicitly says "browser print only."

---

## R5. Prototype mapping

**Decision**: Adapt `design-system/prototypes/transaction/FlowSingle.jsx` one-for-one into `components/lacquer/checkout/*`. Component name → target file:

| Prototype symbol | Target file |
|---|---|
| `TxHeader` | `components/lacquer/checkout/tx-header.tsx` |
| `TechAvatarRow` (single-select variant via `multi={false}`) | `components/lacquer/checkout/tech-avatar-row.tsx` |
| `ServiceTiles` | `components/lacquer/checkout/service-tiles.tsx` |
| `CartRowWithTech` | `components/lacquer/checkout/cart-row-with-tech.tsx` |
| `PaymentTiles` | `components/lacquer/checkout/payment-tiles.tsx` (with non-cash tiles disabled per FR-017) |
| (totals block, inline in prototype) | `components/lacquer/checkout/totals.tsx` |
| (done screen, `stage === 'done'` branch in prototype) | `components/lacquer/checkout/done-screen.tsx` |

The prototype's `stage` state machine (`cart | waiting | cash-tip | done`) collapses to **`cart | done`** in this phase:

- No `waiting` — Square is not in scope.
- No `cash-tip` — cash tip capture is out per FR-020 ("MUST NOT prompt for or capture a tip").

The `cart` stage is the entire pre-payment screen (tech row + service tiles + cart + payment tiles + totals). The `done` stage is `<DoneScreen/>` alone.

**Rationale**:

- Per Constitution Principle I and `CLAUDE.md` "Reuse the prototypes": layouts are adapted, not redrawn.
- Reusing the prototype's exact component decomposition keeps the visual diff against `design-system/preview/Transaction Flows.html` small and lets the side-by-side verification in `quickstart.md` be mechanical.

**Alternatives considered**:

- **One large `<CheckoutScreen/>` component.** Rejected — harder to unit-test individual pieces (the cart-totals math, the tech-row collapse rule) and diverges from the prototype's decomposition.

---

## R6. Audit-log additions

**Decision**: Extend the existing `AuditAction` union in `lib/auth/audit.ts` with the six verbs this feature emits, and extend `deriveEntityType` to map the new prefixes:

```ts
// Added in 011 (entity_type "ticket")
| "ticket.created"
| "ticket.line_added"
| "ticket.line_removed"
| "ticket.line_tech_assigned"
| "ticket.discarded"
// Added in 011 (entity_type "payment")
| "payment.captured"

// deriveEntityType additions:
//   action.startsWith("ticket.")   → "ticket"
//   action.startsWith("payment.")  → "payment"
```

No schema change to `public.audit_log` — the `action` column is plain `text`, and the controlled vocabulary lives in the TypeScript union (existing convention since feature 008, see the `audit.ts` header comment).

`pos_take_cash` (R1) emits `payment.captured` from inside the SQL function — Postgres writes the audit row directly because the `BEGIN…COMMIT` boundary is in SQL. The Server Action does NOT also emit; double-counting is avoided by the function being the single emitter for that action.

The other five verbs are emitted by their respective Server Actions via the existing `audit()` helper.

**Rationale**:

- Consistent with how feature 008 added `service.*` verbs (per the comment block at the top of `lib/auth/audit.ts`). Reviewers know what to look for.
- Emitting `payment.captured` from inside the same SQL function as the `payments` insert closes the only window where an audit row could be missing relative to a payment row.

**Alternatives considered**:

- **Generic `entity.mutated` verb.** Rejected — loses the controlled-vocab guarantee Principle III depends on.
- **Postgres trigger to auto-emit audit rows.** Rejected — triggers obscure the audit emission from the action code that reviewers read; the explicit `audit()` calls in actions are easier to grep and reason about.

---

## R7. Drawer-TODO placeholder

**Decision**: Two grep-anchored placeholders for the deferred drawer-session increment:

1. Inside `pos_take_cash` SQL function:

   ```sql
   -- TODO(phase-9): increment open cash_drawer_sessions.expected_cents by p_amount_cents.
   ```

2. Inside `app/(studio)/checkout/actions.ts` `takeCash`:

   ```ts
   // TODO(phase-9): when cash drawer sessions are gated (Out of Scope here),
   // ensure pos_take_cash() also increments the open session's expected_cents.
   ```

Phase 9's implementer can `grep -r "TODO(phase-9)"` to find every site needing attention.

**Rationale**:

- Out of Scope per spec, but the spec also says "we leave the drawer-tracking TODO inline." A single grep-able tag in both the SQL and the Node wrapper makes the cleanup discoverable from either side.
- Choosing `(phase-9)` matches the spec's own phase numbering for the Out of Scope items.

**Alternatives considered**:

- **Skip the TODO; rely on memory.** Rejected — drives the well-known anti-pattern where a deferred concern silently rots.
- **Open a tracking issue.** Reasonable, but a grep-able code comment is the constitutionally-aligned minimum (we add the issue when we open phase 9, not as part of this PR).

---

## R8. Resume-or-create query

**Decision**: `resumeOrCreateTicket()` issues this query (parameters bound by the Server Action):

```sql
SELECT id
FROM tickets
WHERE opened_by_staff_id = $1                   -- current operator (viewer.staff.id)
  AND status = 'open'
  AND created_at >= $2                          -- start of "today in salon tz" (UTC instant)
  AND created_at <  $3                          -- start of "tomorrow in salon tz" (UTC instant)
ORDER BY updated_at DESC
LIMIT 1;
```

If no row returns, it calls `createEmptyTicket()` and returns the new id.

The "today in salon timezone" bounds are computed by the Server Action in TypeScript using `Intl.DateTimeFormat('en-CA', { timeZone: process.env.SALON_TZ ?? 'America/New_York' })` to derive the salon's current calendar date, then constructing two UTC `Date` instants (`startOfDay`, `nextDay`) and passing them as `timestamptz` parameters to the query. Computing the bounds in TS rather than in SQL avoids depending on a Postgres timezone literal and keeps the helper-free baseline this phase ships against. A future `lib/time/*` helper (per Constitution § "Time correctness") will absorb this inline computation when the rest of the studio standardises on it.

**Rationale**:

- Indexed by the `(opened_by_staff_id, status, created_at DESC)` index defined in `data-model.md`. Plan execution should be index-only.
- Filtering on `status = 'open'` excludes both paid (terminal) and discarded (terminal) tickets in one predicate, matching FR-003's clarified rule (Q1 + Q5).
- Doing the same-day check in SQL avoids returning rows the Node side would just discard.

**Alternatives considered**:

- **Filter in TypeScript after a broader query.** Rejected — more rows over the wire, more code to maintain, less index-friendly.
- **A materialized "current open ticket per operator" view.** Rejected — overkill for a query that runs once per sidebar click and has a tight index.

---

## R9. Optimistic UI scope

**Decision**: Two operations may apply optimistically in the client island:

- **`addServiceLine`** — append a synthetic line row immediately with a temp `id`, replace with the server-returned row on resolution.
- **`removeLine`** — hide the row immediately, restore on failure.

`takeCash` and `discardTicket` are NEVER optimistic. Both are terminal operations whose UX is a navigation/state-flip; showing the result before the server confirms would let a failed write present a "Charged" screen the spec explicitly forbids (FR-019).

`setLineTech` is rendered immediately on the chip popover close, then reconciled on the server result; if the server rejects the staff id (e.g., the staff was deactivated mid-shift), the chip snaps back and a short toast explains.

**Rationale**:

- Matches the spec assumption: "Cart mutations may render optimistically on the client; the server is the source of truth and a page refresh re-derives the cart from persisted lines."
- Carving terminal operations out of optimism preserves the "never lie to the operator" invariant from clarification Q3.

**Alternatives considered**:

- **No optimism anywhere.** Rejected — taps would feel laggy on a tile grid that's the core interaction surface.
- **Optimistic charge.** Forbidden by Q3.

---

## Open follow-ups (deferred to phase 9 or beyond)

- Cash drawer "open session" gate around `takeCash` (Out of Scope, with the inline TODO from R7).
- Realtime broadcast on `payments` insert and `tickets.status` flip (Out of Scope per FR; the existing checkout-channel subscription per `docs/system-design.md` § Realtime channels lands in phase 9 alongside drawer gating).
- Refund / void flow against a paid ticket (phase 8 — needs the manager-PIN inline override helper).
- Constitution amendment to add `'discarded'` to the system-design's documented `tickets.status` enum (recorded in `plan.md` § Complexity Tracking; the next constitution PATCH bump is the appropriate moment).
