// Unit tests for `sendUserPasswordReset` in
// `app/(studio)/settings/onboarding/actions.ts`.
//
// Per server-actions.contract.md § 8:
//   - Uses the SSR (cookie-aware) Supabase client, NOT service-role.
//     `resetPasswordForEmail` is a regular-client method.
//   - Loads target via the service-role client (admin path can read
//     non-public columns); must be state='active' AND email IS NOT NULL.
//   - Audit: device.password_reset { method: 'recovery', actor: 'admin', by }.
//     entity_id = null, entity_type = "auth".
//   - AuthRetryableFetchError → ?error=network.

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
  headers: vi.fn(async () => ({
    get: (name: string) => (name === "x-forwarded-host" ? "tang.local" : null),
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

vi.mock("@/lib/db/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { recordAudit } from "@/lib/auth/audit";
import { requireStudioSession, type StudioViewer } from "@/lib/auth/session";
import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import { createSupabaseServerClient } from "@/lib/db/server";

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

type ServerMockOpts = {
  target?: Partial<TargetRow> | null;
  resetError?: Error | null;
};

class FakeAuthRetryableFetchError extends Error {
  name = "AuthRetryableFetchError";
}

function mockClients(opts: ServerMockOpts = {}): {
  resetCalls: Array<{ email: string; options: { redirectTo?: string } }>;
} {
  const resetCalls: Array<{ email: string; options: { redirectTo?: string } }> = [];

  const targetRow: TargetRow | null =
    opts.target === null ? null : { ...DEFAULT_TARGET, ...(opts.target ?? {}) };

  // Admin: load target only.
  (createSupabaseServiceRoleClient as unknown as Mocked<() => unknown>).mockReturnValue({
    from: () => ({
      select() {
        return {
          eq() {
            return {
              single: async () => {
                if (targetRow === null) {
                  return { data: null, error: { code: "PGRST116" } };
                }
                return { data: targetRow, error: null };
              },
            };
          },
        };
      },
    }),
  });

  // Cookie-aware client: holds resetPasswordForEmail.
  (createSupabaseServerClient as unknown as Mocked<() => Promise<unknown>>).mockResolvedValue({
    auth: {
      resetPasswordForEmail: async (
        email: string,
        options: { redirectTo?: string }
      ): Promise<{ data: unknown; error: unknown }> => {
        resetCalls.push({ email, options });
        if (opts.resetError) throw opts.resetError;
        return { data: {}, error: null };
      },
    },
  });

  return { resetCalls };
}

describe("sendUserPasswordReset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireStudioSession as unknown as Mocked<() => Promise<StudioViewer>>).mockResolvedValue(
      OWNER_VIEWER
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("happy path: calls resetPasswordForEmail(target.email, { redirectTo: <origin>/auth/callback }), audits, redirects", async () => {
    const { resetCalls } = mockClients();

    let thrown: unknown;
    try {
      await sendUserPasswordReset(sendForm());
    } catch (err) {
      thrown = err;
    }

    expect(resetCalls).toHaveLength(1);
    expect(resetCalls[0].email).toBe("hana@tangnails.test");
    expect(resetCalls[0].options.redirectTo).toMatch(/\/auth\/callback$/);

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
    const { resetCalls } = mockClients({ target: { state: "offboarded" } });

    let thrown: unknown;
    try {
      await sendUserPasswordReset(sendForm());
    } catch (err) {
      thrown = err;
    }

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=not_found");
    expect(resetCalls).toEqual([]);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("target active but email null → ?error=not_found", async () => {
    const { resetCalls } = mockClients({ target: { email: null } });

    let thrown: unknown;
    try {
      await sendUserPasswordReset(sendForm());
    } catch (err) {
      thrown = err;
    }

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=not_found");
    expect(resetCalls).toEqual([]);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("AuthRetryableFetchError → ?error=network", async () => {
    mockClients({ resetError: new FakeAuthRetryableFetchError("network down") });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    let thrown: unknown;
    try {
      await sendUserPasswordReset(sendForm());
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=network");
    expect(recordAudit).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
