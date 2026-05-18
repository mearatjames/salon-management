// PayrollPulse.jsx — Variation 3: Ledger + inline daily activity sparklines
// Hybrid of Variation 1 (Ledger table + detail panel) and Variation 2 (Daily Activity chart).
// • Every row in the table carries a 15-day mini bar chart so you can read each
//   tech's rhythm without leaving the spreadsheet.
// • The detail panel replaces the day-by-day list with the bigger bar chart from
//   Drafts, including service + tip bars and the "Best day" callout.

const { useState: useppState, useMemo: useppMemo } = React;

const PP_DAYS = [
  { d: 1,  wd: 'Fri', closed: false }, { d: 2, wd: 'Sat', closed: false }, { d: 3, wd: 'Sun', closed: true },
  { d: 4,  wd: 'Mon', closed: false }, { d: 5, wd: 'Tue', closed: false }, { d: 6, wd: 'Wed', closed: false }, { d: 7, wd: 'Thu', closed: false },
  { d: 8,  wd: 'Fri', closed: false }, { d: 9, wd: 'Sat', closed: false }, { d:10, wd: 'Sun', closed: true },
  { d: 11, wd: 'Mon', closed: false }, { d:12, wd: 'Tue', closed: false }, { d:13, wd: 'Wed', closed: false }, { d:14, wd: 'Thu', closed: false }, { d:15, wd: 'Fri', closed: false },
];

