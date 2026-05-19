// Vitest unit suite for `commitCartSchema` — the Zod input contract
// every commit Server Action (US1 cash/gift, US2 card, US3 split) must
// validate against before touching the database. Constitution
// Principle II: server is authoritative; Principle IV: money paths
// are test-driven, so the schema MUST fail loudly on every garbage
// shape before any downstream insert/RPC runs.

import { describe, expect, it } from "vitest";

import { commitCartSchema } from "@/app/(studio)/checkout/_commit-from-cart";

const SERVICE_ID = "11111111-1111-1111-1111-111111111111";
const TECH_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CUSTOMER_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

function validInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    customerId: null,
    techId: TECH_ID,
    items: [
      {
        serviceId: SERVICE_ID,
        techId: TECH_ID,
        note: null,
      },
    ],
    discount: null,
    notes: null,
    ...overrides,
  };
}

describe("commitCartSchema — happy paths", () => {
  it("accepts the minimal valid shape", () => {
    const result = commitCartSchema.safeParse(validInput());
    expect(result.success).toBe(true);
  });

  it("accepts items with an operator-set unitPriceCents (variable-price entry)", () => {
    const input = validInput({
      items: [{ serviceId: SERVICE_ID, techId: TECH_ID, note: null, unitPriceCents: 4500 }],
    });
    const result = commitCartSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("rejects negative unitPriceCents", () => {
    const input = validInput({
      items: [{ serviceId: SERVICE_ID, techId: TECH_ID, note: null, unitPriceCents: -1 }],
    });
    const result = commitCartSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("accepts customerId: null explicitly", () => {
    const result = commitCartSchema.safeParse(validInput({ customerId: null }));
    expect(result.success).toBe(true);
  });

  it("accepts a UUID customerId", () => {
    const result = commitCartSchema.safeParse(validInput({ customerId: CUSTOMER_ID }));
    expect(result.success).toBe(true);
  });

  it("accepts a percent discount at the boundaries", () => {
    expect(
      commitCartSchema.safeParse(validInput({ discount: { kind: "percent", percent: 0 } })).success
    ).toBe(true);
    expect(
      commitCartSchema.safeParse(validInput({ discount: { kind: "percent", percent: 100 } }))
        .success
    ).toBe(true);
  });

  it("accepts an amount discount at zero", () => {
    const result = commitCartSchema.safeParse(
      validInput({ discount: { kind: "amount", amountCents: 0 } })
    );
    expect(result.success).toBe(true);
  });

  it("accepts a note up to 500 chars on items", () => {
    const result = commitCartSchema.safeParse(
      validInput({
        items: [{ serviceId: SERVICE_ID, techId: TECH_ID, note: "x".repeat(500) }],
      })
    );
    expect(result.success).toBe(true);
  });

  it("accepts notes up to 1000 chars", () => {
    const result = commitCartSchema.safeParse(validInput({ notes: "y".repeat(1000) }));
    expect(result.success).toBe(true);
  });
});

describe("commitCartSchema — rejections", () => {
  it("rejects an empty items array", () => {
    const result = commitCartSchema.safeParse(validInput({ items: [] }));
    expect(result.success).toBe(false);
  });

  it("rejects a non-UUID serviceId", () => {
    const result = commitCartSchema.safeParse(
      validInput({
        items: [{ serviceId: "not-a-uuid", techId: TECH_ID, note: null }],
      })
    );
    expect(result.success).toBe(false);
  });

  it("rejects a non-UUID techId on an item", () => {
    const result = commitCartSchema.safeParse(
      validInput({
        items: [{ serviceId: SERVICE_ID, techId: "not-a-uuid", note: null }],
      })
    );
    expect(result.success).toBe(false);
  });

  it("rejects a non-UUID top-level techId", () => {
    const result = commitCartSchema.safeParse(validInput({ techId: "not-a-uuid" }));
    expect(result.success).toBe(false);
  });

  it("rejects a non-UUID customerId (non-null)", () => {
    const result = commitCartSchema.safeParse(validInput({ customerId: "not-a-uuid" }));
    expect(result.success).toBe(false);
  });

  it("rejects percent < 0", () => {
    const result = commitCartSchema.safeParse(
      validInput({ discount: { kind: "percent", percent: -1 } })
    );
    expect(result.success).toBe(false);
  });

  it("rejects percent > 100", () => {
    const result = commitCartSchema.safeParse(
      validInput({ discount: { kind: "percent", percent: 101 } })
    );
    expect(result.success).toBe(false);
  });

  it("rejects negative amountCents", () => {
    const result = commitCartSchema.safeParse(
      validInput({ discount: { kind: "amount", amountCents: -1 } })
    );
    expect(result.success).toBe(false);
  });

  it("rejects non-integer amountCents", () => {
    const result = commitCartSchema.safeParse(
      validInput({ discount: { kind: "amount", amountCents: 12.5 } })
    );
    expect(result.success).toBe(false);
  });

  it("rejects an unknown discount kind", () => {
    const result = commitCartSchema.safeParse(
      validInput({ discount: { kind: "comp", amountCents: 0 } })
    );
    expect(result.success).toBe(false);
  });

  it("rejects a note > 500 chars on an item", () => {
    const result = commitCartSchema.safeParse(
      validInput({
        items: [{ serviceId: SERVICE_ID, techId: TECH_ID, note: "x".repeat(501) }],
      })
    );
    expect(result.success).toBe(false);
  });

  it("rejects notes > 1000 chars", () => {
    const result = commitCartSchema.safeParse(validInput({ notes: "y".repeat(1001) }));
    expect(result.success).toBe(false);
  });
});
