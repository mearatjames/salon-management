// Unit tests for `inviteUser` (Quick mode) in
// `app/(studio)/settings/onboarding/actions.ts`.
//
// Mirrors the mocking pattern of `tests/unit/auth/login-actions.test.ts`:
// `next/navigation`'s `redirect()` becomes an inspectable throw so the
// short-circuit is observable; all admin and helper modules are mocked so
// the test runs without touching Supabase, env vars, or the DB.
//
// Coverage matrix (per dispatch):
//   - Happy path: generateMagicLinkInvite called once, INSERT shape correct,
//     audit BEFORE redirect (Constitution III), revalidatePath fires,
//     redirect target carries `?toast=invited&name=<encoded>`.
//   - Email-conflict matrix (already_active / already_invited /
//     was_offboarded) → redirect to `?error=<code>`, no admin call, no
//     INSERT, no audit.
//   - Validation failures (invalid_email, invalid_name, invalid_role) →
//     redirect to `?error=<code>`. No admin call.
//   - generateMagicLinkInvite duplicate sentinel → `?error=already_invited`.
//   - generateMagicLinkInvite throws → `?error=invite_failed`.
//   - INSERT fails with code 23505 (unique_violation on
//     staff_email_lower_unique) → rolls back via deleteInviteUser →
//     `?error=already_invited`.
//   - INSERT fails with other DB error → rollback + `?error=server_error`.
//   - Non-owner viewer → `/dashboard?error=forbidden`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks (declared before imports of the SUT) ─────────────────────────────

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

vi.mock("@/lib/onboarding/email-conflict", () => ({
  checkEmailConflict: vi.fn(async () => null),
}));

vi.mock("@/lib/onboarding/invite", () => ({
  generateMagicLinkInvite: vi.fn(async () => ({
    user_id: "auth-user-new",
  })),
  deleteInviteUser: vi.fn(async () => undefined),
}));

vi.mock("@/lib/onboarding/invite-metadata", () => ({
  buildInviteMetadata: vi.fn(),
}));

