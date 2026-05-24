// Unit tests for `app/(auth)/reset-password/actions.ts` — the
// `updatePassword` Server Action that completes the US3 password reset
// flow.
//
// Constitution IV (auth-critical): these tests are written BEFORE the
// action exists and MUST FAIL on first run. The contract is documented in
// `specs/010-login-redesign/contracts/server-actions.contract.md`
// § updatePassword and the audit semantics in
// `specs/010-login-redesign/contracts/audit.contract.md`.
//
// The five branches we cover:
//   (a) valid input + happy path  → redirect /select-staff
//                                  + recordAuth("device.password_reset", ...)
//   (b) password < 8 chars        → /reset-password?error=too_short
//   (c) password !== confirm      → /reset-password?error=mismatch
//   (d) no session                → /reset-password?error=expired
//   (e) AuthRetryableFetchError   → /reset-password?error=network
//
// We mock `@/lib/db/server` and `@/lib/auth/audit` so we can assert the
// SDK call surface + the audit write without touching Supabase. We also
// mock `next/navigation` so `redirect()` becomes an observable throw.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthRetryableFetchError } from "@supabase/supabase-js";

vi.mock("@/lib/db/server", () => ({
  createSupabaseServerClient: vi.fn(),
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

import { createSupabaseServerClient } from "@/lib/db/server";
import { recordAuth } from "@/lib/auth/audit";

import { updatePassword } from "@/app/(auth)/reset-password/actions";

type Mocked<T> = T & ReturnType<typeof vi.fn>;

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

function redirectUrlFrom(err: unknown): string {
  expect(err).toBeInstanceOf(Error);
  const digest = (err as { digest?: string }).digest ?? "";
  expect(digest).toMatch(/^NEXT_REDIRECT;/);
  const parts = digest.split(";");
  return parts[2];
}

type GetUserImpl = () => Promise<{
  data: { user: { id: string } | null };
  error: unknown;
}>;

type UpdateUserImpl = (args: { password: string }) => Promise<{ data: unknown; error: unknown }>;

function mockSupabase(
  getUserImpl: GetUserImpl = async () => ({
    data: { user: { id: "user-123" } },
    error: null,
  }),
  updateUserImpl: UpdateUserImpl = async () => ({ data: { user: { id: "user-123" } }, error: null })
) {
  const getUser = vi.fn(async () => getUserImpl());
  const updateUser = vi.fn(async (args: { password: string }) => updateUserImpl(args));
  (createSupabaseServerClient as unknown as Mocked<() => Promise<unknown>>).mockResolvedValue({
    auth: { getUser, updateUser },
  });
  return { getUser, updateUser };
}

describe("updatePassword — happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redirects to /select-staff and records device.password_reset on success", async () => {
    const { updateUser } = mockSupabase();

    let thrown: unknown;
    try {
      await updatePassword(
        formData({ password: "tang-nails-dev-new", confirm: "tang-nails-dev-new" })
      );
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toMatch(/^\/select-staff(\?|$)/);

    expect(updateUser).toHaveBeenCalledTimes(1);
    expect(updateUser.mock.calls[0][0]).toEqual({ password: "tang-nails-dev-new" });

    expect(recordAuth).toHaveBeenCalledWith("device.password_reset", "user-123", null, {
      method: "recovery",
    });
  });

  // 048-invitee-self-set-pin: when no `method` field is supplied (or it is
  // "recovery"), the recovery leg still lands on /select-staff — the PIN
  // step is invite-only (FR-013, SC-006).
  it("method=recovery (default) redirects to /select-staff, never /set-pin", async () => {
    mockSupabase();

    let thrown: unknown;
    try {
      await updatePassword(
        formData({
          password: "tang-nails-dev-new",
          confirm: "tang-nails-dev-new",
          method: "recovery",
        })
      );
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toMatch(/^\/select-staff(\?|$)/);
    expect(url).not.toContain("/set-pin");
  });
});

describe("updatePassword — validation branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redirects to /reset-password?error=too_short when password is < 8 chars", async () => {
    const { updateUser } = mockSupabase();

    let thrown: unknown;
    try {
      await updatePassword(formData({ password: "short", confirm: "short" }));
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toBe("/reset-password?error=too_short");

    // No SDK call when validation fails up-front.
    expect(updateUser).not.toHaveBeenCalled();
    expect(recordAuth).not.toHaveBeenCalled();
  });

  it("redirects to /reset-password?error=mismatch when password !== confirm", async () => {
    const { updateUser } = mockSupabase();

    let thrown: unknown;
    try {
      await updatePassword(formData({ password: "abc12345", confirm: "different1" }));
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toBe("/reset-password?error=mismatch");

    expect(updateUser).not.toHaveBeenCalled();
    expect(recordAuth).not.toHaveBeenCalled();
  });
});

describe("updatePassword — method=invite leg (012-user-onboarding)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("tags the audit row with payload.method='invite' and redirects to /set-pin when the form supplies method=invite", async () => {
    mockSupabase();

    let thrown: unknown;
    try {
      await updatePassword(
        formData({
          password: "tang-nails-dev-new",
          confirm: "tang-nails-dev-new",
          method: "invite",
        })
      );
    } catch (err) {
      thrown = err;
    }

    expect(recordAuth).toHaveBeenCalledWith("device.password_reset", "user-123", null, {
      method: "invite",
    });

    // 048-invitee-self-set-pin: the invite leg routes to the new /set-pin
    // step instead of straight to /select-staff.
    const url = redirectUrlFrom(thrown);
    expect(url).toMatch(/^\/set-pin(\?|$)/);
  });

  it("defaults payload.method to 'recovery' when no method field is present", async () => {
    mockSupabase();

    try {
      await updatePassword(
        formData({ password: "tang-nails-dev-new", confirm: "tang-nails-dev-new" })
      );
    } catch {
      // expected NEXT_REDIRECT to /select-staff
    }

    expect(recordAuth).toHaveBeenCalledWith("device.password_reset", "user-123", null, {
      method: "recovery",
    });
  });
});

