// @vitest-environment node

// Unit test for `composeDraftLeg` (T032 / T038; feature 043 T023 / T026).
//
// Asserts the Node-side behaviour of the action — a thin wrapper around
// `supabase.rpc('pos_compose_payment_draft', …)`:
//
//   - amount <= 0 → LegAmountInvalidError (RPC raises legs_must_fit_remaining)
//   - amount > remaining_owed → LegAmountInvalidError
//   - happy path → returns {ticketId, paymentId, status:'draft', amountCents}
//     and the RPC's emit-draft_created audit happens inside SQL
//   - racing in-flight (RPC catches via partial unique index, raises 23505)
//     → TicketAlreadyBeingChargedError
//
// Feature 043-checkout-ephemeral-draft (T023/T026): `composeDraftLeg` now
// takes a discriminated `PaymentTarget` as its first arg:
//   - { from: 'ticket', ticketId } — today's direct path: run
//     `pos_compose_payment_draft` against the persisted ticket.
//   - { from: 'draft', draft }     — composing the FIRST split-tender leg
//     is a payment-initiating action (FR-005). The action calls
//     `validateAndResolveDraft`, then `pos_create_ticket_from_draft` to
//     persist the cart atomically, THEN runs `pos_compose_payment_draft`
//     against the freshly-resolved ticket id. The return value carries
//     that `ticketId`.
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

import type { CheckoutDraft } from "@/app/(studio)/checkout/_cart-draft";

const TICKET_ID = "11111111-1111-1111-1111-111111111111";
const PAYMENT_ID = "22222222-2222-2222-2222-222222222222";
const STAFF_ID = "10000000-0000-0000-0000-000000000001";
const SERVICE_ID = "20000000-0000-0000-0000-000000000001";
const SVC_STAFF_ID = "30000000-0000-0000-0000-000000000001";

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

// Ticket-path mock — only the compose RPC.
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

// Draft-path mock — backs `validateAndResolveDraft` (reads `services` +
// `staff`), the `pos_create_ticket_from_draft` RPC, then the compose RPC.
function mockDraftClient({
  serviceRows = [{ id: SERVICE_ID, name: "Classic manicure" }],
  staffRows = [{ id: SVC_STAFF_ID, active: true, removed_at: null }],
  totalCents = 4000,
}: {
  serviceRows?: Array<{ id: string; name: string }>;
  staffRows?: Array<{ id: string; active: boolean; removed_at: string | null }>;
  totalCents?: number;
} = {}) {
  const rpcSpy = vi.fn(async (fn: string, _args: Record<string, unknown>) => {
    void _args;
    if (fn === "pos_create_ticket_from_draft") {
      return {
        data: [{ ticket_id: TICKET_ID, subtotal_cents: totalCents, total_cents: totalCents }],
        error: null,
      };
    }
    if (fn === "pos_compose_payment_draft") {
      return { data: PAYMENT_ID, error: null };
    }
    throw new Error(`unexpected rpc: ${fn}`);
  });

  const fromSpy = vi.fn((table: string) => {
    if (table === "services") {
      return {
        select: vi.fn(() => ({
          in: vi.fn(async () => ({ data: serviceRows, error: null })),
        })),
      };
    }
    if (table === "staff") {
      return {
        select: vi.fn(() => ({
          in: vi.fn(async () => ({ data: staffRows, error: null })),
        })),
      };
    }
    return {};
  });

  (createSupabaseServiceRoleClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    rpc: rpcSpy,
    from: fromSpy,
  });

  return { rpcSpy };
}

function serviceDraft(
  overrides: Partial<{ unitPriceCents: number; priceUnconfirmed: boolean }> = {}
): CheckoutDraft {
  return {
    lines: [
      {
        kind: "service",
        clientLineId: "client-line-1",
        serviceId: SERVICE_ID,
        unitPriceCents: overrides.unitPriceCents ?? 4000,
        priceUnconfirmed: overrides.priceUnconfirmed ?? false,
        assignedStaffId: SVC_STAFF_ID,
      },
    ],
  };
}

