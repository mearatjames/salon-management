// Unit tests for `app/auth/callback/route.ts` — the new `?type=invite`
// branch introduced in 012-user-onboarding.
//
// Three behaviors:
//   (a) `?type=invite` with valid code → redirects to
//       `/reset-password?type=invite`; audit row carries
//       `payload.method='invite'`.
//   (b) `?type=invite` without code → redirects to
//       `/reset-password?type=invite&error=expired`.
//   (c) Every successful exchange (regardless of `type`) calls the admin
//       client to UPDATE the matching staff row's `last_sign_in_at`,
//       `state='active'`, `active=true` — idempotent on already-active
//       rows, flips invited rows to active. (R10 / Routes contract.)
//
// We mock `@/lib/db/server` (regular client used by exchangeCodeForSession),
// `@/lib/db/admin` (service-role for the staff UPDATE), `@/lib/auth/audit`,
// and `next/navigation`'s `redirect` so we can assert the destination by
// catching the thrown digest. The audit call is asserted to fire BEFORE
// the redirect (Constitution III).
//
// Constitution IV — auth-critical: must FAIL before T014 implementation
// lands, PASS after.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/db/admin", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/auth/audit", () => ({
  recordAuth: vi.fn(async () => undefined),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    const err = new Error("NEXT_REDIRECT") as Error & { digest: string };
    err.digest = `NEXT_REDIRECT;replace;${url};307`;
    throw err;
  }),
}));

import { NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/lib/db/server";
import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import { recordAuth } from "@/lib/auth/audit";

import { GET } from "@/app/auth/callback/route";

type Mocked<T> = T & ReturnType<typeof vi.fn>;

function makeRequest(query: string): NextRequest {
  return new NextRequest(new URL(`http://localhost:3000/auth/callback${query}`));
}

function mockServerExchange(opts: {
  user?: { id: string; email?: string; app_metadata?: { provider?: string } } | null;
  error?: unknown;
}) {
  const exchangeCodeForSession = vi.fn(async () => ({
    data: opts.user ? { user: opts.user } : { user: null },
    error: opts.error ?? null,
  }));
  (createSupabaseServerClient as unknown as Mocked<() => Promise<unknown>>).mockResolvedValue({
    auth: { exchangeCodeForSession },
  });
  return { exchangeCodeForSession };
}

type QueryResult = { data: Array<{ id: string }> | null; error: unknown };

// A chainable, awaitable staff-query builder. update/eq/is/ilike all return
// the same builder; `.select()` resolves to the configured result, and the
// builder itself is thenable so a chain that ends in a filter (the email
// back-fill) resolves too. Each `from()` call returns the next builder so the
// primary (by user_id) and fallback (by email) chains are asserted separately.
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

function mockAdminStaffUpdate(opts: { primary?: QueryResult; fallback?: QueryResult } = {}) {
  const primary = makeBuilder(opts.primary ?? { data: [{ id: "staff-1" }], error: null });
  const fallback = makeBuilder(opts.fallback ?? { data: [{ id: "staff-2" }], error: null });
  const builders = [primary, fallback];
  let i = 0;
  const from = vi.fn((_table: string) => builders[Math.min(i++, builders.length - 1)]);
  (createSupabaseServiceRoleClient as unknown as Mocked<() => unknown>).mockReturnValue({
    from,
  });
  return { from, primary, fallback };
}

function redirectUrlFrom(err: unknown): string {
  expect(err).toBeInstanceOf(Error);
  const digest = (err as { digest?: string }).digest ?? "";
  expect(digest).toMatch(/^NEXT_REDIRECT;/);
  return digest.split(";")[2];
}

describe("auth/callback ?type=invite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redirects to /reset-password?type=invite&error=expired when code is missing", async () => {
    mockAdminStaffUpdate();
    let thrown: unknown;
    try {
      await GET(makeRequest("?type=invite"));
    } catch (err) {
      thrown = err;
    }
    expect(redirectUrlFrom(thrown)).toBe("/reset-password?type=invite&error=expired");
  });

  it("redirects to /reset-password?type=invite&error=expired when exchange fails", async () => {
    mockServerExchange({ error: { message: "stale code" } });
    mockAdminStaffUpdate();

    let thrown: unknown;
    try {
      await GET(makeRequest("?code=abc&type=invite"));
    } catch (err) {
      thrown = err;
    }
    expect(redirectUrlFrom(thrown)).toBe("/reset-password?type=invite&error=expired");
  });

  it("on successful invite exchange: writes audit with method='invite' then redirects to /reset-password?type=invite", async () => {
    mockServerExchange({
      user: { id: "user-99", app_metadata: { provider: "email" } },
    });
    mockAdminStaffUpdate();

    let thrown: unknown;
    try {
      await GET(makeRequest("?code=abc&type=invite"));
    } catch (err) {
      thrown = err;
    }
    expect(redirectUrlFrom(thrown)).toBe("/reset-password?type=invite");

    expect(recordAuth).toHaveBeenCalledWith("device.signed_in", "user-99", null, {
      method: "invite",
    });
  });
});

