// DayReport.jsx — Daily earnings report with per-tech deduction breakdown
// Consumed by: Day Report.html

const { useState, useMemo } = React;

// ─── 1. DEDUCTION CONFIG ──────────────────────────────────────────────────────

// Pedicure tier deductions (#3–#7)
const DR_PEDI_TIER = {
  'deluxe-pedi': 3,           // #3
  'deluxe-pedi-reg': 3,
  'deluxe-pedi-gel': 3,
  'vitamin-recharge-pedi': 3, // #4
  'energy-boost-pedi': 3,     // #5
  'energy-boost-pedi-reg': 3,
  'lavender-steam-pedi-reg': 5, // #6
  'hemp-steam-pedi': 5,         // #7
};

// Supply add-ons that cost the tech $5
const DR_SUPPLY_IDS = new Set([
  'addon-chrome',
  'addon-cat-eyes',
  'addon-opi',
  'gelx-fullset',
  'gelx-refill',
  'gelx-apres',
]);

// Payment methods that trigger the $3/service card fee
const DR_CARD_PAY = new Set(['card', 'gift']);

// Service categories counted as "main services" for the card fee
const DR_MAIN_CAT = new Set(['Manicure', 'Pedicure', 'Enhancement', 'Waxing', 'Removal']);

// Default exempt techs (owners / family — no deductions)
const DR_DEFAULT_EXEMPT = new Set(['maya', 'linh']);

// ─── 2. EXTENDED SERVICES (adds OPI) ─────────────────────────────────────────

const DR_ALL_SVCS = [
  ...(window.SERVICES || []),
  { id: 'addon-opi', name: 'OPI Polish', time: 0, cat: 'Add-ons', price: 0 },
];
function drSvc(id) {
  return DR_ALL_SVCS.find(s => s.id === id) || { name: id, cat: '', price: 0 };
}

// ─── 3. EXTENDED TRANSACTIONS ─────────────────────────────────────────────────
// Augments TX_HISTORY with more transactions covering all deduction types.

const DR_EXTRA_TX = [
  // aria – deluxe pedi + cat-eye (card: card fee + supply + pedi tier)
  { id:'tx-201', time:'9:15 AM',  client:'Karen L.',  techs:['aria'],  items:[{id:'deluxe-pedi',qty:1,price:60},{id:'addon-cat-eyes',qty:1,price:10}], tipPct:0.18, method:'card' },
  // aria – gelx + chrome (card: card fee + 2× supply)
  { id:'tx-202', time:'2:45 PM',  client:'Mia T.',    techs:['aria'],  items:[{id:'gelx-fullset',qty:1,price:65},{id:'addon-chrome',qty:1,price:10}],   tipPct:0.20, method:'card' },
  // jules – hemp steam pedi (card: card fee + pedi tier #7)
  { id:'tx-203', time:'9:40 AM',  client:'Walk-in',   techs:['jules'], items:[{id:'hemp-steam-pedi',qty:1,price:86}],                                    tipPct:0.15, method:'card' },
  // jules – lavender steam pedi (cash: only pedi tier #6, no card fee)
  { id:'tx-204', time:'3:00 PM',  client:'Beth A.',   techs:['jules'], items:[{id:'lavender-steam-pedi-reg',qty:1,price:86}],                            tipPct:0,    method:'cash' },
  // sasha – gelx apres + chrome (card: card fee + 2× supply)
  { id:'tx-205', time:'10:20 AM', client:'June W.',   techs:['sasha'], items:[{id:'gelx-apres',qty:1,price:65},{id:'addon-chrome',qty:1,price:10}],      tipPct:0.20, method:'card' },
  // sasha – vitamin recharge pedi (card: card fee + pedi tier #4)
  { id:'tx-206', time:'4:00 PM',  client:'Rose M.',   techs:['sasha'], items:[{id:'vitamin-recharge-pedi',qty:1,price:78}],                              tipPct:0.18, method:'card' },
  // noor – energy boost pedi + opi (gift: card fee + supply + pedi tier #5)
  { id:'tx-207', time:'10:45 AM', client:'Nina P.',   techs:['noor'],  items:[{id:'energy-boost-pedi',qty:1,price:73},{id:'addon-opi',qty:1,price:0}],   tipPct:0.20, method:'gift' },
  // priya – acrylic fills (card fee only)
  { id:'tx-208', time:'11:15 AM', client:'Walk-in',   techs:['priya'], items:[{id:'acrylic-fills-gel',qty:1,price:65}],                                  tipPct:0.15, method:'card' },
  // tess – gelx + cat-eye (card: card fee + supply)
  { id:'tx-209', time:'11:40 AM', client:'Chloe R.',  techs:['tess'],  items:[{id:'gelx-fullset',qty:1,price:65},{id:'addon-cat-eyes',qty:1,price:10}],  tipPct:0.20, method:'card' },
  // tess – classic pedi (card: card fee only, no tier)
  { id:'tx-210', time:'4:30 PM',  client:'Walk-in',   techs:['tess'],  items:[{id:'classic-pedi',qty:1,price:38}],                                       tipPct:0.18, method:'card' },
  // maya – deluxe pedi + chrome (exempt: no deductions)
  { id:'tx-211', time:'9:45 AM',  client:'Lena S.',   techs:['maya'],  items:[{id:'deluxe-pedi',qty:1,price:65},{id:'addon-chrome',qty:1,price:10}],     tipPct:0.20, method:'card' },
  // linh – hemp steam (exempt: no deductions)
  { id:'tx-212', time:'10:10 AM', client:'Walk-in',   techs:['linh'],  items:[{id:'hemp-steam-pedi',qty:1,price:86}],                                    tipPct:0.15, method:'card' },
  // noor – manicure gel (cash: no card fee)
  { id:'tx-213', time:'5:00 PM',  client:'Tara M.',   techs:['noor'],  items:[{id:'manicure-gel',qty:1,price:40}],                                       tipPct:0.20, method:'cash' },
  // priya – classic mani + opi (card: card fee for mani + supply for opi)
  { id:'tx-214', time:'5:15 PM',  client:'Walk-in',   techs:['priya'], items:[{id:'classic-mani',qty:1,price:25},{id:'addon-opi',qty:1,price:0}],        tipPct:0,    method:'card' },
];

