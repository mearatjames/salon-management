// Studio left navigation panel — Server Component.
//
// Owns the inner children of the `<aside className="studio-sidebar">` that
// `app/(studio)/layout.tsx` renders. Returns a fragment (no `<aside>`) so the
// layout keeps the landmark + `aria-label` it already wires.
//
// US2 scope: active highlight is wired via the `SidebarShell` client island
// (`sidebar-shell.client.tsx`), which owns `usePathname()` and applies
// `data-active` / `aria-current` per the DOM contract.
//
// US4 scope: the footer slot now renders `<SidebarFooter>` with the same
// `staff` + `degraded` props the layout already passes to the topbar
// `OperatorChip` (research.md § R8 — degraded-session handling).
//
// Visual rules live in `styles/studio.css` under the `.studio-*` classes.

import { SidebarFooter } from "./sidebar-footer";
import { SidebarShell } from "./sidebar-shell.client";

export type StudioSidebarProps = {
  staff: {
    display_name: string;
    role: string;
    color_token: string;
  };
  degraded: boolean;
};

export function StudioSidebar({ staff, degraded }: StudioSidebarProps) {
  return (
    <SidebarShell role={staff.role}>
      <SidebarFooter staff={staff} degraded={degraded} />
    </SidebarShell>
  );
}
