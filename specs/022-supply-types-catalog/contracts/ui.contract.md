# UI Contract — Supply types catalog

**Feature**: `022-supply-types-catalog` · **Date**: 2026-05-17 · **Authority**: `design-system/prototypes/services/EditPolicySheet.jsx` · `data-model.md § 2.1` · `research.md § R4, R9`

Three UI surfaces: the `<EditPolicySheet>` shell, the `<SupplyTypesSection>` inside it, and the `<SupplyTypePicker>` on the service edit panel. All three reuse shadcn primitives only — `Sheet`, `Popover`, `Command`, `Button`, `Input`. No new component library.

---

## 1. `<EditPolicyButton>` — page-header trigger

**File**: `components/lacquer/services/edit-policy-button.tsx` (server component shell) + `edit-policy-button.client.tsx` (client island for the open-state).

**Renders**: a secondary `<Button>` next to the existing "Add service" button in `<PageHeader>`. Label: "Edit policy". Icon: `Sliders` (Lucide, 16px, 1.5px stroke). Disabled state for non-privileged operators with the existing `<OwnerOnlyTooltip>` wrapper.

**State**: `open: boolean` (managed in the client island). Opening it mounts `<EditPolicySheet open onOpenChange={…}>`.

**URL bridge**: when `?policy=open` is in the URL on page render, the button opens the sheet automatically. This lets the catalog Server Actions return the operator to a still-open sheet after a mutation (`/services?policy=open&toast=supply_type_renamed`). The bridge removes the param on close so refreshing closed surfaces don't re-open. Mirrors the 008 `?selected=<id>` URL-state pattern.

---

## 2. `<EditPolicySheet>` — shell

**File**: `components/lacquer/services/edit-policy-sheet.client.tsx`

**Composition**: standard shadcn `Sheet` with `side="right"`, `className="w-[min(440px,100vw-16px)]"`. Header: title "Edit policy", subtitle from prototype line 640 ("Card-fee defaults and the supply-deduction catalog that apply across your whole menu. Per-service settings can still override these. Per-tech exemptions live in Staff Settings."), close X button (top-right). Body: scrollable; renders only `<SupplyTypesSection>` this phase (per research § R9). Footer: omitted this phase (no Save / Cancel — the Supply Types section persists each mutation independently via its own actions).

**Animation budget**: 220ms entry / 180ms exit, `ease-out-expo`. Matches the prototype's `useMountAnim(220)` and the Constitution's 300ms sheets/dialogs ceiling.

**Keyboard**: Esc closes (shadcn `Sheet` default). Click on scrim closes. Focus traps on the close button when no other focusable child is mounted (shadcn default).

**Props**:

```ts
type EditPolicySheetProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  catalog: SupplyTypesCatalog;   // from loadSupplyTypesCatalog()
};
```

The `catalog` prop is loaded server-side and passed in by `<ServicesPage>` — the sheet is a pure presentational consumer.

---

## 3. `<SupplyTypesSection>` — the only content this phase

**File**: `components/lacquer/services/supply-types-section.client.tsx`

**Reference**: `design-system/prototypes/services/EditPolicySheet.jsx` lines 299–556. Adapt — do not redraw.

**Layout** (top to bottom inside the sheet body):

1. **Section header** — `Box` Lucide icon (15px) + title "Supply types" + hint paragraph from prototype line 352–356: "The catalog of supply costs the salon can deduct. Each service supply references a type by id, so renaming here updates everywhere — including tech-level exemptions in **Settings → Staff**."

2. **Active types group** — bordered card (`border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--card); overflow: hidden`). Each row is a flex/grid with three columns:
   - **Name** — click-to-rename. Default state: 13px, weight 500, color `--foreground`. Inline edit state: `<input>` with `border: 1px solid var(--ring); border-radius: var(--radius-sm)`.
   - **Usage count badge** — pill (`background: var(--muted); border-radius: 999px; padding: 2px 8px; font-size: 11px; color: --muted-foreground`). Copy: "N services" or "Unused" when zero. Tabular numerals via the existing `.tnum` class.
   - **Archive button** — outline button (`border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 4px 8px; font-size: 11px`). Disabled with tooltip when usage_count > 0; tooltip copy: "Remove this type from the N services that use it first." When enabled, clicking it calls `archiveSupplyType` directly (no confirm dialog — single-row mutation, reversible via reactivate).

3. **Expandable sub-rows** — when a type row's usage_count > 0, an arrow-right chevron at the right edge toggles expansion. Expanded state reveals a sub-list with indented rows, one per referencing service:
   - 8px color dot (`background: var(${color_token}); border-radius: 50%`)
   - service name (12px, color `--foreground`)
   - supply amount as `−$X.XX` in `oklch(0.45 0.14 75)` (this token is the existing "amber-700" tone the prototype uses — already in `tokens.css`)
   - `ArrowRight` icon (12px, color `--muted-foreground`)
   - Click anywhere on the sub-row: closes the sheet + navigates to `/services?selected=<service_id>` (the existing services URL bridge pre-selects the row).

