// EditPolicySheet.jsx — right-side sheet for editing the global deductions policy
// surfaced from the V1 Refined two-pane Services page.
//
// What this controls:
//   1. Card fee default — amount, which payment methods trigger it,
//      which service categories get it by default. (Per-service overrides
//      still beat these — copy in the sheet says so.)
//   2. Supply deductions — read-only summary across the menu, since the
//      money lives per-service (configured in the Edit panel).
//
// Per-tech exemptions live in Staff Settings, not on this page.
//
// Implementation notes:
//   - Animated mount/unmount via a tiny `useMountAnim` hook (200ms in,
//      200ms out) so the sheet feels native. Honors prefers-reduced-motion.
//   - Esc closes. Click on scrim closes. Internal scroll inside the sheet.
//   - State is local-draft; "Save changes" lifts back via onSave(draft).
//   - Pure presentational — does not mutate the global SERVICES_DATA.

const { useState, useEffect, useMemo, useRef } = React;

// ---------- Icons reused from Lucide vocab ----------
const PIco = (paths) => ({ size = 16, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...rest}>{paths}</svg>
);
const PIcX        = PIco(<path d="M18 6L6 18M6 6l12 12"/>);
const PIcPlus     = PIco(<path d="M12 5v14M5 12h14"/>);
const PIcCheck    = PIco(<path d="M5 12l5 5L20 7"/>);
const PIcCard     = PIco(<><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></>);
const PIcBox      = PIco(<><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></>);
const PIcSearch   = PIco(<><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></>);
const PIcChev     = PIco(<path d="M9 18l6-6-6-6"/>);
const PIcArrowR   = PIco(<><path d="M5 12h14"/><path d="M13 5l7 7-7 7"/></>);

// All known payment methods at this salon.
const PAYMENT_METHODS = [
  { id: 'card',   label: 'Card',       hint: 'Visa, MC, Amex, debit' },
  { id: 'gift',   label: 'Gift card',  hint: 'Salon-issued' },
  { id: 'cash',   label: 'Cash',       hint: 'No processing fee' },
  { id: 'venmo',  label: 'Venmo / Zelle', hint: 'Treated as cash' },
];

// ---------- Mount/unmount animation helper ----------
function useMountAnim(open, duration = 200) {
  const [mounted, setMounted] = useState(open);
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    let raf1, raf2, t;
    if (open) {
      setMounted(true);
      // Two RAFs so the initial transform is committed before the transition flips it.
      raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => setEntered(true)); });
    } else {
      setEntered(false);
      t = setTimeout(() => setMounted(false), duration);
    }
    return () => {
      if (raf1) cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
      if (t) clearTimeout(t);
    };
  }, [open, duration]);
  return { mounted, entered };
}

// ---------- Local primitives (sheet-flavor) ----------
function SheetCheckbox({ checked, onChange, disabled }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      style={{
        width: 18, height: 18, borderRadius: 4,
        background: checked ? 'var(--primary)' : 'var(--card)',
        border: '1px solid ' + (checked ? 'var(--primary)' : 'var(--input)'),
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        color: 'white',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        flexShrink: 0,
        transition: 'background 150ms var(--ease-out), border-color 150ms var(--ease-out)',
      }}>
      {checked && <PIcCheck size={12} />}
    </button>
  );
}

function SheetSwitch({ checked, onChange, ariaLabel }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      style={{
        width: 32, height: 18, padding: 2,
        background: checked ? 'var(--primary)' : 'var(--muted)',
        border: '1px solid ' + (checked ? 'var(--primary)' : 'var(--border)'),
        borderRadius: 999,
        position: 'relative', cursor: 'pointer', flexShrink: 0,
        transition: 'background 150ms var(--ease-out)',
      }}>
      <span style={{
        display: 'block', width: 12, height: 12, borderRadius: '50%',
        background: 'white',
        transform: `translateX(${checked ? 14 : 0}px)`,
        transition: 'transform 150ms var(--ease-out)',
        boxShadow: '0 1px 2px rgb(0 0 0 / 0.15)',
      }} />
    </button>
  );
}

