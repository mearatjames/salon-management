// Unit tests for `acceptInvite` — the server action behind
// `/auth/invite-callback` that completes an implicit-flow invite (session
// tokens arriving in the URL hash) into a cookie session.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/audit", () => ({ recordAuth: vi.fn(async () => undefined) }));
vi.mock("@/lib/db/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/db/admin", () => ({ createSupabaseServiceRoleClient: vi.fn() }));

import { recordAuth } from "@/lib/auth/audit";
import { createSupabaseServerClient } from "@/lib/db/server";
import { createSupabaseServiceRoleClient } from "@/lib/db/admin";

import { acceptInvite } from "@/app/auth/invite-callback/actions";

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

function mockAdminClient(): { update: ReturnType<typeof vi.fn>; eq: ReturnType<typeof vi.fn> } {
  const eq = vi.fn(async () => ({ error: null }));
  const update = vi.fn(() => ({ eq }));
  (createSupabaseServiceRoleClient as unknown as Mocked<() => unknown>).mockReturnValue({
    from: vi.fn(() => ({ update })),
  });
  return { update, eq };
}

describe("acceptInvite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("magic-link: establishes the session, audits device.signed_in, flips staff active, routes to /select-staff", async () => {
    mockServerClient({ user: { id: "user-1" } });
    const admin = mockAdminClient();

    const result = await acceptInvite("acc-tok", "ref-tok", null);

    expect(result).toEqual({ ok: true, destination: "/select-staff" });
    expect(recordAuth).toHaveBeenCalledTimes(1);
    const call = (recordAuth as unknown as Mocked<() => unknown>).mock.calls[0];
    expect(call[0]).toBe("device.signed_in");
    expect(call[1]).toBe("user-1");
    expect(call[3]).toMatchObject({ method: "invite" });
    expect(admin.update).toHaveBeenCalledWith(
      expect.objectContaining({ state: "active", active: true })
    );
    expect(admin.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("password method routes to /reset-password?type=invite", async () => {
    mockServerClient({ user: { id: "user-2" } });
    mockAdminClient();

    const result = await acceptInvite("acc", "ref", "password");
    expect(result).toEqual({ ok: true, destination: "/reset-password?type=invite" });
  });

  it("returns { ok: false } and does not audit when setSession fails", async () => {
    mockServerClient({ setSessionError: { message: "invalid token" } });
    mockAdminClient();

    const result = await acceptInvite("bad", "bad", null);
    expect(result).toEqual({ ok: false });
    expect(recordAuth).not.toHaveBeenCalled();
  });

  it("returns { ok: false } when getUser cannot validate the session", async () => {
    mockServerClient({ user: null, getUserError: { message: "bad jwt" } });
    mockAdminClient();

    const result = await acceptInvite("acc", "ref", null);
    expect(result).toEqual({ ok: false });
    expect(recordAuth).not.toHaveBeenCalled();
  });

  it("returns { ok: false } when tokens are missing", async () => {
    const result = await acceptInvite("", "", null);
    expect(result).toEqual({ ok: false });
  });
});
