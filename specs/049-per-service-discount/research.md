# Research: Per-service discount in checkout

**Feature**: `049-per-service-discount` | **Date**: 2026-05-22 | **Spec**:
[spec.md](./spec.md)

## NEEDS CLARIFICATION audit

The clarification pass on 2026-05-22 resolved every open question (commission
base, cart vs. receipt scope display, stacking math, auto-removal). The spec
has no remaining `NEEDS CLARIFICATION` markers. Nothing is dispatched to
research subagents — every decision below is a design call grounded in the
existing checkout code.

## Decisions

### D1 — Storage: `uuid[]` column on `ticket_items`, not a junction table

**Decision**: extend `ticket_items` with a single nullable
`discount_target_line_ids uuid[]` column.

- `null` (today's universe) = "all services" — the default and the only
  shape produced before this feature ships.
- A non-null array = "selected services," each entry referencing another
  `ticket_items.id` (a service line on the same ticket).
- Empty arrays (`'{}'`) are forbidden by a CHECK; the empty-scope refusal
  path is in the spec (FR-013).

**Rationale**:

- The relationship is **owned by the discount**, not by the service (spec
  Key Entities + Assumption "Scope is captured per discount"). Storing it on
  the discount row keeps the read path "one row per discount" identical to
  today's wire shape (`select id, kind, unit_price_cents, qty,
  price_unconfirmed, discount_pct` in `recomputeTicketTotals`).
- The recompute math is N (≤ 20 service lines in practice) × M (≤ 4 discount
  lines) and runs in a single SELECT + folded in-memory. A junction table
  would add a JOIN per recompute, an extra DELETE on remove, and a second
  audit surface — all to model an N≤20 array.
- `pos_create_ticket_from_draft` already takes `jsonb` for the line payload;
  adding a `target_line_client_ids` array to the discount-line shape and
  resolving it to real `ticket_items.id` values inside the same RPC trip is
  a one-line extension. A junction table would require a second
  `jsonb_array_elements` loop and a second INSERT.

**Alternatives considered**:

- *Junction table `ticket_discount_targets (discount_line_id, target_line_id)`*
  — rejected. The cardinality is small, the FK invariant is no stronger
  than what a CHECK on a `uuid[]` against the same-ticket rows can give us
  (enforced in the recompute query, not at the DB level), and the extra
  table doubles audit surface area for a fully replaceable-on-edit
  relationship. Revisit if a future feature needs to attach metadata per
  target (e.g. per-target reason text).
- *Single `target_line_id uuid` (one-target only)* — rejected. FR-002 and
  AS-2 require multi-target.
- *Scope as JSON on the existing `note` column* — rejected. Mixes data
  with operator-typed text; loses the type checker.

### D2 — Recompute order: scoped discounts first, then "all services"

**Decision**: implement FR-009's sequential math by sorting discount rows
within `recomputeTicketTotals` and `computeTotals`:

1. **Scoped first.** For each scoped discount, compute `−round(pct ×
   sum(targeted service line prices) / 100)` (percent) or `max(−value,
   −sum(targeted service line prices))` (flat — the targeted contribution
   floored at zero, FR-004 + FR-015).
2. **All-services next.** The all-services percent discount runs against
   the **post-scoped service subtotal** (`serviceSubtotal +
   sum(scopedDiscountAmounts)`, all negative). Flat all-services takes the
   entered cents verbatim, still capped at the running subtotal.
3. The final `subtotalCents = max(0, serviceSubtotal + Σ all discount
   amounts)` invariant is unchanged (FR-015).

**Rationale**: matches Square's stacking semantics (cited in FR-009), keeps
the on-screen line order from being a separate concern (the same iteration
that computes drives the render order), and avoids the "two stacked
percents compound past 100%" pitfall.

**Alternatives considered**:

- *Independent computation, both against raw service subtotal* — rejected.
  Two stacked 50% discounts on the same service would discount past 100%.
- *Mark scope per service line + apply each discount against the
  line's running balance* — rejected. Re-encodes the relationship in the
  wrong place and breaks the "discount owns scope" assumption.

### D3 — Auto-removal on last-target removal (FR-010, FR-016)

**Decision**: when `removeServiceLine` (ephemeral path: removing from the
local `lines` state; persisted path: deleting a `ticket_items` row) leaves
a scoped discount with no targets in the cart, the same update cycle
removes the discount row.

- **Ephemeral path** (the default in 043): a single setter call updates
  `lines` to filter out both the service and any orphaned scoped
  discount. The cart re-renders once; the operator sees the discount line
  disappear in the same frame.
- **Persisted path** (legacy `removeLine` action): `recomputeTicketTotals`
  is extended to detect scoped discounts whose `discount_target_line_ids`
  no longer intersects the live `ticket_items.id` set and DELETE them
  inside the same call. The audit verb is the existing
  `discount.removed` with payload `{ ticket_id, auto_removed: true,
  orphaned_targets: [...] }`. No operator confirmation; payment is not
  blocked (FR-016).

**Rationale**: the spec is explicit about "no placeholder, no inactive
state" (FR-010) and "MUST NOT block payment, MUST NOT surface an error,
MUST NOT require operator confirmation" (FR-016). The recompute helper is
already the single chokepoint every cart mutation passes through, so
extending it (rather than scattering removal logic across every action) is
the minimum-change path.

### D4 — Adding a new service line does not pull it into existing scopes (FR-011)

**Decision**: `addServiceLine` does **not** touch any existing scoped
discount's `discount_target_line_ids`. The operator must explicitly
`editDiscountLine` to add the new line as a target.

**Rationale**: spec is explicit. No code change needed beyond not
introducing the wrong behavior.

### D5 — New action: `editDiscountLine` (in-place edit, FR-017)

**Decision**: add `editDiscountLine` Server Action alongside
`addDiscountLine` / `removeDiscountLine`. It re-validates the full payload
(shape, value, note, scope) and replaces the row's mutable fields in one
update. Audit verb is a new controlled-vocab term `discount.edited` (added
to `lib/auth/audit.ts`), payload `{ ticket_id, before: {...}, after:
{...} }`.

**Rationale**: FR-017 demands in-place edit; remove-and-re-add would
emit two audit rows and reset the row's primary key (anything that
references the discount row id — there is nothing today, but the audit
trail itself becomes harder to follow). A single `discount.edited` write
keeps the audit log tight.

**Alternatives considered**:

- *Reuse `addDiscountLine` with an optional `replaceLineId`* — rejected.
  Conflates two intents in one action and tangles the typed-error surface
  (a re-validation failure during edit would surface the same exact
  errors as a fresh add, which the caller would need to disambiguate by
  whether `replaceLineId` was passed — a recipe for branch drift).

### D6 — Audit payload extension (Principle III)

**Decision**: extend the existing `discount.added` / `discount.removed`
audit payloads with an optional `scope` field:

```jsonc
{
  "ticket_id": "<uuid>",
  "shape": "flat" | "percent",
  "value": 1000,
  "note": "Loyalty perk",
  // NEW: present iff scoped.
  "scope": { "kind": "selected_services", "line_ids": ["<uuid>", "<uuid>"] }
}
```

Absent `scope` (or `scope.kind === "all_services"`) = today's universe.
The new `discount.edited` verb (D5) carries `before` and `after` blocks
with the same shape.

**Rationale**: extends Principle III's auditability requirement to cover
the new dimension. The payload stays JSONB so no schema migration is
needed.

### D7 — Receipt + transactions surface (FR-007)

**Decision**:

1. **Printable receipt** (`components/lacquer/checkout/receipt-view.tsx`):
   add an inline sub-line under each scoped discount row enumerating its
   targets by name. All-services discounts render unchanged.
2. **Past-transaction drawer**
   (`components/lacquer/transactions/receipt-drawer.tsx`): same — a small
   `Applies to: Pedicure, Polish change` sub-line under the discount
   line.
3. **Read model** (`lib/transactions/aggregate.ts`): widen
   `TransactionLineItem` with `targetNames: readonly string[] | null`.
   Resolved at projection time from `ticket_items.discount_target_line_ids`
   by looking up each target's `name_snapshot` in the same item set.
4. **Backward compatibility**: sales closed before the feature ships have
   `discount_target_line_ids = null`; they render exactly as today.

**Rationale**: the spec's Assumption "Past-transaction detail view change
is in-scope" and "Sales closed before the feature ships continue to
render as transaction-wide discounts" are both addressed by the nullable
column + a single render branch.

### D8 — Cart row scope label (FR-006)

**Decision**: the cart row label uses:

- `Discount` → no scope (all services).
- `Discount · Pedicure` → exactly one target.
- `Discount · 2 services` → more than one target.
- Percent shape adds `· N%` after the name: `Discount · 15% · Pedicure`.

These labels live on the client (computed in
`checkout-screen.client.tsx`'s row render path) so the cart is reactive
to scope edits without a server round-trip. The persisted
`name_snapshot` continues to be the shape's plain label ("Discount" /
"Discount · 15%") so historical receipts that read `name_snapshot`
directly stay readable for old rows.

**Rationale**: the receipt and the transaction drawer already pull
`name_snapshot` plus the new `targetNames`; the cart row label is a
display concern (the spec's FR-006 governs presentation, not storage).
Pushing scope into the snapshot would freeze targets at row-creation
time and contradict FR-010 / FR-012 (scope can change mid-cart).

## Non-decisions

- **No Square SDK touch.** Discounts are POS-only in v1; the existing
  Square calls (`lib/square/terminal.ts`) do not send discount metadata.
- **No new Vitest dependency.** Cart-math unit tests extend the existing
  `tests/unit/checkout/cart-totals.test.ts` and
  `tests/unit/checkout/add-discount-line-action.test.ts`.
- **No tax math change.** v1 invariant (`tax_cents` literal 0) holds.
- **No commission/payroll change** (Assumption confirmed in
  clarification 2026-05-22; FR-018 makes it a hard contract).

## Open follow-ups (post-feature)

- If a future feature wants the discount to reduce the targeted tech's
  commission base, FR-018 would need to be revisited and the payroll
  query would need to discount each service line by its proportional
  share of any scoped discount. Out of scope for this feature.
