// ServicesV2.jsx — Variation 2: Payout-first / margin-aware services page.
//
// Where V1 stays close to the existing list-row idiom and treats deductions
// as a secondary section, V2 makes the deduction math the spine of the
// catalog. The list is a true table with explicit columns:
//   Service · Price · Card fee · Supply · Tech keeps
// "Tech keeps" is the calculated net — the owner can scan down the column
// and see margin per service at a glance.
//
// The edit panel leads with a big payout-math diagram (a horizontal flow
// from Price → −Card fee → −Supply → Tech receives), with the per-deduction
// controls plugged directly into that diagram. Details (name, category,
// duration, color) sit beneath as a secondary block.
//
// Same data shape as V1; only the visual treatment differs.

const { useState, useMemo, useEffect } = React;

// ---------- Icons ----------
const V2Ico = (paths) => ({ size = 16, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...rest}>{paths}</svg>
);
const V2IcSearch    = V2Ico(<><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></>);
const V2IcPlus      = V2Ico(<path d="M12 5v14M5 12h14"/>);
const V2IcArrow     = V2Ico(<path d="M5 12h14M13 6l6 6-6 6"/>);
const V2IcCard      = V2Ico(<><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></>);
const V2IcBox       = V2Ico(<><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></>);
const V2IcUserMinus = V2Ico(<><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="17" y1="11" x2="23" y2="11"/></>);
const V2IcSliders   = V2Ico(<><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></>);
const V2IcChev      = V2Ico(<path d="M6 9l6 6 6-6"/>);
const V2IcX         = V2Ico(<path d="M18 6L6 18M6 6l12 12"/>);

