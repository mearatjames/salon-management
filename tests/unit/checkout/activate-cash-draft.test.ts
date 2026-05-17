// @vitest-environment node

// Unit test for `activateCashDraft` (T034 / T040).
//
// Asserts the Node-side behaviour around `pos_activate_cash_draft`:
//   - happy path → returns {paymentId, status:'succeeded', ticketFlippedToPaid: bool}
//     mirroring the RPC's return shape.
//   - RPC raises `legs_must_sum_to_total` → LegSumMismatchError.
//   - RPC raises 23505 from the partial unique-in-flight index →
//     TicketAlreadyBeingChargedError.
//   - The atomicity + audit emit live inside SQL (`payment.captured`).

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

describe("activateCashDraft — Node-layer behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns {paymentId, status:'succeeded', ticketFlippedToPaid:true} when the activation closes the ticket", async () => {
    const { rpcSpy } = mockClient(async () => ({
      data: [{ ticket_id: TICKET_ID, ticket_flipped_to_paid: true }],
      error: null,
    }));

    const { activateCashDraft } = await import("@/app/(studio)/checkout/actions");
    const result = await activateCashDraft(PAYMENT_ID);

    expect(result).toEqual({
      paymentId: PAYMENT_ID,
      status: "succeeded",
      ticketFlippedToPaid: true,
    });
    expect(rpcSpy).toHaveBeenCalledWith("pos_activate_cash_draft", {
      p_payment_id: PAYMENT_ID,
      p_operator: STAFF_ID,
    });
  });

  it("returns ticketFlippedToPaid:false when other legs still need to settle", async () => {
    mockClient(async () => ({
      data: [{ ticket_id: TICKET_ID, ticket_flipped_to_paid: false }],
      error: null,
    }));

    const { activateCashDraft } = await import("@/app/(studio)/checkout/actions");
    const result = await activateCashDraft(PAYMENT_ID);
    expect(result.ticketFlippedToPaid).toBe(false);
    expect(result.status).toBe("succeeded");
  });

  it("maps RPC `legs_must_sum_to_total` to LegSumMismatchError", async () => {
    mockClient(async () => ({
      data: null,
      error: { message: "legs_must_sum_to_total" },
    }));

    const { activateCashDraft } = await import("@/app/(studio)/checkout/actions");
    const { LegSumMismatchError } = await import("@/app/(studio)/checkout/_errors");
    await expect(activateCashDraft(PAYMENT_ID)).rejects.toBeInstanceOf(LegSumMismatchError);
  });

  it("maps Postgres 23505 (partial-unique-index race) to TicketAlreadyBeingChargedError", async () => {
    mockClient(async () => ({
      data: null,
      error: {
        message:
          'duplicate key value violates unique constraint "payments_one_in_flight_per_ticket_idx"',
        code: "23505",
      },
    }));

    const { activateCashDraft } = await import("@/app/(studio)/checkout/actions");
    const { TicketAlreadyBeingChargedError } = await import("@/app/(studio)/checkout/_errors");
    await expect(activateCashDraft(PAYMENT_ID)).rejects.toBeInstanceOf(
      TicketAlreadyBeingChargedError
    );
  });

  it("maps RPC `draft_leg_not_found` to DraftLegNotFoundError", async () => {
    mockClient(async () => ({
      data: null,
      error: { message: "draft_leg_not_found" },
    }));

    const { activateCashDraft } = await import("@/app/(studio)/checkout/actions");
    const { DraftLegNotFoundError } = await import("@/app/(studio)/checkout/_errors");
    await expect(activateCashDraft(PAYMENT_ID)).rejects.toBeInstanceOf(DraftLegNotFoundError);
  });
});
