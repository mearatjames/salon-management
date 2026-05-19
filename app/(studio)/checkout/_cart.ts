// Pure ephemeral-cart helpers for /checkout (Feature 042).
//
// The cart is in-memory React state — nothing here writes to a server,
// fetches, or imports React. The reducer in `_cart-context.tsx` consumes
// these as building blocks, the preview-total math drives the totals
// strip in the UI, and `commitCartSchema` (see `_commit-from-cart.ts`)
// mirrors the validation invariants on the wire.
//
// Constitution Principle II — server-authoritative — the canonical
// totals at money-time are computed by `resolveCartForCommit`, not
// here. `previewTotals` exists purely so the operator sees an instant
// $ value while building the cart.

/** Variable-price metadata snapshotted from the source service tile at insert
 *  time. Carries the bounds, the operator note, and any preset chips —
 *  everything `<PriceSheet/>` needs to render the context note and the
 *  quick-pick row without a second round trip. `null` for fixed-price
 *  services. */
export type CartItemServiceMeta = {
  variable: boolean;
  priceFromCents: number | null;
  priceToCents: number | null;
  variableNote: string | null;
  presets: Array<{ label: string; price_cents: number }> | null;
};

export type CartItem = {
  /** Stable client-local ID for React reconciliation; never sent to server. */
  localId: string;
  serviceId: string; // uuid
  techId: string; // uuid
  note: string | null;
  displayPriceCents: number;
  displayDurationMinutes: number;
  displayName: string;
  /** True for a variable-priced service that the operator has NOT yet set
   *  a price on. Blocks Take cash + drives the row's "Set price" affordance. */
  priceUnconfirmed: boolean;
  /** Snapshot of the service's variable-pricing metadata at tile-pick time.
   *  Null for fixed-price services. */
  serviceMeta: CartItemServiceMeta | null;
};

export type CartDiscount =
  | { kind: "percent"; percent: number } // 0..100
  | { kind: "amount"; amountCents: number }; // >= 0

export type EphemeralCart = {
  customerId: string | null;
  techId: string | null;
  items: CartItem[];
  discount: CartDiscount | null;
  notes: string | null;
};

export type PreviewTotals = {
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
};

export type BuildCartItemInput = {
  serviceId: string;
  techId: string;
  displayName: string;
  displayPriceCents: number;
  displayDurationMinutes: number;
  note: string | null;
  /** Optional — defaults to false. Set true when the source service is
   *  variable-priced and the operator hasn't picked a price yet. */
  priceUnconfirmed?: boolean;
  /** Optional — defaults to null. Snapshot the variable-pricing metadata
   *  from the source service tile so the PriceSheet can render bounds +
   *  presets without a server round trip. */
  serviceMeta?: CartItemServiceMeta | null;
};

/** The canonical initial cart shape; reducer's reset target. */
export function emptyCart(): EphemeralCart {
  return {
    customerId: null,
    techId: null,
    items: [],
    discount: null,
    notes: null,
  };
}

/** True only when no service tiles have been added. Drives Submit-button disabled. */
export function isCartEmpty(cart: EphemeralCart): boolean {
  return cart.items.length === 0;
}

/**
 * Generate a stable client-local id. Uses `crypto.randomUUID` when
 * available; falls back to a timestamp + counter so unit tests in
 * older environments still get unique ids without pulling a polyfill.
 */
let _localIdCounter = 0;
function nextLocalId(): string {
  const c: { randomUUID?: () => string } | undefined =
    typeof globalThis !== "undefined"
      ? (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
      : undefined;
  if (c?.randomUUID) {
    return c.randomUUID();
  }
  _localIdCounter += 1;
  return `local-${Date.now()}-${_localIdCounter}`;
}

/** Build a fully-shaped CartItem from a picker selection. Snapshots display fields. */
export function buildCartItem(input: BuildCartItemInput): CartItem {
  return {
    localId: nextLocalId(),
    serviceId: input.serviceId,
    techId: input.techId,
    displayName: input.displayName,
    displayPriceCents: input.displayPriceCents,
    displayDurationMinutes: input.displayDurationMinutes,
    note: input.note,
    priceUnconfirmed: input.priceUnconfirmed ?? false,
    serviceMeta: input.serviceMeta ?? null,
  };
}

/** Immutable append. Returns a new cart with the item at the end. */
export function addItem(cart: EphemeralCart, item: CartItem): EphemeralCart {
  return {
    ...cart,
    items: [...cart.items, item],
  };
}

/** Immutable remove-by-localId. Missing id is a no-op (no throw). */
export function removeItem(cart: EphemeralCart, localId: string): EphemeralCart {
  const next = cart.items.filter((i) => i.localId !== localId);
  return {
    ...cart,
    items: next,
  };
}

/**
 * Per-line snapshot of the price that will be sent to the server.
 * V1 cart has no quantity field (the [ticketId] schema stores qty on
 * `ticket_items` but the ephemeral cart fixes qty=1 per row), so this
 * is just `displayPriceCents`. Kept as a helper so the commit resolver
 * and the totals helper agree on a single definition.
 */
export function snapshotLineTotalCents(item: CartItem): number {
  return item.displayPriceCents;
}

/**
 * Pure preview totals for the cart-build screen. Mirrors the server's
 * `resolveCartForCommit` math but operates on display-cached prices so
 * the operator sees an instant total. Discount is rounded to the
 * nearest cent and clamped at the subtotal so totalCents never goes
 * negative.
 */
export function previewTotals(cart: EphemeralCart): PreviewTotals {
  const subtotalCents = cart.items.reduce((acc, item) => acc + snapshotLineTotalCents(item), 0);

  let discountCents = 0;
  if (cart.discount) {
    if (cart.discount.kind === "percent") {
      const pct = cart.discount.percent;
      discountCents = Math.round((subtotalCents * pct) / 100);
    } else {
      discountCents = cart.discount.amountCents;
    }
  }
  // Floor at subtotal: discount must never produce a negative total.
  if (discountCents > subtotalCents) discountCents = subtotalCents;

  return {
    subtotalCents,
    discountCents,
    totalCents: subtotalCents - discountCents,
  };
}

/**
 * Stable content hash of a cart. Used by `_cart-context.tsx` to detect
 * "did the cart change between user gesture and Server Action return"
 * for optimistic-UI rollback. Order-sensitive on items so a reorder
 * counts as a change.
 */
export function cartHash(cart: EphemeralCart): string {
  const parts: string[] = [
    `c:${cart.customerId ?? ""}`,
    `t:${cart.techId ?? ""}`,
    `n:${cart.notes ?? ""}`,
  ];
  if (cart.discount) {
    if (cart.discount.kind === "percent") {
      parts.push(`d:p:${cart.discount.percent}`);
    } else {
      parts.push(`d:a:${cart.discount.amountCents}`);
    }
  } else {
    parts.push("d:");
  }
  for (const item of cart.items) {
    parts.push(
      [
        "i",
        item.serviceId,
        item.techId,
        item.displayPriceCents,
        item.displayDurationMinutes,
        item.priceUnconfirmed ? "u" : "c",
        item.note ?? "",
      ].join(":")
    );
  }
  return parts.join("|");
}