const DR_ALL_TX = [...(window.TX_HISTORY || []), ...DR_EXTRA_TX];

// ─── 4. CALCULATION HELPERS ───────────────────────────────────────────────────

// For multi-tech transactions, distribute items by tech index.
// Tech at index 0 gets item 0, tech at index 1 gets item 1, etc.
// Any overflow items go to the last tech.
function drTechItems(tx, techId) {
  const idx = tx.techs.indexOf(techId);
  if (idx < 0) return [];
  if (tx.techs.length === 1) return tx.items;
  return tx.items.filter((_, i) =>
    i < tx.techs.length ? i === idx : idx === tx.techs.length - 1
  );
}

function drItemPrice(item) {
  const base = item.price != null ? item.price : (drSvc(item.id).price || 0);
  return base * (item.qty || 1);
}

function drTechSubtotal(tx, techId) {
  return drTechItems(tx, techId).reduce((s, it) => s + drItemPrice(it), 0);
}

// Tips split proportionally by each tech's share of the transaction subtotal.
// Only card/gift tips are reported to the salon — cash tips are kept by the
// tech directly and never flow through the POS.
function drTechTip(tx, techId) {
  if (!DR_CARD_PAY.has(tx.method)) return 0;
  const mine = drTechSubtotal(tx, techId);
  const total = tx.items.reduce((s, it) => s + drItemPrice(it), 0);
  return total > 0 ? total * (tx.tipPct || 0) * (mine / total) : 0;
}