vi.mock("@/lib/db/admin", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

// ── Imports of the SUT and the mocked modules ──────────────────────────────

import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/auth/audit";
import { requireStudioSession, type StudioViewer } from "@/lib/auth/session";
import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import { checkEmailConflict } from "@/lib/onboarding/email-conflict";
import { deleteInviteUser, generateMagicLinkInvite } from "@/lib/onboarding/invite";
import { buildInviteMetadata } from "@/lib/onboarding/invite-metadata";

import { inviteUser } from "@/app/(studio)/settings/onboarding/actions";

type Mocked<T> = T & ReturnType<typeof vi.fn>;

/** The resolved invite metadata the action forwards to the invite helper. */
const INVITE_META = {
  display_name: "Hana Soto",
  role: "technician",
  invited_by: "staff-owner-1",
  invited_by_name: "Maya Patel",
  salon_name: "Tang Nails",
  expires_human: "June 6, 2026",
};

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

/** Build a FormData payload with the canonical Quick-mode fields. */
function quickForm(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const merged: Record<string, string> = {
    mode: "quick",
    display_name: "Hana Soto",
    email: "hana@tangnails.test",
    role: "technician",
    ...overrides,
  };
  for (const [k, v] of Object.entries(merged)) {
    fd.append(k, v);
  }
  return fd;
}

/** Extract the destination URL from a thrown NEXT_REDIRECT digest. */
function redirectUrlFrom(err: unknown): string {
  expect(err).toBeInstanceOf(Error);
  const digest = (err as { digest?: string }).digest ?? "";
  expect(digest).toMatch(/^NEXT_REDIRECT;/);
  return digest.split(";")[2];
}

type InsertResult = { error: { code?: string; message?: string } | null };
type InsertImpl = (row: Record<string, unknown>) => InsertResult;

/**
 * Wire up a fake service-role client that:
 *   - .from('staff').select('color_token').is('removed_at', null) → empty list
 *   - .from('staff').insert({...}).select('id').single() → returns insertImpl result
 *
 * The chain is simulated with thenable-ish builders so the SUT can chain
 * `.select().single()` after `.insert()` without tripping on type guards.
 */
function mockAdminClient(insertImpl: InsertImpl = () => ({ error: null })): {
  lastInsertRow: { current: Record<string, unknown> | null };
} {
  const lastInsertRow = { current: null as Record<string, unknown> | null };

  const fromImpl = () => {
    return {
      // SELECT path used to pick an unused avatar color.
      select() {
        return {
          is() {
            return Promise.resolve({ data: [], error: null });
          },
          eq() {
            // For the "look up inserted id" fallback path (if used).
            return {
              single: async () => ({ data: { id: "staff-row-new" }, error: null }),
            };
          },
        };
      },
      // INSERT path.
      insert(row: Record<string, unknown>) {
        lastInsertRow.current = row;
        const result = insertImpl(row);
        return {
          select() {
            return {
              single: async () => {
                if (result.error) {
                  return { data: null, error: result.error };
                }
                return { data: { id: "staff-row-new" }, error: null };
              },
            };
          },
        };
      },
    };
  };

  (createSupabaseServiceRoleClient as unknown as Mocked<() => unknown>).mockReturnValue({
    from: fromImpl,
  });

  return { lastInsertRow };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("inviteUser (mode='quick')", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireStudioSession as unknown as Mocked<() => Promise<StudioViewer>>).mockResolvedValue(
      OWNER_VIEWER
    );
    (checkEmailConflict as unknown as Mocked<() => Promise<string | null>>).mockResolvedValue(null);
    (
      generateMagicLinkInvite as unknown as Mocked<
        () => Promise<{ user_id: string | null; link: string | null; error?: string }>
      >
    ).mockResolvedValue({
      user_id: "auth-user-new",
      link: "https://example.test/magic",
    });
    (buildInviteMetadata as unknown as Mocked<() => Promise<unknown>>).mockResolvedValue(
      INVITE_META
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Happy path ─────────────────────────────────────────────────────────

  it("happy path: calls generateMagicLinkInvite once, INSERTs invited staff row, audits, then redirects with ?toast=invited", async () => {
    const { lastInsertRow } = mockAdminClient();

    let thrown: unknown;
    try {
      await inviteUser(quickForm());
    } catch (err) {
      thrown = err;
    }

    // 1. invite metadata is built from the invitee + the owner viewer, then
    //    the magic-link helper is called once with that full payload — which
    //    includes the salon_name / invited_by_name / expires_human fields the
    //    hosted email template renders (issue #159).
    expect(buildInviteMetadata).toHaveBeenCalledTimes(1);
    expect(buildInviteMetadata).toHaveBeenCalledWith({
      displayName: "Hana Soto",
      role: "technician",
      inviterId: OWNER_VIEWER.staff.id,
      inviterName: OWNER_VIEWER.staff.display_name,
    });
    expect(generateMagicLinkInvite).toHaveBeenCalledTimes(1);
    const [emailArg, metaArg] = (generateMagicLinkInvite as unknown as Mocked<() => unknown>).mock
      .calls[0];
    expect(emailArg).toBe("hana@tangnails.test");
    expect(metaArg).toMatchObject({
      display_name: "Hana Soto",
      role: "technician",
      invited_by: OWNER_VIEWER.staff.id,
      invited_by_name: "Maya Patel",
      salon_name: "Tang Nails",
      expires_human: "June 6, 2026",
    });

    // 2. INSERT shape: state='invited', active=false, magic_link method,
    //    pin_hash=null.
    expect(lastInsertRow.current).toMatchObject({
      user_id: "auth-user-new",
      display_name: "Hana Soto",
      email: "hana@tangnails.test",
      role: "technician",
      state: "invited",
      active: false,
      invite_method: "magic_link",
      pin_hash: null,
      invited_by: OWNER_VIEWER.staff.id,
    });
    expect(typeof lastInsertRow.current?.invited_at).toBe("string");
    expect(typeof lastInsertRow.current?.color_token).toBe("string");

    // 3. Audit row written BEFORE redirect (Constitution III). The
    //    redirect throws — assert audit was called before that throw.
    expect(recordAudit).toHaveBeenCalledTimes(1);
    const auditCall = (recordAudit as unknown as Mocked<() => unknown>).mock.calls[0];
    expect(auditCall[0]).toBe("user.invited");
    expect(auditCall[1]).toBe(OWNER_VIEWER.deviceUserId);
    // entityId = newly-inserted staff row id
    expect(auditCall[2]).toBe("staff-row-new");
    expect(auditCall[3]).toMatchObject({
      email: "hana@tangnails.test",
      role: "technician",
      method: "magic_link",
      pin_set: false,
    });

    // 4. revalidatePath fired.
    expect(revalidatePath).toHaveBeenCalledWith("/settings/onboarding");

    // 5. Redirect target carries ?toast=invited&name=<encoded>.
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("/settings/onboarding");
    expect(url).toContain("toast=invited");
    expect(url).toContain(`name=${encodeURIComponent("Hana Soto")}`);

    // 6. Rollback was NOT called on the happy path.
    expect(deleteInviteUser).not.toHaveBeenCalled();
  });

  // ── Email-conflict matrix ──────────────────────────────────────────────

  for (const code of ["already_active", "already_invited", "was_offboarded"] as const) {
    it(`email-conflict "${code}" → redirect ?error=${code} (no admin call, no INSERT, no audit)`, async () => {
      mockAdminClient();
      (checkEmailConflict as unknown as Mocked<() => Promise<string | null>>).mockResolvedValueOnce(
        code
      );

      let thrown: unknown;
      try {
        await inviteUser(quickForm());
      } catch (err) {
        thrown = err;
      }

      const url = redirectUrlFrom(thrown);
      expect(url).toContain("/settings/onboarding");
      expect(url).toContain(`error=${code}`);

      expect(generateMagicLinkInvite).not.toHaveBeenCalled();
      expect(recordAudit).not.toHaveBeenCalled();
      expect(deleteInviteUser).not.toHaveBeenCalled();
    });
  }

  // ── Validation failures ────────────────────────────────────────────────

  it("invalid_email → redirect ?error=invalid_email (no admin call)", async () => {
    mockAdminClient();

    let thrown: unknown;
    try {
      await inviteUser(quickForm({ email: "not-an-email" }));
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=invalid_email");
    expect(generateMagicLinkInvite).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("invalid_name → redirect ?error=invalid_name (no admin call)", async () => {
    mockAdminClient();

    let thrown: unknown;
    try {
      await inviteUser(quickForm({ display_name: "x" }));
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=invalid_name");
    expect(generateMagicLinkInvite).not.toHaveBeenCalled();
  });

  it("invalid_role → redirect ?error=invalid_role (no admin call)", async () => {
    mockAdminClient();

    let thrown: unknown;
    try {
      await inviteUser(quickForm({ role: "supervillain" }));
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=invalid_role");
    expect(generateMagicLinkInvite).not.toHaveBeenCalled();
  });

  // ── Magic-link helper failure modes ────────────────────────────────────

  it("generateMagicLinkInvite returns duplicate sentinel → redirect ?error=already_invited", async () => {
    mockAdminClient();
    (
      generateMagicLinkInvite as unknown as Mocked<() => Promise<{ user_id: null; error: string }>>
    ).mockResolvedValueOnce({ user_id: null, error: "duplicate" } as unknown as {
      user_id: null;
      error: string;
    });

    let thrown: unknown;
    try {
      await inviteUser(quickForm());
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=already_invited");
    expect(recordAudit).not.toHaveBeenCalled();
    expect(deleteInviteUser).not.toHaveBeenCalled();
  });

  it("generateMagicLinkInvite throws → redirect ?error=invite_failed", async () => {
    mockAdminClient();
    (generateMagicLinkInvite as unknown as Mocked<() => Promise<unknown>>).mockRejectedValueOnce(
      new Error("network blip")
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    let thrown: unknown;
    try {
      await inviteUser(quickForm());
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=invite_failed");
    expect(recordAudit).not.toHaveBeenCalled();
    expect(deleteInviteUser).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  // ── INSERT failures + rollback ─────────────────────────────────────────

  it("INSERT fails with 23505 unique_violation → rollback deleteInviteUser + redirect ?error=already_invited", async () => {
    mockAdminClient(() => ({
      error: { code: "23505", message: 'duplicate key value violates "staff_email_lower_unique"' },
    }));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    let thrown: unknown;
    try {
      await inviteUser(quickForm());
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=already_invited");
    expect(deleteInviteUser).toHaveBeenCalledTimes(1);
    expect(deleteInviteUser).toHaveBeenCalledWith("auth-user-new");
    expect(recordAudit).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("INSERT fails with other DB error → rollback deleteInviteUser + redirect ?error=server_error", async () => {
    mockAdminClient(() => ({
      error: { code: "42P01", message: "relation does not exist" },
    }));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    let thrown: unknown;
    try {
      await inviteUser(quickForm());
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=server_error");
    expect(deleteInviteUser).toHaveBeenCalledTimes(1);
    expect(deleteInviteUser).toHaveBeenCalledWith("auth-user-new");
    expect(recordAudit).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  // ── Owner gate ─────────────────────────────────────────────────────────

  it("non-owner viewer → redirect /dashboard?error=forbidden (no work)", async () => {
    (requireStudioSession as unknown as Mocked<() => Promise<StudioViewer>>).mockResolvedValueOnce(
      MANAGER_VIEWER
    );

    let thrown: unknown;
    try {
      await inviteUser(quickForm());
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("/dashboard");
    expect(url).toContain("error=forbidden");
    expect(checkEmailConflict).not.toHaveBeenCalled();
    expect(generateMagicLinkInvite).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
