// Unit tests for `setOwnPin` in `app/(auth)/set-pin/actions.ts` — the
// Server Action a no-PIN invitee submits from the `/set-pin` keypad after
// setting their password (specs/048-invitee-self-set-pin).
//
// Constitution IV (auth-critical): these tests are written BEFORE the
// action exists and MUST FAIL on first run. The contract is
// `specs/048-invitee-self-set-pin/contracts/server-actions.md` § setOwnPin.
//
// Branch matrix from the contract:
//   (a) valid 4-digit PIN  → hashPin result written via the service-role
//                            client + recordAudit("user.pin_set", …)
//                            + redirect /select-staff. The raw PIN never
//                            lands in the audit payload (Constitution III).
//   (b) bad shape          → /set-pin?error=invalid_pin_shape, no write,
//                            no audit.
//   (c) no session         → /set-pin?error=expired, no write, no audit.
//   (d) pin_hash non-null  → idempotent skip: no write, no audit,
//                            redirect /select-staff.
//
// We mock `next/navigation` (redirect → observable throw),
// `@/lib/db/server` (authenticated read client), `@/lib/db/admin`
// (service-role write client), `@/lib/auth/audit`, and `@/lib/auth/pin`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    const err = new Error("NEXT_REDIRECT") as Error & { digest: string };
    err.digest = `NEXT_REDIRECT;replace;${url};307`;
    throw err;
  }),
}));

vi.mock("@/lib/db/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/db/admin", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/auth/audit", () => ({
  recordAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/auth/pin", () => ({
  hashPin: vi.fn(async (raw: string) => `bcrypt-hash-of-${raw}`),
}));

import { recordAudit } from "@/lib/auth/audit";
import { hashPin } from "@/lib/auth/pin";
import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import { createSupabaseServerClient } from "@/lib/db/server";

import { setOwnPin } from "@/app/(auth)/set-pin/actions";

type Mocked<T> = T & ReturnType<typeof vi.fn>;

const SESSION_USER_ID = "auth-user-invitee-1";
const STAFF_ID = "staff-invitee-1";

function pinForm(pin: string): FormData {
  const fd = new FormData();
  fd.append("pin", pin);
  return fd;
}

function redirectUrlFrom(err: unknown): string {
  expect(err).toBeInstanceOf(Error);
  const digest = (err as { digest?: string }).digest ?? "";
  expect(digest).toMatch(/^NEXT_REDIRECT;/);
  return digest.split(";")[2];
}

type StaffRow = { id: string; pin_hash: string | null };

// Mock the authenticated server client: `auth.getUser()` for the session
// probe, and `from("staff").select(...).eq(...).maybeSingle()` for the
// own-row lookup.
function mockServerClient(opts: { userId?: string | null; staffRow?: StaffRow | null }): void {
  const userId = opts.userId === undefined ? SESSION_USER_ID : opts.userId;
  const staffRow = opts.staffRow === undefined ? null : opts.staffRow;

  const getUser = vi.fn(async () => ({
    data: { user: userId ? { id: userId } : null },
    error: null,
  }));

  const single = async () => ({
    data: staffRow,
    error: staffRow === null ? { code: "PGRST116", message: "not found" } : null,
  });

  const from = vi.fn(() => ({
    select() {
      return {
        eq() {
          return {
            // Support both `.single()` and `.maybeSingle()` so the test
            // doesn't constrain the implementation's choice.
            single,
            maybeSingle: single,
          };
        },
      };
    },
  }));

  (createSupabaseServerClient as unknown as Mocked<() => Promise<unknown>>).mockResolvedValue({
    auth: { getUser },
    from,
  });
}

// Mock the service-role client used for the privileged `pin_hash` UPDATE.
// Captures the row passed to `.update(...)` and the `.eq(...)` predicates.
function mockAdminClient(opts: { updateError?: { message?: string } | null } = {}): {
  lastUpdate: { current: Record<string, unknown> | null };
  eqPredicates: { current: Array<[string, unknown]> };
} {
  const lastUpdate = { current: null as Record<string, unknown> | null };
  const eqPredicates = { current: [] as Array<[string, unknown]> };

  const from = vi.fn(() => ({
    update(row: Record<string, unknown>) {
      lastUpdate.current = row;
      const chain = {
        eq(col: string, val: unknown) {
          eqPredicates.current.push([col, val]);
          // The terminal `.eq()` resolves; intermediate ones return the
          // chainable. We make every `.eq()` both chainable AND awaitable.
          return Object.assign(Promise.resolve({ error: opts.updateError ?? null }), chain);
        },
      };
      return chain;
    },
  }));

  (createSupabaseServiceRoleClient as unknown as Mocked<() => unknown>).mockReturnValue({ from });

  return { lastUpdate, eqPredicates };
}

