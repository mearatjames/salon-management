// Component test for <TechAvatarRow /> — the checkout tech-assignment
// picker adapted from `design-system/prototypes/transaction/FlowSingle.jsx`
// (and its `TechPicker.jsx` source).
//
// Issue #85 §3: the pre-pick picker must label each avatar with the
// tech's first name, matching the prototype (`TechPicker.jsx:80-92` —
// `<span className="nm">{t.full.split(" ")[0]}</span>`). Before this
// change the picker rendered only the initials swatch with no name.
//
// The post-pick collapsed chip already shows the full name; a regression
// test pins that so the picker change does not disturb it.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { TechAvatarRow } from "@/components/lacquer/checkout/tech-avatar-row";

const STAFF = [
  { id: "s1", display_name: "Jordan Lee", color_token: "--staff-color-1" },
  { id: "s2", display_name: "Sam Chen", color_token: "--staff-color-2" },
  { id: "s3", display_name: "Maya Patel", color_token: "--staff-color-3" },
];

afterEach(() => {
  cleanup();
});

describe("<TechAvatarRow /> — pre-pick picker (issue #85 §3)", () => {
  it("labels each avatar with the tech's first name", () => {
    render(
      <TechAvatarRow staff={STAFF} selectedStaffId={null} onPick={() => {}} onClear={() => {}} />
    );

    expect(screen.getByText("Jordan")).toBeInTheDocument();
    expect(screen.getByText("Sam")).toBeInTheDocument();
    expect(screen.getByText("Maya")).toBeInTheDocument();
  });

  it("keeps the initials avatar swatch alongside each name label", () => {
    render(
      <TechAvatarRow staff={STAFF} selectedStaffId={null} onPick={() => {}} onClear={() => {}} />
    );

    expect(screen.getByText("JL")).toBeInTheDocument();
    expect(screen.getByText("SC")).toBeInTheDocument();
    expect(screen.getByText("MP")).toBeInTheDocument();
  });

  it("keeps each tech a button carrying its data-staff-name (e2e selector)", () => {
    render(
      <TechAvatarRow staff={STAFF} selectedStaffId={null} onPick={() => {}} onClear={() => {}} />
    );

    for (const s of STAFF) {
      const button = screen.getByRole("button", {
        name: `Assign ${s.display_name} as the tech for this sale`,
      });
      expect(button).toHaveAttribute("data-staff-name", s.display_name);
    }
  });
});

describe("<TechAvatarRow /> — post-pick chip (regression)", () => {
  it("shows the full name of the selected tech", () => {
    render(
      <TechAvatarRow staff={STAFF} selectedStaffId="s1" onPick={() => {}} onClear={() => {}} />
    );

    expect(screen.getByText("Jordan Lee")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument();
  });
});
