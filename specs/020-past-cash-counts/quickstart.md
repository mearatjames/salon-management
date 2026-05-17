# Quickstart — Past Cash Counts (020)

A hands-on walkthrough an implementer can follow after `npm install` and a fresh local Supabase. Assumes feature 019 (End of Day Cash) is already merged and seeded.

## Prereqs

- Local Supabase running (`supabase start`).
- Migrations applied through `0014_end_of_day_cash.sql`.
- At least one closed `cash_drawer_sessions` row in the database (seed adds one; close the day in dev to add more).
- A signed-in studio session whose `acting_as_staff_id` resolves to a staff row with `role IN ('owner', 'manager')`.

## 1. Apply this feature's migration

```bash
supabase migration up 0015_cash_drawer_edits.sql
```

Verify:

```bash
supabase db psql -c "\d public.cash_drawer_sessions" | grep updated_at
supabase db psql -c "\df public.pos_edit_cash_drawer"
```

Expect a new `updated_at timestamptz` column on the table and a `pos_edit_cash_drawer(uuid, int, text, uuid, uuid)` function listed.

## 2. View past counts (US1)

Navigate to `http://localhost:3000/end-of-day/history`.

Expected:

- The header reads "Past cash counts" with the same eyebrow + h1 + subtitle treatment as `/end-of-day`.
- A list shows every closed session ordered newest first. Columns: business day · expected · counted · variance (with color) · closed by · close time.
- An empty database shows the empty state ("Closed cash counts will appear here…").
- A "View past counts" link is also visible in the header of `/end-of-day` and navigates here.

Smoke check the role gate:

```bash
# Sign in as a technician on a second profile and visit /end-of-day/history.
# Expect a silent redirect to /dashboard.
```

## 3. Open a detail (US1)

Tap any row in the list. The browser navigates to `/end-of-day/history/<sessionId>`.

Expected:

- A read-only breakdown card shows expected / counted / variance / note exactly like the `done-screen.tsx` from feature 019.
- The closed-by display name and close timestamp appear under the breakdown.
- A "Back" link returns to the list.
- An **Edit count** button is visible (owner or manager role; hidden for any other role, though the role is already gated by the page wrapper).

## 4. Edit a count (US2)

Tap **Edit count**. The detail view swaps to an edit form.

Expected initial state:

- The amount display shows the existing counted amount (`$164.50`).
- The numpad supports the same input rules as the close screen (digits, one decimal point, ≤ 2 decimals, backspace, Clear text-link).
- The notes textarea is prefilled with the existing notes (or empty).
- The comparison block shows the existing variance with color.
- **Save changes** is disabled until the operator makes a change (no-op edits are allowed but must still be invoked deliberately — see R5).

Type a new amount that produces a non-zero variance:

- The comparison block updates within 150 ms per keystroke (SC-002).
- The notes textarea remains required-when-variance-nonzero; clearing it disables **Save changes**.

Tap **Save changes**. The page revalidates and the detail view re-renders with the new values, a success toast appears, and the change-history accordion (next step) becomes visible.

## 5. See the change history (US3)

After the first edit, the detail view shows:

- An "Edited" pill in muted color next to the close timestamp.
- A "Last edited by [name] at [time]" line under the breakdown.
- An expandable "Change history" section. Tap to expand; the most recent edit appears first with before/after counted, variance, and notes.

The same "Edited" pill now appears on this row in the list at `/end-of-day/history`.

## 6. Verify the audit trail

```bash
supabase db psql -c "
  select created_at, action, acting_as_staff_id, payload
    from public.audit_log
   where entity_type = 'cash_drawer'
     and action = 'cash_drawer.edited'
     and entity_id = '<sessionId>'
   order by created_at desc;
"
```

Expect one row per edit attempt (including no-op edits per R5), each with a payload containing `{before, after, session_id}`.

## 7. Run the tests

```bash
npx vitest run tests/unit/end-of-day
npx playwright test tests/e2e/past-cash-counts.spec.ts
```

US1, US2, US3 each have at least one e2e scenario. Vitest covers the RPC mapping, the role gate, and the no-op audit behavior.

## 8. Pre-push gates

Before push, run the full local gate set (constitution § Dev Workflow):

```bash
npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:e2e
```

All five must be green locally before opening the PR.
