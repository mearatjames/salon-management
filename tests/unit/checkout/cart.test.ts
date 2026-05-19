// Vitest unit suite for the pure ephemeral-cart helpers used by
// /checkout (Feature 042). The client cart is an in-memory React state
// shape with NO server writes until the operator submits payment.
// These helpers are the source of truth for:
//   - the empty-cart predicate (drives Submit-button disabled state)
//   - the add/remove immutability invariant (reducer correctness)
//   - the preview-total math (subtotal, percent discount, amount discount)
//   - the line-total snapshotting helper (used by `commitCartSchema`'s
//     resolver to mirror server math for the optimistic preview)
//
// Constitution Principle IV: money paths are test-driven. These tests
// MUST land + fail before `_cart.ts` exists.

import { describe, expect, it } from "vitest";

import {
  type CartDiscount,
  type CartItem,
  type EphemeralCart,
  addItem,
  buildCartItem,
  emptyCart,
  isCartEmpty,
  previewTotals,
  removeItem,
  snapshotLineTotalCents,
} from "@/app/(studio)/checkout/_cart";

const SERVICE_A = "11111111-1111-1111-1111-111111111111";
const SERVICE_B = "22222222-2222-2222-2222-222222222222";
const TECH_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TECH_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function makeItem(overrides: Partial<CartItem> = {}): CartItem {
  return buildCartItem({
    serviceId: SERVICE_A,
    techId: TECH_A,
    displayName: "Gel manicure",
    displayPriceCents: 4500,
    displayDurationMinutes: 45,
    note: null,
    ...overrides,
  });
}

describe("emptyCart / isCartEmpty", () => {
  it("emptyCart returns the canonical initial shape", () => {
    expect(emptyCart()).toEqual({
      customerId: null,
      techId: null,
      items: [],
      discount: null,
      notes: null,
    } satisfies EphemeralCart);
  });

  it("isCartEmpty is true for the initial cart", () => {
    expect(isCartEmpty(emptyCart())).toBe(true);
  });

  it("isCartEmpty is false once any item is present", () => {
    const cart = addItem(emptyCart(), makeItem());
    expect(isCartEmpty(cart)).toBe(false);
  });
});

describe("buildCartItem", () => {
  it("assigns a stable, client-local id distinct per call", () => {
    const a = buildCartItem({
      serviceId: SERVICE_A,
      techId: TECH_A,
      displayName: "Gel",
      displayPriceCents: 4500,
      displayDurationMinutes: 45,
      note: null,
    });
    const b = buildCartItem({
      serviceId: SERVICE_A,
      techId: TECH_A,
      displayName: "Gel",
      displayPriceCents: 4500,
      displayDurationMinutes: 45,
      note: null,
    });
    expect(a.localId).toBeTruthy();
    expect(b.localId).toBeTruthy();
    expect(a.localId).not.toBe(b.localId);
  });

  it("preserves the input fields verbatim onto the item", () => {
    const item = buildCartItem({
      serviceId: SERVICE_A,
      techId: TECH_B,
      displayName: "Pedicure",
      displayPriceCents: 6000,
      displayDurationMinutes: 60,
      note: "client requested rose token",
    });
    expect(item.serviceId).toBe(SERVICE_A);
    expect(item.techId).toBe(TECH_B);
    expect(item.displayName).toBe("Pedicure");
    expect(item.displayPriceCents).toBe(6000);
    expect(item.displayDurationMinutes).toBe(60);
    expect(item.note).toBe("client requested rose token");
  });
});

describe("addItem / removeItem immutability", () => {
  it("addItem returns a new cart object and does NOT mutate the input", () => {
    const before = emptyCart();
    const item = makeItem();
    const after = addItem(before, item);

    expect(after).not.toBe(before);
    expect(after.items).not.toBe(before.items);
    expect(before.items).toHaveLength(0);
    expect(after.items).toHaveLength(1);
    expect(after.items[0]).toBe(item);
  });

  it("addItem appends in order", () => {
    const a = makeItem({ displayName: "A" });
    const b = makeItem({ displayName: "B" });
    const cart = addItem(addItem(emptyCart(), a), b);
    expect(cart.items.map((i) => i.displayName)).toEqual(["A", "B"]);
  });

  it("removeItem returns a new cart without the targeted localId", () => {
    const a = makeItem({ displayName: "A" });
    const b = makeItem({ displayName: "B" });
    const c = makeItem({ displayName: "C" });
    const cart = addItem(addItem(addItem(emptyCart(), a), b), c);

    const after = removeItem(cart, b.localId);

    expect(after).not.toBe(cart);
    expect(after.items).not.toBe(cart.items);
    expect(cart.items).toHaveLength(3);
    expect(after.items).toHaveLength(2);
    expect(after.items.map((i) => i.localId)).toEqual([a.localId, c.localId]);
  });

  it("removeItem on a missing localId returns an equivalent shape (no throw)", () => {
    const cart = addItem(emptyCart(), makeItem());
    const after = removeItem(cart, "does-not-exist");
    expect(after.items).toHaveLength(1);
  });
});

