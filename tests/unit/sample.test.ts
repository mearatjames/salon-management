import { describe, expect, it } from "vitest";

describe("vitest runner", () => {
  it("runs a trivial passing assertion", () => {
    expect(1 + 1).toBe(2);
  });
});
