// Unit tests for `removeStaff` in `app/(studio)/settings/staff/actions.ts`.
//
// Issue #129 — removeStaff branches on target identity:
//
//   - PIN-only target (user_id IS NULL): soft-delete only. No auth-user
//     touch, no anonymize, no email to free. Matrix action `remove_pin_only`
//     keeps owner+manager semantics.
//   - App-user target (user_id IS NOT NULL): anonymize the staff row first,
//     then signOut + deleteUser. The combination email=NULL + removed_at
//     NOT NULL drops the row from `staff_email_lower_unique` so the email is
//     freed for re-invite. Matrix action `remove_app_user` is OWNER-ONLY.
//
// Coverage (mirroring `tests/unit/settings/onboarding/actions-remove.test.ts`):
//   - PIN-only happy path: soft-delete, no deleteUser, audit payload with
//     email_at_removal=null.
//   - App-user happy path: getNextAnonPlaceholder + anonymizing UPDATE +
//     signOut + deleteUser + audit with email_at_removal=<original>.
//   - App-user manager → forbidden (matrix owner-only gate).
//   - App-user missing ack → ack_required.
//   - App-user missing/wrong confirm_name → confirm_name_mismatch.
//   - App-user case-insensitive trim on confirm_name comparison.
//   - Target already removed → not_found.
//   - Target missing → not_found.
//   - Last-owner trigger (PG 23514 / P0001) → last_owner; no audit.
//   - Non-owner/manager viewer → /dashboard?error=forbidden.

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

import { removeStaff } from "@/app/(studio)/settings/staff/actions";

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

const TECH_VIEWER: StudioViewer = {
  deviceUserId: "device-tech-1",
  staff: {
    id: "staff-tech-1",
    display_name: "Sam Park",
    role: "technician",
    color_token: "--avatar-sage",
  },
};

function form(overrides: Record<string, string> = {}): FormData {
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
  display_name: string;
  role: "owner" | "manager" | "technician" | "front_desk";
  color_token: string;
  active: boolean;
  removed_at: string | null;
  user_id: string | null;
  email: string | null;
};

const PIN_ONLY_TARGET: TargetRow = {
  id: "staff-target-1",
  display_name: "Kiosk Tech",
  role: "technician",
  color_token: "--avatar-sage",
  active: true,
  removed_at: null,
  user_id: null,
  email: null,
};

const APP_USER_TARGET: TargetRow = {
  id: "staff-target-1",
  display_name: "Hana Soto",
  role: "technician",
  color_token: "--avatar-iris",
  active: true,
  removed_at: null,
  user_id: "auth-user-target-1",
  email: "hana@tangnails.com",
};

type AdminMockOpts = {
  target?: Partial<TargetRow> | null;
  ownerCountExcludingTarget?: number;
  updateError?: { code?: string; message?: string } | null;
  deleteUserError?: Error | null;
};

