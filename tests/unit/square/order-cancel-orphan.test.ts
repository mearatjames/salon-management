// @vitest-environment node
//
// Phase 5 / US3 / T018 — orphan-Order cancel coverage for
// `sendCardToTerminal`. Two cases:
//
//   (i) `client.terminal.checkouts.create` throws AFTER
//       `client.orders.create` succeeds → the action issues exactly one
//       `client.orders.update` call with the create-response's `orderId`
//       and `version`, body carrying `state: 'CANCELED'`. The action
//       still surfaces the operator-facing
//       `SquareCheckoutCreateFailedError` and still marks the row
//       `failed` with `failure_reason: 'square_unreachable'`.
//
//   (j) Both `client.terminal.checkouts.create` AND
//       `client.orders.update` throw → the action logs a `console.warn`
//       containing both errors and STILL surfaces the original
//       `SquareCheckoutCreateFailedError`. The orphan stays in Square's
//       dashboard but the operator UX is unchanged.
//
// Both cases must FAIL before Phase 5 T019 + T020 land — `cancelOrder`
// doesn't exist yet, and `sendCardToTerminal`'s catch branch doesn't
// invoke it. After T020 they MUST pass.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/admin", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireStudioSession: vi.fn(),
}));

vi.mock("@/lib/auth/audit", () => ({
  recordAudit: vi.fn(async () => undefined),
}));

// `lib/square/terminal` exports `createCheckout` (squareCreateCheckout).
// We mock it to throw so the catch branch in `sendCardToTerminal` runs.
vi.mock("@/lib/square/terminal", () => ({
  createCheckout: vi.fn(),
}));

// Feature 051 single-tender branch dependencies. `getSquareLocationId`
// returns the location id the catch branch will pass to `cancelOrder`.
vi.mock("@/lib/square/oauth", () => ({
  getSquareLocationId: vi.fn(async () => "loc_stub"),
}));

// `createOrder` succeeds (returns the orphan id + version); `cancelOrder`
// is the SUT for case (i) — the action MUST call it. Case (j) makes it
// throw so we can assert on the warn + the eventual operator error.
vi.mock("@/lib/square/orders", () => ({
  createOrder: vi.fn(),
  cancelOrder: vi.fn(),
  EmptyOrderError: class EmptyOrderError extends Error {},
}));

import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import { requireStudioSession } from "@/lib/auth/session";
import { createCheckout as squareCreateCheckoutMock } from "@/lib/square/terminal";
import {
  createOrder as createOrderMock,
  cancelOrder as cancelOrderMock,
} from "@/lib/square/orders";

import { sendCardToTerminal } from "@/app/(studio)/checkout/actions";
import { SquareCheckoutCreateFailedError } from "@/app/(studio)/checkout/_errors";

const OPERATOR_ID = "10000000-0000-0000-0000-000000000001";
const TICKET_ID = "11111111-1111-1111-1111-111111111111";
const PAYMENT_ID = "22222222-2222-2222-2222-222222222222";

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

// Minimal supabase mock that satisfies `sendCardToTerminal`'s read path
// up to the Square call, plus a no-op `update`/`insert` that returns
// success. Mirrors `tests/unit/checkout/send-card-to-terminal.test.ts`
// shape — see that file for the row-shape commentary.
function mockClient({ totalCents = 4000 }: { totalCents?: number } = {}) {
  const updates: Array<{ table: string; values: Record<string, unknown> }> = [];

  function ticketsTable() {
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => ({
            data: { id: TICKET_ID, status: "open", total_cents: totalCents },
            error: null,
          })),
        })),
      })),
    };
  }
  function ticketItemsTable() {
    const rows = [
      {
        id: "item-1",
        kind: "service",
        name_snapshot: "Classic manicure",
        unit_price_cents: totalCents,
        qty: 1,
        discount_target_line_ids: null,
        price_unconfirmed: false,
      },
    ];
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => {
          const eqResult = Object.assign(Promise.resolve({ data: rows, error: null }), {
            order: vi.fn(async () => ({ data: rows, error: null })),
          });
          return eqResult as never;
        }),
      })),
    };
  }
  function squareOauthTable() {
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({
            data: { id: true, refresh_failed_at: null },
            error: null,
          })),
        })),
      })),
    };
  }
  function squareDevicesTable() {
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({
            data: { square_device_id: "device-default" },
            error: null,
          })),
        })),
        limit: vi.fn(async () => ({
          data: [{ square_device_id: "device-default" }],
          error: null,
        })),
      })),
    };
  }
  function paymentsTable() {
    return {
      insert: vi.fn((vals: Record<string, unknown>) => {
        updates.push({ table: "payments.insert", values: vals });
        return {
          select: vi.fn(() => ({
            single: vi.fn(async () => ({ data: { id: PAYMENT_ID }, error: null })),
          })),
        };
      }),
      update: vi.fn((vals: Record<string, unknown>) => {
        updates.push({ table: "payments.update", values: vals });
        return {
          eq: vi.fn(async () => ({ data: null, error: null })),
        };
      }),
    };
  }

  const fromSpy = vi.fn((table: string) => {
    if (table === "tickets") return ticketsTable();
    if (table === "ticket_items") return ticketItemsTable();
    if (table === "square_oauth") return squareOauthTable();
    if (table === "square_devices") return squareDevicesTable();
    if (table === "payments") return paymentsTable();
    return {};
  });

  (createSupabaseServiceRoleClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    rpc: vi.fn(async () => ({ data: null, error: null })),
    from: fromSpy,
  });

  return { fromSpy, updates };
}

