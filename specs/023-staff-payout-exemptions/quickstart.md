# Quickstart: Per-staff payout exemptions

**Feature**: `023-staff-payout-exemptions` · **Date**: 2026-05-17

How to spin up, exercise, and visually verify this feature end-to-end. Assumes a clean local Supabase from the seed.

---

## 1. Prerequisites

1. **022 must be merged or stacked**. This feature depends on `public.supply_types` and `public.services.supply_type_id` from migration 0017. If 022 is still in PR review, work on a branch stacked on top of `022-supply-types-catalog` (this worktree already is).
2. **Local Supabase running**: `npm run supabase:start` (or whatever the standard local-DB bootstrap is in this repo).
3. **Apply migrations**: `npm run supabase:migrate` (or `supabase db reset`) — applies 0017 then 0018 in order.
4. **Seed data**: `npm run seed` — seeds the standard demo salon. Ensure the seed creates at least 4 active staff + 2 inactive staff + 3 supply types (Chrome powder, GelX tips & gel, Cat-eye gel) with 2 services each.

---

## 2. Exercising US1 — Card-fee exemption

1. Navigate to `/settings/staff` as an owner.
2. Click any active tech in the roster.
3. Confirm the edit panel renders with the new sectioned layout: Identity → Access → Pay & deductions → Save changes → Danger zone.
4. In the Pay & deductions section, confirm Card processing fee toggle is **on** and the subtitle reads `Standard $3 deducted on card-paid services.` (resolved from `formatDefaultCardFeeLabel()`).
5. Toggle Card processing fee **off**. Confirm:
   - Subtitle changes to `Exempt — card fee never deducted from payout.`
   - Panel-profile header gains a `Card-fee exempt` status badge.
   - The summary sentence renders below: `${FirstName} keeps the full payout on card-paid services — no card fee deducted.`
6. Click Save changes. Confirm a `Changes saved` toast + the page re-renders with the saved state.
7. Reload the page. Re-open the same tech. Confirm the toggle is still off, the badge is still there, and the summary is still rendered.
8. Open the audit_log (via the Supabase Studio at `http://localhost:54323`):
   ```sql
   select payload from audit_log
   where action = 'staff.updated'
   order by created_at desc limit 1;
   ```
   Confirm the payload includes:
   ```jsonc
   {
     "before": { "card_fee_exempt": false },
     "after": { "card_fee_exempt": true },
     "changes": ["card_fee_exempt"]
   }
   ```

---

## 3. Exercising US2 — Supply mode + per-type picker

1. Re-open the same tech (or pick another).
2. Confirm Supply deductions segmented control is set to `Apply all`.
3. Click `Some`. Confirm the per-type picker fades in (200ms; instant if you have `prefers-reduced-motion: reduce` enabled in your OS).
4. The picker lists every active supply type alphabetized: Cat-eye gel, Chrome powder, GelX tips & gel. Each row shows `${N} services · typically $${X} per ticket`.
5. Tick `Chrome powder`. Confirm the row is checked. Click Save changes.
6. Reload. Re-open the panel. Confirm the supply mode is still `Some`, the picker is visible, and `Chrome powder` is still ticked. Status badge: `Partial supply exemption`.
7. **Test the mode-toggle preservation rule (Clarify Q4)**: switch the segmented control to `Apply all`. Confirm the picker fades out. Switch back to `Some` — confirm `Chrome powder` is STILL ticked (draft state preserved across mode toggles).
8. Now actually save with `Apply all` selected. Reload. Confirm the supply mode is `Apply all` and the persisted `supply_except` is empty (visible in DB or by switching back to Some and confirming all checkboxes are unticked).
9. **Test archived-still-exempted UX (Clarify Q3)**: set the tech to Supply mode `Some` with `Chrome powder` ticked, save. Then in another tab, open `/services`, click "Edit policy", navigate to Supply Types, archive Chrome powder. Return to the tech's panel and reload. Confirm Chrome powder is still in the picker, still ticked, with a muted `Archived` pill next to its name. Untick it to clean up; confirm save succeeds and the row no longer appears (it was archived AND no longer exempted).
10. Confirm the audit row for the save shows `supply_mode` and `supply_except` diff entries:
    ```sql
    select payload from audit_log
    where action = 'staff.updated'
    order by created_at desc limit 1;
    ```
    Payload includes:
    ```jsonc
    {
      "before": { "supply_mode": "apply", "supply_except": [] },
      "after": { "supply_mode": "partial", "supply_except": ["<chrome-uuid>"] },
      "changes": ["supply_mode", "supply_except"]
    }
    ```

