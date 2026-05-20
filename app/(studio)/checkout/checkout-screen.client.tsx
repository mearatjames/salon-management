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
  activateCashDraft,
  activateGiftDraft,
  addDiscountLine,
  addServiceLine,
  cancelTerminalPayment,
  composeDraftLeg,
  discardTicket,
  emailBillStub,
  lookupGiftCard,
  redeemGiftCardWholeTicket,
  removeDiscountLine,
  removeDraftLeg,
  removeLine,
  sendCardToTerminal,
  setLinePrice,
  setLineTech,
  takeCash,
  type LookupGiftCardResult,
} from "@/app/(studio)/checkout/actions";
import type { CheckoutDraft, DraftLine } from "@/app/(studio)/checkout/_cart-draft";
import {
  CashPaymentFailedError,
  DiscountInvalidError,
  DraftLegNotFoundError,
  GiftCardNotRedeemableError,
  GiftCardZeroBalanceError,
  InvalidGanError,
  InvalidPriceError,
  LegAmountInvalidError,
  LegSumMismatchError,
  PaymentNotCancellableError,
  PaymentNotFoundError,
  ServiceArchivedError,
  SquareCheckoutCreateFailedError,
  SquareGiftCardLookupFailedError,
  SquareGiftCardPaymentFailedError,
  SquareNotConnectedError,
  SquareReconnectRequiredError,
  StaffNotActiveError,
  TerminalDeviceRequiredError,
  TicketAlreadyBeingChargedError,
  TicketAlreadyTerminalError,
  TicketEmptyError,
  TicketHasUnpricedItemsError,
  TicketNotOpenError,
} from "@/app/(studio)/checkout/_errors";
import { GanNumpadSheet } from "@/components/lacquer/checkout/gan-numpad-sheet";
import { GiftCardBalanceSheet } from "@/components/lacquer/checkout/gift-card-balance-sheet";
import { CardWaiting } from "@/components/lacquer/checkout/card-waiting";
import { MethodPickerPopover } from "@/components/lacquer/checkout/method-picker-popover";
import { SplitCartFooter } from "@/components/lacquer/checkout/split-cart-footer";
import type { PaymentLegRowView } from "@/components/lacquer/checkout/payment-leg-row";
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
  /**
   * The persisted ticket id, or `null` for the ephemeral-draft path
   * (feature 043-checkout-ephemeral-draft). A `null` id means the cart is
   * an in-memory draft with no DB row yet. `[ticketId]/page.tsx` always
   * passes a real (non-null) id, so the persisted-mode behavior here is
   * unchanged. The ephemeral editing/submission wiring lands in Phase 3
   * (T013/T014) — this prop only widens the type and powers the
   * `isEphemeral` derivation below.
   */
  ticketId: string | null;
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
  /**
   * Feature 018 (US2): existing non-failed legs loaded by the page server.
   * Empty when the ticket has never been split-composed; populated when
   * the operator reloads mid-flow (FR-014a) or US3's partial-gift case
   * has already composed one leg.
   */
  initialLegs?: SplitLeg[];
  /**
   * Feature 043-checkout-ephemeral-draft (T028): when the page loads a
   * ticket whose only non-failed payment is a single-tender `pending` card
   * row, it seeds `"waiting"` here so the card-waiting screen rehydrates
   * after the ephemeral card-send `router.replace`s onto this route. The
   * realtime/polling settlement path then runs identically to the pre-043
   * in-session card-wait (FR-003). Defaults to `"cart"`.
   */
  initialCardStage?: "cart" | "waiting" | "card-failed";
  /** Feature 043: the pending card payment id paired with `initialCardStage`. */
  initialActiveCardPaymentId?: string | null;
  /**
   * Feature 043-checkout-ephemeral-draft (T028): mirror of
   * `initialCardStage` for the whole-ticket gift path — `"waiting"` when
   * the page loaded a ticket whose only non-failed payment is a single
   * `pending` gift row, so the gift-card-waiting screen rehydrates after
   * the ephemeral gift-redeem `router.replace`d here. Defaults to `"idle"`.
   */
  initialGiftStage?: "idle" | "numpad" | "balance" | "waiting";
  /** Feature 043: the pending gift payment id paired with `initialGiftStage`. */
  initialActiveGiftPaymentId?: string | null;
  /**
   * Feature 043-checkout-ephemeral-draft (T028): when the page loaded a
   * ticket whose only payment is a `pending` gift leg short of the total
   * (the `partial_split` shape), this carries the remainder in cents so
   * the rehydrated client re-opens the second-leg method picker — matching
   * the in-session `partial_split` UX. `null` otherwise.
   */
  initialMethodPickerAmountCents?: number | null;
};

// Feature 018 (US2): the leg shape we hold in client state. Drives the
// split-tender footer; pushed back to the server on activate/remove.
type SplitLeg = PaymentLegRowView & {
  status: "draft" | "pending" | "succeeded" | "failed";
};

