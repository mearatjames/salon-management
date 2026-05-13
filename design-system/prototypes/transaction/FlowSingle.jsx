// Variation A: Single-screen cart with Square Terminal integration.
// - Card / Gift card → sent to Square Terminal; tip is collected on the customer-facing
//   device and returns via webhook. App shows a "waiting" state until then.
// - Cash → handled fully in-app with an optional tip step (no Square round-trip).
// - Split → first leg goes through whichever method is selected; for v1 we treat split
//   as "Card + cash" (cash portion in-app, card portion on Square).

function FlowSingle({ density = "regular", numpad = false, initialTechs = ["maya"], onDone }) {
  const cart = useCart();
  const [method, setMethod] = useState(null);
  const [showSplit, setShowSplit] = useState(false);
  const [stage, setStage] = useState("cart"); // cart | waiting | cash-tip | done
  const [cashTipPct, setCashTipPct] = useState(0);
  const [priceSheetItem, setPriceSheetItem] = useState(null); // item being priced
  const [billOpen, setBillOpen] = useState(false); // restaurant-style bill preview
  // Techs assigned to this transaction. First one is the default for new services;
  // each cart row can override its own tech via the TechChip popover.
  const [techs, setTechs] = useState(initialTechs);
  // What "comes back" from Square's payment.updated webhook (mocked for prototype)
  const [squareResult, setSquareResult] = useState(null);

  // Add a service: if it's variable-priced, immediately open the price sheet
  // and mark the cart entry as "needs price" so it visually demands attention.
  // Stamp the default tech (first selected) onto the line so it can be overridden later.
  const defaultTech = techs[0] || null;
  const addService = (svc) => {
    if (svc.variable) {
      const line = cart.add({ ...svc, price: svc.price, priceUnconfirmed: true, variable: true, tech: defaultTech });
      setPriceSheetItem(line);
    } else {
      cart.add({ ...svc, tech: defaultTech });
    }
  };

  const savePrice = (newPrice) => {
    if (!priceSheetItem) return;
    cart.confirmPrice(priceSheetItem.id, newPrice);
    setPriceSheetItem(null);
  };

  const cancelPriceSheet = () => {
    // If user cancels on a brand-new variable item, just leave the suggested price in place
    if (priceSheetItem) cart.confirmPrice(priceSheetItem.id, priceSheetItem.price);
    setPriceSheetItem(null);
  };

  const removeFromSheet = () => {
    if (priceSheetItem) cart.remove(priceSheetItem.id);
    setPriceSheetItem(null);
  };

  // Some items still need a confirmed price — block charge until they're set
  const hasUnconfirmedPrices = cart.items.some(i => i.priceUnconfirmed);

  const isSquareMethod = method === "card" || method === "gift" || method === "split";
  const isCash = method === "cash";

  // Totals for cash flow (in-app tip)
  const cashTip = cart.subtotal * cashTipPct;
  const cashTax = (cart.subtotal + cashTip) * TAX_RATE;
  const cashTotal = cart.subtotal + cashTip + cashTax;

  // Totals quoted to Square (no tip — Square will collect it)
  const squareTax = cart.subtotal * TAX_RATE;
  const squareSubtotal = cart.subtotal + squareTax;

  // Final paid amount (set once flow resolves)
  const finalAmount = squareResult ? squareResult.total : cashTotal;
  const finalTip = squareResult ? squareResult.tip : cashTip;

  const charge = () => {
    if (isCash) {
      // Cash: skip the tip-capture step. Employees aren't required to report
      // cash tips to the salon, so we just mark the sale received and move on.
      setSquareResult(null);
      setCashTipPct(0);
      setStage("done");
      return;
    }
    // Square Terminal flow — kick off the cloud-to-device checkout
    setStage("waiting");
    // Mock: Square Terminal collects tip + processes payment, webhook fires ~6s later.
    // In production this would be an SSE/WebSocket message from your backend.
    const mockTipPct = 0.20;
    const tip = cart.subtotal * mockTipPct;
    const tax = (cart.subtotal + tip) * TAX_RATE;
    setTimeout(() => {
      setSquareResult({
        method,
        tip,
        tipPct: mockTipPct,
        tax,
        total: cart.subtotal + tip + tax,
        last4: method === "card" ? "4242" : null,
        squareId: "sq_" + Math.random().toString(36).slice(2, 10),
      });
      setStage("done");
    }, 4500);
  };

  // ───── Done ─────
  if (stage === "done") {
    return (
      <div className="tx-app" data-density={density}>
        <div className="tx-done">
          <div className="check"><TI.Check size={36} /></div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em" }}>Charged ${finalAmount.toFixed(2)}</div>
            <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
              {squareResult
                ? <>Paid by {method}{squareResult.last4 ? ` •••• ${squareResult.last4}` : ""} · tip ${finalTip.toFixed(2)} ({Math.round(squareResult.tipPct * 100)}%)</>
                : <>Cash · tip ${finalTip.toFixed(2)}</>}
            </div>
            {squareResult && <div className="muted tnum" style={{ fontSize: 11, marginTop: 4 }}>Square ref {squareResult.squareId}</div>}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="tx-btn secondary" style={{ height: 44 }}>Email receipt</button>
            <button className="tx-btn" style={{ height: 44 }} onClick={() => {
              cart.clear(); setMethod(null); setStage("cart"); setSquareResult(null); setCashTipPct(0); setShowSplit(false);
            }}>New sale</button>
          </div>
        </div>
      </div>
    );
  }

  // ───── Waiting on Square Terminal ─────
  if (stage === "waiting") {
    return (
      <div className="tx-app" data-density={density}>
        <TxHeader client="Maya Patel · Gel polish appt" onCancel={() => setStage("cart")} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18, padding: 32, textAlign: "center" }}>
          <div style={{ width: 96, height: 96, borderRadius: 9999, background: "color-mix(in oklch, var(--primary) 12%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--primary)" }}>
            <SquareTerminalIcon />
          </div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em" }}>Hand the terminal to your client</div>
            <div className="muted" style={{ fontSize: 14, marginTop: 6, maxWidth: 380 }}>
              The Square Terminal is showing ${squareSubtotal.toFixed(2)}. They'll choose a tip and tap or insert their {method === "gift" ? "gift card" : "card"}.
            </div>
          </div>
          <DotPulse />
          <div className="muted tnum" style={{ fontSize: 12 }}>Waiting for payment confirmation…</div>
          <button className="tx-link" onClick={() => setStage("cart")}>Cancel and pick a different method</button>
        </div>
      </div>
    );
  }

  // ───── Cash tip step ─────
  if (stage === "cash-tip") {
    return (
      <div className="tx-app" data-density={density}>
        <TxHeader client="Maya Patel · Gel polish appt" onCancel={() => setStage("cart")} />
        <div style={{ flex: 1, padding: 24, display: "flex", flexDirection: "column", gap: 20, alignItems: "center", justifyContent: "center" }}>
          <div style={{ textAlign: "center" }}>
            <div className="muted" style={{ fontSize: 12 }}>Cash sale · subtotal</div>
            <div className="tnum" style={{ fontSize: 36, fontWeight: 600, letterSpacing: "-0.02em" }}>${cart.subtotal.toFixed(2)}</div>
          </div>
          <div style={{ width: "100%", maxWidth: 480 }}>
            <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 500, marginBottom: 8, textAlign: "center" }}>Tip received (optional)</div>
            <TipSelector subtotal={cart.subtotal} value={cashTipPct} onChange={setCashTipPct} />
          </div>
          <div style={{ width: "100%", maxWidth: 480, padding: 14, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12 }}>
            <Totals subtotal={cart.subtotal} tipPct={cashTipPct} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="tx-btn ghost" onClick={() => setStage("cart")}><TI.Back size={16} /> Back</button>
            <button className="tx-btn" style={{ minWidth: 220 }} onClick={() => { setSquareResult(null); setStage("done"); }}>
              Mark cash received · ${cashTotal.toFixed(2)}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ───── Cart (default) ─────
  return (
    <div className="tx-app" data-density={density}>
      <TxHeader client="Walk-in · 2:55 PM" onCancel={onDone} />
      {/* Tech assignment — single-select up front; collapses to a compact pill
          once a tech is picked. Per-service multi-tech is handled by the chip
          on each cart row below. */}
      <div style={{ padding: "6px 16px", borderBottom: "1px solid var(--border)", background: "var(--card)" }}>
        {techs.length === 0 ? (
          <TechAvatarRow value={techs} onChange={setTechs} size={32} multi={false} label="Assign a tech to start" />
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 500 }}>Tech</span>
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 8px 2px 2px", background: "color-mix(in oklch, var(--primary) 8%, transparent)", border: "1px solid color-mix(in oklch, var(--primary) 30%, var(--border))", borderRadius: 9999 }}>
              <TechAvatar tech={STAFF.find(s => s.id === techs[0])} size={20} />
              <span style={{ fontSize: 12, fontWeight: 600 }}>{(STAFF.find(s => s.id === techs[0]) || {}).full}</span>
            </div>
            <button className="tx-link" style={{ fontSize: 11 }} onClick={() => setTechs([])}>Change</button>
            <span className="muted" style={{ fontSize: 10, marginLeft: "auto" }}>Multiple techs? Set per-service on each line.</span>
          </div>
        )}
      </div>
      <div className="tx-content">
        {/* LEFT: services */}
        <div style={{ flex: 1, minWidth: 0, borderRight: "1px solid var(--border)" }}>
          <ServiceTiles onPick={addService} columns={3} />
        </div>
        {/* RIGHT: cart + pay */}
        <aside className="tx-cart" style={{ width: 420 }}>
          <div className="tx-cart-list">
            {cart.items.length === 0 ? (
              <div className="tx-empty">{techs.length === 0 ? "Pick a tech first, then tap a service." : "Tap a service to start."}</div>
            ) : cart.items.map(item => (
              <CartRowWithTech key={item.id} item={item} techs={techs}
                onQtyChange={q => cart.setQty(item.id, q)}
                onPriceChange={p => cart.setPrice(item.id, p)}
                onEditPrice={() => setPriceSheetItem(item)}
                onTechChange={(tid) => cart.setTech(item.id, tid)}
                onRemove={() => cart.remove(item.id)} />
            ))}
          </div>

          {cart.items.length > 0 && (
            <div className="tx-cart-foot">
              <div style={{ padding: "8px 16px 4px", display: "flex", alignItems: "center", gap: 8 }}>
                <span className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 500 }}>Pay</span>
                <div style={{ flex: 1 }}>
                  <PaymentTiles value={method} onChange={setMethod} hideSplit={!showSplit} compact />
                </div>
                {!showSplit && <button className="tx-link" style={{ fontSize: 11 }} onClick={() => setShowSplit(true)}>Split</button>}
                <button className="tx-link" style={{ fontSize: 11, color: "var(--muted-foreground)" }} onClick={cart.clear} title="Clear sale">Clear</button>
              </div>
              {isSquareMethod && (
                <div style={{ margin: "0 16px 6px", padding: "6px 8px", background: "color-mix(in oklch, var(--primary) 6%, transparent)", borderRadius: 8, fontSize: 11, color: "var(--rose-700)", display: "flex", gap: 6, alignItems: "center" }}>
                  <SquareTerminalIcon size={12} />
                  <span>Tip is collected on the Square Terminal.</span>
                </div>
              )}

              {/* Totals — compact two-column inline */}
              <div className="tx-totals" style={{ padding: "8px 16px 6px", gap: 2 }}>
                <div className="row" style={{ fontSize: 12 }}><span className="muted">Subtotal</span><span className="num">${cart.subtotal.toFixed(2)}</span></div>
                <div className="row" style={{ fontSize: 12 }}><span className="muted">Tax</span><span className="num">${squareTax.toFixed(2)}</span></div>
                <div className="row total" style={{ fontSize: 18, paddingTop: 6, marginTop: 2 }}>
                  <span>{isSquareMethod ? "Send to terminal" : isCash ? "Subtotal due" : "Total"}</span>
                  <span className="num">${squareSubtotal.toFixed(2)}</span>
                </div>
              </div>

              <div style={{ padding: "8px 16px 14px", display: "flex", gap: 8 }}>
                <button
                  className="tx-btn secondary"
                  disabled={cart.items.length === 0 || hasUnconfirmedPrices}
                  onClick={() => setBillOpen(true)}
                  title="Print or email a bill before payment"
                  style={{ paddingInline: 14 }}>
                  <TI.Printer size={16} /> Bill
                </button>
                <button className="tx-btn" style={{ flex: 1 }} disabled={!method || cart.items.length === 0 || hasUnconfirmedPrices} onClick={charge}>
                  {hasUnconfirmedPrices
                    ? "Set price on highlighted items"
                    : isCash
                      ? `Take cash · $${squareSubtotal.toFixed(2)}`
                      : isSquareMethod
                        ? <>Send to Square Terminal · ${squareSubtotal.toFixed(2)}</>
                        : `Charge $${squareSubtotal.toFixed(2)}`}
                </button>
              </div>
            </div>
          )}
        </aside>
      </div>
      {priceSheetItem && (
        <PriceSheet
          item={priceSheetItem}
          onSave={savePrice}
          onCancel={cancelPriceSheet}
          onRemove={priceSheetItem.priceUnconfirmed ? removeFromSheet : null}
        />
      )}
      {billOpen && (
        <BillSheet
          items={cart.items}
          client="Walk-in client"
          techId={techs[0]}
          appt={new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + " · Today"}
          onClose={() => setBillOpen(false)}
          onPrint={() => { setBillOpen(false); }}
          onEmail={() => { setBillOpen(false); }}
        />
      )}
    </div>
  );
}

// ─── Square Terminal glyph (small inline SVG so we don't pull in an asset) ───
function SquareTerminalIcon({ size = 38 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="3" width="20" height="26" rx="3" />
      <rect x="9" y="6" width="14" height="9" rx="1" />
      <circle cx="11" cy="20" r="1" /><circle cx="16" cy="20" r="1" /><circle cx="21" cy="20" r="1" />
      <circle cx="11" cy="24" r="1" /><circle cx="16" cy="24" r="1" /><circle cx="21" cy="24" r="1" />
    </svg>
  );
}

function DotPulse() {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: 10, height: 10, borderRadius: 9999,
          background: "var(--primary)",
          animation: `txpulse 1.2s ${i * 0.18}s infinite ease-in-out`,
        }} />
      ))}
      <style>{`@keyframes txpulse { 0%, 80%, 100% { opacity: 0.25; transform: scale(0.8); } 40% { opacity: 1; transform: scale(1); } }`}</style>
    </div>
  );
}

window.FlowSingle = FlowSingle;
