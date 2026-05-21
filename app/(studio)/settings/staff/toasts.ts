// Toast strings for the staff-management surface. Single source of truth so
// unit tests, e2e tests, and the client toaster all reference the same
// copy. Verbatim from ui.contract.md § Toast strings.

export const TOAST = {
  // Success variants
  staffAdded: (name: string) => `${name} added to the roster`,
  changesSaved: () => "Changes saved",
  pinUpdated: () => "PIN updated",
  staffDeactivated: (name: string) => `${name} deactivated`,
  staffRemoved: (name: string) => `${name} removed`,

  // Destructive variants (fired on `?error=` paths)
  forbiddenTarget: () => "Only owners can edit owner accounts.",
  lastOwner: () => "At least one owner must remain.",
  selfEditBlocked: () => "You can't change your own role, deactivate, or remove yourself.",
  notFound: () => "That staff member was removed by another tab.",
  forbidden: () => "Staff settings is restricted to owners and managers.",
  // Catch-all for any `?error=` code without a dedicated mapping (e.g. a
  // validation code like `invalid_role`). Defense in depth — a save
  // failure must never be swallowed silently (issue #112).
  genericError: () => "Something went wrong. Please try again.",
} as const;
