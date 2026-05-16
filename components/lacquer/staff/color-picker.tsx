// ColorPicker — 8-swatch avatar palette picker. Server Component.
//
// Renders the 8 `--avatar-*` color tokens as <input type="radio"> elements
// styled into circular tap-targets. The token order matches research.md § R4
// (rose, blue, green, amber, purple, teal, orange, slate). Default-checked
// is `--avatar-green` (3rd swatch) per FR-010.
//
// Pure rendering: the only state is whatever surrounding form holds. Used
// by `add-staff-wizard.client.tsx` step 1 (Add wizard) and the edit panel
// (US3). Both consumers render this inside a <form>; the radio group's
// `name` is fixed to `color_token` so the FormData key matches the
// addStaff/updateStaff Server-Action contract.
//
// All visual values resolve to Lacquer tokens.

import type { CSSProperties } from "react";

export type ColorOption = {
  /** CSS custom-property name including the leading `--`. */
  token: string;
  /** Human label used as the tooltip + aria-label. */
  label: string;
};

/**
 * 8-token order is fixed per research.md § R4 — do not reorder; the e2e
 * spec selects swatches by label and the unit tests pin the index.
 */
export const STAFF_COLOR_OPTIONS: ReadonlyArray<ColorOption> = [
  { token: "--avatar-rose", label: "Rose" },
  { token: "--avatar-blue", label: "Blue" },
  { token: "--avatar-green", label: "Green" },
  { token: "--avatar-amber", label: "Amber" },
  { token: "--avatar-purple", label: "Purple" },
  { token: "--avatar-teal", label: "Teal" },
  { token: "--avatar-orange", label: "Orange" },
  { token: "--avatar-slate", label: "Slate" },
];

export const DEFAULT_COLOR_TOKEN = "--avatar-green";

export type ColorPickerProps = {
  /** Radio group `name`. Defaults to `color_token` (FormData key). */
  name?: string;
  /** Currently-selected token (controlled mode). */
  value?: string;
  /** Initial selection in uncontrolled mode. Defaults to `--avatar-green`. */
  defaultValue?: string;
  /**
   * Selection change callback (controlled mode). Server Component variant
   * passes nothing; client wizard/edit-panel pass a setter so the live
   * avatar preview updates.
   */
  onChange?: (token: string) => void;
  /** Disables every swatch (manager × owner case). */
  disabled?: boolean;
  /** Container className for layout overrides. */
  className?: string;
  /** Container style override. */
  style?: CSSProperties;
};

const SWATCH_SIZE_PX = 28;

export function ColorPicker({
  name = "color_token",
  value,
  defaultValue = DEFAULT_COLOR_TOKEN,
  onChange,
  disabled = false,
  className,
  style,
}: ColorPickerProps) {
  const selected = value ?? defaultValue;
  const isControlled = value !== undefined;
  return (
    <div
      data-slot="staff-color-picker"
      role="radiogroup"
      aria-label="Avatar color"
      className={className}
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "var(--space-2)",
        alignItems: "center",
        ...style,
      }}
    >
      {STAFF_COLOR_OPTIONS.map((opt) => {
        const checked = opt.token === selected;
        return (
          <label
            key={opt.token}
            title={opt.label}
            aria-label={opt.label}
            data-slot="color-swatch"
            data-color-token={opt.token}
            data-checked={checked ? "true" : "false"}
            style={{
              position: "relative",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: `${SWATCH_SIZE_PX}px`,
              height: `${SWATCH_SIZE_PX}px`,
              borderRadius: "var(--radius-full)",
              background: `var(${opt.token})`,
              cursor: disabled ? "not-allowed" : "pointer",
              opacity: disabled ? 0.5 : 1,
              boxShadow: checked
                ? `0 0 0 2px var(--background), 0 0 0 4px var(${opt.token})`
                : "none",
              transition: "box-shadow 150ms var(--ease-out)",
            }}
          >
            <input
              type="radio"
              name={name}
              value={opt.token}
              {...(isControlled
                ? { checked, onChange: () => onChange?.(opt.token) }
                : { defaultChecked: checked, onChange: onChange ? () => onChange(opt.token) : undefined })}
              disabled={disabled}
              aria-label={opt.label}
              style={{
                position: "absolute",
                inset: 0,
                opacity: 0,
                margin: 0,
                cursor: disabled ? "not-allowed" : "pointer",
              }}
            />
          </label>
        );
      })}
    </div>
  );
}
