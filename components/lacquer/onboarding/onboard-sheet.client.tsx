"use client";

// OnboardSheet — onboarding sheet supporting BOTH modes (Quick + Thorough).
// Client island.
//
// Adapted from `design-system/prototypes/onboarding/OnboardSheet.jsx`.
// Built on shadcn `Sheet`. The mode pill in the header toggles between
// the single-screen Quick form and the 4-step Thorough wizard. Identity
// fields (name / email / role) are preserved across the toggle per
// FR-011 — they're lifted to the sheet level rather than per-mode.
//
// Submit binds to the `inviteUser` server action via the native form
// action prop. The action `revalidatePath` + `redirect`s with
// `?toast=invited&name=...`, so the OnboardingToaster fires the success
// toast and the new pending row is rendered on the same paint as the
// sheet's close.
//
// Token discipline: every value resolves to `styles/tokens.css`. Form
// elements use `.onb-form-*` classes from `styles/onboarding.css`. No
// inline hex / off-scale spacing.

import { ArrowLeft, Check, Info, Key, Link as LinkIcon, Send } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { inviteUser } from "@/app/(studio)/settings/onboarding/actions";
import { ROLE_PERMISSIONS } from "@/lib/auth/role-permissions";
import type { StudioRole } from "@/lib/auth/session";

import { EmailPreview } from "./email-preview";
import { InlinePin } from "./inline-pin.client";
import { PermissionCard } from "./permission-card";
import { RoleTilePicker } from "./role-tile-picker.client";

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const STAFF_COLOR_TOKENS = [
  "--avatar-rose",
  "--avatar-blue",
  "--avatar-green",
  "--avatar-amber",
  "--avatar-purple",
  "--avatar-teal",
  "--avatar-orange",
  "--avatar-slate",
] as const;

type Mode = "quick" | "thorough";
type InviteMethod = "magic_link" | "password";

export type OnboardSheetProps = {
  /** Controlled open state owned by the parent CTA island. */
  open: boolean;
  /** Open/close handler — invoked by Cancel + the sheet's built-in close. */
  onOpenChange: (next: boolean) => void;
};

