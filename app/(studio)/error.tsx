"use client";

import { useEffect } from "react";

import { toast } from "sonner";

export default function StudioError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Auth redirects are translated into Next.js redirect() calls upstream; if
  // one leaks this far, the navigation is in flight — render nothing so the
  // user doesn't see a flicker of the error placeholder.
  const isAuthRedirect =
    typeof error.message === "string" && error.message.includes("auth-redirect:");

  useEffect(() => {
    if (isAuthRedirect) return;
    toast.error(error.message ?? "Something went wrong. Try again.");
  }, [error, isAuthRedirect]);

  if (isAuthRedirect) return null;

  return (
    <div
      role="alert"
      style={{
        padding: "var(--space-8)",
        color: "var(--muted-foreground)",
        fontSize: "var(--text-sm)",
        textAlign: "center",
      }}
    >
      <p style={{ marginBottom: "var(--space-3)" }}>
        Couldn&apos;t complete that. The salon shell is still here — try again from the previous
        screen.
      </p>
      <button
        type="button"
        onClick={() => reset()}
        style={{
          background: "transparent",
          color: "var(--foreground)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)",
          padding: "var(--space-2) var(--space-4)",
          cursor: "pointer",
          fontSize: "var(--text-sm)",
        }}
      >
        Try again
      </button>
    </div>
  );
}
