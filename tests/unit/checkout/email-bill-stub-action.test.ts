// @vitest-environment node

// Unit test for `emailBillStub` (T033 / T036) — feature 013-cart-polish.
//
// The action wraps the stub contract from `contracts/server-actions.md § 4`:
//   (a) valid address → returns { ok: true } AND recordAudit("bill.emailed",
//       deviceUserId, ticketId, { address, line_snapshot }, staffId) was
//       called exactly once
//   (b) invalid address "not an email" → throws EmailAddressInvalidError AND
//       recordAudit NOT called
//   (c) empty address → throws (same shape as b)
//   (d) snapshot field shape — full snapshot is forwarded into the audit
//       payload verbatim
//
// We mock the supabase service-role client, requireStudioSession, and
// recordAudit end-to-end so the test never touches the network. The action
// does not write to supabase — only `recordAudit` is called on the success
// branch — so the supabase mock is minimal (just a `from()` stub for
// defensiveness if the implementation grows).

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

import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import { requireStudioSession } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";

import { emailBillStub } from "@/app/(studio)/checkout/actions";
import { EmailAddressInvalidError } from "@/app/(studio)/checkout/_errors";

const TICKET_ID = "11111111-1111-1111-1111-111111111111";
const STAFF_ID = "10000000-0000-0000-0000-000000000001";
const DEVICE_USER_ID = "00000000-0000-0000-0000-000000000001";

function mockSession() {
  (requireStudioSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    deviceUserId: DEVICE_USER_ID,
    staff: {
      id: STAFF_ID,
      display_name: "Maya Patel",
      role: "owner",
      color_token: "--avatar-rose",
    },
  });
}

function mockSupabase() {
  // The stub action does not actually call supabase (it only calls
  // recordAudit on the success branch). The mock is here in case the
  // implementation grows.
  (createSupabaseServiceRoleClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    from: vi.fn(),
  });
}

function makeSnapshot(overrides: Partial<Parameters<typeof emailBillStub>[0]["snapshot"]> = {}) {
  return {
    lines: [
      {
        id: "22222222-2222-2222-2222-222222222222",
        kind: "service" as const,
        name: "Classic manicure",
        unitPriceCents: 2500,
        qty: 1,
        note: null,
        discountPct: null,
      },
      {
        id: "33333333-3333-3333-3333-333333333333",
        kind: "discount" as const,
        name: "Discount",
        unitPriceCents: -500,
        qty: 1,
        note: "Loyalty perk",
        discountPct: null,
      },
    ],
    serviceSubtotalCents: 2500,
    discountTotalCents: -500,
    totalCents: 2000,
    capturedAt: "2026-05-16T12:34:56.789Z",
    ...overrides,
  };
}

describe("emailBillStub", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
    mockSupabase();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("(a) valid address → returns { ok: true } AND recordAudit called exactly once with correct args", async () => {
    const snapshot = makeSnapshot();
    const result = await emailBillStub({
      ticketId: TICKET_ID,
      address: "you@example.com",
      snapshot,
    });

    expect(result).toEqual({ ok: true });

    expect(recordAudit).toHaveBeenCalledTimes(1);
    const [verb, deviceUserId, entityId, payload, actingAsStaffId] = (
      recordAudit as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(verb).toBe("bill.emailed");
    expect(deviceUserId).toBe(DEVICE_USER_ID);
    expect(entityId).toBe(TICKET_ID);
    expect(actingAsStaffId).toBe(STAFF_ID);
    expect(payload).toMatchObject({
      address: "you@example.com",
      line_snapshot: snapshot,
    });
  });

  it("(b) invalid address 'not an email' → throws EmailAddressInvalidError AND recordAudit not called", async () => {
    const snapshot = makeSnapshot();

    await expect(
      emailBillStub({
        ticketId: TICKET_ID,
        address: "not an email",
        snapshot,
      })
    ).rejects.toBeInstanceOf(EmailAddressInvalidError);

    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("(c) empty address → throws EmailAddressInvalidError AND recordAudit not called", async () => {
    const snapshot = makeSnapshot();

    await expect(
      emailBillStub({
        ticketId: TICKET_ID,
        address: "",
        snapshot,
      })
    ).rejects.toBeInstanceOf(EmailAddressInvalidError);

    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("(d) snapshot field shape — full snapshot is forwarded into the audit payload verbatim", async () => {
    const snapshot = makeSnapshot({
      lines: [
        {
          id: "44444444-4444-4444-4444-444444444444",
          kind: "service" as const,
          name: "Nail art",
          unitPriceCents: 5000,
          qty: 1,
          note: null,
          discountPct: null,
        },
        {
          id: "55555555-5555-5555-5555-555555555555",
          kind: "discount" as const,
          name: "Discount · 15%",
          unitPriceCents: -750,
          qty: 1,
          note: null,
          discountPct: 15,
        },
      ],
      serviceSubtotalCents: 5000,
      discountTotalCents: -750,
      totalCents: 4250,
      capturedAt: "2026-05-16T15:00:00.000Z",
    });

    await emailBillStub({
      ticketId: TICKET_ID,
      address: "manager@tangnails.dev",
      snapshot,
    });

    expect(recordAudit).toHaveBeenCalledTimes(1);
    const payload = (recordAudit as unknown as ReturnType<typeof vi.fn>).mock.calls[0][3];
    // Verbatim forward — every field present + values match exactly.
    expect(payload).toEqual({
      address: "manager@tangnails.dev",
      line_snapshot: snapshot,
    });
    expect(payload.line_snapshot).toEqual(snapshot);
    // Specifically: discount_pct and note pass through unchanged.
    expect(payload.line_snapshot.lines[1].discountPct).toBe(15);
    expect(payload.line_snapshot.lines[0].note).toBe(null);
    expect(payload.line_snapshot.capturedAt).toBe("2026-05-16T15:00:00.000Z");
  });
});
