// Component test for the destructive ConfirmDialog used by the staff
// edit-panel danger zone.
//
// Replaces e2e case `staff.spec.ts US5(c)` (cancel inside the deactivate
// dialog closes it with no mutation) per docs/e2e-pruning-audit.md. The
// dialog has no internal state — the parent owns `open`, and Cancel just
// calls `onOpenChange(false)`. Asserting that contract here is enough; the
// "no mutation" half of the e2e was driven entirely by the parent not
// submitting the destructive form, which is implicit in this test (we
// never click the form's submit button).

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ConfirmDialog } from "@/components/lacquer/staff/confirm-dialog";

afterEach(() => {
  cleanup();
});

describe("<ConfirmDialog /> — US5(c) cancel state", () => {
  it("renders the deactivate variant with the documented title and body", () => {
    render(
      <ConfirmDialog open variant="deactivate" name="Sam Chen" onOpenChange={() => {}}>
        <form>
          <button type="submit">Deactivate</button>
        </form>
      </ConfirmDialog>
    );

    expect(screen.getByText("Deactivate Sam Chen?")).toBeInTheDocument();
    expect(
      screen.getByText(/won't be able to log in until you reactivate them/)
    ).toBeInTheDocument();
    // Per Clarifications Q2 there is NO "X appointments scheduled" line.
    expect(screen.queryByText(/\d+ appointment/i)).toBeNull();
    expect(screen.queryByText(/scheduled/i)).toBeNull();
  });

  it("renders the remove variant with the documented title and body", () => {
    render(
      <ConfirmDialog open variant="remove" name="Sam Chen" onOpenChange={() => {}}>
        <form>
          <button type="submit">Remove</button>
        </form>
      </ConfirmDialog>
    );

    expect(screen.getByText("Remove Sam Chen?")).toBeInTheDocument();
    expect(screen.getByText(/removed from the staff roster/)).toBeInTheDocument();
  });

  it("clicking Cancel calls onOpenChange(false) — closes without mutation", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    render(
      <ConfirmDialog open variant="deactivate" name="Sam Chen" onOpenChange={onOpenChange}>
        {/* The destructive form is rendered but the test never submits it,
            mirroring the user pressing Cancel instead of the destructive CTA. */}
        <form>
          <button type="submit" data-slot="confirm-dialog-submit">
            Deactivate
          </button>
        </form>
      </ConfirmDialog>
    );

    const cancel = screen.getByRole("button", { name: /^cancel$/i });
    await user.click(cancel);

    // Closing the dialog is the only side effect of Cancel — the destructive
    // form is left unsubmitted, so no Server Action fires.
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("prefers the onCancel prop when provided (escape hatch for parent-driven flows)", async () => {
    const onCancel = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    render(
      <ConfirmDialog
        open
        variant="remove"
        name="Sam Chen"
        onOpenChange={onOpenChange}
        onCancel={onCancel}
      >
        <form>
          <button type="submit">Remove</button>
        </form>
      </ConfirmDialog>
    );

    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    // When onCancel is provided the wrapper hands control to the parent and
    // does NOT also call onOpenChange — the parent decides whether to close.
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