// Returns { cardFee, supplyFee, pediFee, total, details[] } for one tech on one tx.
function drCalcDed(tx, techId, exemptSet) {
  if (exemptSet.has(techId)) return { cardFee: 0, supplyFee: 0, pediFee: 0, total: 0, details: [] };

  const isCard = DR_CARD_PAY.has(tx.method);
  const items  = drTechItems(tx, techId);
  const details = [];
  let cardFee = 0, supplyFee = 0, pediFee = 0;

  for (const item of items) {
    const svc = drSvc(item.id);
    const qty = item.qty || 1;

    // $3 card fee per main service when paid by card/gift
    if (isCard && DR_MAIN_CAT.has(svc.cat)) {
      cardFee += 3 * qty;
      details.push({ label: svc.name, type: 'card', amount: 3 * qty });
    }
    // $5 supply fee (Chrome / Cat-eye / OPI / GelX) — always
    if (DR_SUPPLY_IDS.has(item.id)) {
      supplyFee += 5 * qty;
      details.push({ label: svc.name, type: 'supply', amount: 5 * qty });
    }
    // Pedi tier fee — always
    const pf = DR_PEDI_TIER[item.id];
    if (pf) {
      pediFee += pf * qty;
      details.push({ label: svc.name, type: 'pedi', amount: pf * qty });
    }
  }

  return { cardFee, supplyFee, pediFee, total: cardFee + supplyFee + pediFee, details };
}

// ─── 5. STAT AGGREGATION ──────────────────────────────────────────────────────

function drBuildStats(txList, staffList, exemptSet) {
  return staffList.map(tech => {
    const myTx = txList.filter(tx => tx.techs.includes(tech.id));
    if (!myTx.length) return null;

    let subtotal = 0, cardFee = 0, supplyFee = 0, pediFee = 0, tips = 0, svcCount = 0;
    const txRows = myTx.map(tx => {
      const sub   = drTechSubtotal(tx, tech.id);
      const tip   = drTechTip(tx, tech.id);
      const ded   = drCalcDed(tx, tech.id, exemptSet);
      const items = drTechItems(tx, tech.id);
      subtotal  += sub;  tips      += tip;
      cardFee   += ded.cardFee;  supplyFee += ded.supplyFee;  pediFee   += ded.pediFee;
      svcCount  += items.length;
      return { tx, sub, tip, ded, items };
    });

    const totalDeductions = cardFee + supplyFee + pediFee;
    return {
      ...tech,
      isExempt: exemptSet.has(tech.id),
      txCount: myTx.length, svcCount,
      subtotal, cardFee, supplyFee, pediFee,
      totalDeductions, net: subtotal - totalDeductions, tips,
      txRows,
    };
  }).filter(Boolean);
}

// ─── 6. UI PRIMITIVES ─────────────────────────────────────────────────────────

function DrAvatar({ tech, size = 32 }) {
  const initials = tech.full.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: `oklch(0.88 0.06 ${tech.tone})`,
      color: `oklch(0.30 0.09 ${tech.tone})`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.round(size * 0.36), fontWeight: 700, letterSpacing: '-0.01em',
      userSelect: 'none',
    }}>{initials}</div>
  );
}

function DrPayBadge({ method }) {
  const cfg = {
    card:  { l: 'Card',  bg: 'oklch(0.93 0.03 240)', c: 'oklch(0.38 0.14 240)' },
    cash:  { l: 'Cash',  bg: 'oklch(0.93 0.03 150)', c: 'oklch(0.36 0.12 150)' },
    gift:  { l: 'Gift',  bg: 'oklch(0.94 0.04 12)',  c: 'oklch(0.44 0.12 12)'  },
    split: { l: 'Split', bg: 'oklch(0.93 0.04 75)',  c: 'oklch(0.42 0.12 75)'  },
  };
  const c = cfg[method] || cfg.split;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 6px', borderRadius: 5,
      fontSize: 10, fontWeight: 700, background: c.bg, color: c.c,
      letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap',
    }}>{c.l}</span>
  );
}

const f$     = n => `$${n.toFixed(2)}`;
const fInt   = n => `$${Math.round(n)}`;
const fDed   = n => n === 0 ? '—' : `-$${n}`;
const fDed$  = n => n === 0 ? '—' : `-$${n.toFixed(2)}`;

// SVG icons
const IcoChevL    = () => <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>;
const IcoChevR    = () => <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>;
const IcoPrint    = () => <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>;
const IcoDownload = () => <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
const IcoChevDown = () => <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 9l6 6 6-6"/></svg>;
const IcoInfo     = () => <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>;

// ─── 7. ALL STAFF OVERVIEW ────────────────────────────────────────────────────

