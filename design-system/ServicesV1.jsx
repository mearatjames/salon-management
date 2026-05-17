// ServicesV1.jsx — Variation 1: Refined two-pane services page.
// "Calm, on-brand, close to current Lacquer idiom."
//
// Layout:
//   - Title bar with summary + Add service
//   - Slim card-fee policy strip (global default + exempt techs)
//   - Two-pane: grouped list on the left, always-visible edit panel on the right
//   - Edit panel has a dedicated "Deductions" card with hybrid card-fee mode
//     (default / custom / exempt) + per-service supply deduction
//   - List rows show small deduction chips inline

const { useState, useMemo, useEffect } = React;

// ---------- Icons (Lucide-style, 1.5px stroke) ----------
const Ico = (paths) => ({ size = 16, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...rest}>{paths}</svg>
);
const IcSearch    = Ico(<><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></>);
const IcPlus      = Ico(<path d="M12 5v14M5 12h14"/>);
const IcInfo      = Ico(<><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></>);
const IcChev      = Ico(<path d="M9 18l6-6-6-6"/>);
const IcCheck     = Ico(<path d="M5 12l5 5L20 7"/>);
const IcCard      = Ico(<><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></>);
const IcBox       = Ico(<><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></>);
const IcArchive   = Ico(<><rect x="3" y="3" width="18" height="4" rx="1"/><path d="M5 7v12a2 2 0 002 2h10a2 2 0 002-2V7M10 12h4"/></>);
const IcUserMinus = Ico(<><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="17" y1="11" x2="23" y2="11"/></>);
const IcX         = Ico(<path d="M18 6L6 18M6 6l12 12"/>);

// ---------- Small primitives ----------
function DeductionChip({ kind, amount, label, dense }) {
  // kind: 'card' | 'supply' | 'exempt' | 'custom'
  const tone = {
    card:    { bg: 'color-mix(in oklch, var(--info) 12%, transparent)',        fg: 'oklch(0.45 0.13 240)', label: '' },
    supply:  { bg: 'color-mix(in oklch, var(--amber-500) 16%, transparent)',   fg: 'oklch(0.45 0.14 75)',  label: '' },
    exempt:  { bg: 'var(--secondary)',                                          fg: 'var(--muted-foreground)', label: '' },
    custom:  { bg: 'color-mix(in oklch, var(--primary) 14%, transparent)',     fg: 'var(--rose-700)',      label: '' },
  }[kind];
  return (
    <span className="v1-ded-chip tnum" style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: dense ? '1px 6px' : '2px 8px',
      background: tone.bg, color: tone.fg,
      borderRadius: 999,
      fontSize: dense ? 10.5 : 11, fontWeight: 500,
      whiteSpace: 'nowrap', lineHeight: 1.4,
    }}>
      {tone.label}{amount}{label ? <span style={{ opacity: 0.78, fontWeight: 400 }}>&nbsp;{label}</span> : null}
    </span>
  );
}

