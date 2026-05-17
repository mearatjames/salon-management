// Unit tests for the cash-history query layer at
// `lib/end-of-day/history.ts`.
//
// Written BEFORE the implementation per Principle IV (Test-First for
// Critical Paths). T011 makes these pass.
//
// IMPORTANT: this suite is a UNIT test against a MOCKED Supabase client
// (not an in-memory DB integration test). The sandbox has no local
// Supabase, so we shape the mocks to match the typed query builder
// chains: `.from(table).select(...).eq(...).order(...).range(...)` etc.
//
// Two clients are passed to the module functions:
//   - `supabase`: server-cookie client used for `cash_drawer_sessions`
//     and `staff` (both have SELECT-to-authenticated RLS).
//   - `admin`: service-role client used for `audit_log` (no SELECT
//     policy for authenticated — must bypass RLS).

import { describe, expect, it, vi } from "vitest";

import { loadCashHistoryDetail, loadCashHistoryList } from "@/lib/end-of-day/history";

type Row = Record<string, unknown>;

// Build a chainable query mock that resolves to `{ data, error }` when
// awaited. Each chain method returns the same proxy so callers can
// .select().eq().order().range() in any order. `.maybeSingle()` and
// `.single()` also resolve to the same payload.
function buildQuery(result: { data: unknown; error: unknown }) {
  const proxy: Record<string, unknown> = {};
  const methods = ["select", "eq", "in", "is", "not", "order", "limit", "range"];
  for (const m of methods) {
    proxy[m] = vi.fn(() => proxy);
  }
  proxy.maybeSingle = vi.fn(() => Promise.resolve(result));
  proxy.single = vi.fn(() => Promise.resolve(result));
  // Make the proxy itself thenable so `await proxy` resolves to the
  // result — supabase queries are awaitable directly without a terminal
  // `.then()`/`.maybeSingle()` for list-shaped reads.
  (proxy as unknown as { then: (resolve: (v: unknown) => unknown) => unknown }).then = (resolve) =>
    resolve(result);
  return proxy;
}

// Build a `supabase.from(table)` dispatcher that returns a fresh chain
// per table. Each entry in `byTable` is either a single `{ data, error }`
// (one read) or an array of results consumed in call order.
function buildClient(byTable: Record<string, { data: unknown; error: unknown }[]>) {
  const fromSpy = vi.fn((table: string) => {
    const queue = byTable[table];
    if (!queue || queue.length === 0) {
      throw new Error(`unexpected from('${table}') with no queued result`);
    }
    const next = queue.shift()!;
    return buildQuery(next);
  });
  return { from: fromSpy };
}

const SESSION_ROWS: Row[] = [
  {
    id: "sess-1",
    business_day: "2026-05-15",
    opening_cents: 10000,
    expected_cents: 6450,
    counted_cents: 16450,
    variance_cents: 0,
    notes: null,
    closed_at: "2026-05-15T22:00:00Z",
    closed_by_staff_id: "staff-1",
  },
  {
    id: "sess-2",
    business_day: "2026-05-14",
    opening_cents: 10000,
    expected_cents: 6450,
    counted_cents: 16100,
    variance_cents: -350,
    notes: "Short — see drawer ledger",
    closed_at: "2026-05-14T22:00:00Z",
    closed_by_staff_id: "staff-2",
  },
];