---

## 4. Exercising US3 — Summary sentence variants

For each row in this table, set the panel's draft state to the named posture and confirm the summary sentence matches:

| Card-fee exempt | Supply mode | Ticked types         | Expected summary                                                                                              |
|-----------------|--------------|----------------------|---------------------------------------------------------------------------------------------------------------|
| false           | apply        | —                    | _(no summary; section ends after the picker / segmented row)_                                                  |
| true            | apply        | —                    | `Maya keeps the full payout on card-paid services — no card fee deducted.`                                    |
| false           | exempt       | —                    | `Maya keeps the full payout on every service — no supply costs deducted.`                                     |
| true            | exempt       | —                    | `Maya keeps the full payout on every service — no card fee or supply costs deducted.`                         |
| false           | partial      | Chrome powder        | `Maya keeps the full payout on every service and is exempted from chrome-powder supply costs.`                |
| true            | partial      | Chrome powder, GelX  | `Maya keeps the full payout on card-paid services and is exempted from chrome-powder and gelx-tips-gel supply costs.` |

Then change the tech's role to `Front desk` (or pick an existing front-desk tech). Confirm with no exemptions: the section ends with the muted front-desk hint instead of a summary.

---

## 5. Exercising US4 — Filter chips

1. Reload `/settings/staff`. Confirm three chips render: `All N · Active N · Inactive N` with tabular per-status counts.
2. Confirm `Active` is selected by default (first-time visitor; or the persisted value from a prior visit).
3. Click `Inactive`. Confirm only inactive staff are visible. Click `All`. Confirm all staff visible.
4. Reload the page. Confirm the last-clicked chip is still selected.
5. Inspect `localStorage`:
   ```js
   localStorage.getItem('tn:settings:staff:filter')
   // → 'all' (or whatever you last selected)
   localStorage.getItem('tn:settings:staff:show-inactive')
   // → null (legacy key is never written)
   ```
6. With `Inactive` selected on a salon with zero inactive staff, confirm the empty state reads `No inactive staff.` (not the generic "No staff found.") with a `Switch to Active` inline link.

---

## 6. Exercising US5 — Staff row redesign

1. Confirm each active row has a small green status dot leading + the avatar + name + role on a second line + a green-tinted `Set` (or yellow `No PIN`) pill + a tabular `Added Jan 2025` date on the right.
2. Confirm inactive rows render at reduced opacity (~60%).
3. Click an inactive row. Confirm it returns to full opacity AND a left-side accent bar in `--primary` color appears flush against its left edge.
4. Resize the browser window to <900px width. Confirm the trailing date is hidden and a chevron `›` renders at the right edge of each row.

---

## 7. Exercising US6 — Panel sectioning + danger zone

1. Open any tech's panel. Confirm the panel-profile header at the top shows avatar + name + "{Role} · Added MMM YYYY" + status badges.
2. Confirm the panel scrolls top-to-bottom in this exact order: profile header → Identity card → Access card → Pay & deductions card → full-width Save changes button → Danger zone block.
3. Confirm the Danger zone has a red-tinted background distinct from the neutral identity / access / pay cards above.
4. Confirm `Deactivate` (for active) or `Reactivate` (for inactive) appears in the Danger zone, followed by `Remove from roster`. Confirm NO destructive action appears anywhere else in the panel.

---

## 8. Exercising US7 — Add-staff wizard sheet

