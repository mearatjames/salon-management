// app/(studio)/checkout/_cart-draft.ts
//
// The ephemeral checkout draft (feature 043-checkout-ephemeral-draft).
//
// Before this feature, opening /checkout wrote an empty `tickets` row and
// every cart edit wrote a `ticket_items` row. Now the in-progress cart is
// an in-memory draft — nothing is written until the first payment-
// initiating action, at which point the whole cart is persisted once,
// atomically, by `pos_create_ticket_from_draft` (migration 0020).
//
// This module owns:
//   - the `CheckoutDraft` shape the client serializes and the server
//     receives (the client → server contract at submission), and
//   - `validateAndResolveDraft`, the server helper that re-validates and
//     resolves the draft against the catalog/staff BEFORE the RPC call.
//
// Authority boundary (Constitution Principle II): the draft is a
// PROPOSAL, never authority. Every field is re-validated at the
// persistence boundary. The only values trusted *from* the client are
// operator-authority fields the operator can already set through the
// existing per-edit actions — `unitPriceCents`, `assignedStaffId`,
// discount `shape`/`value`/`note`. The non-editable `name_snapshot` is
// re-derived from the catalog; the operator id and all timestamps/
// statuses are server-set.
//
// Contract: `specs/043-checkout-ephemeral-draft/contracts/checkout-draft.md`.

import type { SupabaseClient } from "@supabase/supabase-js";

import { computeTotals, type CartItem } from "@/lib/pos/cart";

import { TicketEmptyError, TicketHasUnpricedItemsError } from "./_errors";

// ----------------------------------------------------------------------
// Client → server payload types.
// ----------------------------------------------------------------------

export type DraftServiceLine = {
  kind: "service";
  /** crypto.randomUUID(), session-local, never persisted. */
  clientLineId: string;
  serviceId: string;
  /** Operator-authority — covers price override / variable price. */
  unitPriceCents: number;
  /** Must be false at submission (FR-015 guard). */
  priceUnconfirmed: boolean;
  assignedStaffId: string;
};

export type DraftDiscountLine = {
  kind: "discount";
  clientLineId: string;
  shape: "flat" | "percent";
  /** flat: cents; percent: whole-number percent. */
  value: number;
  /** <= 80 chars. */
  note: string | null;
};

export type DraftLine = DraftServiceLine | DraftDiscountLine;

export type CheckoutDraft = {
  lines: DraftLine[];
};

/**
 * Where a payment-initiating action sources the ticket from. `draft` is
 * the new ephemeral path — the action calls `validateAndResolveDraft` then
 * `pos_create_ticket_from_draft`. `ticket` is the legacy persisted path
 * (e.g. resuming an already-persisted ticket id).
 */
export type PaymentTarget =
  | { from: "draft"; draft: CheckoutDraft }
  | { from: "ticket"; ticketId: string };

// ----------------------------------------------------------------------
// Resolved line shapes — the `p_items` payload for the RPC.
// ----------------------------------------------------------------------

/** A fully-resolved service line, ready for `pos_create_ticket_from_draft`. */
export type ResolvedServiceItem = {
  kind: "service";
  ref_id: string;
  name_snapshot: string;
  unit_price_cents: number;
  assigned_staff_id: string;
  price_unconfirmed: false;
};

/** A fully-resolved discount line, ready for `pos_create_ticket_from_draft`. */
export type ResolvedDiscountItem = {
  kind: "discount";
  name_snapshot: string;
  /** Final negative (or zero) amount — percent discounts already folded. */
  unit_price_cents: number;
  /** Whole-percent value for percent-shape discounts; null for flat. */
  discount_pct: number | null;
  note: string | null;
};

export type ResolvedDraftItem = ResolvedServiceItem | ResolvedDiscountItem;

