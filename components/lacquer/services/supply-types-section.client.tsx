"use client";

// SupplyTypesSection — Edit Policy sheet's supply-types catalog section.
//
// US2 scope: rename + add.
// US3 scope (this phase): archive button on active rows (count-aware
// tooltip when usage > 0) + archived types group at the bottom with a
// Reactivate button per row. No usage-count badge yet (US4); no expand
// sub-rows yet (US4).
//
// Composition (top → bottom inside the sheet body):
//   1. Section header — `Box` lucide icon + title + multi-line hint.
//   2. Active types card — one row per active supply type. Each row's
//      name is click-to-rename; an inline `<Input>` swaps in, Enter
//      commits via `renameSupplyType` (form-based), Escape cancels.
//      Trailing cell: Archive button (disabled with count-aware tooltip
//      when `usage_count > 0`, otherwise wired to `archiveSupplyType`).
//   3. Add row — pinned at the bottom of the active card. Default state
//      is a rose-700 "+ Add supply type" link-style button; clicking it
//      swaps in an inline form (`<Input>` + primary "Add" + ghost
//      "Cancel"). Submit via `createSupplyType` (form-based — redirects
//      back to `/services?policy=open&toast=…` so the sheet stays open).
//   4. Footer tip — one line under the card.
//   5. Archived types group (only when `catalog.archived.length > 0`) —
//      muted-background variant of the same card. Each row shows the
//      name + a "Reactivate" outline button wired to
//      `reactivateSupplyType`. On `?error=name_taken`, the hint
//      "This name is taken by an active type. Rename one first." is
//      surfaced under the offending row (matched by `?error_id`).
//
// Soft-hint on rename collision: while typing, we canonicalize the typed
// name (via `canonicalizeName`) and check the rest of the active list. A
// match shows a calm hint under the input and suppresses submit. The DB's
// unique index still has the final say via the `name_taken` mapping.
//
// All form submits use `<form action={…}>` patterns (no `useActionState`
// here — all four verbs redirect server-side via the actions in
// `app/(studio)/settings/policy/actions.ts`).
//
// Tooltip on the disabled archive button: shadcn `<Tooltip>` primitives
// — same DOM contract as the existing `<OwnerOnlyTooltip>` (a wrapping
// span on the disabled control so radix's pointer listener can fire) —
// but with the dynamic count-aware copy.
//
// Contracts:
//   - specs/022-supply-types-catalog/contracts/ui.contract.md § 3
//   - specs/022-supply-types-catalog/contracts/server-actions.contract.md §§ 1a, 2, 3, 4

import { ArrowRight, Box, ChevronRight, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  archiveSupplyType,
  createSupplyType,
  reactivateSupplyType,
  renameSupplyType,
} from "@/app/(studio)/settings/policy/actions";
import type {
  SupplyTypesCatalog,
  SupplyTypeRow,
  SupplyTypeServiceRow,
} from "@/app/(studio)/settings/policy/_load";
import { canonicalizeName } from "@/lib/policy/canonicalize-name";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const SECTION_TITLE = "Supply types";
// Hint copy per ui.contract.md § 3 — bold "Settings → Staff" surfaces the
// downstream propagation; rendered via inline <strong>.
const SECTION_HINT_PREFIX =
  "The catalog of supply costs the salon can deduct. Each service supply references a type by id, so renaming here updates everywhere — including tech-level exemptions in ";
const SECTION_HINT_LINK = "Settings → Staff";
const SECTION_HINT_SUFFIX = ".";

const ARCHIVED_SECTION_TITLE = "Archived";

const ADD_LABEL = "Add supply type";
const ADD_PLACEHOLDER = "e.g. Builder gel, Polygel";

const FOOTER_TIP =
  "Tip: click a name to rename. Types in use can't be archived until you reassign or remove the services that reference them.";

const COLLISION_HINT_COPY = "A supply type with this name already exists.";

const REACTIVATE_NAME_TAKEN_COPY = "This name is taken by an active type. Rename one first.";

const NAME_MIN_LEN = 2;

function formatArchiveTooltipCopy(n: number): string {
  // Exact template per ui.contract.md § 3.2.
  return `Remove this type from the ${n} service${n === 1 ? "" : "s"} that use${n === 1 ? "s" : ""} it first.`;
}

function formatUsageBadgeCopy(n: number): string {
  // Copy per ui.contract.md § 3.2 ("N services" or "Unused").
  if (n === 0) return "Unused";
  return `${n} service${n === 1 ? "" : "s"}`;
}

