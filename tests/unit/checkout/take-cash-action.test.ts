// @vitest-environment node

// Unit test for `takeCash` (T026 / feature 043 T009).
//
// The Node side of the action is a thin wrapper around the cash RPC:
//   - it must NOT pre-check the ticket (avoid racing with `discardTicket`),
//   - it must NOT insert into `payments` from Node (the RPC owns that
//     write — Constitution Principle III's "atomic money path"),
//   - on a forced RPC failure it must surface a `CashPaymentFailedError`
//     for the client island to render the FR-019 banner.
//
// Feature 043-checkout-ephemeral-draft (T009/T010): `takeCash` now takes a
// discriminated `PaymentTarget`:
//   - { from: 'ticket', ticketId } — today's direct `pos_take_cash` path.
//   - { from: 'draft', draft }     — the ephemeral path: the action calls
//     `validateAndResolveDraft`, then `pos_create_ticket_from_draft` to
//     persist the cart atomically, then `pos_take_cash` against the
//     freshly-resolved ticket id. The return value carries that `ticketId`.
//
// The transactional rollback inside SQL (no orphan payment row, ticket
// stays `open`) is verified by the e2e in `checkout-cash-sale.spec.ts`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/admin", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireStudioSession: vi.fn(),
}));

import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import { requireStudioSession } from "@/lib/auth/session";

import { takeCash } from "@/app/(studio)/checkout/actions";
import { CashPaymentFailedError } from "@/app/(studio)/checkout/_errors";
import { TicketEmptyError, TicketHasUnpricedItemsError } from "@/app/(studio)/checkout/_errors";
import type { CheckoutDraft } from "@/app/(studio)/checkout/_cart-draft";

type FromTable = "payments" | "tickets" | "audit_log" | "ticket_items" | "services" | "staff";

const OPERATOR_ID = "10000000-0000-0000-0000-000000000001";
const TICKET_ID = "11111111-1111-1111-1111-111111111111";
const SERVICE_ID = "20000000-0000-0000-0000-000000000001";
const STAFF_ID = "30000000-0000-0000-0000-000000000001";

function mockSession() {
  (requireStudioSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    deviceUserId: "00000000-0000-0000-0000-000000000001",
    staff: {
      id: OPERATOR_ID,
      display_name: "Maya Patel",
      role: "owner",
      color_token: "--avatar-rose",
    },
  });
}

// ----------------------------------------------------------------------
// Ticket-path mock client — only `pos_take_cash` + the `tickets` read-back.
// ----------------------------------------------------------------------
function mockTicketClient({
  rpcImpl,
  selectTotal,
}: {
  rpcImpl: (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  selectTotal?: number;
}) {
  const rpcSpy = vi.fn(rpcImpl);
  const fromSpy = vi.fn((table: FromTable) => {
    if (table === "payments") {
      return {
        insert: vi.fn(() => {
          throw new Error("payments.insert from Node is forbidden");
        }),
        select: vi.fn(),
      };
    }
    if (table === "tickets") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: { total_cents: selectTotal ?? 0 },
              error: null,
            })),
          })),
        })),
      };
    }
    return {};
  });

  (createSupabaseServiceRoleClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    rpc: rpcSpy,
    from: fromSpy,
  });

  return { rpcSpy, fromSpy };
}

// ----------------------------------------------------------------------
// Draft-path mock client — backs `validateAndResolveDraft` (reads
// `services` + `staff`), then the two RPCs, then the `tickets` read-back.
// ----------------------------------------------------------------------
function mockDraftClient({
  serviceRows = [{ id: SERVICE_ID, name: "Classic manicure" }],
  staffRows = [{ id: STAFF_ID, active: true, removed_at: null }],
  createImpl,
  takeCashImpl,
  selectTotal = 2500,
}: {
  serviceRows?: Array<{ id: string; name: string }>;
  staffRows?: Array<{ id: string; active: boolean; removed_at: string | null }>;
  createImpl?: (
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  takeCashImpl?: (
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  selectTotal?: number;
} = {}) {
  const rpcSpy = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    if (fn === "pos_create_ticket_from_draft") {
      return createImpl
        ? await createImpl(args)
        : {
            data: [{ ticket_id: TICKET_ID, subtotal_cents: selectTotal, total_cents: selectTotal }],
            error: null,
          };
    }
    if (fn === "pos_take_cash") {
      return takeCashImpl
        ? await takeCashImpl(args)
        : { data: "99999999-9999-9999-9999-999999999999", error: null };
    }
    throw new Error(`unexpected rpc: ${fn}`);
  });

  const fromSpy = vi.fn((table: FromTable) => {
    if (table === "payments") {
      return {
        insert: vi.fn(() => {
          throw new Error("payments.insert from Node is forbidden");
        }),
        select: vi.fn(),
      };
    }
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
    if (table === "tickets") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: { total_cents: selectTotal },
              error: null,
            })),
          })),
        })),
      };
    }
    return {};
  });

  (createSupabaseServiceRoleClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    rpc: rpcSpy,
    from: fromSpy,
  });

  return { rpcSpy, fromSpy };
}

