import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { useFormStatus } from "react-dom";

import { SubmitButton } from "@/components/lacquer/submit-button";

// useFormStatus() only reports pending=true mid-submission, which a unit
// render can't reach — so mock it to drive both the idle and pending branches.
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom")>();
  return { ...actual, useFormStatus: vi.fn() };
});

const idleStatus = { pending: false, data: null, method: null, action: null } as const;
const pendingStatus = {
  pending: true,
  data: new FormData(),
  method: "post",
  action: "/",
} as const;

beforeEach(() => {
  vi.mocked(useFormStatus).mockReturnValue(idleStatus);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

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

  it("keeps the spinner and pending label on one line while submitting", () => {
    vi.mocked(useFormStatus).mockReturnValue(pendingStatus);
    const { container } = render(
      <form>
        <SubmitButton pendingLabel="Deactivating…">Deactivate</SubmitButton>
      </form>
    );
    const spinner = container.querySelector(".lq-spinner");
    expect(spinner).not.toBeNull();
    // The block-level .lq-spinner and the label must share a single
    // inline-flex parent, otherwise the button wraps to two lines (#124).
    const wrapper = spinner!.parentElement!;
    expect(wrapper.tagName).toBe("SPAN");
    expect(wrapper).toHaveStyle({ display: "inline-flex" });
    expect(wrapper).toHaveTextContent("Deactivating…");
  });
});
