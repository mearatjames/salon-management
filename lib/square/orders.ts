// lib/square/orders.ts
//
// Server-only wrapper around the Square Orders API surface used by
// feature 051 (Itemized Square Terminal Checkout).
//
// Two public exports:
//   - `mapTicketItemsToOrderLineItems(rows)` — pure, referentially
//     transparent helper that translates `ticket_items` rows into the
//     `{ lineItems, discounts }` payload Square's Orders API expects.
//   - `createOrder({ ticketId, paymentId, locationId, ticketItems })` —
//     sends `POST /v2/orders` via the Square SDK and returns the
//     `{ orderId, orderVersion }` pair. Phase 5's `cancelOrder` will
//     piggyback on this module.
//
// Idempotency contract (research R6 / FR-006): `createOrder` MUST pass
// the SAME `buildIdempotencyKey(ticketId, paymentId)` as
// `lib/square/terminal.ts::createCheckout`. Square namespaces
// idempotency keys per endpoint, so a retried `sendCardToTerminal`
// (same `paymentId`) collapses both calls to the same Order and the
// same Checkout.
//
// Constitution Principle II (Server-only Square SDK): this file imports
// `lib/square/client` and `lib/square/oauth` — both server-only. The
// `tests/unit/square/client-import-graph.test.ts` enforces that no
// `*.client.tsx` imports from `lib/square/*`.

import { getSquareClient } from "@/lib/square/client";
import { readDecryptedTokens } from "@/lib/square/oauth";
import { buildIdempotencyKey } from "@/lib/square/terminal";

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------

/**
 * The fields the mapping helper reads from `ticket_items`. Sourced from
 * `data-model.md → ticket_items`. `unit_price_cents` is a magnitude on
 * service rows (≥ 0) and a negative integer on discount rows
 * (`unit_price_cents <= 0` per `0007_cart_polish.sql`); the helper takes
 * `Math.abs` defensively before emitting the Square amount.
 */
export type TicketItemRow = {
  id: string;
  kind: "service" | "discount";
  name_snapshot: string;
  unit_price_cents: number;
  qty: number;
  discount_target_line_ids: string[] | null;
};

export type OrderLineItem = {
  uid: string;
  name: string;
  basePriceMoney: { amount: bigint; currency: "USD" };
  quantity: string;
  appliedDiscounts?: Array<{ discountUid: string }>;
};

export type OrderLineItemDiscount = {
  uid: string;
  name: string;
  amountMoney: { amount: bigint; currency: "USD" };
  scope: "ORDER" | "LINE_ITEM";
};

export type OrderPayload = {
  lineItems: OrderLineItem[];
  discounts: OrderLineItemDiscount[] | undefined;
};

export type CreateOrderInput = {
  ticketId: string;
  paymentId: string;
  locationId: string;
  ticketItems: TicketItemRow[];
};

export type CreateOrderResult = {
  orderId: string;
  orderVersion: number;
};

/**
 * Phase 5 (US3) — input to `cancelOrder`. `orderVersion` is the
 * `version` field from the `CreateOrderResult`; Square requires it on
 * every update to OCC-guard the row. `locationId` is required by
 * Square's Orders API (it's part of the Order's natural key).
 */
export type CancelOrderInput = {
  orderId: string;
  orderVersion: number;
  locationId: string;
};

/**
 * Raised by `mapTicketItemsToOrderLineItems` when, after filtering, the
 * resulting `lineItems` array would be empty. By spec invariant
 * ("Ticket containing only a discount … cannot occur") this is a
 * contract violation rather than a runtime case; `sendCardToTerminal`
 * catches it and translates to `SquareCheckoutCreateFailedError` so the
 * operator-facing error vocabulary stays stable.
 */
export class EmptyOrderError extends Error {
  constructor() {
    super("Cannot create an Order with zero line items");
    this.name = "EmptyOrderError";
  }
}

// ---------------------------------------------------------------------
// mapTicketItemsToOrderLineItems — pure mapping
// ---------------------------------------------------------------------