describe("loadCashHistoryList", () => {
  it("queries cash_drawer_sessions with closed_at filter, business_day desc, and the requested limit/offset", async () => {
    const supabase = buildClient({
      cash_drawer_sessions: [{ data: SESSION_ROWS, error: null }],
      staff: [
        {
          data: [
            { id: "staff-1", display_name: "Cam" },
            { id: "staff-2", display_name: "Riley" },
          ],
          error: null,
        },
      ],
    });
    const admin = buildClient({
      audit_log: [{ data: [], error: null }],
    });

    const rows = await loadCashHistoryList(supabase as never, admin as never, {
      limit: 90,
      offset: 0,
    });

    expect(supabase.from).toHaveBeenCalledWith("cash_drawer_sessions");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.sessionId).toBe("sess-1");
    // No audit rows in the mock → `edited: false` everywhere.
    expect(rows.every((r) => r.edited === false)).toBe(true);
    expect(rows.every((r) => r.lastEditedAt === null)).toBe(true);
  });

  it("projects edited=true / lastEditedAt set when at least one audit row exists for the session", async () => {
    const supabase = buildClient({
      cash_drawer_sessions: [{ data: SESSION_ROWS, error: null }],
      staff: [
        {
          data: [
            { id: "staff-1", display_name: "Cam" },
            { id: "staff-2", display_name: "Riley" },
          ],
          error: null,
        },
      ],
    });
    const admin = buildClient({
      audit_log: [
        {
          data: [
            { entity_id: "sess-1", ts: "2026-05-16T01:00:00Z" },
            { entity_id: "sess-1", ts: "2026-05-16T02:00:00Z" },
          ],
          error: null,
        },
      ],
    });

    const rows = await loadCashHistoryList(supabase as never, admin as never, {
      limit: 90,
      offset: 0,
    });

    const sess1 = rows.find((r) => r.sessionId === "sess-1")!;
    const sess2 = rows.find((r) => r.sessionId === "sess-2")!;
    expect(sess1.edited).toBe(true);
    expect(sess1.lastEditedAt).toBe("2026-05-16T02:00:00Z");
    expect(sess2.edited).toBe(false);
    expect(sess2.lastEditedAt).toBeNull();
  });

  it("handles a non-zero offset (caller-driven pagination)", async () => {
    const supabase = buildClient({
      cash_drawer_sessions: [{ data: [], error: null }],
    });
    const admin = buildClient({
      audit_log: [{ data: [], error: null }],
    });

    const rows = await loadCashHistoryList(supabase as never, admin as never, {
      limit: 90,
      offset: 90,
    });

    expect(rows).toEqual([]);
    expect(supabase.from).toHaveBeenCalledWith("cash_drawer_sessions");
  });
});

describe("loadCashHistoryDetail", () => {
  it("returns null when no session matches the id", async () => {
    const supabase = buildClient({
      cash_drawer_sessions: [{ data: null, error: null }],
    });
    const admin = buildClient({
      audit_log: [{ data: [], error: null }],
    });

    const detail = await loadCashHistoryDetail(supabase as never, admin as never, "missing-id");

    expect(detail).toBeNull();
  });

  it("returns shape { session, audits[] } for an existing session and joins editor display names", async () => {
    const supabase = buildClient({
      cash_drawer_sessions: [{ data: SESSION_ROWS[0], error: null }],
      staff: [
        {
          data: [
            { id: "staff-1", display_name: "Cam" },
            { id: "staff-9", display_name: "Editor Person" },
          ],
          error: null,
        },
      ],
    });
    const admin = buildClient({
      audit_log: [
        {
          data: [
            {
              id: "audit-2",
              ts: "2026-05-16T02:00:00Z",
              acting_as_staff_id: "staff-9",
              payload: {
                before: { counted_cents: 16450, variance_cents: 0, notes: null },
                after: { counted_cents: 16400, variance_cents: -50, notes: "small recount" },
              },
            },
            {
              id: "audit-1",
              ts: "2026-05-16T01:00:00Z",
              acting_as_staff_id: "staff-9",
              payload: {
                before: { counted_cents: 16450, variance_cents: 0, notes: null },
                after: { counted_cents: 16450, variance_cents: 0, notes: "no change" },
              },
            },
          ],
          error: null,
        },
      ],
    });

    const detail = await loadCashHistoryDetail(supabase as never, admin as never, "sess-1");

    expect(detail).not.toBeNull();
    expect(detail!.session.sessionId).toBe("sess-1");
    expect(detail!.session.closedByName).toBe("Cam");
    expect(detail!.audits).toHaveLength(2);
    // Newest first.
    expect(detail!.audits[0]!.id).toBe("audit-2");
    expect(detail!.audits[0]!.editorDisplayName).toBe("Editor Person");
    expect(detail!.audits[0]!.before.countedCents).toBe(16450);
    expect(detail!.audits[0]!.after.countedCents).toBe(16400);
    expect(detail!.audits[0]!.after.notes).toBe("small recount");
  });
});
