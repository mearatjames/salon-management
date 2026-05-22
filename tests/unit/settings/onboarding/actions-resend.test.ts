// Unit tests for `resendInvite` in
// `app/(studio)/settings/onboarding/actions.ts`.
//
// Mirrors `actions-offboard.test.ts` for the mocking pattern (redirect-as-
// throw, per-module mocks). Coverage matrix per dispatch (012-user-onboarding
// § Phase 7 / US5 / T070):
//
//   - Magic-link path: target state='invited', invite_method='magic_link' →
//     deletes the stale auth user → generateMagicLinkInvite → inviteUserByEmail
//     on the '<origin>/auth/invite-callback' redirect → UPDATE staff
//     `user_id = <rotated>`, `invited_at = now()` → audit
//     `user.invite_resent { email, method: 'magic_link', by }` → redirect
//     ?toast=resent&name=<display_name>.
//   - Password path: target invite_method='password' → sendPasswordInvite →
//     inviteUserByEmail on '<origin>/auth/invite-callback?method=password' →
//     UPDATE user_id + invited_at → audit payload.method='password' →
//     redirect ?toast=resent&name=…
//   - Confirmed invitee (clicked the link once): the stale auth user is
//     deleted first so the re-invite is not rejected with `email_exists`.
//   - Non-invited target (state='active' / 'offboarded' / removed_at non-null
//     / missing) → ?error=not_found.
//   - Supabase failure (re-invite throws) → ?error=invite_failed. NO audit
//     row written.
//   - UPDATE failure → ?error=server_error. NO audit row written.
//   - Non-owner viewer → /dashboard?error=forbidden.
//
// Implementation model: resend DELETES the stale auth user, then re-invites
// via generateMagicLinkInvite / sendPasswordInvite (both call
// inviteUserByEmail — the only admin primitive that actually SENDS the email).
// The delete is required because the invitee's auth user is CONFIRMED the
// moment they click any invite/magic link, and inviteUserByEmail rejects a
// confirmed address with `email_exists`. Deleting first frees the email
// unconditionally; the staff row is then repointed at the rotated user id.
// `generateLink` is never used — routing resend through it was the original
// delivery bug.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks (declared before SUT import) ─────────────────────────────────────

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    const err = new Error("NEXT_REDIRECT") as Error & { digest: string };
    err.digest = `NEXT_REDIRECT;replace;${url};307`;
    throw err;
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({
    get: (k: string) => {
      if (k === "x-forwarded-proto") return "http";
      if (k === "host") return "localhost:3000";
      return null;
    },
  })),
}));

vi.mock("@/lib/auth/session", () => ({
  requireStudioSession: vi.fn(),
}));

