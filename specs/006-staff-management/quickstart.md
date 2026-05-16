# Quickstart — 006-staff-management

How to bring the Staff settings page up locally and exercise every user
story end-to-end. The flow assumes feature 003 (login) is wired and you
can sign in to the studio.

## Prerequisites

- Node 24 LTS, `pnpm` or `npm`
- Docker (for local Supabase)
- This branch checked out: `006-staff-management`

## 1. Migrate and seed

```bash
supabase db reset
```

`supabase db reset` truncates everything, re-applies all migrations
(including the new `0002_staff_management.sql`), and re-runs `seed.sql`.
The seed now emits the renamed `--avatar-*` color tokens. After the
reset, three staff rows exist:

| Display name | Role        | PIN  | Color token       |
|--------------|-------------|------|-------------------|
| Maya Patel   | owner       | 1234 | `--avatar-rose`   |
| Jordan Lee   | manager     | 5678 | `--avatar-amber`  |
| Sam Chen     | technician  | 9999 | `--avatar-purple` |

Add a fourth seed row temporarily for richer story testing (optional,
not checked in):

```sql
insert into public.staff (id, display_name, role, pin_hash, color_token, active)
values (
  '10000000-0000-0000-0000-000000000004',
  'Inactive Iris',
  'front_desk',
  null,
  '--avatar-slate',
  false   -- inactive
);
```

## 2. Run dev server

```bash
npm run dev
# studio at http://localhost:3000
```

## 3. Sign in as the owner

1. Visit `http://localhost:3000` — middleware redirects to `/login`.
2. Sign in with `owner@tangnails.dev` / `tang-nails-dev`.
3. At `/select-staff`, tap **Maya Patel** and enter PIN `1234`.
4. You should land on `/dashboard`.

## 4. Smoke-check each user story

### US1 — See the roster at a glance

1. Click **Settings** in the topbar (or hit `/settings` directly) — you
   should be redirected to `/settings/staff`.
2. The Settings tab bar shows: General · **Staff** · Notifications · Billing.
3. The table renders 3 active staff + (if you added the optional row) 1
   inactive staff.
4. Toggle **Show inactive** on/off — the muted Inactive row
   appears/disappears.
5. Type "ma" in the search field — only Maya remains.
6. The summary above the table reads "3 active · 4 total" (or 3·3 without
   the optional row).

### US2 — Add a new staff member with a PIN

1. Click **Add staff** (top-right of the table).
2. Step 1 — enter "Maya Chen", pick **Tech** role, pick **Green** swatch,
   leave the PIN toggle on. Click **Next: set PIN**.
3. Step 2 — tap `1 9 8 4` on the keypad. Confirm phase appears. Tap
   `1 9 8 4` again. Success step appears with "Maya Chen can now log in
   with their 4-digit PIN."

   No override PIN is requested — owners and managers can add staff
   directly (Clarifications Q1).
4. Click **Done**. Toast reads "Maya Chen added to the roster". The new
   row appears in the table and is selected; the right panel populates.

### US3 — Edit a staff member's details

1. With Maya Chen selected, change the display name to "Mei Chen". The
   header preview (avatar + name) updates immediately; the table row
   still shows "Maya Chen".
2. The **Save changes** button enables. Click it. The table row updates;
   toast reads "Changes saved".
3. Click a different row before saving any further change — drafts are
   discarded with no prompt.

### US4 — Set or change a PIN

1. Select Sam Chen (existing PIN `9999`).
2. In the panel, the PIN row shows "4-digit PIN set" with the shield
   icon and a **Change** button.
3. Click **Change** — PIN modal opens directly (no override prompt).
   Enter new PIN `1111`. Confirm with `1111`. Modal closes, panel
   updates, toast reads "PIN updated".

### US5 — Deactivate, reactivate, remove

1. With Sam selected, click **Deactivate** in the panel footer. Dialog:
   "Deactivate Sam Chen?" with the explanatory copy. Click
   **Deactivate**. (No appointment-count warning — that was removed for
   v1 per Clarifications Q2.)
2. Row now shows the Inactive badge (visible only with "Show inactive"
   on). Panel's Active toggle is off. **Deactivate** is replaced by
   **Reactivate**.
3. Click **Reactivate**. Toast: "Changes saved".
4. Click **Remove from salon**. Confirm dialog opens directly (no
   override prompt). Click **Remove**.
5. Sam is gone. The panel reverts to empty state. Toast: "Sam Chen
   removed."

### US6 — Restrict who can manage staff

