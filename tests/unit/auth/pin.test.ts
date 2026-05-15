import { describe, expect, it } from "vitest";

import { hashPin, verifyPin } from "@/lib/auth/pin";

describe("lib/auth/pin", () => {
  it("hashPin returns a bcrypt cost-11 hash for the canonical PIN", async () => {
    const hash = await hashPin("1234");
    // bcryptjs uses the $2a$ or $2b$ prefix; cost 11 is encoded after the
    // prefix. Either prefix is acceptable per the contract.
    expect(/^\$2[ab]\$11\$/.test(hash)).toBe(true);
  });

  it("verifyPin returns true for the matching PIN", async () => {
    const hash = await hashPin("1234");
    await expect(verifyPin("1234", hash)).resolves.toBe(true);
  });

  it("verifyPin returns false for a non-matching PIN", async () => {
    const hash = await hashPin("1234");
    await expect(verifyPin("0000", hash)).resolves.toBe(false);
  });

  it(
    "verifyPin times for a matching vs. non-matching PIN are within 2× of each other",
    async () => {
      const hash = await hashPin("1234");

      // Warm up bcryptjs once so the JIT / module-load cost doesn't pollute
      // the comparison.
      await verifyPin("1234", hash);

      const t1Start = performance.now();
      await verifyPin("1234", hash);
      const t1 = performance.now() - t1Start;

      const t2Start = performance.now();
      await verifyPin("0000", hash);
      const t2 = performance.now() - t2Start;

      const ratio = Math.max(t1, t2) / Math.max(Math.min(t1, t2), 1);
      // Generous tolerance — CI variance is significant for ~150 ms hashes.
      expect(ratio).toBeLessThan(2);
    },
    20_000,
  );
});
