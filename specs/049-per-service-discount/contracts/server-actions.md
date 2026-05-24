# Contract: Server Actions for per-service discounts

**Feature**: `049-per-service-discount` | **Date**: 2026-05-22 |
**Source spec**: [../spec.md](../spec.md) | **Data model**:
[../data-model.md](../data-model.md)

This contract supersedes
`specs/013-cart-polish/contracts/server-actions.md` for the discount
actions only (other actions in that file are unchanged). The three
authoritative entry points after this feature ships are:

1. `addDiscountLine` (extended)
2. `editDiscountLine` (NEW — FR-017)
3. `removeDiscountLine` (unchanged surface; new auto-removal call site
   from `recomputeTicketTotals`)

## Shared prelude

Every action follows the existing prelude
(`actions.ts:1-30` doc-comment):

1. `requireStudioSession()` — auth resolver.
2. Parse + validate args (per-action — schemas below).
3. `discardDraftLegs(...)` — split-tender invalidation guard.
4. Load + status-check the ticket (`status === 'open'`).
5. Service-role write.
6. `recomputeTicketTotals(...)` — single source of truth for totals
   (data-model § 5).
7. `recordAudit(...)`.
8. Typed return.

Typed errors live in `app/(studio)/checkout/_errors.ts`. New
`DiscountInvalidError` reasons added by this feature:

- `scope_empty` — caller asked for "selected services" with zero
  resolved targets.
- `scope_target_unknown` — a target id does not match any service line
  on the ticket.
- `scope_off_ticket` — a target id belongs to a different ticket
  (defense-in-depth; the UI never produces this).

## 1 — `addDiscountLine` (extended)

### Input

```ts
export type AddDiscountLineInput = {
  ticketId: string;
  shape: "flat" | "percent";
  value: number;                 // flat: cents > 0; percent: 1..100
  note?: string;
  /** NEW (049): null/undefined = today's "all services". Non-null = scoped. */
  targetLineIds?: string[] | null;
};
```

### Validation (in order)

1. `assertUuid(ticketId, ...)`.
2. Shape ∈ {flat, percent}; per-shape value range
   (`flat_value_non_positive` / `percent_out_of_range`).
3. `note.length ≤ 80` (`note_too_long`).
4. If `targetLineIds` provided:
   - Each entry is a uuid; the array is non-empty after dedupe → else
     `scope_empty`.
   - Every entry resolves to a `kind = 'service'` row on this ticket →
     else `scope_target_unknown` or `scope_off_ticket`.

### Insert

`ticket_items` row with:

| column | value |
|--------|-------|
| `kind` | `'discount'` |
| `unit_price_cents` | `-value` for flat; `0` for percent (recompute writes the real amount) |
| `discount_pct` | percent value for percent; `null` for flat |
| `note` | input note or null |
| `name_snapshot` | `discountNameSnapshot(shape, value)` — unchanged from today |
| `discount_target_line_ids` | input targetLineIds (deduped) or `null` |

### Post-write

`recomputeTicketTotals` runs (data-model § 5) and writes
`tickets.subtotal_cents` / `total_cents`.

### Audit

`discount.added`, payload per data-model § 6. The `scope` key is omitted
for all-services discounts.

### Return

```ts
{
  lineId: string;
  subtotalCents: number;
  totalCents: number;
  draftsDiscarded?: number;
}
```

## 2 — `editDiscountLine` (NEW)

Replaces every operator-editable field of a discount row in one call.
The row id is stable; `discount.edited` is audited.

### Input

```ts
export type EditDiscountLineInput = {
  ticketId: string;
  lineId: string;
  shape: "flat" | "percent";
  value: number;
  note?: string;
  targetLineIds?: string[] | null;  // null/undefined = "all services"
};
```

### Validation

