// Typed error contract for the Square settings Server Actions.
// Each error carries a stable machine-readable `code` string and a
// human-readable message. Mirrors the convention from
// `app/(studio)/checkout/_errors.ts`.
//
// See `specs/015-square-terminal-payment/contracts/server-actions.md
// § "Error class layout"`.

export type SquareSettingsErrorCode =
  | "SQUARE_NOT_CONNECTED"
  | "SQUARE_RECONNECT_REQUIRED"
  | "INVALID_DEVICE_NAME"
  | "DEVICE_NOT_FOUND";

export abstract class SquareSettingsError extends Error {
  abstract readonly code: SquareSettingsErrorCode;
}

export class SquareNotConnectedError extends SquareSettingsError {
  readonly code = "SQUARE_NOT_CONNECTED" as const;
  constructor(message = "Square is not connected") {
    super(message);
    this.name = "SquareNotConnectedError";
  }
}

export class SquareReconnectRequiredError extends SquareSettingsError {
  readonly code = "SQUARE_RECONNECT_REQUIRED" as const;
  constructor(message = "Square connection needs to be re-established") {
    super(message);
    this.name = "SquareReconnectRequiredError";
  }
}

export class InvalidDeviceNameError extends SquareSettingsError {
  readonly code = "INVALID_DEVICE_NAME" as const;
  constructor(message = "Device name must be 1 to 60 characters") {
    super(message);
    this.name = "InvalidDeviceNameError";
  }
}

export class DeviceNotFoundError extends SquareSettingsError {
  readonly code = "DEVICE_NOT_FOUND" as const;
  constructor(message = "Square device not found") {
    super(message);
    this.name = "DeviceNotFoundError";
  }
}