// ---------- Primitives (renamed to avoid collision with V1) ----------
function V2Switch({ checked, onChange, ariaLabel }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      style={{
        width: 32, height: 18, padding: 2,
        background: checked ? 'var(--primary)' : 'var(--muted)',
        border: '1px solid ' + (checked ? 'var(--primary)' : 'var(--border)'),
        borderRadius: 999, position: 'relative', cursor: 'pointer',
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

function V2Segmented({ value, onChange, options, size = 'md' }) {
  const sm = size === 'sm';
  return (
    <div role="radiogroup" style={{
      display: 'inline-grid',
      gridTemplateColumns: `repeat(${options.length}, 1fr)`,
      gap: 2, padding: 2,
      background: 'var(--muted)',
      border: '1px solid var(--border)',
      borderRadius: 7,
    }}>
      {options.map(o => {
        const active = o.value === value;
        return (
          <button key={o.value} type="button" onClick={() => onChange(o.value)}
            role="radio" aria-checked={active}
            style={{
              padding: sm ? '4px 8px' : '5px 10px',
              background: active ? 'var(--card)' : 'transparent',
              color: active ? 'var(--foreground)' : 'var(--muted-foreground)',
              border: 'none', borderRadius: 5,
              fontSize: sm ? 11.5 : 12, fontWeight: active ? 600 : 500,
              cursor: 'pointer',
              boxShadow: active ? 'var(--shadow-xs)' : 'none',
              transition: 'background 150ms var(--ease-out)',
              fontFamily: 'var(--font-sans)',
              whiteSpace: 'nowrap',
            }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------- Header / KPI strip ----------
function V2KPIStrip({ services }) {
  const kpis = useMemo(() => {
    const active = services.filter(s => s.active);
    let grossSum = 0, netSum = 0, supplyCount = 0, customCount = 0, exemptCount = 0, defaultCount = 0;
    active.forEach(s => {
      const price = s.variable_price ? (s.price_from_cents ?? 0) : (s.price_cents ?? 0);
      const cf = effectiveCardFeeCents(s) ?? 0;
      const sup = s.supply?.amount_cents ?? 0;
      grossSum += price; netSum += Math.max(0, price - cf - sup);
      if (s.supply) supplyCount++;
      const m = s.cardFee?.mode ?? 'default';
      if (m === 'default') defaultCount++;
      else if (m === 'custom') customCount++;
      else if (m === 'exempt') exemptCount++;
    });
    return { active: active.length, grossSum, netSum, supplyCount, defaultCount, customCount, exemptCount };
  }, [services]);

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
      gap: 12,
    }}>
      <V2KPI
        kicker="Card fee policy"
        value="$3.00"
        sub={`Default per service · ${kpis.defaultCount}/${kpis.active} services follow it`}
        action="Edit policy"
        icon={<V2IcCard size={14} />}
      />
      <V2KPI
        kicker="Card fee overrides"
        value={`${kpis.customCount + kpis.exemptCount}`}
        sub={`${kpis.customCount} custom · ${kpis.exemptCount} exempt`}
        icon={<V2IcSliders size={14} />}
      />
      <V2KPI
        kicker="Supply deductions"
        value={kpis.supplyCount}
        sub="Services with a per-use cost"
        icon={<V2IcBox size={14} />}
      />
      <V2KPI
        kicker="Exempt techs"
        valueNode={
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
            {EXEMPT_TECHS.map(t => (
              <span key={t.id} style={{
                width: 24, height: 24, borderRadius: '50%',
                background: `var(${t.color})`, color: 'white',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 600,
                border: '2px solid var(--card)',
              }} title={`${t.name} · ${t.role}`}>{t.initials}</span>
            ))}
            <span className="tnum" style={{
              marginLeft: 4, fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em',
            }}>{EXEMPT_TECHS.length}</span>
          </div>
        }
        sub={`${EXEMPT_TECHS.map(t => t.name).join(' · ')}`}
        action="Manage"
        icon={<V2IcUserMinus size={14} />}
      />
    </div>
  );
}

function V2KPI({ kicker, value, valueNode, sub, action, icon }) {
  return (
    <div style={{
      padding: '14px 16px',
      background: 'var(--card)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      display: 'flex', flexDirection: 'column', gap: 4,
      position: 'relative',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: 'var(--muted-foreground)' }}>{icon}</span>
        <div style={{ fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted-foreground)', fontWeight: 600 }}>{kicker}</div>
      </div>
      {valueNode ?? (
        <div className="tnum" style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em', marginTop: 2 }}>{value}</div>
      )}
      <div style={{ fontSize: 11.5, color: 'var(--muted-foreground)', lineHeight: 1.45 }}>{sub}</div>
      {action && (
        <button type="button" style={{
          position: 'absolute', right: 12, top: 12,
          padding: '3px 8px',
          background: 'transparent', color: 'var(--muted-foreground)',
          border: '1px solid var(--border)', borderRadius: 5,
          fontSize: 11, fontWeight: 500, cursor: 'pointer',
          fontFamily: 'var(--font-sans)',
        }}>{action}</button>
      )}
    </div>
  );
}

// ---------- Catalog table ----------
function V2CatalogTable({ services, selectedId, onSelect, density }) {
  const [q, setQ] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [filter, setFilter] = useState('all'); // all | card-override | supply

  const filtered = useMemo(() => {
    return services.filter(s => {
      if (!showArchived && !s.active) return false;
      if (q && !s.name.toLowerCase().includes(q.toLowerCase())) return false;
      if (filter === 'card-override' && (s.cardFee?.mode ?? 'default') === 'default') return false;
      if (filter === 'supply' && !s.supply) return false;
      return true;
    });
  }, [services, q, filter, showArchived]);

  const groups = useMemo(() => {
    const byCat = new Map();
    filtered.forEach(s => {
      if (!byCat.has(s.category)) byCat.set(s.category, []);
      byCat.get(s.category).push(s);
    });
    return CATEGORY_ORDER.filter(c => byCat.has(c)).map(c => ({ category: c, items: byCat.get(c) }));
  }, [filtered]);

  const isCompact = density === 'compact';
  const rowH = isCompact ? 38 : 50;

  return (
    <section style={{
      display: 'flex', flexDirection: 'column', gap: 12,
      background: 'var(--card)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      overflow: 'hidden',
      minHeight: 0,
    }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 14px', borderBottom: '1px solid var(--border)',
      }}>
        <label style={{
          flex: 1, maxWidth: 300,
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '7px 12px',
          background: 'var(--background)',
          border: '1px solid var(--input)',
          borderRadius: 7,
        }}>
          <V2IcSearch size={14} style={{ color: 'var(--muted-foreground)' }} />
          <input type="search" value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search services"
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, fontFamily: 'var(--font-sans)' }} />
        </label>
        <V2Segmented value={filter} onChange={setFilter} size="sm" options={[
          { value: 'all',           label: 'All' },
          { value: 'card-override', label: 'Card overrides' },
          { value: 'supply',        label: 'Has supply' },
        ]} />
        <div style={{ flex: 1 }} />
        <label style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          fontSize: 12, color: 'var(--muted-foreground)', cursor: 'pointer',
        }}>
          <V2Switch checked={showArchived} onChange={setShowArchived} ariaLabel="Show archived" />
          <span>Archived</span>
        </label>
      </div>

      {/* Column header */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1.6fr) 80px 92px 100px 92px 60px',
        alignItems: 'center', gap: 12,
        padding: '0 18px 8px',
        fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase',
        color: 'var(--muted-foreground)', fontWeight: 600,
      }}>
        <span>Service</span>
        <span className="tnum" style={{ textAlign: 'right' }}>Duration</span>
        <span className="tnum" style={{ textAlign: 'right' }}>Price</span>
        <span className="tnum" style={{ textAlign: 'right' }}>Card fee</span>
        <span className="tnum" style={{ textAlign: 'right' }}>Supply</span>
        <span className="tnum" style={{ textAlign: 'right' }}>Net</span>
      </div>

      {/* Scrollable group list */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 0 8px' }}>
        {groups.map(g => (
          <div key={g.category}>
            <div style={{
              padding: '8px 18px 6px',
              background: 'color-mix(in oklch, var(--muted) 35%, var(--card))',
              borderTop: '1px solid var(--border)',
              borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
            }}>
              <h3 style={{
                fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase',
                color: 'var(--foreground)', fontWeight: 600,
              }}>{g.category}</h3>
              <span className="tnum" style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>{g.items.length}</span>
            </div>
            {g.items.map(s => <V2Row key={s.id} service={s} selected={s.id === selectedId} onSelect={onSelect} rowH={rowH} compact={isCompact} />)}
          </div>
        ))}
      </div>
    </section>
  );
}

function V2Row({ service, selected, onSelect, rowH, compact }) {
  const price = service.variable_price ? service.price_from_cents : service.price_cents;
  const cf = effectiveCardFeeCents(service);
  const cfMode = service.cardFee?.mode ?? 'default';
  const supply = service.supply?.amount_cents ?? 0;
  const net = Math.max(0, (price ?? 0) - (cf ?? 0) - supply);
  const margin = price ? net / price : 0;

  return (
    <button type="button" onClick={() => onSelect(service.id)}
      data-selected={selected ? 'true' : 'false'}
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1.6fr) 80px 92px 100px 92px 60px',
        alignItems: 'center', gap: 12,
        padding: `0 18px`,
        minHeight: rowH,
        background: selected ? 'color-mix(in oklch, var(--primary) 7%, var(--card))' : 'var(--card)',
        border: 'none',
        borderLeft: selected ? '3px solid var(--primary)' : '3px solid transparent',
        borderBottom: '1px solid var(--border)',
        textAlign: 'left',
        cursor: 'pointer',
        opacity: service.active ? 1 : 0.55,
        fontFamily: 'var(--font-sans)',
        transition: 'background 100ms var(--ease-out)',
      }}>
      {/* Name + swatch + chips */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <span aria-hidden="true" style={{
          width: 10, height: 10, borderRadius: '50%',
          background: `var(${service.color_token})`,
          flexShrink: 0,
        }} />
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: compact ? 0 : 2 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
            <span style={{
              fontSize: 13, fontWeight: 500, color: 'var(--foreground)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{service.name}</span>
            {!service.active && (
              <span style={{
                fontSize: 9.5, letterSpacing: '0.05em', textTransform: 'uppercase',
                padding: '0 5px', borderRadius: 3,
                background: 'var(--muted)', color: 'var(--muted-foreground)',
                fontWeight: 500,
              }}>archived</span>
            )}
          </div>
          {!compact && service.supply && (
            <span style={{
              fontSize: 10.5, color: 'var(--muted-foreground)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{service.supply.label}</span>
          )}
        </div>
      </div>

      {/* Duration */}
      <span className="tnum" style={{ fontSize: 12, color: 'var(--muted-foreground)', textAlign: 'right' }}>{service.duration_min} min</span>

      {/* Price */}
      <span className="tnum" style={{ fontSize: 13, color: 'var(--foreground)', fontWeight: 600, textAlign: 'right' }}>{priceLabel(service)}</span>

      {/* Card fee */}
      <div style={{ textAlign: 'right' }}>
        {cf == null ? (
          <span style={{ fontSize: 11.5, color: 'var(--muted-foreground)' }}>Exempt</span>
        ) : cfMode === 'custom' ? (
          <span className="tnum" style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '2px 8px', borderRadius: 999,
            background: 'color-mix(in oklch, var(--primary) 14%, transparent)',
            color: 'var(--rose-700)',
            fontSize: 11.5, fontWeight: 500,
          }}>−{fmtPrice(cf)} <span style={{ opacity: 0.7, fontSize: 9.5, letterSpacing: '0.05em', textTransform: 'uppercase' }}>custom</span></span>
        ) : (
          <span className="tnum" style={{ fontSize: 12, color: 'oklch(0.45 0.13 240)', fontWeight: 500 }}>−{fmtPrice(cf)}</span>
        )}
      </div>

      {/* Supply */}
      <div style={{ textAlign: 'right' }}>
        {supply > 0 ? (
          <span className="tnum" style={{ fontSize: 12, color: 'oklch(0.45 0.14 75)', fontWeight: 500 }}>−{fmtPrice(supply)}</span>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>—</span>
        )}
      </div>

      {/* Net */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
        <span className="tnum" style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)' }}>{fmtPrice(net)}</span>
        {!compact && price > 0 && (
          <span className="tnum" style={{ fontSize: 9.5, color: 'var(--muted-foreground)' }}>{(margin * 100).toFixed(0)}%</span>
        )}
      </div>
    </button>
  );
}

// ---------- Edit panel ----------
function V2EditPanel({ service }) {
  const [draft, setDraft] = useState(() => v2InitDraft(service));
  useEffect(() => { setDraft(v2InitDraft(service)); }, [service?.id]);

  if (!service) {
    return (
      <aside style={{
        ...v2PanelStyle, alignItems: 'center', justifyContent: 'center',
        color: 'var(--muted-foreground)', fontSize: 13,
      }}>Pick a service to edit.</aside>
    );
  }

  function patch(p) { setDraft(d => ({ ...d, ...p })); }
  function patchCardFee(p) { setDraft(d => ({ ...d, cardFee: { ...d.cardFee, ...p } })); }
  function patchSupply(p) {
    setDraft(d => ({ ...d, supply: { ...(d.supply ?? { amount_cents: 0, label: '' }), ...p } }));
  }

  const priceCents = draft.variable_price
    ? (Number(draft.price_from) * 100 || 0)
    : (Number(draft.price) * 100 || 0);
  const cfCents = effectiveCardFeeCents({ cardFee: draft.cardFee }) ?? null;
  const supplyCents = draft.supply?.amount_cents ?? 0;
  const cashNet = Math.max(0, priceCents - supplyCents);
  const cardNet = Math.max(0, priceCents - (cfCents ?? 0) - supplyCents);

  return (
    <aside style={v2PanelStyle}>
      {/* Header */}
      <header style={{
        display: 'flex', alignItems: 'flex-start', gap: 12,
        padding: '18px 20px 14px',
        borderBottom: '1px solid var(--border)',
      }}>
        <span aria-hidden="true" style={{
          width: 28, height: 28, borderRadius: '50%',
          background: `var(${draft.color_token})`,
          flexShrink: 0,
        }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--foreground)', lineHeight: 1.25 }}>{draft.name || 'New service'}</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted-foreground)', marginTop: 2 }}>
            {draft.category || 'Uncategorized'} · {draft.duration_min || '—'} min · {priceCents > 0 ? fmtPrice(priceCents) : '—'}
          </div>
        </div>
        <button type="button" aria-label="Close" style={v2IconBtn}><V2IcX size={15} /></button>
      </header>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>

        {/* ─── Payout math diagram ───────────────────── */}
        <div style={{
          padding: '18px 20px 20px',
          background: 'color-mix(in oklch, var(--muted) 45%, var(--background))',
          borderBottom: '1px solid var(--border)',
        }}>
          <div style={{
            fontSize: 10.5, letterSpacing: '0.07em', textTransform: 'uppercase',
            color: 'var(--muted-foreground)', fontWeight: 600, marginBottom: 10,
          }}>Tech payout · paid by card</div>

          <PayoutFlow
            priceCents={priceCents}
            cfCents={cfCents}
            cfMode={draft.cardFee.mode}
            supplyCents={supplyCents}
            supplyLabel={draft.supply?.label}
          />

          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, marginTop: 14,
            paddingTop: 12, borderTop: '1px dashed var(--border)',
            fontSize: 11.5, color: 'var(--muted-foreground)',
          }}>
            <span>When paid by <strong style={{ color: 'var(--foreground)', fontWeight: 600 }}>cash</strong>, only supply applies — tech keeps</span>
            <span className="tnum" style={{
              padding: '2px 8px', borderRadius: 999,
              background: 'color-mix(in oklch, var(--success) 14%, transparent)',
              color: 'oklch(0.42 0.13 150)',
              fontWeight: 600,
            }}>{fmtPrice(cashNet)}</span>
          </div>
        </div>

        {/* ─── Card-fee controls ─────────────────────── */}
        <V2Section title="Card fee" sub="Applies when paid by card or gift card." icon={<V2IcCard size={13} />}>
          <V2Segmented
            value={draft.cardFee.mode}
            onChange={mode => patchCardFee({ mode })}
            options={[
              { value: 'default', label: `Use default · $${(POLICY.cardFeeDefaultCents / 100).toFixed(0)}` },
              { value: 'custom',  label: 'Custom amount' },
              { value: 'exempt',  label: 'Exempt' },
            ]}
          />
          {draft.cardFee.mode === 'custom' && (
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
              <V2TextInput
                width={100}
                value={String((draft.cardFee.custom_cents ?? 0) / 100)}
                onChange={v => patchCardFee({ custom_cents: Math.round(Number(v) * 100) || 0 })}
                prefix="$" numeric
              />
              <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>per service when paid by card</span>
            </div>
          )}
          {draft.cardFee.mode === 'default' && (
            <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--muted-foreground)' }}>
              Follows the global card fee policy. Change the default in <button type="button" style={v2InlineLink}>Settings → Policy</button>.
            </div>
          )}
          {draft.cardFee.mode === 'exempt' && (
            <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--muted-foreground)' }}>
              No card fee ever applies — useful for add-ons and removals where the deduction would feel punitive.
            </div>
          )}
        </V2Section>

        {/* ─── Supply controls ───────────────────────── */}
        <V2Section title="Supply deduction" sub="Tech-borne material cost. Applies on every transaction." icon={<V2IcBox size={13} />}
          right={<V2Switch
            checked={!!draft.supply}
            onChange={v => setDraft(d => ({ ...d, supply: v ? (d.supply ?? { amount_cents: 500, label: '' }) : null }))}
            ariaLabel="Supply deduction"
          />}>
          {draft.supply ? (
            <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 10 }}>
              <V2TextInput
                value={String((draft.supply.amount_cents ?? 0) / 100)}
                onChange={v => patchSupply({ amount_cents: Math.round(Number(v) * 100) || 0 })}
                prefix="$" numeric
              />
              <V2TextInput
                value={draft.supply.label ?? ''}
                onChange={v => patchSupply({ label: v })}
                placeholder="What's the supply? (e.g. Chrome powder, OPI bottle)"
              />
            </div>
          ) : (
            <div style={{ fontSize: 11.5, color: 'var(--muted-foreground)' }}>
              Turn on to deduct a flat amount per service for consumed materials.
            </div>
          )}
        </V2Section>

        {/* ─── Details ───────────────────────────────── */}
        <V2Section title="Details" collapsible>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <V2Field label="Service name">
              <V2TextInput value={draft.name} onChange={v => patch({ name: v })} />
            </V2Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 10 }}>
              <V2Field label="Category">
                <V2TextInput value={draft.category} onChange={v => patch({ category: v })} />
              </V2Field>
              <V2Field label="Duration">
                <V2TextInput value={draft.duration_min} onChange={v => patch({ duration_min: v })} suffix="min" numeric />
              </V2Field>
            </div>
            {draft.variable_price ? (
              <V2Field label="Price range">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <V2TextInput value={draft.price_from} onChange={v => patch({ price_from: v })} prefix="$" numeric />
                  <V2TextInput value={draft.price_to} onChange={v => patch({ price_to: v })} prefix="$" numeric />
                </div>
              </V2Field>
            ) : (
              <V2Field label="Price">
                <V2TextInput value={draft.price} onChange={v => patch({ price: v })} prefix="$" numeric />
              </V2Field>
            )}
            <V2Field label="Variable price" inline>
              <V2Switch checked={draft.variable_price} onChange={v => patch({ variable_price: v })} ariaLabel="Variable price" />
            </V2Field>
            <V2Field label="Color">
              <V2ColorSwatches value={draft.color_token} onChange={v => patch({ color_token: v })} />
            </V2Field>
          </div>
        </V2Section>

      </div>

      {/* Footer */}
      <footer style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        padding: '12px 20px',
        borderTop: '1px solid var(--border)',
        background: 'var(--card)',
      }}>
        <button type="button" style={v2ArchiveBtn}>Archive service</button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" style={v2GhostBtn}>Cancel</button>
          <button type="button" style={v2PrimaryBtn}>Save changes</button>
        </div>
      </footer>
    </aside>
  );
}