export function OnboardSheet({ open, onOpenChange }: OnboardSheetProps) {
  const [mode, setMode] = useState<Mode>("quick");

  // Identity (shared between modes per FR-011).
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StudioRole>("technician");

  // Thorough-only.
  const [color, setColor] = useState<string>("--avatar-green");
  const [method, setMethod] = useState<InviteMethod>("magic_link");
  const [pin, setPin] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);

  const trimmedName = displayName.trim();
  const trimmedEmail = email.trim();
  const nameValid = trimmedName.length >= 2;
  const emailValid = EMAIL_SHAPE.test(trimmedEmail);

  const canSubmitQuick = nameValid && emailValid && !submitting;
  const canProceedStep1 = nameValid;
  const canProceedStep2 = emailValid;

  // Reset the form state when the sheet closes so a re-open lands on the
  // empty Quick form rather than the last attempt.
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        setDisplayName("");
        setEmail("");
        setRole("technician");
        setMode("quick");
        setColor("--avatar-green");
        setMethod("magic_link");
        setPin(null);
        setStep(1);
        setSubmitting(false);
      }
      onOpenChange(next);
    },
    [onOpenChange]
  );

  const handleModeChange = useCallback((next: Mode) => {
    setMode(next);
    if (next === "thorough") setStep(1);
  }, []);

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        data-slot="onboard-sheet"
        className="flex flex-col gap-0 p-0 sm:max-w-[520px]"
      >
        <SheetHeader className="onb-sheet-header">
          <SheetTitle>Onboard a user</SheetTitle>
          <SheetDescription className="sr-only">
            {mode === "quick"
              ? "Send an invite — fast. Email + role is enough to get them in."
              : "Walk a 4-step wizard to set identity, invite method, PIN, and review."}
          </SheetDescription>
          <ModePill mode={mode} setMode={handleModeChange} />
        </SheetHeader>

        <form
          ref={formRef}
          action={inviteUser}
          onSubmit={() => setSubmitting(true)}
          data-slot="onboard-form"
          className="onb-sheet-body-form"
        >
          <input type="hidden" name="mode" value={mode} />
          <input type="hidden" name="role" value={role} />
          {/*
            display_name + email live as form-level hidden inputs so they
            survive the Thorough wizard's step transitions. The visible
            inputs in QuickBody / ThoroughBody step 1+2 only drive React
            state; when the wizard reaches step 4 (Review), steps 1+2 are
            unmounted, so their visible inputs are no longer in the DOM
            and would be excluded from FormData on submit. The hidden
            inputs here always carry the current state into the action.
          */}
          <input type="hidden" name="display_name" value={displayName} />
          <input type="hidden" name="email" value={email} />
          {mode === "thorough" && (
            <>
              <input type="hidden" name="color_token" value={color} />
              <input type="hidden" name="method" value={method} />
              {pin && <input type="hidden" name="pin" value={pin} />}
            </>
          )}

          {mode === "quick" ? (
            <QuickBody
              displayName={displayName}
              setDisplayName={setDisplayName}
              email={email}
              setEmail={setEmail}
              role={role}
              setRole={setRole}
            />
          ) : (
            <ThoroughBody
              step={step}
              setStep={setStep}
              displayName={displayName}
              setDisplayName={setDisplayName}
              email={email}
              setEmail={setEmail}
              role={role}
              setRole={setRole}
              color={color}
              setColor={setColor}
              method={method}
              setMethod={setMethod}
              pin={pin}
              setPin={setPin}
            />
          )}

          <div className="onb-sheet-footer">
            {mode === "thorough" && step > 1 ? (
              <button
                type="button"
                onClick={() => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3) : 1))}
                data-slot="onb-back"
                className="onb-btn onb-btn-ghost"
              >
                <ArrowLeft size={16} strokeWidth={1.5} aria-hidden />
                Back
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleOpenChange(false)}
                data-slot="onb-cancel"
                className="onb-btn onb-btn-outline"
              >
                Cancel
              </button>
            )}

            {mode === "quick" && (
              <button
                type="submit"
                data-slot="onb-submit"
                className="onb-btn onb-btn-primary"
                disabled={!canSubmitQuick}
                aria-disabled={!canSubmitQuick}
              >
                <Send size={16} strokeWidth={1.5} aria-hidden />
                Send invite
              </button>
            )}

            {mode === "thorough" && step < 4 && (
              <button
                type="button"
                data-slot="onb-continue"
                className="onb-btn onb-btn-primary"
                disabled={
                  (step === 1 && !canProceedStep1) || (step === 2 && !canProceedStep2) || submitting
                }
                onClick={() => setStep((s) => (s < 4 ? s + 1 : s) as 1 | 2 | 3 | 4)}
              >
                Continue
              </button>
            )}

            {mode === "thorough" && step === 4 && (
              <button
                type="submit"
                data-slot="onb-submit"
                className="onb-btn onb-btn-primary"
                disabled={submitting}
                aria-disabled={submitting}
              >
                <Send size={16} strokeWidth={1.5} aria-hidden />
                Send invite
              </button>
            )}
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

// ── Quick body ─────────────────────────────────────────────────────────────

type QuickBodyProps = {
  displayName: string;
  setDisplayName: (v: string) => void;
  email: string;
  setEmail: (v: string) => void;
  role: StudioRole;
  setRole: (v: StudioRole) => void;
};

function QuickBody({
  displayName,
  setDisplayName,
  email,
  setEmail,
  role,
  setRole,
}: QuickBodyProps) {
  return (
    <div className="onb-sheet-body">
      <div className="onb-form-heading">
        <div className="onb-form-heading-title">Send an invite — fast</div>
        <div className="onb-form-heading-sub">
          Email + role is enough to get them in. They&apos;ll set their own PIN and avatar on first
          login.
        </div>
      </div>

      <div className="onb-form-row">
        <label className="onb-form-label" htmlFor="onb-name">
          Full name
        </label>
        <input
          id="onb-name"
          data-slot="onb-name-input"
          name="display_name"
          type="text"
          className="onb-form-input"
          placeholder="e.g. Hana Soto"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          autoFocus
          autoComplete="off"
        />
      </div>

      <div className="onb-form-row">
        <label className="onb-form-label" htmlFor="onb-email">
          Work email
        </label>
        <input
          id="onb-email"
          data-slot="onb-email-input"
          name="email"
          type="email"
          className="onb-form-input"
          placeholder="hana@tangnails.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="off"
        />
        <span className="onb-form-hint">We&apos;ll send the invite link here.</span>
      </div>

      <div className="onb-form-row">
        <span className="onb-form-label">Role</span>
        <RoleTilePicker value={role} onChange={setRole} />
      </div>

      <div className="onb-form-tip" role="note">
        <Info size={16} strokeWidth={1.5} aria-hidden />
        <span>
          <b>Quick mode</b> sends a magic-link invite and defers PIN + avatar. Need to set those
          now? Switch to <b>Thorough</b> above.
        </span>
      </div>
    </div>
  );
}

