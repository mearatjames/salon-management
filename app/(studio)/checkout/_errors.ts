// Typed error contract for the checkout Server Actions. Lives in its own
// module so it can be imported from both the action implementations and
// the client island — `app/(studio)/checkout/actions.ts` is marked
// `"use server"`, and Next.js forbids any non-async export from a
// `"use server"` file. The discriminated-union + error subclass pattern
// stays the source of truth for callers' `instanceof` narrowing.
//
// See `specs/011-cash-sale-checkout/contracts/server-actions.md § Errors`.

export type CheckoutActionError =
  | { code: "TICKET_NOT_OPEN" }
  | { code: "TICKET_ALREADY_TERMINAL" }
  | { code: "TICKET_HAS_UNPRICED_ITEMS" }
  | { code: "TICKET_EMPTY" }
  | { code: "STAFF_NOT_ACTIVE" }
  | { code: "SERVICE_ARCHIVED" }
  | { code: "CASH_PAYMENT_FAILED"; pgError?: string }
  // Added by feature 013-cart-polish
  | { code: "INVALID_PRICE" }
  | {
      code: "DISCOUNT_INVALID";
      reason:
        | "flat_value_non_positive"
        | "percent_out_of_range"
        | "note_too_long"
        | "not_a_discount_line"
        // Added by feature 049-per-service-discount (T008)
        | "scope_empty"
        | "scope_target_unknown"
        | "scope_off_ticket";
    }
  | { code: "EMAIL_ADDRESS_INVALID" }
  // Added by feature 015-square-terminal-payment (US2/US3)
  | { code: "TERMINAL_DEVICE_REQUIRED" }
  | { code: "SQUARE_CHECKOUT_CREATE_FAILED"; squareError?: string }
  | { code: "PAYMENT_NOT_FOUND" }
  | { code: "PAYMENT_NOT_CANCELLABLE" }
  // Added by issue #26 — discardTicket money-loss defense
  | {
      code: "TICKET_HAS_INFLIGHT_PAYMENT";
      counts: { draft: number; pending: number; succeeded: number };
    }
  // Added by feature 018-gift-card-split-tender
  | { code: "GIFT_CARD_NOT_FOUND" }
  | { code: "GIFT_CARD_NOT_REDEEMABLE"; state: "PENDING" | "BLOCKED" | "DEACTIVATED" }
  | { code: "GIFT_CARD_ZERO_BALANCE" }
  | { code: "GIFT_CARD_INSUFFICIENT_BALANCE" }
  | { code: "INVALID_GAN" }
  | { code: "SQUARE_GIFT_CARD_LOOKUP_FAILED"; squareError?: string }
  | { code: "SQUARE_GIFT_CARD_PAYMENT_FAILED"; squareError?: string }
  | { code: "TICKET_ALREADY_BEING_CHARGED" }
  | { code: "LEG_SUM_MISMATCH"; expected: number; actual: number }
  | { code: "LEG_AMOUNT_INVALID" }
  | { code: "DRAFT_LEG_NOT_FOUND" };

export abstract class CheckoutError extends Error {
  abstract readonly code: CheckoutActionError["code"];
}

export class TicketNotOpenError extends CheckoutError {
  readonly code = "TICKET_NOT_OPEN" as const;
  constructor(message = "ticket is not open") {
    super(message);
    this.name = "TicketNotOpenError";
  }
}

export class TicketAlreadyTerminalError extends CheckoutError {
  readonly code = "TICKET_ALREADY_TERMINAL" as const;
  constructor(message = "ticket is already paid or discarded") {
    super(message);
    this.name = "TicketAlreadyTerminalError";
  }
}

export type InflightPaymentCounts = {
  draft: number;
  pending: number;
  succeeded: number;
};

// Issue #26 — typed companion for the "ticket has in-flight payments"
// refusal. The `discardTicket` Server Action surfaces this condition as
// an in-band return value (`refusedReason: 'ticket_has_inflight_payment'`)
// because Next.js' production Server Action build strips error metadata
// across the client boundary; this class stays defined so same-process
// callers and unit tests can construct/inspect the typed shape with the
// structured `counts` payload.
export class TicketHasInflightPaymentError extends CheckoutError {
  readonly code = "TICKET_HAS_INFLIGHT_PAYMENT" as const;
  readonly counts: InflightPaymentCounts;
  constructor(
    counts: InflightPaymentCounts,
    message = "ticket has pending or captured payments and cannot be discarded"
  ) {
    super(message);
    this.name = "TicketHasInflightPaymentError";
    this.counts = counts;
  }
}

export class TicketHasUnpricedItemsError extends CheckoutError {
  readonly code = "TICKET_HAS_UNPRICED_ITEMS" as const;
  constructor(message = "ticket has variable-price items without a confirmed price") {
    super(message);
    this.name = "TicketHasUnpricedItemsError";
  }
}

export class TicketEmptyError extends CheckoutError {
  readonly code = "TICKET_EMPTY" as const;
  constructor(message = "ticket total is zero") {
    super(message);
    this.name = "TicketEmptyError";
  }
}

