// lib/report/aggregate.ts
// -----------------------------------------------------------------------------
// Report-page read model + the pure projection / deduction / tip-split math.
//
// This module is the constitutionally test-first piece (Constitution Principle
// IV — "tip-split math"): `splitCardTip` and the deduction functions have unit
// tests written and seen to fail before this implementation existed.
//
// Pure — no I/O, no Supabase, no `Date.now()`. The live query layer
// (`lib/report/queries.ts`) feeds it raw DB rows; the unit suite feeds it fixed
// fixtures. Importable on the client (the page hands the read model to the
// client island).
//
// See data-model.md §2–§3 and contracts/report-read-model.md § C3.

import type { PaymentMethod } from "@/lib/dashboard/aggregate";
import { DEFAULT_CARD_FEE_CENTS } from "@/lib/services/card-fee-default";
import { deriveMethod } from "@/lib/transactions/aggregate";
import { formatTime } from "@/lib/time/format";

// ─── Raw input row shapes (what the query layer projects) ───────────────────

export type ReportTicketRow = {
  readonly id: string;
  readonly status: string; // already filtered to 'paid'
  readonly closed_at: string | null;
};

export type ReportItemRow = {
  readonly ticket_id: string;
  readonly kind: string; // 'service' | 'discount' | 'product'
  readonly ref_id: string | null;
  readonly name_snapshot: string;
  readonly unit_price_cents: number;
  readonly qty: number;
  readonly assigned_staff_id: string | null;
};

export type ReportPaymentRow = {
  readonly ticket_id: string;
  readonly method: string; // 'card' | 'cash' | 'gift'
  readonly status: string; // already filtered to 'succeeded'
  readonly tip_cents: number;
};

export type ReportStaffRow = {
  readonly id: string;
  readonly display_name: string;
  readonly color_token: string;
  readonly card_fee_exempt: boolean;
  readonly supply_mode: string; // 'apply' | 'partial' | 'exempt'
  readonly supply_except: readonly string[];
};

export type ReportServiceRow = {
  readonly id: string;
  readonly card_fee_mode: string; // 'default' | 'custom' | 'exempt'
  readonly card_fee_custom_cents: number | null;
  readonly supply_amount_cents: number | null;
  readonly supply_type_id: string | null;
};

export type ProjectReportInput = {
  readonly tz: string;
  readonly tickets: readonly ReportTicketRow[];
  readonly items: readonly ReportItemRow[];
  readonly payments: readonly ReportPaymentRow[];
  readonly staff: readonly ReportStaffRow[];
  readonly services: readonly ReportServiceRow[];
};

// ─── Read-model types (serialisable, projected server-side) ─────────────────

export type ReportDeductionLine = {
  readonly type: "card" | "supply";
  readonly serviceName: string;
  readonly amountCents: number;
};

export type ReportTransaction = {
  readonly ticketId: string;
  readonly time: string; // formatTime(closed_at, tz) — pre-formatted
  readonly closedAtIso: string; // sort key
  readonly client: string; // "Walk-in" — v1, no clients table
  readonly serviceNames: readonly string[];
  readonly method: PaymentMethod;
  readonly grossCents: number;
  readonly cardFeeCents: number;
  readonly supplyCents: number;
  readonly netCents: number;
  readonly cardTipCents: number;
  readonly tipPct: number | null;
  readonly deductionLines: readonly ReportDeductionLine[];
  readonly isExpandable: boolean;
};

export type TechnicianReport = {
  readonly staffId: string;
  readonly displayName: string;
  readonly colorToken: string;
  readonly transactionCount: number;
  readonly serviceCount: number;
  readonly grossCents: number;
  readonly cardFeeCents: number;
  readonly supplyCents: number;
  readonly totalDeductionsCents: number;
  readonly commissionableCents: number;
  readonly cardTipsCents: number;
  readonly hasNoDeductions: boolean;
  readonly transactions: readonly ReportTransaction[];
};

export type ReportTotals = {
  readonly technicianCount: number;
  readonly transactionCount: number;
  readonly serviceCount: number;
  readonly grossCents: number;
  readonly cardFeeCents: number;
  readonly supplyCents: number;
  readonly totalDeductionsCents: number;
  readonly commissionableCents: number;
  readonly cardTipsCents: number;
};

export type ReportReadModel = {
  readonly technicians: readonly TechnicianReport[];
  readonly totals: ReportTotals;
  readonly isEmpty: boolean;
};

export { deriveMethod };

// ─── effectiveCardFeeCents ──────────────────────────────────────────────────

