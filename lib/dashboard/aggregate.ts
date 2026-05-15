import { formatServiceLabel } from "@/lib/dashboard/format";
import {
  PERIOD_FACTOR,
  SERVICES,
  STAFF,
  TAX_RATE,
  TX_HISTORY,
} from "@/lib/dashboard/mock-data";
import type {
  DashboardPeriod,
  PaymentMethod,
  Technician,
  Transaction,
} from "@/lib/dashboard/mock-data";
import { Calendar, DollarSign, PersonStanding, Receipt } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type TxTotals = {
  subtotal: number;
  tip: number;
  tax: number;
  total: number;
  services: number;
};

export type TxAggregate = {
  count: number;
  services: number;
  subtotal: number;
  tip: number;
  tax: number;
  total: number;
  byMethod: { card: number; cash: number; gift: number };
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
  client: string;
  serviceLabel: string;
  techIds: readonly string[];
  method: PaymentMethod;
  total: number;
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
    eyebrow: "Lacquer Studio · Front desk";
    title: "Today at the salon";
    subtitle: string;
  };
  summaries: Record<DashboardPeriod, DashboardSummary>;
  staff: readonly Technician[];
  recent: readonly TransactionRow[];
  comparisons: {
    transactionsVsAvg: "+3 vs avg";
    revenueDelta: "+12%";
  };
  quickActions: readonly QuickAction[];
};

const QUICK_ACTIONS: readonly QuickAction[] = [
  {
    id: "calendar",
    label: "Today's calendar",
    hint: "See appointments + chairs",
    icon: Calendar,
    href: "/calendar",
  },
  {
    id: "walkin",
    label: "Quick walk-in",
    hint: "Skip the appointment book",
    icon: PersonStanding,
    href: "/walkin",
  },
  {
    id: "report",
    label: "Day report (X-out)",
    hint: "Sales by tech, by service",
    icon: Receipt,
    href: "/end-of-day?view=report",
  },
  {
    id: "cashout",
    label: "End-of-day cash",
    hint: "Reconcile the till",
    icon: DollarSign,
    href: "/end-of-day",
  },
];

export function txTotals(tx: Transaction): TxTotals {
  const subtotal = tx.items.reduce((s, it) => {
    const svc = SERVICES.find((x) => x.id === it.id);
    const price = it.price != null ? it.price : svc ? svc.price : 0;
    return s + price * (it.qty || 1);
  }, 0);
  const tip = subtotal * (tx.tipPct || 0);
  const tax = (subtotal + tip) * TAX_RATE;
  const total = subtotal + tip + tax;
  const services = tx.items.reduce((n, it) => n + (it.qty || 1), 0);
  return { subtotal, tip, tax, total, services };
}

export function txAggregate(list: readonly Transaction[]): TxAggregate {
  const agg: TxAggregate = {
    count: list.length,
    services: 0,
    subtotal: 0,
    tip: 0,
    tax: 0,
    total: 0,
    byMethod: { card: 0, cash: 0, gift: 0 },
  };
  for (const tx of list) {
    const t = txTotals(tx);
    agg.services += t.services;
    agg.subtotal += t.subtotal;
    agg.tip += t.tip;
    agg.tax += t.tax;
    agg.total += t.total;
    agg.byMethod[tx.method] = (agg.byMethod[tx.method] || 0) + t.total;
  }
  return agg;
}

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

export function applyPeriodFactor(
  base: TxAggregate,
  period: DashboardPeriod,
): DashboardSummary {
  if (base.count === 0) {
    return emptySummary(period);
  }
  const factor = PERIOD_FACTOR[period];
  const count = Math.round(base.count * factor);
  const services = Math.round(base.services * factor);
  const subtotal = base.subtotal * factor;
  const tip = base.tip * factor;
  const tax = base.tax * factor;
  const total = base.total * factor;
  const byMethod = {
    card: base.byMethod.card * factor,
    cash: base.byMethod.cash * factor,
    gift: base.byMethod.gift * factor,
  };
  const avgServicesPerSale = count > 0 ? services / count : 0;
  const tipPctAvg = subtotal > 0 ? Math.round((tip / subtotal) * 100) : 0;
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

function txToRow(tx: Transaction): TransactionRow {
  return {
    id: tx.id,
    time: tx.time,
    client: tx.client,
    serviceLabel: formatServiceLabel(tx.items, SERVICES),
    techIds: tx.techs,
    method: tx.method,
    total: Math.round(txTotals(tx).total),
  };
}

export function buildDashboardData(): DashboardData {
  const base = txAggregate(TX_HISTORY);
  const summaries: Record<DashboardPeriod, DashboardSummary> = {
    today: applyPeriodFactor(base, "today"),
    week: applyPeriodFactor(base, "week"),
    month: applyPeriodFactor(base, "month"),
  };
  const recent = TX_HISTORY.slice(-7).reverse().map(txToRow);
  return {
    greeting: {
      eyebrow: "Lacquer Studio · Front desk",
      title: "Today at the salon",
      subtitle: `Tuesday, May 12 · ${STAFF.length} techs on shift · Last sale 4:14 PM`,
    },
    summaries,
    staff: STAFF,
    recent,
    comparisons: {
      transactionsVsAvg: "+3 vs avg",
      revenueDelta: "+12%",
    },
    quickActions: QUICK_ACTIONS,
  };
}
