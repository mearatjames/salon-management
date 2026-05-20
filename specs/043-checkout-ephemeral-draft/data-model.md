# Phase 1 Data Model: Ephemeral Checkout Draft

**Feature**: `043-checkout-ephemeral-draft` | **Date**: 2026-05-19

This feature changes **when** sales records are written, not their shape. No
table, column, enum, constraint, or index on `tickets`, `ticket_items`, or
`payments` changes. The only schema-level change is one new RPC and one dropped
(now-dead) index.

---

## Entities

### Ephemeral Checkout Draft (new — client-side only, not persisted)

The in-progress, unsubmitted cart. Lives **only** in the checkout screen's React
state. It is not a database entity, is never reported on, and is discarded with
no consequence when the operator leaves checkout or refreshes.

| Field | Type | Notes |
|-------|------|-------|
| `lines` | `DraftLine[]` | Service and discount lines, in display order. |
| `operator` | (implicit) | Not held in the draft — resolved server-side from the session at submission. The client never supplies the operator id. |

`DraftLine` (discriminated on `kind`):

| Field | Type | Applies to | Notes |
|-------|------|-----------|-------|
| `clientLineId` | `string` | both | Client-generated (`crypto.randomUUID()`); identifies the line within the session. Never persisted. |
| `kind` | `'service' \| 'discount'` | both | |
| `serviceId` | `string` | service | FK target in `services`. |
| `unitPriceCents` | `int` | both | Service: `> 0` at submission. Discount: the final negative amount (percent discounts pre-folded). |
| `priceUnconfirmed` | `boolean` | service | A variable-price line whose price the operator has not yet confirmed. MUST be `false` for every line at submission (FR-015). |
| `assignedStaffId` | `string` | service | Per-line tech; must be active staff. |
| `discountShape` | `'flat' \| 'percent'` | discount | |
| `discountValue` | `int` | discount | Flat: cents. Percent: whole-number percent. |
| `discountPct` | `numeric` | discount | Stored for display when `shape='percent'`. |
| `note` | `string \| null` | discount | ≤ 80 chars. |

**Lifecycle**: created empty when `/checkout` mounts → mutated by cart edits
(local state only) → at the first payment-initiating action its lines become a
`Ticket` + `Ticket Items` via `pos_create_ticket_from_draft` → or discarded when
the checkout screen unmounts (navigation, refresh, tab close).

**Validation at submission** (TS server action, see contracts/checkout-draft.md):
the draft is rejected — with the same messaging shown today — when it has no
service lines, a non-positive total, or any line with `priceUnconfirmed === true`.
Every `serviceId` must resolve to a real `services` row; every `assignedStaffId`
must be active staff.

### Ticket (existing — unchanged shape, changed timing)

`public.tickets`. Structure and lifecycle unchanged. **The only change is
timing**: a `tickets` row now comes into existence at the first
payment-initiating action (via `pos_create_ticket_from_draft`) instead of at
checkout page open (via the deleted `createEmptyTicket`).

Columns, enums (`ticket_status = open|paid|discarded`), and all CHECK constraints
(`tickets_total_matches_subtotal_chk`, `tickets_closed_consistency_chk`) are
untouched. Pre-existing `open`/`discarded` rows are left intact (FR-018).

### Ticket Item (existing — unchanged shape, changed timing)

`public.ticket_items`. A persisted service or discount line. Structure and all
CHECK constraints (`ticket_items_kind_columns_chk`, `ticket_items_unit_price_cents_chk`,
`ticket_items_note_length_chk`) unchanged. **Change**: rows are now created as a
**batch**, together with their `Ticket`, inside `pos_create_ticket_from_draft` —
not incrementally as the cart is built.

### Payment (existing — fully unchanged)

`public.payments`. Created after the `Ticket` exists, exactly as today. This
feature does not touch payment creation, settlement, idempotency, or the
in-flight-charge safeguards.

---

## Schema changes (migration `0020_checkout_ephemeral_draft.sql`)

### Added — `pos_create_ticket_from_draft` RPC

```
pos_create_ticket_from_draft(p_operator uuid, p_items jsonb)
  returns table(ticket_id uuid, subtotal_cents int, total_cents int)
```

`security definer`, `set search_path = public, pg_temp`,
`revoke all from public`, `grant execute to service_role`. See
`contracts/rpc-pos-create-ticket-from-draft.md` for the full contract.

### Dropped — `tickets_open_by_operator_recent_idx`

The partial index `(opened_by_staff_id, updated_at desc) where status='open'` was
created solely for the resume-or-create hot path. With resume removed (FR-013) it
has no reader and is dropped.

`tickets_status_created_at_idx` and `ticket_items_by_ticket_idx` are **kept**.

---

## Money invariants (unchanged, re-asserted by the new RPC)

- `tickets.total_cents = subtotal_cents + tax_cents`, `tax_cents = 0` — the RPC
  computes `subtotal`/`total` from the inserted items and the existing CHECK
  enforces consistency.
- `subtotal_cents >= 0`, `total_cents >= 0` — the RPC clamps `total` to ≥ 0.
- `payments` on a ticket sum to `tickets.total_cents` — unchanged; enforced by
  the existing payment RPCs against the now-persisted ticket.
- Square idempotency keys (`${ticket_id}:${payment_id}`) — unchanged; computed
  after the ticket exists, as today.
