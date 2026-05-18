// PayrollPulse.jsx — Variation 3: Full-width ledger + dedicated tech detail screen
// • Table is first-class: full width, no side panel competing for space.
// • Click a row → routes to a dedicated detail screen for that tech, with the
//   larger Daily Activity chart from Variation 2 given proper room to breathe.
// • Back button returns to the ledger; selection state is preserved.

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

  // Route state: null = ledger, otherwise tech id = detail screen for that tech.
  const [route, setRoute] = useppState(null);

  const [paidMap, setPaidMap] = useppState({
    karin: { method: 'Zelle', paid_on: 'May 17, 2026', recorded_by: 'Priya R.' },
  });
  const [methodDraft, setMethodDraft] = useppState('Zelle');

  const paidCount = Object.keys(paidMap).length;
  const eligibleCount = rows.filter(r => r.earnings > 0).length;

  const periodCashRemaining = rows
    .filter(r => !paidMap[r.id])
    .reduce((s, r) => s + r.cash, 0);

  function markPaid(techId, method) {
    setPaidMap(p => ({ ...p, [techId]: { method, paid_on: 'May 17, 2026', recorded_by: 'Priya R.' } }));
  }
  function undoPaid(techId) {
    setPaidMap(p => { const n = { ...p }; delete n[techId]; return n; });
  }

  if (route) {
    const row = rows.find(r => r.id === route);
    if (row) {
      // For prev/next navigation within the detail screen
      const idx = rows.findIndex(r => r.id === route);
      const prev = rows[idx - 1];
      const next = rows[idx + 1];
      return (
        <PulseDetailScreen
          row={row}
          paid={paidMap[row.id]}
          methodDraft={methodDraft}
          onMethodChange={setMethodDraft}
          onMarkPaid={(method) => markPaid(row.id, method)}
          onUndoPaid={() => undoPaid(row.id)}
          onBack={() => setRoute(null)}
          onGoToTech={(id) => setRoute(id)}
          prev={prev}
          next={next}
          periodLabel="May 1 – May 15, 2026"
        />
      );
    }
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

      <div className="pp-ledger-body">
        <div className="pl-table-card">
          <div className="pl-table-head">
            <div className="pl-tabs">
              <button className="pl-tab on">All techs <span className="ct">{rows.length}</span></button>
              <button className="pl-tab">To pay <span className="ct">{eligibleCount - paidCount}</span></button>
              <button className="pl-tab">Paid <span className="ct">{paidCount}</span></button>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-outline btn-sm"><UM.FileBar /> Export CSV</button>
            </div>
          </div>

          <div className="pl-table-wrap">
            <table className="pl-table pp-full-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th className="num">Tickets</th>
                  <th className="num">Income</th>
                  <th className="num">After split</th>
                  <th className="num">Card tips</th>
                  <th className="num">After split</th>
                  <th className="num">Check</th>
                  <th className="num">Cash</th>
                  <th className="center">State</th>
                  <th className="pp-chev-th" />
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const paid = paidMap[r.id];
                  const isSkip = r.earnings <= 0;
                  return (
                    <tr key={r.id} onClick={() => setRoute(r.id)}>
                      <td>
                        <div className="pl-person">
                          <StaffAv name={r.name} color={r.color} size={30} />
                          <div className="pl-person-text">
                            <div className="pl-person-name">{r.name}</div>
                            <div className="pl-person-rate">{r.role} · {pct(r.income_split)} svc / {pct(r.tip_split)} tips</div>
                          </div>
                        </div>
                      </td>
                      <td className="num muted tnum">{r.tickets || '—'}</td>
                      <td className="num muted">{$$(r.income)}</td>
                      <td className="num">{$$(r.incomeAfter)}</td>
                      <td className="num tip">{$$(r.tipCard)}</td>
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
                      <td className="pp-chev-td">
                        <UM.ChevronRight size={14} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td className="muted">{rows.length} employees</td>
                  <td className="num">{totals.tickets}</td>
                  <td className="num">{$$(totals.income)}</td>
                  <td className="num">{$$(totals.incomeAfter)}</td>
                  <td className="num">{$$(totals.tipCard)}</td>
                  <td className="num">{$$(totals.tipAfter)}</td>
                  <td className="num">{$$(totals.check)}</td>
                  <td className="num" style={{ color: 'var(--rose-700)' }}>{$$(totals.cash)}</td>
                  <td />
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div className="pp-ledger-hint">
          Click any row to open that tech's detail screen — daily activity, breakdown, and pay action.
        </div>
      </div>
    </div>
  );
}