export class StaffNotActiveError extends CheckoutError {
  readonly code = "STAFF_NOT_ACTIVE" as const;
  constructor(message = "assigned staff is not active") {
    super(message);
    this.name = "StaffNotActiveError";
  }
}

export class ServiceArchivedError extends CheckoutError {
  readonly code = "SERVICE_ARCHIVED" as const;
  constructor(message = "service is archived") {
    super(message);
    this.name = "ServiceArchivedError";
  }
}

export class CashPaymentFailedError extends CheckoutError {
  readonly code = "CASH_PAYMENT_FAILED" as const;
  readonly pgError?: string;
  constructor(message = "cash payment failed", pgError?: string) {
    super(message);
    this.name = "CashPaymentFailedError";
    this.pgError = pgError;
  }
}

// ----------------------------------------------------------------------
// Feature 013-cart-polish — variable-price / discount / receipt-email errors.
// Contract: `specs/013-cart-polish/contracts/server-actions.md § Errors`.
// ----------------------------------------------------------------------

export class InvalidPriceError extends CheckoutError {
  readonly code = "INVALID_PRICE" as const;
  constructor(message = "invalid price") {
    super(message);
    this.name = "InvalidPriceError";
  }
}

export type DiscountInvalidReason =
  | "flat_value_non_positive"
  | "percent_out_of_range"
  | "note_too_long"
  | "not_a_discount_line"
  // Added by feature 049-per-service-discount (T008) — the scope-validation
  // surface on `addDiscountLine` (and the upcoming `editDiscountLine`).
  // - scope_empty:         targetLineIds provided but empty after dedupe.
  // - scope_target_unknown: a target uuid isn't a same-ticket service row
  //                         (not in `ticket_items` at all OR its kind is
  //                         not 'service').
  // - scope_off_ticket:    the target uuid IS a `ticket_items` row but its
  //                        ticket_id is a different ticket.
  | "scope_empty"
  | "scope_target_unknown"
  | "scope_off_ticket";

export class DiscountInvalidError extends CheckoutError {
  readonly code = "DISCOUNT_INVALID" as const;
  readonly reason: DiscountInvalidReason;
  constructor(message: string, reason: DiscountInvalidReason) {
    super(message);
    this.reason = reason;
    this.name = "DiscountInvalidError";
  }
}

export class EmailAddressInvalidError extends CheckoutError {
  readonly code = "EMAIL_ADDRESS_INVALID" as const;
  constructor(message = "email address is invalid") {
    super(message);
    this.name = "EmailAddressInvalidError";
  }
}

// ----------------------------------------------------------------------
// Feature 015-square-terminal-payment — card-payment errors.
// Contract: `specs/015-square-terminal-payment/contracts/server-actions.md
// § "Error class layout"`. The Square-connection-state errors
// (SquareNotConnectedError / SquareReconnectRequiredError) live in
// `app/(studio)/settings/square/_errors.ts` and are re-exported here for
// `instanceof` ergonomics from the checkout actions module.
// ----------------------------------------------------------------------

export class TerminalDeviceRequiredError extends CheckoutError {
  readonly code = "TERMINAL_DEVICE_REQUIRED" as const;
  constructor(
    message = "No Square Terminal selected — pair a device or mark one as default in settings"
  ) {
    super(message);
    this.name = "TerminalDeviceRequiredError";
  }
}

export class SquareCheckoutCreateFailedError extends CheckoutError {
  readonly code = "SQUARE_CHECKOUT_CREATE_FAILED" as const;
  readonly squareError?: string;
  constructor(message = "Square could not start the terminal checkout", squareError?: string) {
    super(message);
    this.name = "SquareCheckoutCreateFailedError";
    this.squareError = squareError;
  }
}

export class PaymentNotFoundError extends CheckoutError {
  readonly code = "PAYMENT_NOT_FOUND" as const;
  constructor(message = "payment not found") {
    super(message);
    this.name = "PaymentNotFoundError";
  }
}

export class PaymentNotCancellableError extends CheckoutError {
  readonly code = "PAYMENT_NOT_CANCELLABLE" as const;
  constructor(message = "payment is not in a cancellable state") {
    super(message);
    this.name = "PaymentNotCancellableError";
  }
}

// Re-export the Square-connection-state errors so checkout call sites can
// `import { SquareNotConnectedError } from '@/app/(studio)/checkout/_errors'`
// instead of reaching into the settings module. The single source of
// definition stays in `app/(studio)/settings/square/_errors.ts`.
export {
  SquareNotConnectedError,
  SquareReconnectRequiredError,
} from "@/app/(studio)/settings/square/_errors";

// ----------------------------------------------------------------------
// Feature 018-gift-card-split-tender — gift-card + split-tender errors.
// Contract: `specs/018-gift-card-split-tender/contracts/server-actions.md
// § 9`.
// ----------------------------------------------------------------------

export class GiftCardNotFoundError extends CheckoutError {
  readonly code = "GIFT_CARD_NOT_FOUND" as const;
  constructor(message = "no gift card found for that number") {
    super(message);
    this.name = "GiftCardNotFoundError";
  }
}

