"use client";

// SupplyTypePicker — combobox + inline-create for the per-service supply
// type selection (022-supply-types-catalog § ui.contract.md § 4).
//
// Composition: shadcn `Popover` (trigger = the resting button) + shadcn
// `Command` (dropdown content with built-in client-side filter). When the
// operator activates the pinned "+ Create new supply type…" row, the
// dropdown swaps to a tiny inline-create UI built from a plain `<div>`
// (NOT a nested `<form>` — the picker mounts inside the outer service
// `<form>` and nested forms are invalid HTML). The inline-create flow
// uses React 19's `useActionState` against `createSupplyTypeForPicker`,
// which returns a `CreateResult` JSON shape:
//
//   { kind: 'idle' } → (pending) → { kind: 'ok', id, name }
//                                | { kind: 'error', code }
//
// On 'ok', an effect commits the new id to the outer form's draft via
// `onSelect(state.id)`, then calls `router.refresh()` so the page's RSC
// re-fetches the catalog (the `types` prop now contains the new row), then
// collapses the inline-create back to the dropdown.
//
// Soft-hint on collision (US1 AC3): while typing in the inline-create
// input, the picker locally canonicalizes the typed name (via
// `canonicalizeName`) and checks the active types list for a match. If
// found, the Save button morphs into a muted "Select existing" button
// that calls `onSelect(existingId)` directly — no Server Action call.
//
// Hidden FormData: when `supply_on` is true (the parent renders the
// picker), the picker emits `<input type="hidden" name="supply_type_id"
// value={selectedId ?? ''}>` inside the parent `<form>` so the outer
// service form's submit carries the picker's selection.
//
// Disabled state: when `disabled` is true (operator can't write the
// catalog), the trigger is wrapped in `<OwnerOnlyTooltip>` and the popover
// never opens, so the inline-create row is unreachable.

