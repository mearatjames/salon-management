import { describe, expect, it } from "vitest";

import { summarizeRows, type SummarizeInput } from "@/lib/dashboard/aggregate";

function emptyExpected(period: "today" | "week" | "month") {
  return {
    period,
    count: 0,
    services: 0,
    subtotal: 0,
    tip: 0,
    tax: 0,
    total: 0,
    byMethod: { card: 0, cash: 0, gift: 0 },
    avgServicesPerSale: 0,
    tipPctAvg: 0,
  };
}

describe("summarizeRows", () => {
  it("(a) empty input returns the empty-summary shape", () => {
    const input: SummarizeInput = { tickets: [], items: [], payments: [] };
    expect(summarizeRows(input, "today")).toEqual(emptyExpected("today"));
    expect(summarizeRows(input, "week")).toEqual(emptyExpected("week"));
    expect(summarizeRows(input, "month")).toEqual(emptyExpected("month"));
  });

  it("(b) one ticket with two service items + one discount item — services excludes the discount; revenue is payment amount + tip", () => {
    const input: SummarizeInput = {
      tickets: [
        {
          id: "t1",
          status: "paid",
          subtotal_cents: 6000,
          tax_cents: 0,
          total_cents: 6000,
          closed_at: "2026-05-16T22:00:00.000Z",
        },
      ],
      items: [
        {
          ticket_id: "t1",
          kind: "service",
          qty: 1,
          name_snapshot: "Mani",
          assigned_staff_id: "s1",
          unit_price_cents: 3000,
        },
        {
          ticket_id: "t1",
          kind: "service",
          qty: 1,
          name_snapshot: "Pedi",
          assigned_staff_id: "s1",
          unit_price_cents: 4000,
        },
        {
          ticket_id: "t1",
          kind: "discount",
          qty: 1,
          name_snapshot: "Loyalty",
          assigned_staff_id: null,
          unit_price_cents: -1000,
        },
      ],
      payments: [
        {
          ticket_id: "t1",
          method: "card",
          status: "succeeded",
          amount_cents: 6000,
          tip_cents: 1200,
        },
      ],
    };
    const out = summarizeRows(input, "today");
    expect(out.count).toBe(1);
    expect(out.services).toBe(2); // discount excluded
    expect(out.total).toBe(60 + 12); // (amount + tip) / 100 = $72
    expect(out.tip).toBe(12);
    expect(out.byMethod).toEqual({ card: 60 + 12, cash: 0, gift: 0 });
  });

  it("(c) two paid tickets with a status='failed' payment row mixed in — failed payment excluded from Revenue/Tips/byMethod", () => {
    const input: SummarizeInput = {
      tickets: [
        {
          id: "t1",
          status: "paid",
          subtotal_cents: 4000,
          tax_cents: 0,
          total_cents: 4000,
          closed_at: "2026-05-16T22:00:00.000Z",
        },
        {
          id: "t2",
          status: "paid",
          subtotal_cents: 5000,
          tax_cents: 0,
          total_cents: 5000,
          closed_at: "2026-05-16T22:15:00.000Z",
        },
      ],
      items: [
        {
          ticket_id: "t1",
          kind: "service",
          qty: 1,
          name_snapshot: "Mani",
          assigned_staff_id: "s1",
          unit_price_cents: 4000,
        },
        {
          ticket_id: "t2",
          kind: "service",
          qty: 1,
          name_snapshot: "Pedi",
          assigned_staff_id: "s1",
          unit_price_cents: 5000,
        },
      ],
      payments: [
        {
          ticket_id: "t1",
          method: "cash",
          status: "succeeded",
          amount_cents: 4000,
          tip_cents: 800,
        },
        { ticket_id: "t2", method: "card", status: "failed", amount_cents: 5000, tip_cents: 1000 },
        {
          ticket_id: "t2",
          method: "card",
          status: "succeeded",
          amount_cents: 5000,
          tip_cents: 500,
        },
      ],
    };
    const out = summarizeRows(input, "today");
    expect(out.count).toBe(2);
    // Revenue counts only succeeded payments + their tips.
    // t1: 4000 + 800 = 4800c → $48. t2: 5000 + 500 = 5500c → $55. Total = $103.
    expect(out.total).toBe(103);
    expect(out.tip).toBe(8 + 5); // $13
    expect(out.byMethod).toEqual({ card: 55, cash: 48, gift: 0 });
  });

  it("(d) split-tender ticket — byMethod.card and byMethod.cash both receive their respective amounts", () => {
    const input: SummarizeInput = {
      tickets: [
        {
          id: "t1",
          status: "paid",
          subtotal_cents: 8000,
          tax_cents: 0,
          total_cents: 8000,
          closed_at: "2026-05-16T22:00:00.000Z",
        },
      ],
      items: [
        {
          ticket_id: "t1",
          kind: "service",
          qty: 1,
          name_snapshot: "Mani",
          assigned_staff_id: "s1",
          unit_price_cents: 4000,
        },
        {
          ticket_id: "t1",
          kind: "service",
          qty: 1,
          name_snapshot: "Pedi",
          assigned_staff_id: "s1",
          unit_price_cents: 4000,
        },
      ],
      payments: [
        {
          ticket_id: "t1",
          method: "cash",
          status: "succeeded",
          amount_cents: 4000,
          tip_cents: 500,
        },
        {
          ticket_id: "t1",
          method: "card",
          status: "succeeded",
          amount_cents: 4000,
          tip_cents: 500,
        },
      ],
    };
    const out = summarizeRows(input, "today");
    expect(out.byMethod.cash).toBe(45); // 4000 + 500 = 4500c
    expect(out.byMethod.card).toBe(45);
    expect(out.byMethod.gift).toBe(0);
    expect(out.total).toBe(90);
  });
});