function PayoutFlow({ priceCents, cfCents, cfMode, supplyCents, supplyLabel }) {
  const net = Math.max(0, priceCents - (cfCents ?? 0) - supplyCents);
  const cfActive = cfCents != null && cfCents > 0;
  const supActive = supplyCents > 0;

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr auto 1fr auto 1fr',
      alignItems: 'stretch', gap: 0,
    }}>
      {/* Price node */}
      <PayoutNode kicker="Service price" amount={fmtPrice(priceCents)} sub="What the customer pays" tone="neutral" />

      <PayoutArrow active={cfActive} />

      {/* Card fee */}
      <PayoutNode
        kicker={cfMode === 'custom' ? 'Card fee · custom' : cfMode === 'exempt' ? 'Card fee · exempt' : 'Card fee · default'}
        amount={cfActive ? `−${fmtPrice(cfCents)}` : (cfMode === 'exempt' ? 'Exempt' : '—')}
        sub={cfActive ? 'Deducted from tech' : (cfMode === 'exempt' ? 'No fee applies' : 'Not configured')}
        tone={cfActive ? 'card' : 'idle'}
      />

      <PayoutArrow active={supActive} />

      {/* Net */}
      <PayoutNode
        kicker="Tech keeps"
        amount={fmtPrice(net)}
        sub={supActive ? `After supply: ${supplyLabel || 'supply'}` : 'After deductions'}
        tone="net"
        extraDeduction={supActive ? `−${fmtPrice(supplyCents)} supply` : null}
      />
    </div>
  );
}

