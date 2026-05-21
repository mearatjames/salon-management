"use client";

// AddStaffWizard — 3-step Add staff sheet. Client island.
//
// Adapted from `design-system/prototypes/user-management/StaffManagement.jsx:47-294`.
// Owns the entire wizard state (step, draft, PIN buffers) and posts the
// final FormData to the `addStaff` Server Action on the confirm-PIN step.
//
// **PIN-required deviation**: the underlying `staff` table CHECK constraint
// requires `pin_hash IS NOT NULL OR user_id IS NOT NULL`. Because the
// wizard does not link a Supabase user, v1 requires a PIN to complete Add.
// The prototype's "Skip for now" affordance is dropped — every Add goes
// through step 2 (PIN entry) and step 3 (success). This matches the
// quickstart.md § US2 happy path verbatim.
//
// Step machine:
//   1 Details   → name (≥ 2 chars), role (scoped via roleOptionsFor), color
//   2 Set PIN   → two phases (enter → confirm) using <NumericKeypad>
//   3 Done      → success card; Done button closes the sheet
//
// Submit happens on step 2's confirm-phase match: we render a hidden
// <form action={addStaff}> containing the matched FormData and call
// requestSubmit(). The Server Action redirects with `?selected=…&toast=
// staff_added&name=…` — the page re-renders and (in US7) the toaster fires.

import { useCallback, useMemo, useRef, useState } from "react";

import { Check, X } from "lucide-react";

import { FormPendingSignal } from "@/components/lacquer/form-pending-signal";
import { Spinner } from "@/components/ui/spinner";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { NumericKeypad } from "@/components/lacquer/numeric-keypad.client";
import {
  ColorPicker,
  DEFAULT_COLOR_TOKEN,
  STAFF_COLOR_OPTIONS,
} from "@/components/lacquer/staff/color-picker";
import { InitialsAvatar } from "@/components/lacquer/initials-avatar";
import { roleOptionsFor, type StudioRole } from "@/app/(studio)/settings/staff/permissions";
import { addStaff } from "@/app/(studio)/settings/staff/actions";
import {
  pinKeypadInit,
  pinKeypadSubmit,
  type PinKeypadState,
} from "@/app/(studio)/settings/staff/_pin-keypad-state";

const ROLE_LABEL: Record<StudioRole, string> = {
  owner: "Owner",
  manager: "Manager",
  technician: "Tech",
  front_desk: "Front desk",
};

// Three-step pill metadata. Keys are stable test selectors via `data-step`.
const WIZARD_STEPS: ReadonlyArray<{ key: "details" | "set-pin" | "done"; label: string }> = [
  { key: "details", label: "Details" },
  { key: "set-pin", label: "Set PIN" },
  { key: "done", label: "Done" },
];

// Per-step primary CTA label. Step 3 ("Done") renders its own close button
// in the success body, so the sticky footer hides the primary at that step.
const PRIMARY_CTA_LABEL: Record<1 | 2 | 3, string> = {
  1: "Next: set PIN",
  2: "Set PIN",
  3: "Done",
};

type WizardStep = 1 | 2 | 3;

export type AddStaffWizardProps = {
  /** Operator's role — drives `roleOptionsFor`. */
  operatorRole: StudioRole;
  /** Controlled open state (the parent button island owns this). */
  open: boolean;
  /** Open/close handler — invoked by close button, backdrop, Done CTA. */
  onOpenChange: (next: boolean) => void;
};