/**
 * Translate the rows backing a Tang Nails ticket into the
 * `{ lineItems, discounts }` payload Square's Orders API expects.
 * Rules per `data-model.md § Validation rules` 1–6:
 *   1. Discount sign normalization (`Math.abs(unit_price_cents)`).
 *   2. Zero-amount discounts skipped silently.
 *   3. Service `qty < 1` is a DB-level impossibility — defensive throw.
 *   4. Empty resulting `lineItems` throws `EmptyOrderError`.
 *   5. Emitted `uid`s must be unique (tautology — sourced from
 *      `ticket_items.id`; assertion guards against future refactors).
 *   6. Each `discount_target_line_ids` uuid must resolve to a service
 *      `lineItem.uid` on the same ticket.
 *
 * Referentially transparent: same input ⇒ same output. No I/O.
 */
export function mapTicketItemsToOrderLineItems(rows: TicketItemRow[]): OrderPayload {
  const lineItems: OrderLineItem[] = [];
  // Track applied discounts in insertion order per-service so we can attach
  // them to each `lineItem` in a final pass without mutating mid-build.
  const appliedDiscountsByServiceUid = new Map<string, Array<{ discountUid: string }>>();
  const discounts: OrderLineItemDiscount[] = [];

  // First pass — build the service `lineItems` and capture each
  // service uid so we can validate targeted-discount references in
  // the second pass.
  for (const row of rows) {
    if (row.kind !== "service") continue;
    if (row.qty < 1) {
      throw new Error(
        `mapTicketItemsToOrderLineItems: service row ${row.id} has invalid qty=${row.qty}`
      );
    }
    lineItems.push({
      uid: row.id,
      name: row.name_snapshot,
      basePriceMoney: {
        amount: BigInt(row.unit_price_cents),
        currency: "USD",
      },
      quantity: String(row.qty),
    });
  }

  const serviceUids = new Set(lineItems.map((li) => li.uid));

  // Second pass — discounts.
  for (const row of rows) {
    if (row.kind !== "discount") continue;
    // Rule 1 — magnitude.
    const magnitude = Math.abs(row.unit_price_cents);
    // Rule 2 — skip zero-amount discounts.
    if (magnitude === 0) continue;

    const targets = row.discount_target_line_ids;
    if (targets !== null) {
      // Rule 6 — every target uuid must resolve to a service uid.
      for (const targetUid of targets) {
        if (!serviceUids.has(targetUid)) {
          throw new Error(
            `mapTicketItemsToOrderLineItems: discount ${row.id} targets uid ${targetUid} which is not a service on this ticket`
          );
        }
      }
      discounts.push({
        uid: row.id,
        name: row.name_snapshot,
        amountMoney: { amount: BigInt(magnitude), currency: "USD" },
        scope: "LINE_ITEM",
      });
      for (const targetUid of targets) {
        const list = appliedDiscountsByServiceUid.get(targetUid) ?? [];
        list.push({ discountUid: row.id });
        appliedDiscountsByServiceUid.set(targetUid, list);
      }
    } else {
      discounts.push({
        uid: row.id,
        name: row.name_snapshot,
        amountMoney: { amount: BigInt(magnitude), currency: "USD" },
        scope: "ORDER",
      });
    }
  }

  // Rule 4 — empty-lineItems guard. Must run AFTER we've finished
  // populating `lineItems` and consumed discount rows.
  if (lineItems.length === 0) {
    throw new EmptyOrderError();
  }

  // Attach `appliedDiscounts` to the matching lineItems.
  for (const li of lineItems) {
    const applied = appliedDiscountsByServiceUid.get(li.uid);
    if (applied && applied.length > 0) {
      li.appliedDiscounts = applied;
    }
  }

  // Rule 5 — uid uniqueness across lineItems + discounts.
  const seenUids = new Set<string>();
  for (const li of lineItems) {
    if (seenUids.has(li.uid)) {
      throw new Error(
        `mapTicketItemsToOrderLineItems: duplicate uid ${li.uid} across emitted Order entries`
      );
    }
    seenUids.add(li.uid);
  }
  for (const d of discounts) {
    if (seenUids.has(d.uid)) {
      throw new Error(
        `mapTicketItemsToOrderLineItems: duplicate uid ${d.uid} across emitted Order entries`
      );
    }
    seenUids.add(d.uid);
  }

  return {
    lineItems,
    // Rule per contract: emit `undefined` (not `[]`) when there are no
    // discounts so `createOrder` can omit the key entirely.
    discounts: discounts.length === 0 ? undefined : discounts,
  };
}