// ── Thorough body (4-step wizard) ──────────────────────────────────────────

type ThoroughBodyProps = {
  step: 1 | 2 | 3 | 4;
  setStep: (s: 1 | 2 | 3 | 4) => void;
  displayName: string;
  setDisplayName: (v: string) => void;
  email: string;
  setEmail: (v: string) => void;
  role: StudioRole;
  setRole: (v: StudioRole) => void;
  color: string;
  setColor: (v: string) => void;
  method: InviteMethod;
  setMethod: (v: InviteMethod) => void;
  pin: string | null;
  setPin: (v: string | null) => void;
};

function ThoroughBody({
  step,
  setStep,
  displayName,
  setDisplayName,
  email,
  setEmail,
  role,
  setRole,
  color,
  setColor,
  method,
  setMethod,
  pin,
  setPin,
}: ThoroughBodyProps) {
  const firstName = displayName.trim().split(" ")[0] || "them";

  return (
    <div className="onb-sheet-body">
      <StepBar step={step} />

      {step === 1 && (
        <>
          <div className="onb-wiz-heading">
            <div className="onb-form-heading-title">Who are you onboarding?</div>
            <div className="onb-form-heading-sub">
              Their role determines what they can do in the app. You can change it anytime in Staff.
            </div>
          </div>

          <div className="onb-form-row">
            <label className="onb-form-label" htmlFor="onb-name">
              Full name
            </label>
            <input
              id="onb-name"
              data-slot="onb-name-input"
              name="display_name"
              type="text"
              className="onb-form-input"
              placeholder="e.g. Hana Soto"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoFocus
              autoComplete="off"
            />
          </div>

          <div className="onb-form-row">
            <span className="onb-form-label">Role</span>
            <RoleTilePicker value={role} onChange={setRole} />
          </div>

          <div className="onb-form-row">
            <span className="onb-form-label">Avatar color</span>
            <div className="onb-color-grid" role="radiogroup" aria-label="Avatar color">
              {STAFF_COLOR_TOKENS.map((token) => {
                const selected = color === token;
                return (
                  <button
                    key={token}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={token.replace("--avatar-", "")}
                    data-slot="onb-color-swatch"
                    data-color-token={token}
                    data-selected={selected ? "true" : "false"}
                    className="onb-color-swatch"
                    style={{ background: `var(${token})` }}
                    onClick={() => setColor(token)}
                  />
                );
              })}
            </div>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <div className="onb-wiz-heading">
            <div className="onb-form-heading-title">Send {firstName} an invite</div>
            <div className="onb-form-heading-sub">
              Their email becomes their login. They&apos;ll receive a one-time link to finish
              setting up their account.
            </div>
          </div>

          <div className="onb-form-row">
            <label className="onb-form-label" htmlFor="onb-email">
              Work email
            </label>
            <input
              id="onb-email"
              data-slot="onb-email-input"
              name="email"
              type="email"
              className="onb-form-input"
              placeholder="hana@tangnails.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
              autoFocus
            />
          </div>

          <div className="onb-form-row">
            <span className="onb-form-label">Invite method</span>
            <div className="onb-method-list" role="radiogroup" aria-label="Invite method">
              <button
                type="button"
                role="radio"
                aria-checked={method === "magic_link"}
                data-slot="onb-method-tile"
                data-method="magic_link"
                data-selected={method === "magic_link" ? "true" : "false"}
                className="onb-method-tile"
                onClick={() => setMethod("magic_link")}
              >
                <span className="onb-method-icon" aria-hidden>
                  <LinkIcon size={16} strokeWidth={1.5} />
                </span>
                <span className="onb-method-text">
                  <span className="onb-method-title">Magic link</span>
                  <span className="onb-method-sub">
                    One-tap sign-in via email. Best for trusted devices.
                  </span>
                </span>
                {method === "magic_link" && (
                  <Check size={16} strokeWidth={1.5} className="onb-method-check" aria-hidden />
                )}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={method === "password"}
                data-slot="onb-method-tile"
                data-method="password"
                data-selected={method === "password" ? "true" : "false"}
                className="onb-method-tile"
                onClick={() => setMethod("password")}
              >
                <span className="onb-method-icon" aria-hidden>
                  <Key size={16} strokeWidth={1.5} />
                </span>
                <span className="onb-method-text">
                  <span className="onb-method-title">Set up a password</span>
                  <span className="onb-method-sub">
                    They pick a password on first visit, then sign in normally.
                  </span>
                </span>
                {method === "password" && (
                  <Check size={16} strokeWidth={1.5} className="onb-method-check" aria-hidden />
                )}
              </button>
            </div>
          </div>

          <EmailPreview recipientName={displayName} recipientEmail={email} method={method} />
        </>
      )}

      {step === 3 && (
        <>
          <div className="onb-wiz-heading">
            <div className="onb-form-heading-title">Set a login PIN</div>
            <div className="onb-form-heading-sub">
              Once {firstName} signs in, they&apos;ll also need a 4-digit PIN to act as themselves
              on shared iPads. You can set it now, or let them choose.
            </div>
          </div>

          {pin ? (
            <div className="onb-pin-set-confirm">
              <div className="onb-pin-set-badge" aria-hidden>
                <Check size={20} strokeWidth={1.5} />
              </div>
              <div className="onb-pin-set-title">PIN set</div>
              <div className="onb-pin-set-sub">
                {firstName} can sign in and use this PIN immediately.
              </div>
              <button
                type="button"
                className="onb-btn onb-btn-ghost"
                onClick={() => setPin(null)}
                data-slot="onb-pin-change"
              >
                Change PIN
              </button>
            </div>
          ) : (
            <InlinePin
              recipientFirstName={firstName}
              onConfirmed={(p) => {
                setPin(p);
                setStep(4);
              }}
              onSkip={() => {
                setPin(null);
                setStep(4);
              }}
            />
          )}
        </>
      )}

      {step === 4 && (
        <>
          <div className="onb-wiz-heading">
            <div className="onb-form-heading-title">Review &amp; send</div>
            <div className="onb-form-heading-sub">
              We&apos;ll create their staff record, send the invite email, and wait for them to
              accept.
            </div>
          </div>

          <div className="onb-review-list">
            <ReviewRow label="Person" value={displayName || "—"} />
            <ReviewRow label="Role" value={ROLE_PERMISSIONS[role].label} />
            <ReviewRow label="Email" value={email || "—"} mono />
            <ReviewRow
              label="Invite method"
              value={method === "magic_link" ? "Magic link" : "Password setup"}
            />
            <ReviewRow
              label="Login PIN"
              value={pin ? "Set" : "Will set on first login"}
              tone={pin ? "success" : "muted"}
            />
          </div>

          <PermissionCard role={role} />
        </>
      )}
    </div>
  );
}

