import { describe, expect, it } from "vitest";

import { sanitizeNext, STUDIO_PREFIXES } from "@/lib/auth/next-url";

describe("lib/auth/next-url", () => {
  describe("STUDIO_PREFIXES", () => {
    it("enumerates the studio prefixes (research R6 + 008-services-catalog)", () => {
      expect(new Set(STUDIO_PREFIXES)).toEqual(
        new Set([
          "/dashboard",
          "/calendar",
          "/checkout",
          "/clients",
          "/services",
          "/walkin",
          "/end-of-day",
          "/settings",
        ])
      );
    });
  });

  describe("sanitizeNext", () => {
    const ACCEPT = [
      "/dashboard",
      "/calendar/2026-05-15",
      "/checkout/abc-123",
      "/clients",
      "/services",
      "/walkin",
      "/end-of-day",
      "/settings/staff",
    ];

    for (const raw of ACCEPT) {
      it(`accepts ${JSON.stringify(raw)}`, () => {
        expect(sanitizeNext(raw)).toBe(raw);
      });
    }

    const REJECT_TO_DASHBOARD: Array<string | null | undefined> = [
      "//evil.com",
      "https://evil.com",
      "javascript:alert(1)",
      "/admin",
      "/login",
      null,
      "",
      undefined,
    ];

    for (const raw of REJECT_TO_DASHBOARD) {
      it(`rejects ${JSON.stringify(raw)} → /dashboard`, () => {
        expect(sanitizeNext(raw)).toBe("/dashboard");
      });
    }
  });
});
