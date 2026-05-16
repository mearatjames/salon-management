// Unit tests for `offboardUser` in
// `app/(studio)/settings/onboarding/actions.ts`.
//
// Mirrors `actions-invite-quick.test.ts` for the mocking pattern
// (redirect-as-throw, per-module mocks). Coverage matrix per dispatch:
//   - Happy path: UPDATE state='offboarded'/active=false/pin_hash=null/
//                 offboarded_*/pin_reset_admin_at=null, signOut(target_user_id,
//                 'global') called, audit user.offboarded { reason, by } row
//                 written BEFORE redirect (Constitution III), redirect
//                 ?toast=offboarded&name=…
//   - Self-offboard: target.user_id === viewer.deviceUserId → no UPDATE,
//     no signOut, no audit, redirect ?error=cannot_offboard_self.
//   - Last-owner trigger error (PG 23514 or P0001) → ?error=last_owner.
//   - Non-active target → ?error=not_found.
//   - Validation: invalid reason → ?error=invalid_reason. Empty reason
//     (optional) → reason=null OK.
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

import { offboardUser } from "@/app/(studio)/settings/onboarding/actions";

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

function offboardForm(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const merged: Record<string, string> = {
    staff_id: "staff-target-1",
    reason: "Performance",
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
  display_name: string;
  role: string;
  state: "active" | "invited" | "offboarded";
  removed_at: string | null;
};

const DEFAULT_TARGET: TargetRow = {
  id: "staff-target-1",
  user_id: "auth-user-target-1",
  display_name: "Hana Soto",
  role: "technician",
  state: "active",
  removed_at: null,
};

type AdminMockOpts = {
  target?: Partial<TargetRow> | null; // null → not found
  updateError?: { code?: string; message?: string } | null;
  signOutError?: Error | null;
};

function mockAdminClient(opts: AdminMockOpts = {}): {
  lastUpdate: { current: Record<string, unknown> | null };
  signOutCalls: Array<[string, string]>;
} {
  const lastUpdate = { current: null as Record<string, unknown> | null };
  const signOutCalls: Array<[string, string]> = [];

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
        signOut: async (uid: string, scope: string) => {
          signOutCalls.push([uid, scope]);
          if (opts.signOutError) throw opts.signOutError;
          return { data: null, error: null };
        },
      },
    },
  });

  return { lastUpdate, signOutCalls };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("offboardUser", () => {
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

  it("happy path: signs out target, UPDATEs lifecycle columns, audits, redirects with ?toast=offboarded", async () => {
    const { lastUpdate, signOutCalls } = mockAdminClient();

    let thrown: unknown;
    try {
      await offboardUser(offboardForm({ reason: "Performance" }));
    } catch (err) {
      thrown = err;
    }

    // 1. signOut(target_user_id, 'global') called once.
    expect(signOutCalls).toEqual([["auth-user-target-1", "global"]]);

    // 2. UPDATE shape covers every lifecycle column.
    expect(lastUpdate.current).toMatchObject({
      state: "offboarded",
      active: false,
      pin_hash: null,
      offboarded_by: OWNER_VIEWER.staff.id,
      offboard_reason: "Performance",
      pin_reset_admin_at: null,
    });
    expect(typeof lastUpdate.current?.offboarded_at).toBe("string");

    // 3. Audit before redirect.
    expect(recordAudit).toHaveBeenCalledTimes(1);
    const auditCall = (recordAudit as unknown as Mocked<() => unknown>).mock.calls[0];
    expect(auditCall[0]).toBe("user.offboarded");
    expect(auditCall[1]).toBe(OWNER_VIEWER.deviceUserId);
    expect(auditCall[2]).toBe("staff-target-1");
    expect(auditCall[3]).toMatchObject({
      reason: "Performance",
      by: OWNER_VIEWER.deviceUserId,
    });

    // 4. Redirect → ?toast=offboarded&name=…
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("/settings/onboarding");
    expect(url).toContain("toast=offboarded");
    expect(url).toContain(`name=${encodeURIComponent("Hana Soto")}`);
  });

  it("optional reason: empty FormData reason → reason=null in UPDATE + audit", async () => {
    const { lastUpdate } = mockAdminClient();

    let thrown: unknown;
    try {
      await offboardUser(offboardForm({ reason: "" }));
    } catch (err) {
      thrown = err;
    }

    expect(lastUpdate.current).toMatchObject({ offboard_reason: null });
    const auditCall = (recordAudit as unknown as Mocked<() => unknown>).mock.calls[0];
    expect(auditCall[3]).toMatchObject({ reason: null });

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("toast=offboarded");
  });

  // ── Self-offboard guard ────────────────────────────────────────────────

  it("self-offboard: target.user_id === viewer.deviceUserId → ?error=cannot_offboard_self, no UPDATE, no signOut, no audit", async () => {
    const { lastUpdate, signOutCalls } = mockAdminClient({
      target: { user_id: OWNER_VIEWER.deviceUserId },
    });

    let thrown: unknown;
    try {
      await offboardUser(offboardForm());
    } catch (err) {
      thrown = err;
    }

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=cannot_offboard_self");

    expect(lastUpdate.current).toBeNull();
    expect(signOutCalls).toEqual([]);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  // ── Last-owner trigger ─────────────────────────────────────────────────

  for (const code of ["23514", "P0001"] as const) {
    it(`last-owner trigger ${code} on UPDATE → ?error=last_owner`, async () => {
      mockAdminClient({
        updateError: { code, message: "owner_required" },
      });
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

      let thrown: unknown;
      try {
        await offboardUser(offboardForm());
      } catch (err) {
        thrown = err;
      }

      const url = redirectUrlFrom(thrown);
      expect(url).toContain("error=last_owner");
      expect(recordAudit).not.toHaveBeenCalled();
      errSpy.mockRestore();
    });
  }

  // ── Non-active target ──────────────────────────────────────────────────

  it("target.state !== 'active' → ?error=not_found", async () => {
    mockAdminClient({ target: { state: "invited" } });

    let thrown: unknown;
    try {
      await offboardUser(offboardForm());
    } catch (err) {
      thrown = err;
    }

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=not_found");
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("target.removed_at non-null → ?error=not_found", async () => {
    mockAdminClient({ target: { removed_at: new Date().toISOString() } });

    let thrown: unknown;
    try {
      await offboardUser(offboardForm());
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
      await offboardUser(offboardForm());
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=not_found");
  });

  // ── Validation: invalid reason ─────────────────────────────────────────

  it("invalid reason (not one of the 5) → ?error=invalid_reason", async () => {
    mockAdminClient();

    let thrown: unknown;
    try {
      await offboardUser(offboardForm({ reason: "Sweetly fired" }));
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=invalid_reason");
    expect(recordAudit).not.toHaveBeenCalled();
  });

  // ── Owner gate ─────────────────────────────────────────────────────────

  it("non-owner viewer → /dashboard?error=forbidden (no work)", async () => {
    (requireStudioSession as unknown as Mocked<() => Promise<StudioViewer>>).mockResolvedValueOnce(
      MANAGER_VIEWER
    );

    let thrown: unknown;
    try {
      await offboardUser(offboardForm());
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("/dashboard");
    expect(url).toContain("error=forbidden");
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
