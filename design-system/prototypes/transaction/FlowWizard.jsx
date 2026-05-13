// Variation B: 3-step wizard — Services → Tip → Payment. Big buttons.

function FlowWizard({ density = "regular", onDone }) {
  const cart = useCart();
  const [step, setStep] = useState(1); // 1 services, 2 tip, 3 pay, 4 done
  const [tipPct, setTipPct] = useState(0);
  const [method, setMethod] = useState(null);

  const tip = cart.subtotal * tipPct;
  const tax = (cart.subtotal + tip) * TAX_RATE;
  const total = cart.subtotal + tip + tax;

  const Steps = () => (
    <div className="tx-steps">
      {[
        { n: 1, label: "Services" },
        { n: 2, label: "Tip" },
        { n: 3, label: "Payment" },
      ].map((s, i, arr) => (
        <React.Fragment key={s.n}>
          <div className={"tx-step " + (step === s.n ? "active" : step > s.n ? "done" : "")}>
            <span className="num">{step > s.n ? "✓" : s.n}</span><span>{s.label}</span>
          </div>
          {i < arr.length - 1 && <div className="tx-step-sep" />}
        </React.Fragment>
      ))}
    </div>
  );

  if (step === 4) {
    return (
      <div className="tx-app" data-density={density}>
        <DoneScreen amount={total} method={method} onNew={() => { cart.clear(); setTipPct(0); setMethod(null); setStep(1); }} onReceipt={() => {}} />
      </div>
    );
  }

  return (
    <div className="tx-app" data-density={density}>
      <TxHeader client="Walk-in client" onCancel={onDone} />
      <Steps />

      {/* STEP 1 — services */}
      {step === 1 && (
        <>
          <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <ServiceTiles onPick={cart.add} columns={2} />
            </div>
            <aside style={{ width: 280, borderLeft: "1px solid var(--border)", background: "var(--card)", display: "flex", flexDirection: "column" }}>
              <div className="tx-cart-h"><div style={{ fontWeight: 600 }}>Sale ({cart.items.length})</div></div>
              <div className="tx-cart-list">
                {cart.items.length === 0 ? <div className="tx-empty">Tap services to add.</div> : cart.items.map(item => (
                  <CartRow key={item.id} item={item}
                    onQtyChange={q => cart.setQty(item.id, q)}
                    onPriceChange={p => cart.setPrice(item.id, p)}
                    onRemove={() => cart.remove(item.id)} />
                ))}
              </div>
              <Totals subtotal={cart.subtotal} tipPct={0} showLabels={false} />
            </aside>
          </div>
          <div style={{ padding: 16, borderTop: "1px solid var(--border)", background: "var(--card)", display: "flex", justifyContent: "flex-end" }}>
            <button className="tx-btn" disabled={cart.items.length === 0} onClick={() => setStep(2)} style={{ minWidth: 200 }}>
              Continue <TI.Back size={16} style={{ transform: "rotate(180deg)" }} />
            </button>
          </div>
        </>
      )}

      {/* STEP 2 — tip */}
      {step === 2 && (
        <>
          <div style={{ flex: 1, minHeight: 0, padding: "32px 24px", overflow: "auto", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 14, color: "var(--muted-foreground)" }}>Subtotal</div>
              <div className="tnum" style={{ fontSize: 40, fontWeight: 600, letterSpacing: "-0.02em" }}>${cart.subtotal.toFixed(2)}</div>
            </div>
            <div style={{ width: "100%", maxWidth: 480 }}>
              <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 500, marginBottom: 10, textAlign: "center" }}>Add a tip</div>
              <TipSelector subtotal={cart.subtotal} value={tipPct} onChange={setTipPct} />
            </div>
          </div>
          <div style={{ padding: 16, borderTop: "1px solid var(--border)", background: "var(--card)", display: "flex", gap: 8, justifyContent: "space-between" }}>
            <button className="tx-btn ghost" onClick={() => setStep(1)}><TI.Back size={16} /> Back</button>
            <button className="tx-btn" onClick={() => setStep(3)} style={{ minWidth: 200 }}>
              {tipPct > 0 ? `Continue with $${tip.toFixed(2)} tip` : "Skip tip"}
            </button>
          </div>
        </>
      )}

      {/* STEP 3 — payment */}
      {step === 3 && (
        <>
          <div style={{ flex: 1, minHeight: 0, padding: "32px 24px", overflow: "auto" }}>
            <div style={{ maxWidth: 520, margin: "0 auto" }}>
              <div style={{ textAlign: "center", marginBottom: 24 }}>
                <div style={{ fontSize: 14, color: "var(--muted-foreground)" }}>Total due</div>
                <div className="tnum" style={{ fontSize: 48, fontWeight: 600, letterSpacing: "-0.02em" }}>${total.toFixed(2)}</div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  ${cart.subtotal.toFixed(2)} + ${tip.toFixed(2)} tip + ${tax.toFixed(2)} tax
                </div>
              </div>
              <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 500, marginBottom: 10 }}>How is the customer paying?</div>
              <PaymentTiles value={method} onChange={setMethod} />
              <div style={{ marginTop: 12, textAlign: "center" }}>
                <button className="tx-link" onClick={() => setMethod("split")}>Split between methods</button>
              </div>
            </div>
          </div>
          <div style={{ padding: 16, borderTop: "1px solid var(--border)", background: "var(--card)", display: "flex", gap: 8, justifyContent: "space-between" }}>
            <button className="tx-btn ghost" onClick={() => setStep(2)}><TI.Back size={16} /> Back</button>
            <button className="tx-btn" disabled={!method} onClick={() => setStep(4)} style={{ minWidth: 220 }}>
              Charge ${total.toFixed(2)}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
window.FlowWizard = FlowWizard;
