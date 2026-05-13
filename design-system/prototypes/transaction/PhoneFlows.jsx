// Phone (iPhone) versions of the three flows. Stacked, single-column.
// Each shares the same data + components from components.jsx.

function PhoneSingle({ density = "compact", initialTechs = ["maya"], onDone }) {
  const cart = useCart();
  const [tipPct, setTipPct] = useState(0);
  const [method, setMethod] = useState(null);
  const [showSplit, setShowSplit] = useState(false);
  const [pane, setPane] = useState("services"); // services | review | done
  const [techs, setTechs] = useState(initialTechs);
  const defaultTech = techs[0] || null;

  const tip = cart.subtotal * tipPct;
  const tax = (cart.subtotal + tip) * TAX_RATE;
  const total = cart.subtotal + tip + tax;

  if (pane === "done") {
    return (
      <div className="tx-app" data-density={density}>
        <DoneScreen amount={total} method={method}
          onNew={() => { cart.clear(); setTipPct(0); setMethod(null); setPane("services"); }}
          onReceipt={() => {}} />
      </div>
    );
  }

  return (
    <div className="tx-app" data-density={density}>
      <header className="tx-header" style={{ padding: "12px 16px" }}>
        <button className="tx-stepper-btn" onClick={pane === "review" ? () => setPane("services") : onDone} style={{ width: 32, height: 32, borderRadius: 8 }}>
          {pane === "review" ? <TI.Back size={16} /> : <TI.X size={16} />}
        </button>
        <div style={{ textAlign: "center", flex: 1 }}>
          <div className="ttl" style={{ fontSize: 14 }}>{pane === "services" ? "New transaction" : "Review & charge"}</div>
          <div className="sub" style={{ fontSize: 11 }}>Walk-in</div>
        </div>
        <div style={{ width: 32 }} />
      </header>

      {pane === "services" && (
        <>
          <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", background: "var(--card)" }}>
            {techs.length === 0 ? (
              <TechAvatarRow value={techs} onChange={setTechs} size={32} multi={false} label="Assign a tech" />
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 500 }}>Tech</span>
                <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 8px 3px 3px", background: "color-mix(in oklch, var(--primary) 8%, transparent)", border: "1px solid color-mix(in oklch, var(--primary) 30%, var(--border))", borderRadius: 9999 }}>
                  <TechAvatar tech={STAFF.find(s => s.id === techs[0])} size={20} />
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{(STAFF.find(s => s.id === techs[0]) || {}).full}</span>
                </div>
                <button className="tx-link" style={{ fontSize: 11 }} onClick={() => setTechs([])}>Change</button>
              </div>
            )}
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <ServiceTiles onPick={(s) => cart.add({ ...s, tech: defaultTech })} columns={2} />
          </div>
          {cart.items.length > 0 && (
            <div style={{ borderTop: "1px solid var(--border)", background: "var(--card)", padding: 12, display: "flex", gap: 8, alignItems: "center" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{cart.items.length} item{cart.items.length === 1 ? "" : "s"}</div>
                <div className="tnum" style={{ fontSize: 18, fontWeight: 600 }}>${cart.subtotal.toFixed(2)}</div>
              </div>
              <button className="tx-btn" onClick={() => setPane("review")}>Review</button>
            </div>
          )}
        </>
      )}

      {pane === "review" && (
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <div style={{ background: "var(--card)" }}>
            {cart.items.map(item => (
              <CartRowWithTech key={item.id} item={item} techs={techs}
                onQtyChange={q => cart.setQty(item.id, q)}
                onPriceChange={p => cart.setPrice(item.id, p)}
                onTechChange={(tid) => cart.setTech(item.id, tid)}
                onRemove={() => cart.remove(item.id)} />
            ))}
          </div>

          <div style={{ padding: 16 }}>
            <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 500, marginBottom: 8 }}>Tip (optional)</div>
            <TipSelector subtotal={cart.subtotal} value={tipPct} onChange={setTipPct} />
          </div>

          <div style={{ padding: "0 16px 12px" }}>
            <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 500, marginBottom: 8 }}>Payment</div>
            <PaymentTiles value={method} onChange={setMethod} hideSplit={!showSplit} />
            {!showSplit && <button className="tx-link" style={{ marginTop: 6 }} onClick={() => setShowSplit(true)}>Split payment</button>}
          </div>

          <Totals subtotal={cart.subtotal} tipPct={tipPct} />

          <div style={{ padding: 16 }}>
            <button className="tx-btn full" disabled={!method} onClick={() => setPane("done")}>Charge ${total.toFixed(2)}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function PhoneWizard({ density = "compact", onDone }) {
  const cart = useCart();
  const [step, setStep] = useState(1);
  const [tipPct, setTipPct] = useState(0);
  const [method, setMethod] = useState(null);

  const tip = cart.subtotal * tipPct;
  const tax = (cart.subtotal + tip) * TAX_RATE;
  const total = cart.subtotal + tip + tax;

  if (step === 4) {
    return (
      <div className="tx-app" data-density={density}>
        <DoneScreen amount={total} method={method}
          onNew={() => { cart.clear(); setTipPct(0); setMethod(null); setStep(1); }}
          onReceipt={() => {}} />
      </div>
    );
  }

  return (
    <div className="tx-app" data-density={density}>
      <header className="tx-header" style={{ padding: "12px 16px" }}>
        <button className="tx-stepper-btn" onClick={step > 1 ? () => setStep(step - 1) : onDone} style={{ width: 32, height: 32, borderRadius: 8 }}>
          {step > 1 ? <TI.Back size={16} /> : <TI.X size={16} />}
        </button>
        <div style={{ textAlign: "center", flex: 1 }}>
          <div className="sub" style={{ fontSize: 11 }}>Step {step} of 3</div>
          <div className="ttl" style={{ fontSize: 14 }}>{["Services","Tip","Payment"][step-1]}</div>
        </div>
        <div style={{ width: 32 }} />
      </header>

      {step === 1 && (
        <>
          <div style={{ flex: 1, minHeight: 0 }}>
            <ServiceTiles onPick={cart.add} columns={2} />
          </div>
          <div style={{ borderTop: "1px solid var(--border)", background: "var(--card)", padding: 12, display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{cart.items.length} item{cart.items.length === 1 ? "" : "s"}</div>
              <div className="tnum" style={{ fontSize: 18, fontWeight: 600 }}>${cart.subtotal.toFixed(2)}</div>
            </div>
            <button className="tx-btn" disabled={cart.items.length === 0} onClick={() => setStep(2)}>Next</button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <div style={{ flex: 1, minHeight: 0, padding: 20, display: "flex", flexDirection: "column", justifyContent: "center", gap: 24 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>Subtotal</div>
              <div className="tnum" style={{ fontSize: 36, fontWeight: 600, letterSpacing: "-0.02em" }}>${cart.subtotal.toFixed(2)}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 500, marginBottom: 8, textAlign: "center" }}>Add a tip</div>
              <TipSelector subtotal={cart.subtotal} value={tipPct} onChange={setTipPct} />
            </div>
          </div>
          <div style={{ borderTop: "1px solid var(--border)", background: "var(--card)", padding: 12 }}>
            <button className="tx-btn full" onClick={() => setStep(3)}>{tipPct > 0 ? `Continue with $${tip.toFixed(2)} tip` : "Skip tip"}</button>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <div style={{ flex: 1, minHeight: 0, padding: 20, overflow: "auto" }}>
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>Total due</div>
              <div className="tnum" style={{ fontSize: 40, fontWeight: 600, letterSpacing: "-0.02em" }}>${total.toFixed(2)}</div>
            </div>
            <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 500, marginBottom: 8 }}>Payment method</div>
            <PaymentTiles value={method} onChange={setMethod} />
          </div>
          <div style={{ borderTop: "1px solid var(--border)", background: "var(--card)", padding: 12 }}>
            <button className="tx-btn full" disabled={!method} onClick={() => setStep(4)}>Charge ${total.toFixed(2)}</button>
          </div>
        </>
      )}
    </div>
  );
}

