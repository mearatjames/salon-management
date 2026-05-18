// PayrollStack.jsx — Variation 2: Editorial review cards ("Drafts")
// One tall card per tech, big editorial typography, money-flow waterfall,
// daily bar chart, and inline pay action. Designed to be read top-to-bottom.

const { useState: usePsState, useMemo: usePsMemo, useRef: usePsRef, useEffect: usePsEffect } = React;

const PS_DAYS = [
  { d: 1,  wd: 'Fri', closed: false }, { d: 2, wd: 'Sat', closed: false }, { d: 3, wd: 'Sun', closed: true },
  { d: 4,  wd: 'Mon', closed: false }, { d: 5, wd: 'Tue', closed: false }, { d: 6, wd: 'Wed', closed: false }, { d: 7, wd: 'Thu', closed: false },
  { d: 8,  wd: 'Fri', closed: false }, { d: 9, wd: 'Sat', closed: false }, { d:10, wd: 'Sun', closed: true },
  { d: 11, wd: 'Mon', closed: false }, { d:12, wd: 'Tue', closed: false }, { d:13, wd: 'Wed', closed: false }, { d:14, wd: 'Thu', closed: false }, { d:15, wd: 'Fri', closed: false },
];

function PayrollStack() {
  const rows = usePsMemo(() => periodRows(), []);
  const totals = usePsMemo(() => periodTotals(rows), [rows]);

  const [paidMap, setPaidMap] = usePsState({
    karin: { method: 'Zelle', paid_on: 'May 17, 2026' },
  });

  const eligible = rows.filter(r => r.earnings > 0);
  const paidCount = eligible.filter(r => paidMap[r.id]).length;
  const cashRemaining = eligible.filter(r => !paidMap[r.id]).reduce((s, r) => s + r.cash, 0);
  const progressPct = eligible.length ? paidCount / eligible.length : 0;

  function pay(techId, method) {
    setPaidMap(p => ({ ...p, [techId]: { method, paid_on: 'May 17, 2026' } }));
  }
  function undo(techId) {
    setPaidMap(p => { const n = { ...p }; delete n[techId]; return n; });
  }
  function scrollToTech(id) {
    const el = document.getElementById(`ps-card-${id}`);
    if (el) el.scrollIntoView ? el.scrollIntoView({ behavior: 'smooth', block: 'start' }) : null;
  }

  return (
    <div className="pr-app">
      <div className="pr-header">
        <div className="pr-header-titles">
          <div className="pr-eyebrow">Payroll · review &amp; pay</div>
          <div className="pr-h1">May 1 – May 15, 2026</div>
          <div className="pr-h1-sub">
            Pay date <b>Sun, May 17</b> · <b>{$$round(cashRemaining)}</b> still to hand out ·
            {' '}<b>{paidCount}</b> of {eligible.length} reviewed
          </div>
        </div>
        <div className="pr-header-actions">
          <div className="pr-period-switch">
            <button className="on"><span className="dot open" /> May 1 – 15</button>
            <button><span className="dot paid" /> Apr 16 – 30</button>
            <button>Earlier…</button>
          </div>
          <button className="btn btn-outline btn-sm"><UM.Send /> Send all stubs</button>
          <button className="btn btn-primary btn-sm"><UM.Check /> Close period</button>
        </div>
      </div>

      <Kpis totals={totals} paidCount={paidCount} eligibleCount={eligible.length} />

      <div className="ps-body">
        <aside className="ps-rail">
          <div className="ps-rail-card">
            <div className="ps-rail-title">Progress</div>
            <div className="ps-progress-ring">
              <div className="ps-progress-num">{paidCount}</div>
              <div className="ps-progress-den">/ {eligible.length}</div>
            </div>
            <div className="ps-progress-bar"><div className="ps-progress-bar-fill" style={{ width: `${progressPct * 100}%` }} /></div>
            <div className="ps-progress-hint">Mark each tech paid to close out this period.</div>
          </div>

          <div className="ps-rail-card">
            <div className="ps-rail-title">Techs</div>
            <div className="ps-tech-nav">
              {rows.map(r => {
                const paid = !!paidMap[r.id];
                const skip = r.earnings <= 0;
                return (
                  <button key={r.id} className="ps-tech-nav-row" onClick={() => scrollToTech(r.id)}>
                    <span className={`check ${skip ? 'skip' : paid ? 'done' : 'todo'}`}>
                      {paid && <UM.Check size={9} />}
                      {skip && <UM.X size={9} />}
                    </span>
                    <span className="name">{r.name.split(' ')[0]}</span>
                    <span className="amt">{skip ? '—' : $$(r.cash, { showCents: false })}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="ps-rail-card">
            <div className="ps-rail-title">Recent periods</div>
            {HISTORY.slice(0, 4).map((h, i) => (
              <div key={i} className="ps-history-row">
                <div className="lbl">{h.period_label.replace(', 2026', '')}</div>
                <div className="amt">{$$round(h.totals.cash + h.totals.check)}</div>
              </div>
            ))}
          </div>
        </aside>

        <div className="ps-stack">
          {rows.map(r => (
            <TechCard
              key={r.id}
              row={r}
              paid={paidMap[r.id]}
              onPay={(method) => pay(r.id, method)}
              onUndo={() => undo(r.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// Kpis is defined in PayrollLedger.jsx but we want to be safe — define locally if missing.
function Kpis({ totals, paidCount, eligibleCount }) {
  return (
    <div className="pr-kpis">
      <div className="pr-kpi">
        <div className="pr-kpi-label">Gross service income</div>
        <div className="pr-kpi-value">{$$round(totals.income)}</div>
        <div className="pr-kpi-sub"><b>{totals.tickets}</b> tickets across the period</div>
      </div>
      <div className="pr-kpi">
        <div className="pr-kpi-label">Card tips collected</div>
        <div className="pr-kpi-value tip">{$$round(totals.tipCard)}</div>
        <div className="pr-kpi-sub">Cash tips paid directly to techs</div>
      </div>
      <div className="pr-kpi">
        <div className="pr-kpi-label">Owed to techs</div>
        <div className="pr-kpi-value cash">{$$round(totals.earnings)}</div>
        <div className="pr-kpi-sub"><b>{$$round(totals.check)}</b> check · <b>{$$round(totals.cash)}</b> cash</div>
      </div>
      <div className="pr-kpi">
        <div className="pr-kpi-label">Reviewed</div>
        <div className="pr-kpi-value">{paidCount}<span style={{ color: 'var(--muted-foreground)', fontSize: 16, fontWeight: 500 }}>/{eligibleCount}</span></div>
        <div className="pr-kpi-sub">Techs marked paid</div>
      </div>
    </div>
  );
}

function TechCard({ row, paid, onPay, onUndo }) {
  const skip = row.earnings <= 0;
  const [methodDraft, setMethodDraft] = usePsState(paid?.method || 'Zelle');

  // Bar scale: scale all bars relative to gross income (or 1 if zero)
  const scale = Math.max(row.income + row.tipCard, 1);
  const w = (n) => `${Math.max(2, (n / scale) * 100)}%`;

  // Daily chart: tallest income column drives height
  const maxDay = Math.max(...row.days.map(d => d[1]), 1);

  return (
    <div id={`ps-card-${row.id}`} className={`ps-card${paid ? ' paid' : ''}${skip ? ' skip' : ''}`}>
      <div className="ps-card-head">
        <div className="ps-card-av">
          <StaffAv name={row.name} color={row.color} size={44} />
          <div>
            <div className="ps-card-name">{row.name}</div>
            <div className="ps-card-meta">
              {row.role} · {pct(row.income_split)} service / {pct(row.tip_split)} tips · {row.tickets} tickets
            </div>
          </div>
        </div>

        <div />

        <div className="ps-card-headline">
          <div className="ps-card-headline-l">{paid ? 'Paid' : skip ? '' : 'Cash to hand over'}</div>
          <div className="ps-card-headline-v">{skip ? '—' : $$(row.cash)}</div>
          <div className="ps-card-headline-s">
            {skip ? (row.status === 'leave' ? 'On leave this period' : 'No tickets booked')
              : paid ? `Via ${paid.method} on ${paid.paid_on}`
              : `+ $${row.check.toLocaleString()} reported on W-2 check`}
          </div>
        </div>

        <div className="ps-card-actions">
          {paid ? (
            <button className="btn btn-outline btn-sm" onClick={onUndo}><UM.RefreshCcw /> Undo</button>
          ) : !skip ? (
            <button className="btn btn-outline btn-sm"><UM.Send /> Preview stub</button>
          ) : null}
        </div>
      </div>

      {!skip && !paid && (
        <>
          <div className="ps-flow">
            <div className="ps-flow-bars">
              <div className="ps-flow-bar-row">
                <div className="ps-flow-bar-l">Service income</div>
                <div className="ps-flow-bar-track"><div className="ps-flow-bar-fill income" style={{ width: w(row.income) }} /></div>
                <div className="ps-flow-bar-v">{$$(row.income, { showCents: false })}</div>
              </div>
              <div className="ps-flow-bar-row">
                <div className="ps-flow-bar-l">↳ keep <span className="tag">{pct(row.income_split)}</span></div>
                <div className="ps-flow-bar-track"><div className="ps-flow-bar-fill income-after" style={{ width: w(row.incomeAfter) }} /></div>
                <div className="ps-flow-bar-v">{$$(row.incomeAfter)}</div>
              </div>

              <div className="ps-flow-bar-divider" />

              <div className="ps-flow-bar-row">
                <div className="ps-flow-bar-l">Card tips</div>
                <div className="ps-flow-bar-track"><div className="ps-flow-bar-fill tip" style={{ width: w(row.tipCard) }} /></div>
                <div className="ps-flow-bar-v">{$$(row.tipCard)}</div>
              </div>
              <div className="ps-flow-bar-row">
                <div className="ps-flow-bar-l">↳ keep <span className="tag">{pct(row.tip_split)}</span></div>
                <div className="ps-flow-bar-track"><div className="ps-flow-bar-fill tip-after" style={{ width: w(row.tipAfter) }} /></div>
                <div className="ps-flow-bar-v">{$$(row.tipAfter)}</div>
              </div>

              <div className="ps-flow-bar-divider" />

              <div className="ps-flow-bar-row">
                <div className="ps-flow-bar-l">Check (W-2)</div>
                <div className="ps-flow-bar-track"><div className="ps-flow-bar-fill check" style={{ width: w(row.check) }} /></div>
                <div className="ps-flow-bar-v muted">{$$(row.check, { showCents: false })}</div>
              </div>
              <div className="ps-flow-bar-row">
                <div className="ps-flow-bar-l" style={{ color: 'var(--rose-700)', fontWeight: 500 }}>Cash payment</div>
                <div className="ps-flow-bar-track"><div className="ps-flow-bar-fill cash" style={{ width: w(row.cash) }} /></div>
                <div className="ps-flow-bar-v cash">{$$(row.cash)}</div>
              </div>
            </div>

            <div className="ps-daily-card">
              <div className="ps-daily-head">
                <div className="ps-daily-head-l">Daily activity</div>
                <div className="ps-daily-head-r">May 1 – 15, 2026</div>
              </div>
              <div className="ps-daily-chart">
                {PS_DAYS.map(day => {
                  const data = row.days.find(d => d[0] === day.d) || [day.d, 0, 0, 0];
                  const incH = (data[1] / maxDay) * 56;
                  const tipH = (data[2] / maxDay) * 56 * 4; // amplify so tip is visible
                  return (
                    <div key={day.d} className={`ps-daily-col${day.closed || (data[1] === 0 && data[2] === 0) ? ' closed' : ''}`}>
                      <div className="bar" style={{ height: data[1] ? Math.max(2, incH) : 0 }} title={`${day.wd} ${day.d}: ${$$(data[1])}`} />
                      <div className="tip-bar" style={{ height: data[2] ? Math.max(2, Math.min(20, tipH)) : 0 }} title={`Tips: ${$$(data[2])}`} />
                      <div className="lbl">{day.d}</div>
                    </div>
                  );
                })}
              </div>
              <div className="ps-daily-legend">
                <span><span className="swatch" style={{ background: 'var(--rose-300)' }} /> Service</span>
                <span><span className="swatch" style={{ background: 'oklch(0.72 0.10 150)' }} /> Tips</span>
                <span style={{ marginLeft: 'auto' }}>Best: <b style={{ color: 'var(--foreground)' }}>{$$(Math.max(...row.days.map(d => d[1])), { showCents: false })}</b></span>
              </div>
            </div>
          </div>

          <div className="ps-card-foot">
            <div className="ps-card-foot-l">
              <span>Pay <b>{$$(row.cash)}</b> by:</span>
              <div className="pl-method-tabs" style={{ gridTemplateColumns: 'repeat(3, auto)' }}>
                <button className={`pl-method${methodDraft === 'Cash' ? ' on' : ''}`} onClick={() => setMethodDraft('Cash')}><UM.Cash size={12} /> Cash</button>
                <button className={`pl-method${methodDraft === 'Zelle' ? ' on' : ''}`} onClick={() => setMethodDraft('Zelle')}><UM.CreditCard size={12} /> Zelle</button>
                <button className={`pl-method${methodDraft === 'Check' ? ' on' : ''}`} onClick={() => setMethodDraft('Check')}><UM.FileBar size={12} /> Check</button>
              </div>
            </div>
            <div className="ps-card-foot-r">
              <button className="btn btn-ghost btn-sm">Skip this tech</button>
              <button className="btn btn-primary btn-sm" onClick={() => onPay(methodDraft)}>
                <UM.Check /> Mark paid
              </button>
            </div>
          </div>
        </>
      )}

      {!skip && paid && (
        <div className="ps-card-foot">
          <div className="ps-card-foot-l">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'oklch(0.40 0.12 150)', fontWeight: 500 }}>
              <UM.Check size={14} /> Paid <b style={{ color: 'oklch(0.36 0.12 150)' }}>{$$(row.cash)}</b> via <b style={{ color: 'oklch(0.36 0.12 150)' }}>{paid.method}</b> on {paid.paid_on}
            </span>
          </div>
          <div className="ps-card-foot-r">
            <button className="btn btn-ghost btn-sm"><UM.Send /> Resend pay stub</button>
            <button className="btn btn-outline btn-sm" onClick={onUndo}><UM.RefreshCcw /> Undo</button>
          </div>
        </div>
      )}

      {skip && (
        <div className="ps-card-foot">
          <div className="ps-card-foot-l">
            <UM.Clock size={14} style={{ color: 'var(--muted-foreground)' }} />
            <span>{row.status === 'leave' ? 'On leave — no payout owed this period.' : 'No tickets booked this period.'}</span>
          </div>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { PayrollStack });
