"use client";

// EditPanel — the always-visible right-pane edit inspector for /services.
// Replaces the off-canvas drawer from 008 per 021-services-deductions
// US1. Client island.
//
// State machine per `contracts/ui.contract.md § 2`:
//   URL params              → Panel mode
//   ?selected=<id>          → 'edit' (baseline hydrated server-side; on
//                                       hydration failure → 'closed')
//   ?adding=1               → 'add'
//   neither                 → 'closed' (empty-state inspector)
//   both                    → 'edit' wins (page resolves before this island)
//
// The panel ALWAYS mounts — no fixed/absolute positioning, no backdrop, no
// body-scroll lock, no doc-level Escape handler. Mode is fed in by the
// page Server Component via the `mode` + `baseline` props.
//
// Discard guard fires on:
//   - Row-switch (clicked while draft dirty)
//   - Add-service click (clicked while draft dirty)
//   - Cancel click (Cancel resets to baseline; Discard via dialog clears it
//                   and re-navigates to the bare URL)
//
// Footer: Save (right) + Cancel (right) + Archive (left, edit-only).
// Header: 26px color swatch + name + secondary `{category} · {duration} ·
// {price}` line. No Close (X) per Clarifications Q1 / FR-002.

import { Info } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { ROLE_LABEL } from "./_role-label";
import { ArchiveDialog } from "./archive-dialog.client";
import { DiscardChangesDialog } from "./discard-changes-dialog.client";
import {
  ServiceForm,
  hasFormErrors,
  makeDefaultDraft,
  makeDraftFromBaseline,
  type ServiceDraft,
} from "./service-form.client";
import { addService, restoreService, updateService } from "@/app/(studio)/services/actions";
import { formatPriceLabel } from "@/app/(studio)/services/_format";
import type { ServiceAssignment, ServiceDraftBaseline } from "@/app/(studio)/services/_types";
import { canWriteCatalog, type StudioRole } from "@/app/(studio)/services/permissions";

export type EditPanelMode = "closed" | "add" | "edit";

export type EditPanelProps = {
  mode: EditPanelMode;
  baseline: ServiceDraftBaseline | null;
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

/**
 * Parse a dollars-string buffer into integer cents using the same
 * string-padding convention the validators use. Returns `null` when the
 * string is empty or doesn't match the non-negative decimal shape — used
 * by the dirty-detector to compare card-fee custom amounts safely.
 */
function parseDollarsToCentsOrNull(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (!/^(?:\d+|\d+\.\d{1,2}|\.\d{1,2})$/.test(trimmed)) return null;
  const [dollarsPart, centsPartRaw = ""] = trimmed.split(".");
  const dollars = parseInt(dollarsPart || "0", 10);
  const centsPart = centsPartRaw.padEnd(2, "0");
  const cents = parseInt(centsPart || "0", 10);
  const result = dollars * 100 + cents;
  if (!Number.isFinite(result) || result < 0) return null;
  return result;
}

/** Field-by-field diff between draft and baseline. Mirrors 008's drawer. */
function isDraftDirty(draft: ServiceDraft, baseline: ServiceDraftBaseline | null): boolean {
  if (baseline === null) {
    // Add mode: dirty as soon as the operator typed something.
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
      draft.assignments.length !== fresh.assignments.length ||
      // 021-services-deductions: mode flip alone counts as dirty. When mode
      // is custom AND the operator typed an amount in Add mode, that's
      // also dirty (vs the seeded `''`).
      draft.card_fee_mode !== fresh.card_fee_mode ||
      (draft.card_fee_mode === "custom" && draft.card_fee_custom_dollars.trim().length > 0) ||
      // 021-services-deductions: supply toggle flipped on alone counts as
      // dirty. Typed-but-unsubmitted dollars / label while toggle is off
      // are NOT dirty (FR-021 buffer rule).
      draft.supply_on !== fresh.supply_on
    );
  }
  const baselineDraft = makeDraftFromBaseline(baseline);
  // 021-services-deductions dirty rule: compare modes; when current mode is
  // custom, also compare parsed cents to baseline cents. Typed-but-unused
  // values when mode != custom are NOT dirty (per FR-014 buffer rule).
  let cardFeeDirty = draft.card_fee_mode !== baselineDraft.card_fee_mode;
  if (!cardFeeDirty && draft.card_fee_mode === "custom") {
    const draftCents = parseDollarsToCentsOrNull(draft.card_fee_custom_dollars);
    const baselineCents = baseline.card_fee_custom_cents;
    cardFeeDirty = draftCents !== baselineCents;
  }
  // 021-services-deductions supply dirty rule: a toggle flip is always
  // dirty. When the toggle is on in both baseline and draft, compare
  // parsed cents + trimmed label. When the toggle is off in both, typed-
  // but-unused buffer values are NOT dirty (FR-021).
  let supplyDirty = draft.supply_on !== baselineDraft.supply_on;
  if (!supplyDirty && draft.supply_on) {
    const draftCents = parseDollarsToCentsOrNull(draft.supply_amount_dollars);
    const baselineCents = baseline.supply_amount_cents;
    if (draftCents !== baselineCents) {
      supplyDirty = true;
    } else if (draft.supply_label.trim() !== (baseline.supply_label ?? "").trim()) {
      supplyDirty = true;
    }
  }
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
    !assignmentsEqual(draft.assignments, baselineDraft.assignments) ||
    cardFeeDirty ||
    supplyDirty
  );
}

