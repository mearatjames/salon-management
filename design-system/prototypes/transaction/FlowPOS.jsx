// Variation C: POS-numpad — Square-style. Numpad-first, services as quick-add tiles.

function FlowPOS({ density = "regular", onDone }) {
  const cart = useCart();
  const [draft, setDraft] = useState(""); // typed amount on numpad
  const [tipPct, setTipPct] = useState(0);
  const [method, setMethod] = useState(null);
  const [stage, setStage] = useState("cart"); // cart | done

  const tip = cart.subtotal * tipPct;
  const tax = (cart.subtotal + tip) * TAX_RATE;
  const total = cart.subtotal + tip + tax;

  const addCustom = () => {
    const amt = parseFloat(draft);
    if (!amt || amt <= 0) return;
    const idx = cart.items.filter(i => i.id.startsWith("custom-")).length + 1;
    cart.add({ id: `custom-${Date.now()}`, name: `Custom item ${idx}`, price: amt, time: 0, cat: "Custom" });
    setDraft("");
  };

  if (stage === "done") {
    return (
      <div className="tx-app" data-density={density}>
        <DoneScreen amount={total} method={method} onNew={() => { cart.clear(); setTipPct(0); setMethod(null); setDraft(""); setStage("cart"); }} onReceipt={() => {}} />
      </div>
    );
  }

  return (
    <div className="tx-app" data-density={density}>
      <TxHeader client="Walk-in client" onCancel={onDone} />
      <div className="tx-content">
        {/* LEFT: numpad + quick-tiles */}
        <div style={{ flex: 1, minWidth: 0, padding: 16, display: "flex", flexDirection: "column", gap: 12, borderRight: "1px solid var(--border)", overflow: "auto" }}>
          <Numpad value={draft} onChange={setDraft} onConfirm={addCustom} label="Type amount, or tap a service" />
          <div>
            <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 500, margin: "4px 0 8px" }}>Quick add</div>
            <div className="tx-tiles" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
              {SERVICES.slice(0, 6).map(s => (
                <button key={s.id} className="tx-tile" onClick={() => cart.add(s)}>
                  <div className="nm">{s.name}</div>
                  <div className="meta"><span>{s.time} min</span><span className="price">${s.price}</span></div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT: cart + totals + pay */}
        <aside className="tx-cart" style={{ width: 360 }}>
          <div className="tx-cart-h"><div style={{ fontWeight: 600 }}>Sale ({cart.items.length})</div>{cart.items.length > 0 && <button className="tx-link" onClick={cart.clear}>Clear</button>}</div>
          <div className="tx-cart-list">
            {cart.items.length === 0 ? <div className="tx-empty">Type a price or tap a service.</div> : cart.items.map(item => (
              <CartRow key={item.id} item={item}
                onQtyChange={q => cart.setQty(item.id, q)}
                onPriceChange={p => cart.setPrice(item.id, p)}
                onRemove={() => cart.remove(item.id)} />
            ))}
          </div>

          {cart.items.length > 0 && (
            <>
              <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)" }}>
                <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 500, marginBottom: 8 }}>Tip</div>
                <TipSelector subtotal={cart.subtotal} value={tipPct} onChange={setTipPct} />
              </div>
              <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)" }}>
                <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 500, marginBottom: 8 }}>Payment</div>
                <PaymentTiles value={method} onChange={setMethod} />
              </div>
              <Totals subtotal={cart.subtotal} tipPct={tipPct} />
              <div style={{ padding: "12px 20px 16px" }}>
                <button className="tx-btn full" disabled={!method} onClick={() => setStage("done")}>Charge ${total.toFixed(2)}</button>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
window.FlowPOS = FlowPOS;
