// @vitest-environment node

// Unit test for `composeDraftLeg` (T032 / T038).
//
// Asserts the Node-side behaviour of the action — a thin wrapper around
// `supabase.rpc('pos_compose_payment_draft', …)`:
//
//   - amount <= 0 → LegAmountInvalidError (RPC raises legs_must_fit_remaining)
//   - amount > remaining_owed → LegAmountInvalidError
//   - happy path → returns {paymentId, status:'draft', amountCents} and the
//     RPC's emit-draft_created audit happens inside SQL
//   - racing in-flight (RPC catches via partial unique index, raises 23505)
//     → TicketAlreadyBeingChargedError
//
// We mock the supabase service-role client and requireStudioSession end-to-end.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/admin", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireStudioSession: vi.fn(),
}));

import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import { requireStudioSession } from "@/lib/auth/session";

const TICKET_ID = "11111111-1111-1111-1111-111111111111";
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

describe("composeDraftLeg — Node-layer behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns {paymentId, status:'draft', amountCents} on a happy compose", async () => {
    const { rpcSpy } = mockClient(async () => ({
      data: PAYMENT_ID,
      error: null,
    }));

    const { composeDraftLeg } = await import("@/app/(studio)/checkout/actions");
    const result = await composeDraftLeg(TICKET_ID, "cash", 2000);

    expect(result).toEqual({ paymentId: PAYMENT_ID, status: "draft", amountCents: 2000 });
    expect(rpcSpy).toHaveBeenCalledWith("pos_compose_payment_draft", {
      p_ticket_id: TICKET_ID,
      p_operator: STAFF_ID,
      p_method: "cash",
      p_amount: 2000,
    });
  });

  it("rejects amount <= 0 with LegAmountInvalidError (RPC raises legs_must_fit_remaining)", async () => {
    mockClient(async () => ({
      data: null,
      error: { message: "legs_must_fit_remaining" },
    }));

    const { composeDraftLeg } = await import("@/app/(studio)/checkout/actions");
    const { LegAmountInvalidError } = await import("@/app/(studio)/checkout/_errors");
    await expect(composeDraftLeg(TICKET_ID, "cash", 0)).rejects.toBeInstanceOf(
      LegAmountInvalidError
    );
  });

  it("rejects amount > remaining_owed with LegAmountInvalidError", async () => {
    mockClient(async () => ({
      data: null,
      error: { message: "legs_must_fit_remaining" },
    }));

    const { composeDraftLeg } = await import("@/app/(studio)/checkout/actions");
    const { LegAmountInvalidError } = await import("@/app/(studio)/checkout/_errors");
    await expect(composeDraftLeg(TICKET_ID, "cash", 999_999_999)).rejects.toBeInstanceOf(
      LegAmountInvalidError
    );
  });

  it("maps 23505 unique-violation (in-flight race) to TicketAlreadyBeingChargedError", async () => {
    mockClient(async () => ({
      data: null,
      error: {
        message:
          'duplicate key value violates unique constraint "payments_one_in_flight_per_ticket_idx"',
        code: "23505",
      },
    }));

    const { composeDraftLeg } = await import("@/app/(studio)/checkout/actions");
    const { TicketAlreadyBeingChargedError } = await import("@/app/(studio)/checkout/_errors");
    await expect(composeDraftLeg(TICKET_ID, "cash", 1000)).rejects.toBeInstanceOf(
      TicketAlreadyBeingChargedError
    );
  });
});
