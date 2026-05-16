// Lacquer badge — single rounded pill for role / status / count display.
// Every visual value resolves to a `var(--*)` token. Tabular numerals are
// always on so numeric badges line up across rows. Server Component.

import type { CSSProperties, ReactNode } from "react";

export type BadgeVariant = "default" | "success" | "warning" | "destructive" | "muted";

export type BadgeProps = {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  title?: string;
  "aria-label"?: string;
};

const VARIANT_STYLES: Record<BadgeVariant, CSSProperties> = {
  default: {
    background: "oklch(from var(--primary) l c h / 0.12)",
    color: "var(--primary)",
  },
  success: {
    background: "oklch(from var(--success) l c h / 0.15)",
    color: "var(--success)",
  },
  warning: {
    background: "oklch(from var(--warning, var(--accent)) l c h / 0.15)",
    color: "var(--warning, var(--accent-foreground))",
  },
  destructive: {
    background: "oklch(from var(--destructive) l c h / 0.15)",
    color: "var(--destructive)",
  },
  muted: {
    background: "oklch(from var(--muted-foreground) l c h / 0.15)",
    color: "var(--muted-foreground)",
  },
};

export function Badge({
  variant = "default",
  children,
  className,
  style,
  title,
  "aria-label": ariaLabel,
}: BadgeProps) {
  return (
    <span
      className={className}
      title={title}
      aria-label={ariaLabel}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-1)",
        padding: "var(--space-1) var(--space-2)",
        borderRadius: "var(--radius-full)",
        fontSize: "var(--text-xs, 12px)",
        fontWeight: 500,
        lineHeight: 1,
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
        ...VARIANT_STYLES[variant],
        ...style,
      }}
    >
      {children}
    </span>
  );
}