function tempId(): string {
  return `tmp-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
}

function fmt(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * In Next.js' production build, errors thrown from a Server Action are
 * serialized as plain Errors on the client — the original class is lost
 * and `instanceof CheckoutError` returns false. The `code` field is also
 * stripped (only `message` + `digest` survive). This helper matches by
 * the canonical error message string when `instanceof` fails, so the
 * client island can branch correctly under both runtimes.
 *
 * Note: the strings below are the constructors' default `message` values
 * from `_errors.ts`. Keep them in sync if those messages change.
 */
function isErrorCode(err: unknown, code: string): boolean {
  if (!err || typeof err !== "object") return false;
  const c = (err as { code?: unknown }).code;
  return typeof c === "string" && c === code;
}

function isErrorMessage(err: unknown, message: string): boolean {
  if (!err || typeof err !== "object") return false;
  const m = (err as { message?: unknown }).message;
  return typeof m === "string" && m === message;
}

function isTicketAlreadyBeingCharged(err: unknown): boolean {
  if (err instanceof TicketAlreadyBeingChargedError) return true;
  if (isErrorCode(err, "TICKET_ALREADY_BEING_CHARGED")) return true;
  return isErrorMessage(err, "ticket is already being charged on another device");
}

export function CheckoutScreen({
  ticketId: ticketIdProp,
  initialItems,
  staff,
  services,
  salonInfo,
  squareConnected = false,
  defaultDeviceId = null,
  defaultDeviceFriendlyName = null,
  pairedDevices = [],
  requiresReconnect = false,
  initialLegs = [],
  initialCardStage = "cart",
  initialActiveCardPaymentId = null,
  initialGiftStage = "idle",
  initialActiveGiftPaymentId = null,
  initialMethodPickerAmountCents = null,
}: CheckoutScreenProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Feature 043-checkout-ephemeral-draft: `ticketId === null` means the
  // cart is an ephemeral in-memory draft with no DB row yet. Phase 3
  // (T013/T014) wires the ephemeral editing/submission paths; until then
  // every code path below runs in persisted mode, where `[ticketId]/
  // page.tsx` always supplies a non-null id. The non-null `ticketId`
  // local below keeps the existing persisted-mode call sites unchanged.
  const isEphemeral = ticketIdProp === null;
  // Persisted-mode id. In ephemeral mode no persisted ticket exists yet;
  // the empty-string fallback is never reached by the persisted code
  // paths (T013/T014 add the ephemeral branches that skip them).
  const ticketId: string = ticketIdProp ?? "";

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
  // Feature 043 (T028): seed from the server-derived rehydration props so
  // an ephemeral card-send that `router.replace`d onto `/checkout/[id]`
  // resumes the card-waiting screen (and its realtime/polling effect).
  const [cardStage, setCardStage] = useState<"cart" | "waiting" | "card-failed">(initialCardStage);
  const [activeCardPaymentId, setActiveCardPaymentId] = useState<string | null>(
    initialActiveCardPaymentId
  );
  const [cardFailureReason, setCardFailureReason] = useState<string | null>(null);
  // We need a ref to the latest activeCardPaymentId so the polling
  // setInterval (set up once at waiting-stage start) can read the current
  // id without re-subscribing on every render.
  const activeCardPaymentRef = useRef<string | null>(null);
  useEffect(() => {
    activeCardPaymentRef.current = activeCardPaymentId;
  }, [activeCardPaymentId]);

  // Feature 018 — Gift card flow state. Stages:
  //   idle    → default (Gift tile not yet tapped, or post-cancel).
  //   numpad  → GanNumpadSheet visible.
  //   balance → GiftCardBalanceSheet visible with the lookup result.
  //   waiting → redeem in flight; subscribe + poll the gift-card payment.
  type GiftStage = "idle" | "numpad" | "balance" | "waiting";
  // Feature 043 (T028): seed from the server-derived rehydration props so
  // an ephemeral gift-redeem that `router.replace`d onto `/checkout/[id]`
  // resumes the gift-card-waiting screen (and its realtime/polling effect).
  const [giftStage, setGiftStage] = useState<GiftStage>(initialGiftStage);
  const [giftBusy, setGiftBusy] = useState(false);
  const [giftLookup, setGiftLookup] = useState<LookupGiftCardResult | null>(null);
  const [giftGan, setGiftGan] = useState<string | null>(null);
  const [activeGiftPaymentId, setActiveGiftPaymentId] = useState<string | null>(
    initialActiveGiftPaymentId
  );
  const activeGiftPaymentRef = useRef<string | null>(null);
  useEffect(() => {
    activeGiftPaymentRef.current = activeGiftPaymentId;
  }, [activeGiftPaymentId]);

  // ----------------------------------------------------------------------
  // Feature 018 (US2) — split-tender state.
  //
  //   `splitMode` is true when the operator either tapped the Split tile
  //   OR there are already non-failed legs server-side (covers reload-
  //   mid-flow + US3's auto-entry from the partial-gift case).
  //   `legs` is the live leg list, hydrated from `initialLegs` and kept
  //   in sync via the `subscribePaymentChanges` channel + optimistic
  //   client updates on compose/remove.
  //   `splitBusy` locks the footer while an activate/remove call is in flight.
  //   `splitGanPaymentId` holds the draft id while the GanNumpadSheet is
  //   open for a gift leg's activation.
  // ----------------------------------------------------------------------
  const [legs, setLegs] = useState<SplitLeg[]>(initialLegs);
  const [splitModeManuallyOpened, setSplitModeManuallyOpened] = useState(false);
  const [splitBusy, setSplitBusy] = useState(false);
  const [splitGanPaymentId, setSplitGanPaymentId] = useState<string | null>(null);
  const hasNonFailedLegs = legs.some(
    (l) => l.status === "draft" || l.status === "pending" || l.status === "succeeded"
  );
  const splitMode = splitModeManuallyOpened || hasNonFailedLegs;

  // Feature 018 (US3 / T052) — second-leg method picker state. Opens
  // automatically when `redeemGiftCardWholeTicket` returns
  // `{kind: 'partial_split', nextLegAmountCents}`. The operator's pick
  // drives a regular `composeDraftLeg` + `activate*Draft` round-trip
  // (no server-side second-draft synthesis).
  // Feature 043 (T028): seed from `initialMethodPickerAmountCents` so the
  // ephemeral partial-gift redeem that `router.replace`d here re-opens the
  // second-leg method picker for the remainder.
  const [methodPicker, setMethodPicker] = useState<{
    amountCents: number;
  } | null>(
    initialMethodPickerAmountCents != null ? { amountCents: initialMethodPickerAmountCents } : null
  );
  const [methodPickerBusy, setMethodPickerBusy] = useState(false);

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

  // Issue #98: one method-aware charge button sits in the cart footer next
  // to "Bill" — cash (or no method) → "Take cash", card → "Send to Square".
  // The card CTA is no longer injected inside `PaymentTiles`.
  const chargeMethodIsCard = paymentMethod === "card";
  const hasUnpricedLines = lines.some((l) => l.priceUnconfirmed);
  const chargeButtonEnabled = chargeMethodIsCard
    ? !inflight && totals.chargeEligible && !hasUnpricedLines
    : takeCashEnabled;

  function handlePickTech(staffId: string) {
    setSelectedStaffId(staffId);
  }

  function handleClearTech() {
    setSelectedStaffId(null);
  }

  function handlePickService(svc: ServiceTileService) {
    if (!selectedStaffId) return;
    // Feature 043 (T013): ephemeral lines get a real client-generated
    // `crypto.randomUUID()` id (it doubles as the draft's `clientLineId`
    // at submission). Persisted mode keeps the optimistic `tmp-` id that
    // the server swaps for the inserted row's id.
    const tmp = isEphemeral ? crypto.randomUUID() : tempId();
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

    // Feature 043 (T013): ephemeral mode — the cart is an in-memory draft
    // with no DB row. The line stays in local React state with its
    // client-generated UUID; no server action, no audit, no round-trip.
    // FR-001's auto-open of the price sheet for variable-price services
    // still applies — the operator UX is unchanged.
    if (isEphemeral) {
      if (svc.variable_price) {
        setPriceSheet({ lineId: optimisticLine.id, isOverride: false });
      }
      return;
    }

    startTransition(async () => {
      try {
        const result = await addServiceLine({
          ticketId,
          serviceId: svc.id,
          assignedStaffId: selectedStaffId,
        });
        // Feature 018 (US2): the action returns a typed refusal when the
        // ticket has an in-flight leg — surface the spec's banner copy.
        if ("refusedReason" in result) {
          setLines((prev) => prev.filter((l) => l.id !== tmp));
          if (result.refusedReason === "ticket_already_being_charged") {
            setErrorBanner("Ticket is already being charged on another device");
          }
          return;
        }
        // Swap the temp id for the server-returned one.
        setLines((prev) => prev.map((l) => (l.id === tmp ? { ...l, id: result.lineId } : l)));
        // Feature 018 (US2 / T045): the cart-edit invalidated existing
        // split-tender drafts. Surface a toast so the operator knows
        // their leg composition was wiped.
        if (result.draftsDiscarded && result.draftsDiscarded > 0) {
          toast.message(
            `${result.draftsDiscarded} split-tender leg${
              result.draftsDiscarded === 1 ? "" : "s"
            } cleared because the cart changed`
          );
          setLegs([]);
          setSplitModeManuallyOpened(false);
        }
        // FR-001: auto-open the price sheet for variable-priced services
        // as soon as the server confirms the row exists.
        if (svc.variable_price) {
          setPriceSheet({ lineId: result.lineId, isOverride: false });
        }
      } catch (err) {
        // Revert the optimistic insert.
        setLines((prev) => prev.filter((l) => l.id !== tmp));
        if (isTicketAlreadyBeingCharged(err)) {
          setErrorBanner("Ticket is already being charged on another device");
        } else if (err instanceof StaffNotActiveError) {
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

    // Feature 043 (T013): ephemeral mode — the cart is an in-memory draft.
    // Removing a line is a local-state mutation only; no server action,
    // no audit.
    if (isEphemeral) return;

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

    // Feature 043 (T013): ephemeral mode — append the discount row to
    // local React state with a client-generated UUID. No server action,
    // no audit; the row is folded into the draft at submission.
    if (isEphemeral) {
      setLines((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
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
      return;
    }

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

    // Feature 043 (T013): ephemeral mode — reassigning a line's tech is a
    // local-state mutation only; no server action, no audit.
    if (isEphemeral) return;

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

    // Feature 043 (T013): ephemeral mode — set/override price is a
    // local-state mutation only. Clear the unconfirmed flag and reflect
    // the new amount so the cart total recomputes immediately.
    if (isEphemeral) {
      setLines((prev) =>
        prev.map((l) => (l.id === lineId ? { ...l, unitPriceCents, priceUnconfirmed: false } : l))
      );
      setPriceSheet(null);
      return;
    }

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

  // Feature 043 (T014): serialize the live ephemeral cart into the
  // `CheckoutDraft` the server expects. Each local service line becomes a
  // `DraftServiceLine` (carrying the line's UUID as `clientLineId`); each
  // discount line becomes a `DraftDiscountLine`. The server re-validates
  // and re-resolves every field via `validateAndResolveDraft`.
  function serializeDraft(): CheckoutDraft {
    const draftLines: DraftLine[] = lines.map((l): DraftLine => {
      if (l.kind === "discount") {
        return {
          kind: "discount",
          clientLineId: l.id,
          shape: l.discountPct != null ? "percent" : "flat",
          // Percent: the whole-number percent. Flat: the positive cents
          // amount (the local row stores a negative `unitPriceCents`).
          value: l.discountPct != null ? l.discountPct : -l.unitPriceCents,
          note: l.note,
        };
      }
      return {
        kind: "service",
        clientLineId: l.id,
        serviceId: l.serviceId as string,
        unitPriceCents: l.unitPriceCents,
        priceUnconfirmed: l.priceUnconfirmed,
        assignedStaffId: l.assignedStaffId as string,
      };
    });
    return { lines: draftLines };
  }

  async function handleTakeCash() {
    if (!takeCashEnabled || inflight) return;
    setInflight(true);
    setErrorBanner(null);
    try {
      // Feature 043 (T014): ephemeral mode — this is the first payment-
      // initiating action. Serialize the in-memory cart into a
      // `CheckoutDraft`; `takeCash` persists it atomically via
      // `pos_create_ticket_from_draft` then runs `pos_take_cash` and
      // returns the freshly-resolved ticket id. `router.replace` onto the
      // persisted `[ticketId]` route so the paid surface renders the done
      // screen.
      if (isEphemeral) {
        const { ticketId: paidTicketId } = await takeCash({
          from: "draft",
          draft: serializeDraft(),
        });
        router.replace(`/checkout/${paidTicketId}`);
        return;
      }
      await takeCash({ from: "ticket", ticketId });
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
      // Issue #25: when the Square Terminal is waiting for a card tap,
      // discarding the ticket without first cancelling the checkout lets
      // a late tap capture money against an already-discarded ticket
      // (succeeded payment on a discarded ticket with no UI recovery).
      // Cancel the terminal session first; only proceed to discard when
      // Square confirms the cancel landed.
      const cardPaymentId = activeCardPaymentRef.current;
      if (cardStage === "waiting" && cardPaymentId) {
        try {
          const cancel = await cancelTerminalPayment(cardPaymentId);
          if (cancel.resolvedStatus === "race_succeeded") {
            toast.success(
              "Card was charged before cancel reached the terminal. Showing the successful payment."
            );
            router.refresh();
            return;
          }
          if (cancel.resolvedStatus === "still_pending") {
            setErrorBanner("Couldn’t reach Square to cancel. Waiting for the terminal to settle.");
            return;
          }
          // resolvedStatus === "cancelled" — fall through to discard.
        } catch (cancelErr) {
          if (cancelErr instanceof PaymentNotCancellableError) {
            // Row already settled (succeeded or failed) — let the page
            // re-render the canonical state instead of discarding.
            router.refresh();
            return;
          }
          if (cancelErr instanceof PaymentNotFoundError) {
            // No live terminal session to cancel — safe to proceed.
          } else {
            setErrorBanner("Couldn’t cancel the card payment. Try again.");
            return;
          }
        }
      }
      const result = await discardTicket({ ticketId });
      if (!result.ok && result.refusedReason === "ticket_has_inflight_payment") {
        // Issue #26 — money-loss defense: the ticket has captured or
        // pending payments. Refuse to navigate; show the inline banner so
        // the operator can cancel/void those payments before discarding.
        setErrorBanner(
          "This ticket has pending or captured payments. Cancel or void them before discarding."
        );
        return;
      }
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
      // Feature 043 (T028): ephemeral mode — sending to the terminal is the
      // first payment-initiating action. Serialize the in-memory cart into a
      // `CheckoutDraft`; `sendCardToTerminal` persists it atomically via
      // `pos_create_ticket_from_draft`, inserts the `pending` card row, and
      // pushes the Square checkout — then returns the resolved ticket id.
      // `router.replace` onto the persisted `[ticketId]` route so the
      // card-waiting screen rehydrates from the DB.
      if (isEphemeral) {
        const { ticketId: persistedTicketId } = await sendCardToTerminal(
          { from: "draft", draft: serializeDraft() },
          defaultDeviceId ?? undefined
        );
        router.replace(`/checkout/${persistedTicketId}`);
        return;
      }
      const { paymentId } = await sendCardToTerminal(
        { from: "ticket", ticketId },
        defaultDeviceId ?? undefined
      );
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
      // A failed charge means the ticket was already persisted by the first
      // attempt — retry always runs in persisted mode.
      const { paymentId } = await sendCardToTerminal(
        { from: "ticket", ticketId },
        defaultDeviceId ?? undefined
      );
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

  // ----------------------------------------------------------------------
  // Feature 018 — Gift card flow.
  //
  //   1. Operator taps Gift tile → opens <GanNumpadSheet/>.
  //   2. On submit → lookupGiftCard → renders <GiftCardBalanceSheet/>.
  //   3. On Redeem → redeemGiftCardWholeTicket → giftStage='waiting'.
  //   4. Waiting subscribes to subscribePaymentChanges + polls
  //      /api/square/payment/[paymentId] every 5s. On 'succeeded' →
  //      router.refresh() to render the paid branch. On 'failed' →
  //      toast + return to picker.
  //   5. Error toasts for the typed gift-card errors.
  // ----------------------------------------------------------------------

  function openGiftFlow() {
    setGiftLookup(null);
    setGiftGan(null);
    setActiveGiftPaymentId(null);
    setGiftBusy(false);
    setGiftStage("numpad");
  }

  function closeGiftFlow() {
    setGiftStage("idle");
    setGiftLookup(null);
    setGiftGan(null);
    setActiveGiftPaymentId(null);
    setGiftBusy(false);
    setPaymentMethod(null);
  }

  async function handleGanSubmit(gan: string) {
    if (giftBusy) return;
    setGiftBusy(true);
    setErrorBanner(null);
    try {
      const result = await lookupGiftCard(gan);
      setGiftLookup(result);
      setGiftGan(gan);
      setGiftStage("balance");
    } catch (err) {
      if (err instanceof InvalidGanError) {
        toast.error("That gift card number isn't valid.");
      } else if (err instanceof SquareGiftCardLookupFailedError) {
        toast.error("Couldn't reach Square to look up the gift card. Try again.");
      } else if (err instanceof SquareNotConnectedError) {
        toast.error("Square isn't connected. Connect it in settings to accept gift cards.");
      } else if (err instanceof SquareReconnectRequiredError) {
        toast.error("Square needs to be reconnected. Open settings to fix it.");
      } else {
        toast.error("Couldn't look up that gift card. Try again.");
      }
    } finally {
      setGiftBusy(false);
    }
  }

  async function handleGiftRedeem() {
    if (giftBusy || !giftGan || !giftLookup) return;
    if (giftLookup.kind !== "found") return;
    setGiftBusy(true);
    setErrorBanner(null);
    try {
      // Feature 043 (T028): ephemeral mode — redeeming a gift card is the
      // first payment-initiating action. Serialize the in-memory cart;
      // `redeemGiftCardWholeTicket` persists it atomically via
      // `pos_create_ticket_from_draft` BEFORE the redemption, then returns
      // the resolved ticket id on every result variant. `router.replace`
      // onto the persisted `[ticketId]` route so the gift-waiting / split
      // continuation rehydrates from the DB (the ticket now exists
      // regardless of the redemption outcome).
      const result = await redeemGiftCardWholeTicket(
        isEphemeral ? { from: "draft", draft: serializeDraft() } : { from: "ticket", ticketId },
        giftGan
      );
      if (isEphemeral) {
        router.replace(`/checkout/${result.ticketId}`);
        return;
      }
      if (result.kind === "fully_paid") {
        setActiveGiftPaymentId(result.paymentId);
        setGiftStage("waiting");
      } else if (result.kind === "partial_split") {
        // US3 (T052) — close the gift-card sheets so the picker sits on
        // top of the cart with the live "Owes $Y" footer visible behind
        // it. Add an optimistic pending leg for the gift charge so the
        // split footer reflects what's already been allocated; realtime
        // will reconcile the eventual succeeded state.
        setLegs((prev) => {
          if (prev.some((l) => l.id === result.paymentId)) return prev;
          return [
            ...prev,
            {
              id: result.paymentId,
              method: "gift",
              amountCents: totals.totalCents - result.nextLegAmountCents,
              status: "pending",
              last4Mask: giftGan ? giftGan.replace(/\s/g, "").slice(-4) : null,
            },
          ];
        });
        setSplitModeManuallyOpened(true);
        setActiveGiftPaymentId(result.paymentId);
        setGiftStage("idle");
        setGiftLookup(null);
        setGiftGan(null);
        setPaymentMethod(null);
        setMethodPicker({ amountCents: result.nextLegAmountCents });
      } else if (result.kind === "lookup_zero_balance") {
        toast.error("That card has no balance to redeem.");
        closeGiftFlow();
      } else if (result.kind === "lookup_not_redeemable") {
        toast.error(`That gift card is ${result.state.toLowerCase()} and can't be redeemed.`);
        closeGiftFlow();
      } else if (result.kind === "lookup_not_found") {
        toast.error("Gift card not found. Re-enter the number.");
        setGiftStage("numpad");
      }
    } catch (err) {
      if (err instanceof TicketAlreadyBeingChargedError) {
        toast.error("This ticket is already being charged on another device.");
        closeGiftFlow();
      } else if (err instanceof GiftCardNotRedeemableError) {
        toast.error(`That gift card is ${err.state.toLowerCase()} and can't be redeemed.`);
        closeGiftFlow();
      } else if (err instanceof GiftCardZeroBalanceError) {
        toast.error("That card has no balance to redeem.");
        closeGiftFlow();
      } else if (err instanceof SquareGiftCardPaymentFailedError) {
        toast.error("Square rejected the gift-card payment. Try again or pick another method.");
        closeGiftFlow();
      } else if (err instanceof SquareGiftCardLookupFailedError) {
        toast.error("Couldn't reach Square. Try again.");
      } else if (err instanceof TicketHasUnpricedItemsError) {
        toast.error("Set price on highlighted items before charging.");
        closeGiftFlow();
      } else if (err instanceof TicketNotOpenError) {
        toast.error("This ticket is no longer open.");
        closeGiftFlow();
      } else {
        toast.error("Couldn't redeem the gift card. Try again.");
        closeGiftFlow();
      }
    } finally {
      setGiftBusy(false);
    }
  }

  // US3 (T052) — second-leg method picker handler. The operator picked
  // a method for the remainder; compose a draft for that method and
  // immediately activate it. Cash activates inline; card routes to the
  // terminal CardWaiting flow; gift opens the GAN numpad sheet against
  // the new draft id.
  async function handleMethodPickerPick(method: "cash" | "card" | "gift") {
    const picker = methodPicker;
    if (!picker || methodPickerBusy) return;
    setMethodPickerBusy(true);
    setSplitBusy(true);
    setErrorBanner(null);
    try {
      // The second-leg picker only runs after a payment-initiating action
      // already persisted the ticket — always persisted mode here.
      const { paymentId: nextDraftId } = await composeDraftLeg(
        { from: "ticket", ticketId },
        method,
        picker.amountCents
      );
      // Optimistic — push the draft into legs (the realtime channel
      // will reconcile if anything differs).
      setLegs((prev) => [
        ...prev,
        {
          id: nextDraftId,
          method,
          amountCents: picker.amountCents,
          status: "draft",
          last4Mask: null,
        },
      ]);
      setMethodPicker(null);

      if (method === "cash") {
        const result = await activateCashDraft(nextDraftId);
        setLegs((prev) =>
          prev.map((l) => (l.id === nextDraftId ? { ...l, status: "succeeded" } : l))
        );
        if (result.ticketFlippedToPaid) router.refresh();
      } else if (method === "card") {
        const { paymentId: confirmedId } = await sendCardToTerminal(
          { from: "ticket", ticketId },
          {
            deviceId: defaultDeviceId ?? undefined,
            existingDraftId: nextDraftId,
          }
        );
        setActiveCardPaymentId(confirmedId);
        setLegs((prev) =>
          prev.map((l) => (l.id === nextDraftId ? { ...l, status: "pending" } : l))
        );
        setCardStage("waiting");
      } else {
        // gift — open the GAN numpad against this new draft id; the
        // existing split-leg gift activation path takes it from there.
        setSplitGanPaymentId(nextDraftId);
        setGiftBusy(false);
        setGiftStage("numpad");
      }
    } catch (err) {
      toast.error(classifySplitError(err));
      refreshLegs();
    } finally {
      setMethodPickerBusy(false);
      setSplitBusy(false);
    }
  }

  async function pollGiftPaymentOnce(): Promise<void> {
    const id = activeGiftPaymentRef.current;
    if (!id) return;
    try {
      const res = await fetch(`/api/square/payment/${id}`, { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as {
        status: "draft" | "pending" | "succeeded" | "failed";
        failureReason: string | null;
      };
      if (body.status === "succeeded") {
        router.refresh();
      } else if (body.status === "failed") {
        toast.error("Gift card payment failed. Pick another method.");
        closeGiftFlow();
      }
    } catch {
      // Network blip; next interval will retry.
    }
  }

  useEffect(() => {
    if (giftStage !== "waiting" || !activeGiftPaymentId) return;
    const unsubscribe = subscribePaymentChanges(ticketId, () => {
      void pollGiftPaymentOnce();
    });
    const interval = window.setInterval(() => {
      void pollGiftPaymentOnce();
    }, 5000);
    // Fire one immediate poll asynchronously so the channel-loss case
    // still resolves in ~5s. setTimeout(0) defers off the effect's
    // render commit so any setState calls inside pollGiftPaymentOnce
    // don't trigger a cascading render warning.
    const initialPoll = window.setTimeout(() => {
      void pollGiftPaymentOnce();
    }, 0);
    return () => {
      unsubscribe();
      window.clearInterval(interval);
      window.clearTimeout(initialPoll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [giftStage, activeGiftPaymentId, ticketId]);

  // ----------------------------------------------------------------------
  // Feature 018 (US2) — split-tender handlers.
  //
  //   When `splitMode` is active (any non-failed leg exists, or the
  //   operator tapped Split), we subscribe to the realtime channel so
  //   the leg list updates on webhook-driven settlements (card / gift).
  //   The fallback polling for individual gift legs is the existing
  //   `/api/square/payment/[paymentId]` endpoint — the realtime channel
  //   is the primary signal.
  // ----------------------------------------------------------------------

  // Realtime: when split mode is active, listen for UPDATE events on the
  // ticket's payment rows. Webhook-driven flips (card / gift settlement)
  // bring `status` from 'pending' → 'succeeded' or 'failed'. We optimistic-
  // update on activate/remove; the realtime callback patches the local
  // leg list. A separate effect watches `legs` for the all-settled
  // condition and triggers `router.refresh()` outside the setter chain
  // (calling navigation methods inside a state-setter return value is a
  // React no-no and can fault the error boundary in production).
  useEffect(() => {
    if (!splitMode) return;
    const unsubscribe = subscribePaymentChanges(ticketId, (payload) => {
      const row = payload.new;
      if (!row || !row.id) return;
      const newStatus = row.status;
      if (newStatus !== "pending" && newStatus !== "succeeded" && newStatus !== "failed") return;
      setLegs((prev) => {
        const exists = prev.find((l) => l.id === row.id);
        if (!exists) return prev;
        return prev.map((l) =>
          l.id === row.id ? { ...l, status: newStatus as SplitLeg["status"] } : l
        );
      });
    });
    return () => {
      unsubscribe();
    };
  }, [splitMode, ticketId]);

  // Auto-refresh the page once every leg has settled (succeeded/failed),
  // at least one succeeded. The page's paid-status branch then renders
  // <DoneScreen/>. Decoupled from the realtime callback so React can
  // commit the setLegs update before the navigation fires.
  useEffect(() => {
    if (!splitMode || legs.length === 0) return;
    const allSettled = legs.every((l) => l.status === "succeeded" || l.status === "failed");
    const anySucceeded = legs.some((l) => l.status === "succeeded");
    if (allSettled && anySucceeded) {
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legs, splitMode]);

  // US3 (T052) — polling fallback for pending gift legs in split mode.
  // The realtime channel is the primary signal for `pending → succeeded`
  // settlements, but if it misses (test env without realtime publication
  // / network blip) we still want the UI to react. Polls /api/square/
  // payment/[id] every 3s while any gift leg sits in `pending` and patches
  // the leg list on settlement.
  useEffect(() => {
    if (!splitMode) return;
    const pendingGiftLegs = legs.filter((l) => l.method === "gift" && l.status === "pending");
    if (pendingGiftLegs.length === 0) return;
    const ids = pendingGiftLegs.map((l) => l.id);
    let cancelled = false;
    async function pollOnce() {
      for (const id of ids) {
        if (cancelled) return;
        try {
          const res = await fetch(`/api/square/payment/${id}`, { cache: "no-store" });
          if (!res.ok) continue;
          const body = (await res.json()) as {
            status: "draft" | "pending" | "succeeded" | "failed";
          };
          if (body.status === "succeeded" || body.status === "failed") {
            setLegs((prev) => prev.map((l) => (l.id === id ? { ...l, status: body.status } : l)));
          }
        } catch {
          // Network blip; next interval retries.
        }
      }
    }
    const interval = window.setInterval(() => void pollOnce(), 3000);
    const initial = window.setTimeout(() => void pollOnce(), 0);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.clearTimeout(initial);
    };
  }, [splitMode, legs]);

  // No-op refresh helper retained as a hook for future server-side
  // re-hydration if the realtime channel misses an event. Currently a
  // router.refresh() pulls fresh server data via the page's RSC fetch.
  function refreshLegs(): void {
    router.refresh();
  }

  function handlePickSplit() {
    if (inflight || splitBusy) return;
    if (!totals.chargeEligible || lines.some((l) => l.priceUnconfirmed)) {
      toast.error("Set a price on every line before charging.");
      return;
    }
    setSplitModeManuallyOpened(true);
    setPaymentMethod(null);
  }

  function classifySplitError(err: unknown): string {
    if (isTicketAlreadyBeingCharged(err))
      return "Ticket is already being charged on another device";
    if (
      err instanceof LegSumMismatchError ||
      isErrorCode(err, "LEG_SUM_MISMATCH") ||
      isErrorMessage(err, "legs must sum to total")
    )
      return "Add more legs to cover the bill before charging.";
    if (
      err instanceof LegAmountInvalidError ||
      isErrorCode(err, "LEG_AMOUNT_INVALID") ||
      isErrorMessage(err, "leg amount must fit the remaining-owed total")
    )
      return "That amount doesn't fit the remaining bill.";
    if (
      err instanceof DraftLegNotFoundError ||
      isErrorCode(err, "DRAFT_LEG_NOT_FOUND") ||
      isErrorMessage(err, "draft leg not found or already settled")
    )
      return "That leg is no longer available.";
    if (err instanceof TicketHasUnpricedItemsError || isErrorCode(err, "TICKET_HAS_UNPRICED_ITEMS"))
      return "Set price on highlighted items before charging.";
    if (err instanceof TicketNotOpenError || isErrorCode(err, "TICKET_NOT_OPEN"))
      return "This ticket is no longer open.";
    return "Something went wrong. Try again.";
  }

  async function handleComposeLeg(method: "cash" | "card" | "gift", amountCents: number) {
    if (splitBusy) return;
    setSplitBusy(true);
    setErrorBanner(null);
    try {
      // Feature 043 (T028): ephemeral mode — composing the FIRST split-
      // tender leg is a payment-initiating action (FR-005). Serialize the
      // in-memory cart; `composeDraftLeg` persists it atomically via
      // `pos_create_ticket_from_draft` BEFORE composing the leg, then
      // returns the resolved ticket id. `router.replace` onto the persisted
      // `[ticketId]` route so the split-tender panel rehydrates from the DB
      // — every subsequent leg then runs in persisted mode.
      if (isEphemeral) {
        const result = await composeDraftLeg(
          { from: "draft", draft: serializeDraft() },
          method,
          amountCents
        );
        router.replace(`/checkout/${result.ticketId}`);
        return;
      }
      const result = await composeDraftLeg({ from: "ticket", ticketId }, method, amountCents);
      // Optimistic insert; the realtime channel will reconcile.
      setLegs((prev) => [
        ...prev,
        {
          id: result.paymentId,
          method,
          amountCents,
          status: "draft",
          last4Mask: null,
        },
      ]);
    } catch (err) {
      toast.error(classifySplitError(err));
    } finally {
      setSplitBusy(false);
    }
  }

  async function handleRemoveDraftLeg(paymentId: string) {
    if (splitBusy) return;
    setSplitBusy(true);
    setErrorBanner(null);
    try {
      await removeDraftLeg(paymentId);
      setLegs((prev) => prev.filter((l) => l.id !== paymentId));
    } catch (err) {
      toast.error(classifySplitError(err));
      refreshLegs();
    } finally {
      setSplitBusy(false);
    }
  }

  async function handleExitSplit() {
    if (splitBusy) return;
    setSplitBusy(true);
    setErrorBanner(null);
    try {
      const drafts = legs.filter((l) => l.status === "draft");
      for (const d of drafts) {
        try {
          await removeDraftLeg(d.id);
        } catch (err) {
          // Best-effort wipe — continue on per-leg failure.
          console.warn("handleExitSplit: removeDraftLeg failed", err);
        }
      }
      setLegs([]);
      setSplitModeManuallyOpened(false);
    } finally {
      setSplitBusy(false);
    }
  }

  async function handleActivateCashLeg(paymentId: string) {
    if (splitBusy) return;
    setSplitBusy(true);
    setErrorBanner(null);
    try {
      const result = await activateCashDraft(paymentId);
      setLegs((prev) => prev.map((l) => (l.id === paymentId ? { ...l, status: "succeeded" } : l)));
      if (result.ticketFlippedToPaid) {
        router.refresh();
      }
    } catch (err) {
      toast.error(classifySplitError(err));
      refreshLegs();
    } finally {
      setSplitBusy(false);
    }
  }

  async function handleActivateCardLeg(paymentId: string) {
    if (splitBusy || cardStage !== "cart") return;
    setSplitBusy(true);
    setErrorBanner(null);
    try {
      const { paymentId: confirmedId } = await sendCardToTerminal(
        { from: "ticket", ticketId },
        {
          deviceId: defaultDeviceId ?? undefined,
          existingDraftId: paymentId,
        }
      );
      setActiveCardPaymentId(confirmedId);
      setLegs((prev) => prev.map((l) => (l.id === paymentId ? { ...l, status: "pending" } : l)));
      setCardStage("waiting");
    } catch (err) {
      toast.error(classifySplitError(err));
      refreshLegs();
    } finally {
      setSplitBusy(false);
    }
  }

  function handleActivateGiftLeg(paymentId: string) {
    if (splitBusy) return;
    setSplitGanPaymentId(paymentId);
    setGiftBusy(false);
    setGiftStage("numpad");
  }

  async function handleSplitGanSubmit(gan: string) {
    const targetId = splitGanPaymentId;
    if (!targetId || giftBusy) return;
    setGiftBusy(true);
    setSplitBusy(true);
    setErrorBanner(null);
    try {
      await activateGiftDraft(targetId, gan);
      setLegs((prev) => prev.map((l) => (l.id === targetId ? { ...l, status: "pending" } : l)));
      setActiveGiftPaymentId(targetId);
      setSplitGanPaymentId(null);
      setGiftStage("waiting");
    } catch (err) {
      if (err instanceof InvalidGanError) {
        toast.error("That gift card number isn't valid.");
      } else if (err instanceof GiftCardNotRedeemableError) {
        toast.error(`That gift card is ${err.state.toLowerCase()} and can't be redeemed.`);
        setGiftStage("idle");
        setSplitGanPaymentId(null);
      } else if (err instanceof SquareGiftCardLookupFailedError) {
        toast.error("Couldn't reach Square to look up the gift card. Try again.");
      } else if (err instanceof SquareGiftCardPaymentFailedError) {
        toast.error("Square rejected the gift-card payment. Try again or pick another method.");
        setGiftStage("idle");
        setSplitGanPaymentId(null);
      } else {
        toast.error(classifySplitError(err));
        setGiftStage("idle");
        setSplitGanPaymentId(null);
      }
      refreshLegs();
    } finally {
      setGiftBusy(false);
      setSplitBusy(false);
    }
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
      <div
        className="checkout-shell"
        data-slot="checkout-shell"
        data-ticket-id={ticketId}
        data-ephemeral={isEphemeral ? "true" : "false"}
      >
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
      <div
        className="checkout-shell"
        data-slot="checkout-shell"
        data-ticket-id={ticketId}
        data-ephemeral={isEphemeral ? "true" : "false"}
      >
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
    <div
      className="checkout-shell"
      data-slot="checkout-shell"
      data-ticket-id={ticketId}
      data-ephemeral={isEphemeral ? "true" : "false"}
    >
      <TxHeader
        subtitle="Walk-in"
        isEphemeral={isEphemeral}
        onCancel={handleCancel}
        onDiscard={handleDiscard}
        disabled={inflight}
      />
      {/* Tech-assignment band — a full-width gate between the header and
          the two-column body, so "assign a tech" reads as a prominent
          step before any service can be tapped. Mirrors `FlowSingle.jsx`
          lines 182-199 (the prototype every checkout component cites). */}
      <div className="checkout-tech-band" data-slot="checkout-tech-band">
        <TechAvatarRow
          staff={staff}
          selectedStaffId={selectedStaffId}
          onPick={handlePickTech}
          onClear={handleClearTech}
        />
      </div>
      <div className="checkout-body">
        {/* LEFT: service catalog column */}
        <section className="checkout-catalog" aria-label="Service catalog">
          <ServiceTiles
            services={services}
            disabled={!selectedStaffId}
            onPick={handlePickService}
          />
        </section>
        {/* RIGHT: cart column */}
        <section className="checkout-cart" aria-label="Cart">
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
          {splitMode ? (
            <SplitCartFooter
              ticketTotalCents={totals.totalCents}
              legs={legs}
              busy={splitBusy}
              cardEnabled={squareConnected && !requiresReconnect && pairedDevices.length >= 1}
              giftEnabled={squareConnected && !requiresReconnect}
              onComposeLeg={(method, amountCents) => void handleComposeLeg(method, amountCents)}
              onRemoveDraft={(paymentId) => void handleRemoveDraftLeg(paymentId)}
              onExitSplit={() => void handleExitSplit()}
              onActivateCash={(paymentId) => void handleActivateCashLeg(paymentId)}
              onActivateCard={(paymentId) => void handleActivateCardLeg(paymentId)}
              onActivateGift={(paymentId) => handleActivateGiftLeg(paymentId)}
            />
          ) : (
            <>
              <PaymentTiles
                value={paymentMethod}
                onChange={setPaymentMethod}
                squareConnected={squareConnected && !requiresReconnect}
                devicesAvailable={pairedDevices.length}
                onPickGift={() => {
                  if (!totals.chargeEligible || lines.some((l) => l.priceUnconfirmed)) {
                    toast.error("Set a price on every line before charging.");
                    setPaymentMethod(null);
                    return;
                  }
                  openGiftFlow();
                }}
                onPickSplit={handlePickSplit}
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
                  onClick={chargeMethodIsCard ? handleSendCard : handleTakeCash}
                  disabled={!chargeButtonEnabled}
                  data-slot={chargeMethodIsCard ? "send-to-terminal-button" : "take-cash-button"}
                  style={{
                    flex: "1 1 auto",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: "var(--space-10)",
                    padding: "0 var(--space-4)",
                    background: chargeButtonEnabled ? "var(--primary)" : "var(--muted)",
                    color: chargeButtonEnabled
                      ? "var(--primary-foreground)"
                      : "var(--muted-foreground)",
                    border: "none",
                    borderRadius: "var(--radius-sm)",
                    fontSize: "var(--text-base)",
                    fontWeight: 600,
                    cursor: chargeButtonEnabled ? "pointer" : "not-allowed",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {hasUnpricedLines
                    ? "Set price on highlighted items"
                    : chargeMethodIsCard
                      ? `Send to Square · ${fmt(totals.totalCents)}`
                      : `Take cash · ${fmt(totals.totalCents)}`}
                </button>
              </div>
            </>
          )}
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

      {/* Feature 018 — Gift card flow sheets. */}
      {giftStage === "numpad" ? (
        <GanNumpadSheet
          onSubmit={(gan) =>
            splitGanPaymentId ? void handleSplitGanSubmit(gan) : void handleGanSubmit(gan)
          }
          onCancel={() => {
            if (splitGanPaymentId) {
              setSplitGanPaymentId(null);
              setGiftStage("idle");
              setGiftBusy(false);
            } else {
              closeGiftFlow();
            }
          }}
          busy={giftBusy}
        />
      ) : null}
      {giftStage === "balance" && giftLookup ? (
        <GiftCardBalanceSheet
          result={giftLookup}
          onRedeem={() => void handleGiftRedeem()}
          onCancel={closeGiftFlow}
          onReenter={() => {
            setGiftLookup(null);
            setGiftGan(null);
            setGiftStage("numpad");
          }}
          busy={giftBusy}
          remainingOwedCents={(() => {
            // US3 (T051): the sheet uses this to render the partial
            // copy ("Ticket needs $Y · split needed") when the gift
            // balance won't cover the bill. Computed off live totals
            // minus succeeded legs (drafts/pending don't count — gift
            // redemption wipes them via discardDraftLegs).
            const succeeded = legs
              .filter((l) => l.status === "succeeded")
              .reduce((sum, l) => sum + l.amountCents, 0);
            return Math.max(0, totals.totalCents - succeeded);
          })()}
        />
      ) : null}
      {/* Feature 018 (US3 / T052) — second-leg method picker for the
          partial-gift auto-split flow. Opens automatically when
          redeemGiftCardWholeTicket resolves with `partial_split`. */}
      {methodPicker ? (
        <MethodPickerPopover
          amountCents={methodPicker.amountCents}
          onPick={(method) => void handleMethodPickerPick(method)}
          onCancel={() => setMethodPicker(null)}
          busy={methodPickerBusy}
        />
      ) : null}
      {giftStage === "waiting" ? (
        <div
          data-slot="gift-card-waiting"
          role="status"
          style={{
            position: "fixed",
            inset: 0,
            background: "color-mix(in oklch, var(--background) 92%, transparent)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "var(--space-3)",
            zIndex: 50,
          }}
        >
          <div
            style={{
              width: "var(--space-12)",
              height: "var(--space-12)",
              borderRadius: "var(--radius-full)",
              background: "color-mix(in oklch, var(--primary) 12%, transparent)",
              color: "var(--primary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "var(--text-base)",
              fontWeight: 600,
              fontVariantNumeric: "tabular-nums",
            }}
            aria-hidden="true"
          >
            ...
          </div>
          <div
            style={{
              fontSize: "var(--text-lg)",
              fontWeight: 600,
              color: "var(--foreground)",
            }}
          >
            Redeeming gift card…
          </div>
          <div
            style={{
              fontSize: "var(--text-sm)",
              color: "var(--muted-foreground)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            Waiting for Square to confirm the payment.
          </div>
        </div>
      ) : null}
    </div>
  );
}