export class GiftCardNotRedeemableError extends CheckoutError {
  readonly code = "GIFT_CARD_NOT_REDEEMABLE" as const;
  readonly state: "PENDING" | "BLOCKED" | "DEACTIVATED";
  constructor(state: "PENDING" | "BLOCKED" | "DEACTIVATED", message?: string) {
    super(message ?? `gift card is ${state} and can't be redeemed`);
    this.name = "GiftCardNotRedeemableError";
    this.state = state;
  }
}

export class GiftCardZeroBalanceError extends CheckoutError {
  readonly code = "GIFT_CARD_ZERO_BALANCE" as const;
  constructor(message = "gift card has $0 balance") {
    super(message);
    this.name = "GiftCardZeroBalanceError";
  }
}

export class GiftCardInsufficientBalanceError extends CheckoutError {
  readonly code = "GIFT_CARD_INSUFFICIENT_BALANCE" as const;
  constructor(message = "gift card balance is less than the leg amount") {
    super(message);
    this.name = "GiftCardInsufficientBalanceError";
  }
}

export class InvalidGanError extends CheckoutError {
  readonly code = "INVALID_GAN" as const;
  constructor(message = "gift card number is invalid") {
    super(message);
    this.name = "InvalidGanError";
  }
}

export class SquareGiftCardLookupFailedError extends CheckoutError {
  readonly code = "SQUARE_GIFT_CARD_LOOKUP_FAILED" as const;
  readonly squareError?: string;
  constructor(message = "could not reach Square to look up the gift card", squareError?: string) {
    super(message);
    this.name = "SquareGiftCardLookupFailedError";
    this.squareError = squareError;
  }
}

export class SquareGiftCardPaymentFailedError extends CheckoutError {
  readonly code = "SQUARE_GIFT_CARD_PAYMENT_FAILED" as const;
  readonly squareError?: string;
  constructor(message = "Square rejected the gift-card payment", squareError?: string) {
    super(message);
    this.name = "SquareGiftCardPaymentFailedError";
    this.squareError = squareError;
  }
}

export class TicketAlreadyBeingChargedError extends CheckoutError {
  readonly code = "TICKET_ALREADY_BEING_CHARGED" as const;
  constructor(message = "ticket is already being charged on another device") {
    super(message);
    this.name = "TicketAlreadyBeingChargedError";
  }
}

export class LegSumMismatchError extends CheckoutError {
  readonly code = "LEG_SUM_MISMATCH" as const;
  readonly expected: number;
  readonly actual: number;
  constructor(expected: number, actual: number, message?: string) {
    super(message ?? `legs must sum to ${expected} (got ${actual})`);
    this.name = "LegSumMismatchError";
    this.expected = expected;
    this.actual = actual;
  }
}

export class LegAmountInvalidError extends CheckoutError {
  readonly code = "LEG_AMOUNT_INVALID" as const;
  constructor(message = "leg amount must fit the remaining-owed total") {
    super(message);
    this.name = "LegAmountInvalidError";
  }
}

export class DraftLegNotFoundError extends CheckoutError {
  readonly code = "DRAFT_LEG_NOT_FOUND" as const;
  constructor(message = "draft leg not found or already settled") {
    super(message);
    this.name = "DraftLegNotFoundError";
  }
}

// ----------------------------------------------------------------------
// Feature 052-privileged-action-overrides — void & refund errors.
// Contract: `specs/052-privileged-action-overrides/contracts/
// server-actions.contract.md`. These follow the same `.name`-discriminated
// convention as the classes above; the void/refund actions throw them and
// callers narrow with `instanceof` / `.name`.
//
// `PermissionDeniedError` is reused from the transactions module (it is a
// plain standalone class there, not part of the CheckoutError union) and
// re-exported below so both checkout + transactions share one definition.
// ----------------------------------------------------------------------

export class VoidNotAllowedError extends Error {
  constructor(message = "This sale can't be voided — only same-day paid sales are eligible.") {
    super(message);
    this.name = "VoidNotAllowedError";
  }
}

export class RefundExceedsRemainingError extends Error {
  constructor(message = "A refund line exceeds the payment's unrefunded remainder.") {
    super(message);
    this.name = "RefundExceedsRemainingError";
  }
}

export class PaymentNotOnTicketError extends Error {
  constructor(message = "That payment isn't part of this ticket.") {
    super(message);
    this.name = "PaymentNotOnTicketError";
  }
}

export class SquareRefundFailedError extends Error {
  readonly squareError?: string;
  constructor(
    message = "Square couldn't process the refund. The sale is unchanged.",
    squareError?: string
  ) {
    super(message);
    this.name = "SquareRefundFailedError";
    this.squareError = squareError;
  }
}

// Re-export the shared PermissionDeniedError (defined in the transactions
// module as a standalone class) so void/refund call sites in checkout can
// throw it from a single import surface without a deep cross-feature
// import. The single definition stays in
// `app/(studio)/transactions/_errors.ts`.
export { PermissionDeniedError } from "@/app/(studio)/transactions/_errors";