export function AddStaffWizard({ operatorRole, open, onOpenChange }: AddStaffWizardProps) {
  const roleOptions = useMemo(() => roleOptionsFor(operatorRole), [operatorRole]);
  const defaultRole: StudioRole = useMemo(() => {
    // Wizard defaults to "technician" if available (matches the prototype);
    // falls back to the first allowed option if not (e.g., a future operator
    // role with a different scope).
    if (roleOptions.includes("technician")) return "technician";
    return roleOptions[0] ?? "front_desk";
  }, [roleOptions]);

  const [step, setStep] = useState<WizardStep>(1);
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<StudioRole>(defaultRole);
  const [colorToken, setColorToken] = useState<string>(DEFAULT_COLOR_TOKEN);

  // PIN state — pure reducer in `_pin-keypad-state.ts` drives `phase`, the
  // entered-buffer, and the mismatch-error string.
  const [pinState, setPinState] = useState<PinKeypadState>(() => pinKeypadInit());

  const [submitting, setSubmitting] = useState(false);

  const formRef = useRef<HTMLFormElement | null>(null);
  const submittingRef = useRef(false);

  // Wrap the parent's open setter so we reset every piece of wizard state
  // synchronously on close. Re-opens land on step 1 with empty inputs.
  // Resetting in the event handler (not a useEffect) avoids a cascading
  // re-render and keeps the React-Compiler-friendly rules-of-hooks linter
  // satisfied (no setState in effect bodies).
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        setStep(1);
        setDisplayName("");
        setRole(defaultRole);
        setColorToken(DEFAULT_COLOR_TOKEN);
        setPinState(pinKeypadInit());
        submittingRef.current = false;
        setSubmitting(false);
      }
      onOpenChange(next);
    },
    [defaultRole, onOpenChange]
  );

  const trimmedName = displayName.trim();
  const canProceedFromDetails = trimmedName.length >= 2;

  const handleKeypadSubmit = useCallback(
    (digits: string) => {
      const { state: next, effect } = pinKeypadSubmit(pinState, digits);
      setPinState(next);
      if (effect?.kind === "submit") {
        // Match — fire the Server Action. Render-pass success step
        // immediately so the user sees feedback while the action runs (the
        // redirect will replace this view). The NumericKeypad internally
        // refs the latest `onSubmit`, so re-binding this callback per
        // `pinState` change is safe (no listener churn).
        if (submittingRef.current) return;
        submittingRef.current = true;
        setStep(3);
        // Microtask submit so React commits the new step first.
        queueMicrotask(() => {
          formRef.current?.requestSubmit();
        });
      }
    },
    [pinState]
  );

  const handleClose = useCallback(() => {
    handleOpenChange(false);
  }, [handleOpenChange]);

  const previewName = trimmedName.length > 0 ? trimmedName : "Display name";

  // The footer's primary CTA gesture varies per step:
  //   Step 1 — advances to step 2 (the keypad takes over from there).
  //   Step 2 — visually labels "Set PIN" but the actual submit is owned by
  //            the keypad (the keypad's own confirm button submits the
  //            entered digits). The footer CTA stays disabled in step 2 so
  //            the keypad is the single source of truth for the gesture.
  //   Step 3 — hidden (the success body renders its own Done close button).
  const primaryDisabled = step === 1 ? !canProceedFromDetails : true;
  const primaryOnClick = step === 1 ? () => setStep(2) : undefined;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        data-slot="add-staff-wizard-sheet"
        className="add-staff-wizard-sheet flex flex-col gap-0 p-0"
      >
        <SheetHeader className="border-b border-border">
          <SheetTitle>Add staff member</SheetTitle>
          <SheetDescription>
            Add a new person to the salon roster and give them a 4-digit PIN to log in.
          </SheetDescription>
        </SheetHeader>

        {/* Three step pills (Details · Set PIN · Done). Presentational —
            clicking does NOT navigate; the wizard advances on form submit
            only. Active state binds to the current step index. */}
        <div className="add-staff-wizard-pills" data-slot="add-staff-wizard-pills">
          {WIZARD_STEPS.map(({ key, label }, i) => {
            const n = (i + 1) as WizardStep;
            const isActive = step === n;
            const isDone = step > n;
            return (
              <span
                key={key}
                data-step={key}
                data-active={isActive ? "true" : "false"}
                data-done={isDone ? "true" : "false"}
                className="add-staff-wizard-pill"
              >
                {isDone ? (
                  <Check
                    size={14}
                    strokeWidth={1.5}
                    aria-hidden="true"
                    className="add-staff-wizard-pill-icon"
                  />
                ) : null}
                {label}
              </span>
            );
          })}
        </div>

        {/* Step body. T068 collapsed the legacy `data-slot="add-staff-wizard"`
            duplicate slot here — the SheetContent above already exposes
            `add-staff-wizard-sheet` for presence-only assertions, and
            `staff.spec.ts` was migrated to that selector. The body keeps
            its semantic class name for CSS-only targeting. */}
        <div
          className="add-staff-wizard-body"
          data-slot-body="add-staff-wizard-body"
          data-step={step}
        >
          {step === 1 ? (
            <Step1Details
              displayName={displayName}
              setDisplayName={setDisplayName}
              role={role}
              setRole={setRole}
              colorToken={colorToken}
              setColorToken={setColorToken}
              roleOptions={roleOptions}
            />
          ) : null}

          {step === 2 ? (
            <Step2Pin
              name={trimmedName}
              pinPhase={pinState.phase}
              pinError={pinState.error}
              onSubmit={handleKeypadSubmit}
              onCancel={handleClose}
            />
          ) : null}

          {step === 3 ? (
            <Step3Done
              displayName={trimmedName}
              role={role}
              colorToken={colorToken}
              onDone={handleClose}
              submitting={submitting}
            />
          ) : null}

          {/* Live preview card — mirrors {display_name, role, color_token}
              in real time across all three steps. Stays in the body flow
              under the form so the 420px sheet stacks cleanly on mobile. */}
          <div
            className="add-staff-wizard-preview"
            data-slot="add-staff-wizard-preview"
            aria-label="Roster preview"
          >
            <InitialsAvatar name={previewName} colorToken={colorToken} size={40} />
            <div className="add-staff-wizard-preview-text">
              <span className="add-staff-wizard-preview-name">{previewName}</span>
              <span className="add-staff-wizard-preview-subtitle">
                {ROLE_LABEL[role]} ·{" "}
                {step === 3 ? (
                  "PIN set"
                ) : (
                  <span className="staff-pin-pill staff-pin-pill--no-pin">No PIN</span>
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Sticky footer — Cancel (always) + per-step primary CTA. The
            primary's label flips through `PRIMARY_CTA_LABEL[step]`; in
            step 2 it stays disabled because the keypad owns the gesture,
            in step 3 it's hidden (the success body has its own Done). */}
        <div
          className="add-staff-wizard-footer"
          data-slot="add-staff-wizard-footer"
          data-step={step}
        >
          <button
            type="button"
            className="add-staff-wizard-footer-cancel"
            data-slot="add-staff-wizard-footer-cancel"
            onClick={handleClose}
          >
            Cancel
          </button>
          {step === 3 ? null : (
            // T068 collapsed the dual `data-slot="wizard-next"` +
            // `data-slot-test="add-staff-wizard-footer-primary"` pair to a
            // single canonical `data-slot="add-staff-wizard-footer-primary"`.
            // `staff.spec.ts` (the legacy US2 wizard test from 006) and
            // `staff-add-wizard.spec.ts` (the US7 spec) both target the
            // canonical slot.
            <button
              type="button"
              className="add-staff-wizard-footer-primary"
              data-slot="add-staff-wizard-footer-primary"
              disabled={primaryDisabled}
              onClick={primaryOnClick}
            >
              {PRIMARY_CTA_LABEL[step]}
            </button>
          )}
        </div>

        {/* Hidden form that posts to addStaff. Rendered always so the
           keypad confirm handler can call requestSubmit() reliably.
           FormPendingSignal lifts the form's pending state up so the
           visible Step3Done button can show a processing indicator. */}
        <form
          ref={formRef}
          action={addStaff}
          data-slot="add-staff-form"
          style={{ display: "none" }}
        >
          <input type="hidden" name="display_name" value={trimmedName} />
          <input type="hidden" name="role" value={role} />
          <input type="hidden" name="color_token" value={colorToken} />
          <input type="hidden" name="pin" value={pinState.enterBuf} />
          <FormPendingSignal onPendingChange={setSubmitting} />
        </form>
      </SheetContent>
    </Sheet>
  );
}

