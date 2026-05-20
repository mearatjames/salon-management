// @vitest-environment node

// Unit test for `sendCardToTerminal` (feature 043-checkout-ephemeral-draft
// T022 / T025).
//
// The action pushes a Square Terminal checkout. Before this feature it
// only ran against an already-persisted ticket id. Feature 043 makes the
// first payment-initiating action persist the cart, so `sendCardToTerminal`
// now takes a discriminated `PaymentTarget`:
//   - { from: 'ticket', ticketId } — today's direct path: read the ticket,
//     INSERT a fresh `pending` card payment row, push to Square.
//   - { from: 'draft', draft }     — the ephemeral path: the action calls
//     `validateAndResolveDraft`, then `pos_create_ticket_from_draft` to
//     persist the cart atomically, THEN runs today's card logic (the
//     pending-row insert + Square `createCheckout`) against the
//     freshly-resolved ticket id. The return value carries that `ticketId`.
//
// The webhook/polling/realtime settlement of the `pending` row is
// unchanged and covered by the e2e card-payment specs.

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

vi.mock("@/lib/square/terminal", () => ({
  createCheckout: vi.fn(),
}));

import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import { requireStudioSession } from "@/lib/auth/session";
import { createCheckout as squareCreateCheckout } from "@/lib/square/terminal";

import { sendCardToTerminal } from "@/app/(studio)/checkout/actions";
import { TicketEmptyError, TicketHasUnpricedItemsError } from "@/app/(studio)/checkout/_errors";
import type { CheckoutDraft } from "@/app/(studio)/checkout/_cart-draft";

type FromTable =
  | "payments"
  | "tickets"
  | "ticket_items"
  | "square_oauth"
  | "square_devices"
  | "services"
  | "staff";

const OPERATOR_ID = "10000000-0000-0000-0000-000000000001";
const TICKET_ID = "11111111-1111-1111-1111-111111111111";
const PAYMENT_ID = "22222222-2222-2222-2222-222222222222";
const SQUARE_CHECKOUT_ID = "sqchk_0001";
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
// Common table-mock builders for the card-send path: the `tickets` read,
// the `ticket_items` unpriced-check read, the `square_oauth` connection
// check, the `square_devices` resolution, the `payments` insert + update.
// ----------------------------------------------------------------------
function ticketsTable(totalCents: number) {
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
  return {
    select: vi.fn(() => ({
      eq: vi.fn(async () => ({
        data: [{ id: "item-1", price_unconfirmed: false }],
        error: null,
      })),
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

function paymentsTable(insertedRows: Array<Record<string, unknown>>) {
  return {
    insert: vi.fn((vals: Record<string, unknown>) => {
      insertedRows.push(vals);
      return {
        select: vi.fn(() => ({
          single: vi.fn(async () => ({ data: { id: PAYMENT_ID }, error: null })),
        })),
      };
    }),
    update: vi.fn(() => ({
      eq: vi.fn(async () => ({ data: null, error: null })),
    })),
  };
}

// ----------------------------------------------------------------------
// Ticket-path mock client — no draft RPC, just the card-send chain.
// ----------------------------------------------------------------------
function mockTicketClient({ totalCents = 4000 }: { totalCents?: number } = {}) {
  const insertedRows: Array<Record<string, unknown>> = [];
  const rpcSpy = vi.fn(async () => ({ data: null, error: null }));
  const fromSpy = vi.fn((table: FromTable) => {
    if (table === "tickets") return ticketsTable(totalCents);
    if (table === "ticket_items") return ticketItemsTable();
    if (table === "square_oauth") return squareOauthTable();
    if (table === "square_devices") return squareDevicesTable();
    if (table === "payments") return paymentsTable(insertedRows);
    return {};
  });

  (createSupabaseServiceRoleClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    rpc: rpcSpy,
    from: fromSpy,
  });

  return { rpcSpy, fromSpy, insertedRows };
}

// ----------------------------------------------------------------------
// Draft-path mock client — backs `validateAndResolveDraft` (reads
// `services` + `staff`), the `pos_create_ticket_from_draft` RPC, then the
// card-send chain (tickets / ticket_items / square_* / payments).
// ----------------------------------------------------------------------
function mockDraftClient({
  serviceRows = [{ id: SERVICE_ID, name: "Classic manicure" }],
  staffRows = [{ id: STAFF_ID, active: true, removed_at: null }],
  totalCents = 2500,
}: {
  serviceRows?: Array<{ id: string; name: string }>;
  staffRows?: Array<{ id: string; active: boolean; removed_at: string | null }>;
  totalCents?: number;
} = {}) {
  const insertedRows: Array<Record<string, unknown>> = [];
  const rpcSpy = vi.fn(async (fn: string, _args: Record<string, unknown>) => {
    void _args;
    if (fn === "pos_create_ticket_from_draft") {
      return {
        data: [{ ticket_id: TICKET_ID, subtotal_cents: totalCents, total_cents: totalCents }],
        error: null,
      };
    }
    throw new Error(`unexpected rpc: ${fn}`);
  });

  const fromSpy = vi.fn((table: FromTable) => {
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
    if (table === "tickets") return ticketsTable(totalCents);
    if (table === "ticket_items") return ticketItemsTable();
    if (table === "square_oauth") return squareOauthTable();
    if (table === "square_devices") return squareDevicesTable();
    if (table === "payments") return paymentsTable(insertedRows);
    return {};
  });

  (createSupabaseServiceRoleClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    rpc: rpcSpy,
    from: fromSpy,
  });

  return { rpcSpy, fromSpy, insertedRows };
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
        unitPriceCents: overrides.unitPriceCents ?? 2500,
        priceUnconfirmed: overrides.priceUnconfirmed ?? false,
        assignedStaffId: STAFF_ID,
      },
    ],
  };
}

