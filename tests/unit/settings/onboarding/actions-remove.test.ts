// Unit tests for `removeUser` in
// `app/(studio)/settings/onboarding/actions.ts`.
//
// Mirrors `actions-offboard.test.ts` for the mocking pattern
// (redirect-as-throw, per-module mocks). Coverage matrix per dispatch
// (012-user-onboarding § Phase 6 / US4):
//   - Three-gate validation order (first-fail wins):
//       missing ack_history                  → ?error=ack_required
//       both acks present, typed name wrong  → ?error=confirm_name_mismatch
//       typed name correct, ack_irreversible missing → ?error=ack_required
//   - Case-insensitive trim on the typed-name comparison.
//   - All gates pass:
//       admin.auth.admin.deleteUser(target.user_id) called
//       getNextAnonPlaceholder() called → "Former staff #1"
//       UPDATE staff with display_name='Former staff #1', email=null,
//         color_token='--avatar-slate', pin_hash=null, removed_at=<iso>
//       audit user.removed { display_name_at_removal, email_at_removal,
//         role_at_removal, by } written BEFORE redirect (Constitution III)
//       redirect → ?toast=removed&name=<encoded original display_name>
//   - Target not state='offboarded' (active / invited) → ?error=not_found.
//   - Target removed_at non-null → ?error=not_found.
//   - Target missing → ?error=not_found.
//   - Last-owner trigger (PG 23514 / P0001) on the UPDATE → ?error=last_owner.
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

vi.mock("@/lib/onboarding/anon-counter", () => ({
  getNextAnonPlaceholder: vi.fn(async () => "Former staff #1"),
}));

