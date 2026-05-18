"use client";

// EditPolicySheet — the right-side sheet container that hosts the policy
// editing surfaces (currently only the supply-types catalog section, more
// to come in later features).
//
// Composition: shadcn `<Sheet>` with `side="right"` and width
// `min(440px, 100vw - 16px)`. Header: title "Edit policy", a multi-line
// subtitle, and the default close (X) button (provided by shadcn
// `SheetContent`). Body: scrollable; mounts `<SupplyTypesSection>` only
// for this phase. Animation: 220ms enter / 180ms exit, ease-out-expo
// (applied via the .edit-policy-sheet CSS rules — the shadcn primitive's
// default transition is short-circuited by our class override). Esc + scrim
// close are shadcn `Sheet` defaults.
//
// The sheet is fully controlled from `<EditPolicyButton>` via the
// `open` + `onOpenChange` props. The button's client island manages the
// `?policy=open` URL bridge so the sheet survives Server Action redirects
// (e.g. a successful rename redirects to
// `/services?policy=open&toast=supply_type_renamed`, which auto-reopens
// the sheet on page render).
//
// Contracts:
//   - specs/022-supply-types-catalog/contracts/ui.contract.md § 2

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SupplyTypesSection } from "@/components/lacquer/services/supply-types-section.client";
import type { SupplyTypesCatalog } from "@/app/(studio)/settings/policy/_load";

const SHEET_TITLE = "Edit policy";
// Multi-line subtitle per ui.contract.md § 2 — describes the policy scope.
// Plain string (no markdown) — the bold treatment in the contract is
// stylistic guidance; we honor it via inline <strong> on the staff link.
const SHEET_SUBTITLE_PREFIX =
  "Card-fee defaults and the supply-deduction catalog that apply across your whole menu. Per-service settings can still override these. Per-tech exemptions live in ";
const SHEET_SUBTITLE_STAFF = "Staff Settings";
const SHEET_SUBTITLE_SUFFIX = ".";

export type EditPolicySheetProps = {
  /** Controlled open state — owned by `<EditPolicyButton>` upstream. */
  open: boolean;
  /** Fires on Esc, scrim click, or close button. */
  onOpenChange: (next: boolean) => void;
  /** Catalog read result from `loadSupplyTypesCatalog()` on the page. */
  catalog: SupplyTypesCatalog;
};

export function EditPolicySheet({ open, onOpenChange, catalog }: EditPolicySheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        // Width override per the contract: clamp to 440px on wider screens,
        // give a 16px breathing margin on narrow ones. The shadcn default
        // `data-[side=right]:w-3/4 sm:max-w-sm` would otherwise cap at the
        // tailwind `sm` breakpoint; we replace that with the contract's
        // explicit `min(440px, 100vw - 16px)` via the class below.
        className="edit-policy-sheet__content"
        data-slot="edit-policy-sheet"
      >
        <SheetHeader className="edit-policy-sheet__header">
          <SheetTitle className="edit-policy-sheet__title">{SHEET_TITLE}</SheetTitle>
          <SheetDescription className="edit-policy-sheet__subtitle">
            {SHEET_SUBTITLE_PREFIX}
            <strong>{SHEET_SUBTITLE_STAFF}</strong>
            {SHEET_SUBTITLE_SUFFIX}
          </SheetDescription>
        </SheetHeader>
        <div className="edit-policy-sheet__body" data-slot="edit-policy-sheet-body">
          <SupplyTypesSection catalog={catalog} onCloseSheet={() => onOpenChange(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
