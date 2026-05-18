"use client";

// EditPolicyButton (client island) — manages the open state for the
// `<EditPolicySheet>` AND the `?policy=open` URL bridge so Server Action
// redirects can land the operator back inside a still-open sheet.
//
// URL bridge:
//   - On mount (and on any `searchParams` change), if `?policy=open` is
//     present, set the local open state to true.
//   - On close (Esc, scrim click, or close X), call `router.replace` to
//     strip the `?policy=open` param so a subsequent page reload doesn't
//     re-open the sheet.
//
// This mirrors the 008 `?selected=<id>` URL-state pattern in
// `catalog-list.client.tsx` (a Link-based href that the page reads server
// side, swapped here for a client-side replace because the Sheet itself
// doesn't navigate — it's a portal child of the page).
//
// The actual sheet content is rendered separately at the page level
// (the page already loads `loadSupplyTypesCatalog()` so the sheet can be
// hydrated from props without a second fetch). This client island only
// holds the trigger button + the controlled `open` state.
//
// Contracts:
//   - specs/022-supply-types-catalog/contracts/ui.contract.md § 1

import { Sliders } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { OwnerOnlyTooltip } from "@/components/lacquer/services/owner-only-tooltip";
import { EditPolicySheet } from "@/components/lacquer/services/edit-policy-sheet.client";
import type { SupplyTypesCatalog } from "@/app/(studio)/settings/policy/_load";

const BUTTON_LABEL = "Edit policy";

export type EditPolicyButtonClientProps = {
  /** When true, the button is rendered as `aria-disabled` and wrapped with the OwnerOnlyTooltip. */
  disabled: boolean;
  /** Supply-types catalog from `loadSupplyTypesCatalog()` (passed through to the sheet). */
  catalog: SupplyTypesCatalog;
};

export function EditPolicyButtonClient({ disabled, catalog }: EditPolicyButtonClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);

  // URL bridge: when `?policy=open` is present, open the sheet. Used by the
  // catalog Server Actions to return the operator to a still-open sheet
  // after a mutation. We sync once per change in the search-string so
  // toggling via the button doesn't fight a stale URL state.
  const lastPolicyParam = useRef<string | null>(null);
  useEffect(() => {
    const policy = searchParams.get("policy");
    if (policy === lastPolicyParam.current) return;
    lastPolicyParam.current = policy;
    if (policy === "open") {
      // URL → local-state sync. The ref guard above makes this run exactly
      // once per change in the bridge param, so the cascading-render concern
      // the react-hooks rule targets does not apply.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(true);
    }
  }, [searchParams]);

  // On close, strip `?policy=open` from the URL so a reload of the
  // resulting bare /services URL doesn't re-open the sheet. Preserve any
  // other query params (e.g. `?selected=…` from a service edit panel).
  const stripPolicyParam = useCallback(() => {
    const policy = searchParams.get("policy");
    if (policy !== "open") return;
    const next = new URLSearchParams(searchParams.toString());
    next.delete("policy");
    const query = next.toString();
    const target = query ? `${pathname}?${query}` : pathname;
    // `router.replace` (not `window.history.replaceState`) here because we
    // WANT a soft RSC re-render — the page's `loadSupplyTypesCatalog()`
    // call should re-fetch in case a mutation altered the catalog while
    // the sheet was open. (The bridge param itself doesn't change which
    // RSCs fetch, but staying on the framework's transition primitive
    // keeps focus + scroll restoration consistent with the rest of the
    // page.)
    router.replace(target, { scroll: false });
    lastPolicyParam.current = null;
  }, [pathname, router, searchParams]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (!next) {
        stripPolicyParam();
      }
    },
    [stripPolicyParam]
  );

  const triggerNode = (
    <Button
      type="button"
      variant="secondary"
      data-slot="services-edit-policy-button"
      aria-disabled={disabled || undefined}
      onClick={(e) => {
        if (disabled) {
          e.preventDefault();
          return;
        }
        setOpen(true);
      }}
      style={
        disabled
          ? {
              opacity: 0.5,
              cursor: "not-allowed",
            }
          : undefined
      }
    >
      <Sliders size={16} strokeWidth={1.5} aria-hidden="true" />
      <span>{BUTTON_LABEL}</span>
    </Button>
  );

  return (
    <>
      {disabled ? <OwnerOnlyTooltip disabled>{triggerNode}</OwnerOnlyTooltip> : triggerNode}
      <EditPolicySheet open={open && !disabled} onOpenChange={handleOpenChange} catalog={catalog} />
    </>
  );
}