function SheetTextInput({ value, onChange, prefix, suffix, width, numeric, ariaLabel }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center',
      background: 'var(--card)',
      border: '1px solid var(--input)',
      borderRadius: 6,
      padding: '0 10px',
      width,
    }}>
      {prefix && <span style={{ color: 'var(--muted-foreground)', fontSize: 13, marginRight: 4 }}>{prefix}</span>}
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        aria-label={ariaLabel}
        style={{
          flex: 1, minWidth: 0,
          border: 'none', outline: 'none', background: 'transparent',
          padding: '8px 0',
          fontSize: 13, fontWeight: 500,
          color: 'var(--foreground)',
          fontFamily: 'var(--font-sans)',
          fontVariantNumeric: numeric ? 'tabular-nums' : 'normal',
        }}
      />
      {suffix && <span style={{ color: 'var(--muted-foreground)', fontSize: 12, marginLeft: 4 }}>{suffix}</span>}
    </div>
  );
}

function SheetSectionHeader({ icon, title, hint }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, paddingBottom: 2 }}>
      <span style={{
        width: 28, height: 28, borderRadius: 8,
        background: 'color-mix(in oklch, var(--primary) 10%, transparent)',
        color: 'var(--rose-700)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>{icon}</span>
      <div style={{ minWidth: 0, paddingTop: 2 }}>
        <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.005em', color: 'var(--foreground)' }}>{title}</div>
        {hint && <div style={{ fontSize: 12, color: 'var(--muted-foreground)', marginTop: 2, lineHeight: 1.45 }}>{hint}</div>}
      </div>
    </div>
  );
}

// A tidy row used several times inside section cards.
function SettingRow({ label, sublabel, control, last }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 0',
      borderBottom: last ? 'none' : '1px solid var(--border)',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--foreground)' }}>{label}</div>
        {sublabel && <div style={{ fontSize: 11.5, color: 'var(--muted-foreground)', marginTop: 2 }}>{sublabel}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{control}</div>
    </div>
  );
}

// ---------- Section: Card fee default ----------
function CardFeeSection({ draft, patch, counts }) {
  return (
    <section style={sectionCard}>
      <SheetSectionHeader
        icon={<PIcCard size={15} />}
        title="Card fee default"
        hint="The deduction taken from a tech's payout when a service is paid by card. A per-service custom amount or exempt setting always overrides this default."
      />

      {/* Amount + apply-when methods */}
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 14, alignItems: 'center', marginTop: 14 }}>
        <label style={{ fontSize: 12.5, color: 'var(--foreground)', fontWeight: 500 }}>Deduct</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <SheetTextInput
            width={92}
            prefix="$"
            numeric
            value={(draft.cardFeeDefaultCents / 100).toString()}
            onChange={v => patch({ cardFeeDefaultCents: Math.round(Number(v) * 100) || 0 })}
            ariaLabel="Card fee amount"
          />
          <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>per qualifying service</span>
        </div>

        <label style={{ fontSize: 12.5, color: 'var(--foreground)', fontWeight: 500, alignSelf: 'flex-start', paddingTop: 8 }}>When paid by</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {PAYMENT_METHODS.map(m => {
            const on = draft.cardFeeMethods.includes(m.id);
            return (
              <button key={m.id} type="button"
                onClick={() => patch({
                  cardFeeMethods: on
                    ? draft.cardFeeMethods.filter(x => x !== m.id)
                    : [...draft.cardFeeMethods, m.id],
                })}
                aria-pressed={on}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '6px 10px 6px 8px',
                  background: on ? 'color-mix(in oklch, var(--primary) 12%, transparent)' : 'var(--card)',
                  color: on ? 'var(--rose-700)' : 'var(--muted-foreground)',
                  border: '1px solid ' + (on ? 'color-mix(in oklch, var(--primary) 35%, transparent)' : 'var(--border)'),
                  borderRadius: 999,
                  fontSize: 12, fontWeight: 500,
                  cursor: 'pointer', fontFamily: 'var(--font-sans)',
                  transition: 'background 150ms var(--ease-out), border-color 150ms var(--ease-out)',
                }}>
                <span style={{
                  width: 14, height: 14, borderRadius: 3,
                  background: on ? 'var(--primary)' : 'transparent',
                  border: '1px solid ' + (on ? 'var(--primary)' : 'var(--input)'),
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  color: 'white',
                }}>{on && <PIcCheck size={10} />}</span>
                {m.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Apply-to categories */}
      <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontSize: 12.5, color: 'var(--foreground)', fontWeight: 500 }}>Apply by default to</div>
          <div style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>Per-service overrides still apply</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--card)', overflow: 'hidden' }}>
          {CATEGORY_ORDER.map((c, idx) => {
            const on = draft.cardFeeMainCategories.includes(c);
            const onLeft = idx % 2 === 0;
            const isLastRow = idx >= CATEGORY_ORDER.length - (CATEGORY_ORDER.length % 2 || 2);
            return (
              <label key={c} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px',
                cursor: 'pointer',
                borderRight: onLeft ? '1px solid var(--border)' : 'none',
                borderBottom: isLastRow ? 'none' : '1px solid var(--border)',
                userSelect: 'none',
              }}>
                <SheetCheckbox
                  checked={on}
                  onChange={() => patch({
                    cardFeeMainCategories: on
                      ? draft.cardFeeMainCategories.filter(x => x !== c)
                      : [...draft.cardFeeMainCategories, c],
                  })}
                />
                <span style={{ fontSize: 13, color: 'var(--foreground)', fontWeight: 500, flex: 1 }}>{c}</span>
                <span className="tnum" style={{ fontSize: 11, color: 'var(--muted-foreground)', fontWeight: 500 }}>{counts.byCategory[c] ?? 0}</span>
              </label>
            );
          })}
        </div>
      </div>

      {/* Status summary */}
      <div style={{
        marginTop: 14, padding: '10px 12px',
        background: 'color-mix(in oklch, var(--muted) 40%, var(--background))',
        border: '1px solid var(--border)',
        borderRadius: 8,
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0,
      }}>
        <SummaryStat n={counts.default} label="Use default" />
        <SummaryStat n={counts.custom}  label="Custom" />
        <SummaryStat n={counts.exempt}  label="Exempt" />
      </div>
    </section>
  );
}