const createOrderFn = createOrderMock as unknown as ReturnType<typeof vi.fn>;
const cancelOrderFn = cancelOrderMock as unknown as ReturnType<typeof vi.fn>;
const squareCreateCheckoutFn = squareCreateCheckoutMock as unknown as ReturnType<typeof vi.fn>;

describe("sendCardToTerminal — orphan Order cancel (Phase 5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
    createOrderFn.mockResolvedValue({ orderId: "ord_abc", orderVersion: 1 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------
  // Case (i): cancel happy path. The Order was minted; the terminal
  // checkout threw; the action must best-effort cancel the orphan and
  // still surface the operator-facing error.
  // -------------------------------------------------------------------
  it("(i) calls cancelOrder exactly once with { orderId, orderVersion, locationId } when checkout-create throws after order-create succeeds", async () => {
    mockClient();
    squareCreateCheckoutFn.mockRejectedValueOnce(new Error("square unreachable boom"));
    cancelOrderFn.mockResolvedValueOnce(undefined);

    await expect(
      sendCardToTerminal({ from: "ticket", ticketId: TICKET_ID })
    ).rejects.toBeInstanceOf(SquareCheckoutCreateFailedError);

    expect(cancelOrderFn).toHaveBeenCalledTimes(1);
    const arg = cancelOrderFn.mock.calls[0][0] as {
      orderId: string;
      orderVersion: number;
      locationId: string;
    };
    expect(arg.orderId).toBe("ord_abc");
    expect(arg.orderVersion).toBe(1);
    expect(arg.locationId).toBe("loc_stub");
  });

  // -------------------------------------------------------------------
  // Case (j): cancel also fails. The action logs both errors via
  // `console.warn` but STILL surfaces the operator-stable
  // `SquareCheckoutCreateFailedError`. The orphan stays in Square's
  // dashboard; support has the `square_order_id` on the failed row to
  // find it.
  // -------------------------------------------------------------------
  it("(j) when cancelOrder ALSO throws, console.warn is called with both errors and the action still throws SquareCheckoutCreateFailedError", async () => {
    mockClient();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const checkoutErr = new Error("checkout boom");
    const cancelErr = new Error("cancel boom");
    squareCreateCheckoutFn.mockRejectedValueOnce(checkoutErr);
    cancelOrderFn.mockRejectedValueOnce(cancelErr);

    await expect(
      sendCardToTerminal({ from: "ticket", ticketId: TICKET_ID })
    ).rejects.toBeInstanceOf(SquareCheckoutCreateFailedError);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const warnArgs = warnSpy.mock.calls[0];
    // Message string MUST mention the orphan-cancel context.
    expect(String(warnArgs[0])).toMatch(/orphan order cancel failed/i);
    // Both errors must appear in the warn payload.
    const payloadStr = JSON.stringify(
      warnArgs.slice(1).map((v) => (v instanceof Error ? String(v) : v))
    );
    expect(payloadStr).toContain("checkout boom");
    expect(payloadStr).toContain("cancel boom");
  });
});
