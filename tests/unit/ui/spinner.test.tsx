import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { Spinner } from "@/components/ui/spinner";

afterEach(() => {
  cleanup();
});

describe("<Spinner />", () => {
  it("renders an svg with the lq-spinner animation class", () => {
    const { container } = render(<Spinner />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveClass("lq-spinner");
  });

  it("defaults to a 16px icon and is hidden from assistive tech", () => {
    const { container } = render(<Spinner />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("width", "16");
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });

  it("renders at the requested size", () => {
    const { container } = render(<Spinner size={24} />);
    expect(container.querySelector("svg")).toHaveAttribute("width", "24");
  });

  it("merges an extra className", () => {
    const { container } = render(<Spinner className="extra" />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveClass("lq-spinner");
    expect(svg).toHaveClass("extra");
  });
});
