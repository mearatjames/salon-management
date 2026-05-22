// Unit tests for `resendInvite` in
// `app/(studio)/settings/onboarding/actions.ts`.
//
// Mirrors `actions-offboard.test.ts` for the mocking pattern (redirect-as-
// throw, per-module mocks). Coverage matrix per dispatch (012-user-onboarding
// § Phase 7 / US5 / T070):
//
//   - Magic-link path: target state='invited', invite_method='magic_link' →
//     calls admin.auth.admin.inviteUserByEmail(email, { redirectTo:
//     '<origin>/auth/callback' }) → Supabase sends a fresh invite email and
//     invalidates the prior token → UPDATE staff `invited_at = now()` → audit
//     `user.invite_resent { email, method: 'magic_link', by }` → redirect
//     ?toast=resent&name=<display_name>.
//   - Password path: target invite_method='password' → calls admin.auth.admin.
//     inviteUserByEmail(email, { redirectTo: '<origin>/auth/callback?type=
//     invite' }) → UPDATE invited_at → audit payload.method='password' →
//     redirect ?toast=resent&name=…
//   - Non-invited target (state='active' / 'offboarded' / removed_at non-null
//     / missing) → ?error=not_found.
//   - Supabase failure (inviteUserByEmail throws) → ?error=invite_failed. NO
//     audit row written.
//   - UPDATE failure → ?error=server_error. NO audit row written.
//   - Non-owner viewer → /dashboard?error=forbidden.
//
// Implementation model choice: resend uses admin.inviteUserByEmail DIRECTLY —
// NOT generateMagicLinkInvite — because the auth user already exists, so the
// duplicate-sentinel roundtrip generateMagicLinkInvite would pay for is dead
// weight here. Both invite methods resolve to inviteUserByEmail: it is the
// only admin primitive that actually SENDS the invite email — `generateLink`
// merely generates a link, and routing resend through it was the original
// delivery bug. inviteUserByEmail re-sends to the still-unconfirmed
// (state='invited') user and rotates the prior token as a side-effect.

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
};

function mockAdminClient(opts: AdminMockOpts = {}): {
  lastUpdate: { current: Record<string, unknown> | null };
  generateLinkCalls: Array<{ type: string; email: string; options?: unknown }>;
  inviteUserByEmailCalls: Array<{ email: string; options?: unknown }>;
} {
  const lastUpdate = { current: null as Record<string, unknown> | null };
  const generateLinkCalls: Array<{ type: string; email: string; options?: unknown }> = [];
  const inviteUserByEmailCalls: Array<{ email: string; options?: unknown }> = [];

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
        inviteUserByEmail: async (email: string, options?: unknown) => {
          inviteUserByEmailCalls.push({ email, options });
          if (opts.inviteUserByEmailError) throw opts.inviteUserByEmailError;
          return { data: { user: { id: "auth-user-target-1" } }, error: null };
        },
      },
    },
  });

  return { lastUpdate, generateLinkCalls, inviteUserByEmailCalls };
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
