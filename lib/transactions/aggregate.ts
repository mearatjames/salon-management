// lib/transactions/aggregate.ts
// -----------------------------------------------------------------------------
// Transactions read-model types + the pure functions that build it.
//
// Everything here is pure and importable on the client: `projectTransactions`
// turns raw DB rows into the serialisable read model (the server calls it from
// `queries.ts`), while `deriveMethod` / `computeKpis` / `groupByDay` run again
// client-side over the *filtered* set. No timezone data crosses to the client —
// the server pre-formats every time string and day key during projection.
//
// See data-model.md § 2 and contracts/transactions-read-model.md § C2/C4.

import type { PaymentMethod } from "@/lib/dashboard/aggregate";
import { formatTime, salonDateString } from "@/lib/time/format";

import { formatTxId } from "./format";

// Re-export PaymentMethod so `aggregate.ts` is the single import surface for
// the read model (the dashboard module remains the source of truth).
export type { PaymentMethod } from "@/lib/dashboard/aggregate";

// ─── Read-model types (data-model.md § 2) ────────────────────────────────────

export type TransactionLineItem = {
  /**
   * Feature 050 (T006). The `ticket_items` row id. Load-bearing for the
   * reassign-paid-line-tech surface: the receipt drawer threads it into the
   * server action so the per-line UPDATE targets the correct row. Sourced
   * from `ProjectItemRow.id` (already selected by the page query — feature
   * 049 added it for discount scope resolution).
   */
  readonly lineId: string;
  readonly name: string;
  readonly category: string | null;
  readonly kind: "service" | "discount" | "product";
  readonly qty: number;
  readonly unitPriceCents: number;
  readonly lineTotalCents: number;
  readonly techId: string | null;
  /**
   * Feature 049-per-service-discount (T022). For a scoped discount row,
   * the `name_snapshot` of each targeted service line on the same ticket.
   * `null` for non-discount rows AND for legacy all-services discount rows
   * (which carry `discount_target_line_ids = NULL` in the DB and render
   * exactly as today — no `Applies to:` sub-line).
   */
  readonly targetNames: readonly string[] | null;
};

export type TransactionPayment = {
  readonly method: "card" | "cash" | "gift";
  readonly amountCents: number;
  readonly tipCents: number;
};

export type TransactionDetail = {
  readonly id: string;
  readonly displayId: string;
  readonly client: string;
  readonly closedAtIso: string;
  readonly time: string;
  readonly dayKey: string;
  readonly techIds: readonly string[];
  readonly items: readonly TransactionLineItem[];
  readonly payments: readonly TransactionPayment[];
  readonly method: PaymentMethod;
  readonly subtotalCents: number;
  readonly taxCents: number;
  readonly tipCents: number;
  readonly totalCents: number;
  readonly serviceCount: number;
  readonly cashierName: string | null;
  /**
   * Feature 050 (T006). `true` when this ticket's pay period has been
   * finalized — either the `pay_periods` row's `status = 'closed'`, OR
   * ≥ 1 `payroll_payouts` row references it. The Transactions page
   * stamps this per-tx via `lib/payroll/finalized.ts#isPayPeriodFinalized`
   * (T015). Any direct projection call site that does not stamp it leaves
   * the default `false` — the projector itself has no DB access.
   */
  readonly payPeriodFinalized: boolean;
};

export type TransactionKpis = {
  readonly count: number;
  readonly grossRevenueCents: number;
  readonly servicesRendered: number;
  readonly tipsCents: number;
  readonly avgTicketCents: number;
  readonly avgServicesPerSale: number;
};

export type DayGroup = {
  readonly dayKey: string;
  readonly transactions: readonly TransactionDetail[];
  readonly count: number;
  readonly revenueCents: number;
  readonly tipsCents: number;
};

// ─── Raw-row input shapes for projectTransactions ────────────────────────────
// Mirror the columns the query layer projects from public.tickets /
// public.ticket_items / public.payments / public.staff / public.services.

export type ProjectTicketRow = {
  readonly id: string;
  readonly status: string;
  readonly subtotal_cents: number;
  readonly tax_cents: number;
  readonly total_cents: number;
  readonly closed_at: string | null;
  readonly closed_by_staff_id: string | null;
};

export type ProjectItemRow = {
  /**
   * Feature 049 (T022): the row id is load-bearing — scoped discount rows
   * carry `discount_target_line_ids: uuid[]` whose elements are the ids
   * of the targeted service rows on the same ticket. The projection
   * builds an `id → name_snapshot` lookup to resolve `targetNames`.
   */
  readonly id: string;
  readonly ticket_id: string;
  readonly kind: string; // 'service' | 'discount' | 'product'
  readonly qty: number;
  readonly name_snapshot: string;
  readonly assigned_staff_id: string | null;
  readonly unit_price_cents: number;
  readonly ref_id: string | null;
  /**
   * Feature 049 (T022). Non-null for scoped discount rows; null for
   * non-discount rows AND for legacy all-services discount rows.
   */
  readonly discount_target_line_ids: readonly string[] | null;
};

