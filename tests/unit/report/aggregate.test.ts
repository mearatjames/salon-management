import { describe, expect, it } from "vitest";

import { DEFAULT_CARD_FEE_CENTS } from "@/lib/services/card-fee-default";
import {
  computeLineDeductions,
  effectiveCardFeeCents,
  projectReport,
  splitCardTip,
  type ProjectReportInput,
  type ReportItemRow,
  type ReportServiceRow,
  type ReportStaffRow,
} from "@/lib/report/aggregate";

const LA = "America/Los_Angeles";

// ─── effectiveCardFeeCents ───────────────────────────────────────────────────

describe("effectiveCardFeeCents", () => {
  it("a missing service → DEFAULT_CARD_FEE_CENTS (R12)", () => {
    expect(effectiveCardFeeCents(null)).toBe(DEFAULT_CARD_FEE_CENTS);
  });

  it("card_fee_mode 'default' → DEFAULT_CARD_FEE_CENTS", () => {
    expect(
      effectiveCardFeeCents({
        id: "s1",
        card_fee_mode: "default",
        card_fee_custom_cents: null,
        supply_amount_cents: null,
        supply_type_id: null,
      })
    ).toBe(DEFAULT_CARD_FEE_CENTS);
  });

  it("card_fee_mode 'exempt' → 0", () => {
    expect(
      effectiveCardFeeCents({
        id: "s1",
        card_fee_mode: "exempt",
        card_fee_custom_cents: null,
        supply_amount_cents: null,
        supply_type_id: null,
      })
    ).toBe(0);
  });

  it("card_fee_mode 'custom' → the custom cents", () => {
    expect(
      effectiveCardFeeCents({
        id: "s1",
        card_fee_mode: "custom",
        card_fee_custom_cents: 150,
        supply_amount_cents: null,
        supply_type_id: null,
      })
    ).toBe(150);
  });

  it("card_fee_mode 'custom' with null cents → 0", () => {
    expect(
      effectiveCardFeeCents({
        id: "s1",
        card_fee_mode: "custom",
        card_fee_custom_cents: null,
        supply_amount_cents: null,
        supply_type_id: null,
      })
    ).toBe(0);
  });
});

// ─── computeLineDeductions ───────────────────────────────────────────────────

function item(over: Partial<ReportItemRow> = {}): ReportItemRow {
  return {
    ticket_id: "tx1",
    kind: "service",
    ref_id: "svc1",
    name_snapshot: "Gel Manicure",
    unit_price_cents: 5000,
    qty: 1,
    assigned_staff_id: "tech1",
    ...over,
  };
}

function service(over: Partial<ReportServiceRow> = {}): ReportServiceRow {
  return {
    id: "svc1",
    card_fee_mode: "default",
    card_fee_custom_cents: null,
    supply_amount_cents: null,
    supply_type_id: null,
    ...over,
  };
}

function staff(over: Partial<ReportStaffRow> = {}): ReportStaffRow {
  return {
    id: "tech1",
    display_name: "Maya",
    color_token: "rose",
    card_fee_exempt: false,
    supply_mode: "apply",
    supply_except: [],
    ...over,
  };
}

