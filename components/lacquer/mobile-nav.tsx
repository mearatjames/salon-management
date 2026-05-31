"use client";

// Mobile studio navigation — the off-canvas drawer that replaces the persistent
// sidebar below the shared phone breakpoint (`max-width: 640px`, defined once in
// styles/studio.css). Rendered as the first child of `.studio-topbar`: the
// hamburger sits inline in the bar, while the scrim + drawer are
// `position: fixed` overlays, so their DOM position is irrelevant to layout.
//
// Every surface (persistent sidebar, hamburger, drawer) ships in every
// response; CSS alone decides which is visible at a given width. This component
// only adds the behaviour the drawer needs: open/close, scrim + nav-tap +
// Escape dismiss, a focus trap while open, focus restored to the hamburger on
// close, and a background scroll lock.
//
// Accessibility: the hamburger is `aria-haspopup="dialog"` + `aria-expanded`
// and controls the drawer by id; the drawer is `role="dialog" aria-modal="true"`
// with an accessible name. Nav items reuse `<StudioNavList>` with
// `emitNavId={false}` so the drawer copies never collide with the sidebar's
// `[data-nav-id]` e2e selectors. Motion is CSS-driven and honours
// `prefers-reduced-motion`.

import { Menu, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

import { LacquerMark } from "@/components/lacquer/lacquer-mark";
import { StudioNavList } from "@/components/lacquer/sidebar/studio-nav-list";

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type MobileNavProps = {
  /** Viewer's studio role — forwarded to `<StudioNavList>` for role filtering. */
  role: string;
  /** Operator footer (server-rendered `<SidebarFooter>`), pinned to the bottom. */
  footer: ReactNode;
};

export function MobileNav({ role, footer }: MobileNavProps) {
  const [open, setOpen] = useState(false);
  const drawerId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  // While the drawer is open: trap focus inside it, close on Escape, lock the
  // background scroll, and restore focus to the hamburger on close.
  useEffect(() => {
    if (!open) return;

    const trigger = triggerRef.current;
    const drawer = drawerRef.current;
    if (!drawer) return;

    // Move focus into the drawer once it's painted in.
    drawer.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;

      const items = drawer.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [open, close]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="studio-topbar-hamburger"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={drawerId}
      >
        <Menu size={20} strokeWidth={1.5} aria-hidden="true" />
      </button>

      <div
        className="studio-scrim"
        data-open={open ? "true" : "false"}
        aria-hidden="true"
        onClick={close}
      />

      <nav
        ref={drawerRef}
        id={drawerId}
        className="studio-drawer"
        data-open={open ? "true" : "false"}
        role="dialog"
        aria-modal="true"
        aria-label="Studio navigation"
        tabIndex={-1}
      >
        <div className="studio-drawer-header">
          <span className="studio-drawer-brand">
            <LacquerMark size={20} />
            Tang Nails Studio
          </span>
          <button
            type="button"
            className="studio-drawer-close"
            onClick={close}
            aria-label="Close navigation"
          >
            <X size={18} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>

        <StudioNavList role={role} onNavigate={close} emitNavId={false} />

        <div className="studio-sidebar-spacer" />

        {footer}
      </nav>
    </>
  );
}
