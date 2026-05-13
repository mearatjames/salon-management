// Shared transaction components used by all three flow variations.
const { useState, useMemo, useEffect } = React;

// ─── Icons (Lucide) ─────────────────────────────────────────────
const TI = {};
const _i = (paths) => ({ size = 18, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...rest}>{paths}</svg>
);
TI.Search   = _i(<><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></>);
TI.Plus     = _i(<path d="M12 5v14M5 12h14"/>);
TI.Minus    = _i(<path d="M5 12h14"/>);
TI.X        = _i(<path d="M18 6L6 18M6 6l12 12"/>);
TI.Check    = _i(<path d="M5 12l5 5L20 7"/>);
TI.Card     = _i(<><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></>);
TI.Cash     = _i(<><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 10v4M18 10v4"/></>);
TI.Gift     = _i(<><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z"/></>);
TI.Split    = _i(<><circle cx="6" cy="6" r="3"/><path d="M6 21V9M6 9l12 12"/><circle cx="18" cy="18" r="3"/></>);
TI.Back     = _i(<path d="M15 18l-6-6 6-6"/>);
TI.User     = _i(<><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></>);
TI.Backspace= _i(<><path d="M21 5H8L2 12l6 7h13a1 1 0 001-1V6a1 1 0 00-1-1z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/></>);
TI.Edit     = _i(<><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z"/></>);

// ─── Cart hook ──────────────────────────────────────────────────
function useCart(initial = []) {
  const [items, setItems] = useState(initial);
  const add = (svc) => {
    const lineId = `${svc.id}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const line = { ...svc, id: lineId, svcId: svc.id, qty: 1 };
    setItems(prev => [...prev, line]);
    return line;
  };
  const remove = (id) => setItems(prev => prev.filter(p => p.id !== id));
  const setQty = (id, qty) => setItems(prev => prev.map(p => p.id === id ? { ...p, qty: Math.max(1, qty) } : p));
  const setPrice = (id, price) => setItems(prev => prev.map(p => p.id === id ? { ...p, price: Math.max(0, price) } : p));
  const confirmPrice = (id, price) => setItems(prev => prev.map(p => p.id === id ? { ...p, price: Math.max(0, price), priceUnconfirmed: false } : p));
  const setTech = (id, techId) => setItems(prev => prev.map(p => p.id === id ? { ...p, tech: techId } : p));
  const clear = () => setItems([]);
  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  // _setItems is the raw setter — exposed for flows that need to patch arbitrary fields.
  return { items, add, remove, setQty, setPrice, confirmPrice, setTech, clear, subtotal, _setItems: setItems };
}

// Cart row that also shows the assigned tech as a chip with a popover override.
// `techs` is the list of tech ids assigned to the whole transaction; the chip
// surfaces those first and offers any other tech below.
function CartRowWithTech({ item, techs = [], onPriceChange, onQtyChange, onRemove, onEditPrice, onTechChange }) {
  const isVariable = !!item.variable;
  const needsPrice = item.priceUnconfirmed;
  return (
    <div className="tx-cart-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
      <div style={{ minWidth: 0 }}>
        <div className="nm" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.name}
        </div>
        <div className="meta" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span>{item.time ? `${item.time} min · ` : ""}${item.price}</span>
          <span style={{ color: "var(--muted-foreground)" }}>·</span>
          <TechChip techId={item.tech} allTechIds={techs} onChange={onTechChange} size="xs" />
          {needsPrice && <div className="tx-needs-price"><TI.Edit size={10} /> Set price</div>}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <button
          className={"tx-price-edit" + (isVariable || needsPrice ? " variable" : "")}
          onClick={onEditPrice}
          title="Tap to change price"
        >
          <TI.Edit size={12} />
          <span className="tnum">${(item.price * item.qty).toFixed(item.price * item.qty % 1 ? 2 : 0)}</span>
        </button>
        <button className="tx-stepper-btn" onClick={onRemove} aria-label="remove" title="Remove"><TI.X size={14} /></button>
      </div>
    </div>
  );
}

// ─── Service tile grid ──────────────────────────────────────────
function ServiceTiles({ onPick, columns = 3 }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  let filtered = SERVICES.filter(s =>
    (cat === "All" || s.cat === cat) &&
    (q === "" || s.name.toLowerCase().includes(q.toLowerCase()))
  );
  if (cat === "All") filtered = [...filtered].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ padding: "16px 20px 0" }}>
        <div className="tx-search-wrap">
          <TI.Search size={16} />
          <input className="tx-search" placeholder="Search services" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <div className="tx-chips">
          {CATEGORIES.map(c => (
            <button key={c} className={"tx-chip" + (cat === c ? " active" : "")} onClick={() => setCat(c)}>{c}</button>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "0 20px 20px" }}>
        {filtered.length === 0 ? (
          <div className="tx-empty">No services match "{q}".</div>
        ) : (
          <div className="tx-tiles" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
            {filtered.map(s => (
              <button key={s.id} className={"tx-tile" + (s.variable ? " variable" : "")} onClick={() => onPick(s)}>
                <div className="nm">{s.name}</div>
                <div className="meta">
                  <span>{s.time} min{s.note ? ` · ${s.note}` : ""}</span>
                  <span className="price">
                    {s.variable
                      ? (s.priceFrom != null ? `from $${s.priceFrom}` : "Variable")
                      : (s.price === 0 ? "Free" : `$${s.price}`)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Cart row with obvious price-edit + qty stepper ─────────────
function CartRow({ item, onPriceChange, onQtyChange, onRemove, onEditPrice }) {
  const isVariable = !!item.variable;
  const needsPrice = item.priceUnconfirmed;
  return (
    <div className="tx-cart-row">
      <div style={{ minWidth: 0 }}>
        <div className="nm" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.name}
        </div>
        <div className="meta">
          {item.time ? `${item.time} min · ` : ""}${item.price}
          {needsPrice && <div className="tx-needs-price"><TI.Edit size={10} /> Set price</div>}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <button
          className={"tx-price-edit" + (isVariable || needsPrice ? " variable" : "")}
          onClick={onEditPrice}
          title="Tap to change price"
        >
          <TI.Edit size={12} />
          <span className="tnum">${(item.price * item.qty).toFixed(item.price * item.qty % 1 ? 2 : 0)}</span>
        </button>
        <button className="tx-stepper-btn" onClick={onRemove} aria-label="remove" title="Remove"><TI.X size={14} /></button>
      </div>
    </div>
  );
}

// ─── Price sheet (modal) — quick presets + numpad + ± adjusters ─
function PriceSheet({ item, onSave, onCancel, onRemove }) {
  const [val, setVal] = useState(String(item.price));
  const [pad, setPad] = useState(false); // numpad collapsed by default
  const [fresh, setFresh] = useState(true); // next keypress replaces value
  const numericVal = parseFloat(val) || 0;
  const presets = item.presets || [];
  const isVariable = !!item.variable;
  const adjust = (d) => { setVal(String(Math.max(0, numericVal + d))); setFresh(false); };
  const setPreset = (p) => { setVal(String(p)); setFresh(true); };
  const openPad = () => { setPad(true); setFresh(true); };
  const press = (k) => {
    if (k === "back") { setVal(val.length > 0 ? val.slice(0, -1) : ""); setFresh(false); return; }
    if (fresh) {
      // First keypress after opening / picking preset replaces the amount.
      if (k === ".") { setVal("0."); setFresh(false); return; }
      setVal(k);
      setFresh(false);
      return;
    }
    if (k === "." && val.includes(".")) return;
    if (k === "." && val === "") { setVal("0."); return; }
    setVal(val + k);
  };
  const clearAll = () => { setVal(""); setFresh(true); };
  return (
    <div className="tx-sheet-backdrop" onClick={onCancel}>
      <div className="tx-sheet" onClick={e => e.stopPropagation()}>
        <div className="tx-sheet-h">
          <div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{item.name}</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              {isVariable ? `Varies $${item.priceFrom}–$${item.priceTo} · ${item.note || "set price"}` : "Adjust price for this sale"}
            </div>
          </div>
          <button className="tx-stepper-btn" onClick={onCancel} aria-label="close"><TI.X size={16} /></button>
        </div>

        <div className="tx-sheet-body">
          <button
            type="button"
            onClick={openPad}
            className="tx-bigprice-btn"
            title="Tap to type a different amount"
          >
            <span className="tnum">${val || "0"}</span>
            <span className="tx-bigprice-edit"><TI.Edit size={14} /> {pad ? "Typing…" : "Tap to type"}</span>
          </button>

          <div className="tx-quickadj" style={{ display: pad ? "none" : "flex" }}>
            <button onClick={() => adjust(-10)}>−$10</button>
            <button onClick={() => adjust(-5)}>−$5</button>
            <button onClick={() => adjust(5)}>+$5</button>
            <button onClick={() => adjust(10)}>+$10</button>
            <button onClick={() => adjust(20)}>+$20</button>
          </div>

          {presets.length > 0 && !pad && (
            <div>
              <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 500, marginBottom: 8 }}>Quick picks</div>
              <div className="tx-presets">
                {presets.map(p => (
                  <button key={p.label} className={"tx-preset" + (numericVal === p.price ? " active" : "")} onClick={() => setPreset(p.price)}>
                    <span className="lbl">{p.label}</span>
                    <span className="pr">${p.price}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {pad && (
            <div className="tx-pad-pop">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 500 }}>
                  {fresh ? "Type new amount" : "Editing amount"}
                </div>
                <button className="tx-link" onClick={clearAll}>Clear</button>
              </div>
              <div className="tx-numpad">
                {[1,2,3,4,5,6,7,8,9].map(n => <button key={n} className="tx-numkey" onClick={() => press(String(n))}>{n}</button>)}
                <button className="tx-numkey fn" onClick={() => press(".")}>.</button>
                <button className="tx-numkey" onClick={() => press("0")}>0</button>
                <button className="tx-numkey fn" onClick={() => press("back")}><TI.Backspace size={18} /></button>
              </div>
            </div>
          )}
        </div>

        <div className="tx-sheet-foot">
          {onRemove && <button className="tx-btn ghost" onClick={onRemove} style={{ marginRight: "auto", color: "var(--destructive)" }}>Remove</button>}
          <button className="tx-btn secondary" onClick={onCancel} style={{ height: 40 }}>Cancel</button>
          <button className="tx-btn" disabled={numericVal <= 0} onClick={() => onSave(numericVal)} style={{ height: 40 }}>
            Set ${numericVal.toFixed(numericVal % 1 ? 2 : 0)}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Tip selector ───────────────────────────────────────────────
function TipSelector({ subtotal, value, onChange, allowSkip = true }) {
  return (
    <div className="tx-tips">
      {TIP_PRESETS.map(p => {
        if (!allowSkip && p.pct === 0) return null;
        const amt = subtotal * p.pct;
        const active = value === p.pct;
        return (
          <button key={p.label} className={"tx-tip" + (active ? " active" : "")} onClick={() => onChange(p.pct)}>
            <span>{p.label}</span>
            {p.pct > 0 && <span className="amt">${amt.toFixed(amt % 1 ? 2 : 0)}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ─── Payment method tiles ───────────────────────────────────────
function PaymentTiles({ value, onChange, hideSplit = false, compact = false }) {
  return (
    <div className={"tx-paytiles" + (compact ? " compact" : "")}>
      {PAYMENT_METHODS.filter(m => !(hideSplit && m.id === "split")).map(m => {
        const Icon = { card: TI.Card, cash: TI.Cash, gift: TI.Gift, split: TI.Split }[m.id];
        return (
          <button key={m.id} className={"tx-paytile" + (value === m.id ? " active" : "")} onClick={() => onChange(m.id)} title={compact ? `${m.label} — ${m.hint}` : undefined}>
            <Icon size={compact ? 18 : 22} />
            <div>
              <div className="lbl">{m.label}</div>
              {!compact && <div className="h">{m.hint}</div>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ─── Totals block ───────────────────────────────────────────────
function Totals({ subtotal, tipPct, taxRate = TAX_RATE, showLabels = true }) {
  const tip = subtotal * tipPct;
  const tax = (subtotal + tip) * taxRate;
  const total = subtotal + tip + tax;
  return (
    <div className="tx-totals">
      {showLabels && <div className="row"><span className="muted">Subtotal</span><span className="num">${subtotal.toFixed(2)}</span></div>}
      {showLabels && tipPct > 0 && <div className="row"><span className="muted">Tip ({Math.round(tipPct * 100)}%)</span><span className="num">${tip.toFixed(2)}</span></div>}
      {showLabels && <div className="row"><span className="muted">Tax</span><span className="num">${tax.toFixed(2)}</span></div>}
      <div className="row total"><span>Total</span><span className="num">${total.toFixed(2)}</span></div>
    </div>
  );
}

// ─── Header with client info ────────────────────────────────────
function TxHeader({ client = "Walk-in client", onCancel, right }) {
  return (
    <header className="tx-header">
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button className="tx-stepper-btn" onClick={onCancel} aria-label="cancel" style={{ width: 32, height: 32, borderRadius: 8 }}><TI.X size={16} /></button>
        <div>
          <div className="ttl">New transaction</div>
          <div className="sub">{client}</div>
        </div>
      </div>
      {right}
    </header>
  );
}

// ─── Numpad ─────────────────────────────────────────────────────
function Numpad({ value, onChange, onConfirm, label = "Custom amount" }) {
  const press = (k) => {
    if (k === "back") return onChange(value.slice(0, -1));
    if (k === "." && value.includes(".")) return;
    if (k === "." && value === "") return onChange("0.");
    onChange(value + k);
  };
  const display = value === "" ? "0" : value;
  return (
    <div style={{ padding: 16, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, width: "100%" }}>
      <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>{label}</div>
      <div className="tnum" style={{ fontSize: 36, fontWeight: 600, letterSpacing: "-0.02em", marginBottom: 14, textAlign: "right", padding: "0 8px" }}>${display}</div>
      <div className="tx-numpad">
        {[1,2,3,4,5,6,7,8,9].map(n => <button key={n} className="tx-numkey" onClick={() => press(String(n))}>{n}</button>)}
        <button className="tx-numkey fn" onClick={() => press(".")}>.</button>
        <button className="tx-numkey" onClick={() => press("0")}>0</button>
        <button className="tx-numkey fn" onClick={() => press("back")}><TI.Backspace size={18} /></button>
      </div>
      {onConfirm && (
        <button className="tx-btn full" onClick={onConfirm} style={{ marginTop: 12 }} disabled={!value || parseFloat(value) <= 0}>Add ${value || "0.00"}</button>
      )}
    </div>
  );
}

// ─── Success screen ─────────────────────────────────────────────
function DoneScreen({ amount, method, onNew, onReceipt }) {
  const methodLabel = { card: "card", cash: "cash", gift: "gift card", split: "split payment" }[method] || method;
  return (
    <div className="tx-done">
      <div className="check"><TI.Check size={36} /></div>
      <div>
        <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em" }}>Charged ${amount.toFixed(2)}</div>
        <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>Paid by {methodLabel} · {new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button className="tx-btn secondary" onClick={onReceipt} style={{ height: 44 }}>Email receipt</button>
        <button className="tx-btn" onClick={onNew} style={{ height: 44 }}>New sale</button>
      </div>
    </div>
  );
}

Object.assign(window, { TI, useCart, ServiceTiles, CartRow, CartRowWithTech, PriceSheet, TipSelector, PaymentTiles, Totals, TxHeader, Numpad, DoneScreen });
