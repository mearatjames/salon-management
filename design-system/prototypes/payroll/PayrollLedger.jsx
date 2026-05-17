// PayrollLedger.jsx — Variation 1: Table + detail panel
// Spreadsheet-faithful "ledger" view. Quiet, dense, scannable.

const { useState, useMemo } = React;

const PERIOD_DAY_LABELS = ['F','S','S','M','T','W','T','F','S','S','M','T','W','T','F'];
const PERIOD_DAYS = [
  { d: 1,  wd: 'Fri', closed: false }, { d: 2, wd: 'Sat', closed: false }, { d: 3, wd: 'Sun', closed: true },
  { d: 4,  wd: 'Mon', closed: false }, { d: 5, wd: 'Tue', closed: false }, { d: 6, wd: 'Wed', closed: false }, { d: 7, wd: 'Thu', closed: false },
  { d: 8,  wd: 'Fri', closed: false }, { d: 9, wd: 'Sat', closed: false }, { d:10, wd: 'Sun', closed: true },
  { d: 11, wd: 'Mon', closed: false }, { d:12, wd: 'Tue', closed: false }, { d:13, wd: 'Wed', closed: false }, { d:14, wd: 'Thu', closed: false }, { d:15, wd: 'Fri', closed: false },
];

function PayrollLedger() {
  const rows = useMemo(() => periodRows(), []);
  const totals = useMemo(() => periodTotals(rows), [rows]);

  const [selectedId, setSelectedId] = useState('ayay');
  const [paidMap, setPaidMap] = useState({
    // Pre-seed Karin as already paid this period to show both states
    karin: { method: 'Zelle', paid_on: 'May 17, 2026', recorded_by: 'Priya R.' },
  });
  const [methodDraft, setMethodDraft] = useState('Zelle');

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
      <Header
        currentLabel="May 1 – May 15, 2026"
        periodCashRemaining={periodCashRemaining}
        paidCount={paidCount}
        eligibleCount={eligibleCount}
      />
      <Kpis totals={totals} paidCount={paidCount} eligibleCount={eligibleCount} />

      <div className="pl-body">
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
            <table className="pl-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th className="num">Income</th>
                  <th className="num">After split</th>
                  <th className="num">Tips</th>
                  <th className="num">After split</th>
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
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td className="muted">{rows.length} employees · {totals.tickets} tickets</td>
                  <td className="num">{$$(totals.income)}</td>
                  <td className="num">{$$(totals.incomeAfter)}</td>
                  <td className="num">{$$(totals.tipCard)}</td>
                  <td className="num">{$$(totals.tipAfter)}</td>
                  <td className="num">{$$(totals.check)}</td>
                  <td className="num" style={{ color: 'var(--rose-700)' }}>{$$(totals.cash)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <DetailPanel
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

function Header({ currentLabel, periodCashRemaining, paidCount, eligibleCount }) {
  return (
    <div className="pr-header">
      <div className="pr-header-titles">
        <div className="pr-eyebrow">Payroll · 1st half cycle</div>
        <div className="pr-h1">{currentLabel}</div>
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
  );
}

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
        <div className="pr-kpi-sub">Cash tips not recorded</div>
      </div>
      <div className="pr-kpi">
        <div className="pr-kpi-label">Owed to techs</div>
        <div className="pr-kpi-value cash">{$$round(totals.earnings)}</div>
        <div className="pr-kpi-sub"><b>{$$round(totals.check)}</b> check · <b>{$$round(totals.cash)}</b> cash</div>
      </div>
      <div className="pr-kpi">
        <div className="pr-kpi-label">Progress</div>
        <div className="pr-kpi-value">{paidCount}<span style={{ color: 'var(--muted-foreground)', fontSize: 16, fontWeight: 500 }}>/{eligibleCount}</span></div>
        <div className="pr-kpi-sub">Techs marked paid</div>
      </div>
    </div>
  );
}

function DetailPanel({ row, paid, methodDraft, onMethodChange, onMarkPaid, onUndoPaid }) {
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

            <div>
              <div className="pl-section-title">
                <span>Daily totals · May 1 – 15</span>
                <a href="#">Open day reports</a>
              </div>
              <div className="pl-daily">
                {PERIOD_DAYS.map((day, i) => {
                  const data = row.days.find(d => d[0] === day.d) || [day.d, 0, 0, 0];
                  const closed = day.closed || (data[1] === 0 && data[2] === 0);
                  return (
                    <div key={day.d} className={`pl-daily-row${closed ? ' closed' : ''}${day.wd === 'Sat' || day.wd === 'Sun' ? ' weekend' : ''}`}>
                      <div className="pl-daily-d">{day.d}</div>
                      <div className="pl-daily-day">{day.wd}{day.closed ? ' · closed' : data[3] ? ` · ${data[3]} tkts` : ''}</div>
                      <div className="pl-daily-inc">{data[1] ? $$(data[1], { showCents: false }) : '—'}</div>
                      <div className="pl-daily-tip">{data[2] ? $$(data[2]) : ''}</div>
                    </div>
                  );
                })}
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

Object.assign(window, { PayrollLedger });
