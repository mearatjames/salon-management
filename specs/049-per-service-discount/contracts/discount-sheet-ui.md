# Contract: DiscountSheet UI surface (per-service scope)

**Feature**: `049-per-service-discount` | **Date**: 2026-05-22 | **Source spec**:
[../spec.md](../spec.md)

This contract governs the operator-facing surfaces this feature touches:

1. The Add/Edit discount sheet (`components/lacquer/checkout/discount-sheet.tsx`).
2. The cart row label for a discount line.
3. The receipt + past-transaction line list.

It does **not** redefine the discount sheet's existing visual shell — that
comes from the design system (Constitution Principle I). It defines the
new control's shape, the disabled-state rules, and the data slots that
e2e tests target.

## 1 — DiscountSheet: new "Applies to" control

### Open mode (add vs. edit)

- **Add mode** (caller: cart's "Add discount" button) — sheet opens with
  `shape='flat'`, `amount=''`, `note=''`, scope=`all-services`.
- **Edit mode** (NEW caller: cart row "Edit" affordance on a discount line)
  — sheet opens prefilled with the row's current shape/value/note/scope.

The sheet's props grow one field:

```ts
export type DiscountSheetProps = {
  /** Service lines in the current cart, the picker's source. */
  serviceLines: ReadonlyArray<{
    /** ticket_items.id (persisted) or clientLineId (ephemeral) — the same
     *  id the cart stores and the server addresses by. */
    id: string;
    /** Display name + price for the picker chip. */
    name: string;
    unitPriceCents: number;
    /** Variable-price service whose price hasn't been confirmed yet.
     *  Targeting allowed (Edge case in spec), but the cart total will
     *  show the discount contributing $0 until the price is set. */
    priceUnconfirmed: boolean;
  }>;
  /** Add: undefined. Edit: the existing discount row's snapshot. */
  initial?: {
    shape: "flat" | "percent";
    /** Cents for flat; integer percent for percent. */
    value: number;
    note: string | null;
    /** null = "all services"; non-null = scoped ids (matches serviceLines.id). */
    targetLineIds: string[] | null;
  };
  onSave: (payload: DiscountSheetOnSavePayload) => Promise<void>;
  onCancel: () => void;
};

export type DiscountSheetOnSavePayload = {
  shape: "flat" | "percent";
  value: number;
  note: string | undefined;
  /** null = all services; non-null = scoped (deduped, non-empty when sent). */
  targetLineIds: string[] | null;
};
```

### Scope control layout

A new section sits **below** the note input, **above** the footer:

```
┌─ Applies to ─────────────────────────┐
│  ( • ) All services in this sale     │   ← radio, default
│  (   ) Selected services             │   ← radio
│  ┌────────────────────────────────┐  │   ← chip list, visible iff
│  │ [Manicure $40]  [Pedicure $60] │  │     "Selected services" is chosen
│  │ [Polish change $15]            │  │
│  └────────────────────────────────┘  │
│  ⚠ Pick at least one service.        │   ← inline hint, visible iff
└──────────────────────────────────────┘     scope=selected && picked=0
```

Each chip is a toggleable `<button role="checkbox" aria-checked>` showing
the service name + price. Tapping toggles its inclusion. The order
matches cart order.

Tokens:

- Chip layout: `radius-sm`, `space-2` padding, `border` color when off,
  `primary` border + tinted background when on (mirrors the existing
  shape radio).
- Inline hint: `text-xs`, `muted-foreground`, never red (it's a hint,
  not an error).

### Disabled-Save matrix (FR-013)

| shape valid? | amount valid? | scope | picked count | Save disabled? |
|---|---|---|---|---|
| ✓ | ✓ | All services | n/a | **No** |
| ✓ | ✓ | Selected services | 0 | **Yes** + show inline hint |
| ✓ | ✓ | Selected services | ≥ 1 | **No** |
| ✓ | ✗ | any | any | **Yes** |
| ✓ | ✓ | any | any | **Yes** while in-flight |

### Save payload semantics

- Scope = "All services" → `targetLineIds: null`.
- Scope = "Selected services" → `targetLineIds: string[]` (≥ 1, deduped).

### When the cart's service set changes while the sheet is open

The sheet is mounted with a snapshot of `serviceLines` from the parent.
If a service is removed externally while the sheet is open:

- The chip remains in the picker (the snapshot is the operator's view).
- On Save, the server re-validates against the **live** ticket; an
  off-ticket target raises `scope_target_unknown`, which the cart
  surfaces as an inline banner ("That discount targets a service no
  longer in this cart. Re-pick and save.") and re-opens the sheet.

Edge case mention is in the spec ("Service removed while the discount
sheet is open editing it"). The cart is the source of truth.

## 2 — Cart row label (FR-006)

`checkout-screen.client.tsx` renders the discount row's label by
computing, at render time:

```
<base label> [· <scope label>]
```

| condition | base label | scope label |
|---|---|---|
| percent shape, all services | `Discount · 15%` | — |
| percent shape, 1 target | `Discount · 15%` | `Pedicure` (the target's `name_snapshot`) |
| percent shape, N>1 targets | `Discount · 15%` | `N services` |
| flat shape, all services | `Discount` | — |
| flat shape, 1 target | `Discount` | `Pedicure` |
| flat shape, N>1 targets | `Discount` | `N services` |

Final row text: `<base> · <scope>` if scope label present.

Data slot for e2e: `data-slot="cart-discount-row"`,
`data-scope-kind="all" | "selected"`,
`data-scope-target-count="N"`. The targets themselves are emitted on the
**receipt**, not the cart row (FR-006 explicit).

### Edit affordance

The cart row gains an "Edit" tap target (icon button — Lucide `Pencil`,
1.5px stroke, 16px). Tap opens the DiscountSheet in edit mode.

The existing remove (×) affordance is unchanged (FR-014). Both
affordances must stay reachable in one tap.

## 3 — Receipt + past-transaction enumeration (FR-007)

### Printable receipt (`components/lacquer/checkout/receipt-view.tsx`)

Each discount item that has `targetNames != null` renders a sub-line:

```
Discount · 15%                 -$9.00
  Applies to: Pedicure, Polish change
```

Layout:

- Sub-line uses `text-xs`, `muted-foreground`, indented by `space-3`.
- Names join with `, ` — no truncation; receipts have full paper width.
- All-services discounts render exactly as today (no sub-line).

### Past-transaction drawer (`components/lacquer/transactions/receipt-drawer.tsx`)

Same as above but inside the drawer's `tp-d-line` block — the sub-line
uses the existing `meta` class:

```
Discount · 15%                            -$9.00
  Applies to: Pedicure, Polish change
```

### Data slots for e2e

| element | data slot |
|---|---|
| Receipt discount item | `data-slot="receipt-item" data-kind="discount" data-scope-kind="..."` |
| Receipt targets sub-line | `data-slot="receipt-item-targets"` |
| Drawer discount item | `data-slot="receipt-item" data-kind="discount" data-scope-kind="..."` |
| Drawer targets sub-line | `data-slot="receipt-item-targets"` |

## 4 — Out of scope (UI)

- No new screen or modal. The picker grows the existing sheet inline
  (Spec Assumption).
- No bulk "apply to all" shortcut beyond the existing radio.
- No re-skin of the cart row beyond the new sub-text on the label and
  the edit affordance.
