# Phase 1 — Quickstart

How to run, verify, and gate this feature locally.

---

## 1. Manual smoke test — happy path (US1)

Pre-reqs: `supabase start` is running; `npm run dev` is up at
`http://localhost:3000`; seed data includes at least one paid ticket
from today.

1. Sign in as a seeded **owner** account.
2. Navigate to **Transactions**.
3. Click any of today's paid tickets. The right-side drawer opens.
4. Find a service line whose tech chip you want to change. A small
   "**Change**" trigger sits immediately after the chip.
5. Click "Change." A Popover opens listing every active staff member,
   each row showing the avatar + display name.
6. Click a different active tech. The Popover dismisses; the chip
   updates to the new tech within ~250 ms (the page revalidates and
   re-renders).
7. Close and re-open the drawer. The chip persists.
8. Open **Dashboard** — the per-tech count column reflects the new
   attribution.
9. Open **Report** for the current period — the line appears under the
   new tech.
10. Open **Payroll** for the current period — the new tech's
    commissionable income now includes this line; the previous tech's
    no longer does.

Sign out, sign in as a seeded **manager**, repeat steps 2–10. Same
behaviour (Acceptance Scenario #2).

---

## 2. Manual smoke test — non-privileged guard (US2)

1. Sign in as a seeded **technician**.
2. Navigate to **Transactions**, open the same paid ticket.
3. The "Change" trigger is **not present** on any service line. The
   chips are plain (no Lock icon either, since the period is still
   open).
4. Sign out, sign in as a seeded **front-desk** user. Same observation.
5. Direct-call rejection check: from the browser devtools console of
   the technician session, attempt to invoke the action against the
   target line (the implementing developer can paste a one-liner that
   imports the action). The promise rejects with a
   `PermissionDeniedError`. No row in `audit_log` is written
   (verifiable via `supabase db query "select count(*) from audit_log
   where action = 'ticket.line_tech_reassigned' and entity_id =
   '<lineId>'"`).

---

## 3. Manual smoke test — finalized-period lock (US3)

1. Pick (or seed) a paid ticket whose pay period has been finalized.
   The simplest path is to record any payout for the current period
   via Payroll → Record payout, then revisit the same paid ticket from
   today's transactions.
2. Sign in as an **owner**, open the receipt drawer for the targeted
   ticket.
3. **No** "Change" trigger appears on any line. **Every** staff chip
   shows a small `Lock` icon at the leading edge.
4. Hover (or tap on touch) the Lock icon. The tooltip reads exactly:
   *"Payouts for this pay period have been finalized."*
5. Repeat as **manager** — same behaviour.
6. Direct-call rejection: from devtools, attempt to invoke the action.
   The promise rejects with a `PayPeriodFinalizedError`. No audit row.

---

## 4. Edge cases worth eyeballing

- **Same tech selected.** Open the picker, pick the tech that is
  already assigned, dismiss. The drawer returns to its prior state
  with no toast, no error, no audit row.
- **Line previously unassigned.** If you can find or seed a paid line
  with no current tech, open it: the chip slot shows a placeholder
  (the spec calls out that lines without an assignee remain eligible
  for first-time assignment via this surface, FR-006). The audit row
  records `previous_staff_id: null`.

---

## 5. Test commands

### During development (per phase)

```bash
# Lint + format the files this phase touched
npx prettier --check $(git diff --name-only --diff-filter=ACMR HEAD)
npx eslint $(git diff --name-only --diff-filter=ACMR HEAD | grep -E '\.(ts|tsx|js|jsx)$' || echo .)

# Typecheck (always full — TypeScript's project graph)
npm run typecheck

# Unit tests — scoped by changed files
npm run test:changed

# E2E — scoped (the wrapper picks up the new spec automatically
# because the new spec imports the new action; transitive graph)
npm run test:e2e:changed
```

For iterating on a single user story of the new spec:

```bash
npx playwright test tests/e2e/transactions-paid-line-reassign.spec.ts -g "US1"
npx playwright test tests/e2e/transactions-paid-line-reassign.spec.ts -g "US2"
npx playwright test tests/e2e/transactions-paid-line-reassign.spec.ts -g "US3"
```

### Final gate (before `git push` / PR)

Run all five, in this order, all must be green
(`CLAUDE.md § Pre-push quality gates`):

```bash
npm run format:check && \
npm run lint && \
npm run typecheck && \
npm test && \
npm run test:e2e
```

---

## 6. Spec coverage matrix — gate before merge

Each spec requirement maps to the test that proves it. A PR for this
feature is not ready to merge until every row is green.

| Spec id | Proven by |
|---|---|
| FR-001 | `transactions-paid-line-reassign.spec.ts › US1 › owner reassigns` |
| FR-002 | `tests/unit/payroll/finalized.test.ts` (three branches) + `…spec.ts › US3 › lock` |
| FR-003 | `…spec.ts › US2 › no affordance for technician` + `…spec.ts › US2 › no affordance for front-desk` |
| FR-004 | `…spec.ts › US3 › lock icon present with tooltip copy` |
| FR-005 | Component test of `<ReceiptLineTechChip>` Popover renders only `active=true` staff + unit test for the action's `StaffNotActiveError` branch |
| FR-006 | Unit test `reassign-paid-line-tech.test.ts › writes audit with previous_staff_id null when the line was unassigned` |
| FR-007 | Unit test `reassign-paid-line-tech.test.ts › leaves all monetary and identity fields untouched` (snapshot before/after) |
| FR-008 | Implicit — payroll commission and tip math read `ticket_items.assigned_staff_id` (existing); covered by the US1 e2e step that re-renders the Payroll page after reassignment |
| FR-009 | `…spec.ts › US1` asserts the four downstream surfaces reflect the new tech without any extra user action |
| FR-010 | Unit test `reassign-paid-line-tech.test.ts › writes exactly one audit row with action='ticket.line_tech_reassigned'` |
| FR-011 | Unit test `reassign-paid-line-tech.test.ts › audit payload matches FR-011 shape` |
| FR-012 (a–e) | Five unit tests, one per gate, each asserting the rejection error type AND zero audit rows AND zero ticket-item mutations |
| FR-013 | Unit test `reassign-paid-line-tech.test.ts › no-op when input equals current` |
| FR-014 | Component test (UI gate present/absent per role) + unit test for `PermissionDeniedError` (server gate) |

| SC-### | Verification |
|---|---|
| SC-001 | Manual smoke test step 1 — operator reassigns in < 30 s; recorded once during dev verification |
| SC-002 | FR-010 unit test |
| SC-003 | FR-009 e2e spec |
| SC-004 | FR-002 + FR-012 (c) unit + e2e |
| SC-005 | FR-003 + FR-012 (a) unit + e2e |
| SC-006 | FR-007 unit test snapshots ticket totals |
| SC-007 | E2E spec contains a baseline snapshot of the technician's drawer before and after the feature ship; identical pixel count + selector tree |
