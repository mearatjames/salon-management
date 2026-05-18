# Contract: UI — Settings → Staff redesign

**Feature**: `023-staff-payout-exemptions` · **Date**: 2026-05-17

The UI contract for every redesigned and net-new component this feature ships. Pins down state machines, interaction grammar, and the design-token surfaces that must match. Implementation MUST match this contract.

---

## 1. `<PayDeductionsSection>` — pay-deductions-section.client.tsx

The new section card inside the edit panel. Owns no persisted state — its props feed the draft state owned by `<EditPanel>`.

### 1.1 Props

```ts
type PayDeductionsSectionProps = {
  target: {
    role: StudioRole;
    display_name: string;
  };
  draft: {
    card_fee_exempt: boolean;
    supply_mode: 'apply' | 'partial' | 'exempt';
    supply_except: readonly string[];
  };
  onDraftChange: (next: Partial<PayDeductionsSectionProps['draft']>) => void;
  supplyCatalog: {
    types: readonly {
      id: string;
      name: string;
      archived: boolean;
      service_count: number;
      sample_amount_cents: number | null;
    }[];
  };
};
```

### 1.2 Layout

```text
Pay & deductions [section title]
  ┌─────────────────────────────────────────────┐
  │ Card processing fee                  [⚪]    │
  │ <subtitle resolved live>                     │
  ├─────────────────────────────────────────────┤
  │ Supply deductions                            │
  │ <subtitle resolved live>                     │
  │  ┌─── ToggleGroup ──────────────────┐       │
  │  │ Apply all │ Some │ Exempt        │       │
  │  └────────────────────────────────────┘       │
  │  ▾ Per-type picker (only when 'partial')     │
  │    ┌─────────────────────────────┐           │
  │    │ ☐ Chrome powder  · 3 services │         │
  │    │ ☐ GelX tips     · 5 services │         │
  │    │ ☐ Cat-eye gel   · Unused     │         │
  │    └─────────────────────────────┘           │
  │  ⊕ (Hint or summary sentence)                │
  ├─────────────────────────────────────────────┤
  │ Summary sentence (only when ≥1 exemption)    │
  └─────────────────────────────────────────────┘
```

Section is a single card with three regions separated by dividers. The summary sentence at the bottom only renders when `card_fee_exempt === true` OR `supply_mode !== 'apply'`. When neither is true AND role === 'front_desk', the front-desk hint renders in place of the summary.

### 1.3 Card-fee toggle subtitle copy

Resolved live (research § R10):

- Toggle on, draft.card_fee_exempt === false: `Standard ${formatDefaultCardFeeLabel()} deducted on card-paid services.`
- Toggle off, draft.card_fee_exempt === true: `Exempt — card fee never deducted from payout.`

The `formatDefaultCardFeeLabel()` helper is imported from `@/lib/services/card-fee-default` (existing from 021). Per Clarify Q5 the value is resolved at render time, NOT hardcoded.

### 1.4 Supply-mode segmented control + subtitle copy

