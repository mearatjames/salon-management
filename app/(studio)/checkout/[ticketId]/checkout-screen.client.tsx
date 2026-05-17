"use client";

// CheckoutScreen — client island that wires the cart together.
//
// Owned state:
//   - `selectedStaffId` (header tech pick; the default for new lines)
//   - `lines` (cart contents, with optimistic temp ids)
//   - `paymentMethod` (cash | null in this phase)
//   - `errorBanner` (FR-019 user-recoverable failures)
//   - `inflight` (set during terminal actions to lock the buttons)
//   - `placeholderLine` (the cart line whose price control opened the
//      variable-price placeholder dialog; null when closed)
//
// Behaviour:
//   - `addServiceLine` and `removeLine` use optimistic UI (R9). Temp ids
//     get replaced with server-returned ids on success; on failure the
//     optimistic mutation is reverted and an error banner is surfaced.
//   - `takeCash` and `discardTicket` are terminal — they wait for the
//     server to confirm before navigating.
//
// Totals are re-derived from `computeTotals` each render. The server's
// `tickets.total_cents` is the authority — at charge time `pos_take_cash`
// reads it from the locked row, not from the client view.

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Plus, Printer } from "lucide-react";
import { toast } from "sonner";

import {
  addDiscountLine,
  addServiceLine,
  cancelTerminalPayment,
  discardTicket,
  emailBillStub,
  removeDiscountLine,
  removeLine,
  sendCardToTerminal,
  setLinePrice,
  setLineTech,
  takeCash,
} from "@/app/(studio)/checkout/actions";
import {
  CashPaymentFailedError,
  DiscountInvalidError,
  InvalidPriceError,
  PaymentNotCancellableError,
  PaymentNotFoundError,
  ServiceArchivedError,
  SquareCheckoutCreateFailedError,
  SquareNotConnectedError,
  SquareReconnectRequiredError,
  StaffNotActiveError,
  TerminalDeviceRequiredError,
  TicketAlreadyTerminalError,
  TicketEmptyError,
  TicketHasUnpricedItemsError,
  TicketNotOpenError,
} from "@/app/(studio)/checkout/_errors";
import { CardWaiting } from "@/components/lacquer/checkout/card-waiting";
import { subscribePaymentChanges } from "@/lib/realtime/payments";

import { BillSheet, type BillSnapshot } from "@/components/lacquer/checkout/bill-sheet";
import {
  CartRowWithTech,
  type CartLineView,
} from "@/components/lacquer/checkout/cart-row-with-tech";
import { DiscountSheet } from "@/components/lacquer/checkout/discount-sheet";
import { EmailBillDialog } from "@/components/lacquer/checkout/email-bill-dialog";
import { PaymentTiles, type PaymentMethod } from "@/components/lacquer/checkout/payment-tiles";
import { PriceSheet } from "@/components/lacquer/checkout/price-sheet";
import { ServiceTiles, type ServiceTileService } from "@/components/lacquer/checkout/service-tiles";
import { TechAvatarRow } from "@/components/lacquer/checkout/tech-avatar-row";
import { Totals } from "@/components/lacquer/checkout/totals";
import { TxHeader } from "@/components/lacquer/checkout/tx-header";

import { computeTotals } from "@/lib/pos/cart";

type Staff = { id: string; display_name: string; color_token: string };

export type TerminalDevicePropView = {
  squareDeviceId: string;
  friendlyName: string;
  isDefault: boolean;
};

export type CheckoutScreenProps = {
  ticketId: string;
  initialItems: CartLineView[];
  staff: Staff[];
  services: ServiceTileService[];
  /** Salon-info settings for the BillSheet masthead (US4 / T040). */
  salonInfo: { name: string; address: string; phone: string };
  /** US2: presence of singleton `square_oauth` row. */
  squareConnected?: boolean;
  /** US2: the salon's `is_default = true` device, or null. */
  defaultDeviceId?: string | null;
  /** US2: friendly name for the default device (or "Square Terminal"). */
  defaultDeviceFriendlyName?: string | null;
  /** US2: every paired device, in display order. */
  pairedDevices?: TerminalDevicePropView[];
  /** US2: `square_oauth.refresh_failed_at IS NOT NULL`. */
  requiresReconnect?: boolean;
};

