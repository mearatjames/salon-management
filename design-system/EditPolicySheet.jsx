// EditPolicySheet.jsx — right-side sheet for editing the global deductions policy
// surfaced from the V1 Refined two-pane Services page.
//
// What this controls:
//   1. Card fee default — amount, which payment methods trigger it,
//      which service categories get it by default. (Per-service overrides
//      still beat these — copy in the sheet says so.)
//   2. Exempt techs — owners / family / senior techs that never get any
//      deduction taken.
//   3. Supply deductions — read-only summary across the menu, since the
//      money lives per-service (configured in the Edit panel).
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
const PIcUsers    = PIco(<><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></>);
const PIcSearch   = PIco(<><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></>);
const PIcChev     = PIco(<path d="M9 18l6-6-6-6"/>);
const PIcArrowR   = PIco(<><path d="M5 12h14"/><path d="M13 5l7 7-7 7"/></>);

// Roster used for the "Add exempt tech" picker. In a real build this comes
// from the staff store; mocked here so the picker has plausible content.
const ALL_TECHS = [
  { id: 'maya',    name: 'Maya Tran',     initials: 'MA', color: '--avatar-rose',   role: 'Owner' },
  { id: 'linh',    name: 'Linh Pham',     initials: 'LI', color: '--avatar-green',  role: 'Family · senior tech' },
  { id: 'aria',    name: 'Aria Nguyen',   initials: 'AR', color: '--avatar-blue',   role: 'Tech' },
  { id: 'justine', name: 'Justine Kim',   initials: 'JU', color: '--avatar-amber',  role: 'Tech' },
  { id: 'sara',    name: 'Sara Patel',    initials: 'SA', color: '--avatar-purple', role: 'Tech' },
  { id: 'noor',    name: 'Noor Hassan',   initials: 'NO', color: '--avatar-teal',   role: 'Apprentice' },
  { id: 'priya',   name: 'Priya Shah',    initials: 'PR', color: '--avatar-orange', role: 'Tech' },
  { id: 'mei',     name: 'Mei Liu',       initials: 'ME', color: '--avatar-slate',  role: 'Front desk' },
];

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

