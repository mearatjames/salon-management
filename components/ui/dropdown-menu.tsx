"use client";

import * as React from "react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";
import { CheckIcon, ChevronDownIcon, ChevronRightIcon } from "lucide-react";

// Lacquer dropdown menu — aligned to `design-system/preview/dropdown-menu.html`.
// Surface: 8px radius (--radius-md), hairline --border (we lean on borders, not
// rings), --shadow-md, 200ms open. Items: 4px radius (--radius-xs), 6px 8px
// padding, body at --text-sm. Group labels + shortcuts are mono/uppercase per
// spec. Checkbox/radio marks sit on the LEFT in --primary (check / filled dot).
// Every value traces to a token in `styles/tokens.css`.

function DropdownMenu({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuPortal({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  return <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />;
}

function DropdownMenuTrigger({
  className,
  asChild = false,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  // When consumers pass their own trigger element (`asChild`) — e.g. the
  // operator chip or a kebab icon button — stay out of the way and forward
  // untouched. Otherwise render the canonical Lacquer trigger: a secondary
  // button with a chevron that rotates 180° while the menu is open.
  if (asChild) {
    return (
      <DropdownMenuPrimitive.Trigger
        data-slot="dropdown-menu-trigger"
        asChild
        className={className}
        {...props}
      >
        {children}
      </DropdownMenuPrimitive.Trigger>
    );
  }

  return (
    <DropdownMenuPrimitive.Trigger
      data-slot="dropdown-menu-trigger"
      className={cn(
        "group/dropdown-menu-trigger inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[var(--radius-sm)] border border-border bg-secondary pr-2.5 pl-3 text-[length:var(--text-sm)] font-medium whitespace-nowrap text-secondary-foreground outline-none transition-[background-color,border-color,box-shadow] duration-150 ease-[var(--ease-out)] hover:bg-accent focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20 disabled:pointer-events-none disabled:opacity-50",
        className
      )}
      {...props}
    >
      {children}
      <ChevronDownIcon
        aria-hidden="true"
        className="size-3.5 text-muted-foreground transition-transform duration-200 group-data-[state=open]/dropdown-menu-trigger:rotate-180"
      />
    </DropdownMenuPrimitive.Trigger>
  );
}

function DropdownMenuContent({
  className,
  align = "start",
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        align={align}
        className={cn(
          "z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-56 origin-(--radix-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-[var(--radius-md)] border border-border bg-popover p-1 text-[length:var(--text-sm)] text-popover-foreground shadow-[var(--shadow-md)] duration-200 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:overflow-hidden data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuGroup({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  return <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />;
}

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  inset?: boolean;
  variant?: "default" | "destructive";
}) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "group/dropdown-menu-item relative flex cursor-pointer items-center gap-2 rounded-[var(--radius-xs)] px-2 py-1.5 leading-tight outline-hidden select-none focus:bg-accent data-inset:pl-8 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/12 data-disabled:pointer-events-none data-disabled:opacity-[0.55] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:text-muted-foreground [&_svg:not([class*='size-'])]:size-4 data-[variant=destructive]:[&_svg]:text-destructive",
        className
      )}
      {...props}
    />
  );
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem> & {
  inset?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      data-inset={inset}
      className={cn(
        "relative flex cursor-pointer items-center gap-2 rounded-[var(--radius-xs)] px-2 py-1.5 leading-tight outline-hidden select-none focus:bg-accent data-inset:pl-8 data-disabled:pointer-events-none data-disabled:opacity-[0.55] [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className
      )}
      checked={checked}
      {...props}
    >
      <span
        className="flex size-4 shrink-0 items-center justify-center text-primary"
        data-slot="dropdown-menu-checkbox-item-indicator"
      >
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon className="size-3.5" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

function DropdownMenuRadioGroup({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>) {
  return <DropdownMenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />;
}

function DropdownMenuRadioItem({
  className,
  children,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem> & {
  inset?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      data-inset={inset}
      className={cn(
        "relative flex cursor-pointer items-center gap-2 rounded-[var(--radius-xs)] px-2 py-1.5 leading-tight outline-hidden select-none focus:bg-accent data-inset:pl-8 data-disabled:pointer-events-none data-disabled:opacity-[0.55] [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className
      )}
      {...props}
    >
      <span
        className="flex size-4 shrink-0 items-center justify-center text-primary"
        data-slot="dropdown-menu-radio-item-indicator"
      >
        <DropdownMenuPrimitive.ItemIndicator>
          <span className="size-1.5 rounded-full bg-current" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & {
  inset?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        "px-2 pt-[7px] pb-[3px] font-[family-name:var(--font-mono)] text-[10px] tracking-[0.07em] text-muted-foreground uppercase data-inset:pl-8",
        className
      )}
      {...props}
    />
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("-mx-px my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

function DropdownMenuShortcut({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        "ml-auto pl-3 font-[family-name:var(--font-mono)] text-[11px] tracking-[0.02em] text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}

function DropdownMenuSub({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />;
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & {
  inset?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-[var(--radius-xs)] px-2 py-1.5 leading-tight outline-hidden select-none focus:bg-accent data-open:bg-accent data-inset:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:text-muted-foreground [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-3.5" />
    </DropdownMenuPrimitive.SubTrigger>
  );
}

function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.SubContent
      data-slot="dropdown-menu-sub-content"
      className={cn(
        "z-50 min-w-[184px] origin-(--radix-dropdown-menu-content-transform-origin) overflow-hidden rounded-[var(--radius-md)] border border-border bg-popover p-1 text-[length:var(--text-sm)] text-popover-foreground shadow-[var(--shadow-md)] duration-200 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
        className
      )}
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
};
