import { describe, expect, it, vi } from "vitest";

import type { SummarizeTicket } from "@/lib/dashboard/aggregate";
import {
  bucketSummaries,
  queryDashboardSummaries,
  queryLastSaleTime,
  queryStaffRoster,
  queryTodayFeed,
} from "@/lib/dashboard/queries";

// ── Mock supabase surface ─────────────────────────────────────────────────
// A tiny query-recorder shim that captures `.select(...)`, `.eq(...)`,
// `.gte(...)`, `.lte(...)`, `.in(...)`, `.order(...)` calls so we can assert
// the filters used by each helper, then resolves to whatever `data` payload
// we hand the constructor.

type Recorded = {
  table: string;
  select?: string;
  eqs: Array<[string, unknown]>;
  gtes: Array<[string, unknown]>;
  ltes: Array<[string, unknown]>;
  ins: Array<[string, unknown[]]>;
  orders: Array<[string, { ascending?: boolean } | undefined]>;
  limit?: number;
};

function makeMockClient(handlers: Record<string, (rec: Recorded) => unknown>) {
  const records: Recorded[] = [];

  function chain(table: string) {
    const rec: Recorded = {
      table,
      eqs: [],
      gtes: [],
      ltes: [],
      ins: [],
      orders: [],
    };
    records.push(rec);

    const api: Record<string, unknown> = {};
    const ret = () => api;

    api.select = (cols: string) => {
      rec.select = cols;
      return ret();
    };
    api.eq = (col: string, val: unknown) => {
      rec.eqs.push([col, val]);
      return ret();
    };
    api.gte = (col: string, val: unknown) => {
      rec.gtes.push([col, val]);
      return ret();
    };
    api.lte = (col: string, val: unknown) => {
      rec.ltes.push([col, val]);
      return ret();
    };
    api.in = (col: string, vals: unknown[]) => {
      rec.ins.push([col, vals]);
      return ret();
    };
    api.order = (col: string, opts?: { ascending?: boolean }) => {
      rec.orders.push([col, opts]);
      return ret();
    };
    api.limit = (n: number) => {
      rec.limit = n;
      return ret();
    };
    // Make every chain awaitable (resolves to {data, error}).
    api.then = (onFulfilled: (v: { data: unknown; error: null }) => unknown) => {
      const data = handlers[table]?.(rec) ?? [];
      return Promise.resolve({ data, error: null }).then(onFulfilled);
    };
    return api;
  }

  return {
    client: {
      from(table: string) {
        return chain(table);
      },
    },
    records,
  };
}

const LA = "America/Los_Angeles";

describe("queryDashboardSummaries", () => {
  it("(a) scans tickets ONCE over the month window (status=paid, [month_start, now]) and returns empty summaries on no rows", async () => {
    const { client, records } = makeMockClient({
      tickets: () => [],
      ticket_items: () => [],
      payments: () => [],
    });
    const now = new Date("2026-05-16T22:14:00.000Z");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await queryDashboardSummaries(client as any, LA, now);

    // All three periods come back as empty summaries.
    expect(out.today.count).toBe(0);
    expect(out.week.count).toBe(0);
    expect(out.month.count).toBe(0);
    expect(out.today.byMethod).toEqual({ card: 0, cash: 0, gift: 0 });

    // Exactly one tickets scan, bounded by the month window — NOT three.
    const ticketsRecs = records.filter((r) => r.table === "tickets");
    expect(ticketsRecs.length).toBe(1);
    expect(ticketsRecs[0].eqs).toContainEqual(["status", "paid"]);
    // month_start = 2026-05-01T07:00:00.000Z (per period-windows tests)
    expect(ticketsRecs[0].gtes).toContainEqual(["closed_at", "2026-05-01T07:00:00.000Z"]);
    expect(ticketsRecs[0].ltes).toContainEqual(["closed_at", now.toISOString()]);
  });

  it("(b) on a non-empty month, issues ONE ticket scan + ONE items + ONE payments scan (not 3× each)", async () => {
    const tickets = [
      {
        id: "t1",
        status: "paid",
        subtotal_cents: 5000,
        tax_cents: 0,
        total_cents: 5000,
        closed_at: "2026-05-16T20:00:00.000Z",
      },
    ];
    const { client, records } = makeMockClient({
      tickets: () => tickets,
      ticket_items: () => [],
      payments: () => [],
    });
    const now = new Date("2026-05-16T22:14:00.000Z");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await queryDashboardSummaries(client as any, LA, now);
    expect(records.filter((r) => r.table === "tickets").length).toBe(1);
    expect(records.filter((r) => r.table === "ticket_items").length).toBe(1);
    expect(records.filter((r) => r.table === "payments").length).toBe(1);
  });
});

