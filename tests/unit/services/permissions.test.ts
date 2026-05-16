// Vitest contract test for the services-catalog permission matrix
// (`app/(studio)/settings/services/permissions.ts`).
// See contracts/server-actions.contract.md § Shared prelude.

import { describe, expect, it } from "vitest";

import {
  assertCanWriteCatalog,
  canWriteCatalog,
  PermissionError,
} from "@/app/(studio)/settings/services/permissions";

describe("canWriteCatalog", () => {
  it("returns true for owner and manager", () => {
    expect(canWriteCatalog("owner")).toBe(true);
    expect(canWriteCatalog("manager")).toBe(true);
  });

  it("returns false for technician and front_desk", () => {
    expect(canWriteCatalog("technician")).toBe(false);
    expect(canWriteCatalog("front_desk")).toBe(false);
  });
});

describe("assertCanWriteCatalog", () => {
  it("does not throw for owner / manager", () => {
    expect(() => assertCanWriteCatalog("owner")).not.toThrow();
    expect(() => assertCanWriteCatalog("manager")).not.toThrow();
  });

  it("throws PermissionError with code='forbidden' for technician / front_desk", () => {
    for (const role of ["technician", "front_desk"] as const) {
      try {
        assertCanWriteCatalog(role);
        throw new Error(`expected throw for ${role}`);
      } catch (err) {
        expect(err).toBeInstanceOf(PermissionError);
        expect((err as PermissionError).code).toBe("forbidden");
      }
    }
  });
});
