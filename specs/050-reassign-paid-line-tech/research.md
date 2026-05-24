# Phase 0 — Research

Every decision the spec deferred to "the plan" — resolved here with one
**Decision · Rationale · Alternatives** block per question. No
`NEEDS CLARIFICATION` items remain after this file.

---

## 1. Which pay-period helper does the reassignment check use?

**Decision**: Reuse `resolvePayPeriod(tz, now, offset)` from
`lib/payroll/window.ts`, called with the ticket's `closed_at` as `now`
and `offset = 0`. That returns a `PayPeriodRef` whose `startsOn`/`endsOn`
key the `pay_periods` row lookup. Wrap the "is finalized?" logic in a new
single-purpose helper `isPayPeriodFinalized(supabase, ref)` in
`lib/payroll/finalized.ts` — keeps the rule in one place and makes it
unit-testable.

**Rationale**: The Payroll feature (`specs/047-payroll-page/`) already
established `resolvePayPeriod` as the single boundary computation
(constitution mandates one `lib/time/*` surface — `period-windows.ts`).
Reusing it eliminates any chance of the two surfaces disagreeing on which
window contains a given timestamp. The spec's Assumption *"Pay-period
boundary helper exists"* points squarely at this helper.

**Alternatives considered**:
- *Re-derive the window inline.* Rejected — duplicate boundary math is
  the failure mode the constitution's single-`lib/time/*` rule exists
  to prevent.
- *Walk `pay_periods` rows directly by `starts_on ≤ closed_at ≤ ends_on`.*
  Rejected — `pay_periods` rows are created **lazily** (see
  `ensurePayPeriodRow` in `lib/payroll/queries.ts:81`). A paid ticket
  may belong to a window whose row was never created (no payroll page
  load ever happened for it). The resolver is canonical.

---

## 2. What does "the pay period is finalized" mean, exactly?

**Decision**: The pay period is **finalized** iff a `pay_periods` row
exists for it AND **either** (a) its `status = 'closed'`, **or** (b) at
least one row in `payroll_payouts` references its `id`. Reassignment is
permitted otherwise.

```sql
-- Pseudocode for isPayPeriodFinalized(ref):
SELECT id, status FROM pay_periods WHERE starts_on = ref.startsOn;
-- if no row → false
-- if row.status = 'closed' → true
-- else: SELECT 1 FROM payroll_payouts WHERE pay_period_id = row.id LIMIT 1
--       → true iff a row exists
```

**Rationale**: The spec is explicit (FR-002, Assumptions § *'Finalized' =
a payout row exists*): the existence of a `payroll_payouts` row means
money has moved against this period and reassignment would silently
disagree with already-issued payouts. Adding `status='closed'` as a
second signal is a strict superset — it covers the case where an owner
explicitly closed the period (via `payroll.period_closed` audit action
— see `lib/auth/audit.ts`) without yet recording payouts. Both signals
are committed acts that should freeze attribution; treating either as
the lock removes a footgun without contradicting the spec.

**Alternatives considered**:
- *Payout existence only.* Rejected — leaves a gap where a manager
  closed the period without recording payouts (rare but possible).
- *`pay_periods.status='closed'` only.* Rejected — the period stays
  `'open'` until the owner explicitly closes it; payouts can be recorded
  against an open period (the current Payroll flow does exactly this).
  Closing-only would allow reassignment after some payouts are paid,
  which the spec forbids.
- *Per-tech payout existence (only block reassignment if the affected
  tech has a payout).* Rejected — the spec is unambiguous that the
  whole period locks, not just the affected tech (FR-002, FR-004
  *"every staff chip"* of *"a paid ticket inside a finalized pay
  period"*). A per-tech rule would also be confusing UX: the same ticket
  would have some lines editable and some not.

---

## 3. What audit action name does the new mutation write?

**Decision**: `"ticket.line_tech_reassigned"`. Distinct from
`"ticket.line_tech_assigned"` (already used by the checkout-time
`setLineTech` in `app/(studio)/checkout/actions.ts:629`). Added to the
`AuditAction` union in `lib/auth/audit.ts`.

**Rationale**: FR-010 mandates the two actions be distinguishable so
reports and audit history can separate checkout-time assignment from
post-checkout correction. The `verb_noun.qualifier` convention is the
existing pattern in the union — `ticket.line_tech_assigned`,
`ticket.discarded`, `payroll.payout_recorded`, `payroll.payout_undone`,
`payroll.period_closed`. `reassigned` reads as the past-tense
correction of an earlier `assigned` and follows the same convention.

**Alternatives considered**:
- *Reuse `ticket.line_tech_assigned`.* Rejected — directly violates
  FR-010. Also: payroll attribution is reconstructed from the audit
  trail in disputes; merging the two would erase the distinction
  between "the cashier mis-tapped at checkout" and "the manager
  corrected it later," which is exactly the information the salon
  owner needs to investigate recurring errors.
- *`ticket.line_tech_corrected`.* Rejected — "reassigned" is more
  literal (we changed `assigned_staff_id`); "corrected" implies a
  value-judgement we don't actually verify (the new value might also
  be wrong). `reassigned` is the action; the audit payload's
  before/after captures the substance.

