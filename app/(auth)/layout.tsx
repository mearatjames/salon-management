// `(auth)` route-group layout. Wraps `/login`, `/reset-password`, and
// `/select-staff` in the two-panel Lacquer shell introduced by
// 010-login-redesign (FR-001, FR-002).
//
// The `/select-staff` keypad surface inherits this same shell as a
// deliberate styling consequence (FR-026): the keypad DOM, selectors,
// copy, and logic are unchanged — only the surrounding chrome (the brand
// panel) is shared with the sign-in surface for design cohesion across
// the `(auth)` route group.
//
// The `<AuthShell>` component is responsible for the grid + both panels;
// `children` flow into the form-panel form well. The
// `import "@/styles/auth.css"` side-effect is preserved so the keypad +
// roster styles continue to ship alongside the shell.

import "@/styles/auth.css";

import type { ReactNode } from "react";

import { AuthShell } from "@/components/lacquer/auth-shell";

export default function AuthLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <AuthShell>{children}</AuthShell>;
}
