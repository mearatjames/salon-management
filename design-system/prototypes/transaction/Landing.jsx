// Landing — the dashboard a salon owner / front-desk lands on, with a giant
// "New transaction" CTA and at-a-glance stats. Three tablet variations:
//   A · Minimal      — CTA-first; one row of stats, no feed
//   B · Stats-rich   — full grid of cards + recent-transactions feed
//   C · Calendar-led — today's appointments grid is the hero; stats sidebar
// Plus one phone variation (compact, scrollable).

const { useMemo: _useMemo } = React;

// ─── Lucide icons used by the landing page ─────────────────────
const LI = {};
const _li = (paths) => ({ size = 18, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...rest}>{paths}</svg>
);
LI.Plus       = _li(<path d="M12 5v14M5 12h14"/>);
LI.Calendar   = _li(<><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></>);
LI.Receipt    = _li(<><path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 1 2"/><path d="M16 8H8"/><path d="M16 12H8"/></>);
LI.Wallet     = _li(<><path d="M20 12V8a2 2 0 00-2-2H5a1 1 0 010-2h14"/><path d="M3 6v12a2 2 0 002 2h15v-4"/><path d="M18 12a2 2 0 100 4h3v-4z"/></>);
LI.Walk       = _li(<><circle cx="13" cy="4" r="2"/><path d="M9 20l3-6 4 2 3-2"/><path d="M6 8l3 4 3-4 4 2"/></>);
LI.ChevR      = _li(<path d="M9 18l6-6-6-6"/>);
LI.Sparkles   = _li(<><path d="M12 3l1.5 4 4 1.5-4 1.5L12 14l-1.5-4L6.5 8.5 10.5 7z"/><path d="M19 14l.7 1.8L21.5 16.5l-1.8.7L19 19l-.7-1.8L16.5 16.5l1.8-.7z"/></>);
LI.TrendUp    = _li(<><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></>);
LI.Users      = _li(<><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></>);
LI.DollarBill = _li(<><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M5 9v6M19 9v6"/></>);

// ─── Helpers — service summary string for the feed ─────────────
function svcLabel(items) {
  const labels = items.map(it => {
    const svc = SERVICES.find(s => s.id === it.id);
    return svc ? svc.name : it.id;
  });
  if (labels.length <= 2) return labels.join(", ");
  return `${labels[0]} +${labels.length - 1} more`;
}

// ─── Period toggle ─────────────────────────────────────────────
function PeriodToggle({ value, onChange }) {
  const opts = [
    { id: "today", label: "Today" },
    { id: "week", label: "Week" },
    { id: "month", label: "Month" },
  ];
  return (
    <div className="tx-period">
      {opts.map(o => (
        <button key={o.id} className={value === o.id ? "active" : ""} onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  );
}

// Multipliers so non-today windows look believable in the prototype
const PERIOD_FACTOR = { today: 1, week: 6.4, month: 27 };

// ─── Stat card primitive ───────────────────────────────────────
function StatCard({ label, value, sub, delta, icon }) {
  return (
    <div className="tx-stat-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div className="lbl">{label}</div>
        {icon && <div style={{ color: "var(--muted-foreground)" }}>{icon}</div>}
      </div>
      <div className="val">{value}</div>
      <div className="delta" style={{ display: "flex", justifyContent: "space-between" }}>
        <span>{sub}</span>
        {delta && <span className={"delta " + (delta.startsWith("+") ? "up" : delta.startsWith("−") ? "down" : "")}>{delta}</span>}
      </div>
    </div>
  );
}

// ─── Payment mix card ──────────────────────────────────────────
function PaymentMixCard({ byMethod, total }) {
  const methods = [
    { id: "card", label: "Card" },
    { id: "cash", label: "Cash" },
    { id: "gift", label: "Gift card" },
  ];
  const pct = (n) => total > 0 ? (n / total) * 100 : 0;
  return (
    <div className="tx-stat-card" style={{ minHeight: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div className="lbl">Payment mix</div>
        <LI.Wallet size={14} />
      </div>
      <div className="tx-method-bar" style={{ marginTop: 4 }}>
        {methods.map(m => (
          <span key={m.id} className={m.id} style={{ width: `${pct(byMethod[m.id] || 0)}%` }} />
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
        {methods.map(m => (
          <div key={m.id} className="tx-method-row">
            <span className="nm"><span className={"dot " + m.id} />{m.label}</span>
            <span className="num">${(byMethod[m.id] || 0).toFixed(0)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Recent transactions feed ──────────────────────────────────
function RecentFeed({ list, max = 6 }) {
  const items = list.slice(-max).reverse();
  return (
    <div className="tx-feed">
      <div className="tx-feed-h">
        <span className="ttl">Recent transactions</span>
        <button className="tx-link">View all</button>
      </div>
      <div className="tx-feed-list">
        {items.map(tx => {
          const t = txTotals(tx);
          return (
            <div key={tx.id} className="tx-feed-row">
              <span className="time">{tx.time}</span>
              <span className="client">{tx.client}</span>
              <span className="svc">{svcLabel(tx.items)}</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <TechStack ids={tx.techs} size={20} />
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span className={"tx-meth-pill " + tx.method}>{tx.method}</span>
                <span className="amt tnum">${t.total.toFixed(0)}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Hero CTA ──────────────────────────────────────────────────
function NewTxCTA({ onClick, full = false, sub = "Take payment for a walk-in or appointment" }) {
  return (
    <button className="tx-cta-primary" onClick={onClick} style={{ width: full ? "100%" : "auto" }}>
      <span className="icon"><LI.Plus size={20} /></span>
      <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
        <span>New transaction</span>
        <span className="sub">{sub}</span>
      </span>
      <LI.ChevR size={18} style={{ marginLeft: "auto", opacity: 0.7 }} />
    </button>
  );
}

// ─── Secondary actions ─────────────────────────────────────────
const SECONDARY_ACTIONS = [
  { id: "calendar", label: "Today's calendar",  hint: "See appointments + chairs",  icon: <LI.Calendar size={18} /> },
  { id: "walkin",   label: "Quick walk-in",     hint: "Skip the appointment book",  icon: <LI.Walk size={18} /> },
  { id: "report",   label: "Day report (X-out)",hint: "Sales by tech, by service",  icon: <LI.Receipt size={18} /> },
  { id: "cashout",  label: "End-of-day cash",   hint: "Reconcile the till",         icon: <LI.DollarBill size={18} /> },
];

function SecondaryActions({ cols = 2 }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 8 }}>
      {SECONDARY_ACTIONS.map(a => (
        <button key={a.id} className="tx-secondary-action">
          {a.icon}
          <span>
            <div className="lbl">{a.label}</div>
            <div className="h">{a.hint}</div>
          </span>
        </button>
      ))}
    </div>
  );
}

// ─── Mini calendar (used in C · calendar-led) ──────────────────
const APPTS = [
  { tech: "maya",  start: 9,  end: 10,  client: "Emily Chen",  status: "done" },
  { tech: "linh",  start: 9,  end: 10,  client: "Walk-in",     status: "done" },
  { tech: "aria",  start: 10, end: 11,  client: "Dana Reyes",  status: "done" },
  { tech: "jules", start: 10, end: 11,  client: "Walk-in",     status: "done" },
  { tech: "sasha", start: 10, end: 11,  client: "Walk-in",     status: "done" },
  { tech: "noor",  start: 11, end: 12,  client: "Sara K.",     status: "done" },
  { tech: "priya", start: 11, end: 12,  client: "Maya G.",     status: "done" },
  { tech: "tess",  start: 12, end: 13,  client: "Walk-in",     status: "done" },
  { tech: "maya",  start: 12, end: 14,  client: "Bri R.",      status: "done" },
  { tech: "aria",  start: 13, end: 14,  client: "Elena V.",    status: "now" },
  { tech: "linh",  start: 13, end: 14,  client: "Elena V.",    status: "now" },
  { tech: "jules", start: 13, end: 14,  client: "Walk-in",     status: "now" },
  { tech: "sasha", start: 14, end: 15,  client: "Hannah B.",   status: "next" },
  { tech: "noor",  start: 14, end: 15,  client: "Walk-in",     status: "next" },
  { tech: "priya", start: 15, end: 16,  client: "Joy L.",      status: "next" },
  { tech: "tess",  start: 15, end: 16,  client: "Joy L.",      status: "next" },
  { tech: "maya",  start: 15, end: 16,  client: "Walk-in",     status: "next" },
  { tech: "aria",  start: 16, end: 17,  client: "Riya P.",     status: "next" },
  { tech: "linh",  start: 16, end: 17,  client: "Tasha W.",    status: "next" },
];

function MiniCalendar() {
  const techs = STAFF.slice(0, 8);
  const hours = [9, 10, 11, 12, 13, 14, 15, 16];
  return (
    <div className="tx-mini-cal" style={{ gridTemplateColumns: `60px repeat(${techs.length}, 1fr)` }}>
      <div className="tx-mini-cal-cell head"></div>
      {techs.map(t => (
        <div key={t.id} className="tx-mini-cal-cell head" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "6px 2px" }}>
          <TechAvatar tech={t} size={20} />
          <span style={{ fontSize: 9 }}>{t.full.split(" ")[0]}</span>
        </div>
      ))}
      {hours.map(h => (
        <React.Fragment key={h}>
          <div className="tx-mini-cal-cell time">{((h % 12) || 12)}{h < 12 ? "a" : "p"}</div>
          {techs.map(t => {
            const appt = APPTS.find(a => a.tech === t.id && a.start <= h && a.end > h);
            const isStart = appt && appt.start === h;
            return (
              <div key={t.id} className="tx-mini-cal-cell" style={{ padding: 3 }}>
                {isStart && (
                  <div className={"tx-mini-cal-block " + (appt.status === "now" ? "now" : appt.status === "done" ? "done" : "")}
                    style={{ height: `calc(${(appt.end - appt.start) * 100}% - 0px)` }}>
                    <div className="nm">{appt.client}</div>
                    <div className="ti">{((appt.start % 12) || 12)}–{((appt.end % 12) || 12)}{appt.end < 13 ? "a" : "p"}</div>
                  </div>
                )}
              </div>
            );
          })}
        </React.Fragment>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// VARIATION A — Minimal
// ────────────────────────────────────────────────────────────────
function LandingMinimal({ density = "regular", showRecents = true, period: pIn = "today", onNew, onPeriod }) {
  const [period, setPeriod] = useState(pIn);
  useEffect(() => setPeriod(pIn), [pIn]);
  const k = PERIOD_FACTOR[period];
  const agg = useMemo(() => {
    const a = txAggregate(TX_HISTORY);
    return { ...a, count: Math.round(a.count * k), services: Math.round(a.services * k), total: a.total * k, tip: a.tip * k,
      byMethod: { card: a.byMethod.card * k, cash: a.byMethod.cash * k, gift: a.byMethod.gift * k } };
  }, [k]);

  return (
    <div className="tx-landing" data-density={density}>
      <div className="tx-landing-top">
        <div>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 500 }}>Lacquer Studio · Front desk</div>
          <h1 style={{ marginTop: 4 }}>Good afternoon, Maya</h1>
          <div className="sub" style={{ marginTop: 6 }}>Tuesday, May 12 · 6 techs on shift · Last sale 4:14 PM</div>
        </div>
        <PeriodToggle value={period} onChange={(v) => { setPeriod(v); onPeriod && onPeriod(v); }} />
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "20px 24px 24px", display: "flex", flexDirection: "column", gap: 20, overflow: "auto" }}>
        {/* Hero CTA + secondary actions */}
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 16 }}>
          <NewTxCTA onClick={onNew} full sub="Pick a tech, add services, charge — under a minute" />
          <SecondaryActions cols={2} />
        </div>

        {/* One row of headline stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          <StatCard label="Transactions" value={agg.count} sub={`${period === "today" ? "today" : period === "week" ? "this week" : "this month"}`} icon={<LI.Receipt size={14} />} delta={period === "today" ? "+3 vs avg" : null} />
          <StatCard label="Services rendered" value={agg.services} sub={`avg ${(agg.services / Math.max(1, agg.count)).toFixed(1)} per sale`} icon={<LI.Sparkles size={14} />} />
          <StatCard label="Gross revenue" value={`$${agg.total.toFixed(0)}`} sub="incl. tax + tip" icon={<LI.TrendUp size={14} />} delta={period === "today" ? "+12%" : null} />
          <StatCard label="Tips collected" value={`$${agg.tip.toFixed(0)}`} sub={`${(agg.tip / Math.max(1, agg.subtotal || agg.total / 1.18) * 100).toFixed(0)}% avg`} icon={<LI.Wallet size={14} />} />
        </div>

        {showRecents && (
          <div>
            <RecentFeed list={TX_HISTORY} max={5} />
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// VARIATION B — Stats-rich
// ────────────────────────────────────────────────────────────────
function LandingStats({ density = "regular", showRecents = true, period: pIn = "today", onNew, onPeriod }) {
  const [period, setPeriod] = useState(pIn);
  useEffect(() => setPeriod(pIn), [pIn]);
  const k = PERIOD_FACTOR[period];
  const agg = useMemo(() => {
    const a = txAggregate(TX_HISTORY);
    return { ...a, count: Math.round(a.count * k), services: Math.round(a.services * k), total: a.total * k, tip: a.tip * k, subtotal: a.subtotal * k,
      byMethod: { card: a.byMethod.card * k, cash: a.byMethod.cash * k, gift: a.byMethod.gift * k } };
  }, [k]);

  return (
    <div className="tx-landing" data-density={density}>
      <div className="tx-landing-top" style={{ paddingBottom: 14, borderBottomColor: "var(--border)" }}>
        <div>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 500 }}>Lacquer Studio · Front desk</div>
          <h1 style={{ marginTop: 4 }}>Today at the salon</h1>
          <div className="sub" style={{ marginTop: 6 }}>Tuesday, May 12 · {STAFF.length} techs on shift · Last sale 4:14 PM</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-end" }}>
          <PeriodToggle value={period} onChange={(v) => { setPeriod(v); onPeriod && onPeriod(v); }} />
          <NewTxCTA onClick={onNew} sub={`Charge a sale${period === "today" ? "" : ""}`} />
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "16px 24px 20px", display: "flex", flexDirection: "column", gap: 16, overflow: "auto" }}>
        {/* Stat grid: 4 metrics + payment mix card spanning 2 cols */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12 }}>
          <div style={{ gridColumn: "span 1" }}>
            <StatCard label="Transactions" value={agg.count} sub={period === "today" ? "today" : period} icon={<LI.Receipt size={14} />} delta={period === "today" ? "+3 vs avg" : null} />
          </div>
          <div style={{ gridColumn: "span 1" }}>
            <StatCard label="Services" value={agg.services} sub={`${(agg.services / Math.max(1, agg.count)).toFixed(1)}/sale`} icon={<LI.Sparkles size={14} />} />
          </div>
          <div style={{ gridColumn: "span 1" }}>
            <StatCard label="Revenue" value={`$${agg.total.toFixed(0)}`} sub="incl. tax + tip" icon={<LI.TrendUp size={14} />} delta={period === "today" ? "+12%" : null} />
          </div>
          <div style={{ gridColumn: "span 1" }}>
            <StatCard label="Tips" value={`$${agg.tip.toFixed(0)}`} sub={`${((agg.tip / Math.max(1, agg.subtotal)) * 100).toFixed(0)}% avg`} icon={<LI.Wallet size={14} />} />
          </div>
          <div style={{ gridColumn: "span 2" }}>
            <PaymentMixCard byMethod={agg.byMethod} total={agg.total} />
          </div>
        </div>

        {/* Two-column: secondary actions + (recents OR techs-on-shift summary) */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: 16, flex: showRecents ? 1 : "none", minHeight: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 500, marginBottom: 8 }}>Quick actions</div>
              <SecondaryActions cols={1} />
            </div>
            <div>
              <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 500, marginBottom: 8 }}>Techs on shift</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: 12, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10 }}>
                {STAFF.map(t => (
                  <div key={t.id} title={t.full} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: 4, minWidth: 56 }}>
                    <TechAvatar tech={t} size={32} />
                    <span style={{ fontSize: 10, fontWeight: 500 }}>{t.full.split(" ")[0]}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          {showRecents ? (
            <RecentFeed list={TX_HISTORY} max={7} />
          ) : (
            <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 500 }}>Top services {period === "today" ? "today" : period}</div>
              {[
                { name: "Gel polish", count: 6, amount: 360 },
                { name: "Classic pedicure", count: 5, amount: 275 },
                { name: "Acrylic full set", count: 3, amount: 330 },
                { name: "Russian manicure", count: 2, amount: 170 },
              ].map(s => (
                <div key={s.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{s.name}</span>
                  <span style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <span className="muted tnum" style={{ fontSize: 12 }}>×{s.count}</span>
                    <span className="tnum" style={{ fontSize: 13, fontWeight: 600 }}>${s.amount}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// VARIATION C — Calendar-led
// ────────────────────────────────────────────────────────────────
function LandingCalendar({ density = "regular", showRecents = true, period: pIn = "today", onNew, onPeriod }) {
  const [period, setPeriod] = useState(pIn);
  useEffect(() => setPeriod(pIn), [pIn]);
  const k = PERIOD_FACTOR[period];
  const agg = useMemo(() => {
    const a = txAggregate(TX_HISTORY);
    return { ...a, count: Math.round(a.count * k), services: Math.round(a.services * k), total: a.total * k, tip: a.tip * k, subtotal: a.subtotal * k,
      byMethod: { card: a.byMethod.card * k, cash: a.byMethod.cash * k, gift: a.byMethod.gift * k } };
  }, [k]);

  return (
    <div className="tx-landing" data-density={density}>
      <div className="tx-landing-top">
        <div>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 500 }}>Lacquer Studio · Front desk</div>
          <h1 style={{ marginTop: 4 }}>Tuesday, May 12</h1>
          <div className="sub" style={{ marginTop: 6 }}>14 of 19 appointments served · 3 techs busy now · Next slot 4:30 PM</div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <PeriodToggle value={period} onChange={(v) => { setPeriod(v); onPeriod && onPeriod(v); }} />
          <NewTxCTA onClick={onNew} sub="Charge the next client" />
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "16px 24px 20px", display: "grid", gridTemplateColumns: "1fr 280px", gap: 16, overflow: "hidden" }}>
        {/* Calendar fills the left column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 500 }}>Today's chairs · 9 AM – 5 PM</div>
            <button className="tx-link">Open full calendar</button>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            <MiniCalendar />
          </div>
          {showRecents && <RecentFeed list={TX_HISTORY} max={4} />}
        </div>

        {/* Right rail: tight stats */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, overflow: "auto", paddingRight: 2 }}>
          <StatCard label="Transactions" value={agg.count} sub="today" icon={<LI.Receipt size={14} />} delta="+3 vs avg" />
          <StatCard label="Services" value={agg.services} sub={`${(agg.services / Math.max(1, agg.count)).toFixed(1)}/sale`} icon={<LI.Sparkles size={14} />} />
          <StatCard label="Revenue" value={`$${agg.total.toFixed(0)}`} sub="incl. tax + tip" icon={<LI.TrendUp size={14} />} delta="+12%" />
          <StatCard label="Tips" value={`$${agg.tip.toFixed(0)}`} sub={`${((agg.tip / Math.max(1, agg.subtotal)) * 100).toFixed(0)}% avg`} icon={<LI.Wallet size={14} />} />
          <PaymentMixCard byMethod={agg.byMethod} total={agg.total} />
          <div>
            <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 500, marginBottom: 6 }}>Quick</div>
            <SecondaryActions cols={1} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// PHONE LANDING
// ────────────────────────────────────────────────────────────────
function PhoneLanding({ density = "compact", showRecents = true, period: pIn = "today", onNew, onPeriod }) {
  const [period, setPeriod] = useState(pIn);
  useEffect(() => setPeriod(pIn), [pIn]);
  const k = PERIOD_FACTOR[period];
  const agg = useMemo(() => {
    const a = txAggregate(TX_HISTORY);
    return { ...a, count: Math.round(a.count * k), services: Math.round(a.services * k), total: a.total * k, tip: a.tip * k, subtotal: a.subtotal * k,
      byMethod: { card: a.byMethod.card * k, cash: a.byMethod.cash * k, gift: a.byMethod.gift * k } };
  }, [k]);

  return (
    <div className="tx-landing" data-density={density}>
      <div style={{ padding: "14px 16px 12px", borderBottom: "1px solid var(--border)" }}>
        <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 500 }}>Lacquer Studio</div>
        <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em", marginTop: 2 }}>Today at the salon</div>
        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>Tue, May 12 · {STAFF.length} techs on</div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "14px 16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Period toggle + CTA */}
        <PeriodToggle value={period} onChange={(v) => { setPeriod(v); onPeriod && onPeriod(v); }} />
        <button className="tx-cta-primary" onClick={onNew} style={{ width: "100%" }}>
          <span className="icon"><LI.Plus size={18} /></span>
          <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
            <span style={{ fontSize: 15 }}>New transaction</span>
            <span className="sub">Pick tech, add services</span>
          </span>
          <LI.ChevR size={16} style={{ marginLeft: "auto", opacity: 0.7 }} />
        </button>

        {/* Big stat grid 2x2 */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div className="tx-phone-stat">
            <div className="lbl">Transactions</div>
            <div className="val">{agg.count}</div>
          </div>
          <div className="tx-phone-stat">
            <div className="lbl">Services</div>
            <div className="val">{agg.services}</div>
          </div>
          <div className="tx-phone-stat">
            <div className="lbl">Revenue</div>
            <div className="val">${agg.total.toFixed(0)}</div>
          </div>
          <div className="tx-phone-stat">
            <div className="lbl">Tips</div>
            <div className="val">${agg.tip.toFixed(0)}</div>
          </div>
        </div>

        {/* Payment mix */}
        <div className="tx-phone-stat" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div className="lbl">Payment mix</div>
          <div className="tx-method-bar">
            <span className="card" style={{ width: `${(agg.byMethod.card / Math.max(1, agg.total)) * 100}%` }} />
            <span className="cash" style={{ width: `${(agg.byMethod.cash / Math.max(1, agg.total)) * 100}%` }} />
            <span className="gift" style={{ width: `${(agg.byMethod.gift / Math.max(1, agg.total)) * 100}%` }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
            <span className="muted"><span className="dot card" style={{ width: 7, height: 7, borderRadius: 9999, display: "inline-block", background: "oklch(0.55 0.12 12)", marginRight: 4 }} />Card ${agg.byMethod.card.toFixed(0)}</span>
            <span className="muted"><span style={{ width: 7, height: 7, borderRadius: 9999, display: "inline-block", background: "oklch(0.62 0.13 150)", marginRight: 4 }} />Cash ${agg.byMethod.cash.toFixed(0)}</span>
            <span className="muted"><span style={{ width: 7, height: 7, borderRadius: 9999, display: "inline-block", background: "oklch(0.76 0.14 75)", marginRight: 4 }} />Gift ${agg.byMethod.gift.toFixed(0)}</span>
          </div>
        </div>

        {/* Secondary actions */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {SECONDARY_ACTIONS.map(a => (
            <button key={a.id} className="tx-secondary-action" style={{ padding: 10, gap: 8 }}>
              {a.icon}
              <span><div className="lbl" style={{ fontSize: 12 }}>{a.label}</div></span>
            </button>
          ))}
        </div>

        {/* Recent transactions — phone-compact */}
        {showRecents && (
          <div className="tx-feed">
            <div className="tx-feed-h">
              <span className="ttl">Recent</span>
              <button className="tx-link">All</button>
            </div>
            <div className="tx-feed-list">
              {TX_HISTORY.slice(-4).reverse().map(tx => {
                const t = txTotals(tx);
                return (
                  <div key={tx.id} style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
                    <TechStack ids={tx.techs} size={22} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tx.client}</div>
                      <div className="muted" style={{ fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tx.time} · {svcLabel(tx.items)}</div>
                    </div>
                    <span className={"tx-meth-pill " + tx.method}>{tx.method}</span>
                    <span className="tnum" style={{ fontSize: 13, fontWeight: 600 }}>${t.total.toFixed(0)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { LandingMinimal, LandingStats, LandingCalendar, PhoneLanding, NewTxCTA, RecentFeed, StatCard, PaymentMixCard, PeriodToggle, SecondaryActions, MiniCalendar, LI });
