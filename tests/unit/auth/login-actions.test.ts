// Unit tests for `app/(auth)/login/actions.ts`.
//
// Focus: the two invariants on `signInWithMagicLink` that are not (yet)
// exercised by the Playwright suite because Docker / local Supabase is
// unavailable in CI. Both are LOAD-BEARING — without them, the surface
// silently re-introduces user enumeration or self-service signup:
//
//   FR-022 — `options.shouldCreateUser` MUST be `false`. Without this,
//            Supabase silently provisions a user for any unknown email,
//            which is the very signup path the spec excludes.
//   FR-019 — The action MUST redirect to `/login?magic_sent=...`
//            regardless of the SDK's response (success, "unknown email",
//            or an SDK error). Any branching reveals whether the email
//            corresponds to a real account.
//
// We mock `@/lib/db/server` so we can assert what the SDK was called with
// without touching a real Supabase. We mock `next/navigation` so
// `redirect()` becomes an inspectable throw instead of a real Next.js
// redirect (which can't be observed in a Vitest env). We mock `next/headers`
// so `headers().get('host')` returns a deterministic origin for the
// `emailRedirectTo` assertion.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    // Mimic Next's behavior: `redirect()` throws a special error so the
    // calling function short-circuits. The thrown object carries the
    // destination URL on `.digest` so we can assert against it.
    const err = new Error("NEXT_REDIRECT") as Error & { digest: string };
    err.digest = `NEXT_REDIRECT;replace;${url};307`;
    throw err;
  }),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({
    get(name: string) {
      if (name === "host") return "localhost:3000";
      if (name === "x-forwarded-proto") return null;
      if (name === "origin") return null;
      return null;
    },
  })),
}));

// `lib/auth/audit` is imported transitively by the SUT but not exercised on
// the magic-link path. Stub it to a no-op so the test doesn't try to talk to
// `@/lib/db/admin` (which would in turn fail on missing env vars).
vi.mock("@/lib/auth/audit", () => ({
  recordAuth: vi.fn(async () => undefined),
}));

import { createSupabaseServerClient } from "@/lib/db/server";

import { signInWithMagicLink } from "@/app/(auth)/login/actions";

type Mocked<T> = T & ReturnType<typeof vi.fn>;

/** Build a fake Supabase client whose `auth.signInWithOtp` is a `vi.fn()`. */
function mockSupabase(
  otpImpl: (args: unknown) => Promise<{ data: unknown; error: unknown }> = async () => ({
    data: { user: null, session: null },
    error: null,
  }),
) {
  const signInWithOtp = vi.fn(async (args: unknown) => otpImpl(args));
  (createSupabaseServerClient as unknown as Mocked<() => Promise<unknown>>).mockResolvedValue({
    auth: { signInWithOtp },
  });
  return { signInWithOtp };
}

/** Extract the destination URL from a thrown NEXT_REDIRECT digest. */
function redirectUrlFrom(err: unknown): string {
  expect(err).toBeInstanceOf(Error);
  const digest = (err as { digest?: string }).digest ?? "";
  expect(digest).toMatch(/^NEXT_REDIRECT;/);
  // Format: `NEXT_REDIRECT;replace;<url>;<statusCode>`
  const parts = digest.split(";");
  return parts[2];
}

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

describe("signInWithMagicLink — FR-022: shouldCreateUser MUST be false", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls supabase.auth.signInWithOtp exactly once with shouldCreateUser: false", async () => {
    const { signInWithOtp } = mockSupabase();

    let thrown: unknown;
    try {
      await signInWithMagicLink(formData({ email: "owner@tangnails.dev", next: "/dashboard" }));
    } catch (err) {
      thrown = err;
    }
    // The redirect throws — that's the happy path.
    expect(thrown).toBeDefined();

    expect(signInWithOtp).toHaveBeenCalledTimes(1);
    const callArg = signInWithOtp.mock.calls[0][0] as {
      email: string;
      options?: { shouldCreateUser?: boolean; emailRedirectTo?: string };
    };
    expect(callArg.email).toBe("owner@tangnails.dev");
    expect(callArg.options).toBeDefined();
    // The load-bearing assertion.
    expect(callArg.options!.shouldCreateUser).toBe(false);
  });

  it("calls signInWithOtp with emailRedirectTo pointing at /auth/callback and carrying ?next=", async () => {
    const { signInWithOtp } = mockSupabase();

    try {
      await signInWithMagicLink(formData({ email: "owner@tangnails.dev", next: "/dashboard" }));
    } catch {
      // expected NEXT_REDIRECT
    }

    const callArg = signInWithOtp.mock.calls[0][0] as {
      options?: { emailRedirectTo?: string };
    };
    expect(callArg.options?.emailRedirectTo).toMatch(
      /^http:\/\/localhost:3000\/auth\/callback\?next=/,
    );
    expect(callArg.options?.emailRedirectTo).toContain(encodeURIComponent("/dashboard"));
  });
});

describe("signInWithMagicLink — FR-019: always redirect to ?magic_sent regardless of SDK outcome", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to /login?magic_sent=<email> on SDK success (known email)", async () => {
    mockSupabase(async () => ({ data: { user: { id: "u1" }, session: null }, error: null }));

    let thrown: unknown;
    try {
      await signInWithMagicLink(formData({ email: "owner@tangnails.dev", next: "/dashboard" }));
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("/login?magic_sent=");
    expect(url).toContain(encodeURIComponent("owner@tangnails.dev"));
    expect(url).toContain("next=");
  });

  it("redirects to /login?magic_sent=<email> on SDK success (unknown email — shouldCreateUser:false path)", async () => {
    // Supabase returns success-shaped data for unknown emails when
    // `shouldCreateUser: false`. Same redirect — no enumeration possible.
    mockSupabase(async () => ({ data: { user: null, session: null }, error: null }));

    let thrown: unknown;
    try {
      await signInWithMagicLink(formData({ email: "nobody@example.com", next: "/dashboard" }));
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("/login?magic_sent=");
    expect(url).toContain(encodeURIComponent("nobody@example.com"));
  });

  it("redirects to /login?magic_sent=<email> even when the SDK returns an error object", async () => {
    mockSupabase(async () => ({
      data: null,
      error: { name: "AuthApiError", message: "Signups not allowed for otp", status: 400 },
    }));

    let thrown: unknown;
    try {
      await signInWithMagicLink(formData({ email: "blocked@example.com", next: "/dashboard" }));
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("/login?magic_sent=");
    expect(url).toContain(encodeURIComponent("blocked@example.com"));
  });

  it("redirects to /login?magic_sent=<email> even when the SDK throws", async () => {
    mockSupabase(async () => {
      throw new Error("network blip");
    });
    // Suppress the expected console.error so test output stays clean.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    let thrown: unknown;
    try {
      await signInWithMagicLink(formData({ email: "thrown@example.com", next: "/dashboard" }));
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("/login?magic_sent=");
    expect(url).toContain(encodeURIComponent("thrown@example.com"));

    errSpy.mockRestore();
  });

  it("redirects to /login?error=invalid (NOT magic_sent) when email is empty", async () => {
    // The empty-email path is the only acceptable branch: a missing email
    // means the form was bypassed, so we surface a generic invalid error
    // rather than confirming "we sent a link" with no address.
    const { signInWithOtp } = mockSupabase();

    let thrown: unknown;
    try {
      await signInWithMagicLink(formData({ email: "", next: "/dashboard" }));
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("/login?error=invalid");
    // SDK never called when email is empty.
    expect(signInWithOtp).not.toHaveBeenCalled();
  });
});
