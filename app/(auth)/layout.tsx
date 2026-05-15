import "@/styles/auth.css";

import type { ReactNode } from "react";

import { Sparkles } from "lucide-react";

export default function AuthLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <main className="auth-shell">
      <section
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "var(--space-5)",
          width: "100%",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-2)",
            color: "var(--foreground)",
            fontSize: "var(--text-sm)",
            fontWeight: 500,
            letterSpacing: "var(--tracking-snug)",
          }}
        >
          <Sparkles size={20} strokeWidth={1.5} aria-hidden="true" />
          Tang Nails Studio
        </div>
        <section className="auth-card">{children}</section>
      </section>
    </main>
  );
}
