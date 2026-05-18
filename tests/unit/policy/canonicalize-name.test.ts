// Vitest contract test for `lib/policy/canonicalize-name.ts`.
//
// Covers `data-model.md § 3.3`: trim + lowercase + collapse internal
// whitespace.

import { describe, expect, it } from "vitest";

import { canonicalizeName } from "@/lib/policy/canonicalize-name";

describe("canonicalizeName", () => {
  it("lowercases and preserves single-space form", () => {
    expect(canonicalizeName("GelX tips & gel")).toBe("gelx tips & gel");
  });

  it("trims and collapses internal whitespace", () => {
    expect(canonicalizeName("  GelX  tips  &  gel  ")).toBe("gelx tips & gel");
  });

  it("lowercases free Unicode (accented characters)", () => {
    expect(canonicalizeName("CAFÉ")).toBe("café");
  });

  it("handles a single character", () => {
    expect(canonicalizeName("A")).toBe("a");
  });

  it("returns empty string for empty input", () => {
    expect(canonicalizeName("")).toBe("");
  });
});
