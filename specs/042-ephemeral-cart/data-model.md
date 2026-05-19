# Phase 1 Data Model: Ephemeral Cart

**Feature**: 042-ephemeral-cart | **Date**: 2026-05-18

This feature introduces no new database tables, columns, indexes, constraints, or RPCs. The only new data model is the **client-side ephemeral cart** — a TypeScript-typed in-memory structure that lives in React state for the duration of a single cart-building session. The existing server-side data model (tickets, ticket_items, payments, customers, audit_log) is referenced unchanged; it is included below for context so the commit Server Actions in `contracts/server-actions.md` have a single place to point at.

---

## Client-side: EphemeralCart (NEW, in-memory only)

```ts
// app/(studio)/checkout/_cart.ts (excerpt)

export type CartItem = {
  /** Stable client-local ID for React reconciliation; never sent to server. */
  localId: string;
  /** The catalog service this row represents. */
  serviceId: string;        // uuid, references services.id
  /** The tech assigned to this specific line. May differ from cart-level techId. */
  techId: string;           // uuid, references staff.id
  /** Optional notes the operator typed for this line. */
  note: string | null;
  /** Display-only cached fields from the services catalog snapshot at cart-build time.
   *  Re-resolved authoritatively by the server at commit.
   */
  displayPriceCents: number;
  displayDurationMinutes: number;
  displayName: string;
};

export type CartDiscount =
  | { kind: 'percent'; percent: number }    // 0..100
  | { kind: 'amount'; amountCents: number }; // >= 0

export type EphemeralCart = {
  /** Selected customer, or null for a walk-in with no client linkage. */
  customerId: string | null;
  /** Cart-level default tech (used to seed new items; per-line techId on CartItem wins). */
  techId: string | null;
  /** Line items in the order they were added (operator-visible). */
  items: CartItem[];
  /** Cart-level discount, applied after summing line totals. Null means no discount. */
  discount: CartDiscount | null;
  /** Operator-visible cart notes, optional. */
  notes: string | null;
};
```

### Lifecycle

```text
mount /checkout
    └── reducer initial state: { customerId: null, techId: null, items: [], discount: null, notes: null }
        ├── operator adds/removes/edits items, sets discount, picks customer, picks tech
        └── operator clicks Submit Cash / Submit Gift / Send to Terminal / Split Tender
              └── Server Action invoked with serialized cart
                    ├── SUCCESS → reducer.reset() + router.push(/checkout/<new-id>)
                    └── FAILURE → keep cart in memory; show error toast; operator retries

unmount /checkout
    └── reducer GC'd; cart lost (intentional)
```

### Validation invariants (enforced both client-side for UI affordances and server-side for authority)

- `items.length >= 1` is required to enable any Submit button.
- Each `serviceId` MUST be a UUID; client trusts the catalog picker, server re-validates.
- Each `techId` MUST be a UUID and reference an active staff member; server re-validates.
- `customerId` is nullable; if present MUST be a UUID; server re-validates that the customer exists.
- `discount.percent` is in `[0, 100]`; `discount.amountCents >= 0`.
- `notes` length is bounded (suggested 1000 chars) to prevent runaway text input.

### Serialization

The cart serializes as a plain JSON object (no Date or Map). All fields are primitive or arrays of primitives, suitable for transport across the Server Action boundary without custom serializers.

---

## Server-side: existing tables (UNCHANGED)

Recorded here only as the target of the atomic commit transaction. Schemas come from `supabase/migrations/**`; nothing is modified by this feature.

### `tickets` (existing — `supabase/migrations/0004_checkout_cash_sale.sql` and follow-ups)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | Generated `gen_random_uuid()` |
| `status` | ticket_status | `open`, `paid`, `discarded` (et al.). Created as `paid` for cash/gift commits, `open` for Square Terminal handoff and split-tender init |
| `customer_id` | uuid? | FK → `customers.id`. Nullable for walk-ins |
| `acting_staff_id` | uuid | FK → `staff.id`. The operator running checkout |
| `tech_id` | uuid? | FK → `staff.id`. Cart-level default tech, may be null if every item has its own |
| `subtotal_cents` | bigint | Sum of `ticket_items.line_total_cents` |
| `discount_cents` | bigint | Cart-level discount applied |
| `tip_cents` | bigint | 0 at commit; populated post-terminal-capture or via tip-edit |
| `tax_cents` | bigint | Reserved (Principle V); always 0 in v1 |
| `total_cents` | bigint | `subtotal - discount + tip + tax` |
| `notes` | text? | Cart-level notes |
| `created_at` | timestamptz | Set by DEFAULT |

### `ticket_items` (existing)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `ticket_id` | uuid FK | → `tickets.id` ON DELETE CASCADE |
| `service_id` | uuid FK | → `services.id` |
| `tech_id` | uuid FK | → `staff.id` |
| `display_name_snapshot` | text | Snapshot of `services.name` at commit |
| `price_cents_snapshot` | bigint | Snapshot of `services.price_cents` at commit |
| `duration_minutes_snapshot` | int | Snapshot of `services.duration_minutes` at commit |
| `note` | text? | Per-line note from the cart |
| `line_total_cents` | bigint | Snapshot price * 1 (no quantity in v1) |
| `created_at` | timestamptz | |

Bulk-inserted by the commit Server Action with one row per `EphemeralCart.items[i]`, in array order.

### `payments` (existing — schemas from migrations 0004, 0008, 0012)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `ticket_id` | uuid FK | → `tickets.id` |
| `method` | payment_method | `cash`, `card`, `gift` |
| `kind` | payment_kind | `sale`, `refund` |
| `status` | payment_status | `pending`, `succeeded`, `failed`, `draft` |
| `amount_cents` | bigint | |
| `tip_cents` | bigint | 0 at commit; populated by Square webhook for cards |
| `square_terminal_checkout_id` | text? | For card payments only |
| `created_at` | timestamptz | |

One row created per commit. For split-tender init this is the draft state composed by `pos_compose_payment_draft`.

### `customers` (existing — UNCHANGED)

Referenced from the cart's `customerId`. Per Clarification Q1, new-customer creation writes this table immediately (outside the ephemeral-cart write boundary). The cart only holds an ID reference.

### `audit_log` (existing — UNCHANGED)

No new event types. Existing events (`ticket.paid`, `payment.captured`, `ticket.discarded`, `payment.captured_after_discard`, etc.) fire from inside the existing post-commit code paths exactly as today. The `ticket.created` event for empty open tickets simply stops appearing (because no empty open tickets are created).

---

## State transitions at commit (existing semantics, unchanged)

```text
EphemeralCart (client only)
        │
        │  submitCashFromCart() / submitGiftFromCart()
        ▼
tickets(status='paid') + ticket_items[...] + payments(status='succeeded', method∈{cash,gift})
        │
        ▼
audit_log(action='ticket.paid', 'payment.captured')

EphemeralCart (client only)
        │
        │  sendCardToTerminalFromCart()
        ▼
tickets(status='open') + ticket_items[...] + payments(status='pending', method='card', square_terminal_checkout_id=set)
        │
        │  [Square webhook callback as today]
        ▼
tickets(status='paid') + payments(status='succeeded')
        │
        ▼
audit_log(action='payment.captured', 'ticket.paid')

EphemeralCart (client only)
        │
        │  splitTenderFromCart()
        ▼
tickets(status='open') + ticket_items[...] + initial split-tender draft state
        │
        │  [Existing mid-split-tender UI captures legs as today]
        ▼
tickets(status='paid') + payments[multiple, status='succeeded']
        │
        ▼
audit_log(...)
```