`<ToggleGroup type="single" value={draft.supply_mode}>` with three `<ToggleGroupItem>`s: `apply`, `partial`, `exempt`. Width: each item ~120px, equal width. Style: rounded-pill segmented (matches prototype's segmented controls; same primitive as `_DeductionsSection` in 021).

Subtitle copy:

- `apply`: `All supply costs deducted from payout.`
- `partial`: `Only the supply types you select below are exempt from this tech's payout.`
- `exempt`: `Exempt — no supply costs deducted.`

### 1.5 Per-type picker

Only renders when `draft.supply_mode === 'partial'`. Animation: 200ms fade-in (instant under `prefers-reduced-motion`).

Rows from `supplyCatalog.types`. Per Clarify Q3, archived rows that are in `draft.supply_except` MUST still render (ticked, with an "Archived" muted pill, tickable so the operator can untick to clean up). The catalog helper already returns these rows; the picker just renders them as-is.

Each row:

```text
┌─────────────────────────────────────────┐
│ ☑ Chrome powder    [Archived]            │  ← name + archived pill if archived
│   3 services · typically $2 per ticket   │  ← usage hint
└─────────────────────────────────────────┘
```

Usage hint copy:

- `service_count > 0`: `${service_count} services · typically $${formatCents(sample_amount_cents)} per ticket`
- `service_count === 0`: `Unused — no services reference this type yet.`

(The catalog query ensures `sample_amount_cents` is non-null whenever `service_count > 0`.)

Empty-list state (when `supplyCatalog.types.length === 0`):

```text
┌─────────────────────────────────────────┐
│ No supply types defined yet.             │
│ Add some on the Services page first.    │  ← inline link to /services
└─────────────────────────────────────────┘
```

Empty-selection hint (when `supply_mode === 'partial'` AND `supply_except.length === 0` AND `supplyCatalog.types.length > 0`):

Renders below the picker:

```text
No supply types selected — all costs will be deducted normally until you tick at least one.
```

(Warns the operator that "Some + empty" effectively behaves like "Apply all" at save time.)

### 1.6 Mode-toggle draft preservation rule (Clarify Q4)

Per Clarify Q4 and data-model § 4.1, switching `supply_mode` between `apply` / `partial` / `exempt` MUST NOT wipe the per-type ticks in the panel's draft state. The picker visibility toggles but the `draft.supply_except` array is preserved across mode changes. Only the SAVE-time wipe (server-side, per server-actions contract § 1.2) actually clears the persisted set.

Implementation: `onDraftChange({ supply_mode: nextMode })` — passes ONLY the mode, never touches `supply_except`. The picker is `display: none`-hidden when not partial; its checkbox values are preserved in the React draft state.

### 1.7 Summary sentence (`formatSummary` helper)

Pure helper in `_summary.ts`:

```ts
export function formatSummary({
  firstName,
  cardExempt,
  supplyMode,
  exemptedTypeNames,
}: {
  firstName: string;
  cardExempt: boolean;
  supplyMode: 'apply' | 'partial' | 'exempt';
  exemptedTypeNames: readonly string[]; // resolved names from the catalog
}): string | null;
```

Five posture variants per spec US3:

| `cardExempt` | `supplyMode` | Output                                                                                                              |
|--------------|--------------|---------------------------------------------------------------------------------------------------------------------|
| false        | apply         | `null` (no summary)                                                                                                  |
| true         | apply         | `${firstName} keeps the full payout on card-paid services — no card fee deducted.`                                  |
| false        | exempt        | `${firstName} keeps the full payout on every service — no supply costs deducted.`                                   |
| true         | exempt        | `${firstName} keeps the full payout on every service — no card fee or supply costs deducted.`                       |
| false        | partial       | `${firstName} keeps the full payout on every service and is exempted from ${list} supply costs.`                    |
| true         | partial       | `${firstName} keeps the full payout on card-paid services and is exempted from ${list} supply costs.`               |

Where `${list}` is the comma-separated lowercase names of exempted types (e.g. "chrome-powder, cat-eye-gel"). Empty list → uses "no" as placeholder: "is exempted from no supply costs" — but in practice the panel will render the front-desk hint or no summary at all in this case (empty list + supply_mode === 'partial' triggers the empty-selection-hint, not the summary).

### 1.8 Front-desk hint (replaces summary)

When `target.role === 'front_desk'` AND no exemption is in effect:

```text
Front desk staff don't take services, so these settings normally don't affect their payouts. Configure if they occasionally cover service tickets.
```

Rendered in place of the summary (since there's nothing to summarize). The Pay & deductions section is fully editable for front-desk; the hint is informational.

---

## 2. `<RosterFilterChips>` — roster-filter-chips.client.tsx

The new chip group replacing the show-inactive `<Switch>`.

### 2.1 Props

```ts
type RosterFilterChipsProps = {
  counts: {
    all: number;
    active: number;
    inactive: number;
  };
  // No `value` prop — the component owns its localStorage-backed state.
  onChange: (filter: 'all' | 'active' | 'inactive') => void;
};
```

`counts` come from the page Server Component (computed from the roster snapshot — see `app/(studio)/settings/staff/page.tsx` extension).

### 2.2 Layout

```text
┌──────────────────────────────────────────┐
│ [All 6]  [Active 4]  [Inactive 2]        │
└──────────────────────────────────────────┘
```

Three chips in a horizontal row. Each chip: rounded-pill, ~80px wide, 32px tall, tabular-numeral count.

### 2.3 Persistence rule (Clarify-deferred + research § R4)

Storage key: `tn:settings:staff:filter`. Storage backend: `localStorage`. Default for first-time visitors: `'active'`.

SSR render uses the default; post-mount `useEffect` reads localStorage and rehydrates if persisted value differs.

The legacy key `tn:settings:staff:show-inactive` is NEVER read. Implementation MUST NOT include a migration shim — first-time-after-upgrade visitors get the new default.

### 2.4 Empty-state copy (FR-020)

When the selected chip has zero matches:

- `all` (zero total staff): `No staff in this salon yet.` + Add staff CTA.
- `active` (zero active, ≥1 inactive): `No active staff.` + inline "[Switch to Inactive]" link.
- `inactive` (zero inactive, ≥1 active): `No inactive staff.` + inline "[Switch to Active]" link.

The empty-state component (`empty-state.tsx`) is edited to accept the active filter as a prop and render context-appropriate copy + inline link.

---

## 3. `<StaffRow>` — staff-row.tsx (edited)

The redesigned roster row. Server component (no state).

### 3.1 Props

```ts
type StaffRowProps = {
  staff: RosterStaff; // includes the 3 new fields, but the row only reads `active`, `pin_set`, `display_name`, `role`, `color_token`, `created_at`
  isSelected: boolean;
};
```

The row does NOT display exemption status — exemption badges live in the panel header only (spec US1 #2 explicitly: "the row in the roster gains no visible change … exemptions are a panel-only concern at the row level").

### 3.2 Layout (desktop ≥900px)

```text
┌─────────────────────────────────────────────────────────────────────┐
│ ● 👤 Maya Reyes              [Set]            Added Jan 2025          │
│   Technician                                                          │
└─────────────────────────────────────────────────────────────────────┘
```

- Leading bullet: status dot (`<StatusDot active={staff.active}>`)
- Avatar: existing `<StaffAvatar>`
- Two-line name+role
- PIN pill: success-tinted "Set" when `pin_set === true`; warning-tinted "No PIN" when false
- Trailing date: `Added MMM YYYY` (tabular-numeral, format via existing `lib/time/*` helpers)

### 3.3 Layout (mobile <900px)

```text
┌─────────────────────────────────────────────────────────────────────┐
│ ● 👤 Maya Reyes              [Set]                                ›   │
│   Technician                                                          │
└─────────────────────────────────────────────────────────────────────┘
```

The added-date is hidden (`display: none` via @media); a chevron renders at the right edge.

### 3.4 Inactive opacity

When `staff.active === false`, the entire row renders with `opacity: 0.6`. When `isSelected === true`, the opacity returns to 100% for focus.

### 3.5 Selected accent bar

When `isSelected === true`, a 3px-wide left accent bar in `--primary` color renders flush against the row's left edge. Implementation: a `::before` pseudo-element with `position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--primary);`.

### 3.6 No design-system value escapes

Every value (background, border, radius, padding, font weight, dot color, pill color, opacity, accent bar width) MUST resolve to a token. No raw hex, no off-scale spacing, no custom font weights.

---

## 4. `<EditPanel>` — edit-panel.client.tsx (edited)

Restructured into four section cards + danger zone block.

### 4.1 Vertical structure (top-to-bottom)

1. **Panel-profile header** (avatar + name + "{Role} · Added MMM YYYY" + status badges)
2. **Identity card** (display_name, role select, avatar color picker)
3. **Access card** (Active toggle row + PIN row)
4. **Pay & deductions card** (`<PayDeductionsSection>`)
5. **Save changes** (full-width primary button, inside its own panel-section wrapper)
6. **Danger zone** (`<DangerZone>`)

Sections 2–4 are separate `<section className="staff-panel-section">` cards with consistent token-based radii, padding, and dividers. The Save changes button is in its own section wrapper so it visually anchors the "form" portion of the panel above the Danger zone.

### 4.2 Status badges (live, derived from draft)

Per research § R10 and FR-016, the panel-profile header's badges derive client-side from the current draft state (not the persisted target snapshot). Badges:

- Always: `Active` (success) or `Inactive` (muted).
- When `draft.card_fee_exempt === true`: `Card-fee exempt`.
- When `draft.supply_mode === 'exempt'`: `Supply-exempt`.
- When `draft.supply_mode === 'partial'`: `Partial supply exemption`.

When both `card_fee_exempt === true` AND `supply_mode === 'exempt'`, both badges render (or implementations MAY combine into a single `No deductions` badge — both are spec-acceptable).

### 4.3 Discard-changes confirmation

Unchanged from 006. The existing `<ConfirmDialog>` triggers when the operator selects a different row with unsaved changes.

---

## 5. `<DangerZone>` — danger-zone.client.tsx (new)

The danger-zone block at the bottom of the panel.

### 5.1 Layout

```text
┌──────────────────────────── Danger zone ────────────────────────────┐
│  ⚠  Deactivate this staff member.                       [Deactivate] │
│      (or)                                                            │
│  ⚡  Reactivate this staff member.                       [Reactivate] │
│  ──────────────────────────────────────────────────────────────────  │
│  🗑  Remove from roster permanently.                    [Remove…]    │
└──────────────────────────────────────────────────────────────────────┘
```

Red-tinted background (token: `--destructive` family). Two rows: lifecycle (Deactivate XOR Reactivate based on target's `active` state) + Remove. The existing `<ConfirmDialog>` is reused for both actions.

### 5.2 No other destructive actions in the panel

Spec FR-028: "No destructive action MUST appear elsewhere in the panel." Implementation MUST NOT render Deactivate / Reactivate / Remove buttons outside the `<DangerZone>` block.

---

## 6. `<StaffMobileSheet>` — staff-mobile-sheet.client.tsx (new)

Mobile-only bottom-sheet wrapper around `<EditPanel>`.

### 6.1 Trigger

On mobile (CSS @media (max-width: 899px)), tapping a staff row dispatches a route push to `?selected=<id>`. The page Server Component renders the panel inline (as on desktop). On mobile, the inline panel is `display: none`-hidden and the same panel content renders inside `<Sheet side="bottom">` with `open={selectedId !== null}`.

### 6.2 Sheet properties

- `side="bottom"` (shadcn primitive)
- `max-height: 92vh` (per FR-031)
- Body scroll lock: handled by the Radix primitive (research § R6)
- Drag handle at top: per FR-031 — implemented as a 4px × 40px rounded bar in `--muted-foreground` color, centered horizontally
- Dismissal: tap the scrim, tap the close icon in the header, or swipe down past a threshold (50% of sheet height)

### 6.3 Animation

300ms ease-out slide-up on open. Instant transition under `prefers-reduced-motion: reduce` (per research § R7 / Clarify Q2).

---

## 7. `<StaffFAB>` — included inline in staff-table.client.tsx (no separate file)

Mobile-only floating action button.

### 7.1 Layout

Fixed position, bottom-right, ~16px from screen edges. Circular, 56px diameter. Primary background. Lucide `Plus` icon (24px, 1.5px stroke).

### 7.2 Behavior

Tapping opens the same Add-staff wizard sheet from `<AddStaffWizard>` (with `side="right"` on desktop, `side="bottom"` on mobile — sheet primitive handles both).

### 7.3 Visibility

`display: none` on desktop; `display: flex` on mobile (max-width: 899px).

---

## 8. `<AddStaffWizard>` — add-staff-wizard.client.tsx (edited)

Redesign to wizard-pills layout per spec US7. The underlying state machine + actions are unchanged.

### 8.1 Layout

```text
┌────────────── Add staff ──────────────────────────── × ────┐
│                                                              │
│  [Details]   ●  [Set PIN]  ○  [Done]  ○                     │  ← wizard pills (3 steps)
│                                                              │
│  ┌─────────────────┐  ┌──────── Preview ────────────┐       │
│  │ Display name    │  │   ●                           │       │
│  │ [           ]   │  │   Maya R.                    │       │
│  │                 │  │   Technician                 │       │
│  │ Role            │  │                              │       │
│  │ [Technician ▾]  │  └──────────────────────────────┘       │
│  │                 │                                          │
│  │ Avatar color    │                                          │
│  │ [colorpicker]   │                                          │
│  └─────────────────┘                                          │
│                                                              │
├──────────────────────────────────────── footer ─────────────┤
│  [Cancel]                          [Next: set PIN]           │  ← sticky footer
└──────────────────────────────────────────────────────────────┘
```

### 8.2 Step pills

Three rounded pills connected by horizontal lines (active pill highlighted in primary, completed pill checked, future pills muted). Labels: `Details`, `Set PIN`, `Done`.

### 8.3 Live preview card

Mirrors the in-progress draft in real time — name + role + avatar color all reflected. Component is internal to AddStaffWizard; consumes the same draft state as the form fields.

### 8.4 Sticky footer

Two-button footer at the bottom of the sheet: `Cancel` (left) + a step-aware primary action (right). Primary label per step:

- Details step: `Next: set PIN` (disabled until display_name is non-empty)
- Set PIN step: `Set PIN` (disabled until PIN is 4 digits)
- Done step: `Done` (closes sheet)

### 8.5 Server actions unchanged

`addStaff(formData)` fires on Details → Set PIN transition (creates the staff row). `setStaffPin(formData)` fires on Set PIN → Done transition. Cancel mid-wizard after staff creation leaves the partial record with "No PIN" pill (existing 006 behavior).

---

## 9. CSS scope

All new selectors land in `styles/settings.css`:

- `.staff-row-redesigned*`, `.staff-status-dot*`, `.staff-pin-pill*` — for `<StaffRow>` and `<StatusDot>`.
- `.staff-filter-chips*` — for `<RosterFilterChips>`.
- `.staff-panel-section*`, `.pay-deductions-section*`, `.staff-panel-profile*`, `.staff-panel-badges*` — for the sectioned `<EditPanel>` + `<PayDeductionsSection>` + `<StatusBadges>`.
- `.danger-zone*` — for `<DangerZone>`.
- `.staff-mobile-sheet*`, `.staff-fab*` — for the mobile layout.
- `.add-staff-wizard-pills*`, `.add-staff-preview*`, `.add-staff-footer*` — for the wizard redesign.

Every selector value MUST resolve to a Lacquer token. No raw hex, no off-scale spacing, no custom font weight.

---

## 10. Reduced-motion handling

A single `@media (prefers-reduced-motion: reduce)` block in `styles/settings.css` scopes the mobile bottom sheet, wizard sheet, and per-type picker fade-in to `transition-duration: 0ms; animation-duration: 0ms`. Per research § R7.

The filter chips, status badges, and inline form interactions remain animation-free in both modes (no transition to scope).

---

## 11. Component file boundaries

Implementation MUST place new components at these exact paths:

| Component | File | Server / Client |
|---|---|---|
| `<PayDeductionsSection>` | `components/lacquer/staff/pay-deductions-section.client.tsx` | Client |
| `<RosterFilterChips>` | `components/lacquer/staff/roster-filter-chips.client.tsx` | Client |
| `<StatusDot>` | `components/lacquer/staff/status-dot.tsx` | Server (pure) |
| `<StatusBadges>` | `components/lacquer/staff/status-badges.tsx` | Server (pure) |
| `<DangerZone>` | `components/lacquer/staff/danger-zone.client.tsx` | Client |
| `<StaffMobileSheet>` | `components/lacquer/staff/staff-mobile-sheet.client.tsx` | Client |

Edited components stay at their existing paths.
