// EODHistory.jsx — End of Day · Cash count history + amend flow
// Three views on one tablet artboard:
//   1. List  — every past EOD cash count (date, tech, expected/counted/variance, status)
//   2. Detail — drill into one count, with audit trail
//   3. Amend  — modal sheet to correct a count (original always preserved)

const { useState: ehSt, useMemo: ehMemo, useEffect: ehFx } = React;

// ─── Past cash counts (demo data) ────────────────────────────────────────
// Newest first. `note` lives on the original close; `amendment` is the audit
// record added by the correction flow.
const PAST_COUNTS = [
  { id: "eod-0511", dow: "Sun", dateShort: "May 11", dateLong: "Sunday, May 11", expected: 162.00, counted: 162.00, status: "closed", countedBy: "maya",  closedAt: "8:14 PM", note: "" },
  { id: "eod-0510", dow: "Sat", dateShort: "May 10", dateLong: "Saturday, May 10", expected: 244.00, counted: 240.00, status: "closed", countedBy: "jules", closedAt: "8:22 PM", note: "Gave change for a $100 bill out of the drawer — register came up $4 short." },
  { id: "eod-0509", dow: "Fri", dateShort: "May 9",  dateLong: "Friday, May 9",   expected: 318.00, counted: 318.00, status: "closed", countedBy: "maya",  closedAt: "7:58 PM", note: "" },
  { id: "eod-0508", dow: "Thu", dateShort: "May 8",  dateLong: "Thursday, May 8", expected: 195.00, counted: 197.00, status: "amended", countedBy: "aria", closedAt: "8:05 PM",
    note: "Started with one extra $5 in float.",
    amendment: { by: "maya", at: "Fri May 9, 9:42 AM", originalCounted: 195.00, reason: "recount", detail: "Recounted the float drawer — was actually $52 not $50, so the over was real." }
  },
  { id: "eod-0507", dow: "Wed", dateShort: "May 7",  dateLong: "Wednesday, May 7", expected: 102.50, counted: 102.50, status: "closed", countedBy: "maya",  closedAt: "8:11 PM", note: "" },
  { id: "eod-0506", dow: "Tue", dateShort: "May 6",  dateLong: "Tuesday, May 6",   expected: 226.00, counted: 222.00, status: "closed", countedBy: "linh",  closedAt: "8:18 PM", note: "Tip jar had $4 less than expected, no obvious reason." },
  { id: "eod-0505", dow: "Mon", dateShort: "May 5",  dateLong: "Monday, May 5",    expected: 178.00, counted: 178.00, status: "closed", countedBy: "maya",  closedAt: "8:03 PM", note: "" },
  { id: "eod-0504", dow: "Sun", dateShort: "May 4",  dateLong: "Sunday, May 4",    expected: 144.00, counted: 144.00, status: "closed", countedBy: "noor",  closedAt: "8:09 PM", note: "" },
  { id: "eod-0503", dow: "Sat", dateShort: "May 3",  dateLong: "Saturday, May 3",  expected: 281.00, counted: 281.00, status: "closed", countedBy: "jules", closedAt: "8:25 PM", note: "" },
  { id: "eod-0502", dow: "Fri", dateShort: "May 2",  dateLong: "Friday, May 2",    expected: 209.00, counted: 209.00, status: "closed", countedBy: "maya",  closedAt: "7:56 PM", note: "" },
  { id: "eod-0501", dow: "Thu", dateShort: "May 1",  dateLong: "Thursday, May 1",  expected: 167.00, counted: 165.00, status: "closed", countedBy: "linh",  closedAt: "8:14 PM", note: "Two quarters seem to have rolled off the counter." },
  { id: "eod-0430", dow: "Wed", dateShort: "Apr 30", dateLong: "Wednesday, Apr 30", expected: 122.00, counted: 122.00, status: "closed", countedBy: "maya", closedAt: "8:01 PM", note: "" },
];

const AMEND_REASONS = [
  { id: "recount",    label: "Recount — original count was wrong" },
  { id: "found",      label: "Found cash that wasn't counted" },
  { id: "reconciled", label: "Reconciled with bank deposit slip" },
  { id: "math",       label: "Math error in original count" },
  { id: "other",      label: "Other" },
];

// ─── Tiny helpers ─────────────────────────────────────────────────────────
function ehVariance(c) {
  const d = c.counted - c.expected;
  if (Math.abs(d) < 0.01) return { kind: "exact", diff: 0 };
  return { kind: d > 0 ? "over" : "short", diff: d };
}