function formatSupplyAmount(cents: number): string {
  // Negative sign + USD formatting — matches the prototype's "−$X.XX"
  // (minus-sign U+2212, not a hyphen, so it visually pairs with the
  // monospaced tabular-numerals on the value).
  const dollars = (cents / 100).toFixed(2);
  return `−$${dollars}`;
}

type EditingState =
  | { kind: "idle" }
  | { kind: "rename"; id: string; name: string }
  | { kind: "create"; name: string };

/**
 * Set of expanded supply-type ids — drives the inline reveal of the
 * referencing-services sub-list per US4. Stored as a Set so we don't
 * leak the contract's `ExpansionState = Set<string>` shape to consumers.
 */
type ExpansionState = ReadonlySet<string>;

export type SupplyTypesSectionProps = {
  catalog: SupplyTypesCatalog;
  /**
   * Optional inline-hint targeting metadata for the archived group's
   * reactivate-name_taken case. The page-level URL toast bridge surfaces
   * the toast; this prop lets us also pin the inline hint under the
   * specific row the operator just tried to reactivate. Falsy = no inline
   * hint surfaced.
   */
  reactivateErrorTypeId?: string | null;
  /**
   * Called by sub-row jump-to-service activation (US4): the section
   * navigates to `/services?selected=<id>` and asks the host sheet to
   * close itself so the operator lands directly in the catalog. Optional
   * to keep storybook / preview surfaces simple — when absent, sub-rows
   * still navigate but don't close any wrapping sheet.
   */
  onCloseSheet?: () => void;
};

export function SupplyTypesSection({
  catalog,
  reactivateErrorTypeId,
  onCloseSheet,
}: SupplyTypesSectionProps) {
  const router = useRouter();
  const [editing, setEditing] = useState<EditingState>({ kind: "idle" });
  const [expanded, setExpanded] = useState<ExpansionState>(() => new Set<string>());
  const [prevCatalog, setPrevCatalog] = useState(catalog);

  // Cancel any in-progress edit + collapse all expansion state when the
  // catalog prop changes — a successful rename / create / archive /
  // reactivate redirects through `?policy=open&toast=…`, which causes the
  // sheet to re-mount with a fresh `catalog` prop. Resetting here ensures
  // the next interaction starts clean (idle editor, no stale chevron).
  //
  // Pattern per https://react.dev/reference/react/useState#storing-information-from-previous-renders
  // — adjust state during render and React will discard the in-progress
  // render and immediately rerun with the new state (no cascading effect,
  // no double-render commit).
  if (catalog !== prevCatalog) {
    setPrevCatalog(catalog);
    setEditing({ kind: "idle" });
    setExpanded(new Set<string>());
  }

  const toggleExpanded = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleJumpToService = useCallback(
    (serviceId: string) => {
      // Close the sheet first so the navigation lands on a clean URL
      // (without ?policy=open). The parent's onOpenChange will strip
      // ?policy from the URL; immediately after, we push to
      // /services?selected=<id> so the catalog selects the row.
      onCloseSheet?.();
      router.push(`/services?selected=${serviceId}`);
    },
    [router, onCloseSheet]
  );

  return (
    <section className="supply-types-section" data-slot="supply-types-section">
      <header className="supply-types-section__header">
        <div className="supply-types-section__header-title-row">
          <Box size={15} strokeWidth={1.5} aria-hidden="true" />
          <h3 className="supply-types-section__title">{SECTION_TITLE}</h3>
        </div>
        <p className="supply-types-section__hint">
          {SECTION_HINT_PREFIX}
          <strong>{SECTION_HINT_LINK}</strong>
          {SECTION_HINT_SUFFIX}
        </p>
      </header>

      <div
        className="supply-types-section__card"
        data-slot="supply-types-section-card"
        data-empty={catalog.active.length === 0 ? "true" : undefined}
      >
        {catalog.active.map((type) => (
          <ActiveTypeRow
            key={type.id}
            type={type}
            siblings={catalog.active}
            editing={editing}
            isExpanded={expanded.has(type.id)}
            onStartRename={(id) => setEditing({ kind: "rename", id, name: type.name })}
            onCancel={() => setEditing({ kind: "idle" })}
            onToggleExpanded={() => toggleExpanded(type.id)}
            onJumpToService={handleJumpToService}
          />
        ))}
        <AddTypeRow
          editing={editing}
          onStartCreate={() => setEditing({ kind: "create", name: "" })}
          onCancel={() => setEditing({ kind: "idle" })}
          existingNames={catalog.active.map((t) => t.name)}
        />
      </div>

      <p className="supply-types-section__footer-tip">{FOOTER_TIP}</p>

      {catalog.archived.length > 0 ? (
        <ArchivedGroup
          archived={catalog.archived}
          reactivateErrorTypeId={reactivateErrorTypeId ?? null}
        />
      ) : null}
    </section>
  );
}

