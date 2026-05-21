"use client";

// EditPanel — the right-column edit form for a selected staff member.
// Client island; owns the draft state. Re-keyed on `?selected=` change (the
// page passes `key={target.id}` so React tears down and remounts on every
// row switch, satisfying FR-022 "drafts discarded silently when switching
// rows" without a confirmation prompt.
//
// Per-field disabled state comes from `computeTargetPermissions` — the
// matrix evaluation runs once in the page Server Component, the result is
// passed through as a prop. The panel never re-derives permissions on the
// client; the matrix is the trust boundary.
//
// Submit posts the full draft (all 4 fields + staff_id) to `updateStaff`.
// The Server Action computes the diff and only writes the changed columns,
// so we don't need to track which fields the user touched here.
//
// US3 stubs: Set PIN / Change (PIN row button), Deactivate/Reactivate, and
// Remove are rendered as disabled buttons. They get wired in US4 (PIN) and
// US5 (lifecycle); rendering them now keeps the panel layout stable so the
// US3 e2e doesn't break when the buttons gain handlers later.

import { useMemo, useState } from "react";

import { KeyRound, ShieldCheck } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { ChangePinModal } from "@/components/lacquer/staff/change-pin-modal.client";
import { ColorPicker } from "@/components/lacquer/staff/color-picker";
import { DangerZone } from "@/components/lacquer/staff/danger-zone.client";
import { PayDeductionsSection } from "@/components/lacquer/staff/pay-deductions-section.client";
import { PayrollRatesSection } from "@/components/lacquer/staff/payroll-rates-section.client";
import { InitialsAvatar } from "@/components/lacquer/initials-avatar";
import { StatusBadges } from "@/components/lacquer/staff/status-badges";

import type { RosterStaff } from "@/app/(studio)/settings/staff/_types";
import type { SupplyCatalogForStaff } from "@/app/(studio)/settings/staff/_supply-catalog";
import {
  canSaveDraft as canSaveDraftGate,
  draftFromTarget,
  isNameValid,
  previewName,
  type EditDraft,
} from "@/app/(studio)/settings/staff/_save-gate";
import {
  computeTargetPermissions,
  roleOptionsFor,
  type StudioRole,
} from "@/app/(studio)/settings/staff/permissions";
import { updateStaff } from "@/app/(studio)/settings/staff/actions";

const ROLE_LABEL: Record<StudioRole, string> = {
  owner: "Owner",
  manager: "Manager",
  technician: "Tech",
  front_desk: "Front desk",
};

const TOOLTIP = {
  selfRoleActive: "You can't change your own role or active state.",
  selfRemove: "You can't deactivate or remove yourself.",
  lastOwner: "At least one owner must remain.",
  managerOwner: "Only owners can edit owner accounts.",
  setPin: "Set a 4-digit PIN for this staff member.",
  changePin: "Change this staff member's 4-digit PIN.",
  deactivate: "Deactivate this staff member.",
  reactivate: "Reactivate this staff member.",
  remove: "Remove this staff member from the roster.",
} as const;

/** Per ui.contract.md § Permission-driven disabled state — pick the right tooltip
 *  for a disabled lifecycle control based on which gate fired. */
function lifecycleTooltip(args: {
  perms: ReturnType<typeof computeTargetPermissions>;
  flag: boolean;
  selfMessage: string;
  enabledMessage: string;
}): string {
  const { perms, flag, selfMessage, enabledMessage } = args;
  if (flag) return enabledMessage;
  if (perms.isSelf) return selfMessage;
  if (perms.isLastOwner) return TOOLTIP.lastOwner;
  if (!perms.canEditAnyField) return TOOLTIP.managerOwner;
  return enabledMessage;
}

