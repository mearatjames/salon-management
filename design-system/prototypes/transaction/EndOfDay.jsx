// EndOfDay.jsx — End of Day · Cash Count (tablet 1024×720)
// Left: filtered cash transaction list  Right: numpad + comparison + note + CTA

const { useState: eodSt, useMemo: eodMemo, useEffect: eodFx } = React;

// ─── Small tech name pill ─────────────────────────────────────────────────
function EODTechPill({ techId }) {
  const t = STAFF.find(s => s.id === techId);
  if (!t) return null;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      padding: "1px 7px", borderRadius: 9999,
      fontSize: 10, fontWeight: 500, lineHeight: 1.6, whiteSpace: "nowrap",
      background: `oklch(0.91 0.04 ${t.tone})`,
      color: `oklch(0.34 0.08 ${t.tone})`,
    }}>{t.name}</span>
  );
}

// ─── Left panel: cash transaction list ───────────────────────────────────
function EODCashList({ txs, expectedTotal }) {
  return (
    <div className="eod-left">
      <div className="eod-panel-head">
        <span className="eod-panel-title">Cash today</span>
        <span className="eod-count-chip">{txs.length}</span>
      </div>

      <div className="eod-tx-scroll">
        {txs.map(tx => {
          const tot = txTotals(tx);
          const svcs = tx.items.map(it => {
            const s = SERVICES.find(x => x.id === it.id);
            return s ? s.name : it.id;
          });
          const svcStr = svcs.length === 1 ? svcs[0]
            : svcs.length === 2 ? svcs.join(" + ")
            : `${svcs[0]} +${svcs.length - 1}`;
          return (
            <div key={tx.id} className="eod-tx-row">
              <div className="eod-tx-time">{tx.time}</div>
              <div className="eod-tx-body">
                <div className="eod-tx-client">{tx.client}</div>
                <div className="eod-tx-meta">
                  <span className="eod-tx-svc">{svcStr}</span>
                  <span className="eod-tx-sep">·</span>
                  {tx.techs.map(tid => <EODTechPill key={tid} techId={tid} />)}
                </div>
              </div>
              <div className="eod-tx-amt-col">
                <div className="eod-tx-total tnum">${tot.total.toFixed(2)}</div>
                {tot.tip > 0 && (
                  <div className="eod-tx-tip tnum">incl. ${tot.tip.toFixed(2)} tip</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="eod-list-foot">
        <div>
          <div className="eod-foot-label">Expected cash total</div>
          <div className="eod-foot-sub">{txs.length} cash transaction{txs.length !== 1 ? "s" : ""}</div>
        </div>
        <div className="eod-foot-amount tnum">${expectedTotal.toFixed(2)}</div>
      </div>
    </div>
  );
}

// ─── Comparison block ─────────────────────────────────────────────────────
function EODComparison({ expected, counted, hasCounted, diff, isExact, isOver, isShort }) {
  const statusCls = !hasCounted ? "" : isExact ? "match" : isOver ? "over" : "short";
  return (
    <div className={`eod-comparison ${statusCls}`}>
      <div className="eod-comp-row">
        <span className="eod-comp-lbl">Expected</span>
        <span className="eod-comp-num tnum">${expected.toFixed(2)}</span>
      </div>
      <div className="eod-comp-row">
        <span className="eod-comp-lbl">Counted</span>
        <span className="eod-comp-num tnum">{hasCounted ? `$${counted.toFixed(2)}` : "—"}</span>
      </div>
      <div className="eod-comp-divider" />
      <div className={`eod-comp-row eod-diff-row ${statusCls}`}>
        <span className="eod-diff-lbl">
          {!hasCounted && <span style={{ color: "var(--muted-foreground)", fontWeight: 400 }}>Difference</span>}
          {isExact && (
            <span className="eod-diff-exact">
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7"/></svg>
              Exact match
            </span>
          )}
          {isOver  && <span className="eod-diff-over">Over</span>}
          {isShort && <span className="eod-diff-short">Short</span>}
        </span>
        <span className="eod-diff-num tnum">
          {!hasCounted && <span style={{ color: "var(--muted-foreground)" }}>—</span>}
          {isOver  && <span className="eod-diff-over">+${diff.toFixed(2)}</span>}
          {isShort && <span className="eod-diff-short">−${Math.abs(diff).toFixed(2)}</span>}
        </span>
      </div>
    </div>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────
function EndOfDayCash({ preset }) {
  const cashTxs   = TX_HISTORY.filter(tx => tx.method === "cash");
  const expected  = eodMemo(() => cashTxs.reduce((s, tx) => s + txTotals(tx).total, 0), []);

  const [counted,    setCounted]    = eodSt("");
  const [note,       setNote]       = eodSt("");
  const [submitted,  setSubmitted]  = eodSt(false);
  const [fresh,      setFresh]      = eodSt(true);
  const [showHist,   setShowHist]   = eodSt(false);

  // Sync preset tweak → fill numpad display
  eodFx(() => {
    if (preset === "short") { setCounted("157.50"); setFresh(false); }
    else if (preset === "over") { setCounted("168.00"); setFresh(false); }
    else { setCounted(""); setFresh(true); }
    setNote(""); setSubmitted(false);
  }, [preset]);

  const hasCounted = counted !== "";
  const countedNum = parseFloat(counted) || 0;
  const diff       = hasCounted ? countedNum - expected : null;
  const isExact    = diff !== null && Math.abs(diff) < 0.01;
  const isOver     = diff !== null && diff >  0.01;
  const isShort    = diff !== null && diff < -0.01;
  const hasDiff    = isOver || isShort;
  const canSubmit  = hasCounted && (!hasDiff || note.trim().length > 0);
  const dispCls    = !hasCounted ? "" : isExact ? "match" : isShort ? "short" : "over";

  const press = (k) => {
    if (k === "back") { setCounted(p => p.slice(0, -1)); setFresh(false); return; }
    if (fresh) {
      if (k === ".") { setCounted("0."); setFresh(false); return; }
      setCounted(k); setFresh(false); return;
    }
    if (k === "." && counted.includes(".")) return;
    const parts = counted.split(".");
    if (parts[1] && parts[1].length >= 2) return;
    setCounted(p => p + k);
  };
  const clear = () => { setCounted(""); setFresh(true); setNote(""); };

  if (showHist) {
    return <EODCashHistory onExit={() => setShowHist(false)} />;
  }

  if (submitted) {
    return (
      <EODDoneScreen
        expected={expected} counted={countedNum} diff={diff}
        isExact={isExact} isOver={isOver} isShort={isShort}
        note={note} onReset={clear}
        onOpenHistory={() => setShowHist(true)}
      />
    );
  }

  return (
    <div className="tx-app eod-app" data-density="compact">
      {/* Header */}
      <header className="tx-header" style={{ padding: "12px 20px" }}>
        <div>
          <div className="ttl">End of Day · Cash Count</div>
          <div className="sub">Sunday, May 11 · Lacquer Salon</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            className="eod-history-btn"
            onClick={() => setShowHist(true)}
            title="View cash count history"
          >
            <TI.History size={14} />
            Past counts
          </button>
          <span className="eod-status-pill eod-open">Open · Closing at 8 PM</span>
        </div>
      </header>

      {/* Two-column body */}
      <div className="eod-body">
        {/* LEFT: cash list */}
        <EODCashList txs={cashTxs} expectedTotal={expected} />

        {/* Column divider */}
        <div style={{ width: 1, background: "var(--border)", flexShrink: 0 }} />

        {/* RIGHT: count panel */}
        <div className="eod-right">

          {/* Label + clear */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span className="eyebrow">Count your drawer</span>
            {hasCounted && (
              <button className="tx-link" onClick={clear} style={{ fontSize: 12 }}>Clear</button>
            )}
          </div>

          {/* Amount display */}
          <div className={`eod-display ${dispCls}`}>
            <span className="eod-display-sym">$</span>
            <span className="eod-display-val tnum">{counted || "0"}</span>
          </div>

          {/* Numpad */}
          <div className="eod-numpad">
            {[1,2,3,4,5,6,7,8,9].map(n => (
              <button key={n} className="eod-nk" onClick={() => press(String(n))}>{n}</button>
            ))}
            <button className="eod-nk fn" onClick={() => press(".")}>.</button>
            <button className="eod-nk"    onClick={() => press("0")}>0</button>
            <button className="eod-nk fn" onClick={() => press("back")}><TI.Backspace size={16} /></button>
          </div>

          {/* Comparison */}
          <EODComparison
            expected={expected} counted={countedNum}
            hasCounted={hasCounted} diff={diff}
            isExact={isExact} isOver={isOver} isShort={isShort}
          />

          {/* Discrepancy note */}
          {hasDiff && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, fontWeight: 500 }}>Explain the difference</span>
                {!note.trim() && (
                  <span style={{ fontSize: 11, fontWeight: 500, color: "var(--destructive)" }}>
                    Required to close out
                  </span>
                )}
              </div>
              <textarea
                className="eod-note"
                rows={2}
                placeholder="e.g. Gave change for $100 bill, register came up $2 short…"
                value={note}
                onChange={e => setNote(e.target.value)}
              />
            </div>
          )}

          {/* CTA */}
          <div style={{ marginTop: "auto" }}>
            <button
              className="tx-btn full"
              disabled={!canSubmit}
              onClick={() => setSubmitted(true)}
              style={{ height: 48, fontSize: 15, letterSpacing: "-0.005em" }}
            >
              Close Out Day
            </button>
          </div>

        </div>{/* /eod-right */}
      </div>{/* /eod-body */}
    </div>
  );
}

// ─── Logged / done screen ─────────────────────────────────────────────────
function EODDoneScreen({ expected, counted, diff, isExact, isOver, isShort, note, onReset, onOpenHistory }) {
  const timeStr = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const iconCls = isExact ? "match" : isShort ? "short" : "over";
  return (
    <div className="tx-app eod-app" data-density="compact">
      <header className="tx-header" style={{ padding: "12px 20px" }}>
        <div>
          <div className="ttl">End of Day · Cash Count</div>
          <div className="sub">Sunday, May 11 · Lacquer Salon</div>
        </div>
        <span className="eod-status-pill eod-closed">Closed</span>
      </header>
      <div className="eod-done">
        <div className={`eod-done-icon ${iconCls}`}>
          <TI.Check size={30} />
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em" }}>Day closed out</div>
        <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>Logged at {timeStr}</div>
        <div className="eod-done-card">
          <div className="eod-done-row">
            <span>Expected cash</span>
            <span className="tnum">${expected.toFixed(2)}</span>
          </div>
          <div className="eod-done-row">
            <span>Counted cash</span>
            <span className="tnum">${counted.toFixed(2)}</span>
          </div>
          <div style={{ height: 1, background: "var(--border)", margin: "2px 0" }} />
          <div className={`eod-done-row eod-done-diff ${iconCls}`}>
            <span>{isExact ? "Difference" : isShort ? "Short" : "Over"}</span>
            <span className="tnum">
              {isExact ? "Exact match" : isOver ? `+$${diff.toFixed(2)}` : `−$${Math.abs(diff).toFixed(2)}`}
            </span>
          </div>
          {note && (
            <div className="eod-done-note">"{note}"</div>
          )}
        </div>
        <button className="tx-btn secondary" onClick={onReset} style={{ height: 40, marginTop: 4 }}>
          Start new count
        </button>
        <button className="eod-done-link" onClick={onOpenHistory}>
          View cash count history
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
        </button>
      </div>
    </div>
  );
}

Object.assign(window, { EndOfDayCash, EODDoneScreen });