describe("bucketSummaries — window-edge boundaries", () => {
  const LA_NOW = new Date("2026-05-16T22:14:00.000Z");
  // Per the period-windows tests, in America/Los_Angeles at this `now`:
  //   today_start = 2026-05-16T07:00:00.000Z
  //   week_start  = 2026-05-11T07:00:00.000Z  (most recent Monday)
  //   month_start = 2026-05-01T07:00:00.000Z

  function paidTicket(id: string, closed_at: string): SummarizeTicket {
    return {
      id,
      status: "paid",
      subtotal_cents: 10000,
      tax_cents: 0,
      total_cents: 10000,
      closed_at,
    };
  }

  it("(g) a sale exactly at a window start lands INSIDE that window (inclusive lower bound)", () => {
    const tickets: SummarizeTicket[] = [
      paidTicket("today_edge", "2026-05-16T07:00:00.000Z"), // == today_start → today, week, month
      paidTicket("today_before", "2026-05-16T06:59:59.999Z"), // just before today → week, month
      paidTicket("week_edge", "2026-05-11T07:00:00.000Z"), // == week_start → week, month
      paidTicket("week_before", "2026-05-11T06:59:59.999Z"), // just before week → month only
      paidTicket("month_edge", "2026-05-01T07:00:00.000Z"), // == month_start → month only
    ];

    const out = bucketSummaries(LA, LA_NOW, tickets, [], []);

    // Counts nest: today ⊂ week ⊂ month.
    expect(out.today.count).toBe(1);
    expect(out.week.count).toBe(3);
    expect(out.month.count).toBe(5);

    // Subtotal aggregates per bucket ($100 each).
    expect(out.today.subtotal).toBe(100);
    expect(out.week.subtotal).toBe(300);
    expect(out.month.subtotal).toBe(500);

    // Period labels are carried through correctly.
    expect(out.today.period).toBe("today");
    expect(out.week.period).toBe("week");
    expect(out.month.period).toBe("month");
  });

  it("(h) empty month rows → all three buckets are empty summaries", () => {
    const out = bucketSummaries(LA, LA_NOW, [], [], []);
    expect(out.today.count).toBe(0);
    expect(out.week.count).toBe(0);
    expect(out.month.count).toBe(0);
  });
});