// ── Step 1 ────────────────────────────────────────────────────────────────

function Step1Details({
  displayName,
  setDisplayName,
  role,
  setRole,
  colorToken,
  setColorToken,
  roleOptions,
}: {
  displayName: string;
  setDisplayName: (v: string) => void;
  role: StudioRole;
  setRole: (r: StudioRole) => void;
  colorToken: string;
  setColorToken: (t: string) => void;
  roleOptions: StudioRole[];
}) {
  return (
    <>
      <div style={fieldStyle}>
        <label htmlFor="add-staff-name" style={labelStyle}>
          Display name
        </label>
        <input
          id="add-staff-name"
          data-slot="wizard-name-input"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="e.g. Maya Chen"
          autoFocus
          style={inputStyle}
        />
        <span style={hintStyle}>This is how they&apos;ll appear on the login screen.</span>
      </div>

      <div style={fieldStyle}>
        <label htmlFor="add-staff-role" style={labelStyle}>
          Role
        </label>
        <select
          id="add-staff-role"
          data-slot="wizard-role-select"
          value={role}
          onChange={(e) => setRole(e.target.value as StudioRole)}
          style={{ ...inputStyle, cursor: "pointer" }}
        >
          {roleOptions.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
        <span style={hintStyle}>Determines what they can access in the app.</span>
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle}>Avatar color</label>
        <ColorPicker name="color_token_preview" value={colorToken} onChange={setColorToken} />
        <span style={hintStyle}>
          Selected: {STAFF_COLOR_OPTIONS.find((o) => o.token === colorToken)?.label ?? "Color"}
        </span>
      </div>
    </>
  );
}

