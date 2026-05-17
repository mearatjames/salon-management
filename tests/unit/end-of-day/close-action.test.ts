// Unit tests for the `closeCashDrawerAction` Server Action.
//
// Written BEFORE the implementation per Principle IV (Test-First for
// Critical Paths). The implementation in `app/(studio)/end-of-day/actions.ts`
// (T011) makes these pass.
//
// Contract source: specs/019-end-of-day-cash/contracts/server-action.md.
//
// Mock surface:
//   - `requireStudioSession` — controls the operator role + ids.
//   - `createSupabaseServerClient` — used only to read salon timezone.
//   - `getSalonTimezone` — short-circuited to "America/Los_Angeles".
//   - `createSupabaseServiceRoleClient` — exposes `.rpc(...)` spy.
//   - `revalidatePath` — asserted on the happy path.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  requireStudioSession: vi.fn(),
}));
vi.mock("@/lib/db/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ __server: true })),
}));
vi.mock("@/lib/db/admin", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));
vi.mock("@/lib/db/settings", () => ({
  getSalonTimezone: vi.fn(async () => "America/Los_Angeles"),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { revalidatePath } from "next/cache";

import { closeCashDrawerAction } from "@/app/(studio)/end-of-day/actions";
import { requireStudioSession, type StudioRole } from "@/lib/auth/session";
import { createSupabaseServiceRoleClient } from "@/lib/db/admin";

type RpcResult = { data: string | null; error: { message: string } | null };

function mockRpc(result: RpcResult) {
  const rpcSpy = vi.fn<(name: string, args: Record<string, unknown>) => Promise<RpcResult>>(
    async () => result
  );
  (createSupabaseServiceRoleClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    rpc: rpcSpy,
  });
  return rpcSpy;
}

function mockViewer(role: StudioRole) {
  (requireStudioSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    deviceUserId: "device-1",
    staff: {
      id: "staff-1",
      display_name: "Cam Manager",
      role,
      color_token: "rose-500",
    },
  });
}

describe("closeCashDrawerAction — role gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(["front_desk", "technician"] as const)(
    "returns FORBIDDEN for %s role without invoking the RPC",
    async (role) => {
      mockViewer(role);
      const rpcSpy = mockRpc({ data: null, error: null });

      const res = await closeCashDrawerAction({
        countedCents: 16450,
        expectedCents: 16450,
        notes: "",
      });

      expect(res).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(rpcSpy).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    }
  );
});

describe("closeCashDrawerAction — error code mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockViewer("manager");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps cash_drawer_already_closed → ALREADY_CLOSED", async () => {
    mockRpc({ data: null, error: { message: "cash_drawer_already_closed" } });
    const res = await closeCashDrawerAction({
      countedCents: 16450,
      expectedCents: 16450,
      notes: "",
    });
    expect(res).toMatchObject({ ok: false, code: "ALREADY_CLOSED" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("maps cash_drawer_expected_changed → EXPECTED_CHANGED", async () => {
    mockRpc({ data: null, error: { message: "cash_drawer_expected_changed" } });
    const res = await closeCashDrawerAction({
      countedCents: 16450,
      expectedCents: 16450,
      notes: "",
    });
    expect(res).toMatchObject({ ok: false, code: "EXPECTED_CHANGED" });
  });

  it("maps cash_drawer_note_required → NOTE_REQUIRED", async () => {
    mockRpc({ data: null, error: { message: "cash_drawer_note_required" } });
    const res = await closeCashDrawerAction({
      countedCents: 16450,
      expectedCents: 16250,
      notes: "",
    });
    expect(res).toMatchObject({ ok: false, code: "NOTE_REQUIRED" });
  });
});

describe("closeCashDrawerAction — happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockViewer("owner");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls supabase.rpc('pos_close_cash_drawer', …) with the correct arg shape and returns the sessionId", async () => {
    const rpcSpy = mockRpc({ data: "session-uuid-123", error: null });

    const res = await closeCashDrawerAction({
      countedCents: 16450,
      expectedCents: 16450,
      notes: "  with surrounding whitespace  ",
    });

    expect(rpcSpy).toHaveBeenCalledTimes(1);
    const [rpcName, args] = rpcSpy.mock.calls[0]!;
    expect(rpcName).toBe("pos_close_cash_drawer");
    // Arg-shape contract: snake_case keys mirroring the SQL signature.
    expect(args).toEqual(
      expect.objectContaining({
        p_counted_cents: 16450,
        p_expected_cents: 16450,
        // Notes are passed through raw; the SQL RPC trims + null-coalesces.
        p_notes: "  with surrounding whitespace  ",
        p_operator: "staff-1",
        p_device_user_id: "device-1",
      })
    );
    // p_business_day is computed inside the action; just assert it's a
    // YYYY-MM-DD string so the contract is enforced without coupling to
    // wall-clock at test time.
    const businessDay = (args as Record<string, unknown>).p_business_day;
    expect(typeof businessDay).toBe("string");
    expect(businessDay as string).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    expect(res).toEqual({ ok: true, sessionId: "session-uuid-123" });
    // revalidatePath is the cache-busting hook the page relies on to
    // re-fetch the closed state on the very next render.
    expect(revalidatePath).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith("/end-of-day");
  });
});
