// Component test for <DiscountSheet /> — feature 049-per-service-discount
// (T014 / US1).
//
// Focuses on the new "Applies to" control: default-scope radio renders;
// "Selected services" reveals the chip-picker; Save disabled while
// picked=0 + inline hint visible; picking ≥ 1 chip enables Save; Save
// payload passes `targetLineIds: null` (all) vs. `string[]` (scoped).
//
// Mirrors the Vitest + React Testing Library setup pattern used by
// `tests/unit/checkout/tech-avatar-row.test.tsx`.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  DiscountSheet,
  type DiscountSheetOnSavePayload,
} from "@/components/lacquer/checkout/discount-sheet";

type OnSaveMock = ReturnType<typeof vi.fn<(payload: DiscountSheetOnSavePayload) => Promise<void>>>;
type OnCancelMock = ReturnType<typeof vi.fn<() => void>>;

const SERVICE_LINES = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Manicure",
    unitPriceCents: 4000,
    priceUnconfirmed: false,
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    name: "Pedicure",
    unitPriceCents: 6000,
    priceUnconfirmed: false,
  },
  {
    id: "33333333-3333-3333-3333-333333333333",
    name: "Polish change",
    unitPriceCents: 1500,
    priceUnconfirmed: false,
  },
];

afterEach(() => {
  cleanup();
});

function renderSheet(
  overrides: {
    onSave?: OnSaveMock;
    onCancel?: OnCancelMock;
  } = {}
) {
  const onSave: OnSaveMock =
    overrides.onSave ??
    vi.fn<(payload: DiscountSheetOnSavePayload) => Promise<void>>().mockResolvedValue(undefined);
  const onCancel: OnCancelMock = overrides.onCancel ?? vi.fn<() => void>();
  render(<DiscountSheet serviceLines={SERVICE_LINES} onSave={onSave} onCancel={onCancel} />);
  return { onSave, onCancel };
}

describe("<DiscountSheet /> — Applies to control (feature 049 / US1)", () => {
  it("default scope = 'All services' radio is checked; chip picker NOT rendered", () => {
    renderSheet();

    const allRadio = screen.getByRole("radio", { name: /All services in this sale/i });
    expect(allRadio).toHaveAttribute("aria-checked", "true");

    const selectedRadio = screen.getByRole("radio", { name: /Selected services/i });
    expect(selectedRadio).toHaveAttribute("aria-checked", "false");

    // No chip buttons in the document while scope=all.
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("clicking 'Selected services' reveals one chip per serviceLine with the empty-scope hint visible", async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.click(screen.getByRole("radio", { name: /Selected services/i }));

    const chips = screen.getAllByRole("checkbox");
    expect(chips).toHaveLength(SERVICE_LINES.length);

    // Hint visible while picked = 0.
    expect(screen.getByText(/Pick at least one service\./i)).toBeInTheDocument();

    // Each chip starts unchecked.
    for (const chip of chips) {
      expect(chip).toHaveAttribute("aria-checked", "false");
    }
  });

  it("with amount filled + scope=selected + picked=0 → Save remains disabled and hint visible", async () => {
    const user = userEvent.setup();
    renderSheet();

    // Fill amount with a valid flat dollars value first.
    await user.type(screen.getByLabelText(/Amount/i), "5");

    // Switch scope to selected, leave all chips unpicked.
    await user.click(screen.getByRole("radio", { name: /Selected services/i }));

    const saveBtn = screen.getByRole("button", { name: /Add discount/i });
    expect(saveBtn).toBeDisabled();
    expect(screen.getByText(/Pick at least one service\./i)).toBeInTheDocument();
  });

  it("picking one chip flips its aria-checked, hides the hint, and enables Save", async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.type(screen.getByLabelText(/Amount/i), "5");
    await user.click(screen.getByRole("radio", { name: /Selected services/i }));

    const pediChip = screen.getByRole("checkbox", { name: /Pedicure/i });
    expect(pediChip).toHaveAttribute("aria-checked", "false");

    await user.click(pediChip);

    expect(pediChip).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByText(/Pick at least one service\./i)).toBeNull();
    expect(screen.getByRole("button", { name: /Add discount/i })).toBeEnabled();
  });

  it("Save with scope=selected sends targetLineIds as a string array of picked ids (insertion order)", async () => {
    const user = userEvent.setup();
    const onSave: OnSaveMock = vi
      .fn<(payload: DiscountSheetOnSavePayload) => Promise<void>>()
      .mockResolvedValue(undefined);
    renderSheet({ onSave });

    await user.type(screen.getByLabelText(/Amount/i), "5");
    await user.click(screen.getByRole("radio", { name: /Selected services/i }));

    // Pick Pedicure FIRST, then Manicure — verify the saved order matches
    // serviceLines insertion order (Manicure then Pedicure), not click order.
    await user.click(screen.getByRole("checkbox", { name: /Pedicure/i }));
    await user.click(screen.getByRole("checkbox", { name: /Manicure/i }));

    await user.click(screen.getByRole("button", { name: /Add discount/i }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const payload = onSave.mock.calls[0][0];
    expect(payload.targetLineIds).toEqual([
      // Manicure is first in serviceLines, so it appears first in the
      // saved array regardless of click order.
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
    ]);
    expect(payload.shape).toBe("flat");
    expect(payload.value).toBe(500);
  });

  it("Save with scope=all (default) sends targetLineIds: null", async () => {
    const user = userEvent.setup();
    const onSave: OnSaveMock = vi
      .fn<(payload: DiscountSheetOnSavePayload) => Promise<void>>()
      .mockResolvedValue(undefined);
    renderSheet({ onSave });

    await user.type(screen.getByLabelText(/Amount/i), "5");
    // Do NOT touch the scope radio.
    await user.click(screen.getByRole("button", { name: /Add discount/i }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const payload = onSave.mock.calls[0][0];
    expect(payload.targetLineIds).toBeNull();
  });
});

describe("<DiscountSheet /> — chip ergonomics (within scope picker)", () => {
  it("chip labels show the service name + price with tabular-nums for the dollar amount", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByRole("radio", { name: /Selected services/i }));

    const maniChip = screen.getByRole("checkbox", { name: /Manicure/i });
    expect(maniChip).toHaveTextContent(/Manicure/);
    expect(maniChip).toHaveTextContent(/\$40\.00/);
    expect(maniChip).toHaveStyle({ fontVariantNumeric: "tabular-nums" });
  });
});
