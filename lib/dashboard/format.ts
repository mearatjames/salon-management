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

// formatServiceLabel — drops the (items, services) lookup in favor of a
// pre-resolved names list. The query layer hands us non-discount item
// name_snapshots directly.
//   0 names → ""
//   1 name  → "{name}"
//   2 names → "{a}, {b}"
//   3+      → "{first}, +N more"
export function formatServiceLabel(names: readonly string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]}, ${names[1]}`;
  return `${names[0]}, +${names.length - 1} more`;
}

export function paymentMixWidths(
  byMethod: { card: number; cash: number; gift: number },
  total: number
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