function mockAdminClient(opts: AdminMockOpts = {}): {
  lastUpdate: { current: Record<string, unknown> | null };
  signOutCalls: Array<[string, string]>;
  deleteUserCalls: Array<string>;
} {
  const lastUpdate = { current: null as Record<string, unknown> | null };
  const signOutCalls: Array<[string, string]> = [];
  const deleteUserCalls: Array<string> = [];

  const targetRow: TargetRow | null =
    opts.target === null
      ? null
      : opts.target === undefined
        ? { ...PIN_ONLY_TARGET }
        : { ...PIN_ONLY_TARGET, ...opts.target };

  // Default isLastOwner = false (target isn't an owner; if it is, there's
  // another active owner to satisfy the count query).
  const ownerCount = opts.ownerCountExcludingTarget ?? 1;

  const fromImpl = () => ({
    select(_columns?: string, options?: { count?: string; head?: boolean }) {
      // The lifecycle target load uses .select(cols).eq(id).single().
      // The isLastOwner count uses .select(cols, {count,head}).eq.eq.is.neq.
      if (options?.head) {
        return {
          eq() {
            return {
              eq() {
                return {
                  is() {
                    return {
                      neq() {
                        return Promise.resolve({ count: ownerCount, error: null });
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }
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
          return { data: null, error: null };
        },
        deleteUser: async (uid: string) => {
          deleteUserCalls.push(uid);
          if (opts.deleteUserError) throw opts.deleteUserError;
          return { data: null, error: null };
        },
      },
    },
  });

  return { lastUpdate, signOutCalls, deleteUserCalls };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("removeStaff — PIN-only branch (target.user_id IS NULL)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireStudioSession as unknown as Mocked<() => Promise<StudioViewer>>).mockResolvedValue(
      OWNER_VIEWER
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("happy path: soft-delete UPDATE, no deleteUser, audit with email_at_removal=null", async () => {
    const { lastUpdate, signOutCalls, deleteUserCalls } = mockAdminClient({
      target: PIN_ONLY_TARGET,
    });

    let thrown: unknown;
    try {
      await removeStaff(form());
    } catch (err) {
      thrown = err;
    }

    // 1. No auth-user impact.
    expect(signOutCalls).toEqual([]);
    expect(deleteUserCalls).toEqual([]);
    // 2. getNextAnonPlaceholder never called — display_name stays intact.
    expect(getNextAnonPlaceholder).not.toHaveBeenCalled();

    // 3. UPDATE is the existing soft-delete shape (removed_at + active=false).
    //    No display_name, email, color_token, or pin_hash columns touched.
    expect(lastUpdate.current).toMatchObject({
      removed_at: expect.any(String),
      active: false,
    });
    expect(lastUpdate.current).not.toHaveProperty("display_name");
    expect(lastUpdate.current).not.toHaveProperty("email");
    expect(lastUpdate.current).not.toHaveProperty("pin_hash");

    // 4. Audit row carries the original display_name + role and explicit
    //    email_at_removal=null so the schema stays parallel to the app-user
    //    branch.
    expect(recordAudit).toHaveBeenCalledTimes(1);
    const auditCall = (recordAudit as unknown as Mocked<() => unknown>).mock.calls[0];
    expect(auditCall[0]).toBe("staff.removed");
    expect(auditCall[2]).toBe("staff-target-1");
    expect(auditCall[3]).toMatchObject({
      display_name_at_removal: "Kiosk Tech",
      email_at_removal: null,
      role_at_removal: "technician",
    });

    // 5. Redirect → ?toast=staff_removed&name=<display_name>.
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("toast=staff_removed");
    expect(url).toContain(`name=${encodeURIComponent("Kiosk Tech")}`);
  });

  it("manager removing a PIN-only target → allowed (matrix `remove_pin_only`)", async () => {
    (requireStudioSession as unknown as Mocked<() => Promise<StudioViewer>>).mockResolvedValueOnce(
      MANAGER_VIEWER
    );
    const { deleteUserCalls } = mockAdminClient({ target: PIN_ONLY_TARGET });

    let thrown: unknown;
    try {
      await removeStaff(form());
    } catch (err) {
      thrown = err;
    }

    expect(deleteUserCalls).toEqual([]);
    expect(recordAudit).toHaveBeenCalledTimes(1);
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("toast=staff_removed");
  });

  it("PIN-only branch ignores confirm_name / ack — they're only required for app-user", async () => {
    // No ack/confirm_name passed; PIN-only branch must still succeed.
    mockAdminClient({ target: PIN_ONLY_TARGET });

    let thrown: unknown;
    try {
      await removeStaff(form());
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("toast=staff_removed");
  });
});

describe("removeStaff — app-user branch (target.user_id IS NOT NULL)", () => {
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

  function appUserForm(overrides: Record<string, string> = {}): FormData {
    return form({
      ack: "on",
      confirm_name: APP_USER_TARGET.display_name,
      ...overrides,
    });
  }

  it("happy path: anonymize UPDATE → signOut → deleteUser → audit with email_at_removal", async () => {
    const { lastUpdate, signOutCalls, deleteUserCalls } = mockAdminClient({
      target: APP_USER_TARGET,
    });

    let thrown: unknown;
    try {
      await removeStaff(appUserForm());
    } catch (err) {
      thrown = err;
    }

    // 1. getNextAnonPlaceholder called once.
    expect(getNextAnonPlaceholder).toHaveBeenCalledTimes(1);

    // 2. UPDATE anonymizes the row — display_name, email, color_token,
    //    pin_hash, removed_at, active all in one statement.
    expect(lastUpdate.current).toMatchObject({
      display_name: "Former staff #1",
      email: null,
      color_token: "--avatar-slate",
      pin_hash: null,
      active: false,
    });
    expect(typeof lastUpdate.current?.removed_at).toBe("string");

    // 3. signOut called with the target's auth user id + "global" scope.
    expect(signOutCalls).toEqual([["auth-user-target-1", "global"]]);

    // 4. deleteUser called with the target's auth user id.
    expect(deleteUserCalls).toEqual(["auth-user-target-1"]);

    // 5. Audit row carries the pre-anonymization identity.
    expect(recordAudit).toHaveBeenCalledTimes(1);
    const auditCall = (recordAudit as unknown as Mocked<() => unknown>).mock.calls[0];
    expect(auditCall[0]).toBe("staff.removed");
    expect(auditCall[2]).toBe("staff-target-1");
    expect(auditCall[3]).toMatchObject({
      display_name_at_removal: "Hana Soto",
      email_at_removal: "hana@tangnails.com",
      role_at_removal: "technician",
    });

    // 6. Redirect uses the original display_name in the toast.
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("toast=staff_removed");
    expect(url).toContain(`name=${encodeURIComponent("Hana Soto")}`);
  });

  it("case-insensitive trim on confirm_name: 'hana SOTO  ' matches 'Hana Soto'", async () => {
    const { deleteUserCalls } = mockAdminClient({ target: APP_USER_TARGET });

    let thrown: unknown;
    try {
      await removeStaff(appUserForm({ confirm_name: "hana SOTO  " }));
    } catch (err) {
      thrown = err;
    }

    expect(deleteUserCalls).toEqual(["auth-user-target-1"]);
    expect(recordAudit).toHaveBeenCalledTimes(1);
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("toast=staff_removed");
  });

  it("manager → forbidden (owner-only `remove_app_user` gate)", async () => {
    (requireStudioSession as unknown as Mocked<() => Promise<StudioViewer>>).mockResolvedValueOnce(
      MANAGER_VIEWER
    );
    const { deleteUserCalls, lastUpdate } = mockAdminClient({ target: APP_USER_TARGET });

    let thrown: unknown;
    try {
      await removeStaff(appUserForm());
    } catch (err) {
      thrown = err;
    }

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=forbidden");
    expect(deleteUserCalls).toEqual([]);
    expect(lastUpdate.current).toBeNull();
    expect(getNextAnonPlaceholder).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("missing ack → ack_required (no DB writes, no audit)", async () => {
    const { deleteUserCalls, lastUpdate } = mockAdminClient({ target: APP_USER_TARGET });

    let thrown: unknown;
    try {
      await removeStaff(appUserForm({ ack: "" }));
    } catch (err) {
      thrown = err;
    }

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=ack_required");
    expect(deleteUserCalls).toEqual([]);
    expect(lastUpdate.current).toBeNull();
    expect(getNextAnonPlaceholder).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("missing confirm_name → confirm_name_mismatch", async () => {
    const { deleteUserCalls, lastUpdate } = mockAdminClient({ target: APP_USER_TARGET });

    let thrown: unknown;
    try {
      await removeStaff(appUserForm({ confirm_name: "" }));
    } catch (err) {
      thrown = err;
    }

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=confirm_name_mismatch");
    expect(deleteUserCalls).toEqual([]);
    expect(lastUpdate.current).toBeNull();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("wrong confirm_name → confirm_name_mismatch", async () => {
    const { deleteUserCalls, lastUpdate } = mockAdminClient({ target: APP_USER_TARGET });

    let thrown: unknown;
    try {
      await removeStaff(appUserForm({ confirm_name: "Wrong Name" }));
    } catch (err) {
      thrown = err;
    }

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=confirm_name_mismatch");
    expect(deleteUserCalls).toEqual([]);
    expect(lastUpdate.current).toBeNull();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("last-owner trigger 23514 on UPDATE → ?error=last_owner, no audit, no deleteUser", async () => {
    const { deleteUserCalls } = mockAdminClient({
      target: { ...APP_USER_TARGET, role: "owner" },
      ownerCountExcludingTarget: 0,
      updateError: { code: "23514", message: "owner_required" },
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    let thrown: unknown;
    try {
      await removeStaff(appUserForm());
    } catch (err) {
      thrown = err;
    }

    const url = redirectUrlFrom(thrown);
    // The matrix's last-owner gate catches this BEFORE the UPDATE fires,
    // surfacing `last_owner` from the matrix itself (PermissionError code).
    // Either path is acceptable — both end at ?error=last_owner.
    expect(url).toContain("error=last_owner");
    expect(deleteUserCalls).toEqual([]);
    expect(recordAudit).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("deleteUser failure after UPDATE succeeds → ?error=server_error", async () => {
    const { signOutCalls, deleteUserCalls, lastUpdate } = mockAdminClient({
      target: APP_USER_TARGET,
      deleteUserError: new Error("Database error deleting user"),
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    let thrown: unknown;
    try {
      await removeStaff(appUserForm());
    } catch (err) {
      thrown = err;
    }

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=server_error");
    // The staff row is already anonymized — recovery story is the orphan
    // auth user gets cleaned up on the next re-invite via email-conflict.
    expect(lastUpdate.current).toMatchObject({
      display_name: "Former staff #1",
      email: null,
    });
    expect(signOutCalls).toEqual([["auth-user-target-1", "global"]]);
    expect(deleteUserCalls).toEqual(["auth-user-target-1"]);
    expect(recordAudit).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("target already removed → ?error=not_found", async () => {
    const { deleteUserCalls } = mockAdminClient({
      target: { ...APP_USER_TARGET, removed_at: new Date().toISOString() },
    });

    let thrown: unknown;
    try {
      await removeStaff(appUserForm());
    } catch (err) {
      thrown = err;
    }

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=not_found");
    expect(deleteUserCalls).toEqual([]);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("target missing entirely → ?error=not_found", async () => {
    const { deleteUserCalls } = mockAdminClient({ target: null });

    let thrown: unknown;
    try {
      await removeStaff(appUserForm());
    } catch (err) {
      thrown = err;
    }

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=not_found");
    expect(deleteUserCalls).toEqual([]);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("non-settings viewer (technician) → /dashboard?error=forbidden", async () => {
    (requireStudioSession as unknown as Mocked<() => Promise<StudioViewer>>).mockResolvedValueOnce(
      TECH_VIEWER
    );

    let thrown: unknown;
    try {
      await removeStaff(appUserForm());
    } catch (err) {
      thrown = err;
    }

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("/dashboard");
    expect(url).toContain("error=forbidden");
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
