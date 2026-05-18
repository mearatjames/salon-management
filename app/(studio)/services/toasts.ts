// Toast vocabulary for the services-catalog surface. Single source of
// truth so unit tests, e2e tests, and the URL → Sonner bridge all
// reference the same copy. Verbatim from
// `contracts/ui.contract.md § 4` (toast strings + variants).
//
// Each entry is keyed by the URL `?toast=<key>` / `?error=<code>` value
// (with a `{name}` interpolation for verbs that ship the service name in
// `?name=<encoded>`). The `variant` is the Sonner variant the toaster
// fires on read.

export type ToastVariant = "success" | "warning" | "destructive" | "info";

export type ToastEntry = {
  variant: ToastVariant;
  /** Render the toast text given an optional service `name` from `?name=`. */
  text: (name?: string) => string;
};

export const TOASTS = {
  // Success ----------------------------------------------------------------
  service_added: {
    variant: "success",
    text: (name) => `${name ?? "Service"} added to the catalog`,
  },
  changes_saved: {
    variant: "success",
    text: () => "Changes saved",
  },
  service_archived: {
    variant: "success",
    text: (name) => `${name ?? "Service"} archived`,
  },
  service_restored: {
    variant: "success",
    text: (name) => `${name ?? "Service"} restored`,
  },

  // Secondary (may stack with a success toast) ----------------------------
  no_techs_assigned: {
    variant: "warning",
    text: () => "Nobody can perform this service yet. Add techs from the edit drawer.",
  },

  // Destructive (fired on `?error=` paths) --------------------------------
  forbidden: {
    variant: "destructive",
    text: () => "Only owners and managers can edit the catalog.",
  },
  name_too_short: {
    variant: "destructive",
    text: () => "Enter at least 2 characters for the service name.",
  },
  category_required: {
    variant: "destructive",
    text: () => "Pick or type a category.",
  },
  invalid_duration: {
    variant: "destructive",
    text: () => "Duration must be a positive number of minutes.",
  },
  invalid_price: {
    variant: "destructive",
    text: () => "Price must be a positive amount.",
  },
  invalid_bound: {
    variant: "destructive",
    text: () => "Variable price bounds must be positive amounts.",
  },
  bounds_inverted: {
    variant: "destructive",
    text: () => `"From" price can't be higher than "To" price.`,
  },
  invalid_color: {
    variant: "destructive",
    text: () => "Pick one of the eight Lacquer colors.",
  },
  invalid_override: {
    variant: "destructive",
    text: () => "Per-tech duration overrides must be a positive number of minutes.",
  },
  not_found: {
    variant: "destructive",
    text: () => "That service no longer exists.",
  },
  no_changes: {
    variant: "info",
    text: () => "Nothing to save.",
  },
  db_failure: {
    variant: "destructive",
    text: () => "Something went wrong. Please try again.",
  },

  // 021-services-deductions ----------------------------------------------
  invalid_card_fee_mode: {
    variant: "destructive",
    text: () => "Couldn't save service — card-fee mode is invalid.",
  },
  invalid_card_fee_custom: {
    variant: "destructive",
    text: () => "Couldn't save service — custom card fee amount is invalid.",
  },
  card_fee_custom_too_large: {
    variant: "destructive",
    text: () => "Couldn't save service — card fee can't exceed $50.",
  },
  invalid_supply_amount: {
    variant: "destructive",
    text: () => "Couldn't save service — supply amount is invalid.",
  },
  supply_amount_too_large: {
    variant: "destructive",
    text: () => "Couldn't save service — supply can't exceed $50.",
  },

  // 022-supply-types-catalog ---------------------------------------------
  // Success keys
  supply_type_created: {
    variant: "success",
    text: (name) => `Supply type "${name ?? ""}" created.`,
  },
  supply_type_renamed: {
    variant: "success",
    text: () => "Supply type renamed.",
  },
  supply_type_archived: {
    variant: "success",
    text: (name) => `Supply type "${name ?? ""}" archived.`,
  },
  supply_type_reactivated: {
    variant: "success",
    text: (name) => `Supply type "${name ?? ""}" reactivated.`,
  },
  // Error-code mappings (surface on the existing ?error=<code> channel)
  name_too_long: {
    variant: "destructive",
    text: () => "Supply type name must be 64 characters or fewer.",
  },
  name_taken: {
    variant: "destructive",
    text: () => "A supply type with this name already exists.",
  },
  type_not_found: {
    variant: "destructive",
    text: () => "That supply type doesn't exist anymore. Re-pick from the dropdown.",
  },
  type_in_use: {
    variant: "destructive",
    text: () => "Remove this type from the services that use it first.",
  },
  type_already_archived: {
    variant: "destructive",
    text: () => "That supply type is already archived.",
  },
  type_already_active: {
    variant: "destructive",
    text: () => "That supply type is already active.",
  },
  type_archived: {
    variant: "destructive",
    text: () => "That supply type is archived. Reactivate it first to rename.",
  },
  invalid_supply_type: {
    variant: "destructive",
    text: () => "Pick a supply type from the dropdown.",
  },
} as const satisfies Record<string, ToastEntry>;

export type ToastKey = keyof typeof TOASTS;