export type ProjectPaymentRow = {
  readonly ticket_id: string;
  readonly method: string; // 'card' | 'cash' | 'gift'
  readonly status: string; // 'succeeded' | 'pending' | 'failed'
  readonly amount_cents: number;
  readonly tip_cents: number;
};

export type ProjectStaffRow = {
  readonly id: string;
  readonly display_name: string;
  readonly color_token: string;
};

export type ProjectServiceRow = {
  readonly id: string;
  readonly category: string;
};

export type ProjectTransactionsInput = {
  readonly tz: string;
  readonly tickets: readonly ProjectTicketRow[];
  readonly items: readonly ProjectItemRow[];
  readonly payments: readonly ProjectPaymentRow[];
  readonly staff: readonly ProjectStaffRow[];
  readonly services: readonly ProjectServiceRow[];
};

// ─── deriveMethod ────────────────────────────────────────────────────────────

/**
 * Resolves the payment-method marker for a transaction: the single method when
 * all payments share one, or `"split"` when two or more distinct methods are
 * present. Defensive default `"cash"` when there are no payments (a paid
 * ticket should always have one).
 */
export function deriveMethod(payments: readonly TransactionPayment[]): PaymentMethod {
  const distinct = Array.from(new Set(payments.map((p) => p.method)));
  if (distinct.length >= 2) return "split";
  if (distinct.length === 1) {
    const m = distinct[0];
    if (m === "card" || m === "cash" || m === "gift") return m;
  }
  return "cash";
}

// ─── projectTransactions ─────────────────────────────────────────────────────

/**
 * Projects raw DB rows (tickets + their items/payments, plus staff/services
 * lookup rows) into the `TransactionDetail` read model, newest-first.
 *
 * Rules (data-model.md § 2 / § 4):
 *  - only `payments.status = 'succeeded'` count;
 *  - line-item `category` is joined `ticket_items.ref_id` → `services.category`,
 *    `null` for non-service / deleted services (research R6);
 *  - `techIds` = distinct non-discount `assigned_staff_id`, first-seen order;
 *  - `serviceCount` = Σ qty over non-discount items;
 *  - `totalCents` = subtotal + tax + Σ payment tips (revenue incl. tip);
 *  - `client` is always `"Walk-in"` in v1 (research R5).
 */
