// Unit tests for `lib/onboarding/invite.ts` — the thin wrappers around
// Supabase's admin invite surface.
//
// These wrappers are the only place in the app that calls
// `auth.admin.createUser`, `auth.admin.generateLink`,
// `auth.admin.inviteUserByEmail`, and `auth.admin.deleteUser`. Pinning
// their shape here keeps the Onboard server actions free of Supabase
// boilerplate and gives the type system a stable signal for the
// "duplicate email" sentinel.
//
// Constitution IV — auth-critical: written before the module exists.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/admin", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

import { createSupabaseServiceRoleClient } from "@/lib/db/admin";

import {
  deleteInviteUser,
  generateMagicLinkInvite,
  sendPasswordInvite,
} from "@/lib/onboarding/invite";

type Mocked<T> = T & ReturnType<typeof vi.fn>;

type SupabaseLike = {
  auth: {
    admin: {
      createUser: ReturnType<typeof vi.fn>;
      generateLink: ReturnType<typeof vi.fn>;
      inviteUserByEmail: ReturnType<typeof vi.fn>;
      deleteUser: ReturnType<typeof vi.fn>;
    };
  };
};

function mockAdmin(): SupabaseLike {
  const createUser = vi.fn();
  const generateLink = vi.fn();
  const inviteUserByEmail = vi.fn();
  const deleteUser = vi.fn();
  const client: SupabaseLike = {
    auth: { admin: { createUser, generateLink, inviteUserByEmail, deleteUser } },
  };
  (createSupabaseServiceRoleClient as unknown as Mocked<() => unknown>).mockReturnValue(client);
  return client;
}

describe("generateMagicLinkInvite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates the user (no confirm) then generates a magiclink and returns { user_id, link }", async () => {
    const m = mockAdmin();
    m.auth.admin.createUser.mockResolvedValueOnce({
      data: { user: { id: "user-1" } },
      error: null,
    });
    m.auth.admin.generateLink.mockResolvedValueOnce({
      data: { properties: { action_link: "https://example.test/magic" } },
      error: null,
    });

    const result = await generateMagicLinkInvite("new@tang.dev", { display_name: "Ada" });

    expect(m.auth.admin.createUser).toHaveBeenCalledTimes(1);
    expect(m.auth.admin.createUser).toHaveBeenCalledWith({
      email: "new@tang.dev",
      email_confirm: false,
      user_metadata: { display_name: "Ada" },
    });
    expect(m.auth.admin.generateLink).toHaveBeenCalledTimes(1);
    const linkCall = m.auth.admin.generateLink.mock.calls[0][0];
    expect(linkCall.type).toBe("magiclink");
    expect(linkCall.email).toBe("new@tang.dev");
    expect(result).toEqual({
      user_id: "user-1",
      link: "https://example.test/magic",
    });
  });

  it("returns the duplicate sentinel when createUser reports 'already registered'", async () => {
    const m = mockAdmin();
    m.auth.admin.createUser.mockResolvedValueOnce({
      data: null,
      error: { message: "A user with this email already registered" },
    });

    const result = await generateMagicLinkInvite("dup@tang.dev");
    expect(result).toEqual({ user_id: null, link: null, error: "duplicate" });
    expect(m.auth.admin.generateLink).not.toHaveBeenCalled();
  });
});

describe("sendPasswordInvite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("invites via inviteUserByEmail with redirectTo + metadata and returns { user_id }", async () => {
    const m = mockAdmin();
    m.auth.admin.inviteUserByEmail.mockResolvedValueOnce({
      data: { user: { id: "user-2" } },
      error: null,
    });

    const result = await sendPasswordInvite("inv@tang.dev", { display_name: "Bea" });

    expect(m.auth.admin.inviteUserByEmail).toHaveBeenCalledTimes(1);
    const [emailArg, opts] = m.auth.admin.inviteUserByEmail.mock.calls[0];
    expect(emailArg).toBe("inv@tang.dev");
    expect(opts.redirectTo).toMatch(/\/auth\/callback\?type=invite$/);
    expect(opts.data).toEqual({ display_name: "Bea" });
    expect(result).toEqual({ user_id: "user-2" });
  });

  it("returns the duplicate sentinel when inviteUserByEmail reports 'already registered'", async () => {
    const m = mockAdmin();
    m.auth.admin.inviteUserByEmail.mockResolvedValueOnce({
      data: null,
      error: { message: "A user with this email already exists" },
    });

    const result = await sendPasswordInvite("dup@tang.dev");
    expect(result).toEqual({ user_id: null, error: "duplicate" });
  });
});

describe("deleteInviteUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls auth.admin.deleteUser with the user id (hard-delete, shouldSoftDelete=false)", async () => {
    const m = mockAdmin();
    m.auth.admin.deleteUser.mockResolvedValueOnce({ data: {}, error: null });

    await expect(deleteInviteUser("user-3")).resolves.toBeUndefined();
    // Phase 6 fix: explicit hard-delete frees the email immediately so a
    // re-invite to the same address succeeds. The SDK default is
    // version-dependent, hence the explicit `false`.
    expect(m.auth.admin.deleteUser).toHaveBeenCalledWith("user-3", false);
  });

  it("throws when deleteUser returns an error", async () => {
    const m = mockAdmin();
    m.auth.admin.deleteUser.mockResolvedValueOnce({
      data: null,
      error: { message: "boom" },
    });
    await expect(deleteInviteUser("user-4")).rejects.toBeDefined();
  });
});