// ---------- Section: Exempt techs ----------
function ExemptTechsSection({ draft, patch }) {
  const [addOpen, setAddOpen] = useState(false);
  const [q, setQ] = useState('');

  const exempt = useMemo(() =>
    draft.exemptTechIds.map(id => ALL_TECHS.find(t => t.id === id)).filter(Boolean),
    [draft.exemptTechIds]);

  const candidates = useMemo(() =>
    ALL_TECHS.filter(t =>
      !draft.exemptTechIds.includes(t.id) &&
      (!q || t.name.toLowerCase().includes(q.toLowerCase()) || t.role.toLowerCase().includes(q.toLowerCase()))
    ), [draft.exemptTechIds, q]);

  function addTech(id) {
    patch({ exemptTechIds: [...draft.exemptTechIds, id] });
    setQ('');
    // keep picker open so adding multiple feels fast
  }
  function removeTech(id) {
    patch({ exemptTechIds: draft.exemptTechIds.filter(x => x !== id) });
  }

  return (
    <section style={sectionCard}>
      <SheetSectionHeader
        icon={<PIcUsers size={15} />}
        title="Exempt techs"
        hint="These techs never have deductions taken — typically owners, family, or senior leads paid on a different model."
      />

      {/* Chip list */}
      <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {exempt.map(t => (
          <span key={t.id} style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '4px 6px 4px 4px',
            background: 'var(--muted)',
            border: '1px solid var(--border)',
            borderRadius: 999,
            fontSize: 12.5, fontWeight: 500,
          }}>
            <span style={{
              width: 24, height: 24, borderRadius: '50%',
              background: `var(${t.color})`, color: 'white',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10.5, fontWeight: 600,
            }}>{t.initials}</span>
            <span>{t.name}</span>
            <span style={{ fontSize: 11, color: 'var(--muted-foreground)', fontWeight: 400 }}>· {t.role}</span>
            <button type="button" onClick={() => removeTech(t.id)} aria-label={`Remove ${t.name}`}
              style={{
                marginLeft: 2,
                width: 18, height: 18, padding: 0,
                background: 'transparent',
                border: 'none', borderRadius: 999,
                color: 'var(--muted-foreground)',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer',
              }}>
              <PIcX size={12} />
            </button>
          </span>
        ))}
        <button type="button" onClick={() => setAddOpen(o => !o)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '6px 12px',
            background: addOpen ? 'var(--accent)' : 'transparent',
            color: addOpen ? 'var(--foreground)' : 'var(--muted-foreground)',
            border: '1px dashed var(--border)',
            borderRadius: 999,
            fontSize: 12, fontWeight: 500,
            cursor: 'pointer', fontFamily: 'var(--font-sans)',
          }}>
          <PIcPlus size={12} /> Add tech
        </button>
      </div>

      {/* Picker */}
      {addOpen && (
        <div style={{
          marginTop: 12,
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          boxShadow: 'var(--shadow-xs)',
          overflow: 'hidden',
        }}>
          <label style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 12px',
            borderBottom: '1px solid var(--border)',
          }}>
            <PIcSearch size={14} style={{ color: 'var(--muted-foreground)' }} />
            <input
              type="search" value={q} onChange={e => setQ(e.target.value)}
              placeholder="Search techs"
              autoFocus
              style={{
                flex: 1, border: 'none', outline: 'none', background: 'transparent',
                fontSize: 13, fontFamily: 'var(--font-sans)', color: 'var(--foreground)',
              }} />
          </label>
          <div style={{ maxHeight: 168, overflow: 'auto' }}>
            {candidates.length === 0 ? (
              <div style={{ padding: '14px 12px', fontSize: 12, color: 'var(--muted-foreground)', textAlign: 'center' }}>
                No more techs to add.
              </div>
            ) : candidates.map(t => (
              <button key={t.id} type="button" onClick={() => addTech(t.id)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 12px',
                  background: 'transparent', border: 'none',
                  cursor: 'pointer', textAlign: 'left',
                  fontFamily: 'var(--font-sans)',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--accent)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <span style={{
                  width: 24, height: 24, borderRadius: '50%',
                  background: `var(${t.color})`, color: 'white',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10.5, fontWeight: 600,
                }}>{t.initials}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--foreground)' }}>{t.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>{t.role}</div>
                </div>
                <PIcPlus size={14} style={{ color: 'var(--muted-foreground)' }} />
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ---------- Section: Supply deductions summary ----------
function SupplySection({ services, onJumpToService }) {
  const supplyRows = useMemo(() =>
    services.filter(s => s.active && s.supply)
      .map(s => ({ id: s.id, name: s.name, category: s.category, amount: s.supply.amount_cents, label: s.supply.label, color: s.color_token }))
  , [services]);

  return (
    <section style={sectionCard}>
      <SheetSectionHeader
        icon={<PIcBox size={15} />}
        title="Supply deductions"
        hint={
          <>
            Supply amounts live on the service itself — these apply to every payment method.
            Edit the amount or label by selecting a service.
          </>
        }
      />

      {supplyRows.length === 0 ? (
        <div style={{ marginTop: 12, padding: '18px 12px', textAlign: 'center', fontSize: 12.5, color: 'var(--muted-foreground)', border: '1px dashed var(--border)', borderRadius: 8 }}>
          No supply deductions yet. Add one on a service to deduct cost-of-goods from a tech's payout.
        </div>
      ) : (
        <div style={{ marginTop: 12, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: 'var(--card)' }}>
          {supplyRows.map((r, idx) => (
            <button key={r.id} type="button" onClick={() => onJumpToService?.(r.id)}
              className="ep-supply-row"
              style={{
                width: '100%',
                display: 'grid',
                gridTemplateColumns: 'auto 1fr auto auto',
                alignItems: 'center', gap: 12,
                padding: '10px 12px',
                background: 'transparent', border: 'none',
                borderBottom: idx === supplyRows.length - 1 ? 'none' : '1px solid var(--border)',
                cursor: 'pointer', textAlign: 'left',
                fontFamily: 'var(--font-sans)',
              }}>
              <span aria-hidden="true" style={{
                width: 10, height: 10, borderRadius: '50%',
                background: `var(${r.color})`,
                flexShrink: 0,
              }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                <div style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>{r.label}</div>
              </div>
              <span className="tnum" style={{
                fontSize: 12.5, color: 'oklch(0.45 0.14 75)', fontWeight: 600,
                padding: '2px 8px',
                background: 'color-mix(in oklch, var(--amber-500) 14%, transparent)',
                borderRadius: 999,
              }}>−{fmtPrice(r.amount)}</span>
              <PIcArrowR size={14} style={{ color: 'var(--muted-foreground)' }} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------- The sheet ----------
function EditPolicySheet({ open, onClose, policy, services, exemptTechIds, onSave, onJumpToService }) {
  const { mounted, entered } = useMountAnim(open, 220);
  const [draft, setDraft] = useState(() => initPolicyDraft(policy, exemptTechIds));
  const initialDraftRef = useRef(draft);

  // Re-init when the sheet is freshly opened (so cancel actually cancels).
  useEffect(() => {
    if (open) {
      const fresh = initPolicyDraft(policy, exemptTechIds);
      setDraft(fresh);
      initialDraftRef.current = fresh;
    }
  }, [open, policy, exemptTechIds]);

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
              Card-fee defaults and exempt techs that apply across your whole menu. Per-service settings can still override these.
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
          <ExemptTechsSection draft={draft} patch={patch} />
          <SupplySection services={services} onJumpToService={(id) => { onJumpToService?.(id); onClose?.(); }} />

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

function initPolicyDraft(policy, exemptTechIds) {
  return {
    cardFeeDefaultCents: policy.cardFeeDefaultCents,
    cardFeeMethods: [...(policy.cardFeeMethods ?? []).map(m => m.toLowerCase().replace(' card', '').replace('card', 'card') === 'card' ? 'card' : m)]
      // The data file stores ['Card', 'Gift card']; normalize to ids.
      .map(m => m === 'Card' ? 'card' : m === 'Gift card' ? 'gift' : m === 'Cash' ? 'cash' : m === 'Venmo / Zelle' ? 'venmo' : m.toLowerCase()),
    cardFeeMainCategories: [...policy.cardFeeMainCategories],
    exemptTechIds: [...exemptTechIds],
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
window.__LACQUER_ROSTER = ALL_TECHS;
