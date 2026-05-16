// EmptyState — the zero-catalog placeholder. Server Component, pure layout.
// Copy is verbatim from `contracts/ui.contract.md § 3`. The "Add service"
// CTA links to `/services?adding=1`.
//
// All visual values resolve to Lacquer tokens (see `styles/settings.css`
// for `.services-empty-state*`).

import Link from "next/link";
import { Sparkles } from "lucide-react";

export function ServicesEmptyState() {
  return (
    <section
      className="services-empty-state"
      data-slot="services-empty-state"
      aria-label="Empty services catalog"
    >
      <span aria-hidden="true" className="services-empty-state-icon">
        <Sparkles size={24} strokeWidth={1.5} />
      </span>
      <p className="services-empty-state-copy" style={{ margin: 0 }}>
        Add your first service to start booking appointments.
      </p>
      <Link
        href="/services?adding=1"
        data-slot="services-empty-add-button"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--space-2)",
          padding: "var(--space-2) var(--space-4)",
          background: "var(--primary)",
          color: "var(--primary-foreground)",
          borderRadius: "var(--radius-sm)",
          fontSize: "var(--text-sm)",
          fontWeight: 500,
          textDecoration: "none",
          transition: "background var(--duration-fast) var(--ease-out)",
        }}
      >
        Add service
      </Link>
    </section>
  );
}
