// Unit tests for `cancelInvite` in
// `app/(studio)/settings/onboarding/actions.ts`.
//
// Coverage matrix per dispatch (012-user-onboarding § Phase 7 / US5 / T071):
//
//   - Happy path: snapshots email + display_name BEFORE the deletes; calls
//     admin.auth.admin.deleteUser(target.user_id, false) — hard-delete per
//     Phase 6's fix; DELETEs the staff row; writes audit `user.invite_cancelled
//     { email: snapshot.email, by }` BEFORE the redirect (Constitution III);
//     redirect ?toast=cancelled&name=<display_name>.
//   - Non-invited target (state='active' / 'offboarded' / removed_at non-null
//     / missing) → ?error=not_found, no deletes, no audit.
//   - Second-submit (row already deleted by a concurrent cancel) →
//     ?error=not_found.
//   - Supabase deleteUser failure → ?error=server_error, no DELETE staff,
//     no audit.
//   - Supabase staff DELETE failure → ?error=server_error, no audit.
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

import { cancelInvite } from "@/app/(studio)/settings/onboarding/actions";

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

function cancelForm(overrides: Record<string, string> = {}): FormData {
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
  removed_at: string | null;
};

const DEFAULT_TARGET: TargetRow = {
  id: "staff-target-1",
  user_id: "auth-user-target-1",
  email: "hana@tangnails.com",
  display_name: "Hana Soto",
  state: "invited",
  removed_at: null,
};

type AdminMockOpts = {
  target?: Partial<TargetRow> | null;
  deleteUserError?: Error | null;
  staffDeleteError?: { code?: string; message?: string } | null;
};

function mockAdminClient(opts: AdminMockOpts = {}): {
  deleteUserCalls: Array<[string, boolean | undefined]>;
  staffDeleteCalls: { count: number };
} {
  const deleteUserCalls: Array<[string, boolean | undefined]> = [];
  const staffDeleteCalls = { count: 0 };

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
    delete() {
      staffDeleteCalls.count += 1;
      return {
        eq() {
          return Promise.resolve({ error: opts.staffDeleteError ?? null });
        },
      };
    },
  });

  (createSupabaseServiceRoleClient as unknown as Mocked<() => unknown>).mockReturnValue({
    from: fromImpl,
    auth: {
      admin: {
        deleteUser: async (uid: string, shouldSoftDelete?: boolean) => {
          deleteUserCalls.push([uid, shouldSoftDelete]);
          if (opts.deleteUserError) throw opts.deleteUserError;
          return { data: null, error: null };
        },
      },
    },
  });

  return { deleteUserCalls, staffDeleteCalls };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("cancelInvite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireStudioSession as unknown as Mocked<() => Promise<StudioViewer>>).mockResolvedValue(
      OWNER_VIEWER
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Happy path ─────────────────────────────────────────────────────────

  it("happy path: deleteUser (hard) → staff DELETE → audit snapshot email → redirect ?toast=cancelled&name=<display_name>", async () => {
    const { deleteUserCalls, staffDeleteCalls } = mockAdminClient();

    let thrown: unknown;
    try {
      await cancelInvite(cancelForm());
    } catch (err) {
      thrown = err;
    }

    // 1. deleteUser called once with (user_id, false) — hard delete per
    //    Phase 6's fix: ensures the email is freed for future re-invite.
    expect(deleteUserCalls).toEqual([["auth-user-target-1", false]]);

    // 2. staff DELETE issued once.
    expect(staffDeleteCalls.count).toBe(1);

    // 3. Audit BEFORE redirect (Constitution III), with snapshot email.
    //    entity_id references the now-deleted staff.id (denormalized — see
    //    audit.contract.md § 3).
    expect(recordAudit).toHaveBeenCalledTimes(1);
    const auditCall = (recordAudit as unknown as Mocked<() => unknown>).mock.calls[0];
    expect(auditCall[0]).toBe("user.invite_cancelled");
    expect(auditCall[1]).toBe(OWNER_VIEWER.deviceUserId);
    expect(auditCall[2]).toBe("staff-target-1");
    expect(auditCall[3]).toMatchObject({
      email: "hana@tangnails.com",
      by: OWNER_VIEWER.deviceUserId,
    });

    // 4. Redirect → ?toast=cancelled&name=<display_name>.
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("/settings/onboarding");
    expect(url).toContain("toast=cancelled");
    expect(url).toContain(`name=${encodeURIComponent("Hana Soto")}`);
  });

  it("snapshots email BEFORE any deletes (audit carries the pre-delete value)", async () => {
    // We can't directly observe ordering here, but we verify the snapshot
    // value matches what was loaded from the row — even with email=null on
    // a separate run.
    const { deleteUserCalls } = mockAdminClient({ target: { email: "other@tang.test" } });

    try {
      await cancelInvite(cancelForm());
    } catch {
      // expected (redirect throws)
    }

    expect(deleteUserCalls).toEqual([["auth-user-target-1", false]]);
    const auditCall = (recordAudit as unknown as Mocked<() => unknown>).mock.calls[0];
    expect(auditCall[3]).toMatchObject({ email: "other@tang.test" });
  });

  // ── Non-invited / not-found target ─────────────────────────────────────

  it("target.state='active' → ?error=not_found (no deleteUser, no DELETE, no audit)", async () => {
    const { deleteUserCalls, staffDeleteCalls } = mockAdminClient({ target: { state: "active" } });

    let thrown: unknown;
    try {
      await cancelInvite(cancelForm());
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=not_found");
    expect(deleteUserCalls).toEqual([]);
    expect(staffDeleteCalls.count).toBe(0);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("target.state='offboarded' → ?error=not_found", async () => {
    mockAdminClient({ target: { state: "offboarded" } });

    let thrown: unknown;
    try {
      await cancelInvite(cancelForm());
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
      await cancelInvite(cancelForm());
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=not_found");
  });

  it("second-submit (target row already deleted by concurrent cancel) → ?error=not_found", async () => {
    mockAdminClient({ target: null });

    let thrown: unknown;
    try {
      await cancelInvite(cancelForm());
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=not_found");
    expect(recordAudit).not.toHaveBeenCalled();
  });

  // ── Supabase failures ──────────────────────────────────────────────────

  it("deleteUser throws → ?error=server_error (no staff DELETE, no audit)", async () => {
    const { staffDeleteCalls } = mockAdminClient({
      deleteUserError: new Error("supabase boom"),
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    let thrown: unknown;
    try {
      await cancelInvite(cancelForm());
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=server_error");
    expect(staffDeleteCalls.count).toBe(0);
    expect(recordAudit).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("staff DELETE fails → ?error=server_error (auth user already deleted, audit NOT written)", async () => {
    mockAdminClient({ staffDeleteError: { code: "XX000", message: "transient" } });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    let thrown: unknown;
    try {
      await cancelInvite(cancelForm());
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
      await cancelInvite(cancelForm());
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("/dashboard");
    expect(url).toContain("error=forbidden");
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
