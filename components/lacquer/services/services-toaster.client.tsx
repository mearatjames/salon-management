"use client";

// ServicesToaster — the URL → Sonner toast bridge for the Services settings page.
//
// Every services Server Action redirects back to `/settings/services` with one
// or more of:
//   - `?toast=<key>&name=<encoded>`      success / info variants
//   - `?secondary=<key>`                 a warning toast that may stack with
//                                        a success toast (currently only
//                                        `no_techs_assigned`)
//   - `?error=<code>`                    destructive variants
//
// This client island lives at the bottom of
// `app/(studio)/settings/services/page.tsx` (wrapped in <Suspense> because
// `useSearchParams()` requires it under Next 16's strict streaming rules) and,
// on each navigation, fires the matching toast(s) through Sonner then strips
// the consumed params via a history rewrite (preserving `?selected=` and
// `?adding=` so the drawer state survives the cleanup).
//
// Source of truth for the copy + variant is the `TOASTS` map in `./toasts.ts`
// (Phase 2), keyed by the URL `?toast=<key>` / `?error=<code>` value.
//
// Sequencing rules:
//   - If `?error=` and `?toast=` are both present, prefer the error and skip
//     the success — `?error=` redirects per the actions contract never carry
//     a `?toast=` key, but defensive ordering is cheap.
//   - To enforce the "no stacking" rule the spec asks for in the rapid-fire
//     case, we call `toast.dismiss()` before firing the new toast(s).
//   - `secondary=no_techs_assigned` fires AFTER the primary success — Sonner
//     keeps both on screen because the second `.success`/`.warning` call
//     follows a clean dismissal (the secondary is genuinely additive).
//
// Ref guard: fires once per unique `toast|secondary|name|error` signature so
// a React effect re-run (StrictMode double-invocation in dev) doesn't
// double-fire.

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { TOASTS, type ToastKey } from "@/app/(studio)/settings/services/toasts";

const TOAST_KEYS = new Set(Object.keys(TOASTS)) as ReadonlySet<string>;

function isToastKey(value: string | null): value is ToastKey {
  return value !== null && TOAST_KEYS.has(value);
}

function fireToast(key: ToastKey, name: string | null): void {
  const entry = TOASTS[key];
  const decoded = name ? safeDecode(name) : undefined;
  const message = entry.text(decoded);
  switch (entry.variant) {
    case "success":
      toast.success(message);
      return;
    case "warning":
      toast.warning(message);
      return;
    case "destructive":
      toast.error(message);
      return;
    case "info":
      toast.info(message);
      return;
  }
}

// Defensive decode — a malformed URL component should never crash the page,
// just render the raw value.
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function ServicesToaster() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Last-handled signature; prevents a re-fire if React re-runs the effect
  // (e.g. StrictMode double-invocation in dev) without a new navigation.
  const lastSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    const toastKey = searchParams.get("toast");
    const secondaryKey = searchParams.get("secondary");
    const name = searchParams.get("name");
    const errorCode = searchParams.get("error");

    // Nothing to do if no relevant params are present.
    if (!toastKey && !secondaryKey && !errorCode) return;

    const signature = `${toastKey ?? ""}|${secondaryKey ?? ""}|${name ?? ""}|${errorCode ?? ""}`;
    if (lastSignatureRef.current === signature) return;
    lastSignatureRef.current = signature;

    // Enforce the no-stacking rule for the rapid-fire case: dismiss any
    // currently-visible toast before firing the new one. Sonner queues by
    // default; the spec is explicit that the latest mutation wins.
    toast.dismiss();

    if (errorCode) {
      // `?error=` paths never carry a `?toast=` key per the actions contract,
      // but if one ever slips through we prefer the error and skip the
      // success/info toast entirely.
      if (isToastKey(errorCode)) {
        fireToast(errorCode, name);
      }
    } else {
      if (isToastKey(toastKey)) {
        fireToast(toastKey, name);
      }
      if (isToastKey(secondaryKey)) {
        fireToast(secondaryKey, name);
      }
    }

    // Strip the consumed params via window.history.replaceState (a pure URL
    // rewrite — no RSC refetch, no router transition). Using router.replace
    // here triggers a Next.js navigation that re-renders the parent studio
    // layout, racing with Sonner's Toaster subscriber update and sometimes
    // swallowing the just-queued toast entirely. Mirrors the staff toaster.
    const next = new URLSearchParams(searchParams.toString());
    next.delete("toast");
    next.delete("secondary");
    next.delete("name");
    next.delete("error");
    const query = next.toString();
    const target = query ? `${pathname}?${query}` : pathname;
    window.history.replaceState(window.history.state, "", target);
  }, [searchParams, pathname]);

  return null;
}
