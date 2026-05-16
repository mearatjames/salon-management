"use client";

// StaffToaster — the URL → Sonner toast bridge for the Staff settings page.
//
// Every staff Server Action redirects back to `/settings/staff` with one of:
//   - `?toast=<key>&name=<encoded>` for success variants
//   - `?error=<code>` for destructive variants
//
// This client island lives at the bottom of `app/(studio)/settings/staff/page.tsx`
// and, on each navigation, fires the matching `TOAST.*` string through Sonner
// then strips the consumed params via `router.replace` (preserving `?selected=`
// so the panel state survives the cleanup).
//
// Mapping (verbatim from routes.contract.md § ?toast= and § ?error=):
//   staff_added       → TOAST.staffAdded(name)        — toast.success
//   changes_saved     → TOAST.changesSaved()          — toast.success
//   pin_updated       → TOAST.pinUpdated()            — toast.success
//   staff_deactivated → TOAST.staffDeactivated(name)  — toast.success
//   staff_reactivated → TOAST.changesSaved()          — toast.success (alias)
//   staff_removed     → TOAST.staffRemoved(name)      — toast.success
//   forbidden_target  → TOAST.forbiddenTarget()       — toast.error
//   last_owner        → TOAST.lastOwner()             — toast.error
//   self_edit_blocked → TOAST.selfEditBlocked()       — toast.error
//   not_found         → TOAST.notFound()              — toast.error
//   forbidden         → TOAST.forbidden()             — toast.error
//   no_changes        → silent (clear URL only, no toast)
//
// Ref guard: fires once per unique `toast`+`name`+`error` triple. If the user
// navigates again with the same triple (rare; only happens on a back-button
// dance) we still re-fire because the URL contract is "consume on mount".

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { TOAST } from "@/app/(studio)/settings/staff/toasts";

type ToastKey =
  | "staff_added"
  | "changes_saved"
  | "pin_updated"
  | "staff_deactivated"
  | "staff_reactivated"
  | "staff_removed";

type ErrorCode =
  | "forbidden_target"
  | "last_owner"
  | "self_edit_blocked"
  | "not_found"
  | "forbidden"
  | "no_changes";

const TOAST_KEYS: ReadonlySet<ToastKey> = new Set([
  "staff_added",
  "changes_saved",
  "pin_updated",
  "staff_deactivated",
  "staff_reactivated",
  "staff_removed",
]);

const ERROR_CODES: ReadonlySet<ErrorCode> = new Set([
  "forbidden_target",
  "last_owner",
  "self_edit_blocked",
  "not_found",
  "forbidden",
  "no_changes",
]);

function isToastKey(value: string | null): value is ToastKey {
  return value !== null && TOAST_KEYS.has(value as ToastKey);
}

function isErrorCode(value: string | null): value is ErrorCode {
  return value !== null && ERROR_CODES.has(value as ErrorCode);
}

function buildSuccessMessage(key: ToastKey, name: string | null): string | null {
  switch (key) {
    case "staff_added":
      return name ? TOAST.staffAdded(name) : null;
    case "changes_saved":
      return TOAST.changesSaved();
    case "pin_updated":
      return TOAST.pinUpdated();
    case "staff_deactivated":
      return name ? TOAST.staffDeactivated(name) : null;
    case "staff_reactivated":
      // routes.contract.md § ?toast=: no separate string, reuse "Changes saved".
      return TOAST.changesSaved();
    case "staff_removed":
      return name ? TOAST.staffRemoved(name) : null;
  }
}

function buildErrorMessage(code: ErrorCode): string | null {
  switch (code) {
    case "forbidden_target":
      return TOAST.forbiddenTarget();
    case "last_owner":
      return TOAST.lastOwner();
    case "self_edit_blocked":
      return TOAST.selfEditBlocked();
    case "not_found":
      return TOAST.notFound();
    case "forbidden":
      return TOAST.forbidden();
    case "no_changes":
      // routes.contract.md: silent — clear URL but no toast.
      return null;
  }
}

export function StaffToaster() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Last-handled signature; prevents a re-fire if React re-runs the effect
  // (e.g. StrictMode double-invocation in dev) without a new navigation.
  const lastSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    const toastKey = searchParams.get("toast");
    const name = searchParams.get("name");
    const errorCode = searchParams.get("error");

    // Nothing to do if neither param is present.
    if (!toastKey && !errorCode) return;

    const signature = `${toastKey ?? ""}|${name ?? ""}|${errorCode ?? ""}`;
    if (lastSignatureRef.current === signature) return;
    lastSignatureRef.current = signature;

    if (isToastKey(toastKey)) {
      const message = buildSuccessMessage(toastKey, name);
      if (message) toast.success(message);
    }

    if (isErrorCode(errorCode)) {
      const message = buildErrorMessage(errorCode);
      if (message) toast.error(message);
    }

    // Strip the consumed params via window.history.replaceState (a pure URL
    // rewrite — no RSC refetch, no router transition). Using router.replace
    // here triggers a Next.js navigation that re-renders the parent studio
    // layout, racing with Sonner's Toaster subscriber update and sometimes
    // swallowing the just-queued toast entirely (US7 race investigation).
    // The history rewrite is cheap and preserves Next's client cache.
    const next = new URLSearchParams(searchParams.toString());
    next.delete("toast");
    next.delete("name");
    next.delete("error");
    const query = next.toString();
    const target = query ? `${pathname}?${query}` : pathname;
    window.history.replaceState(window.history.state, "", target);
    // We intentionally watch `searchParams` so a new navigation triggers a
    // fresh evaluation; `pathname` is stable.
  }, [searchParams, pathname]);

  return null;
}
