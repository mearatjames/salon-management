// Unit tests for the topbar operator surface after feature 009:
//
//   1. <OperatorMenu> dropdown contains ONLY "Sign out" — the "Switch staff"
//      item has been promoted to a standalone top-nav button.
//   2. <SwitchStaffButton /> renders a submit button labeled "Switch staff"
//      with `data-slot="switch-staff-button"` and a Lucide `Repeat` icon.
//   3. Clicking the button submits a `<form action={switchStaff}>` — verified
//      by asserting the mocked `switchStaff` server action is invoked.
//
// Vitest + jsdom + Testing Library. Mirrors the existing
// `tests/unit/auth/*.test.ts` setup (no DOM in those files — we add the
// React DOM here via `@testing-library/react`).
//
// Constitution Principle IV (Test-First, NON-NEGOTIABLE) — these cases were
// written and shown to fail against the unchanged code before the
// implementation tasks (T006–T008) landed.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock the server-action module BEFORE importing anything that depends on it.
// `vi.mock` is hoisted so this runs first regardless of textual order.
vi.mock("@/app/(studio)/actions", () => ({
  switchStaff: vi.fn(),
  signOut: vi.fn(),
}));

import { switchStaff } from "@/app/(studio)/actions";

import { OperatorChip } from "@/components/lacquer/operator-chip";
import { OperatorMenu } from "@/components/lacquer/operator-menu";
import { SwitchStaffButton } from "@/components/lacquer/switch-staff-button";

const STAFF_FIXTURE = {
  display_name: "Maya Patel",
  role: "technician",
  color_token: "--chart-1",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("<OperatorMenu /> after feature 009", () => {
  it("dropdown shows only Sign out — no Switch staff menuitem", async () => {
    const user = userEvent.setup();
    render(
      <OperatorMenu>
        <OperatorChip staff={STAFF_FIXTURE} />
      </OperatorMenu>
    );

    // Open the dropdown by clicking the operator chip (the radix trigger
    // passed in as `children`). Radix renders content into a portal that
    // jsdom does mount, so `screen` queries see the menuitems once open.
    const chip = screen.getByRole("button", { name: /Maya Patel/ });
    await user.click(chip);

    await waitFor(() => {
      expect(screen.getByRole("menuitem", { name: /sign out/i })).toBeInTheDocument();
    });

    expect(screen.queryByRole("menuitem", { name: /switch staff/i })).toBeNull();
  });
});

describe("<SwitchStaffButton />", () => {
  beforeEach(() => {
    vi.mocked(switchStaff).mockClear();
  });

  it("renders a labeled submit button with the data-slot contract and a Lucide icon", () => {
    render(<SwitchStaffButton />);

    const button = screen.getByRole("button", { name: /switch staff/i });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("type", "submit");
    expect(button).toHaveAttribute("data-slot", "switch-staff-button");

    // The Lucide Repeat icon renders as an inline <svg>. Aria-hidden so it
    // doesn't double-announce the label; we still assert presence.
    const svg = button.querySelector("svg");
    expect(svg).not.toBeNull();
  });

  it("submitting the form invokes the switchStaff server action", async () => {
    // DEVIATION (documented): the original task text in tasks.md asks us to
    // assert "the form's action attribute is the mocked function reference."
    // Under Vitest + jsdom (no Next.js RSC transforms), a function passed as
    // `action={fn}` is consumed by React as a Server-Action handler — it is
    // NOT reflected to a DOM `action="..."` attribute. The behaviorally
    // equivalent assertion is: clicking the submit button calls the mocked
    // server action exactly once. That is what we assert here.
    const user = userEvent.setup();
    render(<SwitchStaffButton />);

    const button = screen.getByRole("button", { name: /switch staff/i });
    await user.click(button);

    await waitFor(() => {
      expect(vi.mocked(switchStaff)).toHaveBeenCalledTimes(1);
    });
  });
});
