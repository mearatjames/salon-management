// CatalogRow — one row in the services catalog list. Server Component,
// pure rendering. Composes (left → right per `contracts/ui.contract.md § 3`):
//   - color swatch (rendered from the service's `color_token`)
//   - service name
//   - duration pill (e.g. "45 min")
//   - price pill (via `formatPriceLabel`)
//   - Archived badge (when `active === false`)
//
// The tech-count pill is deferred to a later phase — assignment tracking
// stays in the data model but the UI affordance is hidden until staff
// assignment is reintroduced.
//
// The row is rendered as a child of a `<Link>` (the parent list owns the
// href + keyboard activation) — keeping the visual a pure server component
// means a streamed render and a hydrated render produce the same markup
// (data-model.md § 6 invariant 7).
//
// `isSelected` toggles a `data-selected="true"` attribute on the root so
// `.service-list-row[data-selected="true"]` can apply the active-row visual.
// All visual values resolve to Lacquer tokens (see `styles/settings.css`).

import { formatPriceLabel } from "@/app/(studio)/services/_format";
import type { CatalogService } from "@/app/(studio)/services/_types";

export type CatalogRowProps = {
  service: CatalogService;
  /** True when this row matches `?selected=<id>` in the URL. */
  isSelected: boolean;
};

export function CatalogRow({ service, isSelected }: CatalogRowProps) {
  const archived = !service.active;

  return (
    <div
      className="service-list-row"
      data-slot="service-row"
      data-service-id={service.id}
      data-selected={isSelected ? "true" : "false"}
      data-archived={archived ? "true" : "false"}
    >
      {/* Color swatch — uses the `--avatar-*` token directly so it traces
          to the design system. Inline CSS custom-property assignment keeps
          the swatch class itself token-only. */}
      <span
        aria-hidden="true"
        className="service-color-swatch"
        style={{ background: `var(${service.color_token})` }}
      />

      {/* Service name — flex-grows so the trailing pills hug the right edge. */}
      <span
        data-slot="service-name"
        style={{
          flex: "1 1 auto",
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: "var(--foreground)",
          fontWeight: 500,
          fontSize: "var(--text-sm)",
        }}
      >
        {service.name}
      </span>

      {/* Trailing group: duration + price + (optional) archived badge. Each
          pill renders with its own token-bound class. */}
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--space-2)",
          flex: "0 0 auto",
        }}
      >
        <span
          data-slot="service-duration-pill"
          className="service-price-pill tnum"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {service.duration_min} min
        </span>
        <span
          data-slot="service-price-pill"
          className="service-price-pill tnum"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {formatPriceLabel(service)}
        </span>
        {archived ? (
          <span data-slot="service-archived-badge" className="service-archived-badge">
            Archived
          </span>
        ) : null}
      </span>
    </div>
  );
}