// ── Step bar ───────────────────────────────────────────────────────────────

function StepBar({ step }: { step: 1 | 2 | 3 | 4 }) {
  const items: ReadonlyArray<{ n: 1 | 2 | 3 | 4; label: string }> = [
    { n: 1, label: "Identity" },
    { n: 2, label: "Invite" },
    { n: 3, label: "PIN" },
    { n: 4, label: "Review" },
  ];
  return (
    <div className="onb-step-bar" role="list" aria-label="Wizard steps" data-slot="onb-step-bar">
      {items.map((s) => (
        <div
          key={s.n}
          className="onb-step-bar-item"
          data-slot="onb-step-bar-item"
          data-step={s.n}
          data-active={step === s.n ? "true" : "false"}
          data-done={step > s.n ? "true" : "false"}
          role="listitem"
        >
          <span className="onb-step-bar-dot" aria-hidden>
            {step > s.n ? <Check size={12} strokeWidth={2} /> : s.n}
          </span>
          <span className="onb-step-bar-label">{s.label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Review row ─────────────────────────────────────────────────────────────

type ReviewRowProps = {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "default" | "muted" | "success";
};

function ReviewRow({ label, value, mono, tone = "default" }: ReviewRowProps) {
  return (
    <div className="onb-review-row" data-slot="onb-review-row">
      <span className="onb-review-label">{label}</span>
      <span className="onb-review-value" data-mono={mono ? "true" : undefined} data-tone={tone}>
        {value}
      </span>
    </div>
  );
}

// ── Mode pill (quick / thorough) ───────────────────────────────────────────

type ModePillProps = {
  mode: Mode;
  setMode: (next: Mode) => void;
};

function ModePill({ mode, setMode }: ModePillProps) {
  return (
    <div className="onb-mode-pill" role="tablist" aria-label="Onboard mode">
      <button
        type="button"
        role="tab"
        aria-selected={mode === "quick"}
        data-slot="onb-mode-pill-quick"
        data-selected={mode === "quick" ? "true" : "false"}
        className="onb-mode-pill-option"
        onClick={() => setMode("quick")}
      >
        Quick
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "thorough"}
        data-slot="onb-mode-pill-thorough"
        data-selected={mode === "thorough" ? "true" : "false"}
        className="onb-mode-pill-option"
        onClick={() => setMode("thorough")}
      >
        Thorough
      </button>
    </div>
  );
}