/**
 * The per-unit card fee for a service (data-model §2.2):
 *  - a missing service → `DEFAULT_CARD_FEE_CENTS` (a service-line whose `ref_id`
 *    no longer resolves still pays the house default — R12);
 *  - `card_fee_mode = 'exempt'` → `0`;
 *  - `card_fee_mode = 'custom'` → `card_fee_custom_cents ?? 0`;
 *  - otherwise (`'default'`) → `DEFAULT_CARD_FEE_CENTS`.
 */
export function effectiveCardFeeCents(service: ReportServiceRow | null): number {
  if (service === null) return DEFAULT_CARD_FEE_CENTS;
  if (service.card_fee_mode === "exempt") return 0;
  if (service.card_fee_mode === "custom") return service.card_fee_custom_cents ?? 0;
  return DEFAULT_CARD_FEE_CENTS;
}

// ─── computeLineDeductions ──────────────────────────────────────────────────

/**
 * Computes the card-fee and supply deductions for one service line item `i`
 * performed by technician `t` (data-model §2.3). Both deductions are per-`qty`.
 *
 *  - card fee applies only when the ticket is card-settled AND the tech is not
 *    `card_fee_exempt`;
 *  - supply applies only when the service carries a `supply_amount_cents` and
 *    the tech's `supply_mode` is `apply`, or `partial` with the service's
 *    `supply_type_id` not in `supply_except`.
 *
 * Each non-zero deduction also emits an itemised `ReportDeductionLine`.
 */
export function computeLineDeductions(
  item: ReportItemRow,
  service: ReportServiceRow | null,
  tech: ReportStaffRow,
  isCardSettled: boolean
): { cardFeeCents: number; supplyCents: number; lines: ReportDeductionLine[] } {
  const lines: ReportDeductionLine[] = [];
  const qty = item.qty;

  let cardFeeCents = 0;
  if (isCardSettled && !tech.card_fee_exempt) {
    cardFeeCents = effectiveCardFeeCents(service) * qty;
  }
  if (cardFeeCents > 0) {
    lines.push({ type: "card", serviceName: item.name_snapshot, amountCents: cardFeeCents });
  }

  let supplyCents = 0;
  const supplyAmount = service?.supply_amount_cents ?? null;
  if (supplyAmount != null) {
    const supplyApplies =
      tech.supply_mode === "apply" ||
      (tech.supply_mode === "partial" &&
        !tech.supply_except.includes(service?.supply_type_id ?? ""));
    if (supplyApplies) {
      supplyCents = supplyAmount * qty;
    }
  }
  if (supplyCents > 0) {
    lines.push({ type: "supply", serviceName: item.name_snapshot, amountCents: supplyCents });
  }

  return { cardFeeCents, supplyCents, lines };
}

// ─── splitCardTip — largest-remainder method (Constitution IV) ──────────────

/**
 * Divides `totalCents` across N recipients weighted by `weights`, using the
 * largest-remainder method: floor each proportional share, then hand the
 * leftover cents one at a time to the largest fractional remainders (ties
 * resolve to the earliest index). `Σ result === totalCents` exactly (R4).
 *
 * Edge cases:
 *  - all-zero weights (a zero service subtotal) → every share `0`;
 *  - `totalCents === 0` → every share `0`;
 *  - an empty `weights` array → `[]`.
 */
export function splitCardTip(totalCents: number, weights: readonly number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];

  const result = new Array<number>(n).fill(0);
  if (totalCents === 0) return result;

  const totalWeight = weights.reduce((a, w) => a + w, 0);
  if (totalWeight <= 0) return result;

  // Floor each proportional share; track the fractional remainder per index.
  const remainders: { index: number; frac: number }[] = [];
  let distributed = 0;
  for (let i = 0; i < n; i += 1) {
    const exact = (totalCents * weights[i]) / totalWeight;
    const floored = Math.floor(exact);
    result[i] = floored;
    distributed += floored;
    remainders.push({ index: i, frac: exact - floored });
  }

  // Hand the leftover cents to the largest remainders, earliest index first.
  let leftover = totalCents - distributed;
  remainders.sort((a, b) => (b.frac !== a.frac ? b.frac - a.frac : a.index - b.index));
  for (let r = 0; r < remainders.length && leftover > 0; r += 1) {
    result[remainders[r].index] += 1;
    leftover -= 1;
  }

  return result;
}

// ─── projectReport ──────────────────────────────────────────────────────────

const ZERO_TOTALS: ReportTotals = {
  technicianCount: 0,
  transactionCount: 0,
  serviceCount: 0,
  grossCents: 0,
  cardFeeCents: 0,
  supplyCents: 0,
  totalDeductionsCents: 0,
  commissionableCents: 0,
  cardTipsCents: 0,
};

