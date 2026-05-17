# Contract: UI — two-pane shell, deductions section, chips

Implementation lives across:
- `app/(studio)/services/page.tsx` — Server Component; resolves the panel mode from URL params.
- `components/lacquer/services/catalog-row.tsx` — server component; renders the deduction chips.
- `components/lacquer/services/deduction-chips.tsx` — NEW server component; the chip render.
- `components/lacquer/services/edit-panel.client.tsx` — NEW client island; the two-pane right pane.
- `components/lacquer/services/service-form.client.tsx` — extended to include `<DeductionsSection>`.
- `components/lacquer/services/deductions-section.client.tsx` — NEW client island; segmented control + supply toggle + Net preview.
- `styles/settings.css` — append the two-pane and chip rules.

All values resolve to Lacquer tokens. The chip palette (`--info` for card-fee, `--amber-500` for supply, `--secondary` + `--muted-foreground` for exempt) and the panel surface tokens (`--card`, `--border`, `--shadow-xs`) are already declared in `styles/tokens.css`.

---

## 1. Two-pane layout

### 1.1 Grid

On desktop (≥ 1024px wide viewport):

```css
.services-two-pane {
  display: grid;
  grid-template-columns: minmax(0, 440px) minmax(0, 1fr);
  gap: var(--space-18); /* 18px — matches the prototype */
  flex: 1;
  min-height: 0;
}
```

On narrower viewports (< 1024px):

```css
@media (max-width: 1023px) {
  .services-two-pane {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-12);
  }
}
```

The state machine is unchanged on narrow viewports — the panel still mounts, still updates from URL, still gates discards. It just renders **below** the list instead of beside it. No new responsive logic in the React tree; only CSS.

### 1.2 Panel container

```css
.services-edit-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-14);
  padding: var(--space-20);
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-12);
  box-shadow: var(--shadow-xs);
  min-height: 0;
  height: 100%;
}
```

The panel ALWAYS mounts so its in-grid transition (subtle opacity-only fade-in of contents on mode change, 150ms) runs reliably. There is **no fixed/absolute positioning**, no backdrop, no body-scroll lock, no Escape handler bound at the document level — confirming SC-009.

### 1.3 Panel header

- Color swatch (26px circle) using `var(${draft.color_token})`.
- Service name in `font-size: 15px; font-weight: 600; color: var(--foreground)`.
- Secondary line `{category} · {duration} min · {price label}` in `font-size: 11.5px; color: var(--muted-foreground); margin-top: 2px`.
- **No Close (X) affordance** (per Clarifications Q1 and FR-002). The header ends with the spacer; the close icon button rendered in the prototype is omitted from the implementation.

---

## 2. Panel state machine

Inherits from 008's drawer state machine, with two simplifications:

- The `mode = 'closed'` case renders an **empty-state inspector** (Info icon + headline + body copy) inside the same panel container, not an off-canvas slide.
- There is no Escape / backdrop close gesture; mode transitions are URL-driven only.

```
URL params              → Panel mode
?selected=<id>          → 'edit' (load baseline; on hydration failure, fall back to 'closed')
?adding=1               → 'add'
neither                 → 'closed'
both                    → 'edit' wins (per 008 ui.contract.md)
```

### 2.1 Transitions (operator gestures)

| Gesture | Discard guard fires when... | Action |
|---|---|---|
| Click a different list row | `currentDraft !== baseline` (or add-mode draft !== fresh) | Show `<DiscardChangesDialog>` named for the current target; on Discard, `router.push('/services?selected=<newId>')`; on Cancel, keep the current selection and unsaved draft. |
| Click "Add service" | Same condition | Show dialog named "the current service" or "the new service draft"; on Discard, `router.push('/services?adding=1')`; on Cancel, keep current selection. |
| Click Save (edit) | n/a | Submit form via `<form action={updateService}>`. On success, redirect re-baselines. |
| Click Save (add) | n/a | Submit form via `<form action={addService}>`. On success, redirect flips panel to edit for new service. |
| Click Cancel | Same condition | Show dialog; on Discard, reset draft to baseline; on Cancel, no-op. |
| Click Archive / Restore | (no guard; the operator confirmed via `<ArchiveDialog>`) | Submit form to `archiveService` / `restoreService`. |
| Browser back / forward / route change | (no guard; consistent with 008) | URL handles. |

### 2.2 Empty-state copy (mode = 'closed')

```text
[Info icon]
Pick a service
Select a service on the left to edit, or add a new one.
```

The Info icon is Lucide `Info`, 20px, color `var(--muted-foreground)`, inside a 44px `var(--muted)` circle. The headline is `font-size: 14px; font-weight: 500; color: var(--foreground); margin-bottom: 4px`. The body is `font-size: 12.5px; color: var(--muted-foreground)`. Matches FR-003 verbatim.

---

## 3. Deductions section (inside `<ServiceForm>`)