/* ── Dedicated detail screen for a single tech ────────────────────────── */
function PulseDetailScreen({
  row, paid, methodDraft, onMethodChange, onMarkPaid, onUndoPaid,
  onBack, onGoToTech, prev, next, periodLabel,
}) {
  const isSkip = row.earnings <= 0;
  const maxDay = Math.max(...row.days.map(d => d[1]), 1);
  const bestDay = row.days.reduce((a, b) => (b[1] > a[1] ? b : a), row.days[0]);
  const workingDays = row.days.filter(d => d[1] > 0).length;
  const avgDay = workingDays ? row.income / workingDays : 0;

  return (
    <div className="pr-app pp-detail-screen">
      {/* Breadcrumb / back nav */}
      <div className="pp-detail-topbar">
        <button className="pp-back" onClick={onBack}>
          <UM.ChevronLeft size={14} /> Payroll · {periodLabel}
        </button>
        <div className="pp-detail-topbar-nav">
          <button
            className="btn btn-ghost btn-sm"
            disabled={!prev}
            onClick={() => prev && onGoToTech(prev.id)}>
            <UM.ChevronLeft size={14} /> {prev ? prev.name.split(' ')[0] : 'Prev'}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            disabled={!next}
            onClick={() => next && onGoToTech(next.id)}>
            {next ? next.name.split(' ')[0] : 'Next'} <UM.ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* Tech header */}
      <div className="pp-detail-header">
        <div className="pp-detail-header-l">
          <StaffAv name={row.name} color={row.color} size={56} />
          <div>
            <div className="pp-detail-eyebrow">Tech payroll</div>
            <div className="pp-detail-name">{row.name}</div>
            <div className="pp-detail-meta">
              {row.role} · <span className="tnum">{pct(row.income_split)}</span> service / <span className="tnum">{pct(row.tip_split)}</span> tips
              {!isSkip && <> · <span className="tnum">{row.tickets}</span> tickets across the period</>}
            </div>
          </div>
        </div>

        <div className="pp-detail-header-r">
          {isSkip ? (
            <span className="pl-state pl-state-skip"><span className="dot" /> No work this period</span>
          ) : paid ? (
            <span className="pl-state pl-state-paid"><span className="dot" /> Paid · {paid.method} · {paid.paid_on}</span>
          ) : (
            <span className="pl-state pl-state-pending"><span className="dot" /> Pending payment</span>
          )}
          {!isSkip && (
            <div className="pp-detail-bignum">
              <div className="pp-detail-bignum-l">Cash to hand over</div>
              <div className="pp-detail-bignum-v">{$$(row.cash)}</div>
              <div className="pp-detail-bignum-s">+ ${row.check.toLocaleString()} reported on check</div>
            </div>
          )}
        </div>
      </div>

      {/* Main content: two columns */}
      <div className="pp-detail-grid">
        {/* LEFT — big daily activity chart */}
        <div className="pp-detail-chart-card">
          <div className="pp-detail-chart-card-head">
            <div>
              <div className="pl-section-title" style={{ marginBottom: 4 }}>Daily activity</div>
              <div className="pp-detail-chart-sub">{periodLabel}</div>
            </div>
            <div className="pp-detail-chart-stats">
              <div className="pp-stat">
                <div className="pp-stat-l">Best day</div>
                <div className="pp-stat-v">May {bestDay?.[0] ?? '—'}</div>
                <div className="pp-stat-s">{$$(bestDay?.[1] || 0, { showCents: false })}</div>
              </div>
              <div className="pp-stat">
                <div className="pp-stat-l">Avg per working day</div>
                <div className="pp-stat-v">{$$round(avgDay)}</div>
                <div className="pp-stat-s">{workingDays} days worked</div>
              </div>
              <div className="pp-stat">
                <div className="pp-stat-l">Cash tips</div>
                <div className="pp-stat-v" style={{ color: 'var(--muted-foreground)' }}>—</div>
                <div className="pp-stat-s">Not recorded</div>
              </div>
            </div>
          </div>

          {isSkip ? (
            <div className="pl-detail-empty" style={{ padding: '60px 20px' }}>
              <UM.Clock size={36} />
              <div>{row.name} didn't book any tickets this period.{row.status === 'leave' ? ' Currently on leave.' : ''}</div>
            </div>
          ) : (
            <>
              <div className="pp-detail-chart-grid pp-detail-chart-grid-big">
                {PP_DAYS.map(day => {
                  const data = row.days.find(d => d[0] === day.d) || [day.d, 0, 0, 0];
                  const inc = data[1];
                  const tip = data[2];
                  const tkts = data[3];
                  const closed = day.closed || (inc === 0 && tip === 0);
                  const incH = inc > 0 ? (inc / maxDay) * 180 : 0;
                  const tipH = tip > 0 ? Math.min(40, Math.max(4, (tip / (maxDay * 0.12)) * 36)) : 0;
                  const isBest = bestDay && day.d === bestDay[0] && inc > 0;
                  return (
                    <div key={day.d} className={`pp-detail-col big${closed ? ' closed' : ''}${(day.wd === 'Sat' || day.wd === 'Sun') ? ' weekend' : ''}${isBest ? ' best' : ''}`}>
                      <div className="pp-detail-col-amt">{inc > 0 ? $$(inc, { showCents: false }) : ''}</div>
                      <div className="pp-detail-bars" style={{ height: 200 }}>
                        {tip > 0 && <div className="tip" style={{ height: tipH }} title={`Tips: ${$$(tip)}`} />}
                        {inc > 0 && <div className="inc" style={{ height: incH }} title={`${day.wd} ${day.d}: ${$$(inc)}`} />}
                        {closed && !day.closed && <div className="zero" />}
                      </div>
                      <div className="pp-detail-d">{day.d}</div>
                      <div className="pp-detail-wd">{day.wd}</div>
                      {!closed && tkts > 0 && <div className="pp-detail-tkts">{tkts} tkt{tkts > 1 ? 's' : ''}</div>}
                      {day.closed && <div className="pp-detail-tkts closed-lbl">closed</div>}
                    </div>
                  );
                })}
              </div>
              <div className="pp-detail-chart-legend">
                <span><span className="sw service" /> Service income</span>
                <span><span className="sw tip" /> Card tips</span>
                <span><span className="sw best" /> Best day</span>
                <span style={{ marginLeft: 'auto' }}>Hover any bar for ticket detail · <a href="#">Open day reports</a></span>
              </div>
            </>
          )}
        </div>

        {/* RIGHT — breakdown + pay action stacked */}
        <div className="pp-detail-side">
          <div className="pp-detail-card">
            <div className="pl-section-title">Earnings breakdown</div>
            {isSkip ? (
              <div className="pl-detail-empty" style={{ padding: 20 }}>
                <div>Nothing owed this period.</div>
              </div>
            ) : (
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
            )}
          </div>

          {!isSkip && (
            <div className="pp-detail-card pp-detail-pay-card">
              {paid ? (
                <>
                  <div className="pl-paid-receipt" style={{ margin: 0 }}>
                    <div className="ico"><UM.Check size={14} /></div>
                    <div className="pl-paid-receipt-t">
                      <div className="pl-paid-receipt-title">Paid via {paid.method} on {paid.paid_on}</div>
                      <div className="pl-paid-receipt-sub">Recorded by {paid.recorded_by} · Receipt #PR-2026-05-{row.id.slice(0,3).toUpperCase()}<br />Pay stub sent automatically.</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                    <button className="btn btn-outline" style={{ flex: 1 }} onClick={onUndoPaid}><UM.RefreshCcw /> Undo</button>
                    <button className="btn btn-outline" style={{ flex: 1 }}><UM.Send /> Resend stub</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="pl-section-title" style={{ marginBottom: 8 }}>Pay {row.name.split(' ')[0]}</div>
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
                  <button
                    className="btn btn-primary"
                    style={{ width: '100%', marginTop: 10 }}
                    onClick={() => onMarkPaid(methodDraft)}>
                    <UM.Check /> Mark {$$(row.cash)} paid by {methodDraft}
                  </button>
                  <div className="pp-detail-pay-foot">
                    Pay date is <b>Sun, May 17</b>. Stub will be emailed automatically.
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { PayrollPulse });
