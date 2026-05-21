// lib/dashboard/aggregate.ts
// -----------------------------------------------------------------------------
// Dashboard read-model types + the pure `summarizeRows()` aggregator that the
// live Supabase query layer feeds.

import type { LucideIcon } from "lucide-react";

// ─── Read-model types ─────────────────────────────────────────────────────

export type DashboardPeriod = "today" | "week" | "month";

// PaymentMethod EXTENDED with "split" (FR-014a) so TransactionRow.method
// can carry the split-tender marker.
export type PaymentMethod = "card" | "cash" | "gift" | "split";

export type Technician = {
  readonly id: string;
  readonly displayName: string;
  readonly colorToken: string;
};

export type DashboardSummary = {
  period: DashboardPeriod;
  count: number;
  services: number;
  subtotal: number;
  tip: number;
  tax: number;
  total: number;
  byMethod: { card: number; cash: number; gift: number };
  avgServicesPerSale: number;
  tipPctAvg: number;
};

export type TransactionRow = {
  id: string;
  time: string;
  serviceLabel: string;
  techIds: readonly string[];
  method: PaymentMethod;
  total: number;
  // NB: no `client` field (FR-023).
};

export type QuickAction = {
  id: "calendar" | "walkin" | "report" | "cashout";
  label: string;
  hint: string;
  icon: LucideIcon;
  href: string;
};

export type DashboardData = {
  greeting: {
    title: "Today at the salon";
    subtitle: string;
  };
  summaries: Record<DashboardPeriod, DashboardSummary>;
  staff: readonly Technician[];
  recent: readonly TransactionRow[];
  quickActions: readonly QuickAction[];
  // NB: no `comparisons` field (FR-020).
};

// ─── summarizeRows() — pure aggregator ────────────────────────────────────

// The shape of rows fed to summarizeRows. Mirrors the columns the query layer
// projects from public.tickets / public.ticket_items / public.payments.

export type SummarizeTicket = {
  id: string;
  status: string;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  closed_at: string | null;
};

export type SummarizeItem = {
  ticket_id: string;
  kind: string; // 'service' | 'discount' | 'product'
  qty: number;
  name_snapshot: string;
  assigned_staff_id: string | null;
  unit_price_cents: number;
};

export type SummarizePayment = {
  ticket_id: string;
  method: string; // 'card' | 'cash' | 'gift' (db values; 'split' is row-level only)
  status: string; // 'succeeded' | 'pending' | 'failed'
  amount_cents: number;
  tip_cents: number;
};

export type SummarizeInput = {
  tickets: readonly SummarizeTicket[];
  items: readonly SummarizeItem[];
  payments: readonly SummarizePayment[];
};

function emptySummary(period: DashboardPeriod): DashboardSummary {
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

export function summarizeRows(input: SummarizeInput, period: DashboardPeriod): DashboardSummary {
  const { tickets, items, payments } = input;
  if (tickets.length === 0) {
    return emptySummary(period);
  }

  // Pre-bucket items by ticket; skip discount lines for service-count.
  const servicesByTicket = new Map<string, number>();
  for (const item of items) {
    if (item.kind === "discount") continue;
    servicesByTicket.set(
      item.ticket_id,
      (servicesByTicket.get(item.ticket_id) ?? 0) + (item.qty || 0)
    );
  }

  // Pre-bucket succeeded payments by ticket.
  const succeededPaymentsByTicket = new Map<string, SummarizePayment[]>();
  for (const p of payments) {
    if (p.status !== "succeeded") continue;
    const list = succeededPaymentsByTicket.get(p.ticket_id) ?? [];
    list.push(p);
    succeededPaymentsByTicket.set(p.ticket_id, list);
  }

  let count = 0;
  let services = 0;
  let subtotal = 0;
  let tip = 0;
  let tax = 0;
  let total = 0;
  const byMethod = { card: 0, cash: 0, gift: 0 };
  let tipPctSum = 0;
  let tipPctTicketCount = 0;

  for (const ticket of tickets) {
    count += 1;
    services += servicesByTicket.get(ticket.id) ?? 0;
    subtotal += ticket.subtotal_cents / 100;
    tax += ticket.tax_cents / 100;

    const paymentsForTicket = succeededPaymentsByTicket.get(ticket.id) ?? [];
    let ticketRevenue = 0;
    let ticketTip = 0;
    for (const p of paymentsForTicket) {
      const dollars = p.amount_cents / 100;
      const tipDollars = p.tip_cents / 100;
      ticketRevenue += dollars + tipDollars;
      ticketTip += tipDollars;
      if (p.method === "card" || p.method === "cash" || p.method === "gift") {
        byMethod[p.method] += dollars + tipDollars;
      }
    }
    total += ticketRevenue;
    tip += ticketTip;

    // Per-ticket tip pct contributes to the avg only when subtotal is nonzero.
    if (ticket.subtotal_cents > 0) {
      tipPctSum += ticketTip / (ticket.subtotal_cents / 100);
      tipPctTicketCount += 1;
    }
  }

  const avgServicesPerSale = count > 0 ? services / count : 0;
  const tipPctAvg = tipPctTicketCount > 0 ? Math.round((tipPctSum / tipPctTicketCount) * 100) : 0;

  return {
    period,
    count,
    services,
    subtotal,
    tip,
    tax,
    total,
    byMethod,
    avgServicesPerSale,
    tipPctAvg,
  };
}