function tempId(): string {
  return `tmp-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
}

function fmt(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function CheckoutScreen({
  ticketId,
  initialItems,
  staff,
  services,
  salonInfo,
  squareConnected = false,
  defaultDeviceId = null,
  defaultDeviceFriendlyName = null,
  pairedDevices = [],
  requiresReconnect = false,
}: CheckoutScreenProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Header tech pick defaults to the first service line's assigned staff if
  // the ticket was already non-empty when the page loaded; otherwise null.
  // Discount rows don't carry an assigned staff (assigned_staff_id IS NULL).
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(
    initialItems.find((l) => l.kind === "service")?.assignedStaffId ?? null
  );
  const [lines, setLines] = useState<CartLineView[]>(initialItems);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [inflight, setInflight] = useState(false);
  // 013-cart-polish US1/US2: the price sheet replaces phase-2's placeholder
  // dialog. `isOverride=false` is the US1 auto-open path (Remove rendered);
  // `isOverride=true` is the US2 row-level override path (Remove hidden).
  const [priceSheet, setPriceSheet] = useState<{ lineId: string; isOverride: boolean } | null>(
    null
  );
  // 013-cart-polish US3: discount sheet open state. The sheet itself owns its
  // working amount/note + radio state; this island just toggles visibility.
  const [discountSheetOpen, setDiscountSheetOpen] = useState(false);
  // 013-cart-polish US4: BillSheet shows a frozen snapshot of the cart at
  // open time. The snapshot is captured by deep-cloning the live lines and
  // freezing in the totals so subsequent cart edits don't mutate what the
  // operator is looking at on paper. EmailBillDialog is a separate modal
  // mounted on top of the BillSheet.
  const [billSnapshot, setBillSnapshot] = useState<BillSnapshot | null>(null);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  // US2 (015) — card payment flow state.
  // stage: 'cart' = default, 'waiting' = terminal prompt in flight, 'card-failed' = inline retry UI.
  const [cardStage, setCardStage] = useState<"cart" | "waiting" | "card-failed">("cart");
  const [activeCardPaymentId, setActiveCardPaymentId] = useState<string | null>(null);
  const [cardFailureReason, setCardFailureReason] = useState<string | null>(null);
  // We need a ref to the latest activeCardPaymentId so the polling
  // setInterval (set up once at waiting-stage start) can read the current
  // id without re-subscribing on every render.
  const activeCardPaymentRef = useRef<string | null>(null);
  useEffect(() => {
    activeCardPaymentRef.current = activeCardPaymentId;
  }, [activeCardPaymentId]);

  const staffById = useMemo(() => {
    const m = new Map<string, Staff>();
    for (const s of staff) m.set(s.id, s);
    return m;
  }, [staff]);

  const totals = useMemo(
    () =>
      computeTotals(
        // US3 (T031) widened the local view to pass the discriminator and
        // discountPct so percent-discount rows can be recomputed against the
        // live service subtotal client-side (mirrors the server's
        // `recomputeTicketTotals`). The server stays the authority — see
        // `lib/pos/cart.ts` comments.
        lines.map((l) => ({
          kind: l.kind,
          unitPriceCents: l.unitPriceCents,
          qty: l.qty,
          priceUnconfirmed: l.priceUnconfirmed,
          discountPct: l.discountPct,
        }))
      ),
    [lines]
  );

  const takeCashEnabled = !inflight && paymentMethod === "cash" && totals.chargeEligible;

  function handlePickTech(staffId: string) {
    setSelectedStaffId(staffId);
  }

  function handleClearTech() {
    setSelectedStaffId(null);
  }

  function handlePickService(svc: ServiceTileService) {
    if (!selectedStaffId) return;
    const tmp = tempId();
    const optimisticLine: CartLineView = {
      id: tmp,
      serviceId: svc.id,
      name: svc.name,
      // Variable-priced services start at $0 unconfirmed; fixed-price
      // services snapshot the catalog price.
      unitPriceCents: svc.variable_price ? 0 : svc.price_cents,
      qty: 1,
      priceUnconfirmed: svc.variable_price,
      assignedStaffId: selectedStaffId,
      // Snapshot the tile's variable-price metadata onto the line so the
      // PriceSheet can render bounds + presets without re-fetching.
      serviceMeta: {
        variable: svc.variable_price,
        priceFromCents: svc.price_from_cents ?? null,
        priceToCents: svc.price_to_cents ?? null,
        variableNote: svc.variable_price_note ?? null,
        presets: svc.presets ?? null,
      },
      // US3 widening — service rows carry kind='service' and null note/pct.
      kind: "service",
      note: null,
      discountPct: null,
    };
    setLines((prev) => [...prev, optimisticLine]);
    setErrorBanner(null);

    startTransition(async () => {
      try {
        const { lineId } = await addServiceLine({
          ticketId,
          serviceId: svc.id,
          assignedStaffId: selectedStaffId,
        });
        // Swap the temp id for the server-returned one.
        setLines((prev) => prev.map((l) => (l.id === tmp ? { ...l, id: lineId } : l)));
        // FR-001: auto-open the price sheet for variable-priced services
        // as soon as the server confirms the row exists.
        if (svc.variable_price) {
          setPriceSheet({ lineId, isOverride: false });
        }
      } catch (err) {
        // Revert the optimistic insert.
        setLines((prev) => prev.filter((l) => l.id !== tmp));
        if (err instanceof StaffNotActiveError) {
          setErrorBanner("That tech is no longer active. Pick another.");
        } else if (err instanceof ServiceArchivedError) {
          setErrorBanner("That service is no longer available.");
        } else if (err instanceof TicketNotOpenError) {
          setErrorBanner("This ticket is no longer open.");
        } else {
          setErrorBanner("Couldn’t add that service. Try again.");
        }
      }
    });
  }

  function handleRemoveLine(line: CartLineView) {
    const snapshot = lines;
    setLines((prev) => prev.filter((l) => l.id !== line.id));
    setErrorBanner(null);

    // Skip the round-trip for optimistic-only temp lines (the server
    // never saw them).
    if (line.id.startsWith("tmp-")) return;

    // US3 (T031): dispatch the right Server Action based on the line's
    // kind. Discount rows route through `removeDiscountLine`, which emits
    // a `discount.removed` audit (not `ticket.line_removed`) and refuses
    // if the row isn't actually kind='discount' (defense-in-depth).
    const removeFn = line.kind === "discount" ? removeDiscountLine : removeLine;

    startTransition(async () => {
      try {
        await removeFn({ ticketId, lineId: line.id });
      } catch (err) {
        // Revert.
        setLines(snapshot);
        if (err instanceof TicketNotOpenError) {
          setErrorBanner("This ticket is no longer open.");
        } else {
          setErrorBanner("Couldn’t remove that line. Try again.");
        }
      }
    });
  }

  // US3 (T031): add a discount line. Wraps `addDiscountLine` (Server Action)
  // and surfaces typed errors via the inline banner. The discount sheet
  // closes on success; on failure the sheet stays open so the operator can
  // retry (the DiscountSheet's own `.catch` re-enables Save).
  async function handleAddDiscount(payload: {
    shape: "flat" | "percent";
    value: number;
    note: string | undefined;
  }): Promise<void> {
    setErrorBanner(null);
    try {
      const result = await addDiscountLine({
        ticketId,
        shape: payload.shape,
        value: payload.value,
        note: payload.note,
      });
      // Append the new discount row to the local view so the cart total
      // recomputes immediately. The displayed amount for percent rows is
      // derived in render via computeTotals against the live service
      // subtotal — we don't need to track the server-computed amount here.
      setLines((prev) => [
        ...prev,
        {
          id: result.lineId,
          serviceId: null,
          name: payload.shape === "percent" ? `Discount · ${payload.value}%` : "Discount",
          unitPriceCents: payload.shape === "flat" ? -payload.value : 0,
          qty: 1,
          priceUnconfirmed: false,
          assignedStaffId: null,
          kind: "discount",
          note: payload.note ?? null,
          discountPct: payload.shape === "percent" ? payload.value : null,
          serviceMeta: null,
        },
      ]);
      setDiscountSheetOpen(false);
    } catch (err) {
      if (err instanceof DiscountInvalidError) {
        // The sheet's client validation matches the server's; this branch
        // catches programmer error or stale state.
        setErrorBanner("That discount isn’t valid. Check the amount and try again.");
      } else if (err instanceof TicketNotOpenError) {
        setDiscountSheetOpen(false);
        setErrorBanner("This ticket is no longer open.");
      } else {
        setErrorBanner("Couldn’t add that discount. Try again.");
      }
      // Re-throw so DiscountSheet's .catch can re-enable Save.
      throw err;
    }
  }

  function handleSetLineTech(line: CartLineView, newStaffId: string) {
    // Discount rows don't have an assigned staff; the discount-row branch in
    // CartRowWithTech doesn't render the tech chip, so this callback should
    // never fire for kind='discount'. Defensive guard for type-narrowing.
    if (line.kind !== "service" || line.assignedStaffId == null) return;
    if (newStaffId === line.assignedStaffId) return;
    const previousStaffId = line.assignedStaffId;

    // Optimistic chip update.
    setLines((prev) =>
      prev.map((l) => (l.id === line.id ? { ...l, assignedStaffId: newStaffId } : l))
    );
    setErrorBanner(null);

    // Skip the round-trip for optimistic-only temp lines (the server has
    // not yet seen the row; the eventual addServiceLine insert will carry
    // the latest selectedStaffId, not this override).
    if (line.id.startsWith("tmp-")) return;

    startTransition(async () => {
      try {
        await setLineTech({
          ticketId,
          lineId: line.id,
          assignedStaffId: newStaffId,
        });
      } catch (err) {
        // Snap back to the previous assignment.
        setLines((prev) =>
          prev.map((l) => (l.id === line.id ? { ...l, assignedStaffId: previousStaffId } : l))
        );
        if (err instanceof StaffNotActiveError) {
          setErrorBanner("That tech is no longer active. Pick another.");
        } else if (err instanceof TicketNotOpenError) {
          setErrorBanner("This ticket is no longer open.");
        } else {
          setErrorBanner("Couldn’t change tech. Try again.");
        }
      }
    });
  }

  function handleEditPrice(line: CartLineView) {
    // FR-001 / FR-009: tapping the price button opens the price sheet.
    // Unconfirmed rows land in US1's auto-open mode (Remove rendered);
    // confirmed rows land in US2's override mode (Remove hidden).
    // Skip temp-id rows — the server hasn't confirmed them yet, so a
    // setLinePrice call would 404. The auto-open via handlePickService
    // already covered the variable-price case for fresh inserts; the
    // user can re-open after the temp id swaps.
    if (line.id.startsWith("tmp-")) return;
    // US3: discount rows have no price-edit affordance (setLinePrice throws
    // InvalidPriceError on kind='discount'). Defensive guard.
    if (line.kind === "discount") return;
    setPriceSheet({ lineId: line.id, isOverride: !line.priceUnconfirmed });
  }

  async function handlePriceSheetSave(unitPriceCents: number) {
    if (!priceSheet) return;
    const { lineId } = priceSheet;
    setErrorBanner(null);
    try {
      await setLinePrice({ ticketId, lineId, unitPriceCents });
      // Local update: clear the unconfirmed flag and reflect the new
      // price so the cart total recomputes immediately.
      setLines((prev) =>
        prev.map((l) => (l.id === lineId ? { ...l, unitPriceCents, priceUnconfirmed: false } : l))
      );
      setPriceSheet(null);
    } catch (err) {
      if (err instanceof InvalidPriceError) {
        setErrorBanner("Enter a price greater than $0.");
      } else if (err instanceof TicketNotOpenError) {
        setPriceSheet(null);
        setErrorBanner("This ticket is no longer open.");
      } else {
        setErrorBanner("Couldn’t save that price. Try again.");
      }
    }
  }

  function handlePriceSheetRemove() {
    if (!priceSheet) return;
    const line = lines.find((l) => l.id === priceSheet.lineId);
    if (line) handleRemoveLine(line);
    setPriceSheet(null);
  }

  async function handleTakeCash() {
    if (!takeCashEnabled || inflight) return;
    setInflight(true);
    setErrorBanner(null);
    try {
      await takeCash({ ticketId });
      router.refresh();
    } catch (err) {
      if (err instanceof TicketHasUnpricedItemsError) {
        setErrorBanner("Set price on highlighted items before charging.");
      } else if (err instanceof TicketNotOpenError) {
        setErrorBanner("This ticket is no longer open.");
      } else if (err instanceof TicketEmptyError) {
        setErrorBanner("Add at least one priced line before charging.");
      } else if (err instanceof CashPaymentFailedError) {
        setErrorBanner("Cash payment didn’t save — try again.");
      } else {
        setErrorBanner("Couldn’t take cash. Try again.");
      }
    } finally {
      setInflight(false);
    }
  }

  async function handleDiscard() {
    if (inflight) return;
    setInflight(true);
    setErrorBanner(null);
    try {
      await discardTicket({ ticketId });
      router.push("/dashboard");
    } catch (err) {
      if (err instanceof TicketAlreadyTerminalError) {
        setErrorBanner("This ticket was already closed.");
      } else {
        setErrorBanner("Couldn’t discard. Try again.");
      }
    } finally {
      setInflight(false);
    }
  }

  function handleCancel() {
    router.push("/dashboard");
  }

  // ----------------------------------------------------------------------
  // US2 (015) — Card payment flow.
  //
  // handleSendCard fires when the operator taps "Send to Square Terminal".
  // It calls sendCardToTerminal (Server Action), transitions to the
  // waiting stage, and lets the realtime/polling effect take over.
  //
  // The realtime+polling useEffect:
  //   - opens a Supabase Realtime channel scoped to this ticket
  //   - starts a 5s polling timer against the polling endpoint
  //   - on EITHER signal observing status=succeeded → router.refresh()
  //     (which re-renders the page; the paid-status branch shows
  //     DoneScreen)
  //   - on status=failed → transitions to card-failed stage for inline
  //     retry UI
  //   - tears down both on unmount/cancel/advance (research R10).
  // ----------------------------------------------------------------------

  async function handleSendCard() {
    if (cardStage !== "cart" || inflight) return;
    if (paymentMethod !== "card") return;

    setInflight(true);
    setErrorBanner(null);
    try {
      const { paymentId } = await sendCardToTerminal(ticketId, defaultDeviceId ?? undefined);
      setActiveCardPaymentId(paymentId);
      setCardStage("waiting");
    } catch (err) {
      if (err instanceof SquareNotConnectedError) {
        setErrorBanner("Square isn’t connected. Connect it in settings to accept cards.");
      } else if (err instanceof SquareReconnectRequiredError) {
        setErrorBanner("Square needs to be reconnected. Open settings to fix it.");
      } else if (err instanceof TerminalDeviceRequiredError) {
        setErrorBanner("Pair a Square Terminal (or pick a default in settings) before charging.");
      } else if (err instanceof SquareCheckoutCreateFailedError) {
        setErrorBanner("Could not reach Square. Try again or pick a different method.");
      } else if (err instanceof TicketHasUnpricedItemsError) {
        setErrorBanner("Set price on highlighted items before charging.");
      } else if (err instanceof TicketEmptyError) {
        setErrorBanner("Add at least one priced line before charging.");
      } else if (err instanceof TicketNotOpenError) {
        setErrorBanner("This ticket is no longer open.");
      } else {
        setErrorBanner("Couldn’t start the card payment. Try again.");
      }
    } finally {
      setInflight(false);
    }
  }

  function returnToPickerFromWaiting() {
    setCardStage("cart");
    setActiveCardPaymentId(null);
    setCardFailureReason(null);
    setPaymentMethod(null);
  }

  // US3 (T045): wire the waiting-screen Cancel link to the server action.
  //
  // The action calls Square's cancelCheckout and returns one of three
  // resolved statuses:
  //   - 'cancelled'       → row settled to failed/cancelled_by_operator
  //                          → return to picker (failure inline screen is
  //                            unnecessary; the operator's intent was
  //                            honoured cleanly).
  //   - 'race_succeeded'  → Square's response said COMPLETED before the
  //                          cancel reached the terminal. Row is now
  //                          succeeded; advance to Done with a one-time
  //                          toast explaining the race outcome.
  //   - 'still_pending'   → Square unreachable. Keep the waiting screen
  //                          open; the existing realtime/poll path will
  //                          resolve the row when Square / webhook catches
  //                          up. Surface a calm inline note so the operator
  //                          knows the cancel didn't bite.
  async function handleCancelTerminalPayment() {
    const id = activeCardPaymentRef.current;
    if (!id || inflight) return;
    setInflight(true);
    setErrorBanner(null);
    try {
      const result = await cancelTerminalPayment(id);
      if (result.resolvedStatus === "cancelled") {
        returnToPickerFromWaiting();
      } else if (result.resolvedStatus === "race_succeeded") {
        toast.success(
          "Card was charged before cancel reached the terminal. Showing the successful payment."
        );
        // The ticket has flipped to paid via the RPC; refresh the page so
        // the server-side branch renders the DoneScreen.
        router.refresh();
      } else {
        // still_pending — keep the waiting screen, let the realtime/poll
        // path finish the job. Surface a soft note so the operator
        // understands why nothing changed yet.
        setErrorBanner("Couldn’t reach Square to cancel. Waiting for the terminal to settle.");
      }
    } catch (err) {
      if (err instanceof PaymentNotCancellableError) {
        // Row already settled — refresh so the latest state renders.
        router.refresh();
      } else if (err instanceof PaymentNotFoundError) {
        setErrorBanner("That payment is no longer pending.");
        returnToPickerFromWaiting();
      } else {
        setErrorBanner("Couldn’t cancel the card payment. Try again.");
      }
    } finally {
      setInflight(false);
    }
  }

  async function pollOnce(): Promise<void> {
    const id = activeCardPaymentRef.current;
    if (!id) return;
    try {
      const res = await fetch(`/api/square/terminal-checkout/${id}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const body = (await res.json()) as
        | { status: "pending" }
        | { status: "succeeded"; tipCents: number }
        | { status: "failed"; reason: string };
      if (body.status === "succeeded") {
        router.refresh();
      } else if (body.status === "failed") {
        setCardStage("card-failed");
        setCardFailureReason(body.reason);
      }
    } catch {
      // Network blip; the next interval will re-try.
    }
  }

  useEffect(() => {
    if (cardStage !== "waiting" || !activeCardPaymentId) return;

    // Realtime channel — fires on UPDATE events for this ticket's
    // payment rows. We re-check the polling endpoint on every event to
    // get the canonical poll-shaped response (status + reason).
    const unsubscribe = subscribePaymentChanges(ticketId, () => {
      void pollOnce();
    });

    // Polling timer — 5s cadence; fires immediately once on mount so
    // the first signal arrives within ~5s in the lost-realtime case
    // (research R5).
    const interval = window.setInterval(() => {
      void pollOnce();
    }, 5000);

    return () => {
      unsubscribe();
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardStage, activeCardPaymentId, ticketId]);

  async function handleCardFailedRetry() {
    // Insert a fresh attempt — sendCardToTerminal handles the per-attempt
    // row contract (FR-015): a new pending row, new payment_id. We bypass
    // `handleSendCard`'s `cardStage !== 'cart'` guard because React state
    // updates are async and the cart-stage reset wouldn't be visible to
    // the next call yet. Inline the same body here, then move to waiting.
    if (inflight) return;
    setCardFailureReason(null);
    setInflight(true);
    setErrorBanner(null);
    try {
      const { paymentId } = await sendCardToTerminal(ticketId, defaultDeviceId ?? undefined);
      setActiveCardPaymentId(paymentId);
      setCardStage("waiting");
    } catch (err) {
      if (err instanceof SquareNotConnectedError) {
        setErrorBanner("Square isn’t connected. Connect it in settings to accept cards.");
      } else if (err instanceof SquareReconnectRequiredError) {
        setErrorBanner("Square needs to be reconnected. Open settings to fix it.");
      } else if (err instanceof TerminalDeviceRequiredError) {
        setErrorBanner("Pair a Square Terminal (or pick a default in settings) before charging.");
      } else if (err instanceof SquareCheckoutCreateFailedError) {
        setErrorBanner("Could not reach Square. Try again or pick a different method.");
      } else if (err instanceof TicketHasUnpricedItemsError) {
        setErrorBanner("Set price on highlighted items before charging.");
      } else if (err instanceof TicketEmptyError) {
        setErrorBanner("Add at least one priced line before charging.");
      } else if (err instanceof TicketNotOpenError) {
        setErrorBanner("This ticket is no longer open.");
      } else {
        setErrorBanner("Couldn’t start the card payment. Try again.");
      }
      // Drop back to picker so the operator can recover.
      setCardStage("cart");
      setActiveCardPaymentId(null);
    } finally {
      setInflight(false);
    }
  }

  function handleCardFailedPickAnother() {
    returnToPickerFromWaiting();
  }

  // US4 (T041): capture a frozen snapshot of the cart at the moment Bill
  // is tapped. Deep-clone the lines so subsequent cart mutations don't
  // bleed into what the operator is looking at on paper (research.md § R14).
  // Percent-discount rows' unit_price_cents is recomputed against the
  // current service subtotal so the snapshot matches what the bill totals
  // display. capturedAt drives the bill's decorative Check # field.
  function handleOpenBill() {
    const liveServiceSubtotalCents = lines
      .filter((l) => l.kind === "service" && !l.priceUnconfirmed)
      .reduce((sum, l) => sum + l.unitPriceCents * l.qty, 0);

    const snapshotLines = lines.map((l) => {
      const displayUnitPriceCents =
        l.kind === "discount" && l.discountPct != null
          ? -Math.round((l.discountPct * liveServiceSubtotalCents) / 100)
          : l.unitPriceCents;
      return {
        id: l.id,
        kind: l.kind,
        name: l.name,
        unitPriceCents: displayUnitPriceCents,
        qty: l.qty,
        note: l.note,
        discountPct: l.discountPct,
      };
    });

    setBillSnapshot({
      lines: structuredClone(snapshotLines),
      serviceSubtotalCents: totals.serviceSubtotalCents,
      discountTotalCents: totals.discountTotalCents,
      totalCents: totals.totalCents,
      capturedAt: new Date().toISOString(),
    });
  }

  // US4 (T041): wrap the emailBillStub action with the toast + cart-banner
  // surface. The dialog itself owns the in-flight + inline-error state;
  // we just dispatch the action and let the result propagate.
  async function handleEmailBill(address: string): Promise<void> {
    if (!billSnapshot) {
      throw new Error("billSnapshot is null — should not happen");
    }
    await emailBillStub({
      ticketId,
      address,
      snapshot: billSnapshot,
    });
    toast.success(`Bill emailed to ${address}`);
  }

  const priceSheetLine = priceSheet
    ? (lines.find((l) => l.id === priceSheet.lineId) ?? null)
    : null;

  // Tech name for the bill's "Tech" meta row — the first service line's
  // assigned staff. Discount rows carry no tech, so look only at service rows.
  const billTechName = ((): string | null => {
    const firstService = lines.find((l) => l.kind === "service");
    if (!firstService || !firstService.assignedStaffId) return null;
    const s = staffById.get(firstService.assignedStaffId);
    return s ? s.display_name : null;
  })();

  // US2 (015): when a card payment is in flight, render the waiting
  // screen full-width. The cart + catalog drop out so the operator's
  // focus is on the terminal. On cancel we return to the picker.
  if (cardStage === "waiting") {
    return (
      <div className="checkout-shell" data-slot="checkout-shell" data-ticket-id={ticketId}>
        <TxHeader
          subtitle="Walk-in"
          onCancel={() => void handleCancelTerminalPayment()}
          onDiscard={handleDiscard}
          disabled={inflight}
        />
        <CardWaiting
          amountCents={totals.totalCents}
          deviceFriendlyName={defaultDeviceFriendlyName ?? "Square Terminal"}
          onCancel={() => void handleCancelTerminalPayment()}
        />
        {errorBanner ? (
          <p
            role="alert"
            data-slot="card-waiting-notice"
            style={{
              margin: "0 auto",
              maxWidth: "calc(var(--space-16) * 6)",
              padding: "var(--space-2) var(--space-3)",
              background: "color-mix(in oklch, var(--muted) 60%, transparent)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              color: "var(--muted-foreground)",
              fontSize: "var(--text-sm)",
              fontWeight: 500,
              textAlign: "center",
            }}
          >
            {errorBanner}
          </p>
        ) : null}
      </div>
    );
  }

  if (cardStage === "card-failed") {
    // Map failure_reason → calm sentence-case copy per the US3 spec.
    // Unknown reasons fall back to a generic "Card payment failed".
    const failureCopy =
      cardFailureReason === "declined"
        ? "Card declined"
        : cardFailureReason === "device_offline"
          ? "Terminal not reachable"
          : cardFailureReason === "cancelled_by_operator"
            ? "Payment cancelled"
            : cardFailureReason === "expired"
              ? "Payment timed out"
              : cardFailureReason === "square_unreachable"
                ? "Couldn’t reach Square"
                : "Card payment failed";

    return (
      <div className="checkout-shell" data-slot="checkout-shell" data-ticket-id={ticketId}>
        <TxHeader
          subtitle="Walk-in"
          onCancel={returnToPickerFromWaiting}
          onDiscard={handleDiscard}
          disabled={inflight}
        />
        <div
          data-slot="card-failed"
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "var(--space-5)",
            padding: "var(--space-8)",
            textAlign: "center",
          }}
        >
          <div
            data-slot="card-failed-title"
            style={{
              fontSize: "var(--text-2xl)",
              fontWeight: 600,
              color: "var(--foreground)",
              letterSpacing: "var(--tracking-snug)",
            }}
          >
            {failureCopy}
          </div>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <button
              type="button"
              data-slot="card-failed-retry"
              onClick={() => void handleCardFailedRetry()}
              disabled={inflight}
              style={{
                height: "var(--space-10)",
                padding: "0 var(--space-4)",
                background: "var(--primary)",
                color: "var(--primary-foreground)",
                border: "none",
                borderRadius: "var(--radius-sm)",
                fontSize: "var(--text-sm)",
                fontWeight: 600,
                cursor: inflight ? "not-allowed" : "pointer",
              }}
            >
              Try again
            </button>
            <button
              type="button"
              data-slot="card-failed-pick-another"
              onClick={handleCardFailedPickAnother}
              style={{
                height: "var(--space-10)",
                padding: "0 var(--space-4)",
                background: "transparent",
                color: "var(--foreground)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                fontSize: "var(--text-sm)",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Pick a different method
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="checkout-shell" data-slot="checkout-shell" data-ticket-id={ticketId}>
      <TxHeader
        subtitle="Walk-in"
        onCancel={handleCancel}
        onDiscard={handleDiscard}
        disabled={inflight}
      />
      <div className="checkout-body">
        {/* LEFT: cart column */}
        <section className="checkout-cart" aria-label="Cart">
          <TechAvatarRow
            staff={staff}
            selectedStaffId={selectedStaffId}
            onPick={handlePickTech}
            onClear={handleClearTech}
          />
          {/* US3 cart header — title + + Discount affordance. The button
              opens the DiscountSheet (mounted at the bottom of this island);
              uses the same `tx-btn ghost` token-styled chrome the rest of
              the checkout uses. */}
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
            {lines.length === 0 ? (
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
              // US3: percent-discount rows display an amount that is derived
              // from the live service subtotal — the local `unitPriceCents`
              // for a percent row may be stale (server's recompute writes the
              // amount but the action contract returns only totals). We mirror
              // `computeTotals`/`recomputeTicketTotals` here so the per-row
              // amount the operator sees matches what's persisted.
              (() => {
                const liveServiceSubtotalCents = lines
                  .filter((l) => l.kind === "service" && !l.priceUnconfirmed)
                  .reduce((sum, l) => sum + l.unitPriceCents * l.qty, 0);
                return lines.map((line) => {
                  const displayLine =
                    line.kind === "discount" && line.discountPct != null
                      ? {
                          ...line,
                          unitPriceCents: -Math.round(
                            (line.discountPct * liveServiceSubtotalCents) / 100
                          ),
                        }
                      : line;
                  return (
                    <CartRowWithTech
                      key={line.id}
                      line={displayLine}
                      staffById={staffById}
                      onRemove={() => handleRemoveLine(line)}
                      onEditPrice={() => handleEditPrice(line)}
                      onSetTech={(staffId) => handleSetLineTech(line, staffId)}
                    />
                  );
                });
              })()
            )}
          </div>
          <Totals
            subtotalCents={totals.subtotalCents}
            taxCents={totals.taxCents}
            totalCents={totals.totalCents}
          />
          {errorBanner ? (
            <p
              role="alert"
              data-slot="checkout-error-banner"
              style={{
                margin: 0,
                padding: "var(--space-2) var(--space-3)",
                background: "color-mix(in oklch, var(--destructive) 10%, transparent)",
                border: "1px solid var(--destructive)",
                borderRadius: "var(--radius-sm)",
                color: "var(--destructive)",
                fontSize: "var(--text-sm)",
                fontWeight: 500,
              }}
            >
              {errorBanner}
            </p>
          ) : null}
          <PaymentTiles
            value={paymentMethod}
            onChange={setPaymentMethod}
            squareConnected={squareConnected && !requiresReconnect}
            devicesAvailable={pairedDevices.length}
            amountCents={totals.totalCents}
            onSendCard={handleSendCard}
            cardSendDisabled={
              inflight || !totals.chargeEligible || lines.some((l) => l.priceUnconfirmed)
            }
          />
          {/* US4 (T041): Bill + Charge sit side-by-side in the cart footer.
              Bill is the token-styled secondary button per the prototype;
              clicking it captures a frozen snapshot and opens the BillSheet
              overlay. The Bill button is enabled even when Charge isn't —
              the operator can print/email a bill at any point before payment. */}
          <div
            style={{
              display: "flex",
              gap: "var(--space-2)",
              alignItems: "stretch",
            }}
          >
            <button
              type="button"
              onClick={handleOpenBill}
              data-slot="bill-button"
              className="tx-btn secondary"
              disabled={inflight || lines.length === 0}
              style={{
                height: "var(--space-10)",
              }}
            >
              <Printer size={16} strokeWidth={1.5} aria-hidden="true" /> Bill
            </button>
            <button
              type="button"
              onClick={handleTakeCash}
              disabled={!takeCashEnabled}
              data-slot="take-cash-button"
              style={{
                flex: "1 1 auto",
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
              {lines.some((l) => l.priceUnconfirmed)
                ? "Set price on highlighted items"
                : `Take cash · ${fmt(totals.totalCents)}`}
            </button>
          </div>
        </section>

        {/* RIGHT: catalog column */}
        <section className="checkout-catalog" aria-label="Service catalog">
          <ServiceTiles
            services={services}
            disabled={!selectedStaffId}
            onPick={handlePickService}
          />
        </section>
      </div>

      {priceSheet && priceSheetLine ? (
        <PriceSheet
          name={priceSheetLine.name}
          unitPriceCents={priceSheetLine.unitPriceCents}
          priceUnconfirmed={priceSheetLine.priceUnconfirmed}
          isOverride={priceSheet.isOverride}
          serviceMeta={priceSheetLine.serviceMeta ?? null}
          onSave={(cents) => {
            // setLinePrice is async; fire-and-forget so the click handler
            // returns sync (React state updates batch inside the handler).
            void handlePriceSheetSave(cents);
          }}
          onCancel={() => setPriceSheet(null)}
          onRemove={
            !priceSheet.isOverride && priceSheetLine.priceUnconfirmed
              ? handlePriceSheetRemove
              : undefined
          }
        />
      ) : null}

      {discountSheetOpen ? (
        <DiscountSheet
          onSave={async (payload) => {
            await handleAddDiscount(payload);
          }}
          onCancel={() => setDiscountSheetOpen(false)}
        />
      ) : null}

      {/* US4 (T041): Bill preview sheet. The snapshot is a frozen JS object —
          cart edits underneath the sheet do not mutate it. Closing + re-
          opening calls `handleOpenBill` again, which captures a fresh
          snapshot from the live cart state. */}
      {billSnapshot ? (
        <BillSheet
          snapshot={billSnapshot}
          salonInfo={salonInfo}
          techName={billTechName}
          guestLabel="Walk-in client"
          onClose={() => setBillSnapshot(null)}
          onPrint={() => window.print()}
          onEmail={() => setEmailDialogOpen(true)}
        />
      ) : null}

      {emailDialogOpen ? (
        <EmailBillDialog onSubmit={handleEmailBill} onCancel={() => setEmailDialogOpen(false)} />
      ) : null}
    </div>
  );
}
