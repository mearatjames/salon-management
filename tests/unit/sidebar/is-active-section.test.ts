import { describe, expect, it } from "vitest";

import { isActiveSection } from "@/components/lacquer/sidebar/is-active-section";

describe("isActiveSection", () => {
  it("returns true when pathname exactly matches href", () => {
    expect(isActiveSection("/calendar", "/calendar")).toBe(true);
  });

  it("returns true when pathname is nested under href", () => {
    expect(isActiveSection("/settings/staff", "/settings")).toBe(true);
  });

  it("returns true for exact match with no trailing slash", () => {
    expect(isActiveSection("/settings", "/settings")).toBe(true);
  });

  it("normalizes trailing slashes on pathname before comparing", () => {
    expect(isActiveSection("/settings/", "/settings")).toBe(true);
  });

  it("returns false for unrelated routes", () => {
    expect(isActiveSection("/dashboard", "/calendar")).toBe(false);
  });

  it("avoids prefix collisions (does not match similarly-named siblings)", () => {
    expect(isActiveSection("/calendar-archive", "/calendar")).toBe(false);
  });

  it("does not treat root '/' as a match for /dashboard", () => {
    expect(isActiveSection("/", "/dashboard")).toBe(false);
  });

  it("returns false when href is null (disabled items are never active)", () => {
    expect(isActiveSection("/calendar", null)).toBe(false);
    expect(isActiveSection("/anything/at/all", null)).toBe(false);
    expect(isActiveSection("/", null)).toBe(false);
  });

  it("returns false when pathname is empty", () => {
    expect(isActiveSection("", "/calendar")).toBe(false);
  });
});
