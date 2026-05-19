// Unit tests for `inviteUser` (Thorough mode) in
// `app/(studio)/settings/onboarding/actions.ts`.
//
// Companion to `actions-invite-quick.test.ts`. The same mock pattern is
// used (redirect-as-throw + per-module mocks of admin / invite / audit /
// session). The Thorough branch adds:
//   - `method` field — 'magic_link' (calls generateMagicLinkInvite) OR
//     'password' (calls sendPasswordInvite).
//   - optional `pin` field — when supplied, `hashPin(pin)` runs once and
//     the staff INSERT carries the resulting hash + audit `pin_set=true`.
//   - extra validation: `color_token` (required), `pin` (optional 4-digit
//     shape), `method` enum.
//   - the audit payload's `method` reflects the chosen method (not always
//     'magic_link' like Quick).
//
// Constitution III invariant — the raw PIN never lands in the audit
// payload. The final test asserts the digits literally do not appear in
// the JSON-stringified payload that recordAudit received.

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

vi.mock("@/lib/auth/pin", () => ({
  hashPin: vi.fn(async (raw: string) => `bcrypt-hash-of-${raw}`),
}));

vi.mock("@/lib/onboarding/email-conflict", () => ({
  checkEmailConflict: vi.fn(async () => null),
}));

vi.mock("@/lib/onboarding/invite", () => ({
  generateMagicLinkInvite: vi.fn(async () => ({
    user_id: "auth-user-ml",
    link: "https://example.test/magic",
  })),
  sendPasswordInvite: vi.fn(async () => ({
    user_id: "auth-user-pw",
  })),
  deleteInviteUser: vi.fn(async () => undefined),
}));

