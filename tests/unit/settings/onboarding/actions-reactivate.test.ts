// Unit tests for `reactivateUser` in
// `app/(studio)/settings/onboarding/actions.ts`.
//
// Mirrors `actions-resend.test.ts` / `actions-cancel.test.ts` for the mocking
// pattern (redirect-as-throw, per-module mocks). Coverage matrix per dispatch
// (012-user-onboarding § Phase 8 / US6 / T078):
//
//   - Target validity: must be `state='offboarded' AND removed_at IS NULL`.
//     Hard-removed target (removed_at non-null) → `?error=not_found`.
//     Wrong state (active / invited) → `?error=not_found`.
//     Missing target / missing email → `?error=not_found`.
//   - Happy path: calls `admin.auth.admin.generateLink({ type:'magiclink',
//     email: target.email })` (fresh token) → UPDATE staff SET
//     state='invited', active=false, offboarded_at=NULL, offboarded_by=NULL,
//     offboard_reason=NULL, invited_at=now(), invited_by=viewer.staff.id,
//     invite_method='magic_link', pin_hash=NULL. Then audit `user.reactivated
//     { method: 'magic_link', by }`. Redirect ?toast=reactivated&name=…
//   - generateLink failure → `?error=invite_failed`, no UPDATE, no audit.
//   - DB UPDATE failure → `?error=server_error`, no audit.
//   - Non-owner viewer → /dashboard?error=forbidden.
//
// Implementation model (FR-061): reactivate is ALWAYS magic_link in v1 —
// independent of the prior offboarded user's original invite_method.

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

import { reactivateUser } from "@/app/(studio)/settings/onboarding/actions";

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

function reactivateForm(overrides: Record<string, string> = {}): FormData {
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
  email: "jordan@tangnails.com",
  display_name: "Jordan Lee",
  state: "offboarded",
  removed_at: null,
};

type AdminMockOpts = {
  target?: Partial<TargetRow> | null;
  updateError?: { code?: string; message?: string } | null;
  generateLinkError?: Error | null;
};

function mockAdminClient(opts: AdminMockOpts = {}): {
  lastUpdate: { current: Record<string, unknown> | null };
  generateLinkCalls: Array<{ type: string; email: string; options?: unknown }>;
} {
  const lastUpdate = { current: null as Record<string, unknown> | null };
  const generateLinkCalls: Array<{ type: string; email: string; options?: unknown }> = [];

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
        generateLink: async (args: { type: string; email: string; options?: unknown }) => {
          generateLinkCalls.push(args);
          if (opts.generateLinkError) throw opts.generateLinkError;
          return {
            data: { properties: { action_link: "https://example.test/auth/callback?token=abc" } },
            error: null,
          };
        },
      },
    },
  });

  return { lastUpdate, generateLinkCalls };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("reactivateUser", () => {
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

  it("happy path: generateLink (magic_link) → UPDATE staff → audit → redirect ?toast=reactivated", async () => {
    const { lastUpdate, generateLinkCalls } = mockAdminClient();

    let thrown: unknown;
    try {
      await reactivateUser(reactivateForm());
    } catch (err) {
      thrown = err;
    }

    // 1. generateLink called once with type 'magiclink' + target's email.
    expect(generateLinkCalls).toHaveLength(1);
    expect(generateLinkCalls[0].type).toBe("magiclink");
    expect(generateLinkCalls[0].email).toBe("jordan@tangnails.com");

    // 2. UPDATE clears offboard metadata and sets invite metadata.
    expect(lastUpdate.current).not.toBeNull();
    expect(lastUpdate.current?.state).toBe("invited");
    expect(lastUpdate.current?.active).toBe(false);
    expect(lastUpdate.current?.offboarded_at).toBeNull();
    expect(lastUpdate.current?.offboarded_by).toBeNull();
    expect(lastUpdate.current?.offboard_reason).toBeNull();
    expect(lastUpdate.current?.invite_method).toBe("magic_link");
    expect(lastUpdate.current?.invited_by).toBe(OWNER_VIEWER.staff.id);
    expect(lastUpdate.current?.pin_hash).toBeNull();
    expect(typeof lastUpdate.current?.invited_at).toBe("string");

    // 3. Audit BEFORE redirect (Constitution III).
    expect(recordAudit).toHaveBeenCalledTimes(1);
    const auditCall = (recordAudit as unknown as Mocked<() => unknown>).mock.calls[0];
    expect(auditCall[0]).toBe("user.reactivated");
    expect(auditCall[1]).toBe(OWNER_VIEWER.deviceUserId);
    expect(auditCall[2]).toBe("staff-target-1");
    expect(auditCall[3]).toMatchObject({
      method: "magic_link",
      by: OWNER_VIEWER.deviceUserId,
    });

    // 4. Redirect.
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("/settings/onboarding");
    expect(url).toContain("toast=reactivated");
    expect(url).toContain(`name=${encodeURIComponent("Jordan Lee")}`);
  });

  // ── Target-shape gates ─────────────────────────────────────────────────

  it("target.removed_at non-null (hard-removed) → ?error=not_found, no rotation, no UPDATE, no audit", async () => {
    const { lastUpdate, generateLinkCalls } = mockAdminClient({
      target: { removed_at: new Date().toISOString() },
    });

    let thrown: unknown;
    try {
      await reactivateUser(reactivateForm());
    } catch (err) {
      thrown = err;
    }

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=not_found");
    expect(generateLinkCalls).toHaveLength(0);
    expect(lastUpdate.current).toBeNull();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("target.state='active' → ?error=not_found", async () => {
    mockAdminClient({ target: { state: "active" } });

    let thrown: unknown;
    try {
      await reactivateUser(reactivateForm());
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=not_found");
  });

  it("target.state='invited' → ?error=not_found", async () => {
    mockAdminClient({ target: { state: "invited" } });

    let thrown: unknown;
    try {
      await reactivateUser(reactivateForm());
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
      await reactivateUser(reactivateForm());
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
      await reactivateUser(reactivateForm());
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=not_found");
  });

  it("missing staff_id → ?error=not_found", async () => {
    mockAdminClient();

    let thrown: unknown;
    try {
      await reactivateUser(reactivateForm({ staff_id: "" }));
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=not_found");
  });

  // ── Supabase failure ───────────────────────────────────────────────────

  it("generateLink throws → ?error=invite_failed (no UPDATE, no audit)", async () => {
    const { lastUpdate } = mockAdminClient({
      generateLinkError: new Error("supabase boom"),
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    let thrown: unknown;
    try {
      await reactivateUser(reactivateForm());
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
      await reactivateUser(reactivateForm());
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
      await reactivateUser(reactivateForm());
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("/dashboard");
    expect(url).toContain("error=forbidden");
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
