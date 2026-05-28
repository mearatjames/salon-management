# Data Model: Itemized Square Terminal Checkout

**Feature**: `051-square-itemized-order`

**Migration**: `supabase/migrations/0024_square_order_id.sql`

## New columns

### `payments.square_order_id text null`

| Property | Value |
|---|---|
| Table | `public.payments` |
| Name | `square_order_id` |
| Type | `text` |
| Nullable | `true` (NULL by default) |
| Default | `null` |
| Indexed | No (lookups are by `id` or `square_terminal_checkout_id`; this column is for audit/support only) |
| RLS | Inherits from `payments` (`select to authenticated using (true)`; writes via service role) |

**Purpose**: Audit-trace pointer from a Tang Nails `payment` row to its corresponding Square Order. Populated only on the single-tender card path (FR-001); NULL on the split-tender card-leg path, on cash, and on gift-card payments.

**Lifecycle**:
- `NULL` at row insert (current behavior preserved).
- Set to `order.id` from the `orders.create` response immediately after that call returns, before `terminal.checkouts.create` runs. (If the subsequent terminal-create fails, the column still carries the Order id so support can locate the cancellation attempt in the logs.)
- Never updated after the initial set.

**Validation**: No CHECK constraint. The application sets it only after Square confirms an Order id; if Square ever returned an empty id, the action throws before the column is set (existing precedent in `lib/square/terminal.ts:140`).

**Audit-log payload extension**: the existing `payment.created`, `payment.succeeded`, and `payment.failed` audit events gain a `square_order_id` key inside the `payload` JSONB whenever the column on the related payment row is non-null. Controlled-vocabulary `action` values are unchanged (Constitution Principle III).

---

### `square_oauth.location_id text null`

| Property | Value |
|---|---|
| Table | `public.square_oauth` |
| Name | `location_id` |
| Type | `text` |
| Nullable | `true` (NULL by default) |
| Default | `null` |
| Indexed | No (single-row table; the singleton row is keyed by the `id boolean primary key` pattern from `0008_square_terminal_payment.sql`) |
| RLS | Inherits from `square_oauth` (service-role-only) |

**Purpose**: Cache of the salon's primary Square `Location.id`, required by `orders.create`. Populated lazily on first itemized checkout; reused for every subsequent itemized checkout per Research R1.

**Lifecycle**:
- `NULL` after the migration applies (existing connections).
- On the first `sendCardToTerminal` invocation that takes the single-tender path: `lib/square/oauth.ts → getSquareLocationId()` reads this column; if NULL, calls `client.locations.get({ locationId: "main" })`, takes the returned `location.id`, writes it back to the row, and returns it. Subsequent calls read the cached value.
- Refreshed only if explicitly invalidated (not implemented in v1 — a salon never changes its primary location; if they do, the operator disconnects and reconnects Square via the existing Settings flow, which would re-run OAuth and at that point a future enhancement can repopulate this column).

**Validation**: No CHECK constraint. The helper throws if Square returns no main location (impossible for a real connected account).

---

## Existing entities referenced (no schema change)

The mapping in `lib/square/orders.ts → mapTicketItemsToOrderLineItems` reads the following fields. None are mutated by this feature; they are listed here so reviewers can verify the mapping against the migration set on `main`.

### `ticket_items`

Defined in `supabase/migrations/0004_checkout_cash_sale.sql` and extended by `0006_add_discount_enum_value.sql` (adds `'discount'` to `public.ticket_item_kind`) and `0023_per_service_discount_scope.sql` (adds `discount_target_line_ids uuid[] null`).

