import { describe, expect, it } from "vitest";

import {
  computeKpis,
  deriveMethod,
  groupByDay,
  projectTransactions,
  type ProjectItemRow,
  type ProjectPaymentRow,
  type ProjectTicketRow,
  type TransactionDetail,
  type TransactionPayment,
} from "@/lib/transactions/aggregate";

const TZ = "America/Los_Angeles";

// A deeply-mutable view of the projector input so tests can `.push` extra rows
// onto the per-call fixture. `projectTransactions` accepts it structurally — it
// only reads the input.
type MutableInput = {
  tz: string;
  tickets: Array<{ -readonly [K in keyof ProjectTicketRow]: ProjectTicketRow[K] }>;
  items: Array<{ -readonly [K in keyof ProjectItemRow]: ProjectItemRow[K] }>;
  payments: Array<{ -readonly [K in keyof ProjectPaymentRow]: ProjectPaymentRow[K] }>;
  staff: Array<{ id: string; display_name: string; color_token: string }>;
  services: Array<{ id: string; category: string }>;
};

// ─── deriveMethod ────────────────────────────────────────────────────────────

function pay(method: TransactionPayment["method"], amount: number, tip = 0): TransactionPayment {
  return { method, amountCents: amount, tipCents: tip };
}

describe("deriveMethod", () => {
  it("single card payment → 'card'", () => {
    expect(deriveMethod([pay("card", 4500)])).toBe("card");
  });

  it("single cash payment → 'cash'", () => {
    expect(deriveMethod([pay("cash", 4500)])).toBe("cash");
  });

  it("single gift payment → 'gift'", () => {
    expect(deriveMethod([pay("gift", 4500)])).toBe("gift");
  });

  it("two distinct methods → 'split'", () => {
    expect(deriveMethod([pay("card", 3000), pay("cash", 1500)])).toBe("split");
  });

  it("three distinct methods → 'split'", () => {
    expect(deriveMethod([pay("card", 1000), pay("cash", 1000), pay("gift", 1000)])).toBe("split");
  });

  it("two payments of the SAME method → that single method (not split)", () => {
    expect(deriveMethod([pay("card", 3000), pay("card", 1500)])).toBe("card");
  });
});

// ─── projectTransactions ─────────────────────────────────────────────────────

const STAFF = [
  { id: "staff-maya", display_name: "Maya", color_token: "--tech-1" },
  { id: "staff-lena", display_name: "Lena", color_token: "--tech-2" },
];

const SERVICES = [
  { id: "svc-mani", category: "Manicure" },
  { id: "svc-pedi", category: "Pedicure" },
];

function baseInput(): MutableInput {
  return {
    tz: TZ,
    tickets: [
      {
        id: "ticket-0001",
        status: "paid",
        subtotal_cents: 6000,
        tax_cents: 0,
        total_cents: 6000,
        closed_at: "2026-05-16T21:30:00.000Z", // 2:30 PM PDT
        closed_by_staff_id: "staff-maya",
      },
    ],
    items: [
      {
        ticket_id: "ticket-0001",
        kind: "service",
        qty: 1,
        name_snapshot: "Gel manicure",
        assigned_staff_id: "staff-maya",
        unit_price_cents: 4000,
        ref_id: "svc-mani",
      },
      {
        ticket_id: "ticket-0001",
        kind: "service",
        qty: 1,
        name_snapshot: "Classic pedicure",
        assigned_staff_id: "staff-lena",
        unit_price_cents: 2000,
        ref_id: "svc-pedi",
      },
    ],
    payments: [
      {
        ticket_id: "ticket-0001",
        method: "card",
        status: "succeeded",
        amount_cents: 5400,
        tip_cents: 600,
      },
    ],
    staff: STAFF,
    services: SERVICES,
  };
}

