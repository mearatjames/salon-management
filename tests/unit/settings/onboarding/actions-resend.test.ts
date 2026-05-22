// Unit tests for `resendInvite` in
// `app/(studio)/settings/onboarding/actions.ts`.
//
// Mirrors `actions-offboard.test.ts` for the mocking pattern (redirect-as-
// throw, per-module mocks).
//
// Implementation model: resend re-sends a fresh sign-in link to the
// invitee's EXISTING auth user via `sendImplicitFlowResetEmail` (a
// resetPasswordForEmail call on an implicit-flow client). It does NOT
// delete + re-create the auth user:
//   - inviteUserByEmail rejects an already-confirmed address with
//     `email_exists`, and an invitee is confirmed the moment they open any
//     invite link; and
//   - deleting the auth user is impossible — an invited magic-link staff
//     row has pin_hash = NULL, so the FK ON DELETE SET NULL cascade would
//     null staff.user_id and violate the staff_pin_or_user CHECK
//     ("Database error deleting user").
// resetPasswordForEmail reaches any existing user without touching the
// auth row, so the staff row's user_id is never rotated — resend only
// bumps `invited_at`.
//
// Coverage matrix:
//   - Magic-link path → sendImplicitFlowResetEmail(email, '<origin>/auth/invite-
//     callback') → UPDATE invited_at → audit `user.invite_resent
//     { email, method: 'magic_link', by }` → redirect ?toast=resent.
//   - Password path → sendImplicitFlowResetEmail(email, '<origin>/auth/invite-
//     callback?method=password') → audit payload.method='password'.
//   - Non-invited target (state='active' / 'offboarded' / removed_at
//     non-null / missing / email null) → ?error=not_found, no re-send.
//   - sendImplicitFlowResetEmail throws → ?error=invite_failed. No UPDATE, no
//     audit.
//   - UPDATE failure → ?error=server_error. No audit.
//   - Non-owner viewer → /dashboard?error=forbidden.

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
  headers: vi.fn(async () => ({ get: () => null })),
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

// resend reaches Supabase only through these two helpers; the rest are
// stubbed so `actions.ts`'s other server actions still import cleanly.
vi.mock("@/lib/onboarding/invite", () => ({
  inviteOrigin: vi.fn(async () => "http://localhost:3000"),
  sendImplicitFlowResetEmail: vi.fn(async () => undefined),
  deleteInviteUser: vi.fn(),
  generateMagicLinkInvite: vi.fn(),
  sendPasswordInvite: vi.fn(),
}));

// ── Imports of the SUT and the mocked modules ──────────────────────────────

import { recordAudit } from "@/lib/auth/audit";
import { requireStudioSession, type StudioViewer } from "@/lib/auth/session";
import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import { sendImplicitFlowResetEmail } from "@/lib/onboarding/invite";

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
  email: string | null;
  display_name: string;
  state: "active" | "invited" | "offboarded";
  invite_method: "magic_link" | "password" | null;
  removed_at: string | null;
};

const DEFAULT_TARGET: TargetRow = {
  id: "staff-target-1",
  email: "hana@tangnails.com",
  display_name: "Hana Soto",
  state: "invited",
  invite_method: "magic_link",
  removed_at: null,
};

type AdminMockOpts = {
  target?: Partial<TargetRow> | null;
  updateError?: { code?: string; message?: string } | null;
};

