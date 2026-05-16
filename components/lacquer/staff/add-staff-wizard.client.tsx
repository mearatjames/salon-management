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
import { StaffAvatar } from "@/components/lacquer/staff/staff-avatar";
import { roleOptionsFor, type StudioRole } from "@/app/(studio)/settings/staff/permissions";
import { addStaff } from "@/app/(studio)/settings/staff/actions";

const ROLE_LABEL: Record<StudioRole, string> = {
  owner: "Owner",
  manager: "Manager",
  technician: "Tech",
  front_desk: "Front desk",
};

const STEP_LABELS = ["Details", "Set PIN", "Done"] as const;

type WizardStep = 1 | 2 | 3;
type PinPhase = "enter" | "confirm";

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

  // PIN state — buffers, phase, error
  const [pinPhase, setPinPhase] = useState<PinPhase>("enter");
  const [enterBuf, setEnterBuf] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);

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
        setPinPhase("enter");
        setEnterBuf("");
        setPinError(null);
        submittingRef.current = false;
      }
      onOpenChange(next);
    },
    [defaultRole, onOpenChange]
  );

  const trimmedName = displayName.trim();
  const canProceedFromDetails = trimmedName.length >= 2;

  const handleKeypadSubmit = useCallback(
    (digits: string) => {
      if (pinPhase === "enter") {
        // Stash and advance to confirm. The keypad resets its buffer when
        // `step` (its prop) flips.
        setEnterBuf(digits);
        setPinError(null);
        setPinPhase("confirm");
        return;
      }

      // Confirm phase.
      if (digits !== enterBuf) {
        setPinError("PINs didn't match. Try again.");
        setEnterBuf("");
        setPinPhase("enter");
        return;
      }

      // Match — fire the Server Action. Render-pass success step
      // immediately so the user sees feedback while the action runs (the
      // redirect will replace this view).
      if (submittingRef.current) return;
      submittingRef.current = true;
      setStep(3);
      // Microtask submit so React commits the new step first.
      queueMicrotask(() => {
        formRef.current?.requestSubmit();
      });
    },
    [pinPhase, enterBuf]
  );

  const handleClose = useCallback(() => {
    handleOpenChange(false);
  }, [handleOpenChange]);

  const previewName = trimmedName.length > 0 ? trimmedName : "Display name";

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        data-slot="add-staff-wizard"
        className="flex flex-col gap-0 p-0 sm:max-w-[420px]"
      >
        <SheetHeader className="border-b border-border">
          <SheetTitle>Add staff member</SheetTitle>
          <SheetDescription>
            Add a new person to the salon roster and give them a 4-digit PIN to log in.
          </SheetDescription>
        </SheetHeader>

        {/* Step indicator bar */}
        <div
          data-slot="wizard-step-bar"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
            padding: "var(--space-3) var(--space-4)",
            borderBottom: "1px solid var(--border)",
            background: "var(--card)",
          }}
        >
          {STEP_LABELS.map((label, i) => {
            const n = (i + 1) as WizardStep;
            const isDone = step > n;
            const isActive = step === n;
            return (
              <div
                key={label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-2)",
                  opacity: isActive || isDone ? 1 : 0.5,
                }}
              >
                <span
                  data-slot={`wizard-step-dot-${n}`}
                  data-active={isActive ? "true" : "false"}
                  data-done={isDone ? "true" : "false"}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "var(--space-5)",
                    height: "var(--space-5)",
                    borderRadius: "var(--radius-full)",
                    background: isDone
                      ? "var(--success, var(--primary))"
                      : isActive
                        ? "var(--primary)"
                        : "var(--border)",
                    color:
                      isDone || isActive ? "var(--primary-foreground)" : "var(--muted-foreground)",
                    fontSize: "var(--text-xs)",
                    fontWeight: 600,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {isDone ? <Check size={12} strokeWidth={1.5} aria-hidden="true" /> : n}
                </span>
                <span
                  style={{
                    fontSize: "var(--text-xs)",
                    fontWeight: isActive ? 500 : 400,
                    color: isActive ? "var(--foreground)" : "var(--muted-foreground)",
                  }}
                >
                  {label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Step body */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-4)",
            padding: "var(--space-4)",
            flex: 1,
            overflowY: "auto",
          }}
          data-slot="wizard-body"
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
              previewName={previewName}
            />
          ) : null}

          {step === 2 ? (
            <Step2Pin
              name={trimmedName}
              pinPhase={pinPhase}
              pinError={pinError}
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
            />
          ) : null}
        </div>

        {/* Footer — varies per step */}
        {step === 1 ? (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "var(--space-2)",
              padding: "var(--space-3) var(--space-4)",
              borderTop: "1px solid var(--border)",
              background: "var(--card)",
            }}
          >
            <button
              type="button"
              onClick={handleClose}
              data-slot="wizard-cancel"
              style={{
                padding: "var(--space-2) var(--space-3)",
                background: "transparent",
                color: "var(--muted-foreground)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                fontSize: "var(--text-sm)",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              data-slot="wizard-next"
              disabled={!canProceedFromDetails}
              onClick={() => setStep(2)}
              style={{
                padding: "var(--space-2) var(--space-3)",
                background: "var(--primary)",
                color: "var(--primary-foreground)",
                border: "none",
                borderRadius: "var(--radius-sm)",
                fontSize: "var(--text-sm)",
                fontWeight: 600,
                cursor: canProceedFromDetails ? "pointer" : "not-allowed",
                opacity: canProceedFromDetails ? 1 : 0.5,
                transition: "opacity 150ms var(--ease-out)",
              }}
            >
              Next: set PIN
            </button>
          </div>
        ) : null}

        {/* Hidden form that posts to addStaff. Rendered always so the
           keypad confirm handler can call requestSubmit() reliably. */}
        <form
          ref={formRef}
          action={addStaff}
          data-slot="add-staff-form"
          style={{ display: "none" }}
        >
          <input type="hidden" name="display_name" value={trimmedName} />
          <input type="hidden" name="role" value={role} />
          <input type="hidden" name="color_token" value={colorToken} />
          <input type="hidden" name="pin" value={enterBuf} />
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
  previewName,
}: {
  displayName: string;
  setDisplayName: (v: string) => void;
  role: StudioRole;
  setRole: (r: StudioRole) => void;
  colorToken: string;
  setColorToken: (t: string) => void;
  roleOptions: StudioRole[];
  previewName: string;
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

        {/* Live preview — avatar + name + role */}
        <div
          data-slot="wizard-avatar-preview"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
            marginTop: "var(--space-2)",
            padding: "var(--space-3)",
            background: "var(--muted)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md, 8px)",
          }}
        >
          <StaffAvatar name={previewName} colorToken={colorToken} size={32} />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: "var(--text-sm)", fontWeight: 500 }}>{previewName}</span>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--muted-foreground)" }}>
              {ROLE_LABEL[role]} ·{" "}
              {STAFF_COLOR_OPTIONS.find((o) => o.token === colorToken)?.label ?? "Color"}
            </span>
          </div>
        </div>
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
  pinPhase: PinPhase;
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
}: {
  displayName: string;
  role: StudioRole;
  colorToken: string;
  onDone: () => void;
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
        <StaffAvatar name={displayName} colorToken={colorToken} size={40} />
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
        style={{
          marginTop: "var(--space-2)",
          padding: "var(--space-2) var(--space-4)",
          background: "var(--primary)",
          color: "var(--primary-foreground)",
          border: "none",
          borderRadius: "var(--radius-sm)",
          fontSize: "var(--text-sm)",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Done
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