function SummaryStat({ n, label }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 8px', borderRight: '1px solid var(--border)' }}>
      <div className="tnum" style={{ fontSize: 17, fontWeight: 600, color: 'var(--foreground)', letterSpacing: '-0.005em' }}>{n}</div>
      <div style={{ fontSize: 11, color: 'var(--muted-foreground)', fontWeight: 500 }}>{label}</div>
    </div>
  );
}

// ---------- Section: Supply types ----------
// First-class supply-type entity. Each row: rename, see how many services
// reference it, archive (only when unused). Adding a new type happens
// inline at the top — the same SupplyTypePicker on the service edit panel
// can also create types, so this surface stays unobtrusive.
function SupplyTypesSection({ services, onJumpToService }) {
  const [types, setTypes] = useSupplyTypes();
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');

  // Group services that reference each type — for the inline detail rows.
  const rowsByType = useMemo(() => {
    const map = {};
    services.forEach(s => {
      if (!s.active || !s.supply?.type_id) return;
      (map[s.supply.type_id] ??= []).push(s);
    });
    return map;
  }, [services]);

  const visibleTypes = types.filter(t => !t.archived);

  function startRename(t) {
    setEditingId(t.id);
    setEditingName(t.name);
  }
  function commitRename() {
    const trimmed = editingName.trim();
    if (trimmed) {
      setTypes(prev => prev.map(t => t.id === editingId ? { ...t, name: trimmed } : t));
    }
    setEditingId(null);
    setEditingName('');
  }
  function cancelRename() { setEditingId(null); setEditingName(''); }
  function archive(id) {
    setTypes(prev => prev.map(t => t.id === id ? { ...t, archived: true } : t));
  }
  function commitAdd() {
    const created = addSupplyType(newName);
    setNewName('');
    setAdding(false);
    if (!created) return;
  }

  return (
    <section style={sectionCard}>
      <SheetSectionHeader
        icon={<PIcBox size={15} />}
        title="Supply types"
        hint={
          <>
            The catalog of supply costs the salon can deduct. Each service supply
            references a type by id, so renaming here updates everywhere —
            including tech-level exemptions in <strong>Settings → Staff</strong>.
          </>
        }
      />

      <div style={{ marginTop: 12, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: 'var(--card)' }}>
        {visibleTypes.map((t, idx) => {
          const rows = rowsByType[t.id] || [];
          const isLast = idx === visibleTypes.length - 1 && !adding;
          const usageCount = rows.length;
          const isEditing = editingId === t.id;
          return (
            <div key={t.id} style={{
              borderBottom: isLast ? 'none' : '1px solid var(--border)',
            }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto auto',
                alignItems: 'center', gap: 12,
                padding: '10px 12px',
              }}>
                {isEditing ? (
                  <input
                    value={editingName}
                    onChange={e => setEditingName(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={e => {
                      if (e.key === 'Enter')  { e.preventDefault(); commitRename(); }
                      if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
                    }}
                    autoFocus
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      fontSize: 13, fontFamily: 'var(--font-sans)',
                      border: '1px solid var(--ring)',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--background)',
                      color: 'var(--foreground)',
                      outline: 'none',
                    }}
                  />
                ) : (
                  <button type="button" onClick={() => startRename(t)} title="Click to rename"
                    style={{
                      display: 'flex', alignItems: 'baseline', gap: 8,
                      background: 'transparent', border: 'none', cursor: 'text',
                      textAlign: 'left', padding: 0, fontFamily: 'var(--font-sans)',
                      minWidth: 0,
                    }}>
                    <span style={{
                      fontSize: 13, fontWeight: 500, color: 'var(--foreground)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{t.name}</span>
                    <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>
                      {usageCount === 0 ? 'unused' : `${usageCount} ${usageCount === 1 ? 'service' : 'services'}`}
                    </span>
                  </button>
                )}

                <span style={{
                  fontSize: 11, color: 'var(--muted-foreground)',
                  padding: '2px 8px',
                  background: 'var(--muted)',
                  borderRadius: 999,
                  whiteSpace: 'nowrap',
                  fontFamily: 'var(--font-mono, ui-monospace)',
                }}>{t.id}</span>

                {!isEditing && (
                  <button type="button"
                    onClick={() => archive(t.id)}
                    disabled={usageCount > 0}
                    title={usageCount > 0 ? `In use by ${usageCount} ${usageCount === 1 ? 'service' : 'services'}` : 'Archive'}
                    style={{
                      padding: '4px 8px',
                      background: 'transparent',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 11, color: 'var(--muted-foreground)',
                      cursor: usageCount > 0 ? 'not-allowed' : 'pointer',
                      opacity: usageCount > 0 ? 0.4 : 1,
                      fontFamily: 'var(--font-sans)',
                    }}>
                    Archive
                  </button>
                )}
              </div>

              {/* Service rows referencing this type */}
              {rows.length > 0 && (
                <div style={{
                  background: 'color-mix(in oklch, var(--muted) 50%, var(--background))',
                  borderTop: '1px solid var(--border)',
                }}>
                  {rows.map((r, ri) => (
                    <button key={r.id} type="button" onClick={() => onJumpToService?.(r.id)}
                      style={{
                        width: '100%',
                        display: 'grid',
                        gridTemplateColumns: 'auto 1fr auto auto',
                        alignItems: 'center', gap: 10,
                        padding: '7px 12px 7px 22px',
                        background: 'transparent', border: 'none',
                        borderBottom: ri === rows.length - 1 ? 'none' : '1px solid var(--border)',
                        cursor: 'pointer', textAlign: 'left',
                        fontFamily: 'var(--font-sans)',
                      }}>
                      <span aria-hidden="true" style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: `var(${r.color_token})`,
                        flexShrink: 0,
                      }} />
                      <span style={{
                        fontSize: 12, color: 'var(--foreground)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{r.name}</span>
                      <span className="tnum" style={{
                        fontSize: 11.5, color: 'oklch(0.45 0.14 75)', fontWeight: 600,
                      }}>−{fmtPrice(r.supply.amount_cents)}</span>
                      <PIcArrowR size={12} style={{ color: 'var(--muted-foreground)' }} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Add row */}
        {adding ? (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '10px 12px',
            borderTop: visibleTypes.length > 0 ? '1px solid var(--border)' : 'none',
            background: 'var(--muted)',
          }}>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter')  { e.preventDefault(); commitAdd(); }
                if (e.key === 'Escape') { e.preventDefault(); setAdding(false); setNewName(''); }
              }}
              autoFocus
              placeholder="e.g. Builder gel, Polygel"
              style={{
                flex: 1, minWidth: 0,
                padding: '6px 8px',
                fontSize: 13, fontFamily: 'var(--font-sans)',
                border: '1px solid var(--input)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--background)',
                color: 'var(--foreground)',
                outline: 'none',
              }}
            />
            <button type="button" onClick={commitAdd} disabled={!newName.trim()}
              style={{
                padding: '6px 12px',
                background: 'var(--primary)', color: 'var(--primary-foreground)',
                border: 'none', borderRadius: 'var(--radius-sm)',
                fontSize: 12, fontWeight: 600,
                cursor: newName.trim() ? 'pointer' : 'not-allowed',
                opacity: newName.trim() ? 1 : 0.4,
                fontFamily: 'var(--font-sans)',
              }}>Add</button>
            <button type="button" onClick={() => { setAdding(false); setNewName(''); }}
              style={{
                padding: '6px 10px',
                background: 'transparent', color: 'var(--muted-foreground)',
                border: 'none', borderRadius: 'var(--radius-sm)',
                fontSize: 12, cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
              }}>Cancel</button>
          </div>
        ) : (
          <button type="button" onClick={() => setAdding(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              width: '100%',
              padding: '10px 12px',
              borderTop: visibleTypes.length > 0 ? '1px solid var(--border)' : 'none',
              background: 'transparent', border: 'none',
              cursor: 'pointer', textAlign: 'left',
              fontSize: 13, color: 'var(--rose-700)', fontWeight: 500,
              fontFamily: 'var(--font-sans)',
            }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add supply type
          </button>
        )}
      </div>

      <p style={{ marginTop: 8, fontSize: 11, color: 'var(--muted-foreground)', lineHeight: 1.5 }}>
        Tip: click a name to rename. Types in use can't be archived until you reassign or remove the services that reference them.
      </p>
    </section>
  );
}

// ---------- The sheet ----------
function EditPolicySheet({ open, onClose, policy, services, onSave, onJumpToService }) {
  const { mounted, entered } = useMountAnim(open, 220);
  const [draft, setDraft] = useState(() => initPolicyDraft(policy));
  const initialDraftRef = useRef(draft);

  // Re-init when the sheet is freshly opened (so cancel actually cancels).
  useEffect(() => {
    if (open) {
      const fresh = initPolicyDraft(policy);
      setDraft(fresh);
      initialDraftRef.current = fresh;
    }
  }, [open, policy]);

  // Esc to close
  useEffect(() => {
    if (!mounted) return;
    function onKey(e) { if (e.key === 'Escape') onClose?.(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mounted, onClose]);

  const counts = useMemo(() => {
    const c = { default: 0, custom: 0, exempt: 0, supply: 0, byCategory: {} };
    services.forEach(s => {
      if (!s.active) return;
      const m = s.cardFee?.mode ?? 'default';
      c[m]++;
      if (s.supply) c.supply++;
      c.byCategory[s.category] = (c.byCategory[s.category] ?? 0) + 1;
    });
    return c;
  }, [services]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(initialDraftRef.current);

  function patch(p) { setDraft(d => ({ ...d, ...p })); }

  if (!mounted) return null;

  return (
    <div
      aria-modal="true" role="dialog" aria-labelledby="ep-title"
      style={{
        position: 'absolute', inset: 0,
        zIndex: 50,
        pointerEvents: 'auto',
      }}>
      {/* Scrim */}
      <button type="button" aria-label="Close policy editor" onClick={onClose}
        style={{
          position: 'absolute', inset: 0,
          background: 'rgb(0 0 0 / 0.42)',
          border: 'none', padding: 0, cursor: 'pointer',
          opacity: entered ? 1 : 0,
          transition: 'opacity 200ms var(--ease-out)',
        }} />

      {/* Sheet */}
      <aside
        style={{
          position: 'absolute', top: 0, right: 0, bottom: 0,
          width: 560, maxWidth: '92%',
          background: 'var(--background)',
          borderLeft: '1px solid var(--border)',
          boxShadow: '-12px 0 32px -8px rgb(0 0 0 / 0.18)',
          display: 'flex', flexDirection: 'column',
          transform: entered ? 'translateX(0)' : 'translateX(24px)',
          opacity: entered ? 1 : 0,
          transition: 'transform 220ms var(--ease-out), opacity 220ms var(--ease-out)',
        }}>
        {/* Header */}
        <header style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
          padding: '20px 22px 16px',
          borderBottom: '1px solid var(--border)',
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted-foreground)', fontWeight: 600, marginBottom: 4 }}>Services policy</div>
            <h2 id="ep-title" style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em', margin: 0, lineHeight: 1.2 }}>Edit policy</h2>
            <p style={{ fontSize: 12.5, color: 'var(--muted-foreground)', marginTop: 6, lineHeight: 1.5 }}>
              Card-fee defaults and the supply-deduction catalog that apply across your whole menu. Per-service settings can still override these. Per-tech exemptions live in Staff Settings.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            style={{
              padding: 8,
              background: 'transparent',
              border: '1px solid transparent', borderRadius: 8,
              color: 'var(--muted-foreground)', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent)'; e.currentTarget.style.color = 'var(--foreground)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--muted-foreground)'; }}>
            <PIcX size={16} />
          </button>
        </header>

        {/* Body */}
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '18px 22px 12px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <CardFeeSection draft={draft} patch={patch} counts={counts} />
          <SupplyTypesSection services={services} onJumpToService={(id) => { onJumpToService?.(id); onClose?.(); }} />

          <p style={{
            fontSize: 11.5, color: 'var(--muted-foreground)',
            margin: '4px 2px 0', lineHeight: 1.55,
          }}>
            Changes take effect on new appointments and payouts. They don't recalc closed days or settled payouts.
          </p>
        </div>

        {/* Footer */}
        <footer style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          padding: '14px 22px',
          borderTop: '1px solid var(--border)',
          background: 'var(--card)',
        }}>
          <div style={{ fontSize: 11.5, color: 'var(--muted-foreground)' }}>
            {dirty
              ? <span><strong style={{ color: 'var(--foreground)', fontWeight: 600 }}>Unsaved changes</strong> — apply to take effect.</span>
              : <span>No changes yet.</span>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={onClose} style={epGhostBtn}>Cancel</button>
            <button type="button" onClick={() => { onSave?.(draft); onClose?.(); }}
              disabled={!dirty}
              style={{ ...epPrimaryBtn, opacity: dirty ? 1 : 0.55, cursor: dirty ? 'pointer' : 'default' }}>
              Save policy
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}

function initPolicyDraft(policy) {
  return {
    cardFeeDefaultCents: policy.cardFeeDefaultCents,
    cardFeeMethods: [...(policy.cardFeeMethods ?? []).map(m => m.toLowerCase().replace(' card', '').replace('card', 'card') === 'card' ? 'card' : m)]
      // The data file stores ['Card', 'Gift card']; normalize to ids.
      .map(m => m === 'Card' ? 'card' : m === 'Gift card' ? 'gift' : m === 'Cash' ? 'cash' : m === 'Venmo / Zelle' ? 'venmo' : m.toLowerCase()),
    cardFeeMainCategories: [...policy.cardFeeMainCategories],
  };
}

// ---------- Styles ----------
const sectionCard = {
  padding: 18,
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  boxShadow: 'var(--shadow-xs)',
};
const epPrimaryBtn = {
  padding: '8px 14px',
  background: 'var(--primary)', color: 'var(--primary-foreground)',
  border: 'none', borderRadius: 6,
  fontSize: 13, fontWeight: 600,
  fontFamily: 'var(--font-sans)',
  transition: 'background 150ms var(--ease-out)',
};
const epGhostBtn = {
  padding: '8px 12px',
  background: 'transparent', color: 'var(--foreground)',
  border: '1px solid var(--border)', borderRadius: 6,
  fontSize: 13, fontWeight: 500, cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
};

window.EditPolicySheet = EditPolicySheet;
