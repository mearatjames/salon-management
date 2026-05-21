import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { Skeleton } from "@/components/ui/skeleton";

afterEach(() => {
  cleanup();
});

describe("<Skeleton />", () => {
  it("renders a shimmer block hidden from assistive tech", () => {
    const { container } = render(<Skeleton width={120} height={12} />);
    const el = container.firstElementChild as HTMLElement;
    expect(el).toHaveClass("lq-skeleton");
    expect(el).toHaveAttribute("aria-hidden", "true");
  });

  it("applies width, height and the default radius", () => {
    const { container } = render(<Skeleton width={120} height={12} />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.width).toBe("120px");
    expect(el.style.height).toBe("12px");
    expect(el.style.borderRadius).toBe("var(--radius-xs)");
  });

  it("honours a custom radius and merged style", () => {
    const { container } = render(
      <Skeleton width={40} height={40} radius="var(--radius-full)" style={{ marginTop: 8 }} />
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.borderRadius).toBe("var(--radius-full)");
    expect(el.style.marginTop).toBe("8px");
  });
});