function serviceDraftLine(
  overrides: Partial<{
    unitPriceCents: number;
    priceUnconfirmed: boolean;
  }> = {}
): CheckoutDraft {
  return {
    lines: [
      {
        kind: "service",
        clientLineId: "client-line-1",
        serviceId: SERVICE_ID,
        unitPriceCents: overrides.unitPriceCents ?? 2500,
        priceUnconfirmed: overrides.priceUnconfirmed ?? false,
        assignedStaffId: STAFF_ID,
      },
    ],
  };
}

describe("takeCash — Node-layer behavior", () => {
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
  it("throws CashPaymentFailedError on an unmapped Postgres failure and never inserts into payments from Node", async () => {
    const { rpcSpy, fromSpy } = mockTicketClient({
      rpcImpl: async () => ({ data: null, error: { message: "deadlock detected" } }),
    });

    await expect(takeCash({ from: "ticket", ticketId: TICKET_ID })).rejects.toBeInstanceOf(
      CashPaymentFailedError
    );

    // The RPC was called with the correct shape.
    expect(rpcSpy).toHaveBeenCalledTimes(1);
    expect(rpcSpy).toHaveBeenCalledWith("pos_take_cash", {
      p_ticket_id: TICKET_ID,
      p_operator: OPERATOR_ID,
    });

    // CRITICAL: no Node-side write to `payments` was attempted.
    const paymentsCalls = fromSpy.mock.calls.filter(([table]) => table === "payments");
    expect(paymentsCalls).toHaveLength(0);
  });

  it("ticket path: returns the ticketId, paymentId and chargedCents on success", async () => {
    const { rpcSpy } = mockTicketClient({
      rpcImpl: async () => ({
        data: "99999999-9999-9999-9999-999999999999",
        error: null,
      }),
      selectTotal: 4000,
    });

    const result = await takeCash({ from: "ticket", ticketId: TICKET_ID });

    expect(result.ticketId).toBe(TICKET_ID);
    expect(result.paymentId).toBe("99999999-9999-9999-9999-999999999999");
    expect(result.chargedCents).toBe(4000);
    expect(rpcSpy).toHaveBeenCalledTimes(1);
    expect(rpcSpy).toHaveBeenCalledWith("pos_take_cash", {
      p_ticket_id: TICKET_ID,
      p_operator: OPERATOR_ID,
    });
  });

  // --------------------------------------------------------------------
  // Draft path (feature 043) — { from: 'draft', draft }.
  // --------------------------------------------------------------------
  it("draft path: persists via pos_create_ticket_from_draft then charges via pos_take_cash and returns the resolved ticketId", async () => {
    const { rpcSpy } = mockDraftClient({ selectTotal: 2500 });

    const result = await takeCash({ from: "draft", draft: serviceDraftLine() });

    // Both RPCs were called, in order: create then take-cash.
    expect(rpcSpy).toHaveBeenCalledTimes(2);
    expect(rpcSpy.mock.calls[0][0]).toBe("pos_create_ticket_from_draft");
    expect(rpcSpy.mock.calls[1][0]).toBe("pos_take_cash");

    // The create RPC carries the session-resolved operator id (never from
    // the client) plus the resolved p_items payload.
    const createArgs = rpcSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(createArgs.p_operator).toBe(OPERATOR_ID);
    expect(Array.isArray(createArgs.p_items)).toBe(true);

    // The take-cash RPC runs against the resolved ticket id.
    expect(rpcSpy).toHaveBeenCalledWith("pos_take_cash", {
      p_ticket_id: TICKET_ID,
      p_operator: OPERATOR_ID,
    });

    // The return value carries the freshly-resolved ticket id.
    expect(result.ticketId).toBe(TICKET_ID);
    expect(result.paymentId).toBe("99999999-9999-9999-9999-999999999999");
    expect(result.chargedCents).toBe(2500);
  });

  it("draft path: refuses an empty cart with TicketEmptyError and never calls either RPC", async () => {
    const { rpcSpy } = mockDraftClient();

    await expect(takeCash({ from: "draft", draft: { lines: [] } })).rejects.toBeInstanceOf(
      TicketEmptyError
    );

    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("draft path: refuses an unconfirmed price with TicketHasUnpricedItemsError and never calls either RPC", async () => {
    const { rpcSpy } = mockDraftClient();

    await expect(
      takeCash({
        from: "draft",
        draft: serviceDraftLine({ priceUnconfirmed: true }),
      })
    ).rejects.toBeInstanceOf(TicketHasUnpricedItemsError);

    expect(rpcSpy).not.toHaveBeenCalled();
  });
});
