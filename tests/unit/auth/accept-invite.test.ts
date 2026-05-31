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
  user?: { id: string; email?: string } | null;
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

type QueryResult = { data: Array<{ id: string }> | null; error: unknown };

// Chainable, awaitable staff-query builder — see callback.test.ts for the
// rationale. update/eq/is/ilike return the builder; `.select()` and awaiting
// the builder both resolve to the configured result. Successive `from()` calls
// hand back the primary (by user_id) then the fallback (by email) builders.
function makeBuilder(result: QueryResult) {
  const resolved = Promise.resolve(result);
  const builder: Record<string, unknown> = {
    update: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    is: vi.fn(() => builder),
    ilike: vi.fn(() => builder),
    select: vi.fn(() => resolved),
    then: (res: (v: QueryResult) => unknown, rej?: (e: unknown) => unknown) =>
      resolved.then(res, rej),
  };
  return builder as {
    update: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    is: ReturnType<typeof vi.fn>;
    ilike: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
  };
}

function mockAdminClient(opts: { primary?: QueryResult; fallback?: QueryResult } = {}) {
  const primary = makeBuilder(opts.primary ?? { data: [{ id: "staff-1" }], error: null });
  const fallback = makeBuilder(opts.fallback ?? { data: [{ id: "staff-2" }], error: null });
  const builders = [primary, fallback];
  let i = 0;
  const from = vi.fn(() => builders[Math.min(i++, builders.length - 1)]);
  (createSupabaseServiceRoleClient as unknown as Mocked<() => unknown>).mockReturnValue({ from });
  return { from, primary, fallback };
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
    expect(admin.primary.update).toHaveBeenCalledWith(
      expect.objectContaining({ state: "active", active: true })
    );
    expect(admin.primary.eq).toHaveBeenCalledWith("user_id", "user-1");
    // user_id matched a row, so the email back-fill never ran.
    expect(admin.fallback.update).not.toHaveBeenCalled();
  });

  it("back-fills user_id by email when no staff row matches by user_id (stuck pending invite)", async () => {
    mockServerClient({ user: { id: "user-9", email: "Seed_Owner@example.com" } });
    const admin = mockAdminClient({ primary: { data: [], error: null } });

    const result = await acceptInvite("acc", "ref", null);

    expect(result).toEqual({ ok: true, destination: "/select-staff" });
    // The fallback query linked user_id + flipped the invited row to active…
    expect(admin.fallback.update).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-9", state: "active", active: true })
    );
    // …guarded to an unlinked, invited, non-removed row matched by escaped email.
    expect(admin.fallback.is).toHaveBeenCalledWith("user_id", null);
    expect(admin.fallback.is).toHaveBeenCalledWith("removed_at", null);
    expect(admin.fallback.eq).toHaveBeenCalledWith("state", "invited");
    expect(admin.fallback.ilike).toHaveBeenCalledWith("email", "Seed\\_Owner@example.com");
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