describe("composeDraftLeg — Node-layer behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------
  // Ticket path (legacy) — { from: 'ticket', ticketId }.
  // --------------------------------------------------------------------
  it("returns {ticketId, paymentId, status:'draft', amountCents} on a happy compose", async () => {
    const { rpcSpy } = mockClient(async () => ({
      data: PAYMENT_ID,
      error: null,
    }));

    const { composeDraftLeg } = await import("@/app/(studio)/checkout/actions");
    const result = await composeDraftLeg({ from: "ticket", ticketId: TICKET_ID }, "cash", 2000);

    expect(result).toEqual({
      ticketId: TICKET_ID,
      paymentId: PAYMENT_ID,
      status: "draft",
      amountCents: 2000,
    });
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
    await expect(
      composeDraftLeg({ from: "ticket", ticketId: TICKET_ID }, "cash", 0)
    ).rejects.toBeInstanceOf(LegAmountInvalidError);
  });

  it("rejects amount > remaining_owed with LegAmountInvalidError", async () => {
    mockClient(async () => ({
      data: null,
      error: { message: "legs_must_fit_remaining" },
    }));

    const { composeDraftLeg } = await import("@/app/(studio)/checkout/actions");
    const { LegAmountInvalidError } = await import("@/app/(studio)/checkout/_errors");
    await expect(
      composeDraftLeg({ from: "ticket", ticketId: TICKET_ID }, "cash", 999_999_999)
    ).rejects.toBeInstanceOf(LegAmountInvalidError);
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
    await expect(
      composeDraftLeg({ from: "ticket", ticketId: TICKET_ID }, "cash", 1000)
    ).rejects.toBeInstanceOf(TicketAlreadyBeingChargedError);
  });

  // --------------------------------------------------------------------
  // Draft path (feature 043) — { from: 'draft', draft }. Composing the
  // FIRST split-tender leg persists the cart first (FR-005).
  // --------------------------------------------------------------------
  it("draft path: persists via pos_create_ticket_from_draft then composes the first leg against the resolved ticketId", async () => {
    const { rpcSpy } = mockDraftClient({ totalCents: 4000 });

    const { composeDraftLeg } = await import("@/app/(studio)/checkout/actions");
    const result = await composeDraftLeg({ from: "draft", draft: serviceDraft() }, "cash", 2000);

    // Both RPCs were called, in order: create then compose.
    expect(rpcSpy).toHaveBeenCalledTimes(2);
    expect(rpcSpy.mock.calls[0][0]).toBe("pos_create_ticket_from_draft");
    expect(rpcSpy.mock.calls[1][0]).toBe("pos_compose_payment_draft");

    // The create RPC carries the session-resolved operator id.
    const createArgs = rpcSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(createArgs.p_operator).toBe(STAFF_ID);
    expect(Array.isArray(createArgs.p_items)).toBe(true);

    // The compose RPC runs against the resolved ticket id.
    expect(rpcSpy).toHaveBeenCalledWith("pos_compose_payment_draft", {
      p_ticket_id: TICKET_ID,
      p_operator: STAFF_ID,
      p_method: "cash",
      p_amount: 2000,
    });

    expect(result).toEqual({
      ticketId: TICKET_ID,
      paymentId: PAYMENT_ID,
      status: "draft",
      amountCents: 2000,
    });
  });

  it("draft path: refuses an empty cart with TicketEmptyError and never calls either RPC", async () => {
    const { rpcSpy } = mockDraftClient();

    const { composeDraftLeg } = await import("@/app/(studio)/checkout/actions");
    const { TicketEmptyError } = await import("@/app/(studio)/checkout/_errors");
    await expect(
      composeDraftLeg({ from: "draft", draft: { lines: [] } }, "cash", 2000)
    ).rejects.toBeInstanceOf(TicketEmptyError);

    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("draft path: refuses an unconfirmed price with TicketHasUnpricedItemsError and never calls either RPC", async () => {
    const { rpcSpy } = mockDraftClient();

    const { composeDraftLeg } = await import("@/app/(studio)/checkout/actions");
    const { TicketHasUnpricedItemsError } = await import("@/app/(studio)/checkout/_errors");
    await expect(
      composeDraftLeg(
        { from: "draft", draft: serviceDraft({ priceUnconfirmed: true }) },
        "cash",
        2000
      )
    ).rejects.toBeInstanceOf(TicketHasUnpricedItemsError);

    expect(rpcSpy).not.toHaveBeenCalled();
  });
});
