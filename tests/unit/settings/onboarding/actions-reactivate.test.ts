// Unit tests for `reactivateUser` in
// `app/(studio)/settings/onboarding/actions.ts`.
//
// Mirrors `actions-resend.test.ts` for the mocking pattern (redirect-as-throw,
// per-module mocks, sendImplicitFlowResetEmail mocked at the helper boundary).
//
// Implementation model (post-#116, FR-061): reactivate is ALWAYS magic_link in
// v1 — independent of the prior offboarded user's original invite_method.
// Reactivating an offboarded user re-sends a fresh sign-in link to the
// EXISTING auth user via `sendImplicitFlowResetEmail`. It does NOT use
// `admin.generateLink` — that primitive only generates a token, it does not
// send the email (the same defect #115 fixed elsewhere). It also does NOT use
// `inviteUserByEmail` — that rejects already-confirmed addresses with
// `email_exists`, and an offboarded user IS already confirmed (they were
// active before being offboarded). `resetPasswordForEmail` on the implicit-
// flow client reaches any existing user without touching the auth row, and
// the link lands on `/auth/invite-callback` (the same shape the original
// admin invite produces). The staff row's user_id is preserved — the audit
// chain stays consistent across the offboard→reactivate cycle.
//
// Coverage matrix:
//   - Target validity: must be `state='offboarded' AND removed_at IS NULL AND
//     email IS NOT NULL`. Hard-removed / wrong state / missing target /
//     missing email → `?error=not_found`.
//   - Happy path: sendImplicitFlowResetEmail(target.email,
//     '<origin>/auth/invite-callback') → UPDATE staff SET state='invited',
//     active=false, offboarded_at=NULL, offboarded_by=NULL,
//     offboard_reason=NULL, invited_at=now(), invited_by=viewer.staff.id,
//     invite_method='magic_link', pin_hash=NULL. user_id PRESERVED. Then
//     audit `user.reactivated { method: 'magic_link', by }`. Redirect
//     ?toast=reactivated&name=…
//   - sendImplicitFlowResetEmail throws → `?error=invite_failed`, no UPDATE,
//     no audit.
//   - DB UPDATE failure → `?error=server_error`, no audit.
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

// reactivate reaches Supabase only through these two helpers; the rest are
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

describe("reactivateUser", () => {
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

  // ── Happy path ─────────────────────────────────────────────────────────

  it("happy path: re-sends sign-in link → UPDATE staff → audit → redirect ?toast=reactivated", async () => {
    const { lastUpdate } = mockAdminClient();

    let thrown: unknown;
    try {
      await reactivateUser(reactivateForm());
    } catch (err) {
      thrown = err;
    }

    // 1. sendImplicitFlowResetEmail called once with target email and the
    //    magic-link /auth/invite-callback redirect (no `?method` — reactivate
    //    is always magic_link in v1 per FR-061).
    expect(sendImplicitFlowResetEmail).toHaveBeenCalledTimes(1);
    expect(sendImplicitFlowResetEmail).toHaveBeenCalledWith(
      "jordan@tangnails.com",
      "http://localhost:3000/auth/invite-callback"
    );

    // 2. UPDATE clears offboard metadata and sets invite metadata.
    //    user_id is PRESERVED — the auth user is untouched.
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
    expect(lastUpdate.current).not.toHaveProperty("user_id");

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

  it("target.removed_at non-null (hard-removed) → ?error=not_found, no re-send, no UPDATE, no audit", async () => {
    const { lastUpdate } = mockAdminClient({
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
    expect(sendImplicitFlowResetEmail).not.toHaveBeenCalled();
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

  it("sendImplicitFlowResetEmail throws → ?error=invite_failed (no UPDATE, no audit)", async () => {
    const { lastUpdate } = mockAdminClient();
    (sendImplicitFlowResetEmail as unknown as Mocked<() => Promise<void>>).mockRejectedValueOnce(
      new Error("supabase boom")
    );
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

  it("UPDATE failure → ?error=server_error (re-send already happened; audit NOT written)", async () => {
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
    expect(sendImplicitFlowResetEmail).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
