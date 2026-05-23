// Unit tests for `sendUserPasswordReset` in
// `app/(studio)/settings/onboarding/actions.ts`.
//
// Per server-actions.contract.md § 8:
//   - Loads target via the service-role client; must be state='active' AND
//     email IS NOT NULL.
//   - Sends the recovery email via `sendImplicitFlowResetEmail` — an
//     implicit-flow `resetPasswordForEmail` — with `redirectTo` pointed at
//     the `/auth/recovery-callback` client page. This is an admin-initiated,
//     cross-user reset: the target opens the link in a *different* browser,
//     so a PKCE link (whose code verifier lives in the owner's browser) is
//     unusable. Routing through the implicit flow is the issue #126 fix.
//   - Audit: device.password_reset { method: 'recovery', actor: 'admin', by },
//     entity_id = null.
//   - AuthRetryableFetchError → ?error=network; any other failure →
//     ?error=server_error.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

// `sendUserPasswordReset` reaches Supabase only through these two helpers;
// the rest are stubbed so `actions.ts`'s other server actions still import
// cleanly.
vi.mock("@/lib/onboarding/invite", () => ({
  inviteOrigin: vi.fn(async () => "http://tang.local"),
  sendImplicitFlowResetEmail: vi.fn(async () => undefined),
  deleteInviteUser: vi.fn(),
  generateMagicLinkInvite: vi.fn(),
  sendPasswordInvite: vi.fn(),
}));

import { recordAudit } from "@/lib/auth/audit";
import { requireStudioSession, type StudioViewer } from "@/lib/auth/session";
import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import { inviteOrigin, sendImplicitFlowResetEmail } from "@/lib/onboarding/invite";

import { sendUserPasswordReset } from "@/app/(studio)/settings/onboarding/actions";

type Mocked<T> = T & ReturnType<typeof vi.fn>;

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

function sendForm(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const merged: Record<string, string> = { staff_id: "staff-target-1", ...overrides };
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
  display_name: string;
  email: string | null;
  state: "active" | "invited" | "offboarded";
  removed_at: string | null;
};

const DEFAULT_TARGET: TargetRow = {
  id: "staff-target-1",
  user_id: "auth-user-target-1",
  display_name: "Hana Soto",
  email: "hana@tangnails.test",
  state: "active",
  removed_at: null,
};

/** Admin client mock — `sendUserPasswordReset` only loads the target row. */
function mockAdminClient(target: Partial<TargetRow> | null = {}): void {
  const targetRow: TargetRow | null = target === null ? null : { ...DEFAULT_TARGET, ...target };
  (createSupabaseServiceRoleClient as unknown as Mocked<() => unknown>).mockReturnValue({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () =>
            targetRow === null
              ? { data: null, error: { code: "PGRST116" } }
              : { data: targetRow, error: null },
        }),
      }),
    }),
  });
}

class FakeAuthRetryableFetchError extends Error {
  name = "AuthRetryableFetchError";
}

describe("sendUserPasswordReset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireStudioSession as unknown as Mocked<() => Promise<StudioViewer>>).mockResolvedValue(
      OWNER_VIEWER
    );
    (inviteOrigin as unknown as Mocked<() => Promise<string>>).mockResolvedValue(
      "http://tang.local"
    );
    (sendImplicitFlowResetEmail as unknown as Mocked<() => Promise<void>>).mockResolvedValue(
      undefined
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("happy path: sends an implicit-flow recovery link to /auth/recovery-callback, audits, redirects", async () => {
    mockAdminClient();

    let thrown: unknown;
    try {
      await sendUserPasswordReset(sendForm());
    } catch (err) {
      thrown = err;
    }

    // Core of the issue #126 fix: the recovery email goes through the
    // implicit-flow helper (NOT the PKCE SSR client) and lands on the
    // `/auth/recovery-callback` client page — never the server `/auth/callback`
    // route, which can't read the implicit-flow token hash.
    expect(sendImplicitFlowResetEmail).toHaveBeenCalledTimes(1);
    expect(sendImplicitFlowResetEmail).toHaveBeenCalledWith(
      "hana@tangnails.test",
      "http://tang.local/auth/recovery-callback"
    );

    // Audit: device.password_reset { method, actor, by }, entity_id=null.
    expect(recordAudit).toHaveBeenCalledTimes(1);
    const auditCall = (recordAudit as unknown as Mocked<() => unknown>).mock.calls[0];
    expect(auditCall[0]).toBe("device.password_reset");
    expect(auditCall[1]).toBe(OWNER_VIEWER.deviceUserId);
    expect(auditCall[2]).toBeNull(); // entity_id
    expect(auditCall[3]).toMatchObject({
      method: "recovery",
      actor: "admin",
      by: OWNER_VIEWER.deviceUserId,
    });

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("toast=password_reset_sent");
    expect(url).toContain(`name=${encodeURIComponent("Hana Soto")}`);
  });

  it("target not active → ?error=not_found, no reset email, no audit", async () => {
    mockAdminClient({ state: "offboarded" });

    let thrown: unknown;
    try {
      await sendUserPasswordReset(sendForm());
    } catch (err) {
      thrown = err;
    }

    expect(redirectUrlFrom(thrown)).toContain("error=not_found");
    expect(sendImplicitFlowResetEmail).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("target active but email null → ?error=not_found", async () => {
    mockAdminClient({ email: null });

    let thrown: unknown;
    try {
      await sendUserPasswordReset(sendForm());
    } catch (err) {
      thrown = err;
    }

    expect(redirectUrlFrom(thrown)).toContain("error=not_found");
    expect(sendImplicitFlowResetEmail).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("missing staff_id → ?error=not_found", async () => {
    mockAdminClient();

    let thrown: unknown;
    try {
      await sendUserPasswordReset(sendForm({ staff_id: "" }));
    } catch (err) {
      thrown = err;
    }

    expect(redirectUrlFrom(thrown)).toContain("error=not_found");
    expect(sendImplicitFlowResetEmail).not.toHaveBeenCalled();
  });

  it("AuthRetryableFetchError → ?error=network, no audit", async () => {
    mockAdminClient();
    (sendImplicitFlowResetEmail as unknown as Mocked<() => Promise<void>>).mockRejectedValueOnce(
      new FakeAuthRetryableFetchError("network down")
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    let thrown: unknown;
    try {
      await sendUserPasswordReset(sendForm());
    } catch (err) {
      thrown = err;
    }

    expect(redirectUrlFrom(thrown)).toContain("error=network");
    expect(recordAudit).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("any other send failure → ?error=server_error, no audit", async () => {
    mockAdminClient();
    (sendImplicitFlowResetEmail as unknown as Mocked<() => Promise<void>>).mockRejectedValueOnce(
      new Error("unexpected boom")
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    let thrown: unknown;
    try {
      await sendUserPasswordReset(sendForm());
    } catch (err) {
      thrown = err;
    }

    expect(redirectUrlFrom(thrown)).toContain("error=server_error");
    expect(recordAudit).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("non-owner viewer → /dashboard?error=forbidden", async () => {
    mockAdminClient();
    (requireStudioSession as unknown as Mocked<() => Promise<StudioViewer>>).mockResolvedValueOnce(
      MANAGER_VIEWER
    );

    let thrown: unknown;
    try {
      await sendUserPasswordReset(sendForm());
    } catch (err) {
      thrown = err;
    }

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("/dashboard");
    expect(url).toContain("error=forbidden");
    expect(sendImplicitFlowResetEmail).not.toHaveBeenCalled();
  });
});