describe("computeLineDeductions — card fee", () => {
  it("card-settled, non-exempt tech → per-qty default card fee + a card line", () => {
    const r = computeLineDeductions(item({ qty: 2 }), service(), staff(), true);
    expect(r.cardFeeCents).toBe(DEFAULT_CARD_FEE_CENTS * 2);
    expect(r.supplyCents).toBe(0);
    expect(r.lines).toEqual([
      { type: "card", serviceName: "Gel Manicure", amountCents: DEFAULT_CARD_FEE_CENTS * 2 },
    ]);
  });

  it("NOT card-settled → no card fee, no card line", () => {
    const r = computeLineDeductions(item(), service(), staff(), false);
    expect(r.cardFeeCents).toBe(0);
    expect(r.lines).toEqual([]);
  });

  it("card-fee-exempt tech → no card fee even when card-settled", () => {
    const r = computeLineDeductions(item(), service(), staff({ card_fee_exempt: true }), true);
    expect(r.cardFeeCents).toBe(0);
    expect(r.lines).toEqual([]);
  });

  it("custom service card fee is multiplied by qty", () => {
    const r = computeLineDeductions(
      item({ qty: 3 }),
      service({ card_fee_mode: "custom", card_fee_custom_cents: 100 }),
      staff(),
      true
    );
    expect(r.cardFeeCents).toBe(300);
  });

  it("exempt service card fee → 0, no line", () => {
    const r = computeLineDeductions(item(), service({ card_fee_mode: "exempt" }), staff(), true);
    expect(r.cardFeeCents).toBe(0);
    expect(r.lines).toEqual([]);
  });

  it("a missing service degrades to the default card fee", () => {
    const r = computeLineDeductions(item({ qty: 2 }), null, staff(), true);
    expect(r.cardFeeCents).toBe(DEFAULT_CARD_FEE_CENTS * 2);
  });
});

describe("computeLineDeductions — supply", () => {
  it("supply_mode 'apply' → per-qty supply deduction + a supply line", () => {
    const r = computeLineDeductions(
      item({ qty: 2 }),
      service({ supply_amount_cents: 400, supply_type_id: "sup1" }),
      staff({ supply_mode: "apply" }),
      false
    );
    expect(r.supplyCents).toBe(800);
    expect(r.lines).toEqual([{ type: "supply", serviceName: "Gel Manicure", amountCents: 800 }]);
  });

  it("supply_mode 'exempt' → no supply deduction", () => {
    const r = computeLineDeductions(
      item(),
      service({ supply_amount_cents: 400, supply_type_id: "sup1" }),
      staff({ supply_mode: "exempt" }),
      false
    );
    expect(r.supplyCents).toBe(0);
    expect(r.lines).toEqual([]);
  });

  it("supply_mode 'partial' applies supply when the type is NOT in supply_except", () => {
    const r = computeLineDeductions(
      item(),
      service({ supply_amount_cents: 400, supply_type_id: "sup1" }),
      staff({ supply_mode: "partial", supply_except: ["sup2"] }),
      false
    );
    expect(r.supplyCents).toBe(400);
  });

  it("supply_mode 'partial' skips supply when the type IS in supply_except", () => {
    const r = computeLineDeductions(
      item(),
      service({ supply_amount_cents: 400, supply_type_id: "sup1" }),
      staff({ supply_mode: "partial", supply_except: ["sup1"] }),
      false
    );
    expect(r.supplyCents).toBe(0);
    expect(r.lines).toEqual([]);
  });

  it("a service with no supply amount → no supply deduction", () => {
    const r = computeLineDeductions(
      item(),
      service({ supply_amount_cents: null, supply_type_id: null }),
      staff({ supply_mode: "apply" }),
      false
    );
    expect(r.supplyCents).toBe(0);
  });

  it("a missing service → supply treated as absent", () => {
    const r = computeLineDeductions(item(), null, staff({ supply_mode: "apply" }), false);
    expect(r.supplyCents).toBe(0);
  });
});

describe("computeLineDeductions — combined card + supply", () => {
  it("both apply → two lines, both per-qty", () => {
    const r = computeLineDeductions(
      item({ qty: 2 }),
      service({
        card_fee_mode: "custom",
        card_fee_custom_cents: 200,
        supply_amount_cents: 300,
        supply_type_id: "sup1",
      }),
      staff(),
      true
    );
    expect(r.cardFeeCents).toBe(400);
    expect(r.supplyCents).toBe(600);
    expect(r.lines).toHaveLength(2);
    expect(r.lines).toContainEqual({
      type: "card",
      serviceName: "Gel Manicure",
      amountCents: 400,
    });
    expect(r.lines).toContainEqual({
      type: "supply",
      serviceName: "Gel Manicure",
      amountCents: 600,
    });
  });
});

// ─── splitCardTip — largest-remainder method (Constitution IV) ───────────────

