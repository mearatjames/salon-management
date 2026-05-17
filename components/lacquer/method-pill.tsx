// MethodPill — the payment-method chip used inside the recent-transactions
// feed. Extracted from the inline `<span className={`tx-meth-pill …`}>` in
// `recent-transactions-feed.tsx` so the new `split` variant has a single
// source of truth (FR-014a).
//
// Server Component. All chrome lives in `styles/dashboard.css` under
// `.tx-meth-pill[.card|.cash|.gift|.split]`.

import type { PaymentMethod } from "@/lib/dashboard/aggregate";

const LABEL: Record<PaymentMethod, string> = {
  card: "Card",
  cash: "Cash",
  gift: "Gift",
  split: "Split",
};

export type MethodPillProps = {
  method: PaymentMethod;
};

export function MethodPill({ method }: MethodPillProps) {
  return <span className={`tx-meth-pill ${method}`}>{LABEL[method]}</span>;
}
