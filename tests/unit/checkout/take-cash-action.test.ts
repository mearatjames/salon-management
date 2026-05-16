// @vitest-environment node

// Unit test for `takeCash` (T026). The Node side of the action is a
// thin wrapper around `supabase.rpc('pos_take_cash', …)`:
//   - it must NOT pre-check the ticket (avoid racing with `discardTicket`),
//   - it must NOT insert into `payments` from Node (the RPC owns that
//     write — Constitution Principle III's "atomic money path"),
//   - on a forced RPC failure it must surface a `CashPaymentFailedError`
//     for the client island to render the FR-019 banner.
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

type RpcArgs = { p_ticket_id: string; p_operator: string };
type FromTable = "payments" | "tickets" | "audit_log" | "ticket_items" | string;

function mockSession() {
  (requireStudioSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    deviceUserId: "00000000-0000-0000-0000-000000000001",
    staff: {
      id: "10000000-0000-0000-0000-000000000001",
      display_name: "Maya Patel",
      role: "owner",
      color_token: "--avatar-rose",
    },
  });
}

function mockClient({
  rpcImpl,
  selectTotal,
}: {
  rpcImpl: (
    fn: string,
    args: RpcArgs
  ) => Promise<{ data: string | null; error: { message: string } | null }>;
  selectTotal?: number;
}) {
  const rpcSpy = vi.fn(rpcImpl);
  const fromSpy = vi.fn((table: FromTable) => {
    if (table === "payments") {
      // Track any attempt to write a payment row from Node. There should be none.
      return {
        insert: vi.fn(() => {
          throw new Error("payments.insert from Node is forbidden");
        }),
        select: vi.fn(),
      };
    }
    if (table === "tickets") {
      // After a successful RPC the action reads back `tickets.total_cents`.
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
    // Any other table: return a benign object so a stray call doesn't throw.
    return {};
  });

  (createSupabaseServiceRoleClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    rpc: rpcSpy,
    from: fromSpy,
  });

  return { rpcSpy, fromSpy };
}

const TICKET_ID = "11111111-1111-1111-1111-111111111111";

describe("takeCash — Node-layer behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws CashPaymentFailedError on an unmapped Postgres failure and never inserts into payments from Node", async () => {
    const { rpcSpy, fromSpy } = mockClient({
      rpcImpl: async () => ({ data: null, error: { message: "deadlock detected" } }),
    });

    await expect(takeCash({ ticketId: TICKET_ID })).rejects.toBeInstanceOf(CashPaymentFailedError);

    // The RPC was called with the correct shape.
    expect(rpcSpy).toHaveBeenCalledTimes(1);
    expect(rpcSpy).toHaveBeenCalledWith("pos_take_cash", {
      p_ticket_id: TICKET_ID,
      p_operator: "10000000-0000-0000-0000-000000000001",
    });

    // CRITICAL: no Node-side write to `payments` was attempted.
    const paymentsCalls = fromSpy.mock.calls.filter(([table]) => table === "payments");
    expect(paymentsCalls).toHaveLength(0);
  });
});
