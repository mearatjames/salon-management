"use client";

// OwnerOnlyTooltip — shared role-gate tooltip wrapper.
//
// 021-services-deductions / Phase 7 (US5): the deductions controls
// (segmented card-fee control, supply toggle, amount/label inputs) and the
// existing 008 form fields all surface the same "Only owners and managers
// can edit the catalog." tooltip when the operator's role lacks write
// access. 008 has a similar gate on the "Add service" button in
// `catalog-list.client.tsx` — we hoist the pattern here so every
// disabled-control wrap uses the same copy + delay + slot semantics.
//
// Implementation notes:
// - The shadcn `<Tooltip>` from radix only fires on a focusable trigger
//   that actually receives pointer/focus events. Native `<input disabled>`
//   and Radix `<Switch disabled>` swallow pointer events, so we wrap the
//   children in an inline-block `<span>` and put the radix trigger there.
//   The span fires the pointer-over event the radix tooltip listens for.
// - When `disabled` is false this component is transparent — it just
//   renders the children with no DOM noise.
// - `delayDuration` = 100ms to match the existing 008 catalog-list usage
//   ("Add service" button tooltip).
// - The tooltip copy is fixed (FR-029, matches 008 vocabulary). If the
//   copy ever changes, update both this file and `toasts.ts`'s `forbidden`
//   entry so the toast vocabulary stays in sync.

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export const OWNER_ONLY_TOOLTIP_COPY = "Only owners and managers can edit the catalog.";

export type OwnerOnlyTooltipProps = {
  /** When false the children render bare (no tooltip, no wrapping span). */
  disabled: boolean;
  /** The visually-but-not-functionally interactive control. */
  children: React.ReactNode;
  /** Optional override for the wrapper span's display mode (default inline-block). */
  displayMode?: "inline-block" | "block";
};

export function OwnerOnlyTooltip({
  disabled,
  children,
  displayMode = "inline-block",
}: OwnerOnlyTooltipProps) {
  if (!disabled) {
    // Transparent when the gate isn't active — keeps the DOM identical to
    // the pre-021 form layout for owners/managers.
    return <>{children}</>;
  }
  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            data-slot="services-owner-only-tooltip-trigger"
            style={{
              display: displayMode,
              // Inherit width from the wrapped control so the tooltip
              // anchor sits where the operator visually expects it.
              width: displayMode === "block" ? "100%" : undefined,
            }}
          >
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" data-slot="services-owner-only-tooltip-content">
          {OWNER_ONLY_TOOLTIP_COPY}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