export type EditPanelTarget = Pick<
  RosterStaff,
  | "id"
  | "display_name"
  | "role"
  | "color_token"
  | "active"
  | "pin_set"
  // 023-staff-payout-exemptions § US6 — rendered as "Added MMM YYYY" in the
  // new panel-profile header card. Format via Intl.DateTimeFormat so locale
  // changes propagate without touching this file.
  | "created_at"
  // 023-staff-payout-exemptions — consumed by <PayDeductionsSection> in US1.
  | "card_fee_exempt"
  | "supply_mode"
  | "supply_except"
  // 047-payroll-page § US5 — consumed by <PayrollRatesSection>.
  | "service_commission_pct"
  | "tip_split_pct"
  | "check_portion_cents"
>;

export type EditPanelProps = {
  viewer: { id: string; role: StudioRole };
  target: EditPanelTarget;
  isLastOwner: boolean;
  /** 023-staff-payout-exemptions — consumed by <PayDeductionsSection> in US1.
   *  Optional in Phase 2 so the page can pass it through before the section
   *  component is wired (T019). */
  supplyCatalog?: SupplyCatalogForStaff;
};

// Empty fallback so the panel still renders (without the per-type picker)
// when the page omits `supplyCatalog` — e.g. while transitioning between
// rows before the Server Component returns the new catalog.
const EMPTY_SUPPLY_CATALOG: SupplyCatalogForStaff = { types: [] };

