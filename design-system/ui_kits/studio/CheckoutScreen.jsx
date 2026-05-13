// Checkout screen — POS-style payment for an active appointment
function CheckoutScreen() {
  const items = [
    { name: "Russian manicure",  qty: 1, price: 85 },
    { name: "Gel polish add-on", qty: 1, price: 15 },
    { name: "Nail art (2 nails)", qty: 1, price: 12 },
  ];
  const subtotal = items.reduce((s, i) => s + i.qty * i.price, 0);
  const tip = Math.round(subtotal * 0.20);
  const tax = Math.round(subtotal * 0.0875 * 100) / 100;
  const total = subtotal + tip + tax;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div className="h-page">Checkout</div>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>Maya Patel · with Priya · started 11:00 AM</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="outline" size="sm">Save for later</Button>
          <Button variant="ghost" size="sm">Cancel sale</Button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 16 }}>
        {/* Cart */}
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontWeight: 600 }}>Sale</div>
            <Button variant="ghost" size="sm" icon={<I.Plus />}>Add item</Button>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "12px 20px" }}>
                    <div style={{ fontWeight: 500 }}>{it.name}</div>
                    <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>Qty {it.qty}</div>
                  </td>
                  <td style={{ padding: "12px 20px", textAlign: "right" }} className="tnum">${it.price}</td>
                  <td style={{ padding: "12px 16px 12px 0", width: 32, textAlign: "right" }}>
                    <Button variant="ghost" size="sm" icon={<I.X />} aria-label="remove" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Tip */}
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 8 }}>Tip</div>
            <div style={{ display: "flex", gap: 6 }}>
              {["15%","18%","20%","25%","Custom"].map((t, i) => (
                <button key={t} className="btn btn-outline btn-sm" style={i === 2 ? { background: "var(--primary)", color: "var(--primary-foreground)", borderColor: "var(--primary)" } : {}}>{t}</button>
              ))}
            </div>
          </div>

          {/* Totals */}
          <div style={{ padding: "16px 20px" }}>
            {[
              { l: "Subtotal", v: subtotal },
              { l: "Tip (20%)", v: tip },
              { l: "Tax (8.75%)", v: tax.toFixed(2) },
            ].map(r => (
              <div key={r.l} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13 }}>
                <span className="muted">{r.l}</span><span className="tnum">${r.v}</span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0 0", fontSize: 18, fontWeight: 600, borderTop: "1px solid var(--border)", marginTop: 10 }}>
              <span>Total</span><span className="tnum">${total.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Payment panel */}
        <div className="card" style={{ padding: 20, alignSelf: "start", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontWeight: 600 }}>Payment</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {[
              { l: "Card", icon: <I.CreditCard />, active: true },
              { l: "Cash", icon: <I.Dollar /> },
              { l: "Apple Pay", icon: <I.Phone /> },
              { l: "Gift card", icon: <I.Sparkles /> },
            ].map((m, i) => (
              <button key={i} className="btn btn-outline" style={{ height: 56, flexDirection: "column", gap: 4, ...(m.active ? { borderColor: "var(--primary)", background: "color-mix(in oklch, var(--primary) 8%, transparent)", color: "var(--rose-700)" } : {}) }}>
                {m.icon}
                <span style={{ fontSize: 12 }}>{m.l}</span>
              </button>
            ))}
          </div>

          <div style={{ display: "grid", gap: 8, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <I.CreditCard size={16} />
                <span>Visa <span className="muted">•• 4242</span></span>
              </div>
              <Badge tone="success" dot>On file</Badge>
            </div>
            <Button variant="ghost" size="sm" icon={<I.Plus />} style={{ alignSelf: "flex-start" }}>Use a different card</Button>
          </div>

          <Button variant="primary" style={{ height: 44, fontSize: 14 }}>Charge ${total.toFixed(2)}</Button>
          <div className="muted" style={{ fontSize: 11, textAlign: "center" }}>Receipt will be emailed to maya@hey.com</div>
        </div>
      </div>
    </div>
  );
}

window.CheckoutScreen = CheckoutScreen;