// ---------------------------------------------------------------------
// createOrder — Square SDK wrapper
// ---------------------------------------------------------------------

/**
 * Send `POST /v2/orders` for a single-tender card sale. Mirrors the
 * `createCheckout` precedent in `lib/square/terminal.ts`:
 *   - reads tokens via `readDecryptedTokens()` per call;
 *   - throws a typed-ish `Error` when no connection exists;
 *   - passes `idempotencyKey = buildIdempotencyKey(ticketId, paymentId)`
 *     so retried `sendCardToTerminal` calls collapse to the same Order;
 *   - returns the `{ orderId, orderVersion }` pair the action persists
 *     onto `payments.square_order_id` and threads to the Phase 5
 *     orphan-cancel path.
 *
 * Per Research R2: we explicitly disable Square's auto-apply logic
 * (`pricingOptions.autoApplyTaxes: false`, `autoApplyDiscounts: false`)
 * and send `taxes: []` so Square never inflates the total beyond what
 * Tang Nails computed locally (US3 / SC-004).
 */
export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  const { ticketId, paymentId, locationId, ticketItems } = input;

  const connection = await readDecryptedTokens();
  if (!connection) {
    throw new Error("createOrder: Square not connected");
  }

  const { lineItems, discounts } = mapTicketItemsToOrderLineItems(ticketItems);

  const client = getSquareClient(connection.accessToken);
  const idempotencyKey = buildIdempotencyKey(ticketId, paymentId);

  // Construct the request body manually so the test-mocked fake sees a
  // stable arg shape, and so the `discounts` key is omitted entirely
  // (per contract) when there are no discount rows.
  const order: Record<string, unknown> = {
    locationId,
    referenceId: ticketId,
    lineItems,
    taxes: [],
    pricingOptions: { autoApplyTaxes: false, autoApplyDiscounts: false },
  };
  if (discounts) {
    order.discounts = discounts;
  }

  const response = (await client.orders.create({
    idempotencyKey,
    // SDK request typing accepts the shape; tests assert on it directly.
    order,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)) as unknown as { order?: { id?: string; version?: number } };

  const orderId = response.order?.id;
  if (!orderId) {
    throw new Error("createOrder: Square response missing order.id");
  }
  return {
    orderId,
    orderVersion: response.order?.version ?? 1,
  };
}

// ---------------------------------------------------------------------
// cancelOrder — best-effort orphan cleanup (Phase 5 / US3)
// ---------------------------------------------------------------------

/**
 * Best-effort cancel of an Order that was minted by `createOrder` but
 * whose paired Terminal checkout failed to launch (`sendCardToTerminal`
 * caller pattern). The action wraps this call in `try/catch` and never
 * surfaces the error — the orphan staying in Square's dashboard is the
 * acceptable failure mode (support has the id on `payments.square_order_id`).
 *
 * Idempotent at Square's end — calling on an already-CANCELED Order
 * returns the same state without erroring (Research R7).
 *
 * Wire shape per `contracts/lib-square-orders.md` and Research R7:
 *   client.orders.update({
 *     orderId,
 *     order: { locationId, version: orderVersion, state: 'CANCELED' },
 *   })
 */
export async function cancelOrder(input: CancelOrderInput): Promise<void> {
  const { orderId, orderVersion, locationId } = input;

  const connection = await readDecryptedTokens();
  if (!connection) {
    throw new Error("cancelOrder: Square not connected");
  }

  const client = getSquareClient(connection.accessToken);

  await client.orders.update({
    orderId,
    // Square's typed shape accepts `version` + `state` on the Order body;
    // tests assert on the wire payload directly.
    order: {
      locationId,
      version: orderVersion,
      state: "CANCELED",
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}
