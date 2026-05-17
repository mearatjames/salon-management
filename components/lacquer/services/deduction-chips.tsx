// DeductionChips — pure server component that renders the deduction chips
// shown on a catalog row's right-hand band.
//
// Per `specs/021-services-deductions/contracts/ui.contract.md § 4`:
//   - `card_fee_mode = 'default'` → blue chip `"$3 card fee"`.
//   - `card_fee_mode = 'custom'`  → rose-tinted chip `"$X card fee"` using
//     `card_fee_custom_cents` (defensive `?? 0` if mid-edit).
//   - `card_fee_mode = 'exempt'`  → no card-fee chip.
//   - `supply_amount_cents` present → amber `"${X} {label}"` chip after the
//     card-fee chip.
//   - `card_fee_mode = 'exempt'` AND no supply → single muted "No fees" chip.
//   - `card_fee_mode = 'exempt'` AND supply present → ONLY the supply chip
//     (no "No fees" chip, no card-fee chip).
//
// The component is a pure render — no client island, no internal state.
// Mounted by `catalog-row.tsx` once per service row.
//
// Token policy: every value resolves to a CSS class in `styles/settings.css`
// (`.deduction-chip` + `.deduction-chip--card-default` /
// `.deduction-chip--card-custom` / `.deduction-chip--supply` /
// `.deduction-chip--exempt-no-fees`). The component itself only sets
// `data-kind="..."` so the CSS can target the variant.

import { formatCardFeeChipText, formatSupplyChipText } from "@/app/(studio)/services/_format";
import type { CardFeeMode } from "@/app/(studio)/services/_types";

export type DeductionChipsProps = {
  card_fee_mode: CardFeeMode;
  card_fee_custom_cents: number | null;
  supply_amount_cents: number | null;
  supply_label: string | null;
  default_card_fee_cents: number;
};

type ChipKind = "card-default" | "card-custom" | "supply" | "exempt-no-fees";

export function DeductionChips(props: DeductionChipsProps) {
  const {
    card_fee_mode,
    card_fee_custom_cents,
    supply_amount_cents,
    supply_label,
    default_card_fee_cents,
  } = props;

  // Card-fee chip branch — `null` means "exempt", which renders no card-fee
  // chip on its own.
  const cardFeeText = formatCardFeeChipText(
    card_fee_mode,
    card_fee_custom_cents,
    default_card_fee_cents
  );

  const chips: Array<{ kind: ChipKind; text: string }> = [];

  if (cardFeeText !== null) {
    const cardKind: ChipKind = card_fee_mode === "custom" ? "card-custom" : "card-default";
    chips.push({ kind: cardKind, text: cardFeeText });
  }

  if (supply_amount_cents !== null) {
    chips.push({
      kind: "supply",
      text: formatSupplyChipText(supply_amount_cents, supply_label ?? ""),
    });
  }

  // Exempt + no supply → muted "No fees" chip per contract § 4.1. When
  // exempt + supply, we render ONLY the supply chip (already pushed above),
  // so this guard only fires when chips is still empty AND mode is exempt.
  if (chips.length === 0 && card_fee_mode === "exempt") {
    chips.push({ kind: "exempt-no-fees", text: "No fees" });
  }

  if (chips.length === 0) {
    // Still render the wrapper for a11y tree consistency (so screen readers
    // see the labelled deductions group even when empty), but with no chip
    // children. The wrapper is `display: inline-flex` with `gap: var(--space-1)`
    // — empty groups collapse to zero width.
    return <div role="group" aria-label="Deductions" className="deduction-chips" />;
  }

  return (
    <div role="group" aria-label="Deductions" className="deduction-chips">
      {chips.map((chip) => (
        <span
          key={chip.kind}
          data-kind={chip.kind}
          data-slot="deduction-chip"
          className={`deduction-chip deduction-chip--${chip.kind}`}
        >
          {chip.text}
        </span>
      ))}
    </div>
  );
}