// ----------------------------------------------------------------------
// validateAndResolveDraft — the server-side re-validation + resolution.
// ----------------------------------------------------------------------
//
// Called by every draft-path payment action BEFORE
// `pos_create_ticket_from_draft`. Validation/resolution order matches
// `contracts/checkout-draft.md § Server-side validation & resolution`:
//
//   1. Non-empty: >= 1 service line, else `TicketEmptyError`.
//   2. No unconfirmed price: every service line `priceUnconfirmed === false`,
//      else `TicketHasUnpricedItemsError` (FR-015).
//   3. Service resolution: read `services` with NO `active` filter (an
//      archived service is still a valid row). Every serviceId must match;
//      a non-matching id is a corrupt draft → reject. `name_snapshot` is
//      taken from the catalog row, never the client.
//   4. Price integrity: each service line `unitPriceCents` is an integer
//      > 0 (same check as `setLinePrice`).
//   5. Staff: each `assignedStaffId` resolves to an active, non-removed
//      `staff` row (same check as `addServiceLine` / `setLineTech`).
//   6. Discount integrity: `shape ∈ {flat, percent}`; `value` in range;
//      `note` ≤ 80 chars (same checks as `addDiscountLine`).
//   7. Resolve discounts: fold each discount to a final negative
//      `unit_price_cents` via `computeTotals` against the service subtotal
//      (FR-007).
//   8. Total guard: resolved `total_cents` must be > 0, else
//      `TicketEmptyError`.
//
// The discount-validation refusals re-use `DiscountInvalidError` / the
// same `reason` buckets as `addDiscountLine`. The empty/unpriced/zero-total
// refusals re-use `TicketEmptyError` / `TicketHasUnpricedItemsError` so the
// UI sees identical messaging on the draft path and the legacy path.

export class DraftCorruptError extends Error {
  constructor(message = "checkout draft is corrupt") {
    super(message);
    this.name = "DraftCorruptError";
  }
}

import { DiscountInvalidError } from "./_errors";
import { InvalidPriceError, StaffNotActiveError } from "./_errors";

