# Quickstart — Select staff redesign

## Run locally

```bash
supabase start          # local Postgres/Auth/Realtime (Docker)
npm run dev             # Next.js dev server → http://127.0.0.1:3000
```

Sign in at `/login` with the seeded owner (`owner@tangnails.dev` / `tang-nails-dev`).
After the device login you land on the redesigned `/select-staff`.

To see the redesign against a realistic roster, seed ~18–25 active staff with PINs
(the prototype's 18-person fixture is illustrative — the layout must hold to ~25).

## Reference layout

Open the vendored Option D prototype side by side while building:

```
design-system/prototypes/select-staff/Select Staff Redesign.html   # all 4 variants
design-system/prototypes/select-staff/select-staff-variants.jsx    # VariantAvatarGrid = Option D
```

## Manual verification (maps to spec acceptance scenarios)

**US1 — pick avatar + sign in**
1. `/select-staff` shows every eligible staff as a compact avatar tile in a full-width
   grid — no narrow form panel.
2. Tap a tile → a modal opens centered over a dimmed backdrop with that person's avatar,
   name, role, and a keypad.
3. Enter the correct 4-digit PIN → verification fires on the 4th digit → signed in and
   taken to the destination.
4. Each digit fills one of 4 indicator positions; the typed digits are never shown.

**US2 — search**
5. Type part of a name → the grid narrows as you type (no submit).
6. Type text matching no one → an empty-result message names the typed text.
7. Clear the search → the full roster reappears.

**US3 — recovery**
8. Enter a wrong PIN → the modal stays open, the indicator shows an error state, the
   entry clears; retry immediately in the same modal.
9. Dismiss the modal via backdrop tap, the close control, or `Escape` → back to the grid,
   no one signed in.
10. Dismiss, tap a different tile → PIN entry starts fresh (no carried-over digits).
11. A staff member with `pin_reset_admin_at` set shows the admin-PIN-reset notice on
    their tile.

**Edge cases**
- Empty roster (no staff with a PIN) → "No staff configured" guidance + sign out, not an
  empty grid.
- Refresh while the modal is open → returns to the grid, modal closed.
- Attached keyboard → number keys enter digits, `Backspace` deletes, `Escape` dismisses.
- Long display name → truncates on the tile; the grid layout does not break.
- Tablet landscape → 100% of the roster reachable with no horizontal scroll.

## Automated verification

```bash
npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:e2e
```

E2E lives in `tests/e2e/auth.spec.ts` — the `044-US1` / `044-US2` / `044-US3` describe
blocks cover the modal flow, search, and error/cancel recovery. Target a single user
story with `npx playwright test tests/e2e/auth.spec.ts -g "044-US2"`.

Audit invariant (SC-007): one `audit_log` row per completed attempt — `staff.signed_in`
on success, `staff.pin_failed` on a wrong PIN — asserted via the per-test audit cursor
(`newAuditCursor()` / `getAuditLogRowsSince()`).

## Design-system gate

Before marking any UI task done: compare the screen side by side with
`design-system/prototypes/select-staff/Select Staff Redesign.html` (Option D), and
confirm every color, spacing, radius, shadow, and type value traces to a
`styles/tokens.css` token (Constitution I, FR-026).
