// Unit tests for the `editCashDrawerAction` Server Action.
//
// Written BEFORE the implementation per Principle IV (Test-First for
// Critical Paths). The implementation at
// `app/(studio)/end-of-day/history/actions.ts` (T012) makes these pass.
//
// Contract source: specs/020-past-cash-counts/contracts/server-action.md.
//
// Mock surface mirrors `close-action.test.ts`:
//   - `requireStudioSession` — controls operator role + ids.
//   - `createSupabaseServiceRoleClient` — exposes `.rpc(...)` spy.
//   - `revalidatePath` — asserted on the happy path.
// Edit does NOT consume `createSupabaseServerClient` or
// `getSalonTimezone` — there's no business_day derivation.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  requireStudioSession: vi.fn(),
}));
vi.mock("@/lib/db/admin", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { revalidatePath } from "next/cache";

import { editCashDrawerAction } from "@/app/(studio)/end-of-day/history/actions";
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

const VALID_INPUT = {
  sessionId: "11111111-1111-1111-1111-111111111111",
  countedCents: 16450,
  notes: "Recount confirmed",
};

describe("editCashDrawerAction — role gate", () => {
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

      const res = await editCashDrawerAction(VALID_INPUT);

      expect(res).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(rpcSpy).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    }
  );
});

describe("editCashDrawerAction — input validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockViewer("manager");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "returns BAD_INPUT when countedCents is %s",
    async (countedCents) => {
      const rpcSpy = mockRpc({ data: null, error: null });

      const res = await editCashDrawerAction({ ...VALID_INPUT, countedCents });

      expect(res).toMatchObject({ ok: false, code: "BAD_INPUT" });
      expect(rpcSpy).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    }
  );

  it("returns BAD_INPUT when sessionId is an empty string", async () => {
    const rpcSpy = mockRpc({ data: null, error: null });

    const res = await editCashDrawerAction({ ...VALID_INPUT, sessionId: "" });

    expect(res).toMatchObject({ ok: false, code: "BAD_INPUT" });
    expect(rpcSpy).not.toHaveBeenCalled();
  });
});

describe("editCashDrawerAction — error code mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockViewer("manager");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps cash_drawer_session_missing → NOT_FOUND", async () => {
    mockRpc({ data: null, error: { message: "cash_drawer_session_missing" } });
    const res = await editCashDrawerAction(VALID_INPUT);
    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("maps cash_drawer_session_not_closed → NOT_CLOSED", async () => {
    mockRpc({ data: null, error: { message: "cash_drawer_session_not_closed" } });
    const res = await editCashDrawerAction(VALID_INPUT);
    expect(res).toMatchObject({ ok: false, code: "NOT_CLOSED" });
  });

  it("maps cash_drawer_note_required → NOTE_REQUIRED", async () => {
    mockRpc({ data: null, error: { message: "cash_drawer_note_required" } });
    const res = await editCashDrawerAction({ ...VALID_INPUT, notes: "" });
    expect(res).toMatchObject({ ok: false, code: "NOTE_REQUIRED" });
  });

  it("maps unknown DB errors → UNEXPECTED", async () => {
    mockRpc({ data: null, error: { message: "something totally else" } });
    const res = await editCashDrawerAction(VALID_INPUT);
    expect(res).toMatchObject({ ok: false, code: "UNEXPECTED" });
  });
});

describe("editCashDrawerAction — happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockViewer("owner");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls supabase.rpc('pos_edit_cash_drawer', …) with the correct arg shape, revalidates both paths, and returns the sessionId", async () => {
    const rpcSpy = mockRpc({ data: VALID_INPUT.sessionId, error: null });

    const res = await editCashDrawerAction(VALID_INPUT);

    expect(rpcSpy).toHaveBeenCalledTimes(1);
    const [rpcName, args] = rpcSpy.mock.calls[0]!;
    expect(rpcName).toBe("pos_edit_cash_drawer");
    expect(args).toEqual(
      expect.objectContaining({
        p_session_id: VALID_INPUT.sessionId,
        p_counted_cents: VALID_INPUT.countedCents,
        p_notes: VALID_INPUT.notes,
        p_operator: "staff-1",
        p_device_user_id: "device-1",
      })
    );

    expect(res).toEqual({ ok: true, sessionId: VALID_INPUT.sessionId });

    // Both the list and the detail must revalidate so the next render
    // of either surface picks up the new counted/variance/notes.
    expect(revalidatePath).toHaveBeenCalledTimes(2);
    expect(revalidatePath).toHaveBeenCalledWith("/end-of-day/history");
    expect(revalidatePath).toHaveBeenCalledWith(`/end-of-day/history/${VALID_INPUT.sessionId}`);
  });
});