function DrAllStaffView({ techStats, grand, variant = 'original' }) {
  // Variant B hides the detail-head totals (top strip is canonical)
  const showHeadTotals = variant !== 'b';
  return (
    <div className="dr-detail">
      <div className={`dr-detail-head${variant === 'b' ? ' slim' : ''}`}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.01em' }}>All Staff — Overview</div>
          <div style={{ fontSize: 12, color: 'var(--muted-foreground)', marginTop: 2 }}>
            {techStats.length} technicians · {grand.txCount} transactions · {grand.svcCount} services
          </div>
        </div>
        {showHeadTotals && <div className="dr-head-totals">
          {[
            { l: 'Gross',    v: f$(grand.subtotal),         cls: ''    , title: '' },
            { l: 'Deducted', v: `−${f$(grand.totalDed)}`,  cls: 'neg' , title: '' },
            { l: 'Commissionable',  v: f$(grand.net),       cls: 'pos' , title: 'Amount eligible for the tech / salon split (typically 60% tech, 40% salon). Final tech payout is calculated from this.' },
            { l: 'Card Tips', v: f$(grand.tips),            cls: 'tip' , title: '' },
          ].map(({ l, v, cls, title }) => (
            <div key={l} className="dr-htotal" title={title || undefined}>
              <div className="dr-htotal-l">{l}</div>
              <div className={`dr-htotal-v ${cls}`}>{v}</div>
            </div>
          ))}
        </div>}
      </div>

      <div className="dr-table-wrap">
        <table className="dr-table">
          <thead>
            <tr>
              <th style={{ width: 148 }}>Tech</th>
              <th className="num" style={{ width: 46 }}>Svcs</th>
              <th className="num" style={{ width: 76 }}>Gross</th>
              <th className="num ded" style={{ width: 72 }} title="−$3 per main service paid by card or gift">Card −$3</th>
              <th className="num ded" style={{ width: 82 }} title="Chrome / Cat-eye / OPI / GelX: −$5 · Pedi tier #3–5: −$3 · Pedi tier #6–7: −$5">Supply</th>
              <th className="num" style={{ width: 96 }} title="Amount eligible for the tech / salon split (typically 60% tech, 40% salon). Final tech payout is calculated from this.">Commissionable</th>
              <th className="num" style={{ width: 70 }} title="Credit card tips only — cash tips are kept directly by each tech and not reported">Card Tips</th>
            </tr>
          </thead>
          <tbody>
            {techStats.map(t => (
              <tr key={t.id} className="dr-staff-row">
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <DrAvatar tech={t} size={26} />
                    <div>
                      <div style={{ fontWeight: 500, fontSize: 13 }}>{t.name}</div>
                      {t.isExempt && <div className="dr-exempt-tag">Exempt</div>}
                    </div>
                  </div>
                </td>
                <td className="num">{t.svcCount}</td>
                <td className="num">{f$(t.subtotal)}</td>
                <td className={`num dc${t.cardFee ? ' on' : ''}`}>
                  {t.isExempt ? <span className="dr-em-dash">—</span> : fDed(t.cardFee)}
                </td>
                <td className={`num dc${(t.supplyFee + t.pediFee) ? ' on' : ''}`}>
                  {t.isExempt ? <span className="dr-em-dash">—</span> : fDed(t.supplyFee + t.pediFee)}
                </td>
                <td className="num net-cell">{f$(t.net)}</td>
                <td className="num tip-cell">{f$(t.tips)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="dr-foot-row">
              <td>Total</td>
              <td className="num">{grand.svcCount}</td>
              <td className="num">{f$(grand.subtotal)}</td>
              <td className="num dc on">{fDed$(grand.cardFee)}</td>
              <td className="num dc on">{fDed$(grand.supplyFee + grand.pediFee)}</td>
              <td className="num net-cell">{f$(grand.net)}</td>
              <td className="num tip-cell">{f$(grand.tips)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Legend */}
      <div className="dr-legend">
        <IcoInfo />
        <span><strong>Card −$3</strong> applies per main service when paid by card or gift card.</span>
        <span className="dr-legend-sep">·</span>
        <span><strong>Supply</strong> covers Chrome / Cat-eye / OPI / GelX (−$5) and Pedi tiers — Deluxe / Vitamin / Energy (−$3), Lavender / Hemp Steam (−$5).</span>
        <span className="dr-legend-sep">·</span>
        <span className="dr-exempt-inline">Exempt</span> techs have no deductions.
      </div>
    </div>
  );
}

// ─── 8. TECH DETAIL VIEW ──────────────────────────────────────────────────────

function DrTechDetailView({ t, expandedTx, onToggle, variant = 'original' }) {
  const COLS = t.isExempt ? 6 : 8;
  // Variant B hides the detail-head totals (top strip is canonical)
  const showHeadTotals = variant !== 'b';

  return (
    <div className="dr-detail">
      <div className={`dr-detail-head${variant === 'b' ? ' slim' : ''}`}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <DrAvatar tech={t} size={38} />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.01em' }}>{t.full}</span>
              {t.isExempt && <span className="dr-exempt-badge">No deductions</span>}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted-foreground)', marginTop: 2 }}>
              {t.txCount} clients · {t.svcCount} services
              {!t.isExempt && <span style={{ color: 'var(--destructive)' }}> · −${t.totalDeductions.toFixed(2)} deducted today</span>}
            </div>
          </div>
        </div>
        {showHeadTotals && <div className="dr-head-totals">
          {[
            { l: 'Gross',    v: f$(t.subtotal),           cls: ''    , title: '' },
            ...(!t.isExempt ? [{ l: 'Deducted', v: `−${f$(t.totalDeductions)}`, cls: 'neg', title: '' }] : []),
            { l: 'Commissionable',  v: f$(t.net),          cls: 'pos' , title: 'Amount eligible for the tech / salon split (typically 60% tech, 40% salon). Final tech payout is calculated from this.' },
            { l: 'Card Tips', v: f$(t.tips),               cls: 'tip' , title: '' },
          ].map(({ l, v, cls, title }) => (
            <div key={l} className="dr-htotal" title={title || undefined}>
              <div className="dr-htotal-l">{l}</div>
              <div className={`dr-htotal-v ${cls}`}>{v}</div>
            </div>
          ))}
        </div>}
      </div>

      <div className="dr-table-wrap">
        <table className="dr-table">
          <thead>
            <tr>
              <th style={{ width: 68 }}>Time</th>
              <th style={{ width: 110 }}>Client</th>
              <th>Services</th>
              <th className="num" style={{ width: 72 }}>Gross</th>
              {!t.isExempt && <>
                <th className="num ded" style={{ width: 62 }} title="−$3 per main service (card/gift)">Card</th>
                <th className="num ded" style={{ width: 72 }} title="Chrome / Cat-eye / OPI / GelX (−$5) · Pedi tiers #3–#7 (−$3 / −$5)">Supply</th>
              </>}
              <th className="num" style={{ width: 72 }}>Net</th>
              <th style={{ width: 54 }}>Pay</th>
            </tr>
          </thead>
          <tbody>
            {t.txRows.map(({ tx, sub, tip, ded, items }) => {
              const isExp = expandedTx.has(tx.id);
              const svcNames = items.map(it => drSvc(it.id).name).join(', ');
              const hasDetail = ded.details.length > 0 || tip > 0.005;
              return (
                <React.Fragment key={tx.id}>
                  <tr
                    className={`dr-tx-row${isExp ? ' exp' : ''}${hasDetail ? ' click' : ''}`}
                    onClick={() => hasDetail && onToggle(tx.id)}
                  >
                    <td className="dr-time">{tx.time}</td>
                    <td className="dr-client">{tx.client}</td>
                    <td className="dr-svcs" title={svcNames}>
                      {hasDetail && (
                        <span className={`dr-expand-caret${isExp ? ' open' : ''}`}><IcoChevDown /></span>
                      )}
                      {svcNames}
                    </td>
                    <td className="num">{f$(sub)}</td>
                    {!t.isExempt && <>
                      <td className={`num dc${ded.cardFee ? ' on' : ''}`}>{fDed(ded.cardFee)}</td>
                      <td className={`num dc${(ded.supplyFee + ded.pediFee) ? ' on' : ''}`}>{fDed(ded.supplyFee + ded.pediFee)}</td>
                    </>}
                    <td className="num net-cell">{f$(sub - ded.total)}</td>
                    <td><DrPayBadge method={tx.method} /></td>
                  </tr>

                  {isExp && hasDetail && (
                    <tr className="dr-expand-row">
                      <td colSpan={COLS}>
                        <div className="dr-expand-inner">
                          {ded.details.length > 0 && (
                            <div className="dr-expand-sec">
                              <div className="dr-expand-ttl">Deduction detail</div>
                              {ded.details.map((d, i) => (
                                <div key={i} className="dr-expand-line">
                                  <span>
                                    <span className="dr-expand-type">
                                      {d.type === 'card' ? 'Card fee' : 'Supply'}
                                    </span>
                                    <span className="dr-expand-name"> — {d.label}</span>
                                  </span>
                                  <span className="dr-expand-ded">−${d.amount}</span>
                                </div>
                              ))}
                              <div className="dr-expand-subtotal">
                                <span>Total deducted</span>
                                <span className="dr-expand-ded">−${ded.total}</span>
                              </div>
                            </div>
                          )}
                          {tip > 0.005 && (
                            <div className="dr-expand-sec">
                              <div className="dr-expand-ttl">Card tip received</div>
                              <div className="dr-expand-line">
                                <span className="dr-expand-name">{Math.round(tx.tipPct * 100)}% — paid out to tech</span>
                                <span style={{ color: 'var(--success)', fontWeight: 600 }}>+{f$(tip)}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="dr-foot-row">
              <td colSpan={3} style={{ fontWeight: 700, fontSize: 12 }}>
                Totals · {t.txCount} transactions
              </td>
              <td className="num">{f$(t.subtotal)}</td>
              {!t.isExempt && <>
                <td className="num dc on">{fDed$(t.cardFee)}</td>
                <td className="num dc on">{fDed$(t.supplyFee + t.pediFee)}</td>
              </>}
              <td className="num net-cell">{f$(t.net)}</td>
              <td></td>
            </tr>
            {t.tips > 0.005 && (
              <tr>
                <td colSpan={COLS} style={{ padding: '5px 10px 8px', background: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ color: 'var(--muted-foreground)', fontSize: 11 }}>Card tips (cash tips not reported): </span>
                  <span style={{ color: 'oklch(0.42 0.12 150)', fontWeight: 700, fontSize: 13 }}>{f$(t.tips)}</span>
                </td>
              </tr>
            )}
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ─── 9. MAIN COMPONENT ────────────────────────────────────────────────────────

function DayReport({ exemptTechs = DR_DEFAULT_EXEMPT, allTx = DR_ALL_TX, variant = 'original' }) {
  const [date, setDate]         = useState(new Date(2026, 4, 11)); // May 11
  const [period, setPeriod]     = useState('day');
  const [selTech, setSelTech]   = useState(null); // null = All Staff
  const [expanded, setExpanded] = useState(new Set());

  const techStats = useMemo(
    () => drBuildStats(allTx, window.STAFF || [], exemptTechs),
    [allTx, exemptTechs]
  );

  const grand = useMemo(() => techStats.reduce((a, t) => ({
    subtotal: a.subtotal + t.subtotal,
    cardFee:  a.cardFee  + t.cardFee,
    supplyFee:a.supplyFee+ t.supplyFee,
    pediFee:  a.pediFee  + t.pediFee,
    totalDed: a.totalDed + t.totalDeductions,
    net:      a.net      + t.net,
    tips:     a.tips     + t.tips,
    txCount:  a.txCount  + t.txCount,
    svcCount: a.svcCount + t.svcCount,
  }), { subtotal: 0, cardFee: 0, supplyFee: 0, pediFee: 0, totalDed: 0, net: 0, tips: 0, txCount: 0, svcCount: 0 }),
  [techStats]);

  const selTechData = selTech ? techStats.find(t => t.id === selTech) : null;

  // Date navigation
  const shiftDate = d => setDate(prev => {
    const n = new Date(prev);
    if (period === 'day')  n.setDate(n.getDate() + d);
    if (period === 'week') n.setDate(n.getDate() + d * 7);
    if (period === 'semi') n.setDate(n.getDate() + d * 15);
    return n;
  });

  const dateLabel = () => {
    const fm = (d, o) => d.toLocaleDateString('en-US', o);
    const md  = { month: 'short', day: 'numeric' };
    const mdy = { month: 'short', day: 'numeric', year: 'numeric' };
    if (period === 'day') return fm(date, { month: 'long', day: 'numeric', year: 'numeric' });
    if (period === 'week') {
      const s = new Date(date); s.setDate(s.getDate() - s.getDay());
      const e = new Date(s);    e.setDate(e.getDate() + 6);
      return `${fm(s, md)} – ${fm(e, mdy)}`;
    }
    const [y, m, d2] = [date.getFullYear(), date.getMonth(), date.getDate()];
    if (d2 <= 15) return `${fm(new Date(y, m, 1), md)} – ${fm(new Date(y, m, 15), mdy)}`;
    return `${fm(new Date(y, m, 16), md)} – ${fm(new Date(y, m + 1, 0), mdy)}`;
  };

  // CSV export
  const exportCSV = () => {
    const hdr = ['Tech','Exempt','Services','Gross','Card Fee','Supply Fee','Total Deductions','Commissionable','Card Tips'];
    const rows = techStats.map(t => [
      t.full, t.isExempt ? 'Yes' : 'No',
      t.svcCount,
      t.subtotal.toFixed(2), t.cardFee.toFixed(2), (t.supplyFee + t.pediFee).toFixed(2),
      t.totalDeductions.toFixed(2), t.net.toFixed(2), t.tips.toFixed(2),
    ]);
    rows.push(['TOTAL','',grand.svcCount,
      grand.subtotal.toFixed(2),grand.cardFee.toFixed(2),(grand.supplyFee + grand.pediFee).toFixed(2),
      grand.totalDed.toFixed(2),grand.net.toFixed(2),grand.tips.toFixed(2),
    ]);
    const csv = [hdr, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = `Day-Report-${date.toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const toggleExpand = id => setExpanded(prev => {
    const s = new Set(prev);
    s.has(id) ? s.delete(id) : s.add(id);
    return s;
  });

  return (
    <div className="dr-app">

      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="dr-header">
        <div className="dr-header-l">
          <span className="dr-title">Day Report</span>

          <div className="dr-date-nav">
            <button className="dr-nav-btn" onClick={() => shiftDate(-1)}><IcoChevL /></button>
            <span className="dr-date-lbl">{dateLabel()}</span>
            <button className="dr-nav-btn" onClick={() => shiftDate(1)}><IcoChevR /></button>
          </div>

          <div className="dr-periods">
            {[['day','Day'],['week','Week'],['semi','Semi-Mo']].map(([v, l]) => (
              <button key={v} className={`dr-period-btn${period === v ? ' on' : ''}`} onClick={() => setPeriod(v)}>{l}</button>
            ))}
          </div>
        </div>

        <div className="dr-header-r">
          <button className="dr-ghost-btn" onClick={() => window.print()}><IcoPrint /> Print</button>
          <button className="dr-ghost-btn" onClick={exportCSV}><IcoDownload /> Export CSV</button>
        </div>
      </header>

      {/* ── Summary strip ──────────────────────────────────────── */}
      {variant === 'original' && (
        <div className="dr-summary">
          <div className="dr-stat">
            <div className="dr-stat-l">Gross Revenue</div>
            <div className="dr-stat-v">{f$(grand.subtotal)}</div>
            <div className="dr-stat-s">{grand.txCount} transactions · {grand.svcCount} services</div>
          </div>
          <div className="dr-stat">
            <div className="dr-stat-l">Total Deductions</div>
            <div className="dr-stat-v neg">−{f$(grand.totalDed)}</div>
            <div className="dr-stat-s">Card ${grand.cardFee} · Supply ${grand.supplyFee + grand.pediFee}</div>
          </div>
          <div className="dr-stat last">
            <div className="dr-stat-l">Card Tips</div>
            <div className="dr-stat-v tip">{f$(grand.tips)}</div>
            <div className="dr-stat-s">Cash tips kept by tech, not reported</div>
          </div>
        </div>
      )}

      {/* Variant B: contextual scoreboard strip — updates with selection */}
      {variant === 'b' && (() => {
        const sc = selTechData || {
          subtotal: grand.subtotal, totalDeductions: grand.totalDed,
          net: grand.net, tips: grand.tips, isExempt: false,
        };
        const stats = [
          { l: 'Gross', v: f$(sc.subtotal), cls: '' },
          ...(!sc.isExempt ? [{ l: 'Deducted', v: `−${f$(sc.totalDeductions)}`, cls: 'neg' }] : []),
          { l: 'Commissionable', v: f$(sc.net), cls: 'pos', title: 'Eligible for the tech / salon split.' },
          { l: 'Card Tips', v: f$(sc.tips), cls: 'tip' },
        ];
        return (
          <div className="dr-summary-b">
            <div className="dr-scope">
              <div className="dr-scope-ttl">
                {selTechData ? selTechData.full : 'All Staff'}
                {selTechData?.isExempt && <span className="dr-exempt-badge" style={{ marginLeft: 6 }}>No deductions</span>}
              </div>
              <div className="dr-scope-sub">
                {selTechData
                  ? `${selTechData.txCount} clients · ${selTechData.svcCount} services`
                  : `${techStats.length} techs · ${grand.txCount} transactions · ${grand.svcCount} services`}
              </div>
            </div>
            <div className="dr-scope-stats">
              {stats.map(({ l, v, cls, title }) => (
                <div key={l} className="dr-scope-stat" title={title || undefined}>
                  <div className="dr-scope-stat-l">{l}</div>
                  <div className={`dr-scope-stat-v ${cls}`}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Body ───────────────────────────────────────────────── */}
      <div className="dr-body">

        {/* Left: tech list */}
        <div className={`dr-left${variant !== 'original' ? ' nav' : ''}`}>
          <button
            className={`dr-allstaff-btn${!selTech ? ' on' : ''}`}
            onClick={() => setSelTech(null)}
          >
            <div style={{ fontWeight: 700, fontSize: 13 }}>All Staff</div>
            <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 1 }}>
              {techStats.length} techs · {grand.txCount} transactions
            </div>
          </button>

          <div className="dr-tech-list">
            {techStats.map(t => (
              <button
                key={t.id}
                className={`dr-tech-card${selTech === t.id ? ' on' : ''}${variant !== 'original' ? ' nav' : ''}`}
                onClick={() => setSelTech(t.id)}
              >
                {/* Row 1: avatar + name */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <DrAvatar tech={t} size={variant !== 'original' ? 28 : 30} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{t.name}</span>
                      {t.isExempt && <span className="dr-exempt-tag">Exempt</span>}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>
                      {t.svcCount} services
                    </div>
                  </div>
                  {variant === 'a' && (
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                        {fInt(t.net)}
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>Net</div>
                    </div>
                  )}
                </div>

                {variant === 'original' && <>
                  {/* Row 2: numbers */}
                  <div className="dr-card-nums">
                    <div className="dr-card-num">
                      <span className="dr-cn-l">Gross</span>
                      <span className="dr-cn-v">{fInt(t.subtotal)}</span>
                    </div>
                    {!t.isExempt && (
                      <div className="dr-card-num">
                        <span className="dr-cn-l">Deduct</span>
                        <span className="dr-cn-v neg">−{fInt(t.totalDeductions)}</span>
                      </div>
                    )}
                    <div className="dr-card-num">
                      <span className="dr-cn-l">Net</span>
                      <span className="dr-cn-v bold">{fInt(t.net)}</span>
                    </div>
                  </div>

                  {/* Row 3: tips */}
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    marginTop: 5, paddingTop: 5,
                    borderTop: '1px solid var(--border)',
                  }}>
                    <span style={{ fontSize: 10, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Card Tips</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'oklch(0.42 0.12 150)' }}>{f$(t.tips)}</span>
                  </div>
                </>}
              </button>
            ))}
          </div>
        </div>

        {/* Right: detail */}
        <div className="dr-right">
          {selTechData
            ? <DrTechDetailView t={selTechData} expandedTx={expanded} onToggle={toggleExpand} variant={variant} />
            : <DrAllStaffView techStats={techStats} grand={grand} variant={variant} />
          }
        </div>
      </div>
    </div>
  );
}

window.DayReport = DayReport;