vi.mock("@/lib/db/admin", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

// ── Imports of the SUT and the mocked modules ──────────────────────────────

import { recordAudit } from "@/lib/auth/audit";
import { requireStudioSession, type StudioViewer } from "@/lib/auth/session";
import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import { getNextAnonPlaceholder } from "@/lib/onboarding/anon-counter";

import { removeUser } from "@/app/(studio)/settings/onboarding/actions";

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

function removeForm(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const merged: Record<string, string> = {
    staff_id: "staff-target-1",
    ack_history: "on",
    ack_irreversible: "on",
    confirm_name: "Hana Soto",
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
  email: string | null;
  role: string;
  state: "active" | "invited" | "offboarded";
  removed_at: string | null;
};

const DEFAULT_TARGET: TargetRow = {
  id: "staff-target-1",
  user_id: "auth-user-target-1",
  display_name: "Hana Soto",
  email: "hana@tangnails.com",
  role: "technician",
  state: "offboarded",
  removed_at: null,
};

type AdminMockOpts = {
  target?: Partial<TargetRow> | null; // null → not found
  updateError?: { code?: string; message?: string } | null;
  deleteUserError?: Error | null;
};

function mockAdminClient(opts: AdminMockOpts = {}): {
  lastUpdate: { current: Record<string, unknown> | null };
  deleteUserCalls: Array<string>;
} {
  const lastUpdate = { current: null as Record<string, unknown> | null };
  const deleteUserCalls: Array<string> = [];

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
        deleteUser: async (uid: string) => {
          deleteUserCalls.push(uid);
          if (opts.deleteUserError) throw opts.deleteUserError;
          return { data: null, error: null };
        },
      },
    },
  });

  return { lastUpdate, deleteUserCalls };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("removeUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireStudioSession as unknown as Mocked<() => Promise<StudioViewer>>).mockResolvedValue(
      OWNER_VIEWER
    );
    (getNextAnonPlaceholder as unknown as Mocked<() => Promise<string>>).mockResolvedValue(
      "Former staff #1"
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Happy path ─────────────────────────────────────────────────────────

  it("happy path: deleteUser → getNextAnonPlaceholder → UPDATE anonymized → audit → redirect ?toast=removed&name=<original>", async () => {
    const { lastUpdate, deleteUserCalls } = mockAdminClient();

    let thrown: unknown;
    try {
      await removeUser(removeForm());
    } catch (err) {
      thrown = err;
    }

    // 1. deleteUser called once with the target's auth user id.
    expect(deleteUserCalls).toEqual(["auth-user-target-1"]);

    // 2. getNextAnonPlaceholder called once after deleteUser.
    expect(getNextAnonPlaceholder).toHaveBeenCalledTimes(1);

    // 3. UPDATE rewrites the row to the anonymized shape.
    expect(lastUpdate.current).toMatchObject({
      display_name: "Former staff #1",
      email: null,
      color_token: "--avatar-slate",
      pin_hash: null,
    });
    expect(typeof lastUpdate.current?.removed_at).toBe("string");

    // 4. Audit row written BEFORE redirect (Constitution III).
    expect(recordAudit).toHaveBeenCalledTimes(1);
    const auditCall = (recordAudit as unknown as Mocked<() => unknown>).mock.calls[0];
    expect(auditCall[0]).toBe("user.removed");
    expect(auditCall[1]).toBe(OWNER_VIEWER.deviceUserId);
    expect(auditCall[2]).toBe("staff-target-1");
    expect(auditCall[3]).toMatchObject({
      display_name_at_removal: "Hana Soto",
      email_at_removal: "hana@tangnails.com",
      role_at_removal: "technician",
      by: OWNER_VIEWER.deviceUserId,
    });

    // 5. Redirect → ?toast=removed&name=<original display_name>.
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("/settings/onboarding");
    expect(url).toContain("toast=removed");
    expect(url).toContain(`name=${encodeURIComponent("Hana Soto")}`);
  });

  it("case-insensitive trim on typed-name comparison: 'hana SOTO  ' matches 'Hana Soto'", async () => {
    const { deleteUserCalls } = mockAdminClient();

    let thrown: unknown;
    try {
      await removeUser(removeForm({ confirm_name: "hana SOTO  " }));
    } catch (err) {
      thrown = err;
    }

    expect(deleteUserCalls).toEqual(["auth-user-target-1"]);
    expect(recordAudit).toHaveBeenCalledTimes(1);
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("toast=removed");
  });

  // ── Three-gate validation order ────────────────────────────────────────

  it("gate 1: missing ack_history → ?error=ack_required (no deleteUser, no anon, no UPDATE, no audit)", async () => {
    const { deleteUserCalls, lastUpdate } = mockAdminClient();

    let thrown: unknown;
    try {
      await removeUser(removeForm({ ack_history: "" }));
    } catch (err) {
      thrown = err;
    }

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=ack_required");
    expect(deleteUserCalls).toEqual([]);
    expect(getNextAnonPlaceholder).not.toHaveBeenCalled();
    expect(lastUpdate.current).toBeNull();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("gate 2: both acks present but typed name wrong → ?error=confirm_name_mismatch (first-fail wins over ack_irreversible)", async () => {
    const { deleteUserCalls, lastUpdate } = mockAdminClient();

    let thrown: unknown;
    try {
      await removeUser(removeForm({ confirm_name: "wrong" }));
    } catch (err) {
      thrown = err;
    }

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=confirm_name_mismatch");
    expect(deleteUserCalls).toEqual([]);
    expect(lastUpdate.current).toBeNull();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("gate 3: typed name correct but ack_irreversible missing → ?error=ack_required", async () => {
    const { deleteUserCalls, lastUpdate } = mockAdminClient();

    let thrown: unknown;
    try {
      await removeUser(removeForm({ ack_irreversible: "" }));
    } catch (err) {
      thrown = err;
    }

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=ack_required");
    expect(deleteUserCalls).toEqual([]);
    expect(lastUpdate.current).toBeNull();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  // ── Target shape gates ─────────────────────────────────────────────────

  it("target.state='active' (not 'offboarded') → ?error=not_found", async () => {
    const { deleteUserCalls, lastUpdate } = mockAdminClient({ target: { state: "active" } });

    let thrown: unknown;
    try {
      await removeUser(removeForm());
    } catch (err) {
      thrown = err;
    }

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=not_found");
    expect(deleteUserCalls).toEqual([]);
    expect(lastUpdate.current).toBeNull();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("target.removed_at non-null (already removed) → ?error=not_found", async () => {
    const { deleteUserCalls, lastUpdate } = mockAdminClient({
      target: { state: "offboarded", removed_at: new Date().toISOString() },
    });

    let thrown: unknown;
    try {
      await removeUser(removeForm());
    } catch (err) {
      thrown = err;
    }

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=not_found");
    expect(deleteUserCalls).toEqual([]);
    expect(lastUpdate.current).toBeNull();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("target missing entirely → ?error=not_found", async () => {
    mockAdminClient({ target: null });

    let thrown: unknown;
    try {
      await removeUser(removeForm());
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=not_found");
  });

  // ── Last-owner trigger ─────────────────────────────────────────────────

  for (const code of ["23514", "P0001"] as const) {
    it(`last-owner trigger ${code} on UPDATE → ?error=last_owner`, async () => {
      mockAdminClient({ updateError: { code, message: "owner_required" } });
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

      let thrown: unknown;
      try {
        await removeUser(removeForm());
      } catch (err) {
        thrown = err;
      }

      const url = redirectUrlFrom(thrown);
      expect(url).toContain("error=last_owner");
      expect(recordAudit).not.toHaveBeenCalled();
      errSpy.mockRestore();
    });
  }

  // ── Owner gate ─────────────────────────────────────────────────────────

  it("non-owner viewer → /dashboard?error=forbidden (no work)", async () => {
    (requireStudioSession as unknown as Mocked<() => Promise<StudioViewer>>).mockResolvedValueOnce(
      MANAGER_VIEWER
    );

    let thrown: unknown;
    try {
      await removeUser(removeForm());
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("/dashboard");
    expect(url).toContain("error=forbidden");
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
