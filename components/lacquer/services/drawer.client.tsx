"use client";

// Drawer — the off-canvas right-side drawer for Add / Edit. Client island.
//
// State machine per `contracts/ui.contract.md § 2`:
//   closed → add-clean → add-dirty → confirm-discard | save
//   closed → edit-clean → edit-dirty → confirm-discard | save | archive/restore
//
// The drawer ALWAYS mounts so its CSS slide animation can run on open and
// close. Visibility flips via the `mode` prop (closed = off-canvas + hidden).
//
// Submit:
//   - Mode "add": the Save button posts to `addService` via a `<form action>`.
//   - Mode "edit": the Save button posts to `updateService`. Enabled once the
//     in-memory draft diverges from the loaded baseline. The Server Action
//     short-circuits with `?error=no_changes` if the FormData diff is empty.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useRouter } from "next/navigation";

import { ROLE_LABEL } from "./_role-label";
import {
  addService,
  restoreService,
  updateService,
} from "@/app/(studio)/settings/services/actions";
import { formatPriceLabel } from "@/app/(studio)/settings/services/_format";
import type {
  AssignableStaff,
  ServiceAssignment,
  ServiceDraftBaseline,
} from "@/app/(studio)/settings/services/_types";
import { canWriteCatalog, type StudioRole } from "@/app/(studio)/settings/services/permissions";

import { ArchiveDialog } from "./archive-dialog.client";
import { DiscardChangesDialog } from "./discard-changes-dialog.client";
import {
  ServiceForm,
  hasFormErrors,
  makeDefaultDraft,
  makeDraftFromBaseline,
  type ServiceDraft,
} from "./service-form.client";
import { StaffAssignmentList } from "./staff-assignment-list.client";

export type DrawerMode = "closed" | "add" | "edit";

export type DrawerProps = {
  mode: DrawerMode;
  baseline: ServiceDraftBaseline | null;
  assignableStaff: AssignableStaff[];
  categories: string[];
  operatorRole: StudioRole;
};

/** Deep equality between two assignment lists, order-insensitive. */
function assignmentsEqual(a: ServiceAssignment[], b: ServiceAssignment[]): boolean {
  if (a.length !== b.length) return false;
  const indexB = new Map(b.map((row) => [row.staff_id, row.duration_min_override]));
  for (const row of a) {
    if (!indexB.has(row.staff_id)) return false;
    if (indexB.get(row.staff_id) !== row.duration_min_override) return false;
  }
  return true;
}

/** Field-by-field diff between draft and baseline. */
function isDraftDirty(draft: ServiceDraft, baseline: ServiceDraftBaseline | null): boolean {
  if (baseline === null) {
    // Add mode: dirty as soon as ANY field differs from the factory default
    // (so the discard guard fires only when the operator typed something).
    const fresh = makeDefaultDraft();
    return (
      draft.name !== fresh.name ||
      draft.category !== fresh.category ||
      draft.duration_min !== fresh.duration_min ||
      draft.price !== fresh.price ||
      draft.color_token !== fresh.color_token ||
      draft.taxable !== fresh.taxable ||
      draft.variable_price !== fresh.variable_price ||
      draft.price_from !== fresh.price_from ||
      draft.price_to !== fresh.price_to ||
      draft.variable_price_note !== fresh.variable_price_note ||
      draft.assignments.length !== fresh.assignments.length
    );
  }
  // Edit mode: compare against the saved snapshot.
  const baselineDraft = makeDraftFromBaseline(baseline);
  return (
    draft.name !== baselineDraft.name ||
    draft.category !== baselineDraft.category ||
    draft.duration_min !== baselineDraft.duration_min ||
    draft.price !== baselineDraft.price ||
    draft.color_token !== baselineDraft.color_token ||
    draft.taxable !== baselineDraft.taxable ||
    draft.variable_price !== baselineDraft.variable_price ||
    draft.price_from !== baselineDraft.price_from ||
    draft.price_to !== baselineDraft.price_to ||
    draft.variable_price_note !== baselineDraft.variable_price_note ||
    !assignmentsEqual(draft.assignments, baselineDraft.assignments)
  );
}