describe("previewTotals — no discount", () => {
  it("empty cart → all zeros", () => {
    const totals = previewTotals(emptyCart());
    expect(totals).toEqual({
      subtotalCents: 0,
      discountCents: 0,
      totalCents: 0,
    });
  });

  it("sums displayPriceCents across items", () => {
    let cart = emptyCart();
    cart = addItem(cart, makeItem({ displayPriceCents: 4500 }));
    cart = addItem(cart, makeItem({ serviceId: SERVICE_B, displayPriceCents: 6000 }));
    expect(previewTotals(cart)).toEqual({
      subtotalCents: 10500,
      discountCents: 0,
      totalCents: 10500,
    });
  });
});

describe("previewTotals — percent discount", () => {
  it("applies a 10% discount, rounding the discount to the nearest cent", () => {
    let cart = emptyCart();
    cart = addItem(cart, makeItem({ displayPriceCents: 4500 }));
    cart = addItem(cart, makeItem({ serviceId: SERVICE_B, displayPriceCents: 6000 }));
    const discount: CartDiscount = { kind: "percent", percent: 10 };
    cart = { ...cart, discount };
    // 10% of 10500 = 1050.
    expect(previewTotals(cart)).toEqual({
      subtotalCents: 10500,
      discountCents: 1050,
      totalCents: 9450,
    });
  });

  it("0% percent discount is a no-op", () => {
    let cart = emptyCart();
    cart = addItem(cart, makeItem({ displayPriceCents: 4500 }));
    cart = { ...cart, discount: { kind: "percent", percent: 0 } };
    expect(previewTotals(cart)).toEqual({
      subtotalCents: 4500,
      discountCents: 0,
      totalCents: 4500,
    });
  });

  it("100% percent discount zeroes the total", () => {
    let cart = emptyCart();
    cart = addItem(cart, makeItem({ displayPriceCents: 4500 }));
    cart = { ...cart, discount: { kind: "percent", percent: 100 } };
    expect(previewTotals(cart)).toEqual({
      subtotalCents: 4500,
      discountCents: 4500,
      totalCents: 0,
    });
  });

  it("rounds half-cents to nearest (33% of 1000)", () => {
    let cart = emptyCart();
    cart = addItem(cart, makeItem({ displayPriceCents: 1000 }));
    cart = { ...cart, discount: { kind: "percent", percent: 33 } };
    const totals = previewTotals(cart);
    expect(totals.subtotalCents).toBe(1000);
    // 33% of 1000 = 330. The helper must NOT produce fractional cents.
    expect(Number.isInteger(totals.discountCents)).toBe(true);
    expect(totals.discountCents).toBe(330);
    expect(totals.totalCents).toBe(670);
  });
});

describe("previewTotals — amount discount", () => {
  it("subtracts a fixed amount from the subtotal", () => {
    let cart = emptyCart();
    cart = addItem(cart, makeItem({ displayPriceCents: 4500 }));
    cart = { ...cart, discount: { kind: "amount", amountCents: 500 } };
    expect(previewTotals(cart)).toEqual({
      subtotalCents: 4500,
      discountCents: 500,
      totalCents: 4000,
    });
  });

  it("floors the total at 0 when discount > subtotal (over-discount safety)", () => {
    let cart = emptyCart();
    cart = addItem(cart, makeItem({ displayPriceCents: 1000 }));
    cart = { ...cart, discount: { kind: "amount", amountCents: 9999 } };
    const totals = previewTotals(cart);
    expect(totals.subtotalCents).toBe(1000);
    // discount is capped at subtotal so totalCents never goes negative.
    expect(totals.discountCents).toBe(1000);
    expect(totals.totalCents).toBe(0);
  });

  it("zero amount discount is a no-op", () => {
    let cart = emptyCart();
    cart = addItem(cart, makeItem({ displayPriceCents: 4500 }));
    cart = { ...cart, discount: { kind: "amount", amountCents: 0 } };
    expect(previewTotals(cart)).toEqual({
      subtotalCents: 4500,
      discountCents: 0,
      totalCents: 4500,
    });
  });
});

describe("snapshotLineTotalCents", () => {
  it("returns the line's displayPriceCents (no qty multiplication for v1)", () => {
    const item = makeItem({ displayPriceCents: 4500 });
    expect(snapshotLineTotalCents(item)).toBe(4500);
  });
});