vi.mock("@/lib/db/admin", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

// ── Imports of the SUT and the mocked modules ──────────────────────────────

import { recordAudit } from "@/lib/auth/audit";
import { hashPin } from "@/lib/auth/pin";
import { requireStudioSession, type StudioViewer } from "@/lib/auth/session";
import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import {
  deleteInviteUser,
  generateMagicLinkInvite,
  sendPasswordInvite,
} from "@/lib/onboarding/invite";

import { inviteUser } from "@/app/(studio)/settings/onboarding/actions";

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

/** Build a FormData payload with the canonical Thorough-mode fields. */
function thoroughForm(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const merged: Record<string, string> = {
    mode: "thorough",
    display_name: "Hana Soto",
    email: "hana@tangnails.test",
    role: "technician",
    color_token: "--avatar-blue",
    method: "magic_link",
    // pin omitted by default — opt in via overrides
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

function mockAdminClient(insertImpl: InsertImpl = () => ({ error: null })): {
  lastInsertRow: { current: Record<string, unknown> | null };
} {
  const lastInsertRow = { current: null as Record<string, unknown> | null };

  const fromImpl = () => {
    return {
      select() {
        return {
          is() {
            return Promise.resolve({ data: [], error: null });
          },
          eq() {
            return {
              single: async () => ({ data: { id: "staff-row-new" }, error: null }),
            };
          },
        };
      },
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

describe("inviteUser (mode='thorough')", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireStudioSession as unknown as Mocked<() => Promise<StudioViewer>>).mockResolvedValue(
      OWNER_VIEWER
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Method branch: password ────────────────────────────────────────────

  it("method='password' → calls sendPasswordInvite (NOT magic-link), INSERT carries invite_method='password', audit method='password'", async () => {
    const { lastInsertRow } = mockAdminClient();

    let thrown: unknown;
    try {
      await inviteUser(thoroughForm({ method: "password" }));
    } catch (err) {
      thrown = err;
    }

    expect(sendPasswordInvite).toHaveBeenCalledTimes(1);
    const [emailArg, metaArg] = (sendPasswordInvite as unknown as Mocked<() => unknown>).mock
      .calls[0];
    expect(emailArg).toBe("hana@tangnails.test");
    expect(metaArg).toMatchObject({
      display_name: "Hana Soto",
      role: "technician",
      invited_by: OWNER_VIEWER.staff.id,
    });
    expect(generateMagicLinkInvite).not.toHaveBeenCalled();

    expect(lastInsertRow.current).toMatchObject({
      user_id: "auth-user-pw",
      invite_method: "password",
      state: "invited",
      active: false,
      pin_hash: null,
      color_token: "--avatar-blue",
    });

    expect(recordAudit).toHaveBeenCalledTimes(1);
    const auditPayload = (recordAudit as unknown as Mocked<() => unknown>).mock
      .calls[0][3] as Record<string, unknown>;
    expect(auditPayload.method).toBe("password");
    expect(auditPayload.pin_set).toBe(false);

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("toast=invited");
  });

  // ── Method branch: magic_link ──────────────────────────────────────────

  it("method='magic_link' → calls generateMagicLinkInvite, INSERT carries invite_method='magic_link'", async () => {
    const { lastInsertRow } = mockAdminClient();

    try {
      await inviteUser(thoroughForm({ method: "magic_link" }));
    } catch {
      // redirect — ignore
    }

    expect(generateMagicLinkInvite).toHaveBeenCalledTimes(1);
    expect(sendPasswordInvite).not.toHaveBeenCalled();

    expect(lastInsertRow.current).toMatchObject({
      user_id: "auth-user-ml",
      invite_method: "magic_link",
      color_token: "--avatar-blue",
    });

    const auditPayload = (recordAudit as unknown as Mocked<() => unknown>).mock
      .calls[0][3] as Record<string, unknown>;
    expect(auditPayload.method).toBe("magic_link");
  });

  // ── PIN-set branch ─────────────────────────────────────────────────────

  it("with a 4-digit pin → hashPin called once, INSERT carries pin_hash=<hash>, audit pin_set=true", async () => {
    const { lastInsertRow } = mockAdminClient();

    try {
      await inviteUser(thoroughForm({ pin: "9173" }));
    } catch {
      // redirect — ignore
    }

    expect(hashPin).toHaveBeenCalledTimes(1);
    expect(hashPin).toHaveBeenCalledWith("9173");
    expect(lastInsertRow.current?.pin_hash).toBe("bcrypt-hash-of-9173");

    const auditPayload = (recordAudit as unknown as Mocked<() => unknown>).mock
      .calls[0][3] as Record<string, unknown>;
    expect(auditPayload.pin_set).toBe(true);
  });

  // ── Combined: method='password' + pin → both branches engaged ─────────

  it("method='password' + 4-digit pin → sendPasswordInvite called, INSERT carries pin_hash + invite_method='password', audit method='password' AND pin_set=true", async () => {
    const { lastInsertRow } = mockAdminClient();

    try {
      await inviteUser(thoroughForm({ method: "password", pin: "8821" }));
    } catch {
      // redirect — ignore
    }

    expect(sendPasswordInvite).toHaveBeenCalledTimes(1);
    expect(generateMagicLinkInvite).not.toHaveBeenCalled();

    expect(hashPin).toHaveBeenCalledTimes(1);
    expect(hashPin).toHaveBeenCalledWith("8821");

    expect(lastInsertRow.current).toMatchObject({
      user_id: "auth-user-pw",
      invite_method: "password",
      pin_hash: "bcrypt-hash-of-8821",
    });

    const auditPayload = (recordAudit as unknown as Mocked<() => unknown>).mock
      .calls[0][3] as Record<string, unknown>;
    expect(auditPayload.method).toBe("password");
    expect(auditPayload.pin_set).toBe(true);
  });

  // ── PIN-skipped branch ─────────────────────────────────────────────────

  it("without pin → INSERT has pin_hash=null, audit pin_set=false, hashPin not called", async () => {
    const { lastInsertRow } = mockAdminClient();

    try {
      await inviteUser(thoroughForm());
    } catch {
      // redirect — ignore
    }

    expect(hashPin).not.toHaveBeenCalled();
    expect(lastInsertRow.current?.pin_hash).toBeNull();

    const auditPayload = (recordAudit as unknown as Mocked<() => unknown>).mock
      .calls[0][3] as Record<string, unknown>;
    expect(auditPayload.pin_set).toBe(false);
  });

  // ── Validation failures specific to Thorough ───────────────────────────

  it("non-4-digit pin → ?error=invalid_pin_shape (no admin call, no audit)", async () => {
    mockAdminClient();

    let thrown: unknown;
    try {
      await inviteUser(thoroughForm({ pin: "12" }));
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=invalid_pin_shape");
    expect(generateMagicLinkInvite).not.toHaveBeenCalled();
    expect(sendPasswordInvite).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("off-palette color → ?error=invalid_color (no admin call)", async () => {
    mockAdminClient();

    let thrown: unknown;
    try {
      await inviteUser(thoroughForm({ color_token: "--avatar-magenta-fake" }));
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=invalid_color");
    expect(generateMagicLinkInvite).not.toHaveBeenCalled();
    expect(sendPasswordInvite).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("invalid method value → ?error=invalid_invite_method", async () => {
    mockAdminClient();

    let thrown: unknown;
    try {
      await inviteUser(thoroughForm({ method: "telegram" }));
    } catch (err) {
      thrown = err;
    }
    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=invalid_invite_method");
    expect(generateMagicLinkInvite).not.toHaveBeenCalled();
    expect(sendPasswordInvite).not.toHaveBeenCalled();
  });

  // ── Raw PIN never appears in the audit payload (Constitution III) ──────

  it("raw PIN digits NEVER appear in the audit payload (JSON.stringify check)", async () => {
    mockAdminClient();
    const RAW_PIN = "5294";

    try {
      await inviteUser(thoroughForm({ pin: RAW_PIN }));
    } catch {
      // redirect — ignore
    }

    expect(recordAudit).toHaveBeenCalledTimes(1);
    const auditPayload = (recordAudit as unknown as Mocked<() => unknown>).mock
      .calls[0][3] as Record<string, unknown>;
    const json = JSON.stringify(auditPayload);
    expect(json).not.toContain(RAW_PIN);
    // The boolean witness is still there.
    expect(auditPayload.pin_set).toBe(true);
  });
});
