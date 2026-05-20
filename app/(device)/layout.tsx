// `(device)` route-group layout. Wraps `/select-staff` (the per-device
// staff sign-in surface) in a full-bleed, full-viewport shell — no brand
// panel, no `<AuthShell>`.
//
// Why `/select-staff` leaves the `(auth)` route group (spec Assumptions,
// FR-003): the `(auth)` shell renders sign-in surfaces inside a narrow
// 480px form panel. That works for the `/login` and `/reset-password`
// forms, but it is the root cause of the select-staff scrolling problem —
// the avatar roster + keypad cannot breathe in a narrow column and the
// screen scrolls awkwardly on the shared iPad. A Next.js route group lets
// us attach a *different* layout to a subset of routes without changing
// the URL: `/select-staff` keeps its path but now renders against this
// full-bleed wrapper instead of the `(auth)` two-panel shell.
//
// The `import "@/styles/select-staff.css"` side-effect ships the screen's
// stylesheet (token-only rules — Constitution Principle I) alongside the
// layout. `children` render directly inside a minimal full-viewport
// wrapper.

import "@/styles/select-staff.css";

import type { ReactNode } from "react";

export default function DeviceLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="select-staff-root">{children}</div>;
}