// ── Active type row (rename + archive + usage badge + expand) ───────────

type ActiveTypeRowProps = {
  type: SupplyTypeRow;
  siblings: SupplyTypeRow[];
  editing: EditingState;
  isExpanded: boolean;
  onStartRename: (id: string) => void;
  onCancel: () => void;
  onToggleExpanded: () => void;
  onJumpToService: (serviceId: string) => void;
};

function ActiveTypeRow({
  type,
  siblings,
  editing,
  isExpanded,
  onStartRename,
  onCancel,
  onToggleExpanded,
  onJumpToService,
}: ActiveTypeRowProps) {
  const isRenaming = editing.kind === "rename" && editing.id === type.id;
  const hasUsage = type.usage_count > 0;

  if (isRenaming) {
    return (
      <RenameInlineForm
        type={type}
        siblings={siblings}
        initialName={editing.kind === "rename" ? editing.name : type.name}
        onCancel={onCancel}
      />
    );
  }

  return (
    <>
      <div
        className="supply-types-row"
        data-slot="supply-types-row"
        data-supply-type-id={type.id}
        data-expanded={isExpanded ? "true" : undefined}
      >
        <button
          type="button"
          className="supply-types-row__name-button"
          data-slot="supply-types-row-name"
          onClick={() => onStartRename(type.id)}
        >
          {type.name}
        </button>
        <div className="supply-types-row__badge-slot">
          <span
            className="supply-types-row__usage-badge tnum"
            data-slot="supply-types-row-usage-badge"
            data-tone={hasUsage ? "active" : "unused"}
          >
            {formatUsageBadgeCopy(type.usage_count)}
          </span>
          {hasUsage ? (
            <button
              type="button"
              className="supply-types-row__expand-chevron"
              data-slot="supply-types-row-expand-chevron"
              data-expanded={isExpanded ? "true" : "false"}
              aria-expanded={isExpanded}
              aria-label={
                isExpanded ? `Hide services using ${type.name}` : `Show services using ${type.name}`
              }
              onClick={onToggleExpanded}
            >
              <ChevronRight size={14} strokeWidth={1.5} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <ArchiveCell type={type} />
      </div>
      {hasUsage && isExpanded ? (
        <ExpandedSubRows
          typeId={type.id}
          services={type.services}
          onJumpToService={onJumpToService}
        />
      ) : null}
    </>
  );
}

// ── Expanded sub-rows (US4) ────────────────────────────────────────────

type ExpandedSubRowsProps = {
  typeId: string;
  services: SupplyTypeServiceRow[];
  onJumpToService: (serviceId: string) => void;
};

function ExpandedSubRows({ typeId, services, onJumpToService }: ExpandedSubRowsProps) {
  return (
    <div
      className="supply-types-section__expanded-sub-rows"
      data-slot="supply-types-section-expanded-sub-rows"
      data-supply-type-id={typeId}
    >
      {services.map((service) => (
        <button
          key={service.id}
          type="button"
          className="supply-types-section__expanded-sub-row"
          data-slot="supply-types-section-expanded-sub-row"
          data-service-id={service.id}
          onClick={() => onJumpToService(service.id)}
        >
          <span
            className="supply-types-section__expanded-sub-row-dot"
            data-slot="supply-types-section-expanded-sub-row-dot"
            style={{ background: `var(${service.color_token})` }}
            aria-hidden="true"
          />
          <span
            className="supply-types-section__expanded-sub-row-name"
            data-slot="supply-types-section-expanded-sub-row-name"
          >
            {service.name}
          </span>
          <span
            className="supply-types-section__expanded-sub-row-amount tnum"
            data-slot="supply-types-section-expanded-sub-row-amount"
          >
            {formatSupplyAmount(service.supply_amount_cents)}
          </span>
          <ArrowRight
            size={12}
            strokeWidth={1.5}
            aria-hidden="true"
            className="supply-types-section__expanded-sub-row-arrow"
          />
        </button>
      ))}
    </div>
  );
}

// ── Archive cell ────────────────────────────────────────────────────────

type ArchiveCellProps = {
  type: SupplyTypeRow;
};

function ArchiveCell({ type }: ArchiveCellProps) {
  const usage = type.usage_count;
  const isBlocked = usage > 0;
  const tooltipCopy = formatArchiveTooltipCopy(usage);

  // When blocked, the button is rendered as `aria-disabled` + non-submitting
  // so click does nothing but a screen reader still announces it. We wrap
  // in a shadcn Tooltip so hover/focus surfaces the count-aware copy.
  if (isBlocked) {
    return (
      <div className="supply-types-row__actions-slot">
        <TooltipProvider delayDuration={100}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="supply-types-row__archive-tooltip-trigger"
                data-slot="supply-types-row-archive-tooltip-trigger"
              >
                <button
                  type="button"
                  className="supply-types-row__archive-btn"
                  data-slot="supply-types-row-archive"
                  aria-disabled="true"
                  aria-label={tooltipCopy}
                  onClick={(e) => e.preventDefault()}
                >
                  Archive
                </button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" data-slot="supply-types-row-archive-tooltip-content">
              {tooltipCopy}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    );
  }

  return (
    <form
      action={archiveSupplyType}
      className="supply-types-row__actions-slot"
      data-slot="supply-types-row-archive-form"
    >
      <input type="hidden" name="supply_type_id" value={type.id} />
      <button
        type="submit"
        className="supply-types-row__archive-btn"
        data-slot="supply-types-row-archive"
      >
        Archive
      </button>
    </form>
  );
}

// ── Rename inline form ─────────────────────────────────────────────────

type RenameInlineFormProps = {
  type: SupplyTypeRow;
  siblings: SupplyTypeRow[];
  initialName: string;
  onCancel: () => void;
};

function RenameInlineForm({ type, siblings, initialName, onCancel }: RenameInlineFormProps) {
  const [value, setValue] = useState(initialName);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    // Focus + select the text on mount so Tab/Enter UX feels native.
    const id = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  // Soft-hint: case-insensitive + whitespace-canonical match against the
  // OTHER active siblings (not this row — typing the unchanged name should
  // not flag a collision; the action will short-circuit to `no_changes`).
  const collision = useMemo(() => {
    const canon = canonicalizeName(value);
    if (canon.length === 0) return null;
    if (canon === canonicalizeName(type.name)) return null;
    return siblings.find((s) => s.id !== type.id && canonicalizeName(s.name) === canon) ?? null;
  }, [value, siblings, type]);

  const trimmed = value.trim();
  const isEmpty = trimmed.length < NAME_MIN_LEN;
  const isBlockedByCollision = collision !== null;
  const submitDisabled = isEmpty || isBlockedByCollision;

  // Esc cancels — restores the prior name without committing.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (submitDisabled) return;
        // Programmatic submit — the form's `action` is the Server Action,
        // so requestSubmit() triggers the normal form submission path
        // (which includes the redirect).
        formRef.current?.requestSubmit();
      }
    },
    [onCancel, submitDisabled]
  );

  // Blur on empty: restore the prior name (cancel) per the spec.
  // Blur on a valid edit: commit by submitting the form.
  // Blur on a collision: cancel (the operator can re-engage the row).
  const handleBlur = useCallback(() => {
    // Defer so a click on the parent button (e.g. re-engaging another row)
    // can cancel before this fires. We only auto-cancel if the input still
    // shows the same value — protects against double-firing on rapid edit.
    window.setTimeout(() => {
      if (isEmpty || isBlockedByCollision) {
        onCancel();
      }
    }, 0);
  }, [isEmpty, isBlockedByCollision, onCancel]);

  return (
    <form
      ref={formRef}
      action={renameSupplyType}
      className="supply-types-row supply-types-row--editing"
      data-slot="supply-types-row-rename-form"
      data-supply-type-id={type.id}
    >
      <input type="hidden" name="supply_type_id" value={type.id} />
      <input
        ref={inputRef}
        name="name"
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        className="supply-types-row__rename-input"
        data-slot="supply-types-row-rename-input"
        aria-invalid={isBlockedByCollision || undefined}
      />
      {isBlockedByCollision ? (
        <p
          className="supply-types-row__hint"
          data-slot="supply-types-row-rename-hint"
          role="status"
        >
          {COLLISION_HINT_COPY}
        </p>
      ) : null}
      {/* Reserved slots — keep the row width consistent during edit. */}
      <div className="supply-types-row__badge-slot" aria-hidden="true" />
      <div className="supply-types-row__actions-slot" aria-hidden="true" />
    </form>
  );
}