4. **Add row** — at the bottom of the active group:
   - **Default state**: full-width transparent button with `Plus` icon + "Add supply type" in `--rose-700` (matches prototype line 540). Tabbable.
   - **Editing state**: muted-background row with `<input placeholder="e.g. Builder gel, Polygel">` + primary "Add" button (disabled until trimmed length ≥ 2) + ghost "Cancel" button. Enter commits; Escape cancels.
   - Submit calls `createSupplyType({ name })` (the form-based shape from `server-actions.contract.md § 1a`) — the redirect lands on `/services?policy=open&toast=supply_type_created&name=…` so the sheet stays open and the toast fires.

5. **Archived types group** (rendered only when `archived.length > 0`) — muted-background variant of the same card. Each row shows the name + usage_count (still 0 by definition for archived) + "Reactivate" button (outline). Reactivate calls `reactivateSupplyType` directly; on `name_taken`, the redirect's `?error=name_taken` is surfaced as an inline hint under the row ("This name is taken by an active type. Rename one first.").

6. **Footer tip** (small text below the active card): "Tip: click a name to rename. Types in use can't be archived until you reassign or remove the services that reference them." (From prototype line 552.)

**State**:

```ts
type EditingState =
  | { kind: "idle" }
  | { kind: "rename"; id: string; name: string }
  | { kind: "create"; name: string };

type ExpansionState = Set<string>; // type ids currently expanded
```

**Empty state**: when both `active` and `archived` are empty (fresh install), render the empty card with just the "Add supply type" row at the top. Section header copy unchanged.

**Keyboard map**:

| Surface         | Key       | Action                                                |
|-----------------|-----------|-------------------------------------------------------|
| Type name       | Enter     | Click to rename → focuses the inline input            |
| Inline rename   | Enter     | Commit (calls `renameSupplyType`)                     |
| Inline rename   | Escape    | Cancel — restores prior name, no submit               |
| Add row input   | Enter     | Commit (calls `createSupplyType`)                     |
| Add row input   | Escape    | Cancel — closes the editing state                     |
| Expanded sub-row| Enter     | Activate — closes sheet + navigates to service        |

---

## 4. `<SupplyTypePicker>` — service edit panel

**File**: `components/lacquer/services/supply-type-picker.client.tsx`

