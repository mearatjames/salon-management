// AuthShell — server component. Renders the two-panel auth surface
// introduced by 010-login-redesign (FR-001, FR-002): a 1fr brand panel on
// the left and a 480px form panel on the right. Below the 720px breakpoint
// the brand panel collapses (CSS-driven, no JS check) and the form panel
// fills the viewport — the solo wordmark inside `AuthFormPanel` then
// renders above the form well.
//
// Every value the rendered DOM relies on lives in `styles/auth.css`
// (`.auth-shell`, `.auth-brand-panel`, `.auth-form-panel`, `.auth-form-well`,
// `.auth-solo-mark`). No inline styles; no client JS.
//
// Composition contract: `<AuthShell>` always renders `<AuthBrandPanel>`
// followed by `<AuthFormPanel>{children}</AuthFormPanel>`. The
// `showBrandPanel` prop is reserved for a future surface (e.g.
// `/reset-password` if it wants the centered variant) but defaults to
// `true` for v1.

import type { ReactNode } from "react";

import { AuthBrandPanel } from "@/components/lacquer/auth-brand-panel";
import { AuthFormPanel } from "@/components/lacquer/auth-form-panel";

export type AuthShellProps = {
  children: ReactNode;
  showBrandPanel?: boolean;
};

export function AuthShell({ children, showBrandPanel = true }: AuthShellProps) {
  return (
    <main className={`auth-shell${showBrandPanel ? "" : " auth-shell-centered"}`}>
      {showBrandPanel && <AuthBrandPanel />}
      <AuthFormPanel>{children}</AuthFormPanel>
    </main>
  );
}
