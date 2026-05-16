"use client";

import { useSyncExternalStore, type ReactNode } from "react";

import { LogOut } from "lucide-react";

import { signOut } from "@/app/(studio)/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type OperatorMenuProps = {
  children: ReactNode;
};

// `useSyncExternalStore` is the React-19-idiomatic way to render differently
// on the server vs after hydration without triggering the
// `react-hooks/set-state-in-effect` lint rule — mirrors the pattern already
// used by `sidebar-shell.client.tsx`. The "store" is a constant: false on the
// server, true once we're in the browser.
const subscribeNoop = () => () => {};
const getMountedSnapshot = () => true;
const getServerSnapshot = () => false;

export function OperatorMenu({ children }: OperatorMenuProps) {
  // Radix `DropdownMenu.Root` calls React `useId()` (twice — triggerId,
  // contentId). Those ids can drift between SSR and client hydration when a
  // navigation lands mid-hydration, producing the "Hydration failed" warning
  // documented in `tests/e2e/staff.spec.ts` for this exact trigger. Render
  // children raw on the first client paint (matching the SSR'd HTML), then
  // mount the dropdown on the next tick — useId values are then generated in
  // a pure client re-render with no SSR comparison.
  const mounted = useSyncExternalStore(subscribeNoop, getMountedSnapshot, getServerSnapshot);

  if (!mounted) {
    return <>{children}</>;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6}>
        <DropdownMenuItem
          className="cursor-pointer"
          onSelect={() => {
            // Server action returns a redirect; Next handles navigation.
            // Nesting a <form> inside DropdownMenuItem with asChild caused
            // the menu's click handler to swallow the first submit.
            void signOut();
          }}
        >
          <LogOut size={16} strokeWidth={1.5} aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
