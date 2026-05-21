// Skeleton — a single shimmer placeholder block.
//
// The shimmer animation lives in `styles/loading.css` (`.lq-skeleton`);
// this component is just the sized box. Compose many of them inside a
// route `loading.tsx` to mirror that page's chrome so real content
// arrives with zero layout shift. Canonical reference:
// design-system/preview/loading.html.
//
// `aria-hidden` — a skeleton conveys nothing to assistive tech; the
// route transition itself is the signal.

import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";
import "@/styles/loading.css";

export type SkeletonProps = {
  width?: number | string;
  height?: number | string;
  /** Border radius — a token reference. Defaults to --radius-xs. */
  radius?: string;
  className?: string;
  style?: CSSProperties;
};

export function Skeleton({
  width,
  height,
  radius = "var(--radius-xs)",
  className,
  style,
}: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn("lq-skeleton", className)}
      style={{ width, height, borderRadius: radius, ...style }}
    />
  );
}
