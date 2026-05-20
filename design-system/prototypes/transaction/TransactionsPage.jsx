// TransactionsPage — Lacquer Studio's dedicated transactions screen.
// Filters by period (today/week/month), method, tech, status; opens a receipt
// drawer with full line items, payment, and activity on row click.

const { useState: tpUseState, useMemo: tpUseMemo, useEffect: tpUseEffect, useRef: tpUseRef } = React;

// ─── Icons (Lucide-derived, 1.5px stroke) ──────────────────────
const TP = {};
const _tpIcon = (paths) => ({ size = 14, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...rest}>{paths}</svg>
);
TP.Search     = _tpIcon(<><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></>);
TP.Plus       = _tpIcon(<path d="M12 5v14M5 12h14"/>);
TP.Download   = _tpIcon(<><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></>);
TP.ChevL      = _tpIcon(<path d="M15 18l-6-6 6-6"/>);
TP.ChevR      = _tpIcon(<path d="M9 18l6-6-6-6"/>);
TP.ChevDown   = _tpIcon(<path d="M6 9l6 6 6-6"/>);
TP.X          = _tpIcon(<path d="M18 6L6 18M6 6l12 12"/>);
TP.Card       = _tpIcon(<><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></>);
TP.Cash       = _tpIcon(<><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 10v4M18 10v4"/></>);
TP.Gift       = _tpIcon(<><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z"/></>);
TP.Split      = _tpIcon(<><circle cx="6" cy="6" r="3"/><path d="M6 21V9M6 9l12 12"/><circle cx="18" cy="18" r="3"/></>);
TP.Receipt    = _tpIcon(<><path d="M4 2v20l2.5-1.5L9 22l2.5-1.5L14 22l2.5-1.5L19 22l1-.6V2z"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="13" y2="16"/></>);
TP.Wallet     = _tpIcon(<><path d="M20 12V8a2 2 0 00-2-2H5a1 1 0 010-2h14"/><path d="M3 6v12a2 2 0 002 2h15v-4"/><path d="M18 12a2 2 0 100 4h3v-4z"/></>);
TP.Sparkles   = _tpIcon(<path d="M12 3l1.5 4 4 1.5-4 1.5L12 14l-1.5-4L6.5 8.5 10.5 7z"/>);
TP.TrendUp    = _tpIcon(<><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></>);
TP.Hash       = _tpIcon(<><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></>);
TP.Filter     = _tpIcon(<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>);
TP.Printer    = _tpIcon(<><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></>);
TP.Mail       = _tpIcon(<><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/></>);
TP.Undo       = _tpIcon(<><path d="M3 7v6h6"/><path d="M21 17a9 9 0 00-15-6.7L3 13"/></>);
TP.Clock      = _tpIcon(<><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>);
TP.MoreH      = _tpIcon(<><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>);
TP.Calendar   = _tpIcon(<><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></>);

// ─── Helpers ───────────────────────────────────────────────────
const TODAY = new Date(2026, 4, 12); // Tuesday May 12, 2026 — the demo's "today"
const MS_DAY = 86400000;
const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DOW_SHORT  = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function fmtDate(d) { return `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`; }
function fmtDateShort(d) { return `${DOW_SHORT[d.getDay()]}, ${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`; }
function fmtRange(a, b) {
  if (a.getFullYear() !== b.getFullYear()) return `${fmtDate(a)} – ${fmtDate(b)}`;
  if (a.getMonth() !== b.getMonth()) return `${MONTH_SHORT[a.getMonth()]} ${a.getDate()} – ${MONTH_SHORT[b.getMonth()]} ${b.getDate()}, ${b.getFullYear()}`;
  return `${MONTH_SHORT[a.getMonth()]} ${a.getDate()}–${b.getDate()}, ${b.getFullYear()}`;
}
function relLabel(d) {
  const diff = Math.round((d - TODAY) / MS_DAY);
  if (diff === 0)  return "Today";
  if (diff === -1) return "Yesterday";
  if (diff > -7 && diff < 0) return `${-diff} days ago`;
  return DOW_SHORT[d.getDay()];
}
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function startOfDay(d) { const r = new Date(d); r.setHours(0,0,0,0); return r; }

// Deterministic pseudo-random (so refresh shows the same generated history)
function mulberry32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function svcLabelShort(items) {
  const names = items.map(it => { const s = SERVICES.find(x => x.id === it.id); return s ? s.name : it.id; });
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]}, ${names[1]}`;
  return `${names[0]} +${names.length - 1} more`;
}

// ─── Extended history ──────────────────────────────────────────
// Generate ~30 days of synthetic transactions so week/month filters have meat.
// Today's records use the canonical TX_HISTORY; older days re-sample it with
// variation. Each record gets an absolute `date` and a parsed `dateTime`.

function makeFullHistory() {
  const rng = mulberry32(73);
  const out = [];

  // Helper — parse "1:32 PM" + a date into a Date object (for sort).
  function timeOnDate(date, timeStr) {
    const [, hh, mm, ap] = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
    let h = parseInt(hh, 10) % 12;
    if (ap.toUpperCase() === "PM") h += 12;
    const d = new Date(date);
    d.setHours(h, parseInt(mm, 10), 0, 0);
    return d;
  }

  // Today — canonical.
  TX_HISTORY.forEach(tx => out.push({ ...tx, date: TODAY, dateTime: timeOnDate(TODAY, tx.time), status: "completed" }));

  // Last 29 days of fakery.
  for (let dayOff = 1; dayOff <= 29; dayOff++) {
    const date = addDays(TODAY, -dayOff);
    const dow = date.getDay();
    // Weekends busier (Fri-Sat-Sun), Mon lightest, salon closed on the 4th weekday-of-month (decorative)
    let count = 10 + Math.floor(rng() * 6);
    if (dow === 0 || dow === 6 || dow === 5) count += 6 + Math.floor(rng() * 5);
    if (dow === 1) count = Math.max(4, count - 3);
    if (dow === 2 && dayOff % 14 === 7) count = 0; // sporadic closed Tuesday

    for (let i = 0; i < count; i++) {
      // Pick a base transaction to clone.
      const base = TX_HISTORY[Math.floor(rng() * TX_HISTORY.length)];
      // Jitter the items (sometimes drop / add an extra add-on).
      let items = base.items.map(it => ({ ...it }));
      if (rng() > 0.78 && items.length > 1) items = items.slice(0, items.length - 1);
      if (rng() > 0.85) {
        const addons = SERVICES.filter(s => s.cat === "Add-ons");
        const pick = addons[Math.floor(rng() * addons.length)];
        items.push({ id: pick.id, qty: 1, price: pick.price });
      }
      // Time across the day, 9am to 7pm, sorted later by sort step.
      const hr = 9 + Math.floor(rng() * 10);
      const mn = Math.floor(rng() * 60);
      const ap = hr >= 12 ? "PM" : "AM";
      const dispHr = ((hr % 12) || 12);
      const time = `${dispHr}:${String(mn).padStart(2,"0")} ${ap}`;
      const methods = ["card","card","card","card","cash","cash","gift"]; // weight cards
      const method = methods[Math.floor(rng() * methods.length)];
      const tipChoices = [0.15, 0.18, 0.20, 0.20, 0.20, 0.22, 0.25, 0];
      const tipPct = tipChoices[Math.floor(rng() * tipChoices.length)];
      // Status — ~3% refunds/voids spread over month
      let status = "completed";
      const sR = rng();
      if (sR < 0.018) status = "refunded";
      else if (sR < 0.025) status = "voided";

      out.push({
        id: `tx-${(dayOff * 100 + i).toString().padStart(4,"0")}`,
        time, client: base.client, techs: base.techs, items, tipPct, method, status,
        date, dateTime: timeOnDate(date, time),
      });
    }
  }

  // Sort newest first by dateTime.
  out.sort((a, b) => b.dateTime - a.dateTime);
  return out;
}

const ALL_TX = makeFullHistory();

// ─── KPI strip ─────────────────────────────────────────────────
function TPKpiStrip({ list, periodLabel, comparePct }) {
  const agg = tpUseMemo(() => txAggregate(list), [list]);
  const refunds = list.filter(t => t.status === "refunded").length;
  const avg = list.length > 0 ? agg.total / list.length : 0;
  return (
    <div className="tp-kpis">
      <div className="tp-kpi">
        <div className="lbl"><span>Transactions</span><TP.Hash size={12} /></div>
        <div className="val">{list.length}</div>
        <div className="sub">{periodLabel}{comparePct != null && (<span className={"delta " + (comparePct >= 0 ? "up" : "down")}>{comparePct >= 0 ? "+" : ""}{comparePct}%</span>)}</div>
      </div>
      <div className="tp-kpi">
        <div className="lbl"><span>Gross revenue</span><TP.TrendUp size={12} /></div>
        <div className="val">${agg.total.toFixed(0)}</div>
        <div className="sub">incl. tax + tip</div>
      </div>
      <div className="tp-kpi">
        <div className="lbl"><span>Services rendered</span><TP.Sparkles size={12} /></div>
        <div className="val">{agg.services}</div>
        <div className="sub">{list.length > 0 ? (agg.services / list.length).toFixed(1) : "0"} per sale</div>
      </div>
      <div className="tp-kpi">
        <div className="lbl"><span>Tips collected</span><TP.Wallet size={12} /></div>
        <div className="val">${agg.tip.toFixed(0)}</div>
        <div className="sub">{agg.subtotal > 0 ? ((agg.tip / agg.subtotal) * 100).toFixed(0) : "0"}% average</div>
      </div>
      <div className="tp-kpi">
        <div className="lbl"><span>Avg ticket</span><TP.Receipt size={12} /></div>
        <div className="val">${avg.toFixed(0)}</div>
        <div className="sub">{refunds > 0 ? `${refunds} refunded` : "no refunds"}</div>
      </div>
    </div>
  );
}

// ─── Method icon helper ────────────────────────────────────────
function methodIcon(method, size = 11) {
  const I = { card: TP.Card, cash: TP.Cash, gift: TP.Gift, split: TP.Split }[method] || TP.Card;
  return <I size={size} />;
}

// ─── Tech-filter popover ───────────────────────────────────────
function TechFilterPop({ selected, onChange, onClose }) {
  return (
    <div className="tp-pop" onClick={e => e.stopPropagation()}>
      <div className="tp-pop-h">Filter by tech</div>
      {STAFF.map(t => {
        const on = selected.includes(t.id);
        return (
          <div key={t.id} className="tp-pop-row" onClick={() => onChange(on ? selected.filter(x => x !== t.id) : [...selected, t.id])}>
            <span className={"check" + (on ? " on" : "")}>{on && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 12l5 5L20 7"/></svg>}</span>
            <TechAvatar tech={t} size={20} />
            <span style={{ flex: 1 }}>{t.full}</span>
          </div>
        );
      })}
      <div className="tp-pop-foot">
        <button className="tp-pop-clear" onClick={() => onChange([])}>Clear all</button>
        <button className="tp-pop-clear" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

// ─── Status-filter popover ─────────────────────────────────────
function StatusFilterPop({ value, onChange, onClose }) {
  const opts = [
    { id: "all", label: "All statuses" },
    { id: "completed", label: "Completed" },
    { id: "refunded", label: "Refunded" },
    { id: "voided", label: "Voided" },
  ];
  return (
    <div className="tp-pop" onClick={e => e.stopPropagation()}>
      <div className="tp-pop-h">Status</div>
      {opts.map(o => (
        <div key={o.id} className="tp-pop-row radio" onClick={() => { onChange(o.id); onClose(); }}>
          <span className={"check" + (value === o.id ? " on" : "")} />
          <span>{o.label}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Receipt detail drawer ─────────────────────────────────────
function ReceiptDrawer({ tx, onClose }) {
  if (!tx) return null;
  const totals = txTotals(tx);
  const cardLast4 = tx.method === "card" ? (3000 + (parseInt(tx.id.replace(/\D/g,""), 10) % 7000)).toString().padStart(4, "0") : null;
  const giftCode = tx.method === "gift" ? "GFT-" + tx.id.replace("tx-", "").toUpperCase() : null;
  const cashier = STAFF[parseInt(tx.id.replace(/\D/g,""), 10) % STAFF.length];

  // ESC closes
  tpUseEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="tp-drawer-backdrop" onClick={onClose} />
      <aside className="tp-drawer" role="dialog" aria-label="Receipt detail">
        <div className="tp-drawer-h">
          <div>
            <div className="ttl">{tx.client}</div>
            <div className="sub">{tx.id} · {fmtDateShort(tx.date)} · {tx.time}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {tx.status !== "completed" && (
              <span className={"tp-status-pill " + tx.status}>{tx.status}</span>
            )}
            <button className="tp-drawer-close" onClick={onClose} aria-label="Close"><TP.X size={14} /></button>
          </div>
        </div>

        <div className="tp-drawer-body">
          {/* Meta */}
          <div className="tp-d-section">
            <div className="tp-d-meta">
              <span className="k">Techs</span>
              <span className="v" style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                {tx.techs.map(id => {
                  const t = STAFF.find(s => s.id === id);
                  if (!t) return null;
                  return (
                    <span key={id} className="tp-d-tech-chip"><TechAvatar tech={t} size={18} /> {t.full}</span>
                  );
                })}
              </span>
              <span className="k">Cashier</span>
              <span className="v">{cashier.full}</span>
              <span className="k">Salon</span>
              <span className="v">Tang Nails Studio · Main floor</span>
            </div>
          </div>

          {/* Line items */}
          <div className="tp-d-section">
            <div className="h">Items ({totals.services})</div>
            <div>
              {tx.items.map((it, idx) => {
                const svc = SERVICES.find(s => s.id === it.id);
                const lineTotal = (it.price != null ? it.price : (svc ? svc.price : 0)) * (it.qty || 1);
                // Distribute techs across line items round-robin so per-line tech feels plausible.
                const lineTech = STAFF.find(s => s.id === tx.techs[idx % tx.techs.length]);
                return (
                  <div key={idx} className="tp-d-line">
                    <div>
                      <div className="nm">{svc ? svc.name : it.id}</div>
                      <div className="meta">
                        {svc && svc.cat && <span>{svc.cat}</span>}
                        {svc && svc.cat && lineTech && <span>·</span>}
                        {lineTech && <span className="tp-d-tech-chip"><TechAvatar tech={lineTech} size={14} /> {lineTech.full.split(" ")[0]}</span>}
                        {it.qty > 1 && <span>· qty {it.qty}</span>}
                      </div>
                    </div>
                    <div className="price">${lineTotal.toFixed(lineTotal % 1 ? 2 : 0)}</div>
                  </div>
                );
              })}
            </div>
            <div className="tp-d-totals">
              <div className="row"><span className="k">Subtotal</span><span>${totals.subtotal.toFixed(2)}</span></div>
              {tx.tipPct > 0 && <div className="row"><span className="k">Tip ({Math.round(tx.tipPct * 100)}%)</span><span>${totals.tip.toFixed(2)}</span></div>}
              <div className="row"><span className="k">Tax ({(TAX_RATE * 100).toFixed(2)}%)</span><span>${totals.tax.toFixed(2)}</span></div>
              <div className="row total"><span>Total</span><span>${totals.total.toFixed(2)}</span></div>
            </div>
          </div>

          {/* Payment */}
          <div className="tp-d-section">
            <div className="h">Payment</div>
            <div className="tp-d-pay">
              <span className="ic">{methodIcon(tx.method, 18)}</span>
              <div className="body">
                <div className="lbl">
                  {{ card: "Card", cash: "Cash", gift: "Gift card", split: "Split payment" }[tx.method] || "Card"}
                </div>
                <div className="sub">
                  {cardLast4 && `Visa ···· ${cardLast4} · Auth 0${tx.id.slice(-3)}`}
                  {tx.method === "cash" && `Tendered $${Math.ceil(totals.total / 5) * 5}.00 · Change $${(Math.ceil(totals.total / 5) * 5 - totals.total).toFixed(2)}`}
                  {giftCode && `Code ${giftCode}`}
                </div>
              </div>
              <div className="amt">${totals.total.toFixed(2)}</div>
            </div>
          </div>

          {/* Activity */}
          <div className="tp-d-section">
            <div className="h">Activity</div>
            <div className="tp-d-activity">
              <div className="row active">
                <span className="dot" />
                <div className="body">
                  <span>Sale completed by <b>{cashier.full}</b></span>
                  <div className="t">{fmtDateShort(tx.date)} · {tx.time}</div>
                </div>
              </div>
              {tx.status === "refunded" && (
                <div className="row">
                  <span className="dot" style={{ background: "var(--destructive)" }} />
                  <div className="body">
                    <span>Refunded by <b>Priya Raman</b></span>
                    <div className="t">{fmtDateShort(addDays(tx.date, 1))} · 10:14 AM</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="tp-drawer-foot">
          <button className="tp-btn-outline"><TP.Printer size={14} /> Print</button>
          <button className="tp-btn-outline"><TP.Mail size={14} /> Email</button>
          <button className="tp-btn-danger" disabled={tx.status !== "completed"} title={tx.status !== "completed" ? "Already " + tx.status : "Refund this transaction"}>
            <TP.Undo size={14} /> Refund
          </button>
        </div>
      </aside>
    </>
  );
}

// ─── Main page ─────────────────────────────────────────────────
function TransactionsPage() {
  const [period, setPeriod] = tpUseState("week"); // today | week | month | custom
  const [search, setSearch] = tpUseState("");
  const [method, setMethod] = tpUseState("all"); // all | card | cash | gift
  const [techIds, setTechIds] = tpUseState([]);
  const [status, setStatus] = tpUseState("all");
  const [selectedId, setSelectedId] = tpUseState(null);
  const [techPopOpen, setTechPopOpen] = tpUseState(false);
  const [statusPopOpen, setStatusPopOpen] = tpUseState(false);
  const [windowShift, setWindowShift] = tpUseState(0); // # of periods back from current

  // Derive the active window's start/end (inclusive of day boundaries).
  const { start, end, label } = tpUseMemo(() => {
    const todayStart = startOfDay(TODAY);
    if (period === "today") {
      const day = addDays(todayStart, windowShift);
      return { start: day, end: addDays(day, 1), label: windowShift === 0 ? "Today" : windowShift === -1 ? "Yesterday" : fmtDateShort(day) };
    }
    if (period === "week") {
      // Week starts Monday; this week = mon..today inclusive
      const dow = todayStart.getDay(); // 0..6
      const monOffset = dow === 0 ? -6 : 1 - dow;
      const thisMon = addDays(todayStart, monOffset);
      const wkStart = addDays(thisMon, windowShift * 7);
      const wkEnd = addDays(wkStart, 7);
      return { start: wkStart, end: wkEnd, label: windowShift === 0 ? "This week" : windowShift === -1 ? "Last week" : `Week of ${MONTH_SHORT[wkStart.getMonth()]} ${wkStart.getDate()}` };
    }
    // month
    const firstThis = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);
    const start = new Date(firstThis.getFullYear(), firstThis.getMonth() + windowShift, 1);
    const end = new Date(firstThis.getFullYear(), firstThis.getMonth() + windowShift + 1, 1);
    return { start, end, label: windowShift === 0 ? "This month" : windowShift === -1 ? "Last month" : `${MONTH_SHORT[start.getMonth()]} ${start.getFullYear()}` };
  }, [period, windowShift]);

  // Reset window shift when period changes.
  tpUseEffect(() => { setWindowShift(0); }, [period]);

  // Filter pipeline.
  const filtered = tpUseMemo(() => {
    const lower = search.trim().toLowerCase();
    return ALL_TX.filter(tx => {
      if (tx.dateTime < start || tx.dateTime >= end) return false;
      if (method !== "all" && tx.method !== method) return false;
      if (techIds.length > 0 && !tx.techs.some(t => techIds.includes(t))) return false;
      if (status !== "all" && tx.status !== status) return false;
      if (lower) {
        const hit = tx.client.toLowerCase().includes(lower)
          || tx.id.toLowerCase().includes(lower)
          || tx.items.some(it => {
            const s = SERVICES.find(x => x.id === it.id);
            return s ? s.name.toLowerCase().includes(lower) : false;
          });
        if (!hit) return false;
      }
      return true;
    });
  }, [start, end, method, techIds, status, search]);

  // Compare vs previous period for KPI delta (count only, simple).
  const prevWindow = tpUseMemo(() => {
    const span = end - start;
    return ALL_TX.filter(tx => tx.dateTime >= new Date(start - span) && tx.dateTime < start);
  }, [start, end]);
  const comparePct = prevWindow.length > 0 ? Math.round(((filtered.length - prevWindow.length) / prevWindow.length) * 100) : null;

  // Group by date for display.
  const byDay = tpUseMemo(() => {
    const map = new Map();
    for (const tx of filtered) {
      const key = startOfDay(tx.date).getTime();
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(tx);
    }
    return Array.from(map.entries()).sort((a, b) => b[0] - a[0]).map(([k, list]) => ({ date: new Date(k), list }));
  }, [filtered]);

  // Close popovers on outside click
  tpUseEffect(() => {
    function onDoc() { setTechPopOpen(false); setStatusPopOpen(false); }
    if (techPopOpen || statusPopOpen) {
      document.addEventListener("click", onDoc);
      return () => document.removeEventListener("click", onDoc);
    }
  }, [techPopOpen, statusPopOpen]);

  const selected = filtered.find(t => t.id === selectedId) || null;

  // Method chip data with counts.
  const methodCounts = tpUseMemo(() => {
    const c = { all: filtered.length, card: 0, cash: 0, gift: 0 };
    for (const t of filtered) c[t.method] = (c[t.method] || 0) + 1;
    return c;
  }, [filtered]);

  return (
    <div className="tp-page">
      {/* Header */}
      <div className="tp-head">
        <div>
          <h1>Transactions</h1>
          <div className="sub">Every sale your salon has rung up. Filter by period, search by client, service, or transaction ID — click any row for the full receipt.</div>
        </div>
        <div className="actions">
          <button className="tp-btn-outline"><TP.Download size={14} /> Export CSV</button>
          <a className="tp-btn-primary" href="./Transaction Flows.html"><TP.Plus size={14} /> New transaction</a>
        </div>
      </div>

      {/* Period row */}
      <div className="tp-period-row">
        <div className="tp-period">
          {["today","week","month"].map(p => (
            <button key={p} className={period === p ? "active" : ""} onClick={() => setPeriod(p)}>
              {p === "today" ? "Today" : p === "week" ? "This week" : "This month"}
            </button>
          ))}
        </div>
        <div className="tp-range">
          <button className="arrow" onClick={() => setWindowShift(windowShift - 1)} aria-label="Previous"><TP.ChevL size={13} /></button>
          <span className="lbl">{label} · {period === "today" ? fmtDate(start) : fmtRange(start, addDays(end, -1))}</span>
          <button className="arrow" onClick={() => setWindowShift(Math.min(0, windowShift + 1))} disabled={windowShift >= 0} aria-label="Next"><TP.ChevR size={13} /></button>
        </div>
      </div>

      {/* KPI strip */}
      <TPKpiStrip list={filtered} periodLabel={label.toLowerCase()} comparePct={comparePct} />

      {/* Filter row */}
      <div className="tp-filters">
        <div className="tp-search">
          <TP.Search size={14} />
          <input
            placeholder="Search client, service, or ID…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="tp-chipgroup" role="tablist" aria-label="Method">
          {[
            { id: "all",  label: "All" },
            { id: "card", label: "Card" },
            { id: "cash", label: "Cash" },
            { id: "gift", label: "Gift" },
          ].map(o => (
            <button key={o.id} className={method === o.id ? "active" : ""} onClick={() => setMethod(o.id)}>
              {o.id !== "all" && methodIcon(o.id, 11)}
              {o.label}
              <span className="pill">{methodCounts[o.id] || 0}</span>
            </button>
          ))}
        </div>

        <div className="tp-pop-wrap">
          <button
            className={"tp-filter-btn" + (techIds.length > 0 ? " has-value" : "")}
            onClick={e => { e.stopPropagation(); setTechPopOpen(o => !o); setStatusPopOpen(false); }}>
            Tech {techIds.length > 0 && <span className="ct">{techIds.length}</span>} <TP.ChevDown size={12} />
          </button>
          {techPopOpen && (
            <TechFilterPop selected={techIds} onChange={setTechIds} onClose={() => setTechPopOpen(false)} />
          )}
        </div>

        <div className="tp-pop-wrap">
          <button
            className={"tp-filter-btn" + (status !== "all" ? " has-value" : "")}
            onClick={e => { e.stopPropagation(); setStatusPopOpen(o => !o); setTechPopOpen(false); }}>
            {status === "all" ? "Status" : status[0].toUpperCase() + status.slice(1)} <TP.ChevDown size={12} />
          </button>
          {statusPopOpen && (
            <StatusFilterPop value={status} onChange={setStatus} onClose={() => setStatusPopOpen(false)} />
          )}
        </div>

        <div className="tp-filter-spacer" />

        {/* Active-filter pills (for tech) */}
        {techIds.length > 0 && (
          <div className="tp-active-filters">
            {techIds.map(id => {
              const t = STAFF.find(s => s.id === id);
              if (!t) return null;
              return (
                <span key={id} className="tp-active-pill">
                  <TechAvatar tech={t} size={14} />
                  {t.full.split(" ")[0]}
                  <button onClick={() => setTechIds(techIds.filter(x => x !== id))} aria-label={`Remove ${t.full}`}><TP.X size={10} /></button>
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Table — grouped by day */}
      <div className="tp-table-scroll">
        {byDay.length === 0 ? (
          <div className="tp-empty">
            <div className="ic"><TP.Receipt size={20} /></div>
            <div>
              <div className="ttl">No transactions match those filters</div>
              <div className="ds">Try widening the date range, or clear method/tech/status filters.</div>
            </div>
            <button className="tp-btn-outline" onClick={() => { setSearch(""); setMethod("all"); setTechIds([]); setStatus("all"); }}>Clear filters</button>
          </div>
        ) : byDay.map(g => {
          const dayAgg = txAggregate(g.list);
          return (
            <div key={g.date.getTime()} className="tp-day-group">
              <div className="tp-day-h">
                <div className="date">{fmtDate(g.date)} <span className="rel">{relLabel(g.date)}</span></div>
                <div className="stat"><b>{g.list.length}</b> tx</div>
                <div className="stat"><b>${dayAgg.total.toFixed(0)}</b> revenue</div>
                <div className="stat"><b>${dayAgg.tip.toFixed(0)}</b> tips</div>
              </div>
              <table className="tp-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>ID</th>
                    <th>Client</th>
                    <th>Services</th>
                    <th>Techs</th>
                    <th>Method</th>
                    <th className="num">Subtotal</th>
                    <th className="num">Tip</th>
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {g.list.map(tx => {
                    const t = txTotals(tx);
                    return (
                      <tr key={tx.id}
                          className={(selectedId === tx.id ? "selected " : "") + (tx.status === "refunded" ? "refunded" : "")}
                          onClick={() => setSelectedId(tx.id)}>
                        <td className="time">{tx.time}</td>
                        <td className="id">{tx.id}</td>
                        <td className="client">
                          <b>{tx.client}</b>
                          {tx.status !== "completed" && <span className={"tp-status-pill " + tx.status} style={{ marginLeft: 8 }}>{tx.status}</span>}
                        </td>
                        <td className="services">{svcLabelShort(tx.items)}</td>
                        <td><TechStack ids={tx.techs} size={20} /></td>
                        <td><span className={"tp-meth " + tx.method}>{methodIcon(tx.method)} {tx.method}</span></td>
                        <td className="num">${t.subtotal.toFixed(0)}</td>
                        <td className="num">${t.tip.toFixed(0)}</td>
                        <td className="num total">${t.total.toFixed(0)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      {/* Detail drawer */}
      {selected && <ReceiptDrawer tx={selected} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

Object.assign(window, { TransactionsPage, TP });