describe("projectTransactions — single ticket", () => {
  it("projects a paid ticket into a TransactionDetail", () => {
    const [tx] = projectTransactions(baseInput());
    expect(tx.id).toBe("ticket-0001");
    // "ticket-0001" → strip hyphen → "ticket0001" → last 6 → "et0001" → "#ET0001"
    expect(tx.displayId).toBe("#ET0001");
    expect(tx.client).toBe("Walk-in");
    expect(tx.closedAtIso).toBe("2026-05-16T21:30:00.000Z");
    expect(tx.dayKey).toBe("2026-05-16");
    expect(tx.subtotalCents).toBe(6000);
    expect(tx.taxCents).toBe(0);
    expect(tx.tipCents).toBe(600);
    expect(tx.totalCents).toBe(6600); // subtotal + tax + tip
    expect(tx.serviceCount).toBe(2);
    expect(tx.method).toBe("card");
    expect(tx.cashierName).toBe("Maya");
  });

  it("collects line items with category resolved from services", () => {
    const [tx] = projectTransactions(baseInput());
    expect(tx.items).toHaveLength(2);
    const mani = tx.items.find((i) => i.name === "Gel manicure");
    expect(mani?.category).toBe("Manicure");
    expect(mani?.lineTotalCents).toBe(4000);
    expect(mani?.techId).toBe("staff-maya");
  });

  it("collects succeeded payments only", () => {
    const input = baseInput();
    input.payments.push({
      ticket_id: "ticket-0001",
      method: "cash",
      status: "failed",
      amount_cents: 999,
      tip_cents: 0,
    });
    const [tx] = projectTransactions(input);
    expect(tx.payments).toHaveLength(1);
    expect(tx.method).toBe("card"); // failed cash payment ignored, no split
  });

  it("dedupes techIds — distinct non-discount staff in first-seen order", () => {
    const input = baseInput();
    // add a third service line re-using Maya.
    input.items.push({
      ticket_id: "ticket-0001",
      kind: "service",
      qty: 1,
      name_snapshot: "Nail art",
      assigned_staff_id: "staff-maya",
      unit_price_cents: 1500,
      ref_id: null,
    });
    const [tx] = projectTransactions(input);
    expect(tx.techIds).toEqual(["staff-maya", "staff-lena"]);
  });

  it("excludes discount lines from techIds and serviceCount", () => {
    const input = baseInput();
    input.items.push({
      ticket_id: "ticket-0001",
      kind: "discount",
      qty: 1,
      name_snapshot: "Loyalty discount",
      assigned_staff_id: "staff-lena",
      unit_price_cents: -500,
      ref_id: null,
    });
    const [tx] = projectTransactions(input);
    expect(tx.serviceCount).toBe(2); // discount not counted
    expect(tx.techIds).toEqual(["staff-maya", "staff-lena"]); // discount staff not re-added
  });

  it("line-item category is null for non-service / unknown ref", () => {
    const input = baseInput();
    input.items.push({
      ticket_id: "ticket-0001",
      kind: "product",
      qty: 2,
      name_snapshot: "Cuticle oil",
      assigned_staff_id: null,
      unit_price_cents: 800,
      ref_id: null,
    });
    const [tx] = projectTransactions(input);
    const product = tx.items.find((i) => i.name === "Cuticle oil");
    expect(product?.category).toBeNull();
    expect(product?.lineTotalCents).toBe(1600); // unit * qty
  });

  it("derives 'split' when payments use two distinct methods", () => {
    const input = baseInput();
    input.payments = [
      {
        ticket_id: "ticket-0001",
        method: "card",
        status: "succeeded",
        amount_cents: 3000,
        tip_cents: 300,
      },
      {
        ticket_id: "ticket-0001",
        method: "cash",
        status: "succeeded",
        amount_cents: 2400,
        tip_cents: 300,
      },
    ];
    const [tx] = projectTransactions(input);
    expect(tx.method).toBe("split");
    expect(tx.tipCents).toBe(600); // tips summed across payments
  });

  it("cashierName is null when closed_by_staff_id is unknown", () => {
    const input = baseInput();
    input.tickets[0].closed_by_staff_id = null;
    const [tx] = projectTransactions(input);
    expect(tx.cashierName).toBeNull();
  });
});