// ── Add row (pinned at the bottom of the active card) ──────────────────

type AddTypeRowProps = {
  editing: EditingState;
  onStartCreate: () => void;
  onCancel: () => void;
  existingNames: string[];
};

function AddTypeRow({ editing, onStartCreate, onCancel, existingNames }: AddTypeRowProps) {
  const isCreating = editing.kind === "create";

  if (!isCreating) {
    return (
      <button
        type="button"
        className="supply-types-section__add-row"
        data-slot="supply-types-section-add-row"
        onClick={onStartCreate}
      >
        <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
        <span>{ADD_LABEL}</span>
      </button>
    );
  }

  return <AddInlineForm onCancel={onCancel} existingNames={existingNames} />;
}

type AddInlineFormProps = {
  onCancel: () => void;
  existingNames: string[];
};

function AddInlineForm({ onCancel, existingNames }: AddInlineFormProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, []);

  const collision = useMemo(() => {
    const canon = canonicalizeName(value);
    if (canon.length === 0) return null;
    return existingNames.find((n) => canonicalizeName(n) === canon) ?? null;
  }, [value, existingNames]);

  const trimmed = value.trim();
  const isEmpty = trimmed.length < NAME_MIN_LEN;
  const submitDisabled = isEmpty || collision !== null;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (submitDisabled) return;
        formRef.current?.requestSubmit();
      }
    },
    [onCancel, submitDisabled]
  );

  return (
    <form
      ref={formRef}
      action={createSupplyType}
      className="supply-types-section__add-row supply-types-section__add-row--editing"
      data-slot="supply-types-section-add-form"
    >
      <input
        ref={inputRef}
        name="name"
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={ADD_PLACEHOLDER}
        className="supply-types-section__add-input"
        data-slot="supply-types-section-add-input"
        aria-invalid={collision !== null || undefined}
      />
      <div className="supply-types-section__add-actions">
        <button
          type="button"
          className="supply-types-section__add-cancel"
          data-slot="supply-types-section-add-cancel"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="supply-types-section__add-save"
          data-slot="supply-types-section-add-save"
          disabled={submitDisabled}
        >
          Add
        </button>
      </div>
      {collision ? (
        <p
          className="supply-types-section__add-hint"
          data-slot="supply-types-section-add-hint"
          role="status"
        >
          {COLLISION_HINT_COPY}
        </p>
      ) : null}
    </form>
  );
}

