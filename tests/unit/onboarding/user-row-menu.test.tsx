// Regression coverage for issue #125 — the four onboarding row-menu
// items that submit server actions must fire each action EXACTLY ONCE
// per activation, not twice.
//
// Before the fix, `<DropdownMenuItem asChild>` rendered a `<form>` whose
// child was a `<button type="submit">` and the menu item carried an
// `onSelect` that did `e.preventDefault(); btn.click()`. A mouse click
// on the inner submit button submitted the form natively (call #1) AND
// bubbled to the menu item, whose handler then fired `btn.click()`
// programmatically (call #2). For `reactivateUser` the second call lost
// the state precondition (now `state='invited'`, no longer
// `'offboarded'`) and surfaced a misleading "user was just removed by
// someone else" toast even though the reactivation had succeeded. The
// same pattern silently double-fired `sendUserPasswordReset`,
// `resendInvite`, and `cancelInvite`.
//
// Each test below activates one menu item and asserts the mocked
// server action was invoked once. Watched-fail step (TDD): on the
// pre-fix code these assertions fail with `Expected 1, received 2`.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Hoisted mocks — `vi.mock` runs before the component import. We mock
// every action the menu's nested sheets transitively import (offboard,
// remove, reset PIN) so jsdom can render the full subtree without
// hitting "no export defined" errors.
vi.mock("@/app/(studio)/settings/onboarding/actions", () => ({
  cancelInvite: vi.fn(),
  getInviteLink: vi.fn(),
  inviteUser: vi.fn(),
  offboardUser: vi.fn(),
  reactivateUser: vi.fn(),
  removeUser: vi.fn(),
  resendInvite: vi.fn(),
  resetUserPin: vi.fn(),
  sendUserPasswordReset: vi.fn(),
}));

import {
  cancelInvite,
  reactivateUser,
  resendInvite,
  sendUserPasswordReset,
} from "@/app/(studio)/settings/onboarding/actions";
import {
  UserRowMenu,
  type UserRowMenuTarget,
} from "@/components/lacquer/onboarding/user-row-menu.client";

const TARGET: UserRowMenuTarget = {
  id: "staff-uuid-1",
  display_name: "Jordan Lee",
  email: "jordan@tangnails.test",
  role: "technician",
  color_token: "--chart-1",
  is_you: false,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function openRowMenu(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  const trigger = screen.getByRole("button", { name: /Open menu for Jordan Lee/ });
  await user.click(trigger);
}

// Click the inner `<button type=submit>` (mirrors a real user clicking
// the visible row label). Clicking the menu-item form element itself
// won't dispatch a submit event in jsdom — only a click on the inner
// button does, which is what surfaces the double-fire in production.
async function clickInnerSubmit(
  user: ReturnType<typeof userEvent.setup>,
  slot: string
): Promise<void> {
  const btn = await screen.findByRole("button", {
    name: new RegExp(slot.replace(/-/g, " "), "i"),
  });
  await user.click(btn);
}

describe("<UserRowMenu /> — single-submission contract (issue #125)", () => {
  it("clicking Reactivate submits reactivateUser exactly once", async () => {
    const user = userEvent.setup();
    render(<UserRowMenu kind="offboarded" target={TARGET} isLastOwner={false} />);
    await openRowMenu(user);
    await clickInnerSubmit(user, "Reactivate");

    await waitFor(() => {
      expect(vi.mocked(reactivateUser)).toHaveBeenCalledTimes(1);
    });
  });

  it("clicking Cancel invite submits cancelInvite exactly once", async () => {
    const user = userEvent.setup();
    render(<UserRowMenu kind="pending" target={TARGET} isLastOwner={false} />);
    await openRowMenu(user);
    await clickInnerSubmit(user, "Cancel invite");

    await waitFor(() => {
      expect(vi.mocked(cancelInvite)).toHaveBeenCalledTimes(1);
    });
  });

  it("clicking Send password reset submits sendUserPasswordReset exactly once", async () => {
    const user = userEvent.setup();
    render(<UserRowMenu kind="active" target={TARGET} isLastOwner={false} />);
    await openRowMenu(user);
    await clickInnerSubmit(user, "Send password reset");

    await waitFor(() => {
      expect(vi.mocked(sendUserPasswordReset)).toHaveBeenCalledTimes(1);
    });
  });

  it("clicking Resend invite (menu variant) submits resendInvite exactly once", async () => {
    const user = userEvent.setup();
    render(<UserRowMenu kind="pending" target={TARGET} isLastOwner={false} />);
    await openRowMenu(user);
    // PendingMenu also renders an *inline* Resend icon (outside the
    // dropdown). Disambiguate by picking the one inside the menu.
    const items = await screen.findAllByRole("button", { name: /Resend invite/i });
    const menuItem = items.find(
      (el) => el.getAttribute("data-slot") === "user-row-menu-resend-btn"
    );
    if (!menuItem) throw new Error("menu Resend button not found");
    await user.click(menuItem);

    await waitFor(() => {
      expect(vi.mocked(resendInvite)).toHaveBeenCalledTimes(1);
    });
  });

  // Locks in keyboard support — the original `btn.click()` indirection
  // existed because Radix doesn't dispatch a synthetic click on the
  // inner submit button when the menuitem is keyboard-activated. The
  // fix preserves that path via `e.currentTarget.requestSubmit()` in
  // onSelect (Radix's onSelect fires for both pointer and Enter).
  it("keyboard Enter on Reactivate still submits reactivateUser exactly once", async () => {
    const user = userEvent.setup();
    render(<UserRowMenu kind="offboarded" target={TARGET} isLastOwner={false} />);
    await openRowMenu(user);

    // Move focus to the Reactivate menuitem (it's the first item).
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(vi.mocked(reactivateUser)).toHaveBeenCalledTimes(1);
    });
  });
});