function mockAdminClient(opts: AdminMockOpts = {}): {
  lastUpdate: { current: Record<string, unknown> | null };
} {
  const lastUpdate = { current: null as Record<string, unknown> | null };
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
  });

  return { lastUpdate };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("resendInvite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireStudioSession as unknown as Mocked<() => Promise<StudioViewer>>).mockResolvedValue(
      OWNER_VIEWER
    );
    (sendImplicitFlowResetEmail as unknown as Mocked<() => Promise<void>>).mockResolvedValue(
      undefined
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Happy path: magic-link ─────────────────────────────────────────────

  it("magic_link path: re-sends the sign-in link, UPDATE invited_at, audit method='magic_link', redirect ?toast=resent", async () => {
    const { lastUpdate } = mockAdminClient();

    let thrown: unknown;
    try {
      await resendInvite(resendForm());
    } catch (err) {
      thrown = err;
    }

    // 1. the existing invitee gets a fresh link on the magic-link
    //    /auth/invite-callback redirect (no `?method`).
    expect(sendImplicitFlowResetEmail).toHaveBeenCalledTimes(1);
    expect(sendImplicitFlowResetEmail).toHaveBeenCalledWith(
      "hana@tangnails.com",
      "http://localhost:3000/auth/invite-callback"
    );

    // 2. UPDATE bumps invited_at only — the auth user is untouched, so
    //    user_id is NOT rotated.
    expect(lastUpdate.current).not.toBeNull();
    expect(typeof lastUpdate.current?.invited_at).toBe("string");
    expect(lastUpdate.current).not.toHaveProperty("user_id");

    // 3. audit BEFORE redirect (Constitution III).
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

    // 4. redirect → ?toast=resent&name=<display_name>.
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("/settings/onboarding");
    expect(url).toContain("toast=resent");
    expect(url).toContain(`name=${encodeURIComponent("Hana Soto")}`);
  });

  // ── Happy path: password ───────────────────────────────────────────────

  it("password path: re-sends on the ?method=password redirect, audit method='password'", async () => {
    mockAdminClient({ target: { invite_method: "password" } });

    let thrown: unknown;
    try {
      await resendInvite(resendForm());
    } catch (err) {
      thrown = err;
    }

    expect(sendImplicitFlowResetEmail).toHaveBeenCalledWith(
      "hana@tangnails.com",
      "http://localhost:3000/auth/invite-callback?method=password"
    );

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

  // ── Target-shape gates ─────────────────────────────────────────────────

  it("target.state='active' → ?error=not_found (no re-send, no UPDATE, no audit)", async () => {
    const { lastUpdate } = mockAdminClient({ target: { state: "active" } });

    let thrown: unknown;
    try {
      await resendInvite(resendForm());
    } catch (err) {
      thrown = err;
    }

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=not_found");
    expect(sendImplicitFlowResetEmail).not.toHaveBeenCalled();
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
    expect(redirectUrlFrom(thrown)).toContain("error=not_found");
  });

  it("target.removed_at non-null → ?error=not_found", async () => {
    mockAdminClient({ target: { removed_at: new Date().toISOString() } });

    let thrown: unknown;
    try {
      await resendInvite(resendForm());
    } catch (err) {
      thrown = err;
    }
    expect(redirectUrlFrom(thrown)).toContain("error=not_found");
  });

  it("target missing entirely → ?error=not_found", async () => {
    mockAdminClient({ target: null });

    let thrown: unknown;
    try {
      await resendInvite(resendForm());
    } catch (err) {
      thrown = err;
    }
    expect(redirectUrlFrom(thrown)).toContain("error=not_found");
  });

  it("target.email is null → ?error=not_found", async () => {
    mockAdminClient({ target: { email: null } });

    let thrown: unknown;
    try {
      await resendInvite(resendForm());
    } catch (err) {
      thrown = err;
    }
    expect(redirectUrlFrom(thrown)).toContain("error=not_found");
  });

  // ── Supabase failure ───────────────────────────────────────────────────

  it("sendImplicitFlowResetEmail throws → ?error=invite_failed (no UPDATE, no audit)", async () => {
    const { lastUpdate } = mockAdminClient();
    (sendImplicitFlowResetEmail as unknown as Mocked<() => Promise<void>>).mockRejectedValueOnce(
      new Error("supabase boom")
    );
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

  it("UPDATE failure → ?error=server_error (re-send already happened; audit NOT written)", async () => {
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
    expect(sendImplicitFlowResetEmail).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
