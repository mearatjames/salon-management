// Unit tests for the supply-types catalog Server Actions in
// `app/(studio)/settings/policy/actions.ts`.
//
// These take over coverage from the e2e tests that issue #63 prunes —
// inline-create save, rename happy path + audit emission, archive happy
// path + usage-count pre-check + audit, reactivate happy path + audit.
// The e2e suite keeps only the irreducibly-browser contracts (post-
// migration invariants, sub-row navigation, picker projection, archive-
// disabled tooltip, revalidatePath cache invalidation).
//
// Mirrors the mocking pattern from `tests/unit/settings/onboarding/*.test.ts`:
// redirect-as-throw via next/navigation, per-module mocks of session +
// audit + service-role client.

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

// ── Imports of the SUT and mocked modules ──────────────────────────────────

import { recordAudit } from "@/lib/auth/audit";
import { requireStudioSession, type StudioViewer } from "@/lib/auth/session";
import { createSupabaseServiceRoleClient } from "@/lib/db/admin";

import {
  archiveSupplyType,
  createSupplyTypeForPicker,
  reactivateSupplyType,
  renameSupplyType,
  type CreateResult,
} from "@/app/(studio)/settings/policy/actions";

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
    display_name: "Sam Tran",
    role: "technician",
    color_token: "--avatar-sage",
  },
};

const VALID_UUID = "10000000-0000-0000-0000-000000000001";

