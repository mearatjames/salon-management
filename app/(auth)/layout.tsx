// `(auth)` route-group layout. Wraps only `/login` and `/reset-password`
// in the two-panel Lacquer shell introduced by 010-login-redesign
// (FR-001, FR-002).
//
// `/select-staff` is NO LONGER in this route group — the
// 044-select-staff-redesign feature moved it to the `(device)` route
// group, which has its own full-bleed avatar-grid layout. The `(auth)`
// shell now serves the sign-in / password-reset surfaces exclusively.
//
// The `<AuthShell>` component is responsible for the grid + both panels;
// `children` flow into the form-panel form well. The
// `import "@/styles/auth.css"` side-effect is preserved so the
// `/login` and `/reset-password` form styles continue to ship alongside
// the shell.

import "@/styles/auth.css";

import type { ReactNode } from "react";

import { AuthShell } from "@/components/lacquer/auth-shell";

export default function AuthLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <AuthShell>{children}</AuthShell>;
}
