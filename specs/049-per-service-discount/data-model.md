# Data Model: Per-service discount in checkout

**Feature**: `049-per-service-discount` | **Date**: 2026-05-22 | **Spec**:
[spec.md](./spec.md) | **Research**: [research.md](./research.md)

This document is the source of truth for the DDL change, the in-memory
draft shape, the resolved RPC payload, and the validation rules that gate
every write.

## 1 — Migration (new file: `0023_per_service_discount_scope.sql`)

### 1a. Column add

```sql
alter table public.ticket_items
  add column discount_target_line_ids uuid[] null;
```

- **Nullable.** `null` (the only universe before this feature) means
  "applies to all services in this sale" — the existing default behavior
  (FR-005).
- **Non-null = scoped.** Each array entry is the `ticket_items.id` of a
  service line on the **same** ticket.
- **Empty array forbidden.** A scoped discount with zero targets is
  invalid by definition (FR-013).

### 1b. CHECK constraints

```sql
alter table public.ticket_items
  add constraint ticket_items_discount_targets_kind_chk check (
    -- Only discount rows may carry targets.
    discount_target_line_ids is null or kind = 'discount'
  );

alter table public.ticket_items
  add constraint ticket_items_discount_targets_non_empty_chk check (
    -- A non-null target array MUST have ≥ 1 element. The empty array is
    -- the auto-removal trigger surface — by the time the cart is at
    -- rest, a scoped discount with zero targets has been deleted (FR-010).
    discount_target_line_ids is null or array_length(discount_target_line_ids, 1) >= 1
  );
```

> The "every target must be a real same-ticket service line" invariant is
> enforced in the **application** layer (the recompute helper and the
> draft resolver) rather than at the DB level. Same-row referential
> integrity to other rows in the same table is awkward in Postgres and
> the application has the full row set in hand every recompute already.
> The CHECKs above defend the structural shape; the application defends
> the referential shape.

### 1c. Backfill

