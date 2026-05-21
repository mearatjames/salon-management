// Spinner — the canonical Lacquer loading spinner.
//
// Lucide Loader2 (the arc icon) spun by the `lq-spin` keyframe (1.2s
// linear). Canonical reference: design-system/preview/loading.html.
// Sizes mirror Lucide's icon scale (16 / 20 / 24); stroke is heavier at
// 16 so the thin arc stays visible. `aria-hidden` — the SURROUNDING
// container owns any accessible status text (role="status" / a label).

import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import "@/styles/loading.css";

const STROKE_FOR_SIZE: Record<16 | 20 | 24, number> = {
  16: 1.8,
  20: 1.5,
  24: 1.5,
};

export type SpinnerProps = {
  /** Icon size in px — matches Lucide's 16 / 20 / 24 scale. */
  size?: 16 | 20 | 24;
  /** Override the size-derived stroke width (e.g. 2 inside a button). */
  strokeWidth?: number;
  className?: string;
};

export function Spinner({ size = 16, strokeWidth, className }: SpinnerProps) {
  return (
    <Loader2
      size={size}
      strokeWidth={strokeWidth ?? STROKE_FOR_SIZE[size]}
      aria-hidden="true"
      className={cn("lq-spinner", className)}
    />
  );
}
