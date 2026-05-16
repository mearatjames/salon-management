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

import { KeyRound, Power, PowerOff, ShieldCheck, Trash2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { ChangePinModal } from "@/components/lacquer/staff/change-pin-modal.client";
import { ColorPicker, STAFF_COLOR_OPTIONS } from "@/components/lacquer/staff/color-picker";
import { ConfirmDialog } from "@/components/lacquer/staff/confirm-dialog";
import { StaffAvatar } from "@/components/lacquer/staff/staff-avatar";

import type { RosterStaff } from "@/app/(studio)/settings/staff/_types";
import {
  computeTargetPermissions,
  roleOptionsFor,
  type StudioRole,
} from "@/app/(studio)/settings/staff/permissions";
import {
  deactivateStaff,
  reactivateStaff,
  removeStaff,
  updateStaff,
} from "@/app/(studio)/settings/staff/actions";

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
  "id" | "display_name" | "role" | "color_token" | "active" | "pin_set"
>;

export type EditPanelProps = {
  viewer: { id: string; role: StudioRole };
  target: EditPanelTarget;
  isLastOwner: boolean;
};

type Draft = {
  display_name: string;
  role: StudioRole;
  color_token: string;
  active: boolean;
};

export function EditPanel({ viewer, target, isLastOwner }: EditPanelProps) {
  const [draft, setDraft] = useState<Draft>({
    display_name: target.display_name,
    role: target.role,
    color_token: target.color_token,
    active: target.active,
  });

  // PIN modal open state (US4). Modal owns its own phase/buffer state and
  // posts to the `setStaffPin` Server Action on confirm-match.
  const [pinModalOpen, setPinModalOpen] = useState(false);

  // Lifecycle confirm-dialog open state (US5). Only one dialog can be open
  // at a time, so a single `confirmOpen: "deactivate" | "remove" | null` is
  // enough. Reactivate has no confirm dialog — per ui.contract.md § Dialog
  // strings only the destructive variants (Deactivate + Remove) confirm.
  const [confirmOpen, setConfirmOpen] = useState<"deactivate" | "remove" | null>(null);

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

  // Dirty + name-validity gates for Save.
  const trimmedName = draft.display_name.trim();
  const isDirty =
    draft.display_name !== target.display_name ||
    draft.role !== target.role ||
    draft.color_token !== target.color_token ||
    draft.active !== target.active;
  const hasValidName = trimmedName.length >= 2;
  const canSave = isDirty && hasValidName && perms.canEditAnyField;

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
      <form
        action={updateStaff}
        data-slot="staff-edit-panel"
        data-staff-id={target.id}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-5)",
        }}
      >
        <input type="hidden" name="staff_id" value={target.id} />

        {/* Header: live preview avatar + name */}
        <header
          data-slot="edit-panel-header"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
          }}
        >
          <StaffAvatar
            name={trimmedName || target.display_name}
            colorToken={draft.color_token}
            size={48}
          />
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span
              data-slot="edit-panel-preview-name"
              style={{
                fontSize: "var(--text-base)",
                fontWeight: 600,
                color: "var(--foreground)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {trimmedName || target.display_name}
            </span>
            <span
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--muted-foreground)",
              }}
            >
              {ROLE_LABEL[draft.role]} ·{" "}
              {STAFF_COLOR_OPTIONS.find((o) => o.token === draft.color_token)?.label ?? "Color"}
            </span>
          </div>
        </header>

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

        {/* Active toggle. Switch is uncontrolled-ish; we wire it manually to
          our draft state and emit a hidden input so FormData picks up the
          checked state regardless of which Switch implementation is used. */}
        <div style={fieldStyle}>
          <label
            htmlFor="edit-staff-active"
            style={{
              ...labelStyle,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "var(--space-3)",
            }}
          >
            <span>Active</span>
            <span
              style={{
                fontSize: "var(--text-xs)",
                fontWeight: 400,
                color: "var(--muted-foreground)",
              }}
              title={fieldTooltip(perms.canToggleActive, undefined)}
            >
              <Switch
                id="edit-staff-active"
                data-slot="edit-panel-active-switch"
                checked={draft.active}
                onCheckedChange={(next: boolean) => setDraft((d) => ({ ...d, active: next }))}
                disabled={!perms.canToggleActive}
                aria-label="Active"
              />
            </span>
          </label>
          <input
            type="hidden"
            name="active"
            // Standard form-coercion: "on" when checked, omitted when off.
            // We use a hidden input gated on draft.active so the FormData
            // matches what a real <input type="checkbox" name="active"> would
            // produce.
            value={draft.active ? "on" : ""}
          />
        </div>

        {/* PIN row (read-only). US4 wires the Set PIN / Change button. */}
        <div
          data-slot="edit-panel-pin-row"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--space-3)",
            padding: "var(--space-3)",
            background: "var(--muted)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md, 8px)",
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-2)",
              color: "var(--muted-foreground)",
              fontSize: "var(--text-sm)",
            }}
          >
            {target.pin_set ? (
              <>
                <ShieldCheck size={16} strokeWidth={1.5} aria-hidden="true" />
                <span>4-digit PIN set</span>
              </>
            ) : (
              <>
                <KeyRound size={16} strokeWidth={1.5} aria-hidden="true" />
                <span>
                  No PIN set ·{" "}
                  <span style={{ color: "var(--destructive)" }}>Required to log in</span>
                </span>
              </>
            )}
          </span>
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

        {/* Footer: two rows. Top row is the lifecycle pair (Deactivate or
          Reactivate on the left, Remove on the right, space-between).
          Bottom row is the primary Save changes CTA, right-aligned as the
          final action. Deactivate and Remove open confirm dialogs (US5
          destructive variants); Reactivate is a single click — no confirm
          per ui.contract.md. */}
        <footer
          data-slot="edit-panel-footer"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-5)",
            marginTop: "var(--space-2)",
            paddingTop: "var(--space-4)",
            borderTop: "1px solid var(--border)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "var(--space-3)",
            }}
          >
            {target.active ? (
              <button
                type="button"
                data-slot="edit-panel-deactivate"
                onClick={() => setConfirmOpen("deactivate")}
                disabled={!perms.canDeactivate}
                title={lifecycleTooltip({
                  perms,
                  flag: perms.canDeactivate,
                  selfMessage: TOOLTIP.selfRemove,
                  enabledMessage: TOOLTIP.deactivate,
                })}
                style={perms.canDeactivate ? activeLinkButtonStyle : linkButtonStyle}
              >
                <PowerOff size={16} strokeWidth={1.5} aria-hidden="true" />
                <span>Deactivate</span>
              </button>
            ) : (
              // Reactivate is a single-click action — no confirm dialog. The
              // hidden <form action={reactivateStaff}> is rendered as a sibling
              // of the updateStaff form (nested forms = invalid HTML) and
              // submitted via the button below.
              <button
                type="submit"
                form="staff-reactivate-form"
                data-slot="edit-panel-reactivate"
                disabled={!perms.canReactivate}
                title={lifecycleTooltip({
                  perms,
                  flag: perms.canReactivate,
                  selfMessage: TOOLTIP.selfRoleActive,
                  enabledMessage: TOOLTIP.reactivate,
                })}
                style={perms.canReactivate ? activeLinkButtonStyle : linkButtonStyle}
              >
                <Power size={16} strokeWidth={1.5} aria-hidden="true" />
                <span>Reactivate</span>
              </button>
            )}
            <button
              type="button"
              data-slot="edit-panel-remove"
              onClick={() => setConfirmOpen("remove")}
              disabled={!perms.canRemove}
              title={lifecycleTooltip({
                perms,
                flag: perms.canRemove,
                selfMessage: TOOLTIP.selfRemove,
                enabledMessage: TOOLTIP.remove,
              })}
              style={
                perms.canRemove
                  ? { ...activeLinkButtonStyle, color: "var(--destructive)" }
                  : { ...linkButtonStyle, color: "var(--destructive)" }
              }
            >
              <Trash2 size={16} strokeWidth={1.5} aria-hidden="true" />
              <span>Remove</span>
            </button>
          </div>

          <button
            type="submit"
            data-slot="edit-panel-save"
            disabled={!canSave}
            style={{
              alignSelf: "flex-end",
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
        </footer>
      </form>

      {/* Sibling form for the single-click Reactivate path. Rendered outside
        the updateStaff <form> so we don't nest forms (invalid HTML). The
        Reactivate button above sets `form="staff-reactivate-form"` so its
        type=submit dispatches into this form rather than updateStaff. */}
      <form
        id="staff-reactivate-form"
        action={reactivateStaff}
        data-slot="edit-panel-reactivate-form"
        style={{ display: "none" }}
      >
        <input type="hidden" name="staff_id" value={target.id} />
      </form>

      {/* PIN modal — rendered as a sibling of the updateStaff form so its
        own hidden <form action={setStaffPin}> isn't nested inside another
        form (invalid HTML). The Dialog uses a Portal at runtime so the
        DOM placement is fine either way; this keeps the React tree clean. */}
      <ChangePinModal
        open={pinModalOpen}
        onOpenChange={setPinModalOpen}
        staffId={target.id}
        staffName={target.display_name}
        mode={target.pin_set ? "change" : "set"}
      />

      {/* Deactivate confirm dialog — destructive submit lives inside the
        slotted <form action={deactivateStaff}>. */}
      <ConfirmDialog
        open={confirmOpen === "deactivate"}
        onOpenChange={(next) => setConfirmOpen(next ? "deactivate" : null)}
        variant="deactivate"
        name={target.display_name}
      >
        <form action={deactivateStaff} data-slot="confirm-dialog-form" data-variant="deactivate">
          <input type="hidden" name="staff_id" value={target.id} />
          <button type="submit" data-slot="confirm-dialog-submit" style={destructiveButtonStyle}>
            Deactivate
          </button>
        </form>
      </ConfirmDialog>

      {/* Remove confirm dialog — same shape, different action + label. */}
      <ConfirmDialog
        open={confirmOpen === "remove"}
        onOpenChange={(next) => setConfirmOpen(next ? "remove" : null)}
        variant="remove"
        name={target.display_name}
      >
        <form action={removeStaff} data-slot="confirm-dialog-form" data-variant="remove">
          <input type="hidden" name="staff_id" value={target.id} />
          <button type="submit" data-slot="confirm-dialog-submit" style={destructiveButtonStyle}>
            Remove
          </button>
        </form>
      </ConfirmDialog>
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

const linkButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-1)",
  padding: "var(--space-1) var(--space-2)",
  background: "transparent",
  color: "var(--muted-foreground)",
  border: "none",
  fontSize: "var(--text-sm)",
  fontWeight: 500,
  whiteSpace: "nowrap" as const,
  cursor: "not-allowed",
  opacity: 0.6,
};

/** Enabled variant of the link button — same layout, full opacity, pointer cursor. */
const activeLinkButtonStyle = {
  ...linkButtonStyle,
  color: "var(--foreground)",
  cursor: "pointer",
  opacity: 1,
};

/** Destructive submit button (Deactivate / Remove confirm CTA). Uses the
 *  `--destructive` / `--destructive-foreground` tokens per Constitution
 *  Principle I and ui.contract.md § Token discipline. */
const destructiveButtonStyle = {
  padding: "var(--space-2) var(--space-3)",
  background: "var(--destructive)",
  color: "var(--destructive-foreground)",
  border: "none",
  borderRadius: "var(--radius-sm)",
  fontSize: "var(--text-sm)",
  fontWeight: 600,
  cursor: "pointer",
  transition: "opacity 150ms var(--ease-out)",
};