1. Click `Add staff` from the page header (or the FAB on mobile).
2. Confirm a 420px right-side sheet slides in (300ms; instant under reduced-motion).
3. Confirm the header shows three step pills: `Details` (highlighted), `Set PIN`, `Done`.
4. Confirm the form fields render on the left + a live preview card mirrors the in-progress draft on the right.
5. Confirm the footer shows `Cancel` + `Next: set PIN` (disabled until display_name is non-empty).
6. Fill in name + role + avatar color. Watch the preview update in real time.
7. Click `Next: set PIN`. Confirm the second pill highlights, the form area replaces with a PIN input, and the footer updates accordingly.
8. Enter a 4-digit PIN, set PIN. Confirm the third pill highlights, a success state renders with the tech's preview, and a `Done` button appears.
9. Click `Done`. Confirm the sheet closes and the new tech appears in the roster.
10. Open the audit_log:
    ```sql
    select action, payload from audit_log
    where action in ('staff.added','staff.pin_set')
    order by created_at desc limit 2;
    ```
    Confirm one `staff.added` row followed by one `staff.pin_set` row, both with the new staff's id.

---

## 9. Exercising US8 — Mobile bottom sheet

1. Resize the browser to <900px width (or use device emulation).
2. Confirm the roster takes the full width and no inline panel renders alongside it.
3. Tap a staff row. Confirm a bottom sheet slides up from the bottom (300ms; instant under reduced-motion), occupying up to ~92% of viewport height.
4. Confirm body scroll is locked while the sheet is open (try scrolling the page behind the sheet — nothing should move).
5. Confirm the sheet has a drag handle at the top.
6. Tap the close button. Confirm the sheet slides down. Or swipe down past 50% of sheet height. Or tap the scrim.
7. Confirm the FAB (bottom-right, 56px circular, plus icon) is visible on mobile and absent on desktop.
8. Tap the FAB. Confirm the Add-staff wizard sheet opens (with the same content as desktop, adapted to narrow width).

---

## 10. Side-by-side design-system compare

Before claiming the UI is complete, open each side-by-side:

1. `design-system/Staff Settings.html` in a browser tab.
2. `http://localhost:3000/settings/staff` in another tab, signed in as owner.
3. Compare:
   - Roster row shape (status dot, avatar, name+role, PIN pill, date)
   - Filter chip group layout
   - Sectioned edit panel structure (Identity → Access → Pay & deductions → Save → Danger zone)
   - Pay & deductions section (toggle + segmented + picker + summary)
   - Danger zone block
   - Add-staff wizard sheet (three pills, live preview, sticky footer)
4. Every visible value MUST trace to a token. No raw hex, no off-scale spacing, no custom font weight.

---

## 11. Run the test suite

```bash
# Local sanity (cheap gates first):
npm run format:check
npm run lint
npm run typecheck

# Unit tests:
npm test

# E2E (specific to this feature):
npx playwright test tests/e2e/staff-payout-exemptions.spec.ts
npx playwright test tests/e2e/staff.spec.ts  # update assertions in this run

# Full gate set (final pre-push):
npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:e2e
```

All five MUST be green before claiming the feature complete (Constitution v1.0.3 § Development Workflow & Quality Gates).

---

## 12. Common gotchas

- **Tests fail with "supply_except contains an id not present in supply_types"**: 022's migration didn't seed the supply_types catalog. Re-run `npm run supabase:migrate` and confirm 0017 ran successfully before 0018.
- **Panel doesn't show Pay & deductions section**: confirm `_supply-catalog.ts` is exported and `loadSupplyCatalogForStaff(target.id)` is being called in the page Server Component. The section requires the catalog prop.
- **Filter chip doesn't persist**: confirm you're testing in a real browser (not incognito with localStorage disabled). The chip writes to `tn:settings:staff:filter` — inspect via DevTools → Application → Local Storage.
- **Mobile bottom sheet doesn't open**: confirm the viewport is actually <900px. Browser DevTools' device-emulation mode is the easiest way to test (cmd-shift-M in Chrome).
- **Reduced-motion not honored**: confirm your OS setting is actually on (macOS → System Settings → Accessibility → Display → Reduce motion). The CSS `@media (prefers-reduced-motion: reduce)` block is active only when the OS reports it.