// A mutable per-tech accumulator built up during projection, then frozen into
// a `TechnicianReport`.
type TechAccum = {
  staffId: string;
  displayName: string;
  colorToken: string;
  ticketIds: Set<string>;
  serviceCount: number;
  grossCents: number;
  cardFeeCents: number;
  supplyCents: number;
  cardTipsCents: number;
  transactions: ReportTransaction[];
};

/**
 * Projects raw DB rows (paid tickets + their service items / succeeded payments,
 * plus staff/service lookup rows) into the `ReportReadModel` — per-technician
 * aggregates, a reconciling totals row, newest-first transactions.
 *
 * Pure: no I/O, no `Date.now()`. See data-model.md §3.
 */
export function projectReport(input: ProjectReportInput): ReportReadModel {
  const { tz, tickets, items, payments, staff, services } = input;

  if (tickets.length === 0) {
    return { technicians: [], totals: ZERO_TOTALS, isEmpty: true };
  }

  const staffById = new Map(staff.map((s) => [s.id, s]));
  const serviceById = new Map(services.map((s) => [s.id, s]));

  // Bucket service-only items and succeeded payments by ticket.
  const serviceItemsByTicket = new Map<string, ReportItemRow[]>();
  for (const it of items) {
    if (it.kind !== "service") continue;
    const list = serviceItemsByTicket.get(it.ticket_id) ?? [];
    list.push(it);
    serviceItemsByTicket.set(it.ticket_id, list);
  }
  const paymentsByTicket = new Map<string, ReportPaymentRow[]>();
  for (const p of payments) {
    if (p.status !== "succeeded") continue;
    const list = paymentsByTicket.get(p.ticket_id) ?? [];
    list.push(p);
    paymentsByTicket.set(p.ticket_id, list);
  }

  const techAccums = new Map<string, TechAccum>();
  const accumFor = (staffId: string): TechAccum | null => {
    const existing = techAccums.get(staffId);
    if (existing) return existing;
    const s = staffById.get(staffId);
    if (!s) return null; // performer with no staff lookup row — drop the line
    const created: TechAccum = {
      staffId: s.id,
      displayName: s.display_name,
      colorToken: s.color_token,
      ticketIds: new Set<string>(),
      serviceCount: 0,
      grossCents: 0,
      cardFeeCents: 0,
      supplyCents: 0,
      cardTipsCents: 0,
      transactions: [],
    };
    techAccums.set(staffId, created);
    return created;
  };

  for (const ticket of tickets) {
    const serviceItems = serviceItemsByTicket.get(ticket.id) ?? [];
    if (serviceItems.length === 0) continue;

    const ticketPayments = paymentsByTicket.get(ticket.id) ?? [];
    const isCardSettled = ticketPayments.some((p) => p.method === "card" || p.method === "gift");
    const cardTipCents = ticketPayments
      .filter((p) => p.method === "card" || p.method === "gift")
      .reduce((a, p) => a + p.tip_cents, 0);
    const method = deriveMethod(
      ticketPayments.map((p) => ({
        method: p.method as "card" | "cash" | "gift",
        amountCents: 0,
        tipCents: p.tip_cents,
      }))
    );
    const timeStr = ticket.closed_at ? formatTime(new Date(ticket.closed_at), tz) : "";

    // Group this ticket's service lines by the performing technician. Lines
    // with no `assigned_staff_id` or no staff lookup row are dropped.
    type LineCalc = {
      item: ReportItemRow;
      grossCents: number;
      cardFeeCents: number;
      supplyCents: number;
      lines: ReportDeductionLine[];
    };
    const linesByTech = new Map<string, LineCalc[]>();
    // Per-tech service subtotal on this ticket — the largest-remainder tip-split
    // weights. `splitCardTip` derives the divisor (the ticket service subtotal)
    // from the sum of these weights.
    const techSubtotals = new Map<string, number>();

    for (const it of serviceItems) {
      const techId = it.assigned_staff_id;
      if (techId === null) continue;
      const tech = staffById.get(techId);
      if (!tech) continue;

      const service = it.ref_id ? (serviceById.get(it.ref_id) ?? null) : null;
      const grossCents = it.unit_price_cents * it.qty;
      const {
        cardFeeCents: lineCardFee,
        supplyCents: lineSupply,
        lines,
      } = computeLineDeductions(it, service, tech, isCardSettled);

      const list = linesByTech.get(techId) ?? [];
      list.push({
        item: it,
        grossCents,
        cardFeeCents: lineCardFee,
        supplyCents: lineSupply,
        lines,
      });
      linesByTech.set(techId, list);

      techSubtotals.set(techId, (techSubtotals.get(techId) ?? 0) + grossCents);
    }

    if (linesByTech.size === 0) continue;

    // Largest-remainder tip split across this ticket's distinct technicians,
    // weighted by each tech's service subtotal on the ticket.
    const ticketTechIds = Array.from(linesByTech.keys());
    const weights = ticketTechIds.map((id) => techSubtotals.get(id) ?? 0);
    const tipShares = splitCardTip(cardTipCents, weights);

    ticketTechIds.forEach((techId, idx) => {
      const accum = accumFor(techId);
      if (!accum) return;
      const calcs = linesByTech.get(techId) ?? [];

      let txGross = 0;
      let txCardFee = 0;
      let txSupply = 0;
      let txServiceCount = 0;
      const serviceNames: string[] = [];
      const deductionLines: ReportDeductionLine[] = [];
      for (const c of calcs) {
        txGross += c.grossCents;
        txCardFee += c.cardFeeCents;
        txSupply += c.supplyCents;
        txServiceCount += c.item.qty;
        serviceNames.push(c.item.name_snapshot);
        deductionLines.push(...c.lines);
      }

      const txTip = tipShares[idx] ?? 0;
      const techSubtotal = techSubtotals.get(techId) ?? 0;
      const tipPct =
        txTip > 0 && techSubtotal > 0 ? Math.round((txTip / techSubtotal) * 100) : null;

      const transaction: ReportTransaction = {
        ticketId: ticket.id,
        time: timeStr,
        closedAtIso: ticket.closed_at ?? "",
        client: "Walk-in",
        serviceNames,
        method,
        grossCents: txGross,
        cardFeeCents: txCardFee,
        supplyCents: txSupply,
        netCents: txGross - txCardFee - txSupply,
        cardTipCents: txTip,
        tipPct,
        deductionLines,
        isExpandable: deductionLines.length > 0 || txTip > 0,
      };

      accum.ticketIds.add(ticket.id);
      accum.serviceCount += txServiceCount;
      accum.grossCents += txGross;
      accum.cardFeeCents += txCardFee;
      accum.supplyCents += txSupply;
      accum.cardTipsCents += txTip;
      accum.transactions.push(transaction);
    });
  }

  // Freeze accumulators into TechnicianReports, ordered by displayName asc and
  // each tech's transactions newest-first.
  const technicians: TechnicianReport[] = Array.from(techAccums.values())
    .map((a) => {
      const totalDeductionsCents = a.cardFeeCents + a.supplyCents;
      const transactions = [...a.transactions].sort((x, y) =>
        y.closedAtIso < x.closedAtIso ? -1 : y.closedAtIso > x.closedAtIso ? 1 : 0
      );
      return {
        staffId: a.staffId,
        displayName: a.displayName,
        colorToken: a.colorToken,
        transactionCount: a.ticketIds.size,
        serviceCount: a.serviceCount,
        grossCents: a.grossCents,
        cardFeeCents: a.cardFeeCents,
        supplyCents: a.supplyCents,
        totalDeductionsCents,
        commissionableCents: a.grossCents - totalDeductionsCents,
        cardTipsCents: a.cardTipsCents,
        hasNoDeductions: totalDeductionsCents === 0,
        transactions,
      };
    })
    .sort((x, y) => x.displayName.localeCompare(y.displayName));

  // Distinct paid tickets that contributed at least one reported service line.
  const distinctTicketIds = new Set<string>();
  for (const t of technicians) {
    for (const tx of t.transactions) distinctTicketIds.add(tx.ticketId);
  }

  const totals: ReportTotals = {
    technicianCount: technicians.length,
    transactionCount: distinctTicketIds.size,
    serviceCount: technicians.reduce((a, t) => a + t.serviceCount, 0),
    grossCents: technicians.reduce((a, t) => a + t.grossCents, 0),
    cardFeeCents: technicians.reduce((a, t) => a + t.cardFeeCents, 0),
    supplyCents: technicians.reduce((a, t) => a + t.supplyCents, 0),
    totalDeductionsCents: technicians.reduce((a, t) => a + t.totalDeductionsCents, 0),
    commissionableCents: technicians.reduce((a, t) => a + t.commissionableCents, 0),
    cardTipsCents: technicians.reduce((a, t) => a + t.cardTipsCents, 0),
  };

  return { technicians, totals, isEmpty: technicians.length === 0 };
}