function PayrollPulse() {
  const rows = useppMemo(() => periodRows(), []);
  const totals = useppMemo(() => periodTotals(rows), [rows]);

  // Shared scale for the inline sparklines so bars are comparable across rows.
  const sharedMaxDay = useppMemo(() => {
    let m = 1;
    for (const r of rows) for (const d of r.days) if (d[1] > m) m = d[1];
    return m;
  }, [rows]);

  const [selectedId, setSelectedId] = useppState('ayay');
  const [paidMap, setPaidMap] = useppState({
    karin: { method: 'Zelle', paid_on: 'May 17, 2026', recorded_by: 'Priya R.' },
  });
  const [methodDraft, setMethodDraft] = useppState('Zelle');

  const selected = rows.find(r => r.id === selectedId);
  const selectedPaid = selected ? paidMap[selected.id] : null;

  const paidCount = Object.keys(paidMap).length;
  const eligibleCount = rows.filter(r => r.earnings > 0).length;

  const periodCashRemaining = rows
    .filter(r => !paidMap[r.id])
    .reduce((s, r) => s + r.cash, 0);

  function markPaid() {
    if (!selected) return;
    setPaidMap(p => ({ ...p, [selected.id]: { method: methodDraft, paid_on: 'May 17, 2026', recorded_by: 'Priya R.' } }));
  }
  function undoPaid() {
    if (!selected) return;
    setPaidMap(p => { const n = { ...p }; delete n[selected.id]; return n; });
  }

  return (
    <div className="pr-app">
      <div className="pr-header">
        <div className="pr-header-titles">
          <div className="pr-eyebrow">Payroll · 1st half cycle</div>
          <div className="pr-h1">May 1 – May 15, 2026</div>
          <div className="pr-h1-sub">
            Pay date <b>Sun, May 17</b> · <b>{$$round(periodCashRemaining)}</b> in cash remaining ·
            {' '}{paidCount}/{eligibleCount} techs paid
          </div>
        </div>
        <div className="pr-header-actions">
          <div className="pr-period-switch">
            <button className="on"><span className="dot open" /> May 1 – 15</button>
            <button><span className="dot paid" /> Apr 16 – 30</button>
            <button>Apr 1 – 15</button>
            <button>Earlier…</button>
          </div>
          <button className="btn btn-outline btn-sm"><UM.Archive /> History</button>
          <button className="btn btn-primary btn-sm"><UM.Check /> Close period</button>
        </div>
      </div>

      <Kpis totals={totals} paidCount={paidCount} eligibleCount={eligibleCount} />

      <div className="pl-body">
        <div className="pl-table-card">
          <div className="pl-table-head">
            <div className="pl-tabs">
              <button className="pl-tab on">All techs <span className="ct">{rows.length}</span></button>
              <button className="pl-tab">To pay <span className="ct">{eligibleCount - paidCount}</span></button>
              <button className="pl-tab">Paid <span className="ct">{paidCount}</span></button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div className="pp-legend">
                <span><span className="sw service" /> Service</span>
                <span><span className="sw tip" /> Tips</span>
              </div>
              <button className="btn btn-outline btn-sm"><UM.FileBar /> Export CSV</button>
            </div>
          </div>

          <div className="pl-table-wrap">
            <table className="pl-table pp-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th className="pp-spark-th">
                    <div className="pp-spark-th-lbl">Daily activity</div>
                    <div className="pp-spark-th-scale">
                      {PP_DAYS.map(day => (
                        <span
                          key={day.d}
                          className={`pp-spark-th-tick${day.closed ? ' closed' : ''}${day.wd === 'Sat' || day.wd === 'Sun' ? ' weekend' : ''}`}
                        >
                          {day.d}
                        </span>
                      ))}
                    </div>
                  </th>
                  <th className="num">Income</th>
                  <th className="num">Tips</th>
                  <th className="num">Check</th>
                  <th className="num">Cash</th>
                  <th className="center">State</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const paid = paidMap[r.id];
                  const isSkip = r.earnings <= 0;
                  return (
                    <tr key={r.id} className={r.id === selectedId ? 'sel' : ''} onClick={() => setSelectedId(r.id)}>
                      <td>
                        <div className="pl-person">
                          <StaffAv name={r.name} color={r.color} size={30} />
                          <div className="pl-person-text">
                            <div className="pl-person-name">{r.name}</div>
                            <div className="pl-person-rate">{pct(r.income_split)} svc · {pct(r.tip_split)} tips</div>
                          </div>
                        </div>
                      </td>
                      <td className="pp-spark-td">
                        <PulseSparkline row={r} maxDay={sharedMaxDay} />
                      </td>
                      <td className="num">{$$(r.incomeAfter)}</td>
                      <td className="num tip">{$$(r.tipAfter)}</td>
                      <td className="num muted">{$$(r.check)}</td>
                      <td className="num cash">{$$(r.cash)}</td>
                      <td className="center">
                        {isSkip ? (
                          <span className="pl-state pl-state-skip"><span className="dot" /> No work</span>
                        ) : paid ? (
                          <span className="pl-state pl-state-paid"><span className="dot" /> Paid · {paid.method}</span>
                        ) : (
                          <span className="pl-state pl-state-pending"><span className="dot" /> Pending</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td className="muted">{rows.length} employees · {totals.tickets} tickets</td>
                  <td className="pp-spark-td">
                    <PulseSparkline aggregate={rows} maxDay={sharedMaxDay} stacked />
                  </td>
                  <td className="num">{$$(totals.incomeAfter)}</td>
                  <td className="num">{$$(totals.tipAfter)}</td>
                  <td className="num">{$$(totals.check)}</td>
                  <td className="num" style={{ color: 'var(--rose-700)' }}>{$$(totals.cash)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <PulseDetailPanel
          row={selected}
          paid={selectedPaid}
          methodDraft={methodDraft}
          onMethodChange={setMethodDraft}
          onMarkPaid={markPaid}
          onUndoPaid={undoPaid}
        />
      </div>
    </div>
  );
}

/* ── Inline 15-day sparkline (table row + footer aggregate) ───────────── */
function PulseSparkline({ row, aggregate, maxDay, stacked }) {
  // Build per-day series. If aggregate, sum across techs.
  const series = PP_DAYS.map(day => {
    if (aggregate) {
      let inc = 0, tip = 0, tkts = 0;
      for (const r of aggregate) {
        const data = r.days.find(d => d[0] === day.d);
        if (data) { inc += data[1]; tip += data[2]; tkts += data[3] || 0; }
      }
      return { day: day.d, wd: day.wd, closed: day.closed, inc, tip, tkts };
    }
    const data = row?.days.find(d => d[0] === day.d) || [day.d, 0, 0, 0];
    return { day: day.d, wd: day.wd, closed: day.closed, inc: data[1], tip: data[2], tkts: data[3] };
  });

  // Scale: shared (per-tech rows) or self (footer aggregate)
  const localMax = aggregate
    ? Math.max(...series.map(s => s.inc), 1)
    : Math.max(maxDay || 1, 1);

  const hasAny = series.some(s => s.inc > 0 || s.tip > 0);

  return (
    <div className="pp-spark" data-empty={!hasAny}>
      {series.map(s => {
        const incH = s.inc > 0 ? Math.max(2, (s.inc / localMax) * 26) : 0;
        // Tip is much smaller than income; amplify so it's visible as a stripe on top.
        const tipH = s.tip > 0 ? Math.max(2, Math.min(8, (s.tip / (localMax * 0.12)) * 8)) : 0;
        const title = s.closed
          ? `${s.wd} ${s.day} · closed`
          : s.inc === 0 && s.tip === 0
            ? `${s.wd} ${s.day} · no tickets`
            : `${s.wd} ${s.day} · ${$$(s.inc, { showCents: false })} svc${s.tip ? ` · ${$$(s.tip)} tips` : ''}${s.tkts ? ` · ${s.tkts} tkts` : ''}`;
        return (
          <div
            key={s.day}
            className={`pp-spark-col${s.closed ? ' closed' : ''}${(s.wd === 'Sat' || s.wd === 'Sun') ? ' weekend' : ''}`}
            title={title}
          >
            {s.tip > 0 && <div className="pp-spark-tip" style={{ height: tipH }} />}
            {s.inc > 0 && <div className="pp-spark-bar" style={{ height: incH }} />}
            {(!s.inc && !s.tip && !s.closed) && <div className="pp-spark-zero" />}
          </div>
        );
      })}
    </div>
  );
}

/* ── Detail panel: V1 breakdown + V2 chart ────────────────────────────── */
function PulseDetailPanel({ row, paid, methodDraft, onMethodChange, onMarkPaid, onUndoPaid }) {
  if (!row) {
    return (
      <div className="pl-detail">
        <div className="pl-detail-empty">
          <UM.Users size={36} />
          <div>Select a tech on the left to review their breakdown.</div>
        </div>
      </div>
    );
  }

  const isSkip = row.earnings <= 0;
  const maxDay = Math.max(...row.days.map(d => d[1]), 1);
  const bestDay = row.days.reduce((a, b) => (b[1] > a[1] ? b : a), row.days[0]);

  return (
    <div className="pl-detail">
      <div className="pl-detail-head">
        <div className="pl-detail-top">
          <StaffAv name={row.name} color={row.color} size={42} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="pl-detail-name">{row.name}</div>
            <div className="pl-detail-role">{row.role} · <span className="tnum">{pct(row.income_split)}</span> service / <span className="tnum">{pct(row.tip_split)}</span> tips</div>
          </div>
          <div className="pl-detail-state">
            {isSkip ? (
              <span className="pl-state pl-state-skip"><span className="dot" /> No work</span>
            ) : paid ? (
              <span className="pl-state pl-state-paid"><span className="dot" /> Paid</span>
            ) : (
              <span className="pl-state pl-state-pending"><span className="dot" /> Pending</span>
            )}
          </div>
        </div>

        {!isSkip && (
          <div className="pl-detail-pay">
            <div>
              <div className="pl-detail-pay-l">Cash to hand over</div>
              <div className="pl-detail-pay-s">After ${row.check.toLocaleString()} check portion</div>
            </div>
            <div className="pl-detail-pay-r">
              <div className="pl-detail-pay-v">{$$(row.cash)}</div>
            </div>
          </div>
        )}
      </div>

      <div className="pl-detail-body">
        {isSkip ? (
          <div className="pl-detail-empty" style={{ padding: 20 }}>
            <UM.Clock size={32} />
            <div>{row.name} didn't book any tickets this period.{row.status === 'leave' ? ' Currently on leave.' : ''}</div>
          </div>
        ) : (
          <>
            <div>
              <div className="pl-section-title">Earnings breakdown</div>
              <div className="pl-breakdown">
                <div className="pl-bd-row">
                  <div className="pl-bd-l">Service income <span className="rate">{pct(row.income_split)} of {$$(row.income)}</span></div>
                  <div className="pl-bd-r">{$$(row.incomeAfter)}</div>
                </div>
                <div className="pl-bd-row">
                  <div className="pl-bd-l">Card tips <span className="rate">{pct(row.tip_split)} of {$$(row.tipCard)}</span></div>
                  <div className="pl-bd-r">{$$(row.tipAfter)}</div>
                </div>
                <div className="pl-bd-row sub">
                  <div className="pl-bd-l">Total earned</div>
                  <div className="pl-bd-r">{$$(row.earnings)}</div>
                </div>
                <div className="pl-bd-row">
                  <div className="pl-bd-l">Check portion <span className="rate">W-2 wage</span></div>
                  <div className="pl-bd-r minus">{$$(row.check)}</div>
                </div>
                <div className="pl-bd-row total">
                  <div className="pl-bd-l">Cash payment</div>
                  <div className="pl-bd-r">{$$(row.cash)}</div>
                </div>
              </div>
            </div>

            {/* Bigger Daily Activity chart — lifted from Variation 2 */}
            <div>
              <div className="pl-section-title">
                <span>Daily activity · May 1 – 15</span>
                <a href="#">Open day reports</a>
              </div>
              <div className="pp-detail-chart">
                <div className="pp-detail-chart-grid">
                  {PP_DAYS.map(day => {
                    const data = row.days.find(d => d[0] === day.d) || [day.d, 0, 0, 0];
                    const inc = data[1];
                    const tip = data[2];
                    const tkts = data[3];
                    const closed = day.closed || (inc === 0 && tip === 0);
                    const incH = inc > 0 ? (inc / maxDay) * 86 : 0;
                    const tipH = tip > 0 ? Math.min(28, Math.max(3, (tip / (maxDay * 0.12)) * 28)) : 0;
                    const isBest = bestDay && day.d === bestDay[0] && inc > 0;
                    return (
                      <div key={day.d} className={`pp-detail-col${closed ? ' closed' : ''}${(day.wd === 'Sat' || day.wd === 'Sun') ? ' weekend' : ''}${isBest ? ' best' : ''}`}>
                        <div className="pp-detail-bars">
                          {tip > 0 && <div className="tip" style={{ height: tipH }} title={`Tips: ${$$(tip)}`} />}
                          {inc > 0 && <div className="inc" style={{ height: incH }} title={`${day.wd} ${day.d}: ${$$(inc)}`} />}
                          {closed && !day.closed && <div className="zero" title={`${day.wd} ${day.d}: no tickets`} />}
                        </div>
                        <div className="pp-detail-d">{day.d}</div>
                        <div className="pp-detail-wd">{day.wd[0]}</div>
                      </div>
                    );
                  })}
                </div>
                <div className="pp-detail-chart-legend">
                  <span><span className="sw service" /> Service</span>
                  <span><span className="sw tip" /> Tips</span>
                  <span style={{ marginLeft: 'auto' }}>
                    Best day: <b>May {bestDay?.[0]}</b> · {$$(bestDay?.[1] || 0, { showCents: false })}
                  </span>
                </div>
              </div>
            </div>

            {paid && (
              <div className="pl-paid-receipt">
                <div className="ico"><UM.Check size={14} /></div>
                <div className="pl-paid-receipt-t">
                  <div className="pl-paid-receipt-title">Paid via {paid.method} on {paid.paid_on}</div>
                  <div className="pl-paid-receipt-sub">Recorded by {paid.recorded_by} · Receipt #PR-2026-05-{row.id.slice(0,3).toUpperCase()}<br />Pay stub sent automatically.</div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {!isSkip && (
        <div className="pl-detail-foot">
          {paid ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-outline" style={{ flex: 1 }} onClick={onUndoPaid}><UM.RefreshCcw /> Undo</button>
              <button className="btn btn-outline" style={{ flex: 1 }}><UM.Send /> Resend pay stub</button>
            </div>
          ) : (
            <>
              <div className="pl-section-title" style={{ marginBottom: 0 }}><span>Payment method</span></div>
              <div className="pl-method-tabs">
                <button className={`pl-method${methodDraft === 'Cash' ? ' on' : ''}`} onClick={() => onMethodChange('Cash')}>
                  <UM.Cash size={16} /> Cash
                </button>
                <button className={`pl-method${methodDraft === 'Zelle' ? ' on' : ''}`} onClick={() => onMethodChange('Zelle')}>
                  <UM.CreditCard size={16} /> Zelle
                </button>
                <button className={`pl-method${methodDraft === 'Check' ? ' on' : ''}`} onClick={() => onMethodChange('Check')}>
                  <UM.FileBar size={16} /> Check
                </button>
              </div>
              <button className="btn btn-primary" onClick={onMarkPaid}>
                <UM.Check /> Mark {$$(row.cash)} paid by {methodDraft}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

Object.assign(window, { PayrollPulse });
