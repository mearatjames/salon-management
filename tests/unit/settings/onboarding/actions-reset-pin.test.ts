// Unit tests for `resetUserPin` in
// `app/(studio)/settings/onboarding/actions.ts`.
//
// Coverage matrix:
//   - Happy path: hashPin called once, UPDATE carries `pin_hash` + a
//     non-null `pin_reset_admin_at`, audit `user.pin_reset { previous_pin_set,
//     by, actor: 'admin' }`, redirect ?toast=pin_reset&name=…
//   - Own-row reset (FR-035): viewer.deviceUserId === target.user_id is OK.
//   - Invalid pin shape → ?error=invalid_pin_shape (no work).
//   - Non-active target → ?error=not_found.
//   - Non-owner viewer → /dashboard?error=forbidden.
//
// Constitution III invariant — raw PIN never appears in the audit payload.

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

vi.mock("@/lib/auth/session", () => ({
  requireStudioSession: vi.fn(),
}));

vi.mock("@/lib/auth/audit", () => ({
  recordAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/auth/pin", () => ({
  hashPin: vi.fn(async (raw: string) => `bcrypt-hash-of-${raw}`),
}));

vi.mock("@/lib/db/admin", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

import { recordAudit } from "@/lib/auth/audit";
import { hashPin } from "@/lib/auth/pin";
import { requireStudioSession, type StudioViewer } from "@/lib/auth/session";
import { createSupabaseServiceRoleClient } from "@/lib/db/admin";

import { resetUserPin } from "@/app/(studio)/settings/onboarding/actions";

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

function resetForm(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const merged: Record<string, string> = {
    staff_id: "staff-target-1",
    pin: "4242",
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
  state: "active" | "invited" | "offboarded";
  removed_at: string | null;
  pin_hash: string | null;
};

const DEFAULT_TARGET: TargetRow = {
  id: "staff-target-1",
  user_id: "auth-user-target-1",
  display_name: "Hana Soto",
  state: "active",
  removed_at: null,
  pin_hash: "$2b$11$existing-hash",
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

describe("resetUserPin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireStudioSession as unknown as Mocked<() => Promise<StudioViewer>>).mockResolvedValue(
      OWNER_VIEWER
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("happy path: hashes pin once, UPDATEs pin_hash + pin_reset_admin_at, audits, redirects with ?toast=pin_reset", async () => {
    const { lastUpdate } = mockAdminClient();

    let thrown: unknown;
    try {
      await resetUserPin(resetForm({ pin: "4242" }));
    } catch (err) {
      thrown = err;
    }

    // 1. hashPin called once with the raw pin.
    expect(hashPin).toHaveBeenCalledTimes(1);
    expect(hashPin).toHaveBeenCalledWith("4242");

    // 2. UPDATE includes new pin_hash + a non-null pin_reset_admin_at.
    expect(lastUpdate.current).toMatchObject({
      pin_hash: "bcrypt-hash-of-4242",
    });
    expect(lastUpdate.current?.pin_reset_admin_at).toBeTruthy();

    // 3. Audit payload: previous_pin_set true (default target had a hash),
    //    by + actor='admin'.
    expect(recordAudit).toHaveBeenCalledTimes(1);
    const auditCall = (recordAudit as unknown as Mocked<() => unknown>).mock.calls[0];
    expect(auditCall[0]).toBe("user.pin_reset");
    expect(auditCall[1]).toBe(OWNER_VIEWER.deviceUserId);
    expect(auditCall[2]).toBe("staff-target-1");
    expect(auditCall[3]).toMatchObject({
      previous_pin_set: true,
      by: OWNER_VIEWER.deviceUserId,
      actor: "admin",
    });

    // 4. Raw PIN never lands in audit payload (Constitution III).
    expect(JSON.stringify(auditCall[3])).not.toContain("4242");

    // 5. Redirect → ?toast=pin_reset.
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("/settings/onboarding");
    expect(url).toContain("toast=pin_reset");
    expect(url).toContain(`name=${encodeURIComponent("Hana Soto")}`);
  });

  it("previous_pin_set=false when target had no existing pin_hash", async () => {
    mockAdminClient({ target: { pin_hash: null } });

    try {
      await resetUserPin(resetForm());
    } catch {
      // redirect
    }

    const auditCall = (recordAudit as unknown as Mocked<() => unknown>).mock.calls[0];
    expect(auditCall[3]).toMatchObject({ previous_pin_set: false });
  });

  it("own-row reset (FR-035): viewer.deviceUserId === target.user_id is allowed", async () => {
    mockAdminClient({ target: { user_id: OWNER_VIEWER.deviceUserId } });

    let thrown: unknown;
    try {
      await resetUserPin(resetForm());
    } catch (err) {
      thrown = err;
    }

    expect(recordAudit).toHaveBeenCalledTimes(1);
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("toast=pin_reset");
  });

  it("invalid pin shape → ?error=invalid_pin_shape (no work)", async () => {
    mockAdminClient();

    let thrown: unknown;
    try {
      await resetUserPin(resetForm({ pin: "12" }));
    } catch (err) {
      thrown = err;
    }

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=invalid_pin_shape");
    expect(hashPin).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("non-active target → ?error=not_found", async () => {
    mockAdminClient({ target: { state: "offboarded" } });

    let thrown: unknown;
    try {
      await resetUserPin(resetForm());
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=not_found");
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("target removed_at non-null → ?error=not_found", async () => {
    mockAdminClient({ target: { removed_at: new Date().toISOString() } });

    let thrown: unknown;
    try {
      await resetUserPin(resetForm());
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=not_found");
  });

  it("non-owner viewer → /dashboard?error=forbidden", async () => {
    (requireStudioSession as unknown as Mocked<() => Promise<StudioViewer>>).mockResolvedValueOnce(
      MANAGER_VIEWER
    );

    let thrown: unknown;
    try {
      await resetUserPin(resetForm());
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("/dashboard");
    expect(url).toContain("error=forbidden");
  });
});