function PayoutNode({ kicker, amount, sub, tone, extraDeduction }) {
  const toneMap = {
    neutral: { bg: 'var(--card)',   border: 'var(--border)',                       amount: 'var(--foreground)' },
    idle:    { bg: 'var(--card)',   border: 'var(--border)',                       amount: 'var(--muted-foreground)' },
    card:    { bg: 'color-mix(in oklch, var(--info) 8%, var(--card))', border: 'color-mix(in oklch, var(--info) 35%, var(--border))', amount: 'oklch(0.45 0.13 240)' },
    supply:  { bg: 'color-mix(in oklch, var(--amber-500) 8%, var(--card))', border: 'color-mix(in oklch, var(--amber-500) 35%, var(--border))', amount: 'oklch(0.45 0.14 75)' },
    net:     { bg: 'color-mix(in oklch, var(--success) 9%, var(--card))', border: 'color-mix(in oklch, var(--success) 40%, var(--border))', amount: 'oklch(0.38 0.13 150)' },
  }[tone];
  return (
    <div style={{
      padding: '12px 14px',
      background: toneMap.bg,
      border: `1px solid ${toneMap.border}`,
      borderRadius: 10,
      display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0,
    }}>
      <div style={{ fontSize: 9.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted-foreground)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{kicker}</div>
      <div className="tnum" style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em', color: toneMap.amount }}>{amount}</div>
      <div style={{ fontSize: 10.5, color: 'var(--muted-foreground)', lineHeight: 1.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>
      {extraDeduction && (
        <div className="tnum" style={{ fontSize: 10.5, color: 'oklch(0.45 0.14 75)', fontWeight: 500, marginTop: 2 }}>{extraDeduction}</div>
      )}
    </div>
  );
}

function PayoutArrow({ active }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '0 4px',
      color: active ? 'var(--muted-foreground)' : 'color-mix(in oklch, var(--muted-foreground) 35%, transparent)',
    }}>
      <V2IcArrow size={14} />
    </div>
  );
}