export function EditPanel({ viewer, target, isLastOwner, supplyCatalog }: EditPanelProps) {
  const supplyCatalogResolved = supplyCatalog ?? EMPTY_SUPPLY_CATALOG;
  const [draft, setDraft] = useState<EditDraft>(() => draftFromTarget(target));

  // PIN modal open state (US4). Modal owns its own phase/buffer state and
  // posts to the `setStaffPin` Server Action on confirm-match.
  const [pinModalOpen, setPinModalOpen] = useState(false);

  // 023 § US6 — lifecycle confirm-dialog state now lives inside <DangerZone>.
  // The destructive buttons + dialogs + reactivate sibling form moved into
  // that component as part of the panel-sectioning restructure (FR-028).

  const perms = useMemo(
    () =>
      computeTargetPermissions({
        operator: { id: viewer.id, role: viewer.role },
        target: {
          id: target.id,
          role: target.role,
          active: target.active,
        },
        isLastOwner,
      }),
    [viewer.id, viewer.role, target.id, target.role, target.active, isLastOwner]
  );

  const roleOptions = useMemo(() => roleOptionsFor(viewer.role), [viewer.role]);

  // Tooltips per ui.contract.md § Permission-driven disabled state.
  const fieldTooltip = (flag: boolean, fallback: string | undefined): string | undefined => {
    if (flag) return undefined;
    if (perms.isSelf) return TOOLTIP.selfRoleActive;
    if (perms.isLastOwner) return TOOLTIP.lastOwner;
    if (!perms.canEditAnyField) return TOOLTIP.managerOwner;
    return fallback;
  };

  // Dirty + name-validity gates for Save. The pure helpers in `_save-gate.ts`
  // back this — extracted so US3(b/c) drop out of the e2e suite per the
  // pruning audit (docs/e2e-pruning-audit.md § staff.spec.ts).
  const hasValidName = isNameValid(draft.display_name);
  const canSave = canSaveDraftGate({ draft, target, canEditAnyField: perms.canEditAnyField });

  // 023 § US6 — "Added MMM YYYY" subtitle in the new panel-profile header.
  // Locale-aware via Intl.DateTimeFormat with year + short-month parts so
  // changing the user locale propagates without touching this string.
  const addedLabel = useMemo(() => {
    try {
      const formatted = new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
      }).format(new Date(target.created_at));
      return `Added ${formatted}`;
    } catch {
      return "";
    }
  }, [target.created_at]);

  return (
    <>
      {!perms.canEditAnyField ? (
        <Alert
          data-slot="edit-panel-manager-owner-banner"
          style={{
            background: "var(--muted)",
            marginBottom: "var(--space-3)",
          }}
        >
          <AlertDescription>Only owners can edit owner accounts.</AlertDescription>
        </Alert>
      ) : null}

      {/* 023 § US6 — panel-profile header card. Lives ABOVE the form so the
        avatar + name + role + added date + status badges sit visually on
        their own surface; the form below carries the editable sections. */}
      <header className="staff-panel-profile-header" data-slot="staff-panel-profile-header">
        <InitialsAvatar
          name={previewName(draft.display_name, target.display_name)}
          colorToken={draft.color_token}
          size={64}
        />
        <div className="staff-panel-profile-header-body">
          <span data-slot="staff-panel-profile-name" className="staff-panel-profile-name">
            {previewName(draft.display_name, target.display_name)}
          </span>
          <span data-slot="staff-panel-profile-subtitle" className="staff-panel-profile-subtitle">
            {ROLE_LABEL[draft.role]}
            {addedLabel ? <> · {addedLabel}</> : null}
          </span>
          {/* 023 § US3 — <StatusBadges> moved into the profile header for US6. */}
          <StatusBadges
            active={draft.active}
            cardFeeExempt={draft.card_fee_exempt}
            supplyMode={draft.supply_mode}
          />
        </div>
      </header>

      <form
        action={updateStaff}
        data-slot="staff-edit-panel"
        data-staff-id={target.id}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-4)",
        }}
      >
        <input type="hidden" name="staff_id" value={target.id} />

        {/* ── Identity section ─────────────────────────────────────────── */}
        <section
          className="staff-panel-section"
          data-section="identity"
          data-slot="staff-panel-section-identity"
        >
          <div className="staff-panel-section-eyebrow">Identity</div>
          <div className="staff-panel-section-body">
            {/* Display name */}
            <div style={fieldStyle}>
              <label htmlFor="edit-staff-name" style={labelStyle}>
                Display name
              </label>
              <input
                id="edit-staff-name"
                name="display_name"
                type="text"
                data-slot="edit-panel-name-input"
                value={draft.display_name}
                onChange={(e) => setDraft((d) => ({ ...d, display_name: e.target.value }))}
                disabled={!perms.canEditDisplayName}
                title={fieldTooltip(perms.canEditDisplayName, undefined)}
                style={{
                  ...inputStyle,
                  cursor: perms.canEditDisplayName ? "text" : "not-allowed",
                  opacity: perms.canEditDisplayName ? 1 : 0.6,
                }}
              />
              {!hasValidName ? (
                <span
                  data-slot="edit-panel-name-hint"
                  style={{ ...hintStyle, color: "var(--destructive)" }}
                >
                  Name must be at least 2 characters.
                </span>
              ) : null}
            </div>

            {/* Role */}
            <div style={fieldStyle}>
              <label htmlFor="edit-staff-role" style={labelStyle}>
                Role
              </label>
              <select
                id="edit-staff-role"
                name="role"
                data-slot="edit-panel-role-select"
                value={draft.role}
                onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value as StudioRole }))}
                disabled={!perms.canEditRole}
                title={fieldTooltip(perms.canEditRole, undefined)}
                style={{
                  ...inputStyle,
                  cursor: perms.canEditRole ? "pointer" : "not-allowed",
                  opacity: perms.canEditRole ? 1 : 0.6,
                }}
              >
                {/* Always include the target's current role so the select renders
                its current value even if the operator's roleOptionsFor doesn't
                include it (e.g., a manager viewing an owner). */}
                {roleOptions.includes(target.role) ? null : (
                  <option value={target.role}>{ROLE_LABEL[target.role]}</option>
                )}
                {roleOptions.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </div>

            {/* Avatar color */}
            <div style={fieldStyle}>
              <label style={labelStyle}>Avatar color</label>
              <ColorPicker
                name="color_token"
                value={draft.color_token}
                onChange={(token) => setDraft((d) => ({ ...d, color_token: token }))}
                disabled={!perms.canEditColor}
              />
            </div>
          </div>
        </section>

        {/* ── Access section ───────────────────────────────────────────── */}
        <section
          className="staff-panel-section"
          data-section="access"
          data-slot="staff-panel-section-access"
        >
          <div className="staff-panel-section-eyebrow">Access</div>

          {/* Active row — flush, no leading icon, switch on the right. */}
          <div className="staff-panel-row" data-slot="edit-panel-active-row">
            <div className="staff-panel-row-text">
              <label
                htmlFor="edit-staff-active"
                className="staff-panel-row-label"
                style={{ cursor: perms.canToggleActive ? "pointer" : "not-allowed" }}
              >
                Active
              </label>
              <p className="staff-panel-row-subtitle">
                {draft.active ? "Can log in to the studio" : "Locked out of the studio"}
              </p>
            </div>
            <span title={fieldTooltip(perms.canToggleActive, undefined)}>
              <Switch
                id="edit-staff-active"
                data-slot="edit-panel-active-switch"
                checked={draft.active}
                onCheckedChange={(next: boolean) => setDraft((d) => ({ ...d, active: next }))}
                disabled={!perms.canToggleActive}
                aria-label="Active"
              />
            </span>
            <input
              type="hidden"
              name="active"
              // Standard form-coercion: "on" when checked, omitted when off.
              value={draft.active ? "on" : ""}
            />
          </div>

          {/* PIN row — flush, leading shield/key icon, Change/Set PIN button. */}
          <div className="staff-panel-row staff-panel-row--last" data-slot="edit-panel-pin-row">
            <span className="staff-panel-row-icon" aria-hidden="true">
              {target.pin_set ? (
                <ShieldCheck size={16} strokeWidth={1.5} style={{ color: "var(--success)" }} />
              ) : (
                <KeyRound size={16} strokeWidth={1.5} style={{ color: "var(--warning)" }} />
              )}
            </span>
            <div className="staff-panel-row-text">
              <span className="staff-panel-row-label">
                {target.pin_set ? (
                  "4-digit PIN set"
                ) : (
                  <>
                    No PIN · <span style={{ color: "var(--destructive)" }}>Required to log in</span>
                  </>
                )}
              </span>
            </div>
            <button
              type="button"
              data-slot="edit-panel-pin-button"
              onClick={() => setPinModalOpen(true)}
              disabled={!perms.canSetPin}
              title={
                perms.canSetPin
                  ? target.pin_set
                    ? TOOLTIP.changePin
                    : TOOLTIP.setPin
                  : TOOLTIP.managerOwner
              }
              style={{
                padding: "var(--space-1) var(--space-3)",
                background: "transparent",
                color: perms.canSetPin ? "var(--foreground)" : "var(--muted-foreground)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                fontSize: "var(--text-sm)",
                fontWeight: 500,
                cursor: perms.canSetPin ? "pointer" : "not-allowed",
                opacity: perms.canSetPin ? 1 : 0.6,
                transition: "background 150ms var(--ease-out)",
              }}
            >
              {target.pin_set ? "Change" : "Set PIN"}
            </button>
          </div>
        </section>

        {/* ── Pay & deductions section ─────────────────────────────────── */}
        {/* The section card carries the data-section attribute for the US6
          ordering assertion; <PayDeductionsSection> owns its own internal
          header ("Pay & deductions" h3) so we don't add a second one here
          to avoid double-titling. */}
        <div
          className="staff-panel-section staff-panel-section--pay-deductions"
          data-section="pay-deductions"
          data-slot="staff-panel-section-pay-deductions"
        >
          <PayDeductionsSection
            target={target}
            supplyCatalog={supplyCatalogResolved}
            draft={{
              cardFeeExempt: draft.card_fee_exempt,
              supplyMode: draft.supply_mode,
              supplyExcept: draft.supply_except,
            }}
            onDraftChange={(next) => {
              setDraft((d) => ({
                ...d,
                ...(typeof next.cardFeeExempt === "boolean"
                  ? { card_fee_exempt: next.cardFeeExempt }
                  : {}),
                ...(next.supplyMode ? { supply_mode: next.supplyMode } : {}),
                ...(next.supplyExcept ? { supply_except: next.supplyExcept } : {}),
              }));
            }}
            disabled={!perms.canEditAnyField}
          />
        </div>

        {/* ── Payroll rates section (047-payroll-page § US5) ───────────────── */}
        {/* <PayrollRatesSection> owns its own internal header so the wrapper
          carries only the data-section attribute for the panel ordering. */}
        <div
          className="staff-panel-section staff-panel-section--payroll-rates"
          data-section="payroll-rates"
          data-slot="staff-panel-section-payroll-rates"
        >
          <PayrollRatesSection
            target={target}
            draft={{
              serviceCommissionPct: draft.service_commission_pct,
              tipSplitPct: draft.tip_split_pct,
              checkPortionCents: draft.check_portion_cents,
            }}
            onDraftChange={(next) => {
              setDraft((d) => ({
                ...d,
                ...(typeof next.serviceCommissionPct === "number"
                  ? { service_commission_pct: next.serviceCommissionPct }
                  : {}),
                ...(typeof next.tipSplitPct === "number"
                  ? { tip_split_pct: next.tipSplitPct }
                  : {}),
                ...(typeof next.checkPortionCents === "number"
                  ? { check_portion_cents: next.checkPortionCents }
                  : {}),
              }));
            }}
            canEdit={perms.canEditPayrollRates}
          />
        </div>

        {/* ── Save row ─────────────────────────────────────────────────── */}
        {/* Full-width primary Save changes button, isolated as its own
          data-section so the US6 ordering test can locate it between
          Pay & deductions and Danger zone. */}
        <div data-section="save" data-slot="staff-panel-section-save">
          <button
            type="submit"
            data-slot="edit-panel-save"
            disabled={!canSave}
            style={{
              width: "100%",
              padding: "var(--space-2) var(--space-4)",
              background: "var(--primary)",
              color: "var(--primary-foreground)",
              border: "none",
              borderRadius: "var(--radius-sm)",
              fontSize: "var(--text-sm)",
              fontWeight: 600,
              whiteSpace: "nowrap",
              cursor: canSave ? "pointer" : "not-allowed",
              opacity: canSave ? 1 : 0.5,
              transition: "opacity 150ms var(--ease-out)",
            }}
          >
            Save changes
          </button>
        </div>
      </form>

      {/* ── Danger zone ──────────────────────────────────────────────── */}
      {/* Rendered as a sibling of the updateStaff <form> — DangerZone owns
        its own forms (reactivate sibling + the two ConfirmDialog forms),
        so wrapping it inside the updateStaff form would nest forms
        (invalid HTML). Per FR-028 every destructive control lives here. */}
      <DangerZone
        targetId={target.id}
        targetName={target.display_name}
        targetActive={target.active}
        canDeactivate={perms.canDeactivate}
        canReactivate={perms.canReactivate}
        canRemove={perms.canRemove}
        tooltips={{
          deactivate: lifecycleTooltip({
            perms,
            flag: perms.canDeactivate,
            selfMessage: TOOLTIP.selfRemove,
            enabledMessage: TOOLTIP.deactivate,
          }),
          reactivate: lifecycleTooltip({
            perms,
            flag: perms.canReactivate,
            selfMessage: TOOLTIP.selfRoleActive,
            enabledMessage: TOOLTIP.reactivate,
          }),
          remove: lifecycleTooltip({
            perms,
            flag: perms.canRemove,
            selfMessage: TOOLTIP.selfRemove,
            enabledMessage: TOOLTIP.remove,
          }),
        }}
      />

      {/* PIN modal — sibling of the updateStaff form so its own hidden
        <form action={setStaffPin}> isn't nested inside another form
        (invalid HTML). Dialog renders via Portal at runtime. */}
      <ChangePinModal
        open={pinModalOpen}
        onOpenChange={setPinModalOpen}
        staffId={target.id}
        staffName={target.display_name}
        mode={target.pin_set ? "change" : "set"}
      />
    </>
  );
}

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

// 023 § US6 — linkButtonStyle / activeLinkButtonStyle / destructiveButtonStyle
// moved into `<DangerZone>` (the only remaining caller) when the lifecycle
// buttons + confirm dialogs were extracted out of this file.