---

## 4. What does the per-line picker reuse?

**Decision**: Adapt the existing `Popover`-based active-staff picker
from `components/lacquer/checkout/cart-row-with-tech.tsx` (lines
284–403) — a Radix Popover anchored to a small "Change" trigger, body
listing each active staff member as a row (avatar + display name) that
fires `onPick(staffId)` on click. **Active filter happens server-side**
in the query that backs the picker (Supabase `staff.active = true`),
not in the client.

The trigger is a small ghost text button "Change" placed immediately
after the tech chip, separated by a thin divider, sized to match the
chip's font (12–13px). Lucide `Pencil` icon optional inside — the
cart-row implementation uses just the text "Change" already.

**Rationale**: Spec Assumption *"Staff picker is reusable"* and FR-005
*"the same interaction model used by the open-cart staff picker so the
experience feels familiar"* both point at this component. The Popover
pattern fits the dense receipt drawer better than a modal sheet (the
drawer is narrow; a sheet would cover the rest of the receipt).

**Alternatives considered**:
- *The avatar-row picker from `components/lacquer/checkout/tech-avatar-row.tsx`.*
  Rejected — designed for the cart's pre-pick state where space is
  generous (full row of avatars). The drawer line is short; a Popover
  is more space-efficient and the cart already uses Popover for the
  *change-existing-tech* sub-flow (`cart-row-with-tech.tsx`).
- *A bare `<select>`.* Rejected — does not honor Lacquer's interaction
  language (avatars + initials are the brand's identity-rendering
  pattern across the app).

---

## 5. What does the lock indicator look like?

**Decision**: A 14px `Lock` icon (Lucide, 1.5px stroke) inserted at the
**leading edge** of the tech chip (left of the avatar), inside the same
`.tp-d-tech-chip` flex container. The icon is wrapped in a
`<TooltipTrigger>` so hover / focus / tap reveals the
`<TooltipContent>` carrying the copy *"Payouts for this pay period have
been finalized."* — exact wording from FR-004.

Chip background tints one step toward neutral (`--color-neutral-50`) so
the locked state reads as muted without losing the avatar identity.
This is one new chip-modifier class (`.tp-d-tech-chip[data-locked]`)
that flips background and `cursor: default`.

**Rationale**: Constitution Principle I — Lucide only, 1.5px stroke,
14px works inside the existing chip's 14px avatar slot without
distorting the chip's height. The Tooltip primitive already lives in
`components/ui/tooltip.tsx` and is used elsewhere (e.g., payroll
dialogs). Placing the icon **leading** rather than trailing keeps the
chip's trailing edge clean for the "Change" trigger in the privileged
+ open-period state — the two states differ at the trailing edge, not
the leading, so the chip's overall geometry stays predictable.

**Alternatives considered**:
- *A separate per-line lock badge outside the chip.* Rejected — adds
  visual noise to a row that already carries name, category, tech
  chip, quantity, and price. Folding the lock into the chip keeps the
  affordance local to the thing it locks.
- *Change the chip's color (e.g., desaturate the avatar).* Rejected —
  the avatar color encodes staff identity (a Lacquer brand element);
  desaturating it would obscure that. A neutral background tint
  preserves identity while signaling state.
- *Show a footer-level lock banner on finalized tickets.* Rejected —
  FR-004 specifically asks for the lock indicator on every chip with
  per-chip tooltip; a banner doesn't satisfy the per-chip rendering
  contract.

---

## 6. Where does the new Server Action live?

**Decision**: A new file `app/(studio)/transactions/actions.ts` that
exports `reassignPaidLineTech`. The Transactions surface is where the
drawer renders and where the action originates; collocating the action
with its surface is the existing convention (Payroll, Checkout, EOD
all follow this).

