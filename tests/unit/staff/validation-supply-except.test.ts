// Vitest contract test for `validateSupplyExcept` in
// `app/(studio)/settings/staff/_validation.ts`. Per data-model.md § 3.2 the
// validator:
//   - dedupes duplicate ids via Set
//   - drops non-string entries silently
//   - trims whitespace
//   - drops unknown ids silently (allowedIds gate — FR-012 stale-tab defense)
//   - returns [] for an empty array
//   - throws `ValidationError("invalid_supply_except_shape")` when input is
//     not an array
//   - truncates silently at 64 entries (hard cap per data-model.md)
//
// Test-first per SC-007 traceability.

import { describe, expect, it } from "vitest";

import { ValidationError, validateSupplyExcept } from "@/app/(studio)/settings/staff/_validation";

const ID_A = "11111111-1111-1111-1111-111111111111";
const ID_B = "22222222-2222-2222-2222-222222222222";
const ID_C = "33333333-3333-3333-3333-333333333333";
const ID_UNKNOWN = "99999999-9999-9999-9999-999999999999";

describe("validateSupplyExcept", () => {
  it("returns [] when input is an empty array", () => {
    expect(validateSupplyExcept([], new Set([ID_A]))).toEqual([]);
  });

  it("dedupes duplicate ids via Set", () => {
    const allowed = new Set([ID_A, ID_B]);
    const out = validateSupplyExcept([ID_A, ID_A, ID_B, ID_A], allowed);
    expect(out).toHaveLength(2);
    expect(new Set(out)).toEqual(new Set([ID_A, ID_B]));
  });

  it("drops non-string entries silently", () => {
    const allowed = new Set([ID_A]);
    // Cast through unknown so the validator's runtime shape check kicks in.
    const raw = [ID_A, 42, null, undefined, { id: ID_A }] as unknown as readonly string[];
    expect(validateSupplyExcept(raw, allowed)).toEqual([ID_A]);
  });

  it("trims whitespace before allowedIds lookup", () => {
    const allowed = new Set([ID_A]);
    expect(validateSupplyExcept([`  ${ID_A}  `], allowed)).toEqual([ID_A]);
  });

  it("drops unknown ids silently (stale-tab defense per FR-012)", () => {
    const allowed = new Set([ID_A, ID_B]);
    expect(validateSupplyExcept([ID_A, ID_UNKNOWN, ID_B], allowed)).toEqual(
      expect.arrayContaining([ID_A, ID_B])
    );
    const out = validateSupplyExcept([ID_A, ID_UNKNOWN, ID_B], allowed);
    expect(out).not.toContain(ID_UNKNOWN);
  });

  it("throws invalid_supply_except_shape when input is not an array", () => {
    const allowed = new Set([ID_A]);
    for (const bad of [null, undefined, "not-an-array", 42, { length: 1, 0: ID_A }]) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        validateSupplyExcept(bad as any, allowed);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        expect((err as ValidationError).code).toBe("invalid_supply_except_shape");
      }
    }
  });

  it("truncates silently at the 64-entry cap", () => {
    const allowed = new Set<string>();
    const many: string[] = [];
    for (let i = 0; i < 100; i++) {
      const id = `aaaaaaaa-aaaa-aaaa-aaaa-${i.toString().padStart(12, "0")}`;
      allowed.add(id);
      many.push(id);
    }
    const out = validateSupplyExcept(many, allowed);
    expect(out).toHaveLength(64);
  });

  it("keeps ID_C when it is in allowedIds and not in input", () => {
    // Sanity: the validator does NOT add allowedIds — it only filters.
    const allowed = new Set([ID_A, ID_B, ID_C]);
    expect(validateSupplyExcept([ID_A], allowed)).toEqual([ID_A]);
  });
});