function V2Section({ title, sub, icon, right, collapsible, children }) {
  const [open, setOpen] = useState(!collapsible);
  return (
    <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, marginBottom: open ? 10 : 0,
        cursor: collapsible ? 'pointer' : 'default',
      }} onClick={() => collapsible && setOpen(o => !o)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {icon && <span style={{ color: 'var(--muted-foreground)' }}>{icon}</span>}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)' }}>{title}</div>
            {sub && <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 2 }}>{sub}</div>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {right}
          {collapsible && (
            <V2IcChev size={14} style={{ color: 'var(--muted-foreground)', transform: open ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 150ms var(--ease-out)' }} />
          )}
        </div>
      </div>
      {open && children}
    </div>
  );
}

function V2Field({ label, inline, children }) {
  if (inline) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <label style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--foreground)' }}>{label}</label>
        {children}
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--foreground)' }}>{label}</label>
      {children}
    </div>
  );
}

function V2TextInput({ value, onChange, prefix, suffix, placeholder, numeric, width }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center',
      background: 'var(--card)',
      border: '1px solid var(--input)',
      borderRadius: 6,
      padding: '0 10px', width,
    }}>
      {prefix && <span style={{ color: 'var(--muted-foreground)', fontSize: 13, marginRight: 4 }}>{prefix}</span>}
      <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{
          flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent',
          padding: '7px 0', fontSize: 13, color: 'var(--foreground)',
          fontFamily: 'var(--font-sans)',
          fontVariantNumeric: numeric ? 'tabular-nums' : 'normal',
        }} />
      {suffix && <span style={{ color: 'var(--muted-foreground)', fontSize: 12, marginLeft: 4 }}>{suffix}</span>}
    </div>
  );
}

