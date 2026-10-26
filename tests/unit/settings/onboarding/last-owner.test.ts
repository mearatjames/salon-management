// Unit tests for the Onboarding last-owner guard (#218).
//
// `isLastActiveOwner` is fed the ids from an unfiltered
// `role='owner' AND active AND removed_at IS NULL` query, so it must only
// report "last owner" when no OTHER active owner exists.

import { describe, expect, it } from "vitest";

import { isLastActiveOwner } from "@/app/(studio)/settings/onboarding/_owners";

describe("isLastActiveOwner", () => {
  it("is false when another active owner exists", () => {
    expect(isLastActiveOwner({ id: "pin-owner", role: "owner" }, ["pin-owner", "me"])).toBe(false);
  });

  it("is true when the target is the only active owner", () => {
    expect(isLastActiveOwner({ id: "me", role: "owner" }, ["me"])).toBe(true);
  });

  it("is true when no active owner is counted at all", () => {
    expect(isLastActiveOwner({ id: "me", role: "owner" }, [])).toBe(true);
  });

  it("counts an owner the roster bucketed elsewhere (e.g. state='invited' or filtered by q)", () => {
    // The other owner isn't in the visible Active bucket, but it IS in the
    // unfiltered active-owner set — so the target is not the last owner.
    expect(isLastActiveOwner({ id: "me", role: "owner" }, ["me", "invited-owner"])).toBe(false);
  });

  it("is always false for non-owners", () => {
    expect(isLastActiveOwner({ id: "m1", role: "manager" }, [])).toBe(false);
  });
});