describe("projectTransactions — multiple tickets, newest-first", () => {
  it("sorts transactions by closedAtIso descending", () => {
    const input = baseInput();
    input.tickets.push({
      id: "ticket-0002",
      status: "paid",
      subtotal_cents: 3000,
      tax_cents: 0,
      total_cents: 3000,
      closed_at: "2026-05-16T23:00:00.000Z", // later than ticket-0001
      closed_by_staff_id: "staff-lena",
    });
    input.items.push({
      ticket_id: "ticket-0002",
      kind: "service",
      qty: 1,
      name_snapshot: "Polish change",
      assigned_staff_id: "staff-lena",
      unit_price_cents: 3000,
      ref_id: "svc-mani",
    });
    input.payments.push({
      ticket_id: "ticket-0002",
      method: "cash",
      status: "succeeded",
      amount_cents: 3000,
      tip_cents: 0,
    });
    const txs = projectTransactions(input);
    expect(txs.map((t) => t.id)).toEqual(["ticket-0002", "ticket-0001"]);
  });
});

// ─── computeKpis ─────────────────────────────────────────────────────────────

function tx(partial: Partial<TransactionDetail>): TransactionDetail {
  return {
    id: "t",
    displayId: "#000000",
    client: "Walk-in",
    closedAtIso: "2026-05-16T21:00:00.000Z",
    time: "2:00 PM",
    dayKey: "2026-05-16",
    techIds: [],
    items: [],
    payments: [],
    method: "card",
    subtotalCents: 0,
    taxCents: 0,
    tipCents: 0,
    totalCents: 0,
    serviceCount: 0,
    cashierName: null,
    ...partial,
  };
}

describe("computeKpis", () => {
  it("empty set → all zeros", () => {
    const k = computeKpis([]);
    expect(k).toEqual({
      count: 0,
      grossRevenueCents: 0,
      servicesRendered: 0,
      tipsCents: 0,
      avgTicketCents: 0,
      avgServicesPerSale: 0,
    });
  });

  it("sums count, revenue, services, tips", () => {
    const k = computeKpis([
      tx({ totalCents: 6600, tipCents: 600, serviceCount: 2 }),
      tx({ totalCents: 3000, tipCents: 0, serviceCount: 1 }),
      tx({ totalCents: 5400, tipCents: 400, serviceCount: 3 }),
    ]);
    expect(k.count).toBe(3);
    expect(k.grossRevenueCents).toBe(15000);
    expect(k.servicesRendered).toBe(6);
    expect(k.tipsCents).toBe(1000);
  });

  it("computes averages over the count", () => {
    const k = computeKpis([
      tx({ totalCents: 10000, serviceCount: 2 }),
      tx({ totalCents: 5000, serviceCount: 1 }),
    ]);
    expect(k.avgTicketCents).toBe(7500);
    expect(k.avgServicesPerSale).toBe(1.5);
  });
});

// ─── groupByDay ──────────────────────────────────────────────────────────────

describe("groupByDay", () => {
  it("empty set → empty array", () => {
    expect(groupByDay([])).toEqual([]);
  });

  it("buckets transactions by dayKey", () => {
    const groups = groupByDay([
      tx({ id: "a", dayKey: "2026-05-16", totalCents: 6600, tipCents: 600 }),
      tx({ id: "b", dayKey: "2026-05-16", totalCents: 3000, tipCents: 0 }),
      tx({ id: "c", dayKey: "2026-05-15", totalCents: 5000, tipCents: 500 }),
    ]);
    expect(groups).toHaveLength(2);
    const may16 = groups.find((g) => g.dayKey === "2026-05-16");
    expect(may16?.count).toBe(2);
    expect(may16?.revenueCents).toBe(9600);
    expect(may16?.tipsCents).toBe(600);
  });

  it("orders groups by dayKey descending (newest day first)", () => {
    const groups = groupByDay([
      tx({ id: "a", dayKey: "2026-05-14" }),
      tx({ id: "b", dayKey: "2026-05-16" }),
      tx({ id: "c", dayKey: "2026-05-15" }),
    ]);
    expect(groups.map((g) => g.dayKey)).toEqual(["2026-05-16", "2026-05-15", "2026-05-14"]);
  });

  it("preserves input order (newest-first) within each day group", () => {
    const groups = groupByDay([
      tx({ id: "later", dayKey: "2026-05-16", closedAtIso: "2026-05-16T23:00:00.000Z" }),
      tx({ id: "earlier", dayKey: "2026-05-16", closedAtIso: "2026-05-16T21:00:00.000Z" }),
    ]);
    expect(groups[0].transactions.map((t) => t.id)).toEqual(["later", "earlier"]);
  });
});
