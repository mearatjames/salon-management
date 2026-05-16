// PageHeader — the title row for the Settings → Staff page. Server
// Component, just static layout. Per execution rule #6 (the simpler
// alternative chosen in tasks.md): the Show-inactive Switch and the Add
// staff button live inside the client table island (which already owns the
// state), so this header only renders the static "Staff" title + an
// optional `children` slot the page can use to drop the interactive
// controls in-flow on the right.
//
// All visuals trace to Lacquer tokens.

import type { ReactNode } from "react";

export type PageHeaderProps = {
  /** Optional right-side slot for interactive controls rendered by the client island. */
  children?: ReactNode;
};

export function PageHeader({ children }: PageHeaderProps) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--space-4)",
        flexWrap: "wrap",
      }}
    >
      <div>
        <h2
          style={{
            margin: 0,
            fontSize: "var(--text-2xl)",
            lineHeight: "var(--leading-tight)",
            letterSpacing: "var(--tracking-snug)",
            color: "var(--foreground)",
            fontWeight: 600,
          }}
        >
          Staff
        </h2>
        <p
          style={{
            margin: 0,
            marginTop: "var(--space-1)",
            fontSize: "var(--text-sm)",
            color: "var(--muted-foreground)",
          }}
        >
          Manage who can log in to the studio and what they can do.
        </p>
      </div>
      {children ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
          }}
        >
          {children}
        </div>
      ) : null}
    </header>
  );
}
