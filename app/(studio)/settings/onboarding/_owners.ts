// Onboarding last-owner guard (#218). Pure function so the predicate is
// unit-testable apart from the page.
//
// `activeOwnerIds` must come from an UNFILTERED query using the server's
// predicate (`role='owner' AND active AND removed_at IS NULL`) — the same
// one `loadLifecycleTarget` and `staff_assert_owner_present()` count. The
// target is the last owner only when no OTHER id is in that set.

import type { OnboardingUser } from "./_types";

export function isLastActiveOwner(
  target: Pick<OnboardingUser, "id" | "role">,
  activeOwnerIds: readonly string[]
): boolean {
  if (target.role !== "owner") return false;
  return !activeOwnerIds.some((id) => id !== target.id);
}