function formWith(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
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

type SupplyTypeRow = {
  id: string;
  name: string;
  archived: boolean;
};

type AdminMockOpts = {
  // Row returned by `supply_types.select().eq("id", ...).maybeSingle()`.
  supplyTypeRow?: Partial<SupplyTypeRow> | null;
  supplyTypeLoadError?: { code?: string; message?: string } | null;
  // INSERT into supply_types (createSupplyType impl).
  insertedRow?: Partial<SupplyTypeRow>;
  insertError?: { code?: string; message?: string } | null;
  // UPDATE supply_types.
  updateError?: { code?: string; message?: string } | null;
  // services.select count for archive pre-check.
  serviceUsageCount?: number;
  serviceUsageError?: { code?: string; message?: string } | null;
};

type MockHandle = {
  inserts: Array<Record<string, unknown>>;
  updates: Array<Record<string, unknown>>;
  serviceCountFilters: Array<Record<string, unknown>>;
};

const DEFAULT_SUPPLY_TYPE: SupplyTypeRow = {
  id: VALID_UUID,
  name: "Chrome powder",
  archived: false,
};

function mockAdminClient(opts: AdminMockOpts = {}): MockHandle {
  const inserts: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const serviceCountFilters: Array<Record<string, unknown>> = [];

  const supplyTypeRow: SupplyTypeRow | null =
    opts.supplyTypeRow === null ? null : { ...DEFAULT_SUPPLY_TYPE, ...(opts.supplyTypeRow ?? {}) };

  const supplyTypesTable = () => ({
    insert(row: Record<string, unknown>) {
      inserts.push(row);
      return {
        select() {
          return {
            single: async () => {
              if (opts.insertError) {
                return { data: null, error: opts.insertError };
              }
              const inserted: SupplyTypeRow = {
                id: VALID_UUID,
                archived: false,
                ...(opts.insertedRow ?? {}),
                name: (opts.insertedRow?.name ?? row.name) as string,
              };
              return { data: inserted, error: null };
            },
          };
        },
      };
    },
    select() {
      return {
        eq() {
          return {
            maybeSingle: async () => {
              if (opts.supplyTypeLoadError) {
                return { data: null, error: opts.supplyTypeLoadError };
              }
              return { data: supplyTypeRow, error: null };
            },
          };
        },
      };
    },
    update(row: Record<string, unknown>) {
      updates.push(row);
      return {
        eq() {
          return Promise.resolve({ error: opts.updateError ?? null });
        },
      };
    },
  });

  // services.select("id", { count: "exact", head: true }).eq(...).eq(...)
  const servicesTable = () => ({
    select(_cols: string, _opts: Record<string, unknown>) {
      const filters: Record<string, unknown> = {};
      const chain = {
        eq(col: string, val: unknown) {
          filters[col] = val;
          return chain;
        },
        // Awaited terminal — Supabase returns the count after the last eq.
        then(
          onFulfilled?: (result: {
            count: number | null;
            error: { code?: string; message?: string } | null;
          }) => unknown
        ) {
          serviceCountFilters.push(filters);
          const result = {
            count: opts.serviceUsageError ? null : (opts.serviceUsageCount ?? 0),
            error: opts.serviceUsageError ?? null,
          };
          return Promise.resolve(onFulfilled ? onFulfilled(result) : result);
        },
      };
      return chain;
    },
  });

  (createSupabaseServiceRoleClient as unknown as Mocked<() => unknown>).mockReturnValue({
    from(table: string) {
      if (table === "supply_types") return supplyTypesTable();
      if (table === "services") return servicesTable();
      throw new Error(`Unexpected table: ${table}`);
    },
  });

  return { inserts, updates, serviceCountFilters };
}

beforeEach(() => {
  vi.clearAllMocks();
  (requireStudioSession as unknown as Mocked<() => Promise<StudioViewer>>).mockResolvedValue(
    OWNER_VIEWER
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ──────────────────────────────────────────────────────────────────────────
// createSupplyTypeForPicker — covers e2e `US1 (b) inline-create commits …`.
// ──────────────────────────────────────────────────────────────────────────

describe("createSupplyTypeForPicker", () => {
  it("happy path: INSERTs the trimmed name, audits supply_type.created, returns { kind: 'ok' }", async () => {
    const { inserts } = mockAdminClient({
      insertedRow: { id: "11111111-0000-0000-0000-000000000001", name: "Hot pink gel" },
    });

    const result = await createSupplyTypeForPicker(
      { kind: "idle" } as CreateResult,
      formWith({ name: "  Hot   pink   gel  " })
    );

    expect(inserts).toEqual([{ name: "Hot pink gel" }]);

    expect(recordAudit).toHaveBeenCalledTimes(1);
    const auditCall = (recordAudit as unknown as Mocked<() => unknown>).mock.calls[0];
    expect(auditCall[0]).toBe("supply_type.created");
    expect(auditCall[1]).toBe(OWNER_VIEWER.deviceUserId);
    expect(auditCall[2]).toBe("11111111-0000-0000-0000-000000000001");
    expect(auditCall[3]).toEqual({ name: "Hot pink gel" });
    expect(auditCall[4]).toBe(OWNER_VIEWER.staff.id);

    expect(result).toEqual({
      kind: "ok",
      id: "11111111-0000-0000-0000-000000000001",
      name: "Hot pink gel",
    });
  });

  it("PG 23505 (canonical collision) maps to { kind: 'error', code: 'name_taken' } with no audit", async () => {
    mockAdminClient({ insertError: { code: "23505", message: "duplicate key" } });

    const result = await createSupplyTypeForPicker(
      { kind: "idle" } as CreateResult,
      formWith({ name: "Chrome powder" })
    );

    expect(result).toEqual({ kind: "error", code: "name_taken" });
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("name shorter than 2 chars maps to { kind: 'error', code: 'name_too_short' } (no DB call)", async () => {
    const { inserts } = mockAdminClient();

    const result = await createSupplyTypeForPicker(
      { kind: "idle" } as CreateResult,
      formWith({ name: "A" })
    );

    expect(result).toEqual({ kind: "error", code: "name_too_short" });
    expect(inserts).toEqual([]);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("technician viewer returns { kind: 'error', code: 'forbidden' } (no DB call, no audit)", async () => {
    (requireStudioSession as unknown as Mocked<() => Promise<StudioViewer>>).mockResolvedValueOnce(
      TECH_VIEWER
    );
    const { inserts } = mockAdminClient();

    const result = await createSupplyTypeForPicker(
      { kind: "idle" } as CreateResult,
      formWith({ name: "Hot pink gel" })
    );

    expect(result).toEqual({ kind: "error", code: "forbidden" });
    expect(inserts).toEqual([]);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("manager viewer is allowed (writes are owner OR manager)", async () => {
    (requireStudioSession as unknown as Mocked<() => Promise<StudioViewer>>).mockResolvedValueOnce(
      MANAGER_VIEWER
    );
    mockAdminClient({ insertedRow: { name: "Manager-made" } });

    const result = await createSupplyTypeForPicker(
      { kind: "idle" } as CreateResult,
      formWith({ name: "Manager-made" })
    );

    expect(result.kind).toBe("ok");
    expect(recordAudit).toHaveBeenCalledTimes(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// renameSupplyType — covers e2e `US2 (a) renaming propagates …` and
// `US2 (d) successful rename writes exactly one supply_type.renamed audit row`.
// ──────────────────────────────────────────────────────────────────────────

describe("renameSupplyType", () => {
  it("happy path: UPDATEs name, audits supply_type.renamed with before/after, redirects ?toast=supply_type_renamed", async () => {
    const { updates } = mockAdminClient({
      supplyTypeRow: { id: VALID_UUID, name: "Chrome powder", archived: false },
    });

    let thrown: unknown;
    try {
      await renameSupplyType(formWith({ supply_type_id: VALID_UUID, name: "Holo chrome" }));
    } catch (err) {
      thrown = err;
    }

    expect(updates).toEqual([{ name: "Holo chrome" }]);

    expect(recordAudit).toHaveBeenCalledTimes(1);
    const auditCall = (recordAudit as unknown as Mocked<() => unknown>).mock.calls[0];
    expect(auditCall[0]).toBe("supply_type.renamed");
    expect(auditCall[1]).toBe(OWNER_VIEWER.deviceUserId);
    expect(auditCall[2]).toBe(VALID_UUID);
    expect(auditCall[3]).toEqual({
      before: { name: "Chrome powder" },
      after: { name: "Holo chrome" },
    });
    expect(auditCall[4]).toBe(OWNER_VIEWER.staff.id);

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("/services?policy=open");
    expect(url).toContain("toast=supply_type_renamed");
  });

  it("no-change rename (canonically equal) short-circuits with ?error=no_changes, no audit, no UPDATE", async () => {
    const { updates } = mockAdminClient({
      supplyTypeRow: { id: VALID_UUID, name: "Chrome powder", archived: false },
    });

    let thrown: unknown;
    try {
      // Different casing + extra whitespace → same canonical form.
      await renameSupplyType(formWith({ supply_type_id: VALID_UUID, name: "  CHROME   POWDER  " }));
    } catch (err) {
      thrown = err;
    }

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=no_changes");
    expect(updates).toEqual([]);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("archived target → ?error=type_archived (no UPDATE, no audit)", async () => {
    const { updates } = mockAdminClient({
      supplyTypeRow: { id: VALID_UUID, name: "Chrome powder", archived: true },
    });

    let thrown: unknown;
    try {
      await renameSupplyType(formWith({ supply_type_id: VALID_UUID, name: "New name" }));
    } catch (err) {
      thrown = err;
    }

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=type_archived");
    expect(updates).toEqual([]);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("missing target → ?error=type_not_found", async () => {
    mockAdminClient({ supplyTypeRow: null });

    let thrown: unknown;
    try {
      await renameSupplyType(formWith({ supply_type_id: VALID_UUID, name: "Anything" }));
    } catch (err) {
      thrown = err;
    }

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=type_not_found");
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("PG 23505 on UPDATE → ?error=name_taken (no audit)", async () => {
    mockAdminClient({
      supplyTypeRow: { id: VALID_UUID, name: "Chrome powder", archived: false },
      updateError: { code: "23505", message: "duplicate key" },
    });

    let thrown: unknown;
    try {
      await renameSupplyType(formWith({ supply_type_id: VALID_UUID, name: "Other type" }));
    } catch (err) {
      thrown = err;
    }

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=name_taken");
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("technician viewer → ?error=forbidden (no DB work, no audit)", async () => {
    (requireStudioSession as unknown as Mocked<() => Promise<StudioViewer>>).mockResolvedValueOnce(
      TECH_VIEWER
    );
    const { updates } = mockAdminClient();

    let thrown: unknown;
    try {
      await renameSupplyType(formWith({ supply_type_id: VALID_UUID, name: "New name" }));
    } catch (err) {
      thrown = err;
    }

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=forbidden");
    expect(updates).toEqual([]);
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// archiveSupplyType — covers e2e `US3 (b) after the last reference is
// removed, archive succeeds …` and `US3 (e) archive audit row shape`.
// Includes the usage-count pre-check that gates the action.
// ──────────────────────────────────────────────────────────────────────────

describe("archiveSupplyType", () => {
  it("happy path (usage_count=0): UPDATEs archived=true, audits supply_type.archived, redirects ?toast=supply_type_archived&name=…", async () => {
    const { updates, serviceCountFilters } = mockAdminClient({
      supplyTypeRow: { id: VALID_UUID, name: "Cat-eye gel", archived: false },
      serviceUsageCount: 0,
    });

    let thrown: unknown;
    try {
      await archiveSupplyType(formWith({ supply_type_id: VALID_UUID }));
    } catch (err) {
      thrown = err;
    }

    // Pre-check ran against services scoped by supply_type_id + active=true.
    expect(serviceCountFilters).toEqual([{ supply_type_id: VALID_UUID, active: true }]);

    expect(updates).toEqual([{ archived: true }]);

    expect(recordAudit).toHaveBeenCalledTimes(1);
    const auditCall = (recordAudit as unknown as Mocked<() => unknown>).mock.calls[0];
    expect(auditCall[0]).toBe("supply_type.archived");
    expect(auditCall[1]).toBe(OWNER_VIEWER.deviceUserId);
    expect(auditCall[2]).toBe(VALID_UUID);
    expect(auditCall[3]).toEqual({ name: "Cat-eye gel" });
    expect(auditCall[4]).toBe(OWNER_VIEWER.staff.id);

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("toast=supply_type_archived");
    expect(url).toContain(`name=${encodeURIComponent("Cat-eye gel")}`);
  });

  it("usage_count > 0 → ?error=type_in_use&blocked_count=N (no UPDATE, no audit)", async () => {
    const { updates } = mockAdminClient({
      supplyTypeRow: { id: VALID_UUID, name: "Cat-eye gel", archived: false },
      serviceUsageCount: 3,
    });

    let thrown: unknown;
    try {
      await archiveSupplyType(formWith({ supply_type_id: VALID_UUID }));
    } catch (err) {
      thrown = err;
    }

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=type_in_use");
    expect(url).toContain("blocked_count=3");
    expect(updates).toEqual([]);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("already-archived target → ?error=type_already_archived (no pre-check, no UPDATE, no audit)", async () => {
    const { updates, serviceCountFilters } = mockAdminClient({
      supplyTypeRow: { id: VALID_UUID, name: "Cat-eye gel", archived: true },
    });

    let thrown: unknown;
    try {
      await archiveSupplyType(formWith({ supply_type_id: VALID_UUID }));
    } catch (err) {
      thrown = err;
    }

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=type_already_archived");
    expect(serviceCountFilters).toEqual([]);
    expect(updates).toEqual([]);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("missing target → ?error=type_not_found (no pre-check, no UPDATE, no audit)", async () => {
    mockAdminClient({ supplyTypeRow: null });

    let thrown: unknown;
    try {
      await archiveSupplyType(formWith({ supply_type_id: VALID_UUID }));
    } catch (err) {
      thrown = err;
    }

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=type_not_found");
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("technician viewer → ?error=forbidden (no DB work)", async () => {
    (requireStudioSession as unknown as Mocked<() => Promise<StudioViewer>>).mockResolvedValueOnce(
      TECH_VIEWER
    );
    mockAdminClient();

    let thrown: unknown;
    try {
      await archiveSupplyType(formWith({ supply_type_id: VALID_UUID }));
    } catch (err) {
      thrown = err;
    }

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=forbidden");
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// reactivateSupplyType — covers e2e `US3 (d) reactivate restores …` and
// `US3 (f) reactivate audit row shape`.
// ──────────────────────────────────────────────────────────────────────────

describe("reactivateSupplyType", () => {
  it("happy path: UPDATEs archived=false, audits supply_type.reactivated, redirects ?toast=supply_type_reactivated&name=…", async () => {
    const { updates } = mockAdminClient({
      supplyTypeRow: { id: VALID_UUID, name: "Cat-eye gel", archived: true },
    });

    let thrown: unknown;
    try {
      await reactivateSupplyType(formWith({ supply_type_id: VALID_UUID }));
    } catch (err) {
      thrown = err;
    }

    expect(updates).toEqual([{ archived: false }]);

    expect(recordAudit).toHaveBeenCalledTimes(1);
    const auditCall = (recordAudit as unknown as Mocked<() => unknown>).mock.calls[0];
    expect(auditCall[0]).toBe("supply_type.reactivated");
    expect(auditCall[1]).toBe(OWNER_VIEWER.deviceUserId);
    expect(auditCall[2]).toBe(VALID_UUID);
    expect(auditCall[3]).toEqual({ name: "Cat-eye gel" });
    expect(auditCall[4]).toBe(OWNER_VIEWER.staff.id);

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("toast=supply_type_reactivated");
    expect(url).toContain(`name=${encodeURIComponent("Cat-eye gel")}`);
  });

  it("already-active target → ?error=type_already_active (no UPDATE, no audit)", async () => {
    const { updates } = mockAdminClient({
      supplyTypeRow: { id: VALID_UUID, name: "Cat-eye gel", archived: false },
    });

    let thrown: unknown;
    try {
      await reactivateSupplyType(formWith({ supply_type_id: VALID_UUID }));
    } catch (err) {
      thrown = err;
    }

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=type_already_active");
    expect(updates).toEqual([]);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("PG 23505 on reactivate (canonical collision with active row) → ?error=name_taken (no audit)", async () => {
    mockAdminClient({
      supplyTypeRow: { id: VALID_UUID, name: "Cat-eye gel", archived: true },
      updateError: { code: "23505", message: "duplicate key" },
    });

    let thrown: unknown;
    try {
      await reactivateSupplyType(formWith({ supply_type_id: VALID_UUID }));
    } catch (err) {
      thrown = err;
    }

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=name_taken");
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("missing target → ?error=type_not_found", async () => {
    mockAdminClient({ supplyTypeRow: null });

    let thrown: unknown;
    try {
      await reactivateSupplyType(formWith({ supply_type_id: VALID_UUID }));
    } catch (err) {
      thrown = err;
    }

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=type_not_found");
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("technician viewer → ?error=forbidden (no DB work, no audit)", async () => {
    (requireStudioSession as unknown as Mocked<() => Promise<StudioViewer>>).mockResolvedValueOnce(
      TECH_VIEWER
    );
    mockAdminClient();

    let thrown: unknown;
    try {
      await reactivateSupplyType(formWith({ supply_type_id: VALID_UUID }));
    } catch (err) {
      thrown = err;
    }

    const url = redirectUrlFrom(thrown);
    expect(url).toContain("error=forbidden");
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