**Rationale**: The existing
`app/(studio)/checkout/actions.ts:setLineTech` is conceptually
**ticket-creation-time** — it mutates open carts and uses the cashier's
role. The new action mutates **paid** tickets and uses the manager's
role; semantically it belongs to the Transactions surface, not
Checkout. Keeping them in separate files also keeps each action's
imports tight (Checkout doesn't need to import the pay-period helper;
Transactions doesn't need to import cart-draft helpers).

**Alternatives considered**:
- *Add to `app/(studio)/checkout/actions.ts`.* Rejected — surface
  mismatch (the drawer is in Transactions, not Checkout) and bloats a
  file that already exports ~10 actions.
- *A neutral `lib/tickets/reassign-line-tech.ts`.* Rejected — Server
  Actions must be declared in `app/**/actions.ts` (or marked `'use
  server'`) and the convention here is to collocate them with the
  surface, not bury them under `lib/`.

---

## 7. What revalidation does the action trigger?

**Decision**: After a successful save the action calls
`revalidatePath('/transactions')`, `revalidatePath('/dashboard')`,
`revalidatePath('/report')`, and `revalidatePath('/payroll')` — in
that order, all four unconditionally. The drawer additionally calls
`router.refresh()` after the action returns so the drawer's own server
parent re-renders with the new `transaction.items[].techId`.

**Rationale**: All four surfaces derive per-tech aggregates from
`ticket_items.assigned_staff_id`:
- `/transactions` — the drawer the user is on; the per-line chip needs
  to flip immediately.
- `/dashboard` — per-tech ticket counts for today.
- `/report` — per-tech revenue for the current period (and historical
  periods, but those are only reachable for open periods since
  finalized ones block reassignment entirely).
- `/payroll` — the in-flight ledger's per-tech commission and tip
  attribution; the spec is explicit that the current-period payroll
  must reflect the change "without further operator action" (FR-009).

Four `revalidatePath` calls are cheap (they invalidate Vercel's
per-route cache tags, not the data itself) and there is no need to be
clever about which periods/days are affected — the page handlers
re-query.

**Alternatives considered**:
- *Tag-based revalidation (`revalidateTag(`tx:${id}`)`).* Rejected —
  the codebase does not currently use tags for these surfaces; adding
  a tag system here would introduce a one-off pattern. The four
  `revalidatePath` calls are the local convention.
- *Skip `/payroll`.* Rejected — FR-009 explicitly requires the
  current-period payroll attribution to reflect the change on next
  render; the Payroll page is the visible surface for that.

---

## 8. How does the drawer know the viewer's role and the period's lock state?

**Decision**: The Transactions server page
(`app/(studio)/transactions/page.tsx`) already calls
`requireStudioSession()`. Extend the page to:
1. Pass `viewerRole = viewer.staff.role` down to
   `<TransactionsView>` and on to `<ReceiptDrawer>`.
2. For each loaded `TransactionDetail`, compute
   `payPeriodFinalized: boolean` via `isPayPeriodFinalized(...)`. Cache
   the result by period start-date in a `Map<string, boolean>` so a
   page of N transactions across M distinct periods costs ≤ 2·M queries
   (one `pay_periods` lookup, one `payroll_payouts` existence check
   per period), not N·2.
3. Attach the boolean to each transaction (`TransactionDetail` gains a
   `payPeriodFinalized: boolean` field).

The drawer receives both; it uses `viewerRole` to decide whether to
show the "Change" trigger at all (FR-003, FR-014) and
`payPeriodFinalized` to decide whether to swap to the locked-chip
rendering (FR-004).

**Rationale**: This is the standard RSC → client-component prop flow
already used by the Transactions page (the entire `TransactionDetail`
shape is server-computed and frozen at the page boundary). Computing
the finality at the server keeps the client thin (no Supabase from the
browser, Principle II) and keeps the cache locality (one round-trip
per period per page load).

**Alternatives considered**:
- *Compute finality client-side on drawer open.* Rejected — client-side
  Supabase call against `payroll_payouts` would need RLS allowance for
  the role; needlessly widens the trust boundary.
- *Compute finality lazily inside the Server Action only.* Rejected —
  the **UI affordance gate** (FR-004) needs the boolean before the user
  ever clicks, so the drawer must know it at render time. Computing it
  twice (render-time and action-time) is correct: the server-action
  check is the authority (FR-014); the render-time check is the
  affordance.

---

## 9. How is the no-op (same tech) edge case handled?

**Decision**: The Server Action loads the line's current
`assigned_staff_id`, compares it to the input, and if they are equal
returns `{ ok: true }` immediately **without** writing the update, the
audit row, or the `revalidatePath` calls. This is the same shape as
`setLineTech`'s success path, just short-circuited at the comparison.

**Rationale**: FR-013 — *"Saving the same technician that is already
assigned to the line MUST be treated as a no-op: no audit row, no
downstream view change, and no error."* Returning `{ ok: true }` keeps
the client's handling uniform (no error path to handle); skipping the
side effects fulfills the rest of FR-013.

**Alternatives considered**:
- *Let the update through but trust the database write to be a no-op.*
  Rejected — Supabase still writes the row (touching `updated_at` if
  the column existed), the audit insert still happens, and the
  revalidation still fires. Fails three sub-requirements of FR-013.
- *Throw a typed `NoChange` error.* Rejected — FR-013 says **no
  error**.

---

## 10. Does the action need a fresh manager-PIN inline override?

**Decision**: **No.** The action checks `viewer.staff.role in {owner,
manager}` from the existing session cookie. No fresh PIN re-entry is
required.

**Rationale**: Constitution Principle II lists the privileged actions
that **require** fresh manager-PIN inline override: "refunds, voids,
settings edits." Tech reassignment is not in that list. The spec
itself is silent on PIN — the operator is already an owner or manager
authenticated for the session.

A reassignment moves attribution between people's payouts, which is
sensitive — but it is **bounded** (one line at a time, one open pay
period, owner/manager only, auditable, reversible by another
reassignment). That bound is what makes it different from a refund
(money leaves the till irreversibly). The audit row + role gate are
sufficient.

**Alternatives considered**:
- *Require fresh PIN.* Rejected — would add friction to the most
  common usage path (operator notices the mistake, fixes it
  immediately, before the customer is out the door) without
  proportionate safety gain. If the operator's session is hijacked,
  the attacker already has refund/void authority, which is the
  larger problem.

---

## 11. Concurrent reassignment (last-write-wins) — how implemented?

**Decision**: Plain `UPDATE … SET assigned_staff_id = ? WHERE id = ?`
against `ticket_items` — no row lock, no optimistic-concurrency
version check, no advisory lock. Each successful save writes its own
audit row; the audit trail is the reconstructible history.

**Rationale**: The spec's Edge Case for concurrent reassignment is
*"the last successful save wins; each successful save writes its own
audit row so the history is reconstructible. No locking dialog is shown
to the operator."* This is the cheapest correct implementation. The
contention rate is essentially zero (single salon, ≤ 2 owners/managers
in the building at once, manual correction action — see Scale/Scope).

**Alternatives considered**:
- *Optimistic concurrency via `If-Match` on `updated_at`.* Rejected —
  the spec doesn't ask for it, and contention is near-zero. Adding it
  would force an error UX (retry dialog) that the spec explicitly
  forbids.
- *`SELECT ... FOR UPDATE`.* Rejected — same reason; introduces an
  unnecessary lock for a near-zero contention scenario.

---

## 12. Tests — which surfaces need new vs extended coverage?

**Decision**:
- **New Vitest**: `tests/unit/transactions/reassign-paid-line-tech.test.ts`
  covering the six rejection gates (role, paid-state, finalized-period,
  staff-inactive, ticket-not-found, line-not-on-ticket) plus the no-op
  edge case and the audit-row shape.
- **New Vitest**: `tests/unit/payroll/finalized.test.ts` covering the
  three branches of `isPayPeriodFinalized` (no row → false; row +
  `status='closed'` → true; row + `payroll_payouts` exists → true; row
  + neither → false).
- **New Playwright**: `tests/e2e/transactions-paid-line-reassign.spec.ts`
  with three describe blocks — `US1: owner reassigns`, `US2: technician
  + front-desk see no affordance and are rejected on direct call`,
  `US3: finalized period locks the surface`. Add to the `main` project
  (no shared-aggregate concerns — the spec mutates per-row attribution,
  not global counts that the baseline projects assert).
- **Extend** `tests/unit/auth/role-permissions.test.ts` — add an entry
  to the snapshot for the new audit action.

**Rationale**: Principle IV (test-first for critical paths) and CLAUDE.md's
intermediate-phase scoping pattern (`-g "USn"` describe-naming
convention) — the e2e spec follows the established `US1 / US2 / US3`
describe-naming so per-phase gates can scope.

**Alternatives considered**:
- *Add to `tests/e2e/transactions.spec.ts` instead of a new spec file.*
  Rejected — the existing file is browsing-and-receipt-drawer scope;
  the new behaviour is a mutation flow with role variants and merits
  its own file. Also: separate file lets a later phase scope its gate
  to just the new spec (`-g "US1"` against the focused file).

---

## 13. Staff picker — should it filter inactive staff client-side or server-side?

**Decision**: Server-side. The picker is fed by the existing
`staff` roster query the page already runs (`active = true`); no
client-side filter is needed.

**Rationale**: FR-005 — *"The staff picker used by the reassignment
flow MUST list only active staff."* Filtering at the source removes the
chance of leaking an inactive name into the dropdown via a stale
client state. The action **also** server-side validates `staff.active
= true` (FR-012 (d)) — defense in depth.

**Alternatives considered**:
- *Client filter on the existing roster.* Rejected — the existing
  Transactions roster query returns active staff already; the page
  doesn't need an extra filter step, and the action's server-side
  check covers the race window the spec calls out ("staff deactivated
  between picker open and save").