function Segmented({ value, onChange, options }) {
  return (
    <div role="radiogroup" style={{
      display: 'inline-grid',
      gridTemplateColumns: `repeat(${options.length}, 1fr)`,
      gap: 2,
      padding: 3,
      background: 'var(--muted)',
      border: '1px solid var(--border)',
      borderRadius: 8,
    }}>
      {options.map(o => {
        const active = o.value === value;
        return (
          <button key={o.value} type="button" onClick={() => onChange(o.value)}
            role="radio" aria-checked={active}
            style={{
              padding: '6px 10px',
              background: active ? 'var(--card)' : 'transparent',
              color: active ? 'var(--foreground)' : 'var(--muted-foreground)',
              border: 'none',
              borderRadius: 6,
              fontSize: 12.5, fontWeight: active ? 600 : 500,
              cursor: 'pointer',
              boxShadow: active ? 'var(--shadow-xs)' : 'none',
              transition: 'background 150ms var(--ease-out)',
              fontFamily: 'var(--font-sans)',
            }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Switch({ checked, onChange, ariaLabel }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      style={{
        width: 32, height: 18, padding: 2,
        background: checked ? 'var(--primary)' : 'var(--muted)',
        border: '1px solid ' + (checked ? 'var(--primary)' : 'var(--border)'),
        borderRadius: 999,
        position: 'relative', cursor: 'pointer',
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

// ---------- Policy strip ----------
function PolicyStrip({ services, policy, exemptTechs, onEditPolicy }) {
  const counts = useMemo(() => {
    const c = { default: 0, custom: 0, exempt: 0, supply: 0 };
    services.forEach(s => {
      if (!s.active) return;
      const m = s.cardFee?.mode ?? 'default';
      c[m]++;
      if (s.supply) c.supply++;
    });
    return c;
  }, [services]);

  return (
    <div className="v1-policy" style={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr 1fr auto',
      alignItems: 'stretch',
      gap: 0,
      padding: 0,
      background: 'var(--card)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      overflow: 'hidden',
    }}>
      <div style={{ padding: '14px 18px', borderRight: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <IcCard size={14} style={{ color: 'var(--muted-foreground)' }} />
          <div style={{ fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted-foreground)', fontWeight: 500 }}>Card fee default</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <div className="tnum" style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em' }}>{fmtPrice(policy.cardFeeDefaultCents)}</div>
          <div style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>per qualifying service</div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 4 }}>{policy.cardFeeMethods.join(' · ')} · {counts.default} services use default</div>
      </div>

      <div style={{ padding: '14px 18px', borderRight: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <IcBox size={14} style={{ color: 'var(--muted-foreground)' }} />
          <div style={{ fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted-foreground)', fontWeight: 500 }}>Supply deductions</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <div className="tnum" style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em' }}>{counts.supply}</div>
          <div style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>services</div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 4 }}>Chrome · Cat-eye · OPI · GelX tips</div>
      </div>

      <div style={{ padding: '14px 18px', borderRight: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <IcUserMinus size={14} style={{ color: 'var(--muted-foreground)' }} />
          <div style={{ fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted-foreground)', fontWeight: 500 }}>Exempt techs</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
          {exemptTechs.map(t => (
            <span key={t.id} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '3px 8px 3px 3px',
              background: 'var(--muted)',
              borderRadius: 999,
              fontSize: 12, fontWeight: 500,
            }}>
              <span style={{
                width: 20, height: 20, borderRadius: '50%',
                background: `var(${t.color})`, color: 'white',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 9.5, fontWeight: 600,
              }}>{t.initials}</span>
              {t.name}
            </span>
          ))}
          <button type="button" style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '4px 10px',
            background: 'transparent',
            color: 'var(--muted-foreground)',
            border: '1px dashed var(--border)',
            borderRadius: 999,
            fontSize: 11.5, fontWeight: 500,
            cursor: 'pointer', fontFamily: 'var(--font-sans)',
          }}>
            <IcPlus size={11} /> Add
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 6 }}>No deductions apply to these techs.</div>
      </div>

      <button type="button" onClick={onEditPolicy} aria-label="Edit policy"
        className="v1-edit-policy"
        style={{
          padding: '0 18px',
          background: 'transparent',
          color: 'var(--muted-foreground)',
          border: 'none',
          borderLeft: '1px solid var(--border)',
          fontSize: 12, fontWeight: 500, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 6,
          fontFamily: 'var(--font-sans)',
          transition: 'background 150ms var(--ease-out), color 150ms var(--ease-out)',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent)'; e.currentTarget.style.color = 'var(--foreground)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--muted-foreground)'; }}>
        Edit policy <IcChev size={14} />
      </button>
    </div>
  );
}

// ---------- List ----------
function CatalogRow({ service, selected, onSelect, density }) {
  const cf = effectiveCardFeeCents(service);
  const cfMode = service.cardFee?.mode ?? 'default';
  const isCompact = density === 'compact';

  return (
    <button type="button" onClick={() => onSelect(service.id)}
      className="v1-row"
      data-selected={selected ? 'true' : 'false'}
      data-archived={!service.active ? 'true' : 'false'}
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        alignItems: 'center',
        gap: 12,
        padding: isCompact ? '8px 14px' : '12px 14px',
        background: selected ? 'var(--accent)' : 'var(--card)',
        border: '1px solid ' + (selected ? 'var(--ring)' : 'var(--border)'),
        borderRadius: 10,
        cursor: 'pointer',
        textAlign: 'left',
        opacity: service.active ? 1 : 0.55,
        boxShadow: selected ? 'var(--shadow-xs)' : 'none',
        fontFamily: 'var(--font-sans)',
        transition: 'background 150ms var(--ease-out), border-color 150ms var(--ease-out)',
      }}>
      <span aria-hidden="true" style={{
        width: 14, height: 14, borderRadius: '50%',
        background: `var(${service.color_token})`,
        border: '1px solid color-mix(in oklch, currentColor 12%, transparent)',
        flexShrink: 0,
      }} />
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: isCompact ? 0 : 2 }}>
        <div style={{
          display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0,
        }}>
          <span style={{
            fontSize: isCompact ? 13 : 13.5,
            fontWeight: 500,
            color: 'var(--foreground)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{service.name}</span>
          {!service.active && (
            <span style={{
              fontSize: 9.5, letterSpacing: '0.05em', textTransform: 'uppercase',
              padding: '1px 6px', borderRadius: 4,
              background: 'var(--muted)', color: 'var(--muted-foreground)',
              fontWeight: 500,
            }}>archived</span>
          )}
        </div>
        {!isCompact && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {cf != null && cfMode === 'default' && (
              <DeductionChip kind="card" amount="$3" label="card fee" dense />
            )}
            {cf != null && cfMode === 'custom' && (
              <DeductionChip kind="custom" amount={fmtPrice(cf)} label="card fee" dense />
            )}
            {service.supply && (
              <DeductionChip kind="supply" amount={fmtPrice(service.supply.amount_cents)} label={service.supply.label} dense />
            )}
            {cf == null && service.cardFee?.mode === 'exempt' && (
              <DeductionChip kind="exempt" amount="No fees" dense />
            )}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        {isCompact && cf != null && cfMode === 'default' && <DeductionChip kind="card" amount="$3" dense />}
        {isCompact && service.supply && <DeductionChip kind="supply" amount={fmtPrice(service.supply.amount_cents)} dense />}
        <span className="tnum" style={{
          fontSize: 11.5, color: 'var(--muted-foreground)', fontWeight: 500,
        }}>{service.duration_min}m</span>
        <span className="tnum" style={{
          fontSize: 13, color: 'var(--foreground)', fontWeight: 600,
          minWidth: 48, textAlign: 'right',
        }}>{priceLabel(service)}</span>
      </div>
    </button>
  );
}

function CatalogList({ services, selectedId, onSelect, density }) {
  const [q, setQ] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const groups = useMemo(() => {
    const filtered = services.filter(s => {
      if (!showArchived && !s.active) return false;
      if (q && !s.name.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
    const byCat = new Map();
    filtered.forEach(s => {
      if (!byCat.has(s.category)) byCat.set(s.category, []);
      byCat.get(s.category).push(s);
    });
    return CATEGORY_ORDER.filter(c => byCat.has(c)).map(c => ({ category: c, items: byCat.get(c) }));
  }, [services, q, showArchived]);

  return (
    <section className="v1-list" style={{
      display: 'flex', flexDirection: 'column', gap: 12,
      minWidth: 0,
    }}>
      {/* Search & filter row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <label style={{
          flex: 1,
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '8px 12px',
          background: 'var(--card)',
          border: '1px solid var(--input)',
          borderRadius: 8,
        }}>
          <IcSearch size={15} style={{ color: 'var(--muted-foreground)' }} />
          <input
            type="search" value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search services"
            style={{
              flex: 1, border: 'none', outline: 'none', background: 'transparent',
              fontSize: 13, color: 'var(--foreground)',
              fontFamily: 'var(--font-sans)',
            }} />
        </label>
        <label style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          fontSize: 12, color: 'var(--muted-foreground)',
          cursor: 'pointer', userSelect: 'none',
          padding: '8px 12px',
        }}>
          <Switch checked={showArchived} onChange={setShowArchived} ariaLabel="Show archived" />
          <span>Archived</span>
        </label>
      </div>

      {/* Groups */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {groups.map(group => (
          <div key={group.category}>
            <div style={{
              display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
              padding: '0 4px 8px', marginBottom: 4,
            }}>
              <h3 style={{
                fontSize: 10.5, letterSpacing: '0.07em', textTransform: 'uppercase',
                color: 'var(--muted-foreground)', fontWeight: 600,
              }}>{group.category}</h3>
              <span className="tnum" style={{ fontSize: 10.5, color: 'var(--muted-foreground)', fontWeight: 500 }}>{group.items.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {group.items.map(s => (
                <CatalogRow key={s.id} service={s} selected={s.id === selectedId} onSelect={onSelect} density={density} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------- Edit panel ----------
function FieldRow({ label, hint, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <label style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--foreground)' }}>{label}</label>
        {hint && <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function TextInput({ value, onChange, prefix, suffix, placeholder, numeric, width, disabled }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center',
      background: disabled ? 'var(--muted)' : 'var(--card)',
      border: '1px solid var(--input)',
      borderRadius: 6,
      padding: '0 10px',
      width,
      opacity: disabled ? 0.55 : 1,
    }}>
      {prefix && <span style={{ color: 'var(--muted-foreground)', fontSize: 13, marginRight: 4 }}>{prefix}</span>}
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        style={{
          flex: 1, minWidth: 0,
          border: 'none', outline: 'none', background: 'transparent',
          padding: '8px 0',
          fontSize: 13,
          color: 'var(--foreground)',
          fontFamily: 'var(--font-sans)',
          fontVariantNumeric: numeric ? 'tabular-nums' : 'normal',
        }}
      />
      {suffix && <span style={{ color: 'var(--muted-foreground)', fontSize: 12, marginLeft: 4 }}>{suffix}</span>}
    </div>
  );
}

function ColorSwatches({ value, onChange }) {
  const options = [
    '--avatar-rose', '--avatar-blue', '--avatar-green', '--avatar-amber',
    '--avatar-purple', '--avatar-teal', '--avatar-orange', '--avatar-slate',
  ];
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {options.map(t => {
        const active = t === value;
        return (
          <button key={t} type="button" onClick={() => onChange(t)} aria-label={t}
            style={{
              width: 26, height: 26, borderRadius: '50%',
              background: `var(${t})`,
              border: 'none', cursor: 'pointer',
              boxShadow: active ? `0 0 0 2px var(--background), 0 0 0 4px var(${t})` : 'none',
              transition: 'box-shadow 150ms var(--ease-out)',
            }} />
        );
      })}
    </div>
  );
}

function EditPanel({ service }) {
  const [draft, setDraft] = useState(() => initDraft(service));
  // Re-init when service changes
  useEffect(() => { setDraft(initDraft(service)); }, [service?.id]);

  if (!service) {
    return (
      <aside className="v1-panel" style={emptyPanelStyle}>
        <div style={{ textAlign: 'center', maxWidth: 280 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 22,
            background: 'var(--muted)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 12, color: 'var(--muted-foreground)',
          }}>
            <IcInfo size={20} />
          </div>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--foreground)', marginBottom: 4 }}>Pick a service</div>
          <div style={{ fontSize: 12.5, color: 'var(--muted-foreground)' }}>Select a service on the left to edit its price, color, and deductions. Or add a new one.</div>
        </div>
      </aside>
    );
  }

  function patch(p) { setDraft(d => ({ ...d, ...p })); }
  function patchCardFee(p) { setDraft(d => ({ ...d, cardFee: { ...d.cardFee, ...p } })); }
  function patchSupply(p) {
    setDraft(d => ({ ...d, supply: { ...(d.supply ?? { amount_cents: 0, label: '' }), ...p } }));
  }

  const cardFeeCents = effectiveCardFeeCents({ cardFee: draft.cardFee });
  const priceCents = draft.variable_price
    ? (Number(draft.price_from) * 100 || 0)
    : (Number(draft.price) * 100 || 0);
  const supplyCents = draft.supply?.amount_cents ?? 0;
  const netCents = Math.max(0, priceCents - (cardFeeCents ?? 0) - supplyCents);

  return (
    <aside className="v1-panel" style={panelStyle}>
      {/* Panel header */}
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
        <span aria-hidden="true" style={{
          width: 26, height: 26, borderRadius: '50%',
          background: `var(${draft.color_token})`,
          border: '1px solid color-mix(in oklch, currentColor 14%, transparent)',
          flexShrink: 0,
        }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--foreground)', lineHeight: 1.25 }}>{draft.name || 'New service'}</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted-foreground)', marginTop: 2 }}>
            {draft.category || 'Uncategorized'} · {draft.duration_min || '—'} min · {priceCents > 0 ? fmtPrice(priceCents) : '—'}
          </div>
        </div>
        <button type="button" aria-label="Close" style={iconBtn}><IcX size={15} /></button>
      </header>

      {/* Scroll area */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 18, padding: '4px 0 8px' }}>

        {/* Basics */}
        <SectionTitle>Details</SectionTitle>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <FieldRow label="Service name">
            <TextInput value={draft.name} onChange={v => patch({ name: v })} placeholder="e.g. Gel polish" />
          </FieldRow>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FieldRow label="Category">
              <TextInput value={draft.category} onChange={v => patch({ category: v })} />
            </FieldRow>
            <FieldRow label="Duration" hint="minutes">
              <TextInput value={draft.duration_min} onChange={v => patch({ duration_min: v })} suffix="min" numeric />
            </FieldRow>
          </div>
          {draft.variable_price ? (
            <FieldRow label="Price range" hint="Variable">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <TextInput value={draft.price_from} onChange={v => patch({ price_from: v })} prefix="$" numeric />
                <TextInput value={draft.price_to} onChange={v => patch({ price_to: v })} prefix="$" numeric />
              </div>
            </FieldRow>
          ) : (
            <FieldRow label="Price">
              <TextInput value={draft.price} onChange={v => patch({ price: v })} prefix="$" numeric />
            </FieldRow>
          )}
          <FieldRow label="Variable price">
            <Switch checked={draft.variable_price} onChange={v => patch({ variable_price: v })} ariaLabel="Variable price" />
          </FieldRow>
          <FieldRow label="Color">
            <ColorSwatches value={draft.color_token} onChange={v => patch({ color_token: v })} />
          </FieldRow>
        </div>

        {/* DEDUCTIONS — the new section */}
        <SectionTitle
          title="Deductions"
          subtitle="What gets taken from this tech's payout."
          icon={<IcCard size={13} />}
        />
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 16,
          padding: 16,
          background: 'color-mix(in oklch, var(--muted) 55%, var(--background))',
          border: '1px solid var(--border)',
          borderRadius: 10,
        }}>

          {/* Card fee */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--foreground)' }}>Card fee</span>
                <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>when paid by card or gift card</span>
              </div>
            </div>
            <Segmented
              value={draft.cardFee.mode}
              onChange={mode => patchCardFee({ mode })}
              options={[
                { value: 'default', label: 'Default · $3' },
                { value: 'custom',  label: 'Custom' },
                { value: 'exempt',  label: 'Exempt' },
              ]}
            />
            {draft.cardFee.mode === 'custom' && (
              <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>Deduct</span>
                <TextInput
                  width={92}
                  value={String((draft.cardFee.custom_cents ?? 0) / 100)}
                  onChange={v => patchCardFee({ custom_cents: Math.round(Number(v) * 100) || 0 })}
                  prefix="$" numeric
                />
                <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>per service when paid by card</span>
              </div>
            )}
            {draft.cardFee.mode === 'exempt' && (
              <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--muted-foreground)' }}>
                Card fee never applies, regardless of payment method.
              </div>
            )}
          </div>

          {/* Supply */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--foreground)' }}>Supply deduction</span>
                <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>any payment method</span>
              </div>
              <Switch
                checked={!!draft.supply}
                onChange={v => setDraft(d => ({ ...d, supply: v ? (d.supply ?? { amount_cents: 500, label: '' }) : null }))}
                ariaLabel="Supply deduction"
              />
            </div>
            {draft.supply && (
              <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: 10, marginTop: 4 }}>
                <TextInput
                  value={String((draft.supply.amount_cents ?? 0) / 100)}
                  onChange={v => patchSupply({ amount_cents: Math.round(Number(v) * 100) || 0 })}
                  prefix="$" numeric
                />
                <TextInput
                  value={draft.supply.label ?? ''}
                  onChange={v => patchSupply({ label: v })}
                  placeholder="e.g. GelX tips & gel, Chrome powder"
                />
              </div>
            )}
          </div>

          {/* Net to tech preview */}
          <div style={{
            borderTop: '1px solid var(--border)', paddingTop: 14,
            display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
          }}>
            <div>
              <div style={{ fontSize: 11, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--muted-foreground)', fontWeight: 600, marginBottom: 4 }}>Net to tech (card)</div>
              <div className="tnum" style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--foreground)' }}>{fmtPrice(netCents)}</div>
            </div>
            <div className="tnum" style={{ fontSize: 12, color: 'var(--muted-foreground)', lineHeight: 1.6, textAlign: 'right' }}>
              <div>{fmtPrice(priceCents)} <span style={{ opacity: 0.6 }}>service</span></div>
              {cardFeeCents != null && cardFeeCents > 0 && (
                <div style={{ color: 'oklch(0.45 0.13 240)' }}>−{fmtPrice(cardFeeCents)} <span style={{ opacity: 0.7 }}>card fee</span></div>
              )}
              {supplyCents > 0 && (
                <div style={{ color: 'oklch(0.45 0.14 75)' }}>−{fmtPrice(supplyCents)} <span style={{ opacity: 0.7 }}>{draft.supply?.label || 'supply'}</span></div>
              )}
            </div>
          </div>
        </div>

        {/* Assignments preview (compact) */}
        <SectionTitle title="Assigned techs" subtitle={`${service.techCount} of 8 active techs perform this service.`} />
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px',
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 10,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: -6 }}>
            {[
              { i: 'AR', c: '--avatar-rose'   },
              { i: 'JU', c: '--avatar-blue'   },
              { i: 'SA', c: '--avatar-purple' },
              { i: 'NO', c: '--avatar-green'  },
              { i: 'PR', c: '--avatar-amber'  },
            ].slice(0, Math.min(5, service.techCount)).map((t, idx) => (
              <span key={idx} style={{
                width: 24, height: 24, borderRadius: '50%',
                background: `var(${t.c})`, color: 'white',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 600,
                border: '2px solid var(--card)',
                marginLeft: idx === 0 ? 0 : -6,
              }}>{t.i}</span>
            ))}
            {service.techCount > 5 && (
              <span className="tnum" style={{
                fontSize: 11, color: 'var(--muted-foreground)', marginLeft: 8, fontWeight: 500,
              }}>+{service.techCount - 5}</span>
            )}
          </div>
          <button type="button" style={ghostBtn}>Manage</button>
        </div>

      </div>

      {/* Footer */}
      <footer style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        paddingTop: 14, borderTop: '1px solid var(--border)',
      }}>
        <button type="button" style={archiveBtn}>
          <IcArchive size={13} /> Archive service
        </button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" style={ghostBtn}>Cancel</button>
          <button type="button" style={primaryBtn}>Save changes</button>
        </div>
      </footer>
    </aside>
  );
}

function initDraft(s) {
  if (!s) return null;
  return {
    id: s.id, name: s.name, category: s.category,
    duration_min: String(s.duration_min),
    price: String(s.price_cents / 100),
    price_from: s.price_from_cents != null ? String(s.price_from_cents / 100) : '',
    price_to:   s.price_to_cents   != null ? String(s.price_to_cents   / 100) : '',
    color_token: s.color_token,
    taxable: s.taxable, variable_price: s.variable_price,
    cardFee: { ...s.cardFee },
    supply: s.supply ? { ...s.supply } : null,
  };
}

function SectionTitle({ title, subtitle, icon, children }) {
  if (!title && !subtitle) {
    return <div style={{ fontSize: 10.5, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--muted-foreground)', fontWeight: 600 }}>{children}</div>;
  }
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {icon}
        <div style={{ fontSize: 10.5, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--muted-foreground)', fontWeight: 600 }}>{title}</div>
      </div>
      {subtitle && <div style={{ fontSize: 11.5, color: 'var(--muted-foreground)', marginTop: 4 }}>{subtitle}</div>}
    </div>
  );
}

// ---------- Styles ----------
const panelStyle = {
  display: 'flex', flexDirection: 'column',
  gap: 14,
  padding: 20,
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  boxShadow: 'var(--shadow-xs)',
  minHeight: 0, height: '100%',
};
const emptyPanelStyle = {
  ...panelStyle, alignItems: 'center', justifyContent: 'center',
};
const primaryBtn = {
  padding: '8px 14px',
  background: 'var(--primary)', color: 'var(--primary-foreground)',
  border: 'none', borderRadius: 6,
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
};
const ghostBtn = {
  padding: '8px 12px',
  background: 'transparent', color: 'var(--foreground)',
  border: '1px solid var(--border)', borderRadius: 6,
  fontSize: 13, fontWeight: 500, cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
};
const archiveBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '8px 10px',
  background: 'transparent', color: 'var(--destructive)',
  border: '1px solid var(--border)', borderRadius: 6,
  fontSize: 12.5, fontWeight: 500, cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
};
const iconBtn = {
  padding: 6, background: 'transparent',
  border: 'none', borderRadius: 6,
  color: 'var(--muted-foreground)', cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};

// ---------- Page shell ----------
function ServicesV1({ density = 'comfortable' }) {
  const [services] = useState(() => SERVICES_DATA);
  // pick gelx-fullset by default to demo all deduction features
  const [selectedId, setSelectedId] = useState('gelx-fullset');
  const selected = services.find(s => s.id === selectedId);

  // Editable policy state (so Edit policy actually does something).
  const [policy, setPolicy] = useState(() => ({
    cardFeeDefaultCents: POLICY.cardFeeDefaultCents,
    cardFeeMethods: [...POLICY.cardFeeMethods],
    cardFeeMainCategories: [...POLICY.cardFeeMainCategories],
  }));
  const [exemptTechs, setExemptTechs] = useState(() => EXEMPT_TECHS);
  const [policyOpen, setPolicyOpen] = useState(false);

  function handleSavePolicy(draft) {
    // Re-hydrate method labels for display in the strip.
    const labelMap = { card: 'Card', gift: 'Gift card', cash: 'Cash', venmo: 'Venmo / Zelle' };
    setPolicy({
      cardFeeDefaultCents: draft.cardFeeDefaultCents,
      cardFeeMethods: draft.cardFeeMethods.map(id => labelMap[id] ?? id),
      cardFeeMainCategories: draft.cardFeeMainCategories,
    });
    // Look up tech metadata from the roster used inside the sheet.
    const roster = window.__LACQUER_ROSTER ?? EXEMPT_TECHS;
    setExemptTechs(draft.exemptTechIds.map(id => roster.find(t => t.id === id)).filter(Boolean));
  }

  const activeCount = services.filter(s => s.active).length;
  const totalCount = services.length;

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 18, padding: '20px 28px 24px', minHeight: '100%' }}>
      {/* Header */}
      <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em', margin: 0, lineHeight: 1.15 }}>Services</h1>
          <p className="tnum" style={{ fontSize: 12.5, color: 'var(--muted-foreground)', marginTop: 4 }}>
            {activeCount} active · {totalCount} total · Deductions configured on {services.filter(s => s.cardFee?.mode !== 'default' || s.supply).length}
          </p>
        </div>
        <button type="button" style={{ ...primaryBtn, padding: '9px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <IcPlus size={14} /> Add service
        </button>
      </header>

      <PolicyStrip
        services={services}
        policy={policy}
        exemptTechs={exemptTechs}
        onEditPolicy={() => setPolicyOpen(true)}
      />

      {/* Two-pane body */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 440px) minmax(0, 1fr)',
        gap: 18,
        flex: 1,
        minHeight: 0,
      }}>
        <CatalogList services={services} selectedId={selectedId} onSelect={setSelectedId} density={density} />
        <EditPanel service={selected} />
      </div>

      <EditPolicySheet
        open={policyOpen}
        onClose={() => setPolicyOpen(false)}
        policy={policy}
        services={services}
        exemptTechIds={exemptTechs.map(t => t.id)}
        onSave={handleSavePolicy}
        onJumpToService={setSelectedId}
      />
    </div>
  );
}

window.ServicesV1 = ServicesV1;