None required. Pre-existing discount rows keep
`discount_target_line_ids = NULL` (= "all services") which matches their
shipped behavior (Spec Assumption — "sales closed before the feature
ships continue to render as transaction-wide discounts").

## 2 — Extended draft shape (`app/(studio)/checkout/_cart-draft.ts`)

The ephemeral cart (feature 043) carries the draft client → server. The
discount-line shape gains an optional `targetClientLineIds`:

```ts
export type DraftDiscountLine = {
  kind: "discount";
  clientLineId: string;
  shape: "flat" | "percent";
  value: number;            // flat: cents; percent: 1..100
  note: string | null;
  /**
   * NEW (049): null or omitted = "all services" (today's default, FR-005).
   * Non-null = explicit scope; each entry MUST be the `clientLineId` of a
   * service line in the same `lines[]` array. Empty array refused.
   */
  targetClientLineIds: string[] | null;
};
```

The persisted-mode discount actions (D5 below) accept the same shape but
keyed by `ticket_items.id` instead of `clientLineId`.

## 3 — Resolved RPC payload (`pos_create_ticket_from_draft`)

`validateAndResolveDraft` produces a `ResolvedDiscountItem[]` for the RPC.
The resolved shape gains `target_line_client_ids` (positional / pre-insert):

```ts
export type ResolvedDiscountItem = {
  kind: "discount";
  name_snapshot: string;
  unit_price_cents: number;       // final, ≤ 0
  discount_pct: number | null;
  note: string | null;
  /** Resolved client line ids of the targeted service lines, or null. */
  target_client_line_ids: string[] | null;
};
```

The `pos_create_ticket_from_draft` RPC (migration 0023, replacing the
0020 body) inserts service lines first, capturing each new row's
`ticket_items.id` keyed by the JSON-supplied `client_line_id`, then
inserts discount lines and resolves each `target_client_line_ids` entry
to the matching real `id` for the `discount_target_line_ids` column.

### RPC payload extension

Service-line objects gain a `client_line_id` field so discount-line
objects can reference them positionally:

```jsonc
{ "kind": "service",
  "client_line_id": "<uuid from CheckoutDraft.clientLineId>",
  "ref_id": "<uuid>",
  "name_snapshot": "...",
  "unit_price_cents": 4000,
  "assigned_staff_id": "<uuid>",
  "price_unconfirmed": false
}
{ "kind": "discount",
  "name_snapshot": "Discount · 15%",
  "unit_price_cents": -900,
  "discount_pct": 15,
  "note": null,
  "target_client_line_ids": ["<service client_line_id>", ...]   // OR null
}
```

Backward-compatible: a payload with no `client_line_id` on services and
no `target_client_line_ids` on discounts is the today-shape — both are
ignored / treated as null.

## 4 — Cart-math input (`lib/pos/cart.ts::CartItem`)

`CartItem` widens with `id` (so scoped discounts can name their targets
in client math) and `discountTargetIds`:

```ts
export type CartItem = {
  /** Real ticket_items.id in persisted mode; ephemeral clientLineId in draft. */
  id: string;
  kind: "service" | "discount";
  unitPriceCents: number;
  qty: number;
  priceUnconfirmed: boolean;
  discountPct?: number | null;
  /** NEW (049). null = all services; non-null = scoped to these ids. */
  discountTargetIds?: readonly string[] | null;
};
```

`computeTotals` recompute order (FR-009):

1. Partition discount lines into `scoped` (`discountTargetIds != null`)
   and `allServices` (the rest).
2. For each `scoped` discount, sum the targeted service lines (only
   confirmed, only kind === 'service', only ids present in the live cart
   — a target that was just removed in the same render is silently
   dropped from the sum; the cleanup-then-recompute order in the caller
   guarantees an empty-target discount has already been removed before
   `computeTotals` runs).
3. For each `allServices` discount, sum against `serviceSubtotal +
   Σ scoped.amount`.
4. `subtotalCents = max(0, serviceSubtotal + Σ all discount amounts)`.

A scoped flat discount caps its own contribution at the targeted
subtotal: `amount = max(-flat, -targetedSubtotal)`.

## 5 — Server recompute (`recomputeTicketTotals`)

Mirrors `computeTotals` with two extensions:

1. **Auto-removal** (FR-010): after the SELECT, scan scoped discount rows
   for `discount_target_line_ids` that no longer intersect the live
   service-line id set. For each, DELETE the row and emit a
   `discount.removed` audit with `auto_removed: true,
   orphaned_targets: [...]` before recomputing totals.
2. **Order of operations** matches D2 in research.md: scoped first,
   all-services on the post-scoped service subtotal.

## 6 — Audit verbs (`lib/auth/audit.ts`)

```ts
type AuditAction =
  | ...
  | "discount.added"
  | "discount.removed"
  | "discount.edited";   // NEW
```

Payloads:

```jsonc
// discount.added (extended) and discount.removed
{
  "ticket_id": "<uuid>",
  "shape": "flat" | "percent",
  "value": 1000,
  "note": "Loyalty perk" | null,
  // Present iff scoped (else "all services"):
  "scope": { "kind": "selected_services", "line_ids": ["<uuid>", ...] }
}

// discount.removed (auto-removal variant)
{
  "ticket_id": "<uuid>",
  "auto_removed": true,
  "orphaned_targets": ["<uuid>", ...]
}

// discount.edited (NEW)
{
  "ticket_id": "<uuid>",
  "before": { "shape": ..., "value": ..., "note": ..., "scope": ... },
  "after":  { "shape": ..., "value": ..., "note": ..., "scope": ... }
}
```

## 7 — Validation rules (server)

For every write that touches a discount row (`addDiscountLine`,
`editDiscountLine`, `validateAndResolveDraft`):

- **Scope shape**: `targetClientLineIds`/`targetLineIds` is `null` OR an
  array of ≥ 1 distinct uuids.
- **Scope membership**: every target id resolves to a `kind = 'service'`
  row on the **same** ticket (persisted) or to a service entry in the
  same `CheckoutDraft.lines` (draft). A miss is `DraftCorruptError` on
  the draft path and `DiscountInvalidError` (`scope_target_unknown`) on
  the persisted path.
- **No service targets**: a scoped discount with empty resolved targets
  refuses with `DiscountInvalidError("scope_empty")` — FR-013.
- **Same-ticket invariant**: persisted action refuses if a target id
  belongs to a different ticket (`DiscountInvalidError("scope_off_ticket")`).
- **Stacking**: an "all services" discount and any number of scoped
  discounts may coexist; no uniqueness constraint on scope. (FR-008)

## 8 — Read model (`lib/transactions/aggregate.ts`)

`TransactionLineItem` widens:

```ts
export type TransactionLineItem = {
  readonly name: string;
  readonly category: string | null;
  readonly kind: "service" | "discount" | "product";
  readonly qty: number;
  readonly unitPriceCents: number;
  readonly lineTotalCents: number;
  readonly techId: string | null;
  /** NEW (049). null for all-services / non-discount; non-null otherwise. */
  readonly targetNames: readonly string[] | null;
};
```

`ProjectItemRow` (the raw input shape) gains
`discount_target_line_ids: readonly string[] | null` so
`projectTransactions` can resolve `targetNames` from the same input
slice by looking up each target's `name_snapshot`.

The Transactions query layer (`lib/transactions/queries.ts`) extends its
`select(...)` for `ticket_items` to include the new column. Sales
predating this feature project as `targetNames: null` and render
exactly as today.

## 9 — State transitions

Per-service discount state changes on every cart mutation. The diagram
captures the FR-010 / FR-011 / FR-012 invariants:

```
   ┌──────────────────────────────────────────────────────────────────────┐
   │  Operator action                          │  Discount row reaction   │
   ├───────────────────────────────────────────┼──────────────────────────┤
   │  Add service line                         │  Existing scoped lines:  │
   │                                           │  NOT auto-included       │
   │                                           │  (FR-011). Recompute     │
   │                                           │  amounts unchanged.      │
   ├───────────────────────────────────────────┼──────────────────────────┤
   │  Remove a service line that is NOT a      │  No change to scope.     │
   │  scope target                             │  Recompute may change    │
   │                                           │  the all-services        │
   │                                           │  amount only.            │
   ├───────────────────────────────────────────┼──────────────────────────┤
   │  Remove a service line that IS a target,  │  Drop the id from        │
   │  with ≥ 1 other targets remaining         │  `discount_target_line_  │
   │                                           │  ids`; recompute amount  │
   │                                           │  from the remaining      │
   │                                           │  targets (FR-010, AS-2). │
   ├───────────────────────────────────────────┼──────────────────────────┤
   │  Remove the LAST target service line      │  DELETE the discount     │
   │                                           │  row in the same update; │
   │                                           │  emit `discount.removed` │
   │                                           │  with `auto_removed:     │
   │                                           │  true`. Payment is NOT   │
   │                                           │  blocked. (FR-010,       │
   │                                           │  FR-016).                │
   ├───────────────────────────────────────────┼──────────────────────────┤
   │  Edit a targeted service's price          │  Percent-scoped discount │
   │                                           │  recomputes from new     │
   │                                           │  price; flat unchanged.  │
   │                                           │  (FR-012)                │
   ├───────────────────────────────────────────┼──────────────────────────┤
   │  Operator opens edit on a scoped          │  May change scope, shape,│
   │  discount and saves                       │  value, note; one        │
   │                                           │  `discount.edited`       │
   │                                           │  audit. (FR-017)         │
   └───────────────────────────────────────────┴──────────────────────────┘
```

## 10 — Touched files (data-layer)

| File | Change |
|------|--------|
| `supabase/migrations/0023_per_service_discount_scope.sql` | NEW — column + CHECKs + RPC body update |
| `app/(studio)/checkout/_cart-draft.ts` | extend `DraftDiscountLine`, `ResolvedDiscountItem`, `validateAndResolveDraft` |
| `app/(studio)/checkout/actions.ts` | extend `addDiscountLine`, `recomputeTicketTotals`; add `editDiscountLine` |
| `app/(studio)/checkout/_errors.ts` | add `DiscountInvalidError` reasons: `scope_empty`, `scope_target_unknown`, `scope_off_ticket` |
| `lib/pos/cart.ts` | widen `CartItem`; new sort + recompute order |
| `lib/auth/audit.ts` | add `discount.edited` verb |
| `lib/transactions/aggregate.ts` | widen `TransactionLineItem` + `ProjectItemRow`; resolve `targetNames` |
| `lib/transactions/queries.ts` | include `discount_target_line_ids` in the `ticket_items` select |

Receipts and the cart row label are presentation-layer (covered in the
contracts and the plan's Structure section, not the data model).