// ── Step 2 ────────────────────────────────────────────────────────────────

function Step2Pin({
  name,
  pinPhase,
  pinError,
  onSubmit,
  onCancel,
}: {
  name: string;
  pinPhase: PinKeypadState["phase"];
  pinError: string | null;
  onSubmit: (digits: string) => void;
  onCancel: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-4)",
        textAlign: "center",
      }}
      data-slot="wizard-pin-step"
    >
      <div>
        <h3
          style={{
            margin: 0,
            fontSize: "var(--text-base)",
            fontWeight: 600,
            color: "var(--foreground)",
          }}
        >
          {pinPhase === "enter" ? "Enter a 4-digit PIN" : "Confirm the PIN"}
        </h3>
        <p
          style={{
            margin: 0,
            marginTop: "var(--space-1)",
            fontSize: "var(--text-sm)",
            color: "var(--muted-foreground)",
          }}
        >
          {pinPhase === "enter" ? `Choose a PIN for ${name}` : "Enter the same PIN again"}
        </p>
      </div>

      <NumericKeypad
        step={pinPhase}
        errorMessage={pinError}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    </div>
  );
}

// ── Step 3 ────────────────────────────────────────────────────────────────

function Step3Done({
  displayName,
  role,
  colorToken,
  onDone,
  submitting,
}: {
  displayName: string;
  role: StudioRole;
  colorToken: string;
  onDone: () => void;
  submitting: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-4)",
        textAlign: "center",
        paddingTop: "var(--space-6)",
      }}
      data-slot="wizard-done-step"
    >
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "var(--space-12)",
          height: "var(--space-12)",
          borderRadius: "var(--radius-full)",
          background: "oklch(from var(--primary) l c h / 0.15)",
          color: "var(--primary)",
        }}
      >
        <Check size={24} strokeWidth={1.5} />
      </span>
      <div>
        <h3
          style={{
            margin: 0,
            fontSize: "var(--text-base)",
            fontWeight: 600,
            color: "var(--foreground)",
          }}
        >
          {displayName} added
        </h3>
        <p
          style={{
            margin: 0,
            marginTop: "var(--space-1)",
            fontSize: "var(--text-sm)",
            color: "var(--muted-foreground)",
          }}
        >
          {displayName} can now log in with their 4-digit PIN.
        </p>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
          padding: "var(--space-3) var(--space-4)",
          background: "var(--muted)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md, 8px)",
          width: "100%",
        }}
      >
        <InitialsAvatar name={displayName} colorToken={colorToken} size={40} />
        <div style={{ display: "flex", flexDirection: "column", textAlign: "left" }}>
          <span style={{ fontSize: "var(--text-sm)", fontWeight: 500 }}>{displayName}</span>
          <span style={{ fontSize: "var(--text-xs)", color: "var(--muted-foreground)" }}>
            {ROLE_LABEL[role]} · PIN set
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={onDone}
        data-slot="wizard-done-button"
        disabled={submitting}
        style={{
          marginTop: "var(--space-2)",
          padding: "var(--space-2) var(--space-4)",
          background: "var(--primary)",
          color: "var(--primary-foreground)",
          border: "none",
          borderRadius: "var(--radius-sm)",
          fontSize: "var(--text-sm)",
          fontWeight: 600,
          cursor: submitting ? "default" : "pointer",
          opacity: submitting ? 0.6 : 1,
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--space-2)",
          transition: "opacity 150ms var(--ease-out)",
        }}
      >
        {submitting ? (
          <>
            <Spinner size={16} strokeWidth={2} />
            Adding…
          </>
        ) : (
          "Done"
        )}
      </button>
    </div>
  );
}

// Suppress unused warning — kept exported for the future US3 panel that
// will share the X icon for its dialog footer.
void X;

// ── Shared styles ─────────────────────────────────────────────────────────

const fieldStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: "var(--space-1)",
};

const labelStyle = {
  fontSize: "var(--text-sm)",
  fontWeight: 500,
  color: "var(--foreground)",
};

const inputStyle = {
  padding: "var(--space-2) var(--space-3)",
  background: "var(--card)",
  color: "var(--foreground)",
  border: "1px solid var(--input)",
  borderRadius: "var(--radius-xs)",
  fontSize: "var(--text-sm)",
  outline: "none",
};

const hintStyle = {
  fontSize: "var(--text-xs)",
  color: "var(--muted-foreground)",
};