describe("setOwnPin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("(a) valid 4-digit PIN: hashes once, writes pin_hash via service-role, audits user.pin_set, redirects /select-staff", async () => {
    mockServerClient({ staffRow: { id: STAFF_ID, pin_hash: null } });
    const { lastUpdate } = mockAdminClient();

    let thrown: unknown;
    try {
      await setOwnPin(pinForm("4242"));
    } catch (err) {
      thrown = err;
    }

    // hashPin called exactly once with the raw PIN.
    expect(hashPin).toHaveBeenCalledTimes(1);
    expect(hashPin).toHaveBeenCalledWith("4242");

    // The privileged UPDATE carries the bcrypt hash.
    expect(lastUpdate.current).toMatchObject({ pin_hash: "bcrypt-hash-of-4242" });

    // Audit row: action, actor, acting-as staff, payload witness.
    expect(recordAudit).toHaveBeenCalledTimes(1);
    const auditCall = (recordAudit as unknown as Mocked<() => unknown>).mock.calls[0];
    expect(auditCall[0]).toBe("user.pin_set");
    expect(auditCall[1]).toBe(SESSION_USER_ID);
    expect(auditCall[2]).toBe(STAFF_ID);
    expect(auditCall[3]).toMatchObject({ pin_set: true, actor: "self" });

    // Constitution III — the raw PIN never lands in the audit payload.
    expect(JSON.stringify(auditCall[3])).not.toContain("4242");

    // Terminal redirect.
    const url = redirectUrlFrom(thrown);
    expect(url).toMatch(/^\/select-staff(\?|$)/);
  });

  it("(b) invalid pin shape → /set-pin?error=invalid_pin_shape, no write, no audit", async () => {
    mockServerClient({ staffRow: { id: STAFF_ID, pin_hash: null } });
    mockAdminClient();

    let thrown: unknown;
    try {
      await setOwnPin(pinForm("12"));
    } catch (err) {
      thrown = err;
    }

    const url = redirectUrlFrom(thrown);
    expect(url).toBe("/set-pin?error=invalid_pin_shape");
    expect(hashPin).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("(c) no session → /set-pin?error=expired, no write, no audit", async () => {
    mockServerClient({ userId: null });
    mockAdminClient();

    let thrown: unknown;
    try {
      await setOwnPin(pinForm("4242"));
    } catch (err) {
      thrown = err;
    }

    const url = redirectUrlFrom(thrown);
    expect(url).toBe("/set-pin?error=expired");
    expect(hashPin).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("(d) staff row pin_hash already set → idempotent skip: no write, no audit, redirect /select-staff", async () => {
    mockServerClient({ staffRow: { id: STAFF_ID, pin_hash: "$2b$11$existing-hash" } });
    const { lastUpdate } = mockAdminClient();

    let thrown: unknown;
    try {
      await setOwnPin(pinForm("4242"));
    } catch (err) {
      thrown = err;
    }

    const url = redirectUrlFrom(thrown);
    expect(url).toMatch(/^\/select-staff(\?|$)/);
    expect(hashPin).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
    expect(lastUpdate.current).toBeNull();
  });

  it("session valid but no staff row → redirect /select-staff, no write, no audit", async () => {
    mockServerClient({ staffRow: null });
    const { lastUpdate } = mockAdminClient();

    let thrown: unknown;
    try {
      await setOwnPin(pinForm("4242"));
    } catch (err) {
      thrown = err;
    }

    const url = redirectUrlFrom(thrown);
    expect(url).toMatch(/^\/select-staff(\?|$)/);
    expect(hashPin).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
    expect(lastUpdate.current).toBeNull();
  });
});