// ── Archived types group (US3) ─────────────────────────────────────────

type ArchivedGroupProps = {
  archived: SupplyTypeRow[];
  reactivateErrorTypeId: string | null;
};

function ArchivedGroup({ archived, reactivateErrorTypeId }: ArchivedGroupProps) {
  return (
    <div
      className="supply-types-section__archived-group"
      data-slot="supply-types-section-archived-group"
    >
      <h4 className="supply-types-section__archived-title">{ARCHIVED_SECTION_TITLE}</h4>
      <div className="supply-types-section__archived-card">
        {archived.map((type) => (
          <ArchivedTypeRow
            key={type.id}
            type={type}
            showNameTakenHint={reactivateErrorTypeId === type.id}
          />
        ))}
      </div>
    </div>
  );
}

type ArchivedTypeRowProps = {
  type: SupplyTypeRow;
  showNameTakenHint: boolean;
};

function ArchivedTypeRow({ type, showNameTakenHint }: ArchivedTypeRowProps): ReactNode {
  return (
    <div
      className="supply-types-archived-row"
      data-slot="supply-types-archived-row"
      data-supply-type-id={type.id}
    >
      <span className="supply-types-archived-row__name">{type.name}</span>
      <form
        action={reactivateSupplyType}
        className="supply-types-archived-row__form"
        data-slot="supply-types-archived-row-form"
      >
        <input type="hidden" name="supply_type_id" value={type.id} />
        <button
          type="submit"
          className="supply-types-archived-row__reactivate-btn"
          data-slot="supply-types-archived-row-reactivate"
        >
          Reactivate
        </button>
      </form>
      {showNameTakenHint ? (
        <p
          className="supply-types-archived-row__hint"
          data-slot="supply-types-archived-row-hint"
          role="status"
        >
          {REACTIVATE_NAME_TAKEN_COPY}
        </p>
      ) : null}
    </div>
  );
}
