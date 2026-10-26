// Regression test for issue #214: two digit taps dispatched in the same
// React batch (what happens when two fast touches on an iPad land in the
// same JS task, before React re-renders in between) must not drop a digit.

import { act } from "react";

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/app/(device)/select-staff/actions", () => ({
  submitPin: vi.fn(async () => ({ ok: false })),
}));

import { PinEntryModal } from "@/components/lacquer/select-staff/pin-entry-modal.client";
import type { StaffRosterEntry } from "@/components/lacquer/select-staff/select-staff-screen.client";

afterEach(() => {
  cleanup();
});

const staff: StaffRosterEntry = {
  id: "staff-1",
  display_name: "Maya",
  role: "tech",
  color_token: "rose",
} as StaffRosterEntry;

function digitsEntered() {
  const indicator = screen.getByRole("img", { name: /PIN entry/ });
  return Number(indicator.getAttribute("aria-label")?.match(/(\d+) of 4/)?.[1]);
}

describe("<PinEntryModal> rapid digit taps", () => {
  it("keeps every digit when two taps land in the same batch", () => {
    render(<PinEntryModal staff={staff} next="/" onClose={() => {}} />);

    const btn1 = screen.getByRole("button", { name: "Digit 1" });
    const btn2 = screen.getByRole("button", { name: "Digit 2" });

    act(() => {
      fireEvent.click(btn1);
      fireEvent.click(btn2);
    });

    expect(digitsEntered()).toBe(2);
  });

  it("keeps all four digits across two same-batch double-taps", () => {
    render(<PinEntryModal staff={staff} next="/" onClose={() => {}} />);

    const btn1 = screen.getByRole("button", { name: "Digit 1" });
    const btn2 = screen.getByRole("button", { name: "Digit 2" });
    const btn3 = screen.getByRole("button", { name: "Digit 3" });
    const btn4 = screen.getByRole("button", { name: "Digit 4" });

    act(() => {
      fireEvent.click(btn1);
      fireEvent.click(btn2);
    });
    act(() => {
      fireEvent.click(btn3);
      fireEvent.click(btn4);
    });

    expect(digitsEntered()).toBe(4);
  });
});
