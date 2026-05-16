// Vitest unit coverage for the pure helpers in
// `components/lacquer/staff/initials.ts`. Both helpers are shared by the
// topbar `OperatorChip` and the sidebar footer, so a regression here would
// flip the avatar label or role copy across the whole studio chrome.

import { describe, expect, it } from "vitest";

import { initials, roleLabel } from "@/components/lacquer/staff/initials";

describe("initials()", () => {
  it("single-word name → first two letters uppercased", () => {
    expect(initials("alex")).toBe("AL");
    expect(initials("Sam")).toBe("SA");
  });

  it("two-word name → first letter of first + first letter of last, uppercased", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
    expect(initials("jane doe")).toBe("JD");
  });

  it("multi-word name → first + last initial, uppercased", () => {
    expect(initials("Mary Anne Smith")).toBe("MS");
    expect(initials("john michael robert kennedy")).toBe("JK");
  });

  it("empty or whitespace-only name → '?'", () => {
    expect(initials("")).toBe("?");
    expect(initials("   ")).toBe("?");
  });
});

describe("roleLabel()", () => {
  it("maps the four known roles", () => {
    expect(roleLabel("owner")).toBe("Owner");
    expect(roleLabel("manager")).toBe("Manager");
    expect(roleLabel("technician")).toBe("Tech");
    expect(roleLabel("front_desk")).toBe("Front desk");
  });

  it("passes unknown roles through verbatim", () => {
    expect(roleLabel("intern")).toBe("intern");
    expect(roleLabel("")).toBe("");
  });
});