describe("updatePassword — session + network branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redirects to /reset-password?error=expired when no session is present", async () => {
    const { updateUser } = mockSupabase(async () => ({
      data: { user: null },
      error: null,
    }));

    let thrown: unknown;
    try {
      await updatePassword(
        formData({ password: "tang-nails-dev-new", confirm: "tang-nails-dev-new" })
      );
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toBe("/reset-password?error=expired");

    expect(updateUser).not.toHaveBeenCalled();
    expect(recordAuth).not.toHaveBeenCalled();
  });

  it("redirects to /reset-password?error=network on AuthRetryableFetchError", async () => {
    mockSupabase(undefined, async () => {
      throw new AuthRetryableFetchError("network blip", 0);
    });

    let thrown: unknown;
    try {
      await updatePassword(
        formData({ password: "tang-nails-dev-new", confirm: "tang-nails-dev-new" })
      );
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toBe("/reset-password?error=network");

    // No audit row written when the SDK update fails.
    expect(recordAuth).not.toHaveBeenCalled();
  });

  // Issue #136 — SDK code "same_password" used to be funneled into
  // ?error=too_short, which lied to the user about the real problem.
  // updatePassword now routes it to its own branch.
  it("redirects to /reset-password?error=same_password when the SDK returns code='same_password'", async () => {
    mockSupabase(undefined, async () => ({
      data: null,
      error: {
        code: "same_password",
        message: "New password should be different from the old password.",
      },
    }));

    let thrown: unknown;
    try {
      await updatePassword(
        formData({ password: "tang-nails-dev-new", confirm: "tang-nails-dev-new" })
      );
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toBe("/reset-password?error=same_password");

    // No audit row written when the SDK rejected the update.
    expect(recordAuth).not.toHaveBeenCalled();
  });

  // Issue #136 — every other non-retryable SDK error (weak-password
  // policy, future server-side rules, etc.) routes to update_failed,
  // not the old too_short catch-all.
  it("redirects to /reset-password?error=update_failed on a non-retryable SDK error with an unrecognised code", async () => {
    mockSupabase(undefined, async () => ({
      data: null,
      error: { code: "weak_password", message: "Password is too weak." },
    }));

    let thrown: unknown;
    try {
      await updatePassword(
        formData({ password: "tang-nails-dev-new", confirm: "tang-nails-dev-new" })
      );
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toBe("/reset-password?error=update_failed");

    // The old behaviour funneled this into too_short — assert that's gone.
    expect(url).not.toContain("too_short");
    expect(recordAuth).not.toHaveBeenCalled();
  });
});
