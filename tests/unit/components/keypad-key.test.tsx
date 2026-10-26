// Issue #214: on iOS, fast PIN taps lose their synthesized `click` (the
// Radix Dialog scroll lock cancels `touchmove`, and overlapping touches
// produce no click at all). `<KeypadKey>` fires touch presses on
// `pointerdown` instead, and keeps `click` for mouse + keyboard activation.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/app/(device)/select-staff/actions", () => ({
  submitPin: vi.fn(async () => ({ ok: false })),
}));

import { KeypadKey } from "@/components/lacquer/keypad-key.client";
import { PinEntryModal } from "@/components/lacquer/select-staff/pin-entry-modal.client";
import type { StaffRosterEntry } from "@/components/lacquer/select-staff/select-staff-screen.client";

afterEach(() => {
  cleanup();
});

function touchDown(el: Element) {
  fireEvent.pointerDown(el, { pointerType: "touch", button: 0 });
}

describe("<KeypadKey>", () => {
  it("fires once on touch pointerdown and skips the synthesized click", () => {
    const onPress = vi.fn();
    render(<KeypadKey onPress={onPress}>1</KeypadKey>);
    const key = screen.getByRole("button", { name: "1" });

    touchDown(key);
    expect(onPress).toHaveBeenCalledTimes(1);

    fireEvent.click(key);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("fires on touch pointerdown even when the browser never sends a click", () => {
    const onPress = vi.fn();
    render(<KeypadKey onPress={onPress}>1</KeypadKey>);

    touchDown(screen.getByRole("button", { name: "1" }));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("fires on click for a mouse press, not on its pointerdown", () => {
    const onPress = vi.fn();
    render(<KeypadKey onPress={onPress}>1</KeypadKey>);
    const key = screen.getByRole("button", { name: "1" });

    fireEvent.pointerDown(key, { pointerType: "mouse", button: 0 });
    expect(onPress).not.toHaveBeenCalled();

    fireEvent.click(key);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("fires on click for keyboard / assistive-tech activation (no pointerdown)", () => {
    const onPress = vi.fn();
    render(<KeypadKey onPress={onPress}>1</KeypadKey>);

    fireEvent.click(screen.getByRole("button", { name: "1" }));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("ignores a non-primary-button pointerdown", () => {
    const onPress = vi.fn();
    render(<KeypadKey onPress={onPress}>1</KeypadKey>);

    fireEvent.pointerDown(screen.getByRole("button", { name: "1" }), {
      pointerType: "pen",
      button: 2,
    });

    expect(onPress).not.toHaveBeenCalled();
  });
});

describe("<PinEntryModal> fast touch taps", () => {
  const staff = {
    id: "staff-1",
    display_name: "Maya",
    role: "tech",
    color_token: "rose",
  } as StaffRosterEntry;

  it("keeps every digit when overlapping taps produce no clicks", () => {
    render(<PinEntryModal staff={staff} next="/" onClose={() => {}} />);

    for (const d of ["1", "2", "3"]) {
      touchDown(screen.getByRole("button", { name: `Digit ${d}` }));
    }

    const indicator = screen.getByRole("img", { name: /PIN entry/ });
    expect(indicator.getAttribute("aria-label")).toBe("PIN entry, 3 of 4 digits");
  });
});