| Column | Type | Use in this feature |
|---|---|---|
| `id` | `uuid` | Becomes `OrderLineItem.uid` (or `Order.discounts[].uid`) inside the Order. Stable, unique within the row's parent ticket — safe as a Square `uid`. |
| `ticket_id` | `uuid → tickets.id` | Drives the `select` that hydrates the Order's line items. |
| `kind` | `ticket_item_kind` enum (`'service' \| 'discount'`) | Routes the row to `lineItems[]` (`'service'`) or `discounts[]` + `appliedDiscounts[]` (`'discount'`). |
| `ref_id` | `uuid → services.id` | Used internally only — Square does not see the Tang Nails service id. Out of scope per the issue's "No Square Catalog sync needed" stance. |
| `name_snapshot` | `text` | Becomes `OrderLineItem.name` (services) or `OrderLineItemDiscount.name` (discounts). |
| `unit_price_cents` | `int` (≥ 0; on discount rows the value is stored as a magnitude — actual sign is implicit in `kind='discount'`. Confirmed via comment at `app/(studio)/checkout/actions.ts:143`) | Becomes `OrderLineItem.basePriceMoney.amount` (services) or `OrderLineItemDiscount.amountMoney.amount` (discounts). Sign normalization happens inside the mapping helper. |
| `qty` | `int` (≥ 1) | Becomes `OrderLineItem.quantity` (stringified per the Square SDK type). |
| `discount_target_line_ids` | `uuid[] null` | When non-null on a `kind='discount'` row, the discount is mapped as `scope: 'LINE_ITEM'` and each targeted `lineItem` receives an `appliedDiscounts` entry. When null, the discount is mapped as `scope: 'ORDER'`. |
| `assigned_staff_id`, `price_unconfirmed`, `created_at` | — | Not read by the mapping helper. |

### `payments` (existing columns surveyed for context)

| Column | Notes |
|---|---|
| `id` | Already used in idempotency key derivation. |
| `ticket_id` | Already used to scope the `ticket_items` fetch. |
| `square_terminal_checkout_id` | Existing — set by today's success branch in `sendCardToTerminal`. |
| `square_payment_id` | Existing — set by the webhook handler on success. |
| `amount_cents`, `status`, `failure_reason`, `processed_at` | Existing — unchanged. |
| **`square_order_id`** (new) | Per the migration above. |

### `square_oauth` (existing columns surveyed for context)

| Column | Notes |
|---|---|
| `id` | `boolean primary key` — singleton row pattern. |
| `merchant_id`, `merchant_name` | Existing — captured at OAuth. |
| `access_token_encrypted`, `refresh_token_encrypted`, `expires_at` | Existing — used by `readDecryptedTokens()`. |
| **`location_id`** (new) | Per the migration above. |
| `refresh_failed_at` | Existing — preserved. |

---

## Validation rules introduced by the mapping helper

These live in code (`lib/square/orders.ts`) not in the schema; documented here so the unit tests can target them.

1. **Discount sign normalization**: when reading `unit_price_cents` from a `kind='discount'` row, the helper takes the absolute value before emitting the Square `amountMoney.amount`. (Tang Nails stores discounts with negative `unit_price_cents`; Square requires positive amounts on discount entities.)
2. **Zero-amount discount skip**: a discount row whose `abs(unit_price_cents) === 0` is omitted from the Order's discounts array. (Square rejects zero-amount discount entries with `400 INVALID_FIELD_VALUE`.) Service line items at $0 are *not* skipped.
3. **Empty-quantity guard**: a service row with `qty < 1` is impossible (DB-level CHECK at `0004_checkout_cash_sale.sql:130` already forbids it), but the helper defensively throws if it sees one.
4. **Empty line-items guard**: the helper throws if the resulting `lineItems` array is empty. By spec invariant ("Ticket containing only a discount … cannot occur"), this is a contract violation, not a runtime case.
5. **`uid` collision check**: the helper asserts that all emitted `uid` values are unique within the Order (they're sourced from `ticket_items.id` which is a unique PK, so this is a tautology — the assertion exists to catch future refactors that derive `uid` differently).
6. **Targeted-discount sanity check**: when `discount_target_line_ids` is non-null, every uuid in that array MUST appear as a `lineItems[i].uid`. The helper throws if any target id doesn't resolve to a service line on the same ticket (defensive — `0023_per_service_discount_scope.sql:36` already enforces this at insert/update time).