export function projectTransactions(input: ProjectTransactionsInput): readonly TransactionDetail[] {
  const { tz, tickets, items, payments, staff, services } = input;

  const staffById = new Map(staff.map((s) => [s.id, s]));
  const categoryByServiceId = new Map(services.map((s) => [s.id, s.category]));

  const itemsByTicket = new Map<string, ProjectItemRow[]>();
  for (const it of items) {
    const list = itemsByTicket.get(it.ticket_id) ?? [];
    list.push(it);
    itemsByTicket.set(it.ticket_id, list);
  }

  const paymentsByTicket = new Map<string, ProjectPaymentRow[]>();
  for (const p of payments) {
    if (p.status !== "succeeded") continue;
    const list = paymentsByTicket.get(p.ticket_id) ?? [];
    list.push(p);
    paymentsByTicket.set(p.ticket_id, list);
  }

  const rows: TransactionDetail[] = [];
  for (const ticket of tickets) {
    const ticketItems = itemsByTicket.get(ticket.id) ?? [];
    const ticketPaymentRows = paymentsByTicket.get(ticket.id) ?? [];
    const closedAtIso = ticket.closed_at ?? "";
    const closedAt = ticket.closed_at ? new Date(ticket.closed_at) : null;

    // Feature 049 (T022): id → name_snapshot lookup over the same ticket's
    // items, used to resolve a scoped discount's `targetNames` from its
    // `discount_target_line_ids` array. Built per-ticket so legacy rows
    // (no scope) and feature rows coexist correctly.
    const nameByItemId = new Map(ticketItems.map((it) => [it.id, it.name_snapshot]));

    const lineItems: TransactionLineItem[] = ticketItems.map((it) => {
      const kind =
        it.kind === "service" || it.kind === "discount" || it.kind === "product"
          ? it.kind
          : "service";
      let targetNames: readonly string[] | null = null;
      if (kind === "discount" && it.discount_target_line_ids) {
        const resolved = it.discount_target_line_ids
          .map((id) => nameByItemId.get(id))
          .filter((n): n is string => typeof n === "string");
        // Defensive: an empty resolved array (a target id not found in this
        // ticket's slice — shouldn't happen, US3 auto-removal handles the
        // live case) is projected as `null` so the surface renders the
        // legacy all-services layout instead of an empty `Applies to:` row.
        targetNames = resolved.length > 0 ? resolved : null;
      }
      return {
        lineId: it.id,
        name: it.name_snapshot,
        category: it.ref_id ? (categoryByServiceId.get(it.ref_id) ?? null) : null,
        kind,
        qty: it.qty,
        unitPriceCents: it.unit_price_cents,
        lineTotalCents: it.unit_price_cents * it.qty,
        techId: it.assigned_staff_id,
        targetNames,
      };
    });

    // techIds — distinct non-discount staff, first-seen order.
    const techIds: string[] = [];
    let serviceCount = 0;
    for (const it of ticketItems) {
      if (it.kind === "discount") continue;
      serviceCount += it.qty || 0;
      const id = it.assigned_staff_id;
      if (id && !techIds.includes(id)) techIds.push(id);
    }

    const txPayments: TransactionPayment[] = ticketPaymentRows.map((p) => ({
      method: p.method === "card" || p.method === "cash" || p.method === "gift" ? p.method : "cash",
      amountCents: p.amount_cents,
      tipCents: p.tip_cents,
    }));

    const tipCents = txPayments.reduce((sum, p) => sum + p.tipCents, 0);
    const subtotalCents = ticket.subtotal_cents;
    const taxCents = ticket.tax_cents;

    rows.push({
      id: ticket.id,
      displayId: formatTxId(ticket.id),
      client: "Walk-in",
      closedAtIso,
      time: closedAt ? formatTime(closedAt, tz) : "",
      dayKey: closedAt ? salonDateString(tz, closedAt) : "",
      techIds,
      items: lineItems,
      payments: txPayments,
      method: deriveMethod(txPayments),
      subtotalCents,
      taxCents,
      tipCents,
      totalCents: subtotalCents + taxCents + tipCents,
      serviceCount,
      cashierName: ticket.closed_by_staff_id
        ? (staffById.get(ticket.closed_by_staff_id)?.display_name ?? null)
        : null,
      // Feature 050 (T006): default `false` — the projector is pure and has
      // no DB access. The Transactions page stamps the live value per-tx
      // (T015) using `isPayPeriodFinalized` keyed by the period's startsOn.
      payPeriodFinalized: false,
    });
  }

  // Newest-first by closedAtIso.
  rows.sort((a, b) => (a.closedAtIso < b.closedAtIso ? 1 : a.closedAtIso > b.closedAtIso ? -1 : 0));
  return rows;
}

// ─── computeKpis ─────────────────────────────────────────────────────────────

/**
 * Computes the KPI strip over a (filtered) set of transactions. Money is
 * server-authoritative; this only sums and averages — never recomputes a
 * ticket total. Empty set → all zeros.
 */
export function computeKpis(transactions: readonly TransactionDetail[]): TransactionKpis {
  const count = transactions.length;
  let grossRevenueCents = 0;
  let servicesRendered = 0;
  let tipsCents = 0;
  for (const tx of transactions) {
    grossRevenueCents += tx.totalCents;
    servicesRendered += tx.serviceCount;
    tipsCents += tx.tipCents;
  }
  return {
    count,
    grossRevenueCents,
    servicesRendered,
    tipsCents,
    avgTicketCents: count > 0 ? grossRevenueCents / count : 0,
    avgServicesPerSale: count > 0 ? servicesRendered / count : 0,
  };
}

// ─── groupByDay ──────────────────────────────────────────────────────────────

/**
 * Buckets transactions by their `dayKey`, preserving the input (newest-first)
 * order within each group, and returns the groups ordered by `dayKey`
 * descending (newest day first).
 */
export function groupByDay(transactions: readonly TransactionDetail[]): readonly DayGroup[] {
  const byDay = new Map<string, TransactionDetail[]>();
  for (const tx of transactions) {
    const list = byDay.get(tx.dayKey) ?? [];
    list.push(tx);
    byDay.set(tx.dayKey, list);
  }

  const groups: DayGroup[] = [];
  for (const [dayKey, txs] of byDay) {
    let revenueCents = 0;
    let tipsCents = 0;
    for (const tx of txs) {
      revenueCents += tx.totalCents;
      tipsCents += tx.tipCents;
    }
    groups.push({ dayKey, transactions: txs, count: txs.length, revenueCents, tipsCents });
  }

  groups.sort((a, b) => (a.dayKey < b.dayKey ? 1 : a.dayKey > b.dayKey ? -1 : 0));
  return groups;
}