export async function validateAndResolveDraft(
  draft: CheckoutDraft,
  supabase: SupabaseClient
): Promise<ResolvedDraftItem[]> {
  const lines = draft.lines ?? [];
  const serviceLines = lines.filter((l): l is DraftServiceLine => l.kind === "service");
  const discountLines = lines.filter((l): l is DraftDiscountLine => l.kind === "discount");

  // 1) Non-empty — at least one service line.
  if (serviceLines.length === 0) {
    throw new TicketEmptyError();
  }

  // 2) No unconfirmed price — FR-015 guard, run against the draft.
  if (serviceLines.some((l) => l.priceUnconfirmed !== false)) {
    throw new TicketHasUnpricedItemsError();
  }

  // 4) Price integrity — each service line's unitPriceCents is a positive
  //    integer (same check as `setLinePrice`). Done before the catalog
  //    read so a corrupt amount fails fast.
  for (const line of serviceLines) {
    if (!Number.isInteger(line.unitPriceCents) || line.unitPriceCents <= 0) {
      throw new InvalidPriceError(
        `draft service line unitPriceCents must be a positive integer (got ${line.unitPriceCents})`
      );
    }
  }

  // 3) Service resolution — read `services` with NO `active` filter. An
  //    archived service is still a valid row (matches today's "already-
  //    added line survives archival"). `name_snapshot` comes from the
  //    catalog row, never the client.
  const serviceIds = Array.from(new Set(serviceLines.map((l) => l.serviceId)));
  const { data: serviceRows, error: svcErr } = await supabase
    .from("services")
    .select("id, name")
    .in("id", serviceIds);
  if (svcErr) {
    throw new Error(`validateAndResolveDraft service read failed: ${svcErr.message}`);
  }
  const servicesById = new Map<string, { id: string; name: string }>();
  for (const s of serviceRows ?? []) servicesById.set(s.id, s);
  for (const id of serviceIds) {
    if (!servicesById.has(id)) {
      throw new DraftCorruptError(`draft references unknown service ${id}`);
    }
  }

  // 5) Staff — each `assignedStaffId` resolves to an active, non-removed
  //    `staff` row (same check as `addServiceLine` / `setLineTech`).
  const staffIds = Array.from(new Set(serviceLines.map((l) => l.assignedStaffId)));
  const { data: staffRows, error: staffErr } = await supabase
    .from("staff")
    .select("id, active, removed_at")
    .in("id", staffIds);
  if (staffErr) {
    throw new Error(`validateAndResolveDraft staff read failed: ${staffErr.message}`);
  }
  const activeStaff = new Set<string>();
  for (const s of staffRows ?? []) {
    if (s.active === true && s.removed_at == null) activeStaff.add(s.id);
  }
  for (const id of staffIds) {
    if (!activeStaff.has(id)) {
      throw new StaffNotActiveError(`draft assigned staff ${id} is not active`);
    }
  }

  // Build the resolved service items.
  const resolvedServices: ResolvedServiceItem[] = serviceLines.map((line) => ({
    kind: "service",
    ref_id: line.serviceId,
    name_snapshot: servicesById.get(line.serviceId)!.name,
    unit_price_cents: line.unitPriceCents,
    assigned_staff_id: line.assignedStaffId,
    price_unconfirmed: false,
  }));

  // 6) Discount integrity — same per-shape checks as `addDiscountLine`.
  for (const line of discountLines) {
    if (line.shape !== "flat" && line.shape !== "percent") {
      throw new DiscountInvalidError(
        `unknown discount shape: ${JSON.stringify(line.shape)}`,
        "flat_value_non_positive"
      );
    }
    if (line.shape === "flat") {
      if (!Number.isInteger(line.value) || line.value <= 0) {
        throw new DiscountInvalidError(
          `flat discount value must be a positive integer cents (got ${line.value})`,
          "flat_value_non_positive"
        );
      }
    } else {
      if (!Number.isInteger(line.value) || line.value < 1 || line.value > 100) {
        throw new DiscountInvalidError(
          `percent discount value must be an integer in [1, 100] (got ${line.value})`,
          "percent_out_of_range"
        );
      }
    }
    if (line.note != null && line.note.length > 80) {
      throw new DiscountInvalidError(
        `discount note must be ≤ 80 characters (got ${line.note.length})`,
        "note_too_long"
      );
    }
  }

  // 7) Resolve discounts — fold each discount to a final negative
  //    `unit_price_cents` using `computeTotals` against the service
  //    subtotal, so the RPC receives ready-to-insert amounts and the
  //    persisted total equals what the operator saw on screen (FR-007).
  const cartItems: CartItem[] = [
    ...resolvedServices.map(
      (s): CartItem => ({
        kind: "service",
        unitPriceCents: s.unit_price_cents,
        qty: 1,
        priceUnconfirmed: false,
        discountPct: null,
      })
    ),
    ...discountLines.map(
      (d): CartItem => ({
        kind: "discount",
        // Flat: the negative amount verbatim. Percent: computeTotals
        // recomputes against the service subtotal — pass 0 here.
        unitPriceCents: d.shape === "flat" ? -d.value : 0,
        qty: 1,
        priceUnconfirmed: false,
        discountPct: d.shape === "percent" ? d.value : null,
      })
    ),
  ];
  const totals = computeTotals(cartItems);

  // Per-discount resolved amount. For a percent discount, the folded
  // amount is `-round(value * serviceSubtotal / 100)` — the same math
  // `computeTotals` runs internally.
  const resolvedDiscounts: ResolvedDiscountItem[] = discountLines.map((d) => {
    const amount =
      d.shape === "flat" ? -d.value : -Math.round((d.value * totals.serviceSubtotalCents) / 100);
    return {
      kind: "discount",
      name_snapshot: d.shape === "percent" ? `Discount · ${d.value}%` : "Discount",
      unit_price_cents: amount,
      discount_pct: d.shape === "percent" ? d.value : null,
      note: d.note,
    };
  });

  // 8) Total guard — the resolved total must be > 0, else refuse with the
  //    same empty/zero-total messaging as today.
  if (totals.totalCents <= 0) {
    throw new TicketEmptyError();
  }

  return [...resolvedServices, ...resolvedDiscounts];
}
