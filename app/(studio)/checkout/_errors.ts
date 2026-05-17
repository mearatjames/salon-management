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
        | "not_a_discount_line";
    }
  | { code: "EMAIL_ADDRESS_INVALID" };

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
// Feature 013-cart-polish — variable-price / discount / bill-email errors.
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
  | "not_a_discount_line";

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