function PhonePOS({ density = "compact", onDone }) {
  const cart = useCart();
  const [draft, setDraft] = useState("");
  const [tipPct, setTipPct] = useState(0);
  const [method, setMethod] = useState(null);
  const [pane, setPane] = useState("entry"); // entry | review | done

  const tip = cart.subtotal * tipPct;
  const tax = (cart.subtotal + tip) * TAX_RATE;
  const total = cart.subtotal + tip + tax;

  const addCustom = () => {
    const amt = parseFloat(draft);
    if (!amt || amt <= 0) return;
    cart.add({ id: `custom-${Date.now()}`, name: "Custom item", price: amt, time: 0, cat: "Custom" });
    setDraft("");
  };

  if (pane === "done") return (
    <div className="tx-app" data-density={density}>
      <DoneScreen amount={total} method={method}
        onNew={() => { cart.clear(); setDraft(""); setTipPct(0); setMethod(null); setPane("entry"); }}
        onReceipt={() => {}} />
    </div>
  );

  return (
    <div className="tx-app" data-density={density}>
      <header className="tx-header" style={{ padding: "12px 16px" }}>
        <button className="tx-stepper-btn" onClick={pane === "review" ? () => setPane("entry") : onDone} style={{ width: 32, height: 32, borderRadius: 8 }}>
          {pane === "review" ? <TI.Back size={16} /> : <TI.X size={16} />}
        </button>
        <div style={{ textAlign: "center", flex: 1 }}>
          <div className="ttl" style={{ fontSize: 14 }}>{pane === "entry" ? "New sale" : "Review"}</div>
        </div>
        <div style={{ width: 32 }} />
      </header>

      {pane === "entry" && (
        <>
          <div style={{ flex: 1, minHeight: 0, padding: 16, overflow: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
            <Numpad value={draft} onChange={setDraft} onConfirm={addCustom} label="Type amount, or pick below" />
            <div className="tx-tiles" style={{ gridTemplateColumns: "1fr 1fr" }}>
              {SERVICES.slice(0, 4).map(s => (
                <button key={s.id} className="tx-tile" onClick={() => cart.add(s)}>
                  <div className="nm">{s.name}</div>
                  <div className="meta"><span>{s.time}m</span><span className="price">${s.price}</span></div>
                </button>
              ))}
            </div>
          </div>
          {cart.items.length > 0 && (
            <div style={{ borderTop: "1px solid var(--border)", background: "var(--card)", padding: 12, display: "flex", gap: 8, alignItems: "center" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{cart.items.length} item{cart.items.length === 1 ? "" : "s"}</div>
                <div className="tnum" style={{ fontSize: 18, fontWeight: 600 }}>${cart.subtotal.toFixed(2)}</div>
              </div>
              <button className="tx-btn" onClick={() => setPane("review")}>Review</button>
            </div>
          )}
        </>
      )}

      {pane === "review" && (
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <div style={{ background: "var(--card)" }}>
            {cart.items.map(item => (
              <CartRow key={item.id} item={item}
                onQtyChange={q => cart.setQty(item.id, q)}
                onPriceChange={p => cart.setPrice(item.id, p)}
                onRemove={() => cart.remove(item.id)} />
            ))}
          </div>
          <div style={{ padding: 16 }}>
            <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 500, marginBottom: 8 }}>Tip</div>
            <TipSelector subtotal={cart.subtotal} value={tipPct} onChange={setTipPct} />
          </div>
          <div style={{ padding: "0 16px 12px" }}>
            <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 500, marginBottom: 8 }}>Payment</div>
            <PaymentTiles value={method} onChange={setMethod} />
          </div>
          <Totals subtotal={cart.subtotal} tipPct={tipPct} />
          <div style={{ padding: 16 }}>
            <button className="tx-btn full" disabled={!method} onClick={() => setPane("done")}>Charge ${total.toFixed(2)}</button>
          </div>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { PhoneSingle, PhoneWizard, PhonePOS });