describe("sendCardToTerminal — Node-layer behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
    (squareCreateCheckout as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      squareTerminalCheckoutId: SQUARE_CHECKOUT_ID,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------
  // Ticket path (legacy) — { from: 'ticket', ticketId }.
  // --------------------------------------------------------------------
  it("ticket path: inserts a pending card row, pushes to Square and returns ticketId + paymentId + checkoutId", async () => {
    const { rpcSpy, insertedRows } = mockTicketClient({ totalCents: 4000 });

    const result = await sendCardToTerminal({ from: "ticket", ticketId: TICKET_ID });

    // No draft RPC was invoked on the ticket path.
    expect(rpcSpy).not.toHaveBeenCalled();

    // A fresh `pending` card payment row was inserted.
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0].method).toBe("card");
    expect(insertedRows[0].status).toBe("pending");
    expect(insertedRows[0].ticket_id).toBe(TICKET_ID);

    // The checkout was pushed to Square.
    expect(squareCreateCheckout).toHaveBeenCalledTimes(1);

    expect(result.ticketId).toBe(TICKET_ID);
    expect(result.paymentId).toBe(PAYMENT_ID);
    expect(result.squareTerminalCheckoutId).toBe(SQUARE_CHECKOUT_ID);
  });

  // --------------------------------------------------------------------
  // Draft path (feature 043) — { from: 'draft', draft }.
  // --------------------------------------------------------------------
  it("draft path: persists via pos_create_ticket_from_draft then inserts the pending card row against the resolved ticketId", async () => {
    const { rpcSpy, insertedRows } = mockDraftClient({ totalCents: 2500 });

    const result = await sendCardToTerminal({ from: "draft", draft: serviceDraft() });

    // The draft was persisted first.
    expect(rpcSpy).toHaveBeenCalledTimes(1);
    expect(rpcSpy.mock.calls[0][0]).toBe("pos_create_ticket_from_draft");
    const createArgs = rpcSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(createArgs.p_operator).toBe(OPERATOR_ID);
    expect(Array.isArray(createArgs.p_items)).toBe(true);

    // THEN the pending card row was inserted against the resolved ticket.
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0].method).toBe("card");
    expect(insertedRows[0].status).toBe("pending");
    expect(insertedRows[0].ticket_id).toBe(TICKET_ID);

    // The checkout was pushed to Square.
    expect(squareCreateCheckout).toHaveBeenCalledTimes(1);

    // The return value carries the freshly-resolved ticket id.
    expect(result.ticketId).toBe(TICKET_ID);
    expect(result.paymentId).toBe(PAYMENT_ID);
    expect(result.squareTerminalCheckoutId).toBe(SQUARE_CHECKOUT_ID);
  });

  it("draft path: refuses an empty cart with TicketEmptyError and never persists or pushes to Square", async () => {
    const { rpcSpy, insertedRows } = mockDraftClient();

    await expect(
      sendCardToTerminal({ from: "draft", draft: { lines: [] } })
    ).rejects.toBeInstanceOf(TicketEmptyError);

    expect(rpcSpy).not.toHaveBeenCalled();
    expect(insertedRows).toHaveLength(0);
    expect(squareCreateCheckout).not.toHaveBeenCalled();
  });

  it("draft path: refuses an unconfirmed price with TicketHasUnpricedItemsError and never persists or pushes to Square", async () => {
    const { rpcSpy, insertedRows } = mockDraftClient();

    await expect(
      sendCardToTerminal({ from: "draft", draft: serviceDraft({ priceUnconfirmed: true }) })
    ).rejects.toBeInstanceOf(TicketHasUnpricedItemsError);

    expect(rpcSpy).not.toHaveBeenCalled();
    expect(insertedRows).toHaveLength(0);
    expect(squareCreateCheckout).not.toHaveBeenCalled();
  });
});