**Composition**: shadcn `Popover` (trigger = the picker's resting button) + `Command` (dropdown content). The trigger button renders the selected type's name (or "Pick a supply type" empty placeholder) with a `ChevronDown` icon. The dropdown contains:

1. `CommandInput` placeholder "Search supply types…" (Command's built-in client-side filter).
2. `CommandList` rendering each active type as a `CommandItem` with the name + `Check` icon for the selected row.
3. A pinned `CommandItem` at the bottom: `<PlusCircle> Create new supply type…`. When activated, the dropdown content swaps to a tiny inline form (single `<Input>` + Save / Cancel buttons).

**Inline-create flow** (research § R4) — **programmatic, NOT a nested form**:

The picker renders inside the outer service `<form>`. Nested `<form>` elements are invalid HTML, and a redirect-based round-trip would clobber any other in-progress form fields the operator typed (e.g., price, duration, name). The inline-create therefore uses React 19's `useActionState` hook against the JSON-returning shape of the action (`createSupplyTypeForPicker`, documented in `server-actions.contract.md § 1b`) — **no nested `<form>`, no redirect, no URL bridge**.

```ts
// Inside <SupplyTypePicker> (sketch — actual prop wiring in T028):
const [state, formAction, pending] = useActionState(
  createSupplyTypeForPicker,
  { kind: "idle" } as CreateResult
);

useEffect(() => {
  if (state.kind === "ok") {
    onSelect(state.id);              // commit selection in the outer form's draft buffer
    router.refresh();                // re-fetch the page's RSC so the catalog list contains the new row
    setInlineMode("idle");           // collapse the inline-create back to the dropdown
  }
}, [state]);
```

1. Operator activates the "+ Create new supply type…" row.
2. Dropdown content swaps to the inline create UI (a plain `<div>` — NOT a `<form>`): single `<Input>` + Save / Cancel buttons. Save is a `<button onClick={() => formAction(formDataFromInput)}>` (programmatic dispatch via `useActionState`'s returned `formAction`), NOT `type="submit"` inside a nested form.
3. Operator types a name; on submit (Enter handler or Save click), the picker calls `formAction(formData)` with `name` only.
4. `useActionState`'s state transitions through `{ kind: 'idle' }` → (pending) → `{ kind: 'ok', id, name }` or `{ kind: 'error', code }`.
5. On `'ok'`: the effect calls `onSelect(state.id)` to commit the new id into the outer service form's draft buffer, `router.refresh()` to invalidate the RSC cache (so the catalog list re-renders with the new row included), and collapses the inline-create back to the dropdown. The outer service form's other fields are untouched.
6. On `'error'`: render the inline copy from `toasts.ts`'s error map next to the input (no redirect, no toast in the URL).
7. The operator continues setting the amount and saves the service form as normal — all in one page load, no navigation.

**Soft hint on collision (US1 AC3)**: while the operator is typing in the inline-create form, the picker locally canonicalizes the typed name (via `canonicalizeName`) and checks the catalog for a match. If a match is found, the Save button is replaced with a muted "Select existing" button + the hint copy "A supply type with this name already exists — selecting it instead". Activating "Select existing" closes the picker with the existing type selected, no Server Action call. (The Server Action's `name_taken` error is the defense-in-depth path for the race; the soft hint handles the common case without a round-trip.)

**Picker hidden form field**: when `supply_on` is true, the picker emits `<input type="hidden" name="supply_type_id" value={selectedId ?? ''}>` inside the parent `<form>`. When `supply_on` is false, the picker doesn't emit the hidden input (the Server Action interprets a missing field as null). Mirrors the 021 pattern for `supply_label` exactly.

**Disabled state**: when `assertCanWriteCatalog` would reject the operator (technician / front-desk), the trigger button is disabled with `<OwnerOnlyTooltip>`. The dropdown never opens, so the inline-create row is never reachable.

**Props**:

```ts
type SupplyTypePickerProps = {
  /** Active types, alphabetically sorted by name. Archived types are filtered out by the loader. */
  types: SupplyTypeLite[];
  /** Current selected id (null when supply is on but no type has been picked yet). */
  selectedId: string | null;
  /** Called by the inline-create flow on success — the parent form's draft buffer
   *  updates so the picker re-renders with the new selection. */
  onSelect: (id: string) => void;
  /** Disabled when the operator can't write the catalog. */
  disabled?: boolean;
  /** Service id when editing an existing service; null when adding a new service.
   *  Retained for future deep-link / debugging use; the inline-create flow does NOT
   *  use it (the flow is fully local via useActionState — no redirect, no URL bridge). */
  serviceId: string | null;
};
```

---

## 5. Token usage — token-to-property map

| Surface                              | Token                          | Property                |
|--------------------------------------|--------------------------------|--------------------------|
| Sheet background                     | `--background`                 | bg                      |
| Sheet header text                    | `--foreground`                 | text                    |
| Sheet hint text                      | `--muted-foreground`           | text                    |
| Section card border                  | `--border`                     | border                  |
| Section card bg                      | `--card`                       | bg                      |
| Inline-rename input border (active)  | `--ring`                       | border                  |
| Usage-count badge bg                 | `--muted`                      | bg                      |
| Usage-count badge text               | `--muted-foreground`           | text                    |
| Archive button border                | `--border`                     | border                  |
| Archive button text                  | `--muted-foreground`           | text                    |
| Add row text + plus icon             | `--rose-700`                   | text                    |
| Add row primary "Add" bg             | `--primary`                    | bg                      |
| Add row primary "Add" text           | `--primary-foreground`         | text                    |
| Expanded sub-row hover bg            | `color-mix(in oklch, var(--muted) 50%, var(--background))` | bg |
| Expanded sub-row amount text         | `oklch(0.45 0.14 75)`          | text (existing amber-700 token alias used in prototype line 473) |
| Picker trigger border                | `--input`                      | border                  |
| Picker selected check icon           | `--primary`                    | color                   |
| Picker disabled tooltip              | (existing `OwnerOnlyTooltip`)  | n/a                     |

All values resolve to declared tokens in `styles/tokens.css`. No raw hex, no off-scale spacing, no font weight outside 400/500/600.

---

## 6. Side-by-side acceptance check

Before claiming UI complete (per CLAUDE.md "When you change UI"):

1. Render `design-system/prototypes/services/EditPolicySheet.jsx` via `design-system/preview/EditPolicySheet.html` (if present) or by running the existing prototype preview server.
2. Open `/services` in the running dev server, click "Edit policy".
3. Visually compare the Supply Types section side-by-side. Confirm:
   - Section header / hint copy matches.
   - Active-type row layout matches (name + badge + archive).
   - Inline-rename / inline-create flows look the same.
   - Expanded sub-row indentation, color dot, amount color, arrow icon match.
   - Add-row affordance (rose text + plus icon, transitions to inline form on click) matches.
4. Open a service edit panel, toggle Supply on, click the picker. Confirm dropdown layout matches the prototype's `SupplyTypePicker` (lines outside the section in the prototype — separately referenced).

Anything that doesn't trace to a token is a failed gate.
