"use client";

// OnboardingSearch — small client island that owns the search input value
// and keeps it in sync with the `?q=` URL param. The actual filter is
// server-side ILIKE in the page Server Component (US7 spec, contract
// `routes.contract.md § /settings/onboarding ?q`).
//
// Debounced 250 ms so each keystroke doesn't trigger a server roundtrip;
// `useTransition` keeps the input responsive while the navigation streams.
//
// `data-slot="onboarding-search"` is the Playwright handle (US7 spec).

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";

export function OnboardingSearch({ initial = "" }: { initial?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(initial);
  const [isSearching, startTransition] = useTransition();

  // Note: browser back/forward changes `?q=` and re-runs the Server
  // Component with a new `initial`, but React preserves this island's
  // local `value` state across the re-render. For the v1 search we
  // accept that minor drift — typing again writes a fresh URL, and the
  // primary entry point is typing, not navigation. No back-sync effect
  // here (avoids the cascading-render eslint warning).

  useEffect(() => {
    const id = setTimeout(() => {
      const next = new URLSearchParams(params?.toString() ?? "");
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        next.delete("q");
      } else {
        next.set("q", trimmed);
      }
      const qs = next.toString();
      const url = `/settings/onboarding${qs ? `?${qs}` : ""}`;
      // No-op if we'd push the same URL we're already on.
      const current = `/settings/onboarding${params?.toString() ? `?${params.toString()}` : ""}`;
      if (url === current) return;
      startTransition(() => {
        router.replace(url);
      });
    }, 250);
    return () => clearTimeout(id);
  }, [value, params, router]);

  return (
    <div className="onb-search" data-slot="onboarding-search">
      <Search size={16} strokeWidth={1.5} className="onb-search-icon" aria-hidden />
      <input
        type="search"
        className="onb-search-input"
        placeholder="Search by name or email"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label="Search users"
      />
      {isSearching ? <Spinner size={16} className="onb-search-spinner" /> : null}
    </div>
  );
}
