"use client";

// CartBuildingScreen — the new ephemeral-cart UI for `/checkout`
// (Feature 042). Replaces the previous "create-then-edit" flow with a
// pure client experience: tech pick, service tiles, cart rows with
// per-row tech, discount sheet, and the four payment placeholder
// buttons. No Server Action is invoked while building the cart — see
// `_cart-context.tsx`. The four Submit buttons are wired up later
// (US1/US2/US3 phases) and render as disabled placeholders here so
// the rest of the UI stays renderable.
//
// Reuses the existing Lacquer chrome wholesale (TxHeader,
// TechAvatarRow, ServiceTiles, CartRowWithTech, Totals, DiscountSheet)
// — no redraw. The structural HTML uses the same `checkout-shell` /
// `checkout-body` / `checkout-cart` / `checkout-catalog` classes from
// `checkout.css`, matching the `[ticketId]` screen's layout 1:1.
//
// Constitution Principle II: every read/write here is local React
// state; the server is only consulted via the (placeholder) payment
// buttons in US1/2/3.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Plus } from "lucide-react";
import { toast } from "sonner";

import "./checkout.css";

import { CartRowWithTech } from "@/components/lacquer/checkout/cart-row-with-tech";
import { DiscountSheet } from "@/components/lacquer/checkout/discount-sheet";
import { GanNumpadSheet } from "@/components/lacquer/checkout/gan-numpad-sheet";
import { PaymentTiles, type PaymentMethod } from "@/components/lacquer/checkout/payment-tiles";
import { ServiceTiles, type ServiceTileService } from "@/components/lacquer/checkout/service-tiles";
import { TechAvatarRow } from "@/components/lacquer/checkout/tech-avatar-row";
import { Totals } from "@/components/lacquer/checkout/totals";
import { TxHeader } from "@/components/lacquer/checkout/tx-header";

import { buildCartItem, previewTotals } from "./_cart";
import { useCart } from "./_cart-context";
import {
  submitCashFromCart,
  submitGiftFromCart,
  sendCardToTerminalFromCart,
  splitTenderFromCart,
  type CommitResult,
} from "./actions";

type Staff = { id: string; display_name: string; color_token: string };

export type CartBuildingScreenProps = {
  staff: Staff[];
  services: ServiceTileService[];
  /**
   * Feature 042 (T019) — Square connection state, computed in
   * `page.tsx`. When true the Card + Gift tiles pickably-enable in
   * `PaymentTiles`. False is the safe default (matches the v1 state).
   */
  squareConnected?: boolean;
  /**
   * How many paired Square Terminal devices are visible. Card needs at
   * least one to be pickable (PaymentTiles enforces this).
   */
  devicesAvailable?: number;
  /**
   * Optional default device id to pass to `sendCardToTerminalFromCart`.
   * When omitted the action falls back to its own resolver (default
   * flag → single-device fallback).
   */
  defaultDeviceId?: string | null;
};

function fmtCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function CartBuildingScreen({
  staff,
  services,
  squareConnected = false,
  devicesAvailable = 0,
  defaultDeviceId = null,
}: CartBuildingScreenProps) {
  const router = useRouter();
  const { cart, actions } = useCart();

  // The header tech-pick mirrors `cart.techId`. Picking a tech also
  // sets the default tech for any subsequent service tile tap.
  const selectedStaffId = cart.techId;

  const [discountSheetOpen, setDiscountSheetOpen] = useState(false);

  // PaymentTiles is the canonical picker (Constitution Principle I).
  // US1 (this phase) wires Take cash + Take gift through the new
  // commit Server Actions. US2 wires Send to terminal, US3 wires
  // Split tender. Card and split remain disabled placeholders here.
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);

  // Pending state for the cash / gift commit Server Actions. While
  // `isPending` is true the cash CTA disables and the gift sheet's
  // Redeem button stalls — prevents double-submit.
  const [isPending, startTransition] = useTransition();

  // Gift-flow state. The cart-build screen mirrors `[ticketId]/`'s
  // GanNumpadSheet pattern: tapping the Gift tile opens the numpad
  // sheet; submitting the GAN calls `submitGiftFromCart`.
  const [giftSheetOpen, setGiftSheetOpen] = useState(false);

  const staffById = useMemo(() => {
    const m = new Map<string, Staff>();
    for (const s of staff) m.set(s.id, s);
    return m;
  }, [staff]);

  const totals = useMemo(() => previewTotals(cart), [cart]);

  function handlePickTech(staffId: string) {
    actions.setTech(staffId);
  }
  function handleClearTech() {
    actions.setTech(null);
  }

  function handlePickService(svc: ServiceTileService) {
    if (!selectedStaffId) return;
    const item = buildCartItem({
      serviceId: svc.id,
      techId: selectedStaffId,
      displayName: svc.name,
      // Variable-priced services keep $0 in the display cache. v1
      // ephemeral cart doesn't yet expose a price-override sheet;
      // a follow-up phase can re-introduce it by writing through
      // `actions.setItemNote`/etc. For now the operator picks
      // fixed-price tiles. Variable tiles still snap to $0.
      displayPriceCents: svc.variable_price ? 0 : svc.price_cents,
      displayDurationMinutes: svc.duration_min,
      note: null,
    });
    actions.addItem(item);
  }

  // ── Cash / gift commit handlers ──────────────────────────────────
  //
  // Both build the wire payload from the current cart (strip display-
  // only fields that the schema doesn't accept), call the Server
  // Action, and route the result:
  //   - ok:true  → reset the cart, push /checkout/<ticketId>
  //   - ok:false → toast the mapped error, keep cart intact for retry.
  //
  // Wrapped in `startTransition` so React keeps the UI responsive
  // while the action runs and `isPending` correctly disables the
  // submit buttons.

  function buildWirePayload() {
    return {
      customerId: cart.customerId,
      techId: cart.techId,
      items: cart.items.map((it) => ({
        serviceId: it.serviceId,
        techId: it.techId,
        note: it.note,
      })),
      discount: cart.discount,
      notes: cart.notes,
    };
  }

  function toastCommitError(result: Extract<CommitResult, { ok: false }>) {
    switch (result.code) {
      case "INVALID_CART":
        toast.error("Cart isn't valid. Refresh and try again.");
        break;
      case "STALE_SERVICE":
        toast.error("A service in the cart was deactivated. Remove it and try again.");
        break;
      case "INACTIVE_TECH":
        toast.error("A tech in the cart is no longer active. Pick someone else.");
        break;
      case "STALE_CUSTOMER":
        toast.error("The selected customer no longer exists.");
        break;
      case "INSUFFICIENT_CASH":
        toast.error("Cash tendered is less than the total.");
        break;
      case "GIFT_NOT_FOUND":
        toast.error("Gift card not found. Re-enter the number.");
        break;
      case "GIFT_INSUFFICIENT_BALANCE":
        toast.error("Gift card balance is less than the total.");
        break;
      case "GIFT_NOT_REDEEMABLE":
        toast.error("That gift card can't be redeemed.");
        break;
      case "TERMINAL_HANDOFF_FAILED":
        toast.error("Couldn't reach the card terminal. Try again.");
        break;
      case "INTERNAL":
      default:
        toast.error("Something went wrong. Try again.");
        break;
    }
  }

  function handleTakeCash() {
    if (isPending || cart.items.length === 0) return;
    const wire = buildWirePayload();
    const totalAtSubmit = totals.totalCents;
    startTransition(async () => {
      // Cash-tendered equal to the total covers the operator's "exact
      // change" expectation; a future Phase can prompt for a cash-
      // tendered amount and pass it explicitly.
      const result = await submitCashFromCart(wire, totalAtSubmit);
      if (result.ok) {
        actions.reset();
        router.push("/checkout/" + result.ticketId);
      } else {
        toastCommitError(result);
      }
    });
  }

  function handleSendCard() {
    if (isPending || cart.items.length === 0) return;
    const wire = buildWirePayload();
    startTransition(async () => {
      const result = await sendCardToTerminalFromCart(wire, defaultDeviceId ?? undefined);
      if (result.ok) {
        actions.reset();
        router.push("/checkout/" + result.ticketId);
      } else {
        toastCommitError(result);
      }
    });
  }

  function handleSplitTender() {
    if (isPending) return;
    // Empty cart: clear the radio so the operator isn't stuck looking at
    // a checked split tile with no path forward.
    if (cart.items.length === 0) {
      setPaymentMethod(null);
      return;
    }
    const wire = buildWirePayload();
    startTransition(async () => {
      const result = await splitTenderFromCart(wire);
      if (result.ok) {
        actions.reset();
        router.push("/checkout/" + result.ticketId);
      } else {
        toastCommitError(result);
      }
    });
  }

  function handleGiftSubmit(gan: string) {
    if (isPending || cart.items.length === 0) return;
    setGiftSheetOpen(false);
    const wire = buildWirePayload();
    // The display-friendly masked tail; the action passes the full
    // GAN to Square and uses this only for future audit/display work.
    const displayLabel = gan.replace(/\s/g, "").slice(-4);
    startTransition(async () => {
      const result = await submitGiftFromCart(wire, displayLabel, gan);
      if (result.ok) {
        actions.reset();
        router.push("/checkout/" + result.ticketId);
      } else {
        toastCommitError(result);
      }
    });
  }

  // Cash CTA enables when there's something to charge AND no in-flight
  // submit. Mirrors `[ticketId]/checkout-screen.client.tsx`'s
  // (chargeEligible && !inflight) shape but simplified since the
  // ephemeral cart doesn't have unconfirmed lines.
  const takeCashEnabled = cart.items.length > 0 && !isPending && totals.totalCents > 0;

  // Map ephemeral-cart items into the existing CartRowWithTech view.
  // `id` is the client-local id (the row never needs a server id while
  // building — at commit time the items are inserted as a batch and
  // each row gets a fresh server id).
  const lineViews = cart.items.map((it) => ({
    id: it.localId,
    serviceId: it.serviceId,
    name: it.displayName,
    unitPriceCents: it.displayPriceCents,
    qty: 1,
    priceUnconfirmed: false,
    assignedStaffId: it.techId,
    serviceMeta: null,
    kind: "service" as const,
    note: it.note,
    discountPct: null,
  }));

  return (
    <div className="checkout-shell" data-slot="checkout-shell" data-cart-building="true">
      {/* Cart-building phase: no `ticketId` yet, so TxHeader hides Cancel
          and Discard. The in-memory cart is GC'd on unmount; there is
          nothing to cancel or discard server-side. FR-006 / FR-007. */}
      <TxHeader subtitle="Walk-in" />
      <div className="checkout-body">
        {/* LEFT: cart column */}
        <section className="checkout-cart" aria-label="Cart">
          <TechAvatarRow
            staff={staff}
            selectedStaffId={selectedStaffId}
            onPick={handlePickTech}
            onClear={handleClearTech}
          />
          <div
            data-slot="checkout-cart-header"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "var(--space-2)",
              marginTop: "var(--space-3)",
            }}
          >
            <div
              style={{
                fontSize: "var(--text-xs)",
                textTransform: "uppercase",
                letterSpacing: "var(--tracking-wide)",
                fontWeight: 500,
                color: "var(--muted-foreground)",
              }}
            >
              Cart
            </div>
            <button
              type="button"
              className="tx-btn ghost"
              data-slot="add-discount-button"
              onClick={() => setDiscountSheetOpen(true)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--space-1)",
              }}
            >
              <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
              Discount
            </button>
          </div>

          <div className="checkout-cart-lines" data-slot="checkout-cart-lines">
            {lineViews.length === 0 ? (
              <p
                data-slot="checkout-cart-empty"
                style={{
                  margin: 0,
                  padding: "var(--space-6) 0",
                  fontSize: "var(--text-sm)",
                  color: "var(--muted-foreground)",
                  textAlign: "center",
                }}
              >
                {selectedStaffId
                  ? "Tap a service to start."
                  : "Pick a tech first, then tap a service."}
              </p>
            ) : (
              <>
                {lineViews.map((line) => (
                  <CartRowWithTech
                    key={line.id}
                    line={line}
                    staffById={staffById}
                    onRemove={() => actions.removeItem(line.id)}
                    onEditPrice={() => {
                      /* placeholder: variable-price override sheet
                         is not yet wired into the ephemeral cart; a
                         later phase can re-introduce the PriceSheet
                         flow via actions.setItemNote / a future
                         setItemPrice action. */
                    }}
                    onSetTech={(staffId) => actions.setItemTech(line.id, staffId)}
                  />
                ))}
                {cart.discount ? (
                  <div
                    data-slot="cart-discount-row"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "var(--space-2) var(--space-3)",
                      borderTop: "1px solid var(--border)",
                      fontSize: "var(--text-sm)",
                    }}
                  >
                    <span style={{ color: "var(--muted-foreground)" }}>
                      {cart.discount.kind === "percent"
                        ? `${cart.discount.percent}% discount`
                        : "Discount"}
                    </span>
                    <span style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
                      <span
                        className="tnum"
                        style={{ fontVariantNumeric: "tabular-nums", color: "var(--foreground)" }}
                      >
                        −{fmtCents(totals.discountCents)}
                      </span>
                      <button
                        type="button"
                        className="tx-btn ghost"
                        data-slot="remove-discount-button"
                        onClick={() => actions.setDiscount(null)}
                        aria-label="Remove discount"
                      >
                        Remove
                      </button>
                    </span>
                  </div>
                ) : null}
              </>
            )}
          </div>

          <Totals
            subtotalCents={totals.subtotalCents}
            taxCents={0}
            totalCents={totals.totalCents}
          />

          {/* Canonical Lacquer composition: PaymentTiles (cash | card |
              gift | split) + a primary cash CTA below. Mirrors the
              `[ticketId]/checkout-screen.client.tsx` footer 1:1 so the
              cart-build phase reuses the same visual language as the
              post-commit phase. squareConnected={false} in Phase 2 puts
              card + gift into the primitive's existing disabled-with-
              tooltip state. The cash CTA is hard-disabled because no
              handler exists yet — US1 lights it up, US2 wires the
              terminal CTA inside PaymentTiles, US3 wires onPickSplit. */}
          <PaymentTiles
            value={paymentMethod}
            onChange={setPaymentMethod}
            squareConnected={squareConnected}
            devicesAvailable={devicesAvailable}
            amountCents={totals.totalCents}
            onSendCard={handleSendCard}
            cardSendDisabled={isPending || cart.items.length === 0 || totals.totalCents <= 0}
            onPickGift={() => {
              if (cart.items.length === 0 || isPending) return;
              setGiftSheetOpen(true);
            }}
            onPickSplit={handleSplitTender}
          />
          <button
            type="button"
            data-testid="submit-cash"
            data-slot="take-cash-button"
            disabled={!takeCashEnabled}
            onClick={handleTakeCash}
            style={{
              marginTop: "var(--space-2)",
              width: "100%",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              height: "var(--space-10)",
              padding: "0 var(--space-4)",
              background: takeCashEnabled ? "var(--primary)" : "var(--muted)",
              color: takeCashEnabled ? "var(--primary-foreground)" : "var(--muted-foreground)",
              border: "none",
              borderRadius: "var(--radius-sm)",
              fontSize: "var(--text-base)",
              fontWeight: 600,
              cursor: takeCashEnabled ? "pointer" : "not-allowed",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {isPending ? "Submitting…" : `Take cash · ${fmtCents(totals.totalCents)}`}
          </button>
        </section>

        {/* RIGHT: service catalog column */}
        <section className="checkout-catalog" aria-label="Service catalog">
          <ServiceTiles
            services={services}
            disabled={!selectedStaffId}
            onPick={handlePickService}
          />
        </section>
      </div>

      {discountSheetOpen ? (
        <DiscountSheet
          onSave={async (payload) => {
            if (payload.shape === "flat") {
              actions.setDiscount({ kind: "amount", amountCents: payload.value });
            } else {
              actions.setDiscount({ kind: "percent", percent: payload.value });
            }
            setDiscountSheetOpen(false);
          }}
          onCancel={() => setDiscountSheetOpen(false)}
        />
      ) : null}

      {giftSheetOpen ? (
        <GanNumpadSheet
          busy={isPending}
          onSubmit={handleGiftSubmit}
          onCancel={() => setGiftSheetOpen(false)}
        />
      ) : null}
    </div>
  );
}