A bordered card with surface `color-mix(in oklch, var(--muted) 55%, var(--background))`, border `var(--border)`, radius `var(--radius-12)`, padding `var(--space-16)`, vertical gap `var(--space-16)`. Lives below the service-detail fields, above the (deferred) Assigned techs section.

### 3.1 Card fee row

| Element | Behavior |
|---|---|
| Heading | "Card fee" (`font-size: 13px; font-weight: 500`) + muted hint "when paid by card or gift card" (`font-size: 11px; color: var(--muted-foreground)`) |
| Segmented control | Three options: `Default · {formatDefaultCardFeeLabel()}`, `Custom`, `Exempt`. The Default label includes the rendered constant so the operator sees the current default amount inline. |
| Custom amount input | Rendered only when mode = `'custom'`. `$` prefix, 92px wide, tabular numerals, accepts `0`, `4`, `4.50`, etc. On blur, format to 2 decimals (matching the price field's behavior). Required, ≤ $50. |
| Exempt explainer | Rendered only when mode = `'exempt'`. One muted line: "Card fee never applies, regardless of payment method." (`font-size: 11.5px; color: var(--muted-foreground)`) |
| Inline validation hints | When the typed custom value exceeds $50: "Card fee can't exceed $50." When empty in custom mode: "Enter an amount up to $50." Both `font-size: 11.5px; color: var(--destructive)`. Save remains disabled until valid. |

### 3.2 Supply row

| Element | Behavior |
|---|---|
| Heading + toggle | "Supply deduction" + muted hint "any payment method"; toggle on the right (right-aligned via `justify-content: space-between`). |
| Inputs (rendered only when toggle on) | Two-column grid `grid-template-columns: 100px 1fr`; amount input `$` prefix, tabular numerals; label input placeholder `"e.g. GelX tips & gel, Chrome powder, OPI bottle wear"`. |
| First-on behavior | Toggle off → on: amount input pre-fills with `"5.00"`; label input renders empty; focus moves to the label input. (Per FR-018 — a starting nudge so the operator sees a plausible amount before typing.) |
| Off-toggle preservation | The draft buffer keeps the last-typed `supply_amount_dollars` and `supply_label` strings so a fat-finger off→on doesn't lose typing. (FR-021) |
| Character counter | Rendered when label length is within 8 chars of the 64-char limit: `font-size: 11px; color: var(--muted-foreground)` placed right-aligned under the label input. |
| Inline validation hints | Amount empty/zero/negative: "Enter a positive amount up to $50, or turn Supply off." Amount > $50: "Supply can't exceed $50." Label empty: "Add a short label so staff know what this covers, or turn Supply off." Label > 64 chars: "Label must be 64 characters or fewer." |

### 3.3 Net-to-tech preview

Placed below the supply row inside the same deductions card. Separated by a 1px `var(--border)` top border with `padding-top: var(--space-14)`.

```text
NET TO TECH (CARD)             $42
                               $50 service
                               −$3 card fee
                               −$5 GelX tips & gel
```

- Headline: `font-size: 11px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--muted-foreground); font-weight: 600; margin-bottom: 4px`.
- Amount: `font-size: 22px; font-weight: 600; letter-spacing: -0.01em; color: var(--foreground)`; **must** use tabular numerals (`font-variant-numeric: tabular-nums`).
- Breakdown: `font-size: 12px; color: var(--muted-foreground); line-height: 1.6; text-align: right; font-variant-numeric: tabular-nums`. The card-fee line in `oklch(0.45 0.13 240)` (referenced from the prototype; in implementation, this resolves to `var(--info-foreground)` or an existing semantic token — confirm in the design-system handoff before committing).
- Recomputes locally on every keystroke via `useMemo(() => computeNetToTechCents(input), [...])`.
- The breakdown line for card-fee is **omitted entirely** when `mode = 'exempt'` (not shown as `−$0`). Same for the supply line when Supply is off. The "{price} service" line always renders.
- When the inputs would produce a negative net, the amount clamps to `$0` and the breakdown still shows the raw lines (so the operator sees why the math went negative).

---

## 4. Catalog row chips

### 4.1 Render decision tree

```ts
// Pseudocode for the chip-kind helper in deduction-chips.tsx.
function pickChipKinds(s: CatalogService): ChipKind[] {
  const kinds: ChipKind[] = [];
  if (s.card_fee_mode === "default" && !s.supply_amount_cents) {
    kinds.push("card-default");
  } else if (s.card_fee_mode === "custom") {
    kinds.push("card-custom");
  }
  // (card_fee_mode === "exempt" emits no card-fee chip)

  if (s.supply_amount_cents) {
    kinds.push("supply");
  }

  if (kinds.length === 0 && s.card_fee_mode === "exempt") {
    kinds.push("exempt-no-fees");
  }

  return kinds;
}
```

(Note: `card_fee_mode === "default"` with supply present emits both `card-default` AND `supply`.)

### 4.2 Visual treatments

| Chip kind | Background | Text color | Label text |
|---|---|---|---|
| `card-default` | `color-mix(in oklch, var(--info) 12%, transparent)` | `var(--info-foreground)` or `oklch(0.45 0.13 240)` (TBD on token check) | `{formatDefaultCardFeeLabel()} card fee` |
| `card-custom` | `color-mix(in oklch, var(--primary) 14%, transparent)` | `var(--primary-foreground)` or `var(--rose-700)` | `{$amount} card fee` |
| `supply` | `color-mix(in oklch, var(--amber-500) 16%, transparent)` | `oklch(0.45 0.14 75)` (or matching `--amber-700`) | `{$amount} {label}` |
| `exempt-no-fees` | `var(--secondary)` | `var(--muted-foreground)` | `No fees` |

Each chip: `padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 500; line-height: 1.4; font-variant-numeric: tabular-nums; white-space: nowrap`. Chips render inside a `<div>` with `display: inline-flex; gap: 6px; align-items: center` placed in the row's duration/price band (matching FR-023).

### 4.3 Token discipline

The exact `oklch(...)` references taken from the prototype need to be replaced by the closest semantic token in `styles/tokens.css` before commit. If no token resolves to the right value, the design-auditor agent's audit blocks the merge per Constitution I. The fallback is to add a new `--info-700` / `--amber-700` token in `tokens.css` mirroring the Lacquer color scale — that addition itself comes from `design-system/colors_and_type.css` (no raw hex introduced).

---

## 5. Role-gated disabled state

Per FR-029, when `operatorRole !== 'owner' && operatorRole !== 'manager'`:

- The Segmented control: `aria-disabled="true"`, `tabIndex={-1}` on each option, pointer events: none.
- The Custom amount input: `disabled={true}`.
- The Supply toggle: `aria-disabled="true"`, no-op on click.
- The Supply amount input: `disabled={true}` (rendered only if supply was already on at load).
- The Supply label input: `disabled={true}` (same condition).
- The Save / Cancel / Archive footer: all `disabled={true}`.

Every disabled control carries the existing 008 tooltip `"Only owners and managers can edit the catalog."` (the `OwnerOnlyTooltip` wrapper from 008's `<ServiceForm>` is reused). The Net-to-tech preview continues to render — it's read-only by nature.

---

## 6. Toast vocabulary

No new toast verbs. The existing `changes_saved` (success), `service_added` (success), `service_archived` / `service_restored` (success), and the seven new error codes from `server-actions.contract.md § 3` are added as entries in `toasts.ts` mapping to the same Sonner variants the 008 vocabulary uses. The URL-toast bridge (`services-toaster.client.tsx`) handles the seven new error codes automatically — its switch is extended.

---

## 7. URL params consumed by the page

| Param | Type | Effect |
|---|---|---|
| `selected` | UUID | Loads the row as the panel baseline; panel renders in 'edit' mode. |
| `adding` | `"1"` | Panel renders in 'add' mode (only when `selected` is absent). |
| `toast` | one of: `service_added`, `service_restored`, `service_archived`, `changes_saved` | Bridges to Sonner via `ServicesToaster`. |
| `error` | error code | Bridges to a destructive Sonner. |
| `name` | string | Currently used by the 008 success-toast for `service_added` / `service_archived`; carried forward. |

No new params introduced.

---

## 8. Accessibility

- The Segmented control uses `role="radiogroup"` with `role="radio"` on each option; `aria-checked` reflects the active one (matches the prototype).
- The Supply toggle uses `role="switch"` with `aria-checked` (matches the existing shadcn `Switch` primitive's defaults).
- Inline validation hints are connected to their inputs via `aria-describedby`.
- Disabled controls receive `aria-disabled="true"` and the tooltip text via `aria-label` so screen readers announce the reason.
- The empty-state inspector has `role="region"` with `aria-labelledby` pointing at the headline.

---

## 9. Animation budget

| Surface | Transition | Duration | Easing |
|---|---|---|---|
| Segmented control selection | `background, box-shadow, font-weight` | 150ms | `var(--ease-out)` |
| Supply toggle | `background, transform` | 150ms | `var(--ease-out)` |
| Custom amount input reveal | opacity + height (height auto via JS only if measured) | 150ms | `var(--ease-out)` |
| Net-to-tech preview re-render | No transition; uses `font-variant-numeric: tabular-nums` to avoid layout jitter | — | — |
| Panel mode change (closed ↔ edit ↔ add) | opacity fade on inner content | 150ms | `var(--ease-out)` |
| `<DiscardChangesDialog>` show/hide | Inherits shadcn `<Dialog>` defaults | 200ms | `var(--ease-out)` |

No bounce, no spring, no scale-over-1 — matches CLAUDE.md § Design-system rule 9.

---

## 10. Mobile / narrow viewport behavior

The two-pane shell stacks (list above panel) on viewports < 1024px wide. The panel keeps its always-visible behavior. Touch-tap on a row scrolls the panel into view via `scroll-margin-top` (no JS scroll handler). The discard guard fires identically. No new state, no new components — the responsive treatment is CSS-only.
