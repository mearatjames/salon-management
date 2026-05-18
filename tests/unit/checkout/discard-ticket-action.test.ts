// @vitest-environment node

// Unit test for `discardTicket` (issue #26 — money-loss defense).
//
// The action's contract for the new guard:
//   1. Refuse when any `payments` row exists with status in
//      ('draft', 'pending', 'succeeded') by returning a refusal-shaped
//      value `{ ok: false, refusedReason: 'ticket_has_inflight_payment',
//      counts }`. The return-value shape (instead of a thrown typed
//      error) is necessary because Next.js' production Server Action
//      build strips error metadata across the client boundary — see the
//      same pattern at `addServiceLine` for the `TicketAlreadyBeingCharged`
//      refusal. `TicketHasInflightPaymentError` remains in `_errors.ts`
//      as the typed equivalent for same-process callers.
//   2. Otherwise: flip status to discarded, write closed_by/closed_at,
//      and record audit (`{ ok: true }`).
//
// This file covers four cases on the in-flight guard:
//   - open ticket with no payments        → ok=true, ticket update fires
//   - open ticket with a draft payment    → refusal value, no update
//   - open ticket with a pending payment  → refusal value, no update
//   - open ticket with a succeeded payment→ refusal value, no update
//
// The pre-existing terminal-status branch is exercised by the e2e suite
// and is intentionally left out here to keep this file scoped to the new
// guard the issue asks for.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/admin", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireStudioSession: vi.fn(),
}));

vi.mock("@/lib/auth/audit", () => ({
  recordAudit: vi.fn(async () => {}),
}));

import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import { requireStudioSession } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";

import { discardTicket } from "@/app/(studio)/checkout/actions";

const TICKET_ID = "11111111-1111-1111-1111-111111111111";
const STAFF_ID = "10000000-0000-0000-0000-000000000001";

type InflightStatus = "draft" | "pending" | "succeeded";

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

// Build a supabase mock that returns:
//   - `tickets.select(...).eq(...).single()` → an open ticket
//   - `payments.select(...).eq(...).in(...)` → the given rows
//   - `ticket_items.select(..., {count, head})` → count 0
//   - `tickets.update(...).eq(...)` → no-op success
// and exposes the call spies so the test can assert.
function mockClientWithInflight(rows: Array<{ status: InflightStatus }>) {
  const ticketUpdate = vi.fn(() => ({
    eq: vi.fn(async () => ({ error: null })),
  }));

  const fromSpy = vi.fn((table: string) => {
    if (table === "tickets") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: { id: TICKET_ID, status: "open", subtotal_cents: 2500 },
              error: null,
            })),
          })),
        })),
        update: ticketUpdate,
      };
    }
    if (table === "payments") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            in: vi.fn(async () => ({ data: rows, error: null })),
          })),
        })),
      };
    }
    if (table === "ticket_items") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(async () => ({ count: 0, error: null })),
        })),
      };
    }
    return {};
  });

  (createSupabaseServiceRoleClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    from: fromSpy,
  });

  return { fromSpy, ticketUpdate };
}

describe("discardTicket — in-flight payments guard (issue #26)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("succeeds when the ticket is open and has no payments rows", async () => {
    const { ticketUpdate } = mockClientWithInflight([]);

    await expect(discardTicket({ ticketId: TICKET_ID })).resolves.toEqual({ ok: true });

    expect(ticketUpdate).toHaveBeenCalledTimes(1);
    expect(recordAudit).toHaveBeenCalledWith(
      "ticket.discarded",
      expect.any(String),
      TICKET_ID,
      expect.objectContaining({
        subtotal_cents_at_discard: 2500,
        line_count_at_discard: 0,
      }),
      STAFF_ID
    );
  });

  it("returns a refusal value when a draft payment row exists", async () => {
    const { ticketUpdate } = mockClientWithInflight([{ status: "draft" }]);

    await expect(discardTicket({ ticketId: TICKET_ID })).resolves.toEqual({
      ok: false,
      refusedReason: "ticket_has_inflight_payment",
      counts: { draft: 1, pending: 0, succeeded: 0 },
    });

    expect(ticketUpdate).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("returns a refusal value when a pending payment row exists", async () => {
    const { ticketUpdate } = mockClientWithInflight([{ status: "pending" }]);

    await expect(discardTicket({ ticketId: TICKET_ID })).resolves.toEqual({
      ok: false,
      refusedReason: "ticket_has_inflight_payment",
      counts: { draft: 0, pending: 1, succeeded: 0 },
    });

    expect(ticketUpdate).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("returns a refusal value when a succeeded payment row exists", async () => {
    const { ticketUpdate } = mockClientWithInflight([{ status: "succeeded" }]);

    await expect(discardTicket({ ticketId: TICKET_ID })).resolves.toEqual({
      ok: false,
      refusedReason: "ticket_has_inflight_payment",
      counts: { draft: 0, pending: 0, succeeded: 1 },
    });

    expect(ticketUpdate).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