function V2ColorSwatches({ value, onChange }) {
  const options = ['--avatar-rose', '--avatar-blue', '--avatar-green', '--avatar-amber', '--avatar-purple', '--avatar-teal', '--avatar-orange', '--avatar-slate'];
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {options.map(t => {
        const active = t === value;
        return (
          <button key={t} type="button" onClick={() => onChange(t)} aria-label={t}
            style={{
              width: 22, height: 22, borderRadius: '50%',
              background: `var(${t})`, border: 'none', cursor: 'pointer',
              boxShadow: active ? `0 0 0 2px var(--background), 0 0 0 3px var(${t})` : 'none',
            }} />
        );
      })}
    </div>
  );
}

function v2InitDraft(s) {
  if (!s) return null;
  return {
    id: s.id, name: s.name, category: s.category,
    duration_min: String(s.duration_min),
    price: String(s.price_cents / 100),
    price_from: s.price_from_cents != null ? String(s.price_from_cents / 100) : '',
    price_to:   s.price_to_cents   != null ? String(s.price_to_cents   / 100) : '',
    color_token: s.color_token,
    variable_price: s.variable_price,
    cardFee: { ...s.cardFee },
    supply: s.supply ? { ...s.supply } : null,
  };
}

// Styles
const v2PanelStyle = {
  display: 'flex', flexDirection: 'column',
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  minHeight: 0, height: '100%',
  overflow: 'hidden',
};
const v2PrimaryBtn = {
  padding: '8px 14px',
  background: 'var(--primary)', color: 'var(--primary-foreground)',
  border: 'none', borderRadius: 6,
  fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-sans)',
};
const v2GhostBtn = {
  padding: '8px 12px', background: 'transparent', color: 'var(--foreground)',
  border: '1px solid var(--border)', borderRadius: 6,
  fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'var(--font-sans)',
};
const v2ArchiveBtn = {
  padding: '8px 10px', background: 'transparent', color: 'var(--destructive)',
  border: '1px solid var(--border)', borderRadius: 6,
  fontSize: 12.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'var(--font-sans)',
};
const v2IconBtn = {
  padding: 6, background: 'transparent', border: 'none', borderRadius: 6,
  color: 'var(--muted-foreground)', cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};