1. Sign out (operator menu → Sign out).
2. Sign in again as `manager@tangnails.dev` / `tang-nails-dev`, then at
   `/select-staff` choose **Jordan Lee** with PIN `5678`.
3. Open `/settings/staff` — you can read and edit rows.

   **Verify the role-select scope** (Clarifications Q3): open any
   non-owner row, click the role select — only "Manager", "Technician",
   "Front desk" are offered. "Owner" is not in the list.

   **Verify the manager × owner read-only gate** (Clarifications Q4):
   click **Maya Patel** (owner). The edit panel opens with **every
   control disabled**:
   - Display name input: greyed out, tooltip "Only owners can edit
     owner accounts."
   - Role select: disabled, same tooltip
   - Color picker: all swatches non-interactive
   - Active toggle: disabled
   - "Change PIN": button disabled
   - "Deactivate": link disabled
   - "Remove from salon": link disabled
4. Try to bypass the UI: in DevTools, manually POST a `FormData` to the
   `updateStaff` Server Action with `staff_id` = Maya's id and
   `display_name` = "Hacked". The page redirects back with
   `?error=forbidden_target`, an inline toast reads "Only owners can
   edit owner accounts.", and no `audit_log` row is written.
5. Sign out, sign in as Sam (technician). Visit `/settings/staff` —
   redirected to `/dashboard` with no flash.

### US7 — Toasts

1. Perform two mutations in quick succession (e.g., edit one row and
   save, then immediately edit another row and save). The first toast
   dismisses when the second fires; only one toast is on-screen at a
   time (Sonner default).

## 5. Inspect the audit log

```sql
select ts, action, acting_as_staff_id, entity_id, payload
from public.audit_log
where action like 'staff.%'
order by ts desc
limit 25;
```

You should see one row per Server Action invocation:

- `staff.added` for the Maya Chen creation
- `staff.pin_set` for the PIN change on Sam (with `previous_pin_set:
  true`)
- `staff.updated` for the rename to Mei Chen (with `before` / `after` /
  `changes`)
- `staff.deactivated`, `staff.reactivated`, `staff.removed` for the
  lifecycle steps

**There is no `authorizing_staff_id` in any payload** —
`acting_as_staff_id` is the sole accountability key (Clarifications Q1).

Raw PINs never appear in any `payload`.

For the US6 step-4 bypass attempt, you should see **zero** new
`audit_log` rows (the permission matrix rejected the mutation before
any DB write).

## 6. Tests

```bash
# Unit tests
npm test

# E2E (requires the local Supabase running)
npm run test:e2e
```

The new test files:

- `tests/unit/staff/sort.test.ts` — sort comparator + role priority
- `tests/unit/staff/filter.test.ts` — case-insensitive substring match
- `tests/unit/staff/validation.test.ts` — name/role/color/pin shape rules
- `tests/unit/staff/permissions.test.ts` — the matrix (every operator ×
  target × action cell)
- `tests/unit/staff/audit.test.ts` — payload shape for all 6 verbs (no
  `authorizing_staff_id`)
- `tests/unit/staff/last_owner_trigger.test.ts` — DB trigger
- `tests/e2e/staff.spec.ts` — one scenario per US, plus US6 negatives
  (technician redirect, self-demote disabled, manager × owner read-only)

Reset state between e2e runs:

```ts
test.beforeEach(async () => {
  await truncateAuditLog();
  await resetStaffToSeed();
});
```

## 7. Design-system audit

Before marking the feature complete, run the design auditor against the
new surfaces:

```bash
# In Claude Code:
# /agent speckit-design-auditor
```

The auditor compares every visual value on the new files to the
`design-system/prototypes/user-management/` and `design-system/preview/`
references. Token violations block merge.

## 8. Common issues

- **"Maya is the only owner — last-owner trigger fires when I demote
  her."** Expected behavior. Add another owner first (you can do this
  from the same panel when signed in as Maya), then demote.
- **"I'm logged in as a manager and can't change anything about Maya."**
  Expected — managers see owner rows as read-only per Clarifications Q4.
  Sign in as an owner if you need to edit an owner.
- **"My manager-PIN override dialog never appears."** It was removed in
  Clarifications Q1. The route gate (owner or manager) is the sole
  authorization check; all mutations commit directly.
- **"Show inactive toggle resets after every page reload."** Expected —
  spec says "session" persistence (`sessionStorage`, not
  `localStorage`). Closing the tab clears it; F5 keeps it.
- **"`supabase db reset` fails: function `staff_assert_owner_present`
  already exists."** Use `CREATE OR REPLACE` (which the migration does);
  re-run.
