// @vitest-environment node
//
// Unit tests for `signOut` in `app/(studio)/actions.ts`.
//
// Issue #133 — clicking "Sign out" on `/select-staff` (the state where the
// user is signed in to Supabase but hasn't picked an operator yet) used to
// 500 because `signOut` resolved the session through `requireStudioSession`
// → `AuthRedirectError("/select-staff")` → re-thrown by
// `getStudioSessionOrDegraded` → unhandled inside the Server Action. The
// fix makes `signOut`'s contract "terminate the device session regardless
// of whether an operator is pinned in": it resolves the device user and the
// operator cookie's `sid` best-effort, then clears + redirects.
//
// Coverage matrix:
//   1. `/select-staff` state (Supabase user, NO operator cookie) — must
//      audit with acting_as_staff_id = null, clear cookie, sign out of
//      Supabase, redirect to /login. (#133 regression guard.)
//   2. Post-PIN state (Supabase user + valid operator cookie) — must audit
//      with the cookie's sid as acting_as_staff_id and redirect to /login.
//   3. Supabase backend unreachable (getUser throws) — must still audit
//      with null actor, clear cookie, redirect to /login. (Pre-existing
//      degraded behavior — regression guard so the fix doesn't lose it.)

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TEST_ACTING_AS_COOKIE_SECRET, mintCookie } from "./_fixtures";

// ── Mocks (declared before SUT import) ─────────────────────────────────────

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    const err = new Error("NEXT_REDIRECT") as Error & { digest: string };
    err.digest = `NEXT_REDIRECT;replace;${url};307`;
    throw err;
  }),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
  headers: vi.fn(),
}));

vi.mock("@/lib/db/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/auth/audit", () => ({
  recordAudit: vi.fn(async () => undefined),
  recordAuth: vi.fn(async () => undefined),
}));

// ── Imports of the SUT and the mocked modules ──────────────────────────────

import { cookies, headers } from "next/headers";

import { signOut } from "@/app/(studio)/actions";
import { recordAuth } from "@/lib/auth/audit";
import { createSupabaseServerClient } from "@/lib/db/server";

type Mocked<T> = T & ReturnType<typeof vi.fn>;

// ── Helpers ────────────────────────────────────────────────────────────────

const SID = "10000000-0000-0000-0000-000000000001";
const DEVICE_USER_ID = "00000000-0000-0000-0000-000000000001";
const COOKIE_NAME = "acting_as_staff_id";

type CookieStoreCalls = {
  deleted: string[];
};

function setCookieStore(store: Record<string, string>): CookieStoreCalls {
  const calls: CookieStoreCalls = { deleted: [] };
  const cookieStore = {
    get(name: string) {
      const value = store[name];
      return value === undefined ? undefined : { name, value };
    },
    delete(name: string) {
      calls.deleted.push(name);
    },
  };
  (cookies as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(cookieStore);
  return calls;
}

function setHeaders() {
  // signOut doesn't currently consume the headers, but the mock has to
  // resolve so an accidental future read doesn't break.
  (headers as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    get: () => null,
  });
}

type SupabaseMockCalls = {
  signOutCalls: number;
};

function setSupabase({
  user,
  authThrows,
}: {
  user?: { id: string } | null;
  authThrows?: Error;
}): SupabaseMockCalls {
  const calls: SupabaseMockCalls = { signOutCalls: 0 };

  const getUser = vi.fn(async () => {
    if (authThrows) throw authThrows;
    return { data: { user: user ?? null }, error: null };
  });
  const supabaseSignOut = vi.fn(async () => {
    calls.signOutCalls += 1;
    return { error: null };
  });

  (createSupabaseServerClient as unknown as Mocked<() => unknown>).mockResolvedValue({
    auth: { getUser, signOut: supabaseSignOut },
  });

  return calls;
}

function redirectUrlFrom(err: unknown): string {
  expect(err).toBeInstanceOf(Error);
  const digest = (err as { digest?: string }).digest ?? "";
  expect(digest).toMatch(/^NEXT_REDIRECT;/);
  return digest.split(";")[2];
}

describe("signOut", () => {
  const originalSecret = process.env.ACTING_AS_COOKIE_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ACTING_AS_COOKIE_SECRET = TEST_ACTING_AS_COOKIE_SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    setHeaders();
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.ACTING_AS_COOKIE_SECRET;
    } else {
      process.env.ACTING_AS_COOKIE_SECRET = originalSecret;
    }
  });

  it("/select-staff state — no operator cookie: audits with acting_as_staff_id=null, clears cookie, redirects to /login (#133)", async () => {
    const cookieCalls = setCookieStore({}); // No operator cookie.
    const supabaseCalls = setSupabase({ user: { id: DEVICE_USER_ID } });

    let thrown: unknown;
    try {
      await signOut();
    } catch (err) {
      thrown = err;
    }

    // 1. Redirect target is /login.
    expect(redirectUrlFrom(thrown)).toBe("/login");

    // 2. One device.signed_out audit row with the device user as actor and
    //    NULL as acting_as_staff_id (no operator selected yet).
    expect(vi.mocked(recordAuth)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordAuth)).toHaveBeenCalledWith(
      "device.signed_out",
      DEVICE_USER_ID,
      null,
      {}
    );

    // 3. Operator cookie cleared defensively (even though none was set).
    expect(cookieCalls.deleted).toContain(COOKIE_NAME);

    // 4. Supabase device session terminated.
    expect(supabaseCalls.signOutCalls).toBe(1);
  });

  it("post-PIN state — valid operator cookie: audits with acting_as_staff_id=sid, redirects to /login", async () => {
    const cookieValue = await mintCookie({ sid: SID });
    const cookieCalls = setCookieStore({ [COOKIE_NAME]: cookieValue });
    const supabaseCalls = setSupabase({ user: { id: DEVICE_USER_ID } });

    let thrown: unknown;
    try {
      await signOut();
    } catch (err) {
      thrown = err;
    }

    expect(redirectUrlFrom(thrown)).toBe("/login");

    expect(vi.mocked(recordAuth)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordAuth)).toHaveBeenCalledWith(
      "device.signed_out",
      DEVICE_USER_ID,
      SID,
      {}
    );

    expect(cookieCalls.deleted).toContain(COOKIE_NAME);
    expect(supabaseCalls.signOutCalls).toBe(1);
  });

  it("degraded — Supabase getUser throws: audits with null actor, still clears + redirects", async () => {
    const cookieValue = await mintCookie({ sid: SID });
    const cookieCalls = setCookieStore({ [COOKIE_NAME]: cookieValue });
    setSupabase({ authThrows: new Error("fetch failed") });

    let thrown: unknown;
    try {
      await signOut();
    } catch (err) {
      thrown = err;
    }

    expect(redirectUrlFrom(thrown)).toBe("/login");

    // The audit row still goes out — actor is null (we couldn't resolve the
    // device user), acting_as is the best-effort sid from the cookie payload.
    expect(vi.mocked(recordAuth)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordAuth)).toHaveBeenCalledWith("device.signed_out", null, SID, {});

    expect(cookieCalls.deleted).toContain(COOKIE_NAME);
  });
});