type PendingNav = { kind: "row"; targetId: string } | { kind: "add" } | { kind: "close" };

export function EditPanel({ mode, baseline, categories, operatorRole }: EditPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const canWrite = canWriteCatalog(operatorRole);
  const readOnly = !canWrite;

  // Initial draft: empty for Add, hydrated from baseline for Edit, null for
  // Closed (we still allocate the state so React doesn't unmount the form
  // subtree on every mode flip — but `mode === 'closed'` short-circuits the
  // render).
  const initialDraft = useMemo<ServiceDraft>(() => {
    if (mode === "edit" && baseline) return makeDraftFromBaseline(baseline);
    return makeDefaultDraft();
  }, [mode, baseline]);

  const [draft, setDraft] = useState<ServiceDraft>(initialDraft);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [pendingNav, setPendingNav] = useState<PendingNav | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);

  // Re-hydrate when the underlying mode|baseline.id changes (e.g. parent
  // re-rendered with a new `?selected=` row). Uses a string key so referential
  // equality on `baseline` doesn't matter.
  const hydrationKey = mode === "edit" && baseline ? `edit:${baseline.id}` : mode;
  const lastKeyRef = useRef<string>(hydrationKey);
  useEffect(() => {
    if (lastKeyRef.current !== hydrationKey) {
      lastKeyRef.current = hydrationKey;
      setDraft(initialDraft);
      setDiscardOpen(false);
      setPendingNav(null);
      setArchiveOpen(false);
    }
  }, [hydrationKey, initialDraft]);

  const handlePatch = useCallback((patch: Partial<ServiceDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
  }, []);

  const isDirty = useMemo(() => isDraftDirty(draft, baseline), [draft, baseline]);
  const draftHasErrors = useMemo(() => hasFormErrors(draft), [draft]);

  // Click-interception: a list row in <CatalogList> renders an <a href="…">
  // that drives navigation. We intercept those clicks via a capture-phase
  // listener so we can fire the discard guard before the navigation runs.
  // The handler walks up to the nearest `<a data-row-href>` and, when the
  // draft is dirty, prevents the default and opens the dialog.
  //
  // We bind to the document `click` (capture: true) and consult two data
  // attributes the catalog list emits:
  //   - `[data-services-row-link]` on row anchors (target = the new selected id)
  //   - `[data-slot="services-add-button"]` on the Add button (target = add)
  // These attributes are added in T020 via the list/page surface — the panel
  // alone doesn't need them, but we look them up by attribute so the panel
  // doesn't have to reach into the list's internals.
  //
  // When the draft is clean, we leave the click alone — the native <Link>
  // navigates and the parent server component re-renders us with new props.
  useEffect(() => {
    if (mode === "closed") return; // empty state never has a dirty draft
    if (!isDirty) return;

    const onClick = (e: MouseEvent) => {
      // Only left-click without modifiers; let cmd/ctrl-click open in a new tab.
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const target = e.target;
      if (!(target instanceof Element)) return;

      const rowLink = target.closest<HTMLAnchorElement>("a[data-services-row-link]");
      if (rowLink) {
        const targetId = rowLink.getAttribute("data-services-row-link") ?? "";
        // Same-row click in 008 toggles `?selected` off → bare URL. Treat as
        // a close gesture (still discard-guarded).
        if (mode === "edit" && baseline && targetId === baseline.id) {
          e.preventDefault();
          e.stopPropagation();
          setPendingNav({ kind: "close" });
          setDiscardOpen(true);
          return;
        }
        if (targetId) {
          e.preventDefault();
          e.stopPropagation();
          setPendingNav({ kind: "row", targetId });
          setDiscardOpen(true);
          return;
        }
      }

      const addBtn = target.closest<HTMLElement>("[data-slot='services-add-button']");
      if (addBtn && addBtn.tagName === "A") {
        e.preventDefault();
        e.stopPropagation();
        setPendingNav({ kind: "add" });
        setDiscardOpen(true);
        return;
      }
    };

    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, [mode, isDirty, baseline]);

  const handleDiscardCancel = useCallback(() => {
    setDiscardOpen(false);
    setPendingNav(null);
  }, []);

  const handleDiscardConfirm = useCallback(() => {
    setDiscardOpen(false);
    if (!pendingNav) return;
    if (pendingNav.kind === "row") {
      router.push(`/services?selected=${encodeURIComponent(pendingNav.targetId)}`);
    } else if (pendingNav.kind === "add") {
      router.push(`/services?adding=1`);
    } else {
      router.push(`/services`);
    }
    setPendingNav(null);
  }, [pendingNav, router]);

  // Cancel button — same gesture as the drawer's Cancel: reset draft to
  // baseline when dirty (after confirmation), or no-op when clean.
  const handleCancel = useCallback(() => {
    if (!isDirty) {
      // Clean draft (including every read-only operator click — their draft
      // is always clean because controls are disabled): return to the empty
      // inspector. Mirrors the drawer-era Cancel that closed the overlay.
      router.push("/services");
      return;
    }
    setPendingNav({ kind: "close" });
    setDiscardOpen(true);
  }, [isDirty, router]);

  // Save button state — disabled while the draft is read-only, clean, or has
  // inline-fixable shape errors.
  const isOpen = mode !== "closed";
  const canSubmit = !readOnly && isOpen && isDirty && !draftHasErrors;
  const formAction = mode === "add" ? addService : updateService;
  const primaryLabel = mode === "add" ? "Save service" : "Save changes";

  // Discard-dialog body resolution: edit mode names the current service so
  // the operator knows what they're losing; add mode uses the "new service
  // draft" phrasing.
  const discardServiceName = useMemo(() => {
    if (mode === "edit" && baseline) return baseline.name;
    return null;
  }, [mode, baseline]);

  // ---------- Render branches ----------

  if (mode === "closed") {
    return (
      <ClosedInspector
        // Closed state can't have a discard dialog, but keep the wrapper.
        searchParams={searchParams}
      />
    );
  }

  // Edit / Add mode: render the full panel.

  // Header values
  const headerName =
    mode === "add"
      ? draft.name.trim().length > 0
        ? draft.name
        : "New service"
      : (baseline?.name ?? "Service");
  const headerCategory =
    mode === "add" ? draft.category || "Uncategorized" : (baseline?.category ?? "");
  const headerDuration =
    mode === "add" ? draft.duration_min || "—" : String(baseline?.duration_min ?? "—");
  const headerPriceLabel =
    mode === "edit" && baseline
      ? formatPriceLabel({
          price_cents: baseline.price_cents,
          variable_price: baseline.variable_price,
          price_from_cents: baseline.price_from_cents,
          price_to_cents: baseline.price_to_cents,
        })
      : formatPriceLabel({
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
      <aside
        className="services-edit-panel"
        data-slot="services-edit-panel"
        data-mode={mode}
        data-dirty={isDirty ? "true" : "false"}
        aria-label={mode === "edit" ? "Edit service" : "Add service"}
      >
        {/* Header — color swatch + name + secondary line. No Close (X). */}
        <header className="services-edit-panel__header" data-slot="services-edit-panel-header">
          <span
            aria-hidden="true"
            className="services-edit-panel__header-swatch"
            style={{ background: `var(${draft.color_token})` }}
          />
          <div className="services-edit-panel__header-body">
            <div className="services-edit-panel__header-name" data-slot="services-edit-panel-name">
              {headerName}
            </div>
            <div
              className="services-edit-panel__header-secondary"
              data-slot="services-edit-panel-secondary"
            >
              {headerCategory} · {headerDuration} min · {headerPriceLabel}
            </div>
          </div>
        </header>

        {/* Single form wrapping the field stack + footer. The
            `services-edit-panel__body` class adds the 150ms opacity fade-in
            per `contracts/ui.contract.md § 9`; the `key={mode}` re-mounts
            the wrapper on closed/edit/add flips so the @keyframes re-runs
            (Phase 3 audit advisory #2). */}
        <form
          key={mode}
          data-slot="services-edit-panel-form"
          className="services-edit-panel__body"
          action={formAction}
        >
          {mode === "edit" && baseline ? (
            <input type="hidden" name="service_id" value={baseline.id} />
          ) : null}

          {/* Hidden inputs for staff assignments (carried forward on edit). */}
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

          <div className="services-edit-panel__scroll">
            <ServiceForm
              baseline={baseline}
              draft={draft}
              onChange={handlePatch}
              categories={categories}
              disabled={readOnly}
              inspectorChrome
            />
          </div>

          {/* Footer: Archive (left, edit-only) + Cancel + Save (right).
              Button classes (021 Phase 3 audit advisory #4): the prior
              inline-style values were already token-backed; the refactor
              hoists them into named `.services-edit-panel__action*` rules
              in `styles/settings.css`. */}
          <footer className="services-edit-panel__footer" data-slot="services-edit-panel-footer">
            {canWrite && mode === "edit" && baseline ? (
              baseline.active ? (
                <button
                  type="button"
                  data-slot="services-edit-panel-archive-button"
                  className="services-edit-panel__action services-edit-panel__action--destructive"
                  onClick={() => setArchiveOpen(true)}
                >
                  Archive service
                </button>
              ) : (
                <button
                  type="submit"
                  form={`services-restore-form-${baseline.id}`}
                  data-slot="services-edit-panel-restore-button"
                  className="services-edit-panel__action services-edit-panel__action--primary"
                >
                  Restore service
                </button>
              )
            ) : null}

            <div className="services-edit-panel__footer-end">
              <button
                type="button"
                onClick={handleCancel}
                data-slot="services-edit-panel-cancel"
                className="services-edit-panel__action services-edit-panel__action--ghost"
              >
                Cancel
              </button>
              {readOnly ? (
                <span
                  data-slot="services-edit-panel-view-only-chip"
                  className="services-edit-panel__action services-edit-panel__action--archived-chip"
                  title={`Viewing as ${ROLE_LABEL[operatorRole]} — read-only`}
                >
                  View only
                </span>
              ) : (
                <button
                  type="submit"
                  data-slot="services-edit-panel-save"
                  disabled={!canSubmit}
                  className="services-edit-panel__action services-edit-panel__action--primary"
                >
                  {primaryLabel}
                </button>
              )}
            </div>
          </footer>
        </form>

        {/* Sibling form for Restore — referenced by the Restore button via
            the HTML `form` attribute (nested <form>s are invalid). */}
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
        onDiscard={handleDiscardConfirm}
        currentName={discardServiceName}
        addMode={mode === "add"}
      />

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

// ---------- Empty-state inspector ----------

function ClosedInspector({ searchParams }: { searchParams: ReturnType<typeof useSearchParams> }) {
  const headlineId = useId();
  // `searchParams` was previously used to preserve URL params for the inline
  // Add link; the link was removed per Phase 3 audit advisory #3 (the prototype
  // shows only icon + headline + body, and the page header already provides
  // an Add CTA via `<CatalogList>`).
  void searchParams;
  return (
    <aside className="services-edit-panel" data-slot="services-edit-panel" data-mode="closed">
      <section
        // `key="closed"` re-runs the panel fade-in @keyframes on mode flips
        // into closed (Phase 3 audit advisory #2).
        key="closed"
        className="services-edit-panel__empty services-edit-panel__body"
        data-slot="services-edit-panel-empty"
        role="region"
        aria-labelledby={headlineId}
      >
        <div className="services-edit-panel__empty-inner">
          <span aria-hidden="true" className="services-edit-panel__empty-icon">
            <Info size={20} strokeWidth={1.5} />
          </span>
          <p
            id={headlineId}
            className="services-edit-panel__empty-headline"
            data-slot="services-edit-panel-empty-headline"
          >
            Pick a service
          </p>
          <p className="services-edit-panel__empty-body">
            Select a service on the left to edit, or add a new one.
          </p>
        </div>
      </section>
    </aside>
  );
}