export function Drawer({ mode, baseline, assignableStaff, categories, operatorRole }: DrawerProps) {
  const router = useRouter();
  const isOpen = mode !== "closed";
  const canWrite = canWriteCatalog(operatorRole);
  const readOnly = !canWrite;

  // Initial draft: empty for Add, hydrated from baseline for Edit.
  const initialDraft = useMemo<ServiceDraft>(() => {
    if (mode === "edit" && baseline) return makeDraftFromBaseline(baseline);
    return makeDefaultDraft();
  }, [mode, baseline]);

  const [draft, setDraft] = useState<ServiceDraft>(initialDraft);
  const [discardOpen, setDiscardOpen] = useState(false);
  // Archive confirmation overlay state — only relevant in Edit mode when the
  // operator clicks the "Archive service" button. Reset whenever the drawer
  // hydrates a new baseline (see hydration effect below).
  const [archiveOpen, setArchiveOpen] = useState(false);

  // Track which `mode|baseline.id` combo the current draft was hydrated for.
  // When the drawer flips Add → Edit (after Save) or Edit row → Edit other
  // row, we rebuild the draft from the new baseline. We use a string key so
  // referential equality on `baseline` doesn't matter.
  const hydrationKey = mode === "edit" && baseline ? `edit:${baseline.id}` : mode;
  const lastKeyRef = useRef<string>(hydrationKey);
  useEffect(() => {
    if (lastKeyRef.current !== hydrationKey) {
      lastKeyRef.current = hydrationKey;
      setDraft(initialDraft);
      setDiscardOpen(false);
      setArchiveOpen(false);
    }
  }, [hydrationKey, initialDraft]);

  const handlePatch = useCallback((patch: Partial<ServiceDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
  }, []);

  const handleToggleStaff = useCallback((staffId: string, ticked: boolean) => {
    setDraft((d) => {
      if (ticked) {
        if (d.assignments.some((a) => a.staff_id === staffId)) return d;
        return {
          ...d,
          assignments: [...d.assignments, { staff_id: staffId, duration_min_override: null }],
        };
      }
      return {
        ...d,
        assignments: d.assignments.filter((a) => a.staff_id !== staffId),
      };
    });
  }, []);

  const handleOverrideChange = useCallback((staffId: string, raw: string) => {
    setDraft((d) => {
      const trimmed = raw.trim();
      const parsed = trimmed.length === 0 ? null : Number.parseInt(trimmed, 10);
      const next = Number.isFinite(parsed) ? parsed : null;
      return {
        ...d,
        assignments: d.assignments.map((a) =>
          a.staff_id === staffId ? { staff_id: staffId, duration_min_override: next } : a
        ),
      };
    });
  }, []);

  const isDirty = useMemo(() => isDraftDirty(draft, baseline), [draft, baseline]);
  const draftHasErrors = useMemo(() => hasFormErrors(draft), [draft]);

  // Close gestures (backdrop / Escape / Cancel). Routes through the discard
  // guard when the draft is dirty; otherwise closes silently by stripping
  // the `?adding=`/`?selected=` URL params.
  const navigateClosed = useCallback(() => {
    router.push("/settings/services");
  }, [router]);

  const attemptClose = useCallback(() => {
    if (readOnly || !isDirty) {
      navigateClosed();
      return;
    }
    setDiscardOpen(true);
  }, [readOnly, isDirty, navigateClosed]);

  const handleDiscard = useCallback(() => {
    setDiscardOpen(false);
    navigateClosed();
  }, [navigateClosed]);

  const handleDiscardCancel = useCallback(() => {
    setDiscardOpen(false);
  }, []);

  // ESC key — only when the drawer is open.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        attemptClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, attemptClose]);

  // The form's action toggles based on mode. Add mode is fully wired in
  // Phase 4; Edit mode targets the stub `updateService` and will be
  // completed in Phase 5.
  const formAction = mode === "add" ? addService : updateService;

  // Save button state:
  //   Add mode  — enabled once the operator typed something (isDirty) and
  //               can write the catalog. The Server Action re-validates.
  //   Edit mode — enabled once the draft diverges from the loaded baseline
  //               (Phase 5: `updateService` consumes the diff and short-
  //               circuits with `?error=no_changes` if nothing differs).
  // Save is disabled while the draft has fixable shape errors (e.g. inverted
  // bounds in the variable-price branch — US5). Empty required fields still
  // submit so the Server Action can surface the right `?error=` code; only
  // inline-fixable errors gate the button.
  const canSubmit = !readOnly && isOpen && isDirty && !draftHasErrors;

  // Title flips by mode.
  const title = mode === "add" ? "Add service" : "Edit service";
  const primaryLabel = mode === "add" ? "Save service" : "Save changes";

  // Live preview line: the color dot + the current name (with a placeholder
  // when empty) and the current category. Kept short per the orchestrator
  // hint ("skip if it adds complexity beyond a 10-line block").
  const previewName = draft.name.trim().length > 0 ? draft.name : "New service";
  const previewPrice = formatPriceLabel({
    price_cents: 0,
    variable_price: draft.variable_price,
    price_from_cents:
      draft.variable_price && draft.price_from.trim().length > 0
        ? Number.parseInt(draft.price_from.replace(".", ""), 10) || 0
        : null,
    price_to_cents:
      draft.variable_price && draft.price_to.trim().length > 0
        ? Number.parseInt(draft.price_to.replace(".", ""), 10) || 0
        : null,
  });

  return (
    <>
      {/* Backdrop. Only renders when open so off-canvas state doesn't catch
          pointer events. */}
      {isOpen ? (
        <div
          data-slot="services-drawer-backdrop"
          onClick={attemptClose}
          style={{
            position: "fixed",
            inset: 0,
            background: "color-mix(in srgb, var(--foreground) 12%, transparent)",
            zIndex: 50,
            transition: "opacity var(--duration-fast) var(--ease-out)",
          }}
        />
      ) : null}

      <aside
        className="services-drawer"
        data-slot="services-drawer"
        data-mode={mode}
        data-dirty={isDirty ? "true" : "false"}
        role="dialog"
        aria-label={mode === "edit" ? "Edit service" : "Add service"}
        aria-hidden={!isOpen}
        style={{
          zIndex: 60,
          transform: isOpen ? "translateX(0)" : "translateX(100%)",
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? "auto" : "none",
        }}
      >
        {/* Header: title + live preview */}
        <header
          data-slot="services-drawer-header"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-2)",
            paddingBottom: "var(--space-3)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <h2
            data-slot="services-drawer-title"
            style={{
              margin: 0,
              fontSize: "var(--text-lg)",
              fontWeight: 600,
              color: "var(--foreground)",
            }}
          >
            {title}
          </h2>
          <div
            data-slot="services-drawer-preview"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                display: "inline-block",
                width: "var(--space-4)",
                height: "var(--space-4)",
                borderRadius: "var(--radius-full)",
                background: `var(${draft.color_token})`,
                border: "1px solid var(--border)",
              }}
            />
            <span
              style={{
                fontSize: "var(--text-sm)",
                fontWeight: 500,
                color: "var(--foreground)",
              }}
            >
              {previewName}
            </span>
            <span
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--muted-foreground)",
              }}
            >
              {draft.category || "Uncategorized"} · {previewPrice}
            </span>
          </div>
        </header>

        {/* Single form wrapping the field stack + assignment list + footer.
            Save button is `type=submit` with its `formAction` set on the
            button itself; React 19 Server Actions accept that and dispatch
            the correct action per mode. */}
        <form
          data-slot="services-drawer-form"
          action={formAction}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-4)",
            flex: 1,
            minHeight: 0,
          }}
        >
          {/* Edit-mode hidden inputs: service_id so the server action knows
              which row to update. Phase 5 expands the FormData payload. */}
          {mode === "edit" && baseline ? (
            <input type="hidden" name="service_id" value={baseline.id} />
          ) : null}

          {/* Hidden inputs for the staff assignment list — one `staff_ids[]`
              per ticked row and one `override_min[<id>]` per row that has a
              value. The form's `<input type="hidden">`s coexist with the
              other named inputs in <ServiceForm>; FormData picks them all up. */}
          {draft.assignments.map((a) => (
            <span key={a.staff_id} style={{ display: "none" }}>
              <input type="hidden" name="staff_ids[]" value={a.staff_id} />
              {a.duration_min_override !== null ? (
                <input
                  type="hidden"
                  name={`override_min[${a.staff_id}]`}
                  value={String(a.duration_min_override)}
                />
              ) : null}
            </span>
          ))}

          <ServiceForm
            baseline={baseline}
            draft={draft}
            onChange={handlePatch}
            categories={categories}
            disabled={readOnly}
          />

          <StaffAssignmentList
            assignableStaff={assignableStaff}
            draftAssignments={draft.assignments}
            onToggle={handleToggleStaff}
            onOverrideChange={handleOverrideChange}
            disabled={readOnly}
          />

          {/* Edit-mode bottom action — Archive (opens confirm dialog) or
              Restore (submits restoreService directly). Owner/manager only;
              read-only operators don't see the slot.
              The Restore button uses the `form` HTML attribute to submit a
              sibling `<form id="services-restore-form">` rendered outside
              the main form (nested forms are invalid) — see below. */}
          {canWrite && mode === "edit" && baseline ? (
            <div
              data-slot="services-drawer-bottom-action"
              data-archive-state={baseline.active ? "active" : "archived"}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-start",
                paddingTop: "var(--space-2)",
              }}
            >
              {baseline.active ? (
                <button
                  type="button"
                  data-slot="services-drawer-archive-button"
                  onClick={() => setArchiveOpen(true)}
                  style={{
                    padding: "var(--space-2) var(--space-3)",
                    background: "transparent",
                    color: "var(--destructive)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-sm)",
                    fontSize: "var(--text-sm)",
                    fontWeight: 500,
                    cursor: "pointer",
                    transition: "opacity var(--duration-fast) var(--ease-out)",
                  }}
                >
                  Archive service
                </button>
              ) : (
                <button
                  type="submit"
                  form={`services-restore-form-${baseline.id}`}
                  data-slot="services-drawer-restore-button"
                  style={{
                    padding: "var(--space-2) var(--space-3)",
                    background: "var(--primary)",
                    color: "var(--primary-foreground)",
                    border: "none",
                    borderRadius: "var(--radius-sm)",
                    fontSize: "var(--text-sm)",
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "opacity var(--duration-fast) var(--ease-out)",
                  }}
                >
                  Restore service
                </button>
              )}
            </div>
          ) : null}

          {/* Footer: Cancel + Save. */}
          <footer
            data-slot="services-drawer-footer"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "var(--space-3)",
              marginTop: "var(--space-2)",
              paddingTop: "var(--space-4)",
              borderTop: "1px solid var(--border)",
            }}
          >
            <button
              type="button"
              onClick={attemptClose}
              data-slot="services-drawer-cancel"
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
            {readOnly ? (
              <span
                data-slot="services-drawer-view-only-chip"
                style={{
                  padding: "var(--space-2) var(--space-3)",
                  background: "var(--muted)",
                  color: "var(--muted-foreground)",
                  borderRadius: "var(--radius-sm)",
                  fontSize: "var(--text-sm)",
                  fontWeight: 500,
                }}
                title={`Viewing as ${ROLE_LABEL[operatorRole]} — read-only`}
              >
                View only
              </span>
            ) : (
              <button
                type="submit"
                data-slot="services-drawer-save"
                disabled={!canSubmit}
                style={{
                  padding: "var(--space-2) var(--space-4)",
                  background: "var(--primary)",
                  color: "var(--primary-foreground)",
                  border: "none",
                  borderRadius: "var(--radius-sm)",
                  fontSize: "var(--text-sm)",
                  fontWeight: 600,
                  cursor: canSubmit ? "pointer" : "not-allowed",
                  opacity: canSubmit ? 1 : 0.5,
                  transition: "opacity var(--duration-fast) var(--ease-out)",
                }}
              >
                {primaryLabel}
              </button>
            )}
          </footer>
        </form>

        {/* Sibling form for the Restore action — referenced by the bottom
            action's "Restore service" button via the HTML `form` attribute
            (nested <form> elements are invalid). Mounted only when Edit
            mode + baseline + write access; the button only renders when
            `baseline.active === false` so this is dormant otherwise. */}
        {canWrite && mode === "edit" && baseline && !baseline.active ? (
          <form
            id={`services-restore-form-${baseline.id}`}
            action={restoreService}
            style={{ display: "none" }}
          >
            <input type="hidden" name="service_id" value={baseline.id} />
          </form>
        ) : null}
      </aside>

      <DiscardChangesDialog
        open={discardOpen}
        onCancel={handleDiscardCancel}
        onDiscard={handleDiscard}
      />

      {/* Archive confirmation — only mountable in Edit mode with a baseline
          and write access. The dialog hosts its own <form action={archiveService}>
          internally so confirming submits straight to the server action. */}
      {canWrite && mode === "edit" && baseline && baseline.active ? (
        <ArchiveDialog
          open={archiveOpen}
          serviceName={baseline.name}
          serviceId={baseline.id}
          onCancel={() => setArchiveOpen(false)}
        />
      ) : null}
    </>
  );
}
