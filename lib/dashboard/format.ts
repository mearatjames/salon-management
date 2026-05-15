import type { Service, TxLineItem } from "@/lib/dashboard/mock-data";

const CURRENCY_FMT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const PERCENT_FMT = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 0,
});

const COUNT_FMT = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

export function formatCurrency(amount: number): string {
  return CURRENCY_FMT.format(amount);
}

export function formatPercent(fraction: number): string {
  return PERCENT_FMT.format(fraction);
}

export function formatCount(n: number): string {
  return COUNT_FMT.format(n);
}

export function formatServiceLabel(
  items: readonly TxLineItem[],
  services: readonly Service[],
): string {
  if (items.length === 0) return "";
  const nameFor = (id: string): string => {
    const svc = services.find((s) => s.id === id);
    return svc ? svc.name : id;
  };
  if (items.length <= 2) {
    return items.map((it) => nameFor(it.id)).join(", ");
  }
  return `${nameFor(items[0].id)} +${items.length - 1} more`;
}

export function paymentMixWidths(
  byMethod: { card: number; cash: number; gift: number },
  total: number,
): { card: number; cash: number; gift: number; neutral: number } {
  if (total === 0) {
    return { card: 0, cash: 0, gift: 0, neutral: 100 };
  }
  return {
    card: (byMethod.card / total) * 100,
    cash: (byMethod.cash / total) * 100,
    gift: (byMethod.gift / total) * 100,
    neutral: 0,
  };
}