vi.mock("@/lib/auth/audit", () => ({
  recordAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/db/admin", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

// ── Imports of the SUT and the mocked modules ──────────────────────────────

import { recordAudit } from "@/lib/auth/audit";
import { requireStudioSession, type StudioViewer } from "@/lib/auth/session";
import { createSupabaseServiceRoleClient } from "@/lib/db/admin";

import { resendInvite } from "@/app/(studio)/settings/onboarding/actions";

type Mocked<T> = T & ReturnType<typeof vi.fn>;

// ── Helpers ────────────────────────────────────────────────────────────────

const OWNER_VIEWER: StudioViewer = {
  deviceUserId: "device-owner-1",
  staff: {
    id: "staff-owner-1",
    display_name: "Maya Patel",
    role: "owner",
    color_token: "--avatar-rose",
  },
};

const MANAGER_VIEWER: StudioViewer = {
  deviceUserId: "device-mgr-1",
  staff: {
    id: "staff-mgr-1",
    display_name: "Jordan Lee",
    role: "manager",
    color_token: "--avatar-amber",
  },
};

function resendForm(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const merged: Record<string, string> = {
    staff_id: "staff-target-1",
    ...overrides,
  };
  for (const [k, v] of Object.entries(merged)) {
    fd.append(k, v);
  }
  return fd;
}

function redirectUrlFrom(err: unknown): string {
  expect(err).toBeInstanceOf(Error);
  const digest = (err as { digest?: string }).digest ?? "";
  expect(digest).toMatch(/^NEXT_REDIRECT;/);
  return digest.split(";")[2];
}

type TargetRow = {
  id: string;
  user_id: string | null;
  email: string | null;
  display_name: string;
  state: "active" | "invited" | "offboarded";
  invite_method: "magic_link" | "password" | null;
  removed_at: string | null;
};

const DEFAULT_TARGET: TargetRow = {
  id: "staff-target-1",
  user_id: "auth-user-target-1",
  email: "hana@tangnails.com",
  display_name: "Hana Soto",
  state: "invited",
  invite_method: "magic_link",
  removed_at: null,
};

type AdminMockOpts = {
  target?: Partial<TargetRow> | null;
  updateError?: { code?: string; message?: string } | null;
  inviteUserByEmailError?: Error | null;
  // When true the mock models a Supabase invitee whose auth user is already
  // CONFIRMED (clicked an invite/magic link once): inviteUserByEmail rejects
  // it with `email_exists` until the stale auth user is deleted.
  existingUserConfirmed?: boolean;
};

function mockAdminClient(opts: AdminMockOpts = {}): {
  lastUpdate: { current: Record<string, unknown> | null };
  generateLinkCalls: Array<{ type: string; email: string; options?: unknown }>;
  inviteUserByEmailCalls: Array<{ email: string; options?: unknown }>;
  deletedUserIds: string[];
} {
  const lastUpdate = { current: null as Record<string, unknown> | null };
  const generateLinkCalls: Array<{ type: string; email: string; options?: unknown }> = [];
  const inviteUserByEmailCalls: Array<{ email: string; options?: unknown }> = [];
  const deletedUserIds: string[] = [];

  const targetRow: TargetRow | null =
    opts.target === null ? null : { ...DEFAULT_TARGET, ...(opts.target ?? {}) };

  const fromImpl = () => ({
    select() {
      return {
        eq() {
          return {
            single: async () => {
              if (targetRow === null) {
                return { data: null, error: { code: "PGRST116", message: "not found" } };
              }
              return { data: targetRow, error: null };
            },
          };
        },
      };
    },
    update(row: Record<string, unknown>) {
      lastUpdate.current = row;
      return {
        eq() {
          return Promise.resolve({ error: opts.updateError ?? null });
        },
      };
    },
  });

  (createSupabaseServiceRoleClient as unknown as Mocked<() => unknown>).mockReturnValue({
    from: fromImpl,
    auth: {
      admin: {
        // `resendInvite` no longer calls generateLink at all — the mock keeps
        // it only so the `generateLinkCalls).toHaveLength(0)` assertions stay
        // a live regression guard against routing resend back through it.
        generateLink: async (args: { type: string; email: string; options?: unknown }) => {
          generateLinkCalls.push(args);
          return {
            data: { properties: { action_link: "https://example.test/auth/callback?token=abc" } },
            error: null,
          };
        },
        deleteUser: async (uid: string) => {
          deletedUserIds.push(uid);
          return { data: { user: null }, error: null };
        },
        inviteUserByEmail: async (email: string, options?: unknown) => {
          inviteUserByEmailCalls.push({ email, options });
          if (opts.inviteUserByEmailError) throw opts.inviteUserByEmailError;
          // Supabase rejects a re-invite to an already-confirmed address with
          // `email_exists` — resend must delete the stale auth user first.
          if (
            opts.existingUserConfirmed &&
            targetRow?.user_id &&
            !deletedUserIds.includes(targetRow.user_id)
          ) {
            throw Object.assign(
              new Error("A user with this email address has already been registered"),
              { name: "AuthApiError", status: 422, code: "email_exists" }
            );
          }
          return { data: { user: { id: "auth-user-rotated-1" } }, error: null };
        },
      },
    },
  });

  return { lastUpdate, generateLinkCalls, inviteUserByEmailCalls, deletedUserIds };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("resendInvite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireStudioSession as unknown as Mocked<() => Promise<StudioViewer>>).mockResolvedValue(
      OWNER_VIEWER
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Happy path: magic-link ─────────────────────────────────────────────

  it("magic_link path: inviteUserByEmail re-sends the invite, UPDATE invited_at, audit payload.method='magic_link', redirect ?toast=resent", async () => {
    const { lastUpdate, generateLinkCalls, inviteUserByEmailCalls } = mockAdminClient();

    let thrown: unknown;
    try {
      await resendInvite(resendForm());
    } catch (err) {
      thrown = err;
    }

    // 1. inviteUserByEmail re-sends the invite email to the target's address
    //    on the magic-link /auth/invite-callback redirect (no `?method`).
    //    generateLink is NOT used — it only generates a link, never sends one,
    //    which was the original delivery bug.
    expect(inviteUserByEmailCalls).toHaveLength(1);
    expect(inviteUserByEmailCalls[0].email).toBe("hana@tangnails.com");
    expect((inviteUserByEmailCalls[0].options as { redirectTo?: string }).redirectTo).toMatch(
      /\/auth\/invite-callback$/
    );
    expect(generateLinkCalls).toHaveLength(0);

    // 2. UPDATE bumps invited_at; no other lifecycle columns touched.
    expect(lastUpdate.current).not.toBeNull();
    expect(typeof lastUpdate.current?.invited_at).toBe("string");

    // 3. Audit BEFORE redirect (Constitution III).
    expect(recordAudit).toHaveBeenCalledTimes(1);
    const auditCall = (recordAudit as unknown as Mocked<() => unknown>).mock.calls[0];
    expect(auditCall[0]).toBe("user.invite_resent");
    expect(auditCall[1]).toBe(OWNER_VIEWER.deviceUserId);
    expect(auditCall[2]).toBe("staff-target-1");
    expect(auditCall[3]).toMatchObject({
      email: "hana@tangnails.com",
      method: "magic_link",
      by: OWNER_VIEWER.deviceUserId,
    });

    // 4. Redirect → ?toast=resent&name=<display_name>.
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("/settings/onboarding");
    expect(url).toContain("toast=resent");
    expect(url).toContain(`name=${encodeURIComponent("Hana Soto")}`);
  });

  // ── Happy path: password ───────────────────────────────────────────────

  it("password path: inviteUserByEmail rotates the link, UPDATE invited_at, audit payload.method='password'", async () => {
    const { lastUpdate, generateLinkCalls, inviteUserByEmailCalls } = mockAdminClient({
      target: { invite_method: "password" },
    });

    let thrown: unknown;
    try {
      await resendInvite(resendForm());
    } catch (err) {
      thrown = err;
    }

    expect(inviteUserByEmailCalls).toHaveLength(1);
    expect(inviteUserByEmailCalls[0].email).toBe("hana@tangnails.com");
    expect(generateLinkCalls).toHaveLength(0);

    expect(typeof lastUpdate.current?.invited_at).toBe("string");

    expect(recordAudit).toHaveBeenCalledTimes(1);
    const auditCall = (recordAudit as unknown as Mocked<() => unknown>).mock.calls[0];
    expect(auditCall[3]).toMatchObject({
      email: "hana@tangnails.com",
      method: "password",
      by: OWNER_VIEWER.deviceUserId,
    });

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("toast=resent");
  });

  // ── Confirmed invitee: stale auth user must be rotated ─────────────────

  it("re-invites a confirmed invitee: deletes the stale auth user first, then inviteUserByEmail succeeds", async () => {
    // An invitee who clicked their invite link even once has a CONFIRMED
    // auth user, even when the staff row never left `invited` (e.g. the
    // accept callback failed). inviteUserByEmail rejects a confirmed email
    // with `email_exists`; resend must delete the stale auth user first so
    // the re-invite goes through and the staff row repoints at the fresh id.
    const { lastUpdate, deletedUserIds, inviteUserByEmailCalls } = mockAdminClient({
      existingUserConfirmed: true,
    });

    let thrown: unknown;
    try {
      await resendInvite(resendForm());
    } catch (err) {
      thrown = err;
    }

    // 1. the stale auth user is deleted before the re-invite.
    expect(deletedUserIds).toContain("auth-user-target-1");
    // 2. the re-invite goes through (would have thrown email_exists otherwise).
    expect(inviteUserByEmailCalls).toHaveLength(1);
    // 3. the staff row repoints at the rotated auth user + bumps invited_at.
    expect(lastUpdate.current?.user_id).toBe("auth-user-rotated-1");
    expect(typeof lastUpdate.current?.invited_at).toBe("string");
    // 4. audit + success toast.
    expect(recordAudit).toHaveBeenCalledTimes(1);
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("toast=resent");
  });

  // ── Target-shape gates ─────────────────────────────────────────────────

  it("target.state='active' → ?error=not_found (no rotation, no UPDATE, no audit)", async () => {
    const { lastUpdate, generateLinkCalls } = mockAdminClient({ target: { state: "active" } });

    let thrown: unknown;
    try {
      await resendInvite(resendForm());
    } catch (err) {
      thrown = err;
    }

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=not_found");
    expect(generateLinkCalls).toHaveLength(0);
    expect(lastUpdate.current).toBeNull();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("target.state='offboarded' → ?error=not_found", async () => {
    mockAdminClient({ target: { state: "offboarded" } });

    let thrown: unknown;
    try {
      await resendInvite(resendForm());
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=not_found");
  });

  it("target.removed_at non-null → ?error=not_found", async () => {
    mockAdminClient({ target: { removed_at: new Date().toISOString() } });

    let thrown: unknown;
    try {
      await resendInvite(resendForm());
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=not_found");
  });

  it("target missing entirely → ?error=not_found", async () => {
    mockAdminClient({ target: null });

    let thrown: unknown;
    try {
      await resendInvite(resendForm());
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=not_found");
  });

  it("target.email is null → ?error=not_found", async () => {
    mockAdminClient({ target: { email: null } });

    let thrown: unknown;
    try {
      await resendInvite(resendForm());
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=not_found");
  });

  // ── Supabase failure ───────────────────────────────────────────────────

  it("magic-link inviteUserByEmail throws → ?error=invite_failed (no UPDATE, no audit)", async () => {
    const { lastUpdate } = mockAdminClient({
      inviteUserByEmailError: new Error("supabase boom"),
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    let thrown: unknown;
    try {
      await resendInvite(resendForm());
    } catch (err) {
      thrown = err;
    }

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=invite_failed");
    expect(lastUpdate.current).toBeNull();
    expect(recordAudit).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("inviteUserByEmail throws (password path) → ?error=invite_failed", async () => {
    const { lastUpdate } = mockAdminClient({
      target: { invite_method: "password" },
      inviteUserByEmailError: new Error("supabase boom"),
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    let thrown: unknown;
    try {
      await resendInvite(resendForm());
    } catch (err) {
      thrown = err;
    }

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=invite_failed");
    expect(lastUpdate.current).toBeNull();
    expect(recordAudit).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  // ── UPDATE failure ─────────────────────────────────────────────────────

  it("UPDATE failure → ?error=server_error (rotation already happened; audit NOT written)", async () => {
    mockAdminClient({ updateError: { code: "XX000", message: "transient" } });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    let thrown: unknown;
    try {
      await resendInvite(resendForm());
    } catch (err) {
      thrown = err;
    }

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=server_error");
    expect(recordAudit).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  // ── Owner gate ─────────────────────────────────────────────────────────

  it("non-owner viewer → /dashboard?error=forbidden (no work)", async () => {
    (requireStudioSession as unknown as Mocked<() => Promise<StudioViewer>>).mockResolvedValueOnce(
      MANAGER_VIEWER
    );

    let thrown: unknown;
    try {
      await resendInvite(resendForm());
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("/dashboard");
    expect(url).toContain("error=forbidden");
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
