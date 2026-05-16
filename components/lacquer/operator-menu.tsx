"use client";

import type { ReactNode } from "react";

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

export function OperatorMenu({ children }: OperatorMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6}>
        <DropdownMenuItem asChild>
          <form action={signOut} style={{ width: "100%" }}>
            <button
              type="submit"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--space-2)",
                width: "100%",
                background: "transparent",
                border: 0,
                padding: 0,
                font: "inherit",
                color: "inherit",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <LogOut size={16} strokeWidth={1.5} aria-hidden="true" />
              Sign out
            </button>
          </form>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