import { Check, ChevronDown, PlusCircle } from "lucide-react";
import { startTransition, useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { OwnerOnlyTooltip } from "@/components/lacquer/services/owner-only-tooltip";
import {
  createSupplyTypeForPicker,
  type CreateResult,
} from "@/app/(studio)/settings/policy/actions";
import type { SupplyTypeLite } from "@/app/(studio)/services/_types";
import { canonicalizeName } from "@/lib/policy/canonicalize-name";

const TRIGGER_PLACEHOLDER = "Pick a supply type";
const SEARCH_PLACEHOLDER = "Search supply types…";
const CREATE_ROW_LABEL = "Create new supply type…";
const COLLIDE_HINT_COPY = "A supply type with this name already exists — selecting it instead.";
const EMPTY_LIST_COPY = "No supply types yet.";

const ERROR_COPY: Record<Exclude<CreateResult["kind"], "idle" | "ok">, Record<string, string>> = {
  error: {
    name_too_short: "Name must be at least 2 characters.",
    name_too_long: "Name must be 64 characters or fewer.",
    name_taken: "A supply type with this name already exists.",
    db_failure: "Couldn't save — try again.",
    forbidden: "Only owners and managers can add supply types.",
  },
};

export type SupplyTypePickerProps = {
  /** Active types, alphabetically sorted by name. Archived types filtered out by the loader. */
  types: SupplyTypeLite[];
  /** Current selected id (null when supply is on but no type has been picked yet). */
  selectedId: string | null;
  /** Called by the inline-create flow on success — the parent's draft buffer updates so the picker re-renders with the new selection. */
  onSelect: (id: string) => void;
  /** Disabled when the operator can't write the catalog. */
  disabled?: boolean;
  /** Service id when editing an existing service; null when adding. Retained for future deep-link / debugging use — the inline-create flow does NOT use it. */
  serviceId: string | null;
};

export function SupplyTypePicker({
  types,
  selectedId,
  onSelect,
  disabled = false,
  serviceId: _serviceId,
}: SupplyTypePickerProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [inlineMode, setInlineMode] = useState<"idle" | "creating">("idle");
  const [typedName, setTypedName] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [state, formAction, pending] = useActionState<CreateResult, FormData>(
    createSupplyTypeForPicker,
    { kind: "idle" }
  );

  // Resolve the active type matching a typed name (case + whitespace
  // insensitive). Used both for the soft-hint and for the collide-click path.
  const collision = useMemo(() => {
    const t = canonicalizeName(typedName);
    if (t.length === 0) return null;
    const match = types.find((x) => canonicalizeName(x.name) === t);
    return match ?? null;
  }, [typedName, types]);

  // Local overlay for a freshly-created type. When the inline-create flow
  // succeeds, the new row exists in the DB but the page's RSC catalog
  // hasn't refetched yet — so `types.find(selectedId)` returns null and
  // the trigger would flash the placeholder. We stash the just-created
  // `{ id, name }` here so the trigger reads it immediately. The next
  // `router.refresh()` brings the row into the props' `types` array; the
  // overlay is cleared once `types` contains a row matching `selectedId`.
  const [justCreated, setJustCreated] = useState<{ id: string; name: string } | null>(null);

  // Resolve the selected type's display name. Prefer the prop list (the
  // canonical catalog post-refresh); fall back to the just-created overlay
  // while the RSC roundtrip catches up. When neither matches, the trigger
  // shows the placeholder.
  const selectedType = useMemo(() => {
    if (!selectedId) return null;
    const fromProps = types.find((t) => t.id === selectedId) ?? null;
    if (fromProps) return fromProps;
    if (justCreated && justCreated.id === selectedId) {
      return { id: justCreated.id, name: justCreated.name, archived: false };
    }
    return null;
  }, [selectedId, types, justCreated]);

  // Clear the local overlay once the catalog prop catches up. Syncing prop
  // changes into local state is a legitimate use of setState-in-effect here —
  // the overlay only exists to bridge the gap between an optimistic local
  // selection and the next RSC roundtrip; once the prop reflects reality we
  // discard the overlay.
  useEffect(() => {
    if (!justCreated) return;
    if (types.find((t) => t.id === justCreated.id)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setJustCreated(null);
    }
  }, [types, justCreated]);

  // On a successful inline-create, stash the overlay, commit the new id,
  // refresh the page's RSC so the catalog list contains the new row on
  // next render, and collapse the inline-create back to the dropdown.
  //
  // The success branch is gated by a ref so it fires exactly once per
  // transition into `kind: 'ok'`. Without the ref, an unstable `onSelect`
  // identity (parent recreates the arrow on every render) would loop the
  // effect indefinitely once the parent's `setState` calls back into
  // `setJustCreated` here.
  const lastHandledRef = useRef<CreateResult>({ kind: "idle" });
  useEffect(() => {
    if (state.kind !== "ok") {
      lastHandledRef.current = state;
      return;
    }
    if (lastHandledRef.current === state) return;
    lastHandledRef.current = state;
    setJustCreated({ id: state.id, name: state.name });
    onSelect(state.id);
    router.refresh();
    setInlineMode("idle");
    setTypedName("");
    setOpen(false);
    // `onSelect` and `router` intentionally excluded — the success branch
    // is gated by `lastHandledRef` against the action state object identity,
    // not the closure identity of the callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // When the dropdown opens into inline-create mode, focus the input.
  useEffect(() => {
    if (inlineMode === "creating") {
      // Defer so the input is mounted by the time we focus.
      const id = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
  }, [inlineMode]);

  // Reset inline-create state when the popover closes — re-opening starts
  // back at the search list. The transient inline-create state belongs to the
  // popover's lifecycle, not the parent's, so syncing on `open` here is the
  // simplest correct shape.
  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInlineMode("idle");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTypedName("");
    }
  }, [open]);

  const triggerLabel = selectedType?.name ?? TRIGGER_PLACEHOLDER;

  const errorCopy =
    state.kind === "error" ? (ERROR_COPY.error[state.code] ?? "Couldn't save.") : null;

  const triggerNode = (
    <button
      type="button"
      data-slot="supply-type-picker-trigger"
      className="supply-type-picker__trigger"
      data-empty={selectedType ? undefined : "true"}
      disabled={disabled}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={selectedType ? `Supply type: ${selectedType.name}` : "Pick a supply type"}
    >
      <span className="supply-type-picker__trigger-label">{triggerLabel}</span>
      <ChevronDown size={16} strokeWidth={1.5} aria-hidden="true" />
    </button>
  );

  return (
    <div className="supply-type-picker" data-slot="supply-type-picker">
      <Popover open={open && !disabled} onOpenChange={(next) => !disabled && setOpen(next)}>
        <PopoverTrigger asChild>
          {disabled ? <OwnerOnlyTooltip disabled>{triggerNode}</OwnerOnlyTooltip> : triggerNode}
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={4}
          className="supply-type-picker__content"
          data-slot="supply-type-picker-content"
        >
          {inlineMode === "idle" ? (
            <Command className="supply-type-picker__command">
              <CommandInput placeholder={SEARCH_PLACEHOLDER} />
              <CommandList>
                <CommandEmpty>{EMPTY_LIST_COPY}</CommandEmpty>
                {types.map((t) => {
                  const isSelected = t.id === selectedId;
                  return (
                    <CommandItem
                      key={t.id}
                      value={t.name}
                      data-slot="supply-type-picker-item"
                      data-supply-type-id={t.id}
                      data-checked={isSelected ? "true" : undefined}
                      onSelect={() => {
                        onSelect(t.id);
                        setOpen(false);
                      }}
                    >
                      <span className="supply-type-picker__item-name">{t.name}</span>
                      {isSelected ? (
                        <Check
                          size={16}
                          strokeWidth={1.5}
                          className="supply-type-picker__item-check"
                          aria-hidden="true"
                        />
                      ) : null}
                    </CommandItem>
                  );
                })}
                <CommandItem
                  value="__create_new__"
                  data-slot="supply-type-picker-create-row"
                  className="supply-type-picker__create-row"
                  onSelect={() => {
                    setInlineMode("creating");
                  }}
                >
                  <PlusCircle size={16} strokeWidth={1.5} aria-hidden="true" />
                  <span>{CREATE_ROW_LABEL}</span>
                </CommandItem>
              </CommandList>
            </Command>
          ) : (
            // Inline-create panel — plain <div>, NOT a nested <form>.
            // The Save button calls `formAction(fd)` directly (the picker
            // mounts inside the outer service <form>; nested forms are
            // invalid HTML and would also clobber any other in-progress
            // form fields via a redirect-style submit).
            <div
              className="supply-type-picker__create-panel"
              data-slot="supply-type-picker-create-panel"
            >
              <label
                htmlFor="supply-type-picker-create-input"
                className="supply-type-picker__create-label"
              >
                New supply type
              </label>
              <input
                id="supply-type-picker-create-input"
                ref={inputRef}
                type="text"
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                placeholder="Name"
                data-slot="supply-type-picker-create-input"
                className="supply-type-picker__create-input"
                disabled={pending}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setInlineMode("idle");
                    setTypedName("");
                  }
                }}
              />
              {collision ? (
                <p
                  className="supply-type-picker__create-hint"
                  data-slot="supply-type-picker-create-hint"
                  role="status"
                >
                  {COLLIDE_HINT_COPY}
                </p>
              ) : null}
              {errorCopy ? (
                <p
                  className="supply-type-picker__create-error"
                  data-slot="supply-type-picker-create-error"
                  role="alert"
                >
                  {errorCopy}
                </p>
              ) : null}
              <div className="supply-type-picker__create-actions">
                <button
                  type="button"
                  data-slot="supply-type-picker-create-cancel"
                  className="supply-type-picker__create-cancel"
                  onClick={() => {
                    setInlineMode("idle");
                    setTypedName("");
                  }}
                  disabled={pending}
                >
                  Cancel
                </button>
                {collision ? (
                  <button
                    type="button"
                    data-slot="supply-type-picker-create-save"
                    data-state="collide"
                    className="supply-type-picker__create-save supply-type-picker__create-save--collide"
                    onClick={() => {
                      onSelect(collision.id);
                      setInlineMode("idle");
                      setTypedName("");
                      setOpen(false);
                    }}
                  >
                    Select existing
                  </button>
                ) : (
                  <button
                    type="button"
                    data-slot="supply-type-picker-create-save"
                    data-state="save"
                    className="supply-type-picker__create-save"
                    disabled={pending || typedName.trim().length < 2}
                    onClick={() => {
                      const fd = new FormData();
                      fd.set("name", typedName);
                      // React 19: useActionState's `formAction` must be
                      // called inside a transition when invoked
                      // programmatically (not via a <form action={…}> prop).
                      startTransition(() => {
                        formAction(fd);
                      });
                    }}
                  >
                    {pending ? "Saving…" : "Save"}
                  </button>
                )}
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>
      {/* Hidden form field so the outer service form's submit carries the
          picker's selection. Rendered unconditionally inside the picker —
          when the parent's `supply_on` is off, the parent skips mounting
          the picker entirely so this input doesn't reach FormData. */}
      <input type="hidden" name="supply_type_id" value={selectedId ?? ""} />
    </div>
  );
}