describe("queryTodayFeed", () => {
  it("(d) returns rows sorted closed_at desc, with projected serviceLabel, techIds, and method='split' for multi-method tickets", async () => {
    const tickets = [
      {
        id: "t1",
        status: "paid",
        closed_at: "2026-05-16T22:14:00.000Z",
        total_cents: 6000,
        subtotal_cents: 6000,
        tax_cents: 0,
      },
      {
        id: "t2",
        status: "paid",
        closed_at: "2026-05-16T20:00:00.000Z",
        total_cents: 8000,
        subtotal_cents: 8000,
        tax_cents: 0,
      },
    ];
    const items = [
      // t1: 2 service items + 1 discount
      {
        ticket_id: "t1",
        kind: "service",
        qty: 1,
        name_snapshot: "Mani",
        assigned_staff_id: "sA",
        unit_price_cents: 3000,
      },
      {
        ticket_id: "t1",
        kind: "service",
        qty: 1,
        name_snapshot: "Pedi",
        assigned_staff_id: "sB",
        unit_price_cents: 3000,
      },
      {
        ticket_id: "t1",
        kind: "discount",
        qty: 1,
        name_snapshot: "Loyalty",
        assigned_staff_id: null,
        unit_price_cents: -500,
      },
      // t2: 1 service (single tech)
      {
        ticket_id: "t2",
        kind: "service",
        qty: 1,
        name_snapshot: "Mani",
        assigned_staff_id: "sA",
        unit_price_cents: 8000,
      },
    ];
    const payments = [
      // t1 is a split-tender (cash + card both succeeded)
      {
        ticket_id: "t1",
        method: "cash",
        status: "succeeded",
        amount_cents: 3000,
        tip_cents: 0,
        processed_at: "2026-05-16T22:14:00.000Z",
      },
      {
        ticket_id: "t1",
        method: "card",
        status: "succeeded",
        amount_cents: 3000,
        tip_cents: 0,
        processed_at: "2026-05-16T22:15:00.000Z",
      },
      // t2 is a single-method ticket
      {
        ticket_id: "t2",
        method: "gift",
        status: "succeeded",
        amount_cents: 8000,
        tip_cents: 0,
        processed_at: "2026-05-16T20:00:00.000Z",
      },
    ];
    const { client } = makeMockClient({
      tickets: () => tickets,
      ticket_items: () => items,
      payments: () => payments,
    });
    const now = new Date("2026-05-16T22:14:00.000Z");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const feed = await queryTodayFeed(client as any, LA, now);
    expect(feed.length).toBe(2);
    // Sorted closed_at desc
    expect(feed[0].id).toBe("t1");
    expect(feed[1].id).toBe("t2");
    // t1 has 2 service items → "Mani, Pedi"
    expect(feed[0].serviceLabel).toBe("Mani, Pedi");
    // t1's techIds drawn from non-discount items, unique, in first-occurrence order
    expect(feed[0].techIds).toEqual(["sA", "sB"]);
    // t1 has two distinct succeeded payment methods → split
    expect(feed[0].method).toBe("split");
    // t2 has one single method
    expect(feed[1].method).toBe("gift");
    expect(feed[1].techIds).toEqual(["sA"]);
  });
});

describe("queryLastSaleTime", () => {
  it("(e) returns max processed_at across today's succeeded payments, or null when empty", async () => {
    const { client } = makeMockClient({
      payments: () => [
        { processed_at: "2026-05-16T20:00:00.000Z" },
        { processed_at: "2026-05-16T22:14:00.000Z" }, // max
        { processed_at: "2026-05-16T18:30:00.000Z" },
      ],
    });
    const now = new Date("2026-05-16T22:14:00.000Z");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const last = await queryLastSaleTime(client as any, LA, now);
    expect(last).not.toBeNull();
    expect(last!.toISOString()).toBe("2026-05-16T22:14:00.000Z");
  });

  it("returns null when no succeeded payments today", async () => {
    const { client } = makeMockClient({ payments: () => [] });
    const now = new Date("2026-05-16T22:14:00.000Z");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const last = await queryLastSaleTime(client as any, LA, now);
    expect(last).toBeNull();
  });
});

describe("queryStaffRoster", () => {
  it("(f) selects id, display_name, color_token for active=true rows and projects to Technician shape", async () => {
    const { client, records } = makeMockClient({
      staff: () => [
        { id: "s1", display_name: "Maya P.", color_token: "--avatar-rose" },
        { id: "s2", display_name: "Linh T.", color_token: "--avatar-amber" },
      ],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const roster = await queryStaffRoster(client as any);
    expect(roster).toEqual([
      { id: "s1", displayName: "Maya P.", colorToken: "--avatar-rose" },
      { id: "s2", displayName: "Linh T.", colorToken: "--avatar-amber" },
    ]);
    const rec = records.find((r) => r.table === "staff");
    expect(rec!.eqs).toContainEqual(["active", true]);
    expect(rec!.select).toContain("id");
    expect(rec!.select).toContain("display_name");
    expect(rec!.select).toContain("color_token");
  });
});

// Silence unused-import lints for vi if not used elsewhere.
void vi;