describe("splitCardTip", () => {
  it("Σ result === total for an even three-way split", () => {
    const r = splitCardTip(900, [1, 1, 1]);
    expect(r.reduce((a, b) => a + b, 0)).toBe(900);
    expect(r).toEqual([300, 300, 300]);
  });

  it("distributes leftover cents to the largest fractional remainders", () => {
    // 100 cents split by weights 1,1,1: 33.33 each → floors 33,33,33 = 99,
    // one leftover cent goes to the first largest remainder.
    const r = splitCardTip(100, [1, 1, 1]);
    expect(r.reduce((a, b) => a + b, 0)).toBe(100);
    expect(r.filter((x) => x === 34)).toHaveLength(1);
    expect(r.filter((x) => x === 33)).toHaveLength(2);
  });

  it("weighted split — larger weight gets the larger share, Σ exact", () => {
    const r = splitCardTip(1000, [3, 1]);
    expect(r.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(r[0]).toBeGreaterThan(r[1]);
    expect(r).toEqual([750, 250]);
  });

  it("a zero-weight technician gets a 0 share", () => {
    const r = splitCardTip(500, [1, 0, 1]);
    expect(r.reduce((a, b) => a + b, 0)).toBe(500);
    expect(r[1]).toBe(0);
  });

  it("all-zero weights (zero subtotal) → every share 0", () => {
    const r = splitCardTip(500, [0, 0, 0]);
    expect(r).toEqual([0, 0, 0]);
  });

  it("a zero total → every share 0", () => {
    const r = splitCardTip(0, [5, 3, 2]);
    expect(r).toEqual([0, 0, 0]);
  });

  it("an empty weights array → empty result", () => {
    expect(splitCardTip(0, [])).toEqual([]);
  });

  it("a single technician takes the whole tip", () => {
    expect(splitCardTip(777, [42])).toEqual([777]);
  });

  it("largest-remainder ties resolve deterministically (earliest index wins)", () => {
    // 5 cents, two equal weights → 2.5 each; floors 2,2 = 4, one leftover
    // goes to the earliest of the tied remainders.
    const r = splitCardTip(5, [1, 1]);
    expect(r.reduce((a, b) => a + b, 0)).toBe(5);
    expect(r).toEqual([3, 2]);
  });
});

// ─── projectReport ───────────────────────────────────────────────────────────

function input(over: Partial<ProjectReportInput> = {}): ProjectReportInput {
  return {
    tz: LA,
    tickets: [],
    items: [],
    payments: [],
    staff: [],
    services: [],
    ...over,
  };
}

describe("projectReport — empty input", () => {
  it("no tickets → empty read model with zeroed totals", () => {
    const r = projectReport(input());
    expect(r.isEmpty).toBe(true);
    expect(r.technicians).toEqual([]);
    expect(r.totals.transactionCount).toBe(0);
    expect(r.totals.grossCents).toBe(0);
    expect(r.totals.technicianCount).toBe(0);
  });
});

describe("projectReport — single tech, single cash transaction", () => {
  const model = projectReport(
    input({
      tickets: [{ id: "tx1", status: "paid", closed_at: "2026-05-16T20:00:00.000Z" }],
      items: [
        {
          ticket_id: "tx1",
          kind: "service",
          ref_id: "svc1",
          name_snapshot: "Gel Manicure",
          unit_price_cents: 5000,
          qty: 1,
          assigned_staff_id: "tech1",
        },
      ],
      payments: [{ ticket_id: "tx1", method: "cash", status: "succeeded", tip_cents: 0 }],
      staff: [staff()],
      services: [service()],
    })
  );

  it("the tech has gross = unit_price × qty, no deductions (cash)", () => {
    expect(model.technicians).toHaveLength(1);
    const t = model.technicians[0];
    expect(t.grossCents).toBe(5000);
    expect(t.cardFeeCents).toBe(0);
    expect(t.supplyCents).toBe(0);
    expect(t.totalDeductionsCents).toBe(0);
    expect(t.commissionableCents).toBe(5000);
    expect(t.hasNoDeductions).toBe(true);
    expect(t.serviceCount).toBe(1);
    expect(t.transactionCount).toBe(1);
  });

  it("totals row equals the single tech row", () => {
    const { totals, technicians } = model;
    const t = technicians[0];
    expect(totals.grossCents).toBe(t.grossCents);
    expect(totals.totalDeductionsCents).toBe(t.totalDeductionsCents);
    expect(totals.commissionableCents).toBe(t.commissionableCents);
    expect(totals.transactionCount).toBe(1);
    expect(totals.technicianCount).toBe(1);
  });
});

describe("projectReport — card transaction applies deductions", () => {
  const model = projectReport(
    input({
      tickets: [{ id: "tx1", status: "paid", closed_at: "2026-05-16T20:00:00.000Z" }],
      items: [
        {
          ticket_id: "tx1",
          kind: "service",
          ref_id: "svc1",
          name_snapshot: "Gel Manicure",
          unit_price_cents: 5000,
          qty: 1,
          assigned_staff_id: "tech1",
        },
      ],
      payments: [{ ticket_id: "tx1", method: "card", status: "succeeded", tip_cents: 1000 }],
      staff: [staff()],
      services: [service({ supply_amount_cents: 400, supply_type_id: "sup1" })],
    })
  );

  it("card fee + supply both apply; net = gross − deductions", () => {
    const t = model.technicians[0];
    expect(t.cardFeeCents).toBe(DEFAULT_CARD_FEE_CENTS);
    expect(t.supplyCents).toBe(400);
    expect(t.totalDeductionsCents).toBe(DEFAULT_CARD_FEE_CENTS + 400);
    expect(t.commissionableCents).toBe(5000 - DEFAULT_CARD_FEE_CENTS - 400);
    expect(t.hasNoDeductions).toBe(false);
  });

  it("the whole card tip goes to the single tech", () => {
    const t = model.technicians[0];
    expect(t.cardTipsCents).toBe(1000);
    expect(t.transactions[0].cardTipCents).toBe(1000);
    expect(t.transactions[0].isExpandable).toBe(true);
  });
});

describe("projectReport — distinct transaction count, not Σ per-tech", () => {
  // One ticket, two techs each perform a service on it. The PERIOD count is 1
  // distinct ticket; each tech's per-tech count is also 1.
  const model = projectReport(
    input({
      tickets: [{ id: "tx1", status: "paid", closed_at: "2026-05-16T20:00:00.000Z" }],
      items: [
        {
          ticket_id: "tx1",
          kind: "service",
          ref_id: "svc1",
          name_snapshot: "Mani",
          unit_price_cents: 4000,
          qty: 1,
          assigned_staff_id: "tech1",
        },
        {
          ticket_id: "tx1",
          kind: "service",
          ref_id: "svc1",
          name_snapshot: "Pedi",
          unit_price_cents: 6000,
          qty: 1,
          assigned_staff_id: "tech2",
        },
      ],
      payments: [{ ticket_id: "tx1", method: "cash", status: "succeeded", tip_cents: 0 }],
      staff: [staff(), staff({ id: "tech2", display_name: "Nina" })],
      services: [service()],
    })
  );

  it("period transactionCount is the DISTINCT ticket count (1), not 2", () => {
    expect(model.totals.transactionCount).toBe(1);
  });

  it("each tech still has their own per-tech count of 1", () => {
    for (const t of model.technicians) {
      expect(t.transactionCount).toBe(1);
    }
  });
});

describe("projectReport — non-service items excluded", () => {
  const model = projectReport(
    input({
      tickets: [{ id: "tx1", status: "paid", closed_at: "2026-05-16T20:00:00.000Z" }],
      items: [
        {
          ticket_id: "tx1",
          kind: "service",
          ref_id: "svc1",
          name_snapshot: "Mani",
          unit_price_cents: 4000,
          qty: 1,
          assigned_staff_id: "tech1",
        },
        {
          ticket_id: "tx1",
          kind: "discount",
          ref_id: null,
          name_snapshot: "Loyalty discount",
          unit_price_cents: -500,
          qty: 1,
          assigned_staff_id: null,
        },
        {
          ticket_id: "tx1",
          kind: "product",
          ref_id: null,
          name_snapshot: "Cuticle oil",
          unit_price_cents: 1200,
          qty: 1,
          assigned_staff_id: "tech1",
        },
      ],
      payments: [{ ticket_id: "tx1", method: "cash", status: "succeeded", tip_cents: 0 }],
      staff: [staff()],
      services: [service()],
    })
  );

  it("only the service line contributes to gross", () => {
    expect(model.technicians).toHaveLength(1);
    expect(model.technicians[0].grossCents).toBe(4000);
    expect(model.technicians[0].serviceCount).toBe(1);
  });
});

describe("projectReport — removed / inactive performer still included", () => {
  // The staff lookup row is present (the query fetches by id with no `active`
  // filter); the tech still appears in the report.
  const model = projectReport(
    input({
      tickets: [{ id: "tx1", status: "paid", closed_at: "2026-05-16T20:00:00.000Z" }],
      items: [
        {
          ticket_id: "tx1",
          kind: "service",
          ref_id: "svc1",
          name_snapshot: "Mani",
          unit_price_cents: 4000,
          qty: 1,
          assigned_staff_id: "ghost",
        },
      ],
      payments: [{ ticket_id: "tx1", method: "cash", status: "succeeded", tip_cents: 0 }],
      staff: [staff({ id: "ghost", display_name: "Departed Tech" })],
      services: [service()],
    })
  );

  it("a departed technician still produces a report row", () => {
    expect(model.technicians).toHaveLength(1);
    expect(model.technicians[0].staffId).toBe("ghost");
    expect(model.technicians[0].displayName).toBe("Departed Tech");
    expect(model.technicians[0].grossCents).toBe(4000);
  });
});

describe("projectReport — totals row reconciles to Σ tech rows", () => {
  const model = projectReport(
    input({
      tickets: [
        { id: "tx1", status: "paid", closed_at: "2026-05-16T18:00:00.000Z" },
        { id: "tx2", status: "paid", closed_at: "2026-05-16T20:00:00.000Z" },
      ],
      items: [
        {
          ticket_id: "tx1",
          kind: "service",
          ref_id: "svc1",
          name_snapshot: "Mani",
          unit_price_cents: 4000,
          qty: 1,
          assigned_staff_id: "tech1",
        },
        {
          ticket_id: "tx2",
          kind: "service",
          ref_id: "svc2",
          name_snapshot: "Pedi",
          unit_price_cents: 6000,
          qty: 2,
          assigned_staff_id: "tech2",
        },
      ],
      payments: [
        { ticket_id: "tx1", method: "card", status: "succeeded", tip_cents: 500 },
        { ticket_id: "tx2", method: "card", status: "succeeded", tip_cents: 800 },
      ],
      staff: [staff(), staff({ id: "tech2", display_name: "Nina" })],
      services: [
        service({ id: "svc1" }),
        service({ id: "svc2", supply_amount_cents: 250, supply_type_id: "sup1" }),
      ],
    })
  );

  it("every totals column equals the sum of that column across techs", () => {
    const { totals, technicians } = model;
    const sum = (pick: (t: (typeof technicians)[number]) => number) =>
      technicians.reduce((a, t) => a + pick(t), 0);
    expect(totals.grossCents).toBe(sum((t) => t.grossCents));
    expect(totals.cardFeeCents).toBe(sum((t) => t.cardFeeCents));
    expect(totals.supplyCents).toBe(sum((t) => t.supplyCents));
    expect(totals.totalDeductionsCents).toBe(sum((t) => t.totalDeductionsCents));
    expect(totals.commissionableCents).toBe(sum((t) => t.commissionableCents));
    expect(totals.cardTipsCents).toBe(sum((t) => t.cardTipsCents));
    expect(totals.serviceCount).toBe(sum((t) => t.serviceCount));
    expect(totals.technicianCount).toBe(technicians.length);
  });

  it("transactionCount is the distinct ticket count (2)", () => {
    expect(model.totals.transactionCount).toBe(2);
  });

  it("technicians are ordered by displayName ascending", () => {
    expect(model.technicians.map((t) => t.displayName)).toEqual(["Maya", "Nina"]);
  });
});

describe("projectReport — multi-tech tip split on one ticket", () => {
  // One card ticket, $1000 tip, two techs with subtotals 4000 and 6000.
  // Largest-remainder split by weight: 400 / 600.
  const model = projectReport(
    input({
      tickets: [{ id: "tx1", status: "paid", closed_at: "2026-05-16T20:00:00.000Z" }],
      items: [
        {
          ticket_id: "tx1",
          kind: "service",
          ref_id: "svc1",
          name_snapshot: "Mani",
          unit_price_cents: 4000,
          qty: 1,
          assigned_staff_id: "tech1",
        },
        {
          ticket_id: "tx1",
          kind: "service",
          ref_id: "svc1",
          name_snapshot: "Pedi",
          unit_price_cents: 6000,
          qty: 1,
          assigned_staff_id: "tech2",
        },
      ],
      payments: [{ ticket_id: "tx1", method: "card", status: "succeeded", tip_cents: 1000 }],
      staff: [staff(), staff({ id: "tech2", display_name: "Nina" })],
      services: [service({ card_fee_mode: "exempt" })],
    })
  );

  it("the tip splits by service subtotal and sums exactly to the ticket tip", () => {
    const byId = new Map(model.technicians.map((t) => [t.staffId, t]));
    expect(byId.get("tech1")!.cardTipsCents).toBe(400);
    expect(byId.get("tech2")!.cardTipsCents).toBe(600);
    expect(model.totals.cardTipsCents).toBe(1000);
  });
});

describe("projectReport — hasNoDeductions ⇔ totalDeductions === 0", () => {
  // A fully-exempt tech (card_fee_exempt + supply_mode 'exempt') on a card ticket.
  const model = projectReport(
    input({
      tickets: [{ id: "tx1", status: "paid", closed_at: "2026-05-16T20:00:00.000Z" }],
      items: [
        {
          ticket_id: "tx1",
          kind: "service",
          ref_id: "svc1",
          name_snapshot: "Mani",
          unit_price_cents: 4000,
          qty: 1,
          assigned_staff_id: "tech1",
        },
      ],
      payments: [{ ticket_id: "tx1", method: "card", status: "succeeded", tip_cents: 0 }],
      staff: [staff({ card_fee_exempt: true, supply_mode: "exempt" })],
      services: [service({ supply_amount_cents: 400, supply_type_id: "sup1" })],
    })
  );

  it("a fully-exempt tech has zero deductions, commissionable === gross, hasNoDeductions true", () => {
    const t = model.technicians[0];
    expect(t.totalDeductionsCents).toBe(0);
    expect(t.hasNoDeductions).toBe(true);
    expect(t.commissionableCents).toBe(t.grossCents);
  });

  it("succeeded-only payments — a failed payment is ignored for card-settled", () => {
    const m = projectReport(
      input({
        tickets: [{ id: "tx1", status: "paid", closed_at: "2026-05-16T20:00:00.000Z" }],
        items: [
          {
            ticket_id: "tx1",
            kind: "service",
            ref_id: "svc1",
            name_snapshot: "Mani",
            unit_price_cents: 4000,
            qty: 1,
            assigned_staff_id: "tech1",
          },
        ],
        payments: [
          { ticket_id: "tx1", method: "card", status: "failed", tip_cents: 0 },
          { ticket_id: "tx1", method: "cash", status: "succeeded", tip_cents: 0 },
        ],
        staff: [staff()],
        services: [service()],
      })
    );
    // Only the cash payment succeeded → not card-settled → no card fee.
    expect(m.technicians[0].cardFeeCents).toBe(0);
  });
});