const v2InlineLink = {
  background: 'transparent', border: 'none', padding: 0,
  color: 'var(--foreground)', textDecoration: 'underline',
  fontSize: 11.5, cursor: 'pointer', fontFamily: 'var(--font-sans)',
};

// ---------- Page ----------
function ServicesV2({ density = 'comfortable' }) {
  const [services] = useState(() => SERVICES_DATA);
  const [selectedId, setSelectedId] = useState('gelx-fullset');
  const selected = services.find(s => s.id === selectedId);

  const activeCount = services.filter(s => s.active).length;
  const totalCount = services.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '20px 28px 24px', minHeight: '100%' }}>
      <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em', margin: 0, lineHeight: 1.15 }}>Services</h1>
          <p className="tnum" style={{ fontSize: 12.5, color: 'var(--muted-foreground)', marginTop: 4 }}>
            {activeCount} active · {totalCount} total
          </p>
        </div>
        <button type="button" style={{ ...v2PrimaryBtn, padding: '9px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <V2IcPlus size={14} /> Add service
        </button>
      </header>

      <V2KPIStrip services={services} />

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1.45fr) minmax(0, 1fr)',
        gap: 16, flex: 1, minHeight: 0,
      }}>
        <V2CatalogTable services={services} selectedId={selectedId} onSelect={setSelectedId} density={density} />
        <V2EditPanel service={selected} />
      </div>
    </div>
  );
}

window.ServicesV2 = ServicesV2;
