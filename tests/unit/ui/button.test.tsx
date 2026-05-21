import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { Button } from "@/components/ui/button";

afterEach(() => {
  cleanup();
});

describe("<Button loading>", () => {
  it("renders no spinner when not loading", () => {
    const { container } = render(<Button>Save</Button>);
    expect(container.querySelector(".lq-spinner")).toBeNull();
    expect(screen.getByRole("button")).not.toBeDisabled();
  });

  it("renders a spinner, disables, and marks aria-busy when loading", () => {
    const { container } = render(<Button loading>Save</Button>);
    expect(container.querySelector(".lq-spinner")).not.toBeNull();
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(btn).toHaveAttribute("data-loading", "true");
  });

  it("keeps its children visible while loading (caller swaps the label)", () => {
    render(<Button loading>Saving…</Button>);
    expect(screen.getByRole("button")).toHaveTextContent("Saving…");
  });

  it("stays disabled when disabled is passed without loading", () => {
    render(<Button disabled>Save</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
