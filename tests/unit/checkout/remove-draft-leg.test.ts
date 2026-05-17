// @vitest-environment node

// Unit test for `removeDraftLeg` (T033 / T039).
//
// Asserts the Node-side behaviour:
//   - happy path → RPC returns success, action returns {removed: true}.
//   - RPC raises `draft_leg_not_found` (row missing or non-draft) →
//     DraftLegNotFoundError surfaced to the caller.
//
// The audit emission lives inside the RPC (the SQL function inserts a
// `payment.draft_removed` row before DELETing the payment row).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/admin", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireStudioSession: vi.fn(),
}));

import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import { requireStudioSession } from "@/lib/auth/session";

const PAYMENT_ID = "22222222-2222-2222-2222-222222222222";
const STAFF_ID = "10000000-0000-0000-0000-000000000001";

function mockSession() {
  (requireStudioSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    deviceUserId: "00000000-0000-0000-0000-000000000001",
    staff: {
      id: STAFF_ID,
      display_name: "Maya Patel",
      role: "owner",
      color_token: "--avatar-rose",
    },
  });
}

function mockClient(
  rpcImpl: (
    fn: string,
    args: unknown
  ) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>
) {
  const rpcSpy = vi.fn(rpcImpl);
  (createSupabaseServiceRoleClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    rpc: rpcSpy,
    from: vi.fn(),
  });
  return { rpcSpy };
}

describe("removeDraftLeg — Node-layer behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns {removed: true} on a happy delete", async () => {
    const { rpcSpy } = mockClient(async () => ({ data: null, error: null }));

    const { removeDraftLeg } = await import("@/app/(studio)/checkout/actions");
    const result = await removeDraftLeg(PAYMENT_ID);

    expect(result).toEqual({ removed: true });
    expect(rpcSpy).toHaveBeenCalledWith("pos_remove_payment_draft", {
      p_payment_id: PAYMENT_ID,
      p_operator: STAFF_ID,
    });
  });

  it("maps RPC `draft_leg_not_found` to DraftLegNotFoundError", async () => {
    mockClient(async () => ({
      data: null,
      error: { message: "draft_leg_not_found" },
    }));

    const { removeDraftLeg } = await import("@/app/(studio)/checkout/actions");
    const { DraftLegNotFoundError } = await import("@/app/(studio)/checkout/_errors");
    await expect(removeDraftLeg(PAYMENT_ID)).rejects.toBeInstanceOf(DraftLegNotFoundError);
  });

  it("surfaces non-not-found RPC failures as a generic Error", async () => {
    mockClient(async () => ({
      data: null,
      error: { message: "deadlock detected" },
    }));

    const { removeDraftLeg } = await import("@/app/(studio)/checkout/actions");
    const { DraftLegNotFoundError } = await import("@/app/(studio)/checkout/_errors");
    let caught: unknown = null;
    try {
      await removeDraftLeg(PAYMENT_ID);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(DraftLegNotFoundError);
  });
});