function ehTechName(id) {
  const t = STAFF.find(s => s.id === id);
  return t ? t.name : id;
}

// Local icons (in addition to TI)
function EHChevronLeft({ size = 18 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>;
}
function EHChevronRight({ size = 14 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>;
}
function EHEditIcon({ size = 14 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>;
}
function EHHistoryIcon({ size = 14 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>;
}
function EHSearchIcon({ size = 14 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>;
}
function EHDownloadIcon({ size = 14 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
}

// ─── Initials avatar ──────────────────────────────────────────────────────
function EHTechAvatar({ id, size = 22 }) {
  const t = STAFF.find(s => s.id === id);
  if (!t) return null;
  const initials = t.name.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase();
  return (
    <span className="eh-avatar" style={{
      width: size, height: size, borderRadius: 9999,
      background: `oklch(0.91 0.04 ${t.tone})`,
      color: `oklch(0.34 0.08 ${t.tone})`,
      fontSize: size <= 18 ? 9 : 10, fontWeight: 600,
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      flexShrink: 0,
    }}>{initials}</span>
  );
}

// ─── Variance chip ────────────────────────────────────────────────────────
function EHVarianceChip({ count }) {
  const v = ehVariance(count);
  if (v.kind === "exact") {
    return <span className="eh-var-chip exact">Exact</span>;
  }
  if (v.kind === "over") {
    return <span className="eh-var-chip over">+${v.diff.toFixed(2)}</span>;
  }
  return <span className="eh-var-chip short">−${Math.abs(v.diff).toFixed(2)}</span>;
}

// ─── Status pill ──────────────────────────────────────────────────────────
function EHStatusPill({ status }) {
  if (status === "amended") {
    return (
      <span className="eh-status amended">
        <EHEditIcon size={10} /> Amended
      </span>
    );
  }
  return <span className="eh-status closed">Closed</span>;
}

// ─── Reusable header bar ─────────────────────────────────────────────────
function EHHeader({ title, sub, onBack, right }) {
  return (
    <header className="tx-header eh-header" style={{ padding: "11px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        {onBack && (
          <button className="eh-back" onClick={onBack} aria-label="Back">
            <EHChevronLeft size={16} />
          </button>
        )}
        <div style={{ minWidth: 0 }}>
          <div className="ttl">{title}</div>
          <div className="sub">{sub}</div>
        </div>
      </div>
      {right && <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>{right}</div>}
    </header>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// LIST VIEW
// ═════════════════════════════════════════════════════════════════════════
function EODHistoryList({ counts, onSelect, onBack }) {
  const totalDays    = counts.length;
  const amendedCount = counts.filter(c => c.status === "amended").length;
  const netVariance  = counts.reduce((s, c) => s + (c.counted - c.expected), 0);
  const netClass     = Math.abs(netVariance) < 0.01 ? "exact" : netVariance > 0 ? "over" : "short";

  return (
    <div className="tx-app eod-app eh-app" data-density="compact">
      <EHHeader
        title="Cash count history"
        sub="Past end-of-day counts · Lacquer Salon"
        onBack={onBack}
        right={
          <button className="eh-btn-ghost" aria-label="Export CSV">
            <EHDownloadIcon size={13} /> Export
          </button>
        }
      />

      {/* Toolbar */}
      <div className="eh-list-toolbar">
        <div className="eh-filters">
          <button className="eh-filter active">Last 30 days</button>
          <button className="eh-filter">All techs</button>
          <button className="eh-filter">Discrepancies only</button>
        </div>
        <div className="eh-search-wrap">
          <EHSearchIcon size={13} />
          <input className="eh-search" placeholder="Search by date or tech…" />
        </div>
      </div>

      {/* Summary strip */}
      <div className="eh-summary">
        <div className="eh-sum-item">
          <div className="eh-sum-num tnum">{totalDays}</div>
          <div className="eh-sum-lbl">days closed</div>
        </div>
        <div className="eh-sum-divider" />
        <div className="eh-sum-item">
          <div className="eh-sum-num tnum">{amendedCount}</div>
          <div className="eh-sum-lbl">amended</div>
        </div>
        <div className="eh-sum-divider" />
        <div className="eh-sum-item">
          <div className={`eh-sum-num tnum eh-sum-${netClass}`}>
            {Math.abs(netVariance) < 0.01
              ? "Even"
              : (netVariance > 0 ? "+" : "−") + "$" + Math.abs(netVariance).toFixed(2)}
          </div>
          <div className="eh-sum-lbl">net variance</div>
        </div>
      </div>

      {/* Column headers */}
      <div className="eh-list-headrow">
        <span className="eh-c-date">Date</span>
        <span className="eh-c-tech">Counted by</span>
        <span className="eh-c-amt">Expected</span>
        <span className="eh-c-amt">Counted</span>
        <span className="eh-c-var">Variance</span>
        <span className="eh-c-status">Status</span>
      </div>

      {/* Rows */}
      <div className="eh-list-scroll">
        {counts.map(c => (
          <button key={c.id} className="eh-row" onClick={() => onSelect(c.id)}>
            <span className="eh-c-date eh-row-date">
              <span className="eh-row-dow">{c.dow}</span>
              <span className="eh-row-dnum tnum">{c.dateShort}</span>
            </span>
            <span className="eh-c-tech eh-row-tech">
              <EHTechAvatar id={c.countedBy} size={22} />
              <span>{ehTechName(c.countedBy)}</span>
            </span>
            <span className="eh-c-amt eh-row-amt tnum">${c.expected.toFixed(2)}</span>
            <span className="eh-c-amt eh-row-amt tnum">${c.counted.toFixed(2)}</span>
            <span className="eh-c-var">
              <EHVarianceChip count={c} />
            </span>
            <span className="eh-c-status eh-row-status">
              <EHStatusPill status={c.status} />
              <EHChevronRight size={13} />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// DETAIL VIEW
// ═════════════════════════════════════════════════════════════════════════
function EODHistoryDetail({ count, onBack, onAmend }) {
  const v          = ehVariance(count);
  const isAmended  = count.status === "amended";
  const closeAmt   = isAmended ? count.amendment.originalCounted : count.counted;
  const closeKind  = (() => {
    const d = closeAmt - count.expected;
    if (Math.abs(d) < 0.01) return "exact";
    return d > 0 ? "over" : "short";
  })();

  return (
    <div className="tx-app eod-app eh-app" data-density="compact">
      <EHHeader
        title={count.dateLong}
        sub={isAmended ? "Cash count · Amended" : "Cash count · Closed"}
        onBack={onBack}
        right={
          <>
            <EHStatusPill status={count.status} />
            <button className="eh-btn-amend" onClick={onAmend}>
              <EHEditIcon size={12} /> Amend count
            </button>
          </>
        }
      />

      <div className="eh-detail-body">
        {/* Big variance summary card */}
        <div className={`eh-detail-card eh-detail-variance ${v.kind}`}>
          <div className="eh-detail-variance-icon">
            {v.kind === "exact" ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7"/></svg>
            ) : v.kind === "over" ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg>
            )}
          </div>
          <div className="eh-detail-variance-text">
            <div className="eh-detail-variance-label">
              {v.kind === "exact" ? "Exact match" : v.kind === "over" ? "Over" : "Short"}
            </div>
            <div className="eh-detail-variance-amt tnum">
              {v.kind === "exact"
                ? "$0.00"
                : (v.kind === "over" ? "+" : "−") + "$" + Math.abs(v.diff).toFixed(2)}
            </div>
          </div>
          <div className="eh-detail-variance-meta">
            <div className="eh-detail-meta-row">
              <EHTechAvatar id={count.countedBy} size={18} />
              <span>{ehTechName(count.countedBy)}</span>
            </div>
            <div className="eh-detail-meta-sub">Closed at {count.closedAt}</div>
          </div>
        </div>

        {/* Numbers card */}
        <div className="eh-detail-card">
          <div className="eh-detail-row">
            <span>Expected cash</span>
            <span className="tnum">${count.expected.toFixed(2)}</span>
          </div>
          <div className="eh-detail-row">
            <span>Counted cash</span>
            <span className="tnum">
              {isAmended && (
                <span className="eh-strike tnum">${count.amendment.originalCounted.toFixed(2)}</span>
              )}
              <b>${count.counted.toFixed(2)}</b>
            </span>
          </div>
          <div className="eh-detail-divider" />
          <div className={`eh-detail-row eh-detail-row-diff ${v.kind}`}>
            <span>{v.kind === "exact" ? "Difference" : v.kind === "over" ? "Over" : "Short"}</span>
            <span className="tnum">
              {v.kind === "exact"
                ? "Exact match"
                : (v.kind === "over" ? "+$" : "−$") + Math.abs(v.diff).toFixed(2)}
            </span>
          </div>
          {count.note && (
            <div className="eh-detail-note">
              <div className="eh-detail-note-label">Close-out note</div>
              <div className="eh-detail-note-text">"{count.note}"</div>
            </div>
          )}
        </div>

        {/* Activity log */}
        <div className="eh-detail-card eh-activity">
          <div className="eh-activity-title">
            <EHHistoryIcon size={13} /> Activity
          </div>

          <div className="eh-activity-item">
            <div className="eh-activity-rail">
              <div className="eh-activity-dot closed" />
              {isAmended && <div className="eh-activity-line-vert" />}
            </div>
            <div className="eh-activity-text">
              <div className="eh-activity-line">
                <b>Closed out</b> by
                <EHTechAvatar id={count.countedBy} size={16} />
                <b>{ehTechName(count.countedBy)}</b>
                <span className="eh-activity-divider-dot">·</span>
                <span className={`eh-activity-amt ${closeKind}`}>
                  ${closeAmt.toFixed(2)}
                </span>
              </div>
              <div className="eh-activity-meta">{count.dateLong} · {count.closedAt}</div>
            </div>
          </div>

          {isAmended && (
            <div className="eh-activity-item">
              <div className="eh-activity-rail">
                <div className="eh-activity-dot amended" />
              </div>
              <div className="eh-activity-text">
                <div className="eh-activity-line">
                  <b>Amended</b> by
                  <EHTechAvatar id={count.amendment.by} size={16} />
                  <b>{ehTechName(count.amendment.by)}</b>
                  <span className="eh-activity-divider-dot">·</span>
                  <span className="eh-activity-amt-pair tnum">
                    <span className="eh-strike">${count.amendment.originalCounted.toFixed(2)}</span>
                    <span>→</span>
                    <span>${count.counted.toFixed(2)}</span>
                  </span>
                </div>
                <div className="eh-activity-meta">{count.amendment.at}</div>
                {count.amendment.detail && (
                  <div className="eh-activity-reason">
                    <span className="eh-activity-reason-lbl">Note</span>
                    <span>{count.amendment.detail}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// AMEND SHEET (modal over detail)
// ═════════════════════════════════════════════════════════════════════════
function EODAmendSheet({ count, onSave, onCancel }) {
  const [newCount, setNewCount] = ehSt(count.counted.toFixed(2));
  const [detail,   setDetail]   = ehSt("");
  const [fresh,    setFresh]    = ehSt(true);

  const newNum  = parseFloat(newCount) || 0;
  const newDiff = newNum - count.expected;
  const newKind = Math.abs(newDiff) < 0.01 ? "exact" : newDiff > 0 ? "over" : "short";
  const changed = Math.abs(newNum - count.counted) > 0.005;
  const canSave = changed;

  const press = (k) => {
    if (k === "back") { setNewCount(p => p.slice(0, -1)); setFresh(false); return; }
    if (fresh) {
      if (k === ".") { setNewCount("0."); setFresh(false); return; }
      setNewCount(k); setFresh(false); return;
    }
    if (k === "." && newCount.includes(".")) return;
    const parts = newCount.split(".");
    if (parts[1] && parts[1].length >= 2) return;
    setNewCount(p => p + k);
  };
  const clear = () => { setNewCount(""); setFresh(true); };

  return (
    <div className="eh-modal-scrim" onClick={onCancel}>
      <div className="eh-amend-sheet" onClick={e => e.stopPropagation()}>
        <header className="eh-amend-head">
          <div style={{ minWidth: 0 }}>
            <div className="eh-amend-title">Amend cash count</div>
            <div className="eh-amend-sub">
              {count.dateLong} · originally counted by {ehTechName(count.countedBy)}
            </div>
          </div>
          <button className="eh-amend-x" onClick={onCancel} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </header>

        <div className="eh-amend-banner">
          The original count stays on the record. Your correction is added as an audit entry visible to owners and the bookkeeper.
        </div>

        <div className="eh-amend-body">
          {/* Before / after */}
          <div className="eh-amend-counts">
            <div className="eh-amend-count-col">
              <div className="eh-amend-col-lbl">Original count</div>
              <div className="eh-amend-col-val tnum">
                <span className="eh-amend-col-sym">$</span>{count.counted.toFixed(2)}
              </div>
            </div>
            <div className="eh-amend-arrow">→</div>
            <div className="eh-amend-count-col new">
              <div className="eh-amend-col-lbl">
                New count
                {newCount && (
                  <button className="tx-link eh-amend-clear" onClick={clear}>Clear</button>
                )}
              </div>
              <div className={`eh-amend-col-val tnum new ${newKind}`}>
                <span className="eh-amend-col-sym">$</span>{newCount || "0"}
              </div>
            </div>
          </div>

          {/* Numpad */}
          <div className="eh-amend-numpad">
            {[1,2,3,4,5,6,7,8,9].map(n => (
              <button key={n} className="eh-amend-nk" onClick={() => press(String(n))}>{n}</button>
            ))}
            <button className="eh-amend-nk fn" onClick={() => press(".")}>.</button>
            <button className="eh-amend-nk"    onClick={() => press("0")}>0</button>
            <button className="eh-amend-nk fn" onClick={() => press("back")}>
              <TI.Backspace size={14} />
            </button>
          </div>

          {/* Note */}
          <div className="eh-amend-section-lbl">
            <span>Add a note</span>
            <span className="eh-amend-opt">· optional</span>
          </div>
          <textarea
            className="eod-note eh-amend-note"
            rows={2}
            placeholder="Anything that would help an auditor a month from now."
            value={detail}
            onChange={e => setDetail(e.target.value)}
          />
        </div>

        <footer className="eh-amend-foot">
          <button className="tx-btn secondary" onClick={onCancel} style={{ height: 40 }}>
            Cancel
          </button>
          <button
            className="tx-btn"
            disabled={!canSave}
            onClick={() => onSave({ newCount: newNum, detail })}
            style={{ height: 40 }}
          >
            Save correction
          </button>
        </footer>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// ROOT — state machine for the history flow
// ═════════════════════════════════════════════════════════════════════════
function EODCashHistory({
  initialView      = "list",     // "list" | "detail"
  initialDetailId  = null,
  initialAmendOpen = false,
  initialAmended   = false,      // if true + initialDetailId given, pre-apply an amendment so the detail view shows it
  onExit           = null,       // optional: when set, list view shows a back button that calls this (returns to count screen)
}) {
  // Apply a pre-baked amendment (for the "after amend" artboard preview)
  const seedCounts = ehMemo(() => {
    if (!(initialAmended && initialDetailId)) return PAST_COUNTS;
    return PAST_COUNTS.map(c => {
      if (c.id !== initialDetailId || c.status === "amended") return c;
      return {
        ...c,
        status: "amended",
        counted: c.expected,
        amendment: {
          by: "maya",
          at: "Today, 9:12 AM",
          originalCounted: c.counted,
          detail: "Recounted the float — register actually balanced once the $4 in $1 bills under the tray was included.",
        },
      };
    });
  }, []);

  const [counts,     setCounts]     = ehSt(seedCounts);
  const [view,       setView]       = ehSt(initialView);
  const [selectedId, setSelectedId] = ehSt(initialDetailId);
  const [amendOpen,  setAmendOpen]  = ehSt(initialAmendOpen);

  const selected = counts.find(c => c.id === selectedId);

  const saveAmend = ({ newCount, detail }) => {
    setCounts(prev => prev.map(c => {
      if (c.id !== selectedId) return c;
      return {
        ...c,
        status: "amended",
        counted: newCount,
        amendment: {
          by: "maya",
          at: "Just now",
          originalCounted: c.amendment ? c.amendment.originalCounted : c.counted,
          detail: detail.trim(),
        },
      };
    }));
    setAmendOpen(false);
  };

  return (
    <>
      {view === "list" && (
        <EODHistoryList
          counts={counts}
          onSelect={(id) => { setSelectedId(id); setView("detail"); }}
          onBack={onExit}
        />
      )}
      {view === "detail" && selected && (
        <EODHistoryDetail
          count={selected}
          onBack={() => { setView("list"); setSelectedId(null); setAmendOpen(false); }}
          onAmend={() => setAmendOpen(true)}
        />
      )}
      {amendOpen && selected && (
        <EODAmendSheet
          count={selected}
          onSave={saveAmend}
          onCancel={() => setAmendOpen(false)}
        />
      )}
    </>
  );
}

Object.assign(window, {
  EODCashHistory, EODHistoryList, EODHistoryDetail, EODAmendSheet,
  PAST_COUNTS, AMEND_REASONS,
});
