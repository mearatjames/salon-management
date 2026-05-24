// Typed error contract for the Transactions Server Actions. Lives in its
// own module so the action implementations + their consumers + the unit
// tests can share `instanceof`-friendly classes. `app/(studio)/transactions/
// actions.ts` is marked `"use server"`, and Next.js forbids any non-async
// export from a `"use server"` file.
//
// `StaffNotActiveError` is re-exported from `app/(studio)/checkout/_errors`
// so transactions callers have a single import surface; the class itself
// stays defined in the checkout module per the contract in
// `specs/050-reassign-paid-line-tech/contracts/server-actions.md`.

export class PermissionDeniedError extends Error {
  constructor(message = "You need owner or manager access to change a service line's tech.") {
    super(message);
    this.name = "PermissionDeniedError";
  }
}

export class TicketNotPaidError extends Error {
  constructor(message = "This ticket isn't paid; use the cart to change the tech instead.") {
    super(message);
    this.name = "TicketNotPaidError";
  }
}

export class PayPeriodFinalizedError extends Error {
  constructor(
    message = "Payouts for this pay period have been finalized. The line can't be reassigned."
  ) {
    super(message);
    this.name = "PayPeriodFinalizedError";
  }
}

export class TicketOrLineNotFoundError extends Error {
  constructor(message = "The ticket or line couldn't be found. Refresh and try again.") {
    super(message);
    this.name = "TicketOrLineNotFoundError";
  }
}

// Re-export `StaffNotActiveError` so transactions callers have one import
// surface (`@/app/(studio)/transactions/_errors`). The class is defined
// in the checkout module; this keeps a single definition while letting
// the transactions action throw it without a deep cross-feature import.
export { StaffNotActiveError } from "@/app/(studio)/checkout/_errors";