- Same shape/value/note checks as `addDiscountLine`.
- Same scope checks as `addDiscountLine`.
- `lineId` must be a `kind = 'discount'` row on `ticketId`
  (`DiscountInvalidError("kind_mismatch")` — reused from
  `removeDiscountLine`'s existing reason).

### Update

A single UPDATE on the row sets:

| column | new value |
|--------|-----------|
| `unit_price_cents` | `-value` for flat; `0` for percent (recomputed) |
| `discount_pct` | percent → value; flat → null |
| `note` | input note or null |
| `name_snapshot` | `discountNameSnapshot(shape, value)` |
| `discount_target_line_ids` | input or null |

### Post-write

`recomputeTicketTotals` runs.

### Audit

`discount.edited`, payload per data-model § 6.

### Return

```ts
{
  subtotalCents: number;
  totalCents: number;
  draftsDiscarded?: number;
}
```

## 3 — `removeDiscountLine` (surface unchanged)

No change to the input/output. The action body is unchanged.

What **does** change: the same row delete is now also called from
**inside** `recomputeTicketTotals` (auto-removal path, data-model § 5 /
§ 9). When auto-invoked, the audit payload uses the `auto_removed: true`
variant from data-model § 6.

## 4 — `recomputeTicketTotals` (internal helper — extended)

This is not a Server Action but it sits on the action-write path. Its
new contract:

### Inputs

Unchanged signature: `(supabase, ticketId)`.

### Read

`select id, kind, unit_price_cents, qty, price_unconfirmed, discount_pct,
discount_target_line_ids from ticket_items where ticket_id = ?`.

### Auto-removal (FR-010)

1. Build `liveServiceIds = { row.id | row.kind = 'service' }`.
2. For each `row.kind = 'discount' && row.discount_target_line_ids != null`:
   - `survivingTargets = row.discount_target_line_ids ∩ liveServiceIds`
   - If `survivingTargets.length === 0`: DELETE this row, `recordAudit(
     'discount.removed', ..., { auto_removed: true, orphaned_targets:
     row.discount_target_line_ids })`. Skip this row in the recompute
     pass.
   - Else if `survivingTargets.length < row.discount_target_line_ids.length`:
     UPDATE this row's `discount_target_line_ids = survivingTargets`. Use
     the surviving set for the math below. (AS-2)

### Compute (FR-009)

1. `serviceSubtotal = Σ (kind = 'service' && !price_unconfirmed)`.
2. Partition surviving discounts into `scoped`
   (`discount_target_line_ids != null`) and `allServices`.
3. For each `scoped` discount, compute:
   - Percent: `targetedSubtotal = Σ (price of survivingTargets, only
     confirmed)`; `amount = -round(pct × targetedSubtotal / 100)`.
   - Flat: `amount = max(-value, -targetedSubtotal)`.
   - UPDATE the row's `unit_price_cents` iff the value drifted.
4. `postScopedSubtotal = serviceSubtotal + Σ scoped.amount`.
5. For each `allServices` discount:
   - Percent: `amount = -round(pct × postScopedSubtotal / 100)`.
   - Flat: `amount = unit_price_cents` (already negative; unchanged).
   - UPDATE the row's `unit_price_cents` iff drifted.
6. `subtotalCents = max(0, serviceSubtotal + Σ all amounts)`.
7. UPDATE `tickets` with new totals.

### Return

Unchanged: `{ subtotalCents, totalCents }`.

## 5 — `validateAndResolveDraft` (ephemeral-cart resolver)

The draft validator gains scope handling parallel to `addDiscountLine`.

### Per-discount-line extension

1. If `targetClientLineIds` is `null` / omitted → resolved scope is `null`
   ("all services"). No further check.
2. Else:
   - Dedupe + non-empty check (`scope_empty`).
   - Every entry must resolve to a service line in the same
     `draft.lines` (matched by `clientLineId`). Miss →
     `DraftCorruptError("draft scope references unknown service line
     <id>")`.

### Resolved item shape

Add `target_client_line_ids: string[] | null` (data-model § 3).

### Math pass

`computeTotals` is called once with `discountTargetIds` populated so the
draft's `total_cents` guard reflects the FR-009 order.

## 6 — `pos_create_ticket_from_draft` RPC (replaced body)

Migration 0023 replaces the function body to:

1. Insert service lines first; build a `map(client_line_id → ticket_items.id)`
   inside a temp table or pl/pgsql array.
2. Insert discount lines, resolving each `target_client_line_ids` array
   through the map into `discount_target_line_ids`. A miss raises
   `unknown_target_client_line_id` (defense-in-depth — the resolver
   should have already failed).
3. Totals + audit + return unchanged.

## 7 — Client-side responsibilities (out-of-band reminder)

The Server Actions are the source of truth, but the client's
`computeTotals` mirror must also:

- Pass `discountTargetIds` for every discount line so the cart total the
  operator sees matches what `recomputeTicketTotals` will write.
- Apply the same FR-009 ordering.
- On service-line remove in the ephemeral cart, in the SAME `setLines`
  update, also filter out any scoped discount whose
  `discountTargetIds` no longer intersects the live service set
  (mirrors the server's auto-removal).

Spec'd here (rather than in the data model) because both server and
client implementations must agree.

## 8 — Backward compatibility

- Callers (and serialized drafts) that omit `targetLineIds` /
  `targetClientLineIds` continue to produce all-services discounts.
- Pre-existing `ticket_items` rows have `discount_target_line_ids = null`
  and behave exactly as today.
- Old audit rows have no `scope` key; readers must tolerate its absence.
