"use client";

// ServiceTiles — adapted from `design-system/prototypes/transaction/components.jsx`
// § ServiceTiles. Renders a search input + category chip row above a grid
// of tap-target service tiles. Disabled (greyed, non-interactive) when no
// tech is picked yet (FR-006). Search is a substring match on `name`; the
// category chip narrows by `category`. All visuals trace to Lacquer
// tokens; Lucide icons only (Search, sized 16, stroke 1.5).

import { useMemo, useState } from "react";

import { Search } from "lucide-react";

export type ServiceTileService = {
  id: string;
  name: string;
  category: string;
  duration_min: number;
  price_cents: number;
  variable_price: boolean;
  price_from_cents: number | null;
  // 013-cart-polish additions — surfaced on the tile for forwarding into
  // the cart-line view so the PriceSheet can render bounds + presets
  // without a second round trip when the operator opens the sheet.
  price_to_cents?: number | null;
  variable_price_note?: string | null;
  presets?: Array<{ label: string; price_cents: number }> | null;
};

export type ServiceTilesProps = {
  services: ReadonlyArray<ServiceTileService>;
  /** Disabled when true (no tech picked) — tiles render but don't fire onPick. */
  disabled: boolean;
  /** Fires when an enabled tile is tapped. */
  onPick: (service: ServiceTileService) => void;
};

const ALL = "All";

function formatPrice(s: ServiceTileService): string {
  if (s.variable_price) {
    if (s.price_from_cents != null) {
      return `From $${(s.price_from_cents / 100).toFixed(0)}`;
    }
    return "Variable";
  }
  if (s.price_cents === 0) return "Free";
  return `$${(s.price_cents / 100).toFixed(0)}`;
}

export function ServiceTiles({ services, disabled, onPick }: ServiceTilesProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>(ALL);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const s of services) set.add(s.category);
    return [ALL, ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [services]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = services.filter(
      (s) =>
        (category === ALL || s.category === category) &&
        (q === "" || s.name.toLowerCase().includes(q))
    );
    if (category === ALL) {
      rows = [...rows].sort((a, b) => a.name.localeCompare(b.name));
    }
    return rows;
  }, [services, query, category]);

  return (
    <div
      data-slot="service-catalog"
      data-disabled={disabled ? "true" : "false"}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-3)",
        minHeight: 0,
        flex: 1,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          padding: "var(--space-2) var(--space-3)",
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)",
        }}
      >
        <Search size={16} strokeWidth={1.5} aria-hidden="true" />
        <input
          data-slot="service-search-input"
          aria-label="Search services"
          placeholder="Search services"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={disabled}
          style={{
            border: "none",
            outline: "none",
            background: "transparent",
            color: "var(--foreground)",
            fontSize: "var(--text-sm)",
            flex: 1,
            minWidth: 0,
          }}
        />
      </div>

      <div
        role="tablist"
        aria-label="Service categories"
        style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}
      >
        {categories.map((c) => {
          const isActive = c === category;
          return (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={isActive ? "true" : "false"}
              data-slot="service-category-chip"
              data-category={c}
              onClick={() => setCategory(c)}
              disabled={disabled}
              style={{
                padding: "var(--space-1) var(--space-3)",
                background: isActive ? "var(--primary)" : "var(--card)",
                color: isActive ? "var(--primary-foreground)" : "var(--foreground)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-full)",
                fontSize: "var(--text-xs)",
                fontWeight: 500,
                cursor: disabled ? "not-allowed" : "pointer",
              }}
            >
              {c}
            </button>
          );
        })}
      </div>

      <div className="checkout-catalog-grid" data-slot="service-tile-grid">
        {filtered.length === 0 ? (
          <div
            data-slot="service-tiles-empty"
            style={{
              padding: "var(--space-6)",
              textAlign: "center",
              fontSize: "var(--text-sm)",
              color: "var(--muted-foreground)",
              gridColumn: "1 / -1",
            }}
          >
            {query ? `No services match "${query}".` : "No services in this category."}
          </div>
        ) : (
          filtered.map((s) => (
            <button
              key={s.id}
              type="button"
              data-slot="service-tile"
              data-service-id={s.id}
              data-variable={s.variable_price ? "true" : "false"}
              onClick={() => (disabled ? undefined : onPick(s))}
              disabled={disabled}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: "var(--space-2)",
                padding: "var(--space-3)",
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)",
                cursor: disabled ? "not-allowed" : "pointer",
                textAlign: "left",
                minHeight: "var(--space-16)",
              }}
            >
              <span
                style={{
                  fontSize: "var(--text-sm)",
                  fontWeight: 500,
                  color: "var(--foreground)",
                }}
              >
                {s.name}
              </span>
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  fontSize: "var(--text-xs)",
                  color: "var(--muted-foreground)",
                }}
              >
                <span>{s.duration_min} min</span>
                <span
                  className="tnum"
                  style={{
                    color: "var(--foreground)",
                    fontWeight: 500,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {formatPrice(s)}
                </span>
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
