// Unit tests for `completeRecovery` — the server action behind
// `/auth/recovery-callback` that completes an admin-initiated, implicit-flow
// password reset (session tokens arriving in the URL hash) into a cookie
// session. See issue #126.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/audit", () => ({ recordAuth: vi.fn(async () => undefined) }));
vi.mock("@/lib/db/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/db/admin", () => ({ createSupabaseServiceRoleClient: vi.fn() }));

import { recordAuth } from "@/lib/auth/audit";
import { createSupabaseServerClient } from "@/lib/db/server";
import { createSupabaseServiceRoleClient } from "@/lib/db/admin";

import { completeRecovery } from "@/app/auth/recovery-callback/actions";

type Mocked<T> = T & ReturnType<typeof vi.fn>;

type ServerClientOpts = {
  setSessionError?: { message: string } | null;
  user?: { id: string } | null;
  getUserError?: { message: string } | null;
};

function mockServerClient(opts: ServerClientOpts = {}): { setSession: ReturnType<typeof vi.fn> } {
  const setSession = vi.fn(async () => ({ error: opts.setSessionError ?? null }));
  const getUser = vi.fn(async () => ({
    data: { user: opts.user === undefined ? { id: "user-1" } : opts.user },
    error: opts.getUserError ?? null,
  }));
  (createSupabaseServerClient as unknown as Mocked<() => unknown>).mockResolvedValue({
    auth: { setSession, getUser },
  });
  return { setSession };
}

function mockAdminClient(): {
  update: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
} {
  const eq = vi.fn(async () => ({ error: null }));
  const update = vi.fn(() => ({ eq }));
  (createSupabaseServiceRoleClient as unknown as Mocked<() => unknown>).mockReturnValue({
    from: vi.fn(() => ({ update })),
  });
  return { update, eq };
}

describe("completeRecovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("establishes the session, audits device.signed_in with method=recovery, stamps last_sign_in_at", async () => {
    mockServerClient({ user: { id: "user-1" } });
    const admin = mockAdminClient();

    const result = await completeRecovery("acc-tok", "ref-tok");

    expect(result).toEqual({ ok: true });
    expect(recordAuth).toHaveBeenCalledTimes(1);
    const call = (recordAuth as unknown as Mocked<() => unknown>).mock.calls[0];
    expect(call[0]).toBe("device.signed_in");
    expect(call[1]).toBe("user-1");
    expect(call[3]).toMatchObject({ method: "recovery" });

    // last_sign_in_at is stamped, but — unlike acceptInvite — `state` /
    // `active` are deliberately NOT touched (a reset is not a lifecycle
    // transition).
    expect(admin.update).toHaveBeenCalledTimes(1);
    const updateArg = (admin.update as unknown as Mocked<() => unknown>).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(typeof updateArg.last_sign_in_at).toBe("string");
    expect(updateArg).not.toHaveProperty("state");
    expect(updateArg).not.toHaveProperty("active");
    expect(admin.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("returns { ok: false } and does not audit when setSession fails", async () => {
    mockServerClient({ setSessionError: { message: "invalid token" } });
    mockAdminClient();

    const result = await completeRecovery("bad", "bad");
    expect(result).toEqual({ ok: false });
    expect(recordAuth).not.toHaveBeenCalled();
  });

  it("returns { ok: false } when getUser cannot validate the session", async () => {
    mockServerClient({ user: null, getUserError: { message: "bad jwt" } });
    mockAdminClient();

    const result = await completeRecovery("acc", "ref");
    expect(result).toEqual({ ok: false });
    expect(recordAuth).not.toHaveBeenCalled();
  });

  it("returns { ok: false } when tokens are missing", async () => {
    const result = await completeRecovery("", "");
    expect(result).toEqual({ ok: false });
    expect(recordAuth).not.toHaveBeenCalled();
  });

  it("still succeeds when the best-effort last_sign_in_at update throws", async () => {
    mockServerClient({ user: { id: "user-2" } });
    (createSupabaseServiceRoleClient as unknown as Mocked<() => unknown>).mockImplementation(() => {
      throw new Error("admin client unavailable");
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await completeRecovery("acc", "ref");

    expect(result).toEqual({ ok: true });
    expect(recordAuth).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });
});
