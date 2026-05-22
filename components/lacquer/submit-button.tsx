"use client";

// SubmitButton — a form submit button with a built-in pending state.
//
// Reads React's `useFormStatus()`, so it MUST be rendered inside the
// `<form action={…}>` whose submission it reflects (the hook reads the
// nearest enclosing form's status). While that form's Server Action is
// in flight it disables itself, prepends a <Spinner>, and swaps to
// `pendingLabel`.
//
// Chrome-agnostic: it renders a plain <button> and forwards `className`
// / `style` verbatim, so each form keeps its existing visual treatment
// (auth `.auth-btn`, staff inline styles, …). Pending styling is the
// design system's 0.72 opacity via inline style.

import type { ComponentProps, ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { Spinner } from "@/components/ui/spinner";

export type SubmitButtonProps = Omit<ComponentProps<"button">, "type" | "children"> & {
  /** Content shown while idle. */
  children: ReactNode;
  /** Label shown (next to the spinner) while the form is submitting. */
  pendingLabel: string;
};

export function SubmitButton({
  children,
  pendingLabel,
  className,
  style,
  disabled,
  ...props
}: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      data-loading={pending || undefined}
      className={className}
      style={pending ? { opacity: 0.72, ...style } : style}
      {...props}
    >
      {pending ? (
        // .lq-spinner is display:block; an inline-flex wrapper keeps it on one
        // line with the label whatever chrome the caller's button carries (#124).
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "var(--space-2)",
          }}
        >
          <Spinner size={16} strokeWidth={2} />
          {pendingLabel}
        </span>
      ) : (
        children
      )}
    </button>
  );
}