describe("auth/callback staff sign-in mark (all types)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("UPDATEs the matching staff row's last_sign_in_at + state + active on a successful magic-link exchange", async () => {
    mockServerExchange({
      user: { id: "user-77", app_metadata: { provider: "email" } },
    });
    const admin = mockAdminStaffUpdate();

    try {
      await GET(makeRequest("?code=abc"));
    } catch {
      // expected NEXT_REDIRECT
    }

    expect(admin.from).toHaveBeenCalledWith("staff");
    expect(admin.primary.update).toHaveBeenCalledTimes(1);
    const payload = admin.primary.update.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(payload.state).toBe("active");
    expect(payload.active).toBe(true);
    expect(typeof payload.last_sign_in_at).toBe("string");
    expect(admin.primary.eq).toHaveBeenCalledWith("user_id", "user-77");
  });

  it("still UPDATEs on the invite branch", async () => {
    mockServerExchange({
      user: { id: "user-88", app_metadata: { provider: "email" } },
    });
    const admin = mockAdminStaffUpdate();

    try {
      await GET(makeRequest("?code=abc&type=invite"));
    } catch {
      // expected NEXT_REDIRECT
    }

    expect(admin.primary.update).toHaveBeenCalledTimes(1);
    const payload = admin.primary.update.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(payload.state).toBe("active");
    expect(payload.active).toBe(true);
  });

  it("does NOT back-fill by email when the user_id match already updated a row", async () => {
    mockServerExchange({
      user: { id: "user-55", email: "linked@example.com", app_metadata: { provider: "email" } },
    });
    const admin = mockAdminStaffUpdate({ primary: { data: [{ id: "s1" }], error: null } });

    try {
      await GET(makeRequest("?code=abc"));
    } catch {
      // expected NEXT_REDIRECT
    }

    // Only the primary (by user_id) query ran — no second from() for the email path.
    expect(admin.from).toHaveBeenCalledTimes(1);
    expect(admin.fallback.update).not.toHaveBeenCalled();
  });

  it("back-fills user_id by email when no staff row matches by user_id (stuck pending invite)", async () => {
    mockServerExchange({
      user: { id: "user-66", email: "Seed_Owner@example.com", app_metadata: { provider: "email" } },
    });
    const admin = mockAdminStaffUpdate({ primary: { data: [], error: null } });

    try {
      await GET(makeRequest("?code=abc&type=invite"));
    } catch {
      // expected NEXT_REDIRECT
    }

    // The fallback query linked user_id + flipped the invited row to active…
    expect(admin.from).toHaveBeenCalledTimes(2);
    expect(admin.fallback.update).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-66", state: "active", active: true })
    );
    // …guarded to an unlinked, invited row matched by (escaped) email only.
    expect(admin.fallback.is).toHaveBeenCalledWith("user_id", null);
    expect(admin.fallback.is).toHaveBeenCalledWith("removed_at", null);
    expect(admin.fallback.eq).toHaveBeenCalledWith("state", "invited");
    // `_` is a SQL LIKE wildcard — it must be escaped so the match stays exact.
    expect(admin.fallback.ilike).toHaveBeenCalledWith("email", "Seed\\_Owner@example.com");
  });
});
