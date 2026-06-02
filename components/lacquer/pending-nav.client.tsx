"use client";

// PendingNav — a calm loading affordance for search-param (soft) navigations.
//
// The period / range / pay-period toggles on Transactions, Report, and Payroll
// only change a search param on the *same* route segment. Next.js treats that
// as a soft navigation: the segment is not remounted, so `loading.tsx` does NOT
// re-fire — React holds the stale UI on screen until the new RSC payload
// resolves, with zero pending indicator (issue #197).
//
// This primitive closes that gap with the idiomatic `useTransition` pattern:
//   - `PendingNavProvider` owns the transition + router and exposes
//     `navigate(href)` / `isPending` via context.
//   - the toggle controls call `navigate(href)` instead of letting `<Link>`
//     soft-navigate, so the click is wrapped in a transition.
//   - `PendingContent` wraps the data region and flags it (`data-pending`)
//     while the re-fetch is in flight; `styles/globals.css` dims it.
//
// The data fetch itself stays entirely server-side — this only makes the
// in-flight state visible.

import {
  createContext,
  useCallback,
  useContext,
  useTransition,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";

// True when a click on an enhanced `<Link>` should be left to the browser /
// Next.js rather than intercepted into a transition: a modified or non-primary
// click (open-in-new-tab, etc.), or one a handler already cancelled. Keeping
// the underlying `href` means these clicks still work; we only intercept the
// plain left-click to wrap it in `navigate()`.
export function isModifiedClick(e: MouseEvent): boolean {
  return e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
}

type PendingNavValue = {
  /** Navigate to `href` inside a transition so `isPending` tracks the fetch. */
  navigate: (href: string) => void;
  /** True while the transition's server re-fetch is in flight. */
  isPending: boolean;
};

const PendingNavContext = createContext<PendingNavValue | null>(null);

export function PendingNavProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const navigate = useCallback(
    (href: string) => {
      startTransition(() => {
        router.push(href);
      });
    },
    [router]
  );

  return (
    <PendingNavContext.Provider value={{ navigate, isPending }}>
      {children}
    </PendingNavContext.Provider>
  );
}

export function usePendingNav(): PendingNavValue {
  const ctx = useContext(PendingNavContext);
  if (ctx === null) {
    throw new Error("usePendingNav must be used within a <PendingNavProvider>");
  }
  return ctx;
}

// Wraps the data region that should dim while a soft navigation is pending.
// The wrapper is `display: contents` (see `styles/globals.css`) so it adds no
// box to the page's flex layout — the dim + pointer-lock fall on its children.
export function PendingContent({ children }: { children: ReactNode }) {
  const { isPending } = usePendingNav();
  return (
    <div
      data-slot="pending-region"
      data-pending={isPending ? "true" : undefined}
      aria-busy={isPending || undefined}
    >
      {children}
    </div>
  );
}
