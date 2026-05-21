import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { SubmitButton } from "@/components/lacquer/submit-button";

afterEach(() => {
  cleanup();
});

// useFormStatus() reports pending=false outside a submitting form, so the
// unit test covers the idle contract; the pending visual is exercised by
// the Task 18 e2e additions.
describe("<SubmitButton />", () => {
  it("renders a type=submit button with the idle children", () => {
    render(
      <form>
        <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
      </form>
    );
    const btn = screen.getByRole("button", { name: "Save changes" });
    expect(btn).toHaveAttribute("type", "submit");
    expect(btn).not.toBeDisabled();
  });

  it("forwards className and data-slot to the button", () => {
    render(
      <form>
        <SubmitButton pendingLabel="Saving…" className="auth-btn" data-slot="x">
          Save
        </SubmitButton>
      </form>
    );
    const btn = screen.getByRole("button");
    expect(btn).toHaveClass("auth-btn");
    expect(btn).toHaveAttribute("data-slot", "x");
  });

  it("renders no spinner while idle", () => {
    const { container } = render(
      <form>
        <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
      </form>
    );
    expect(container.querySelector(".lq-spinner")).toBeNull();
  });
});
