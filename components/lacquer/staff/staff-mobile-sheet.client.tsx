"use client";

// StaffMobileSheet — the bottom-sheet wrapper around <EditPanel> for the
// mobile breakpoint (research § R5/R6 — Phase 10 / US8).
//
// Owns its own `open` state derived from `useSearchParams().get('selected')`
// because the parent page is a Server Component and can't hand a function
// down. On close we `router.push('/settings/staff')` to clear `?selected=`,
// which lets the Server Component re-render with `selectedTarget = null`
// and tear down both this sheet AND the (CSS-hidden) desktop aside in
// lock-step.
//
// Double-mount note: this client island AND the desktop `<EditPanel>` aside
// both render with identical props when `?selected=` is set. At <900px the
// CSS hides the desktop aside; at ≥900px the CSS hides this sheet. Both
// `<EditPanel>` instances mount and own independent local draft state — but
// only one is visible / reachable at a time, so a draft entered in one is
// silently discarded when the viewport flips. That matches the existing
// row-switch behaviour (`key={target.id}` on the desktop panel — drafts are
// discarded silently per FR-022) so it's an acceptable trade-off vs. a
// hydration-unsafe media-query gate.
//
// Body scroll lock comes free from Radix Dialog (research § R6 — the
// underlying `<Sheet>` primitive sets `document.body.style.overflow = 'hidden'`
// while open and removes it on close).

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { EditPanel, type EditPanelProps } from "@/components/lacquer/staff/edit-panel.client";

// Mobile breakpoint mirrors `styles/settings.css` (research § R5 — 899px).
// Kept in sync with the CSS so the sheet's `open` state and the visibility
// rules agree exactly.
const MOBILE_MAX_WIDTH_PX = 899;

export type StaffMobileSheetProps = EditPanelProps;

export function StaffMobileSheet(props: StaffMobileSheetProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Gate the sheet by an explicit `<900px` viewport check. We CAN'T pass this
  // through CSS alone because Radix's <Sheet open=true> renders its content
  // into a portal — and the portaled <EditPanel> would coexist with the
  // desktop aside's <EditPanel>, producing two DOM nodes for every
  // `data-section="*"` selector and breaking the e2e specs that use them
  // (strict-mode violations).
  //
  // SSR-safe pattern: start `isMobile=false` (matches what Next.js renders
  // server-side), then upgrade on mount in a useEffect when the actual
  // viewport width is known. The hydration mismatch is avoided because the
  // initial client render also returns `false` before the effect runs.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH_PX}px)`);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Open when the URL has `?selected=` AND the viewport is mobile-width.
  // The parent only renders this island when a target is resolved server-side,
  // so prop-presence implies the selected-param is set. Reading the param
  // here keeps the close gesture (router.push) symmetric with the desktop
  // aside's behaviour.
  const open = isMobile && searchParams.get("selected") !== null;

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) return; // opening is driven by row clicks → router navigation, not by us
      // Drop the consumed param. Preserve other query state (toast/error/name)
      // so the toaster bridge still fires when present.
      const params = new URLSearchParams(searchParams.toString());
      params.delete("selected");
      const query = params.toString();
      router.push(query ? `/settings/staff?${query}` : "/settings/staff");
    },
    [router, searchParams]
  );

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="bottom"
        className="staff-mobile-sheet"
        data-component="staff-mobile-sheet"
      >
        {/* Drag-handle affordance at the top of the sheet. Purely
            decorative — Radix already owns the drag/dismiss gestures. */}
        <span className="staff-mobile-sheet-handle" aria-hidden="true" />
        <SheetHeader className="sr-only">
          <SheetTitle>Edit staff member</SheetTitle>
          <SheetDescription>
            Adjust this staff member&apos;s details, access, and pay deductions.
          </SheetDescription>
        </SheetHeader>
        {/* Re-key on target.id so the panel resets between row switches —
            same FR-022 silent-discard behaviour as the desktop aside. */}
        <EditPanel key={props.target.id} {...props} />
      </SheetContent>
    </Sheet>
  );
}
