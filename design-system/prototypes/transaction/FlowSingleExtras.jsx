// Single-screen cart — bill print exploration.
//
// Restaurant-style "drop the bill" sheet. Front desk taps the Bill button in
// the cart footer to print or email a bill BEFORE payment is taken — same idea
// as a server bringing the check to a table. Once the customer signs and tips
// on paper, the front desk closes out the sale through the normal Charge flow.
//
// Exposes:
//   <BillSheet items={...} client techId appt onClose onPrint onEmail />
//   <BillPreviewArtboard density />  — canvas-only artboard with the sheet open

const SAMPLE_BILL_ITEMS = [
  { id: "gel-1",     name: "Gel polish",        price: 60, time: 45, tech: "maya", qty: 1 },
  { id: "mani-1",    name: "Classic manicure",  price: 45, time: 30, tech: "maya", qty: 1 },
  { id: "art-1",     name: "Nail art · medium", price: 45, time: 15, tech: "maya", qty: 1, variable: true },
  { id: "paraffin-1",name: "Paraffin add-on",   price: 15, time: 15, tech: "maya", qty: 1 },
];

// ─── Bill preview (printed/printable receipt before payment) ──────────────
function BillSheet({ items = [], client = "Walk-in client", techId, appt = "Today", onClose, onPrint, onEmail }) {
  const subtotal = items.reduce((s, i) => s + i.price * (i.qty || 1), 0);
  const tax = subtotal * TAX_RATE;
  const totalBeforeTip = subtotal + tax;
  const tech = techId ? STAFF.find(s => s.id === techId) : null;

  // Suggested tip rows — restaurants typically pre-print these. We mirror that.
  const tipSuggestions = [
    { label: "Good · 18%",     pct: 0.18 },
    { label: "Great · 20%",    pct: 0.20 },
    { label: "Generous · 25%", pct: 0.25 },
  ];

  return (
    <div className="tx-sheet-backdrop" onClick={onClose}>
      <div className="tx-bill-sheet" onClick={e => e.stopPropagation()}>
        <div className="tx-bill-sheet-h">
          <div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>Bill preview</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>Print or email — payment not yet taken</div>
          </div>
          <button className="tx-stepper-btn" onClick={onClose} aria-label="close"><TI.X size={16} /></button>
        </div>

        <div className="tx-bill-doc-wrap">
          <div className="tx-bill-doc">
            <div className="tx-bill-mast">
              <div className="logo">Lacquer Salon</div>
              <div className="addr">218 Hayes St · San Francisco, CA<br/>(415) 555-0140 · lacquersalon.co</div>
            </div>

            <div className="tx-bill-meta">
              <div><span className="lbl">Guest</span><span className="val">{client}</span></div>
              <div><span className="lbl">Tech</span><span className="val">{tech ? tech.full : "—"}</span></div>
              <div><span className="lbl">Visit</span><span className="val">{appt}</span></div>
              <div><span className="lbl">Check #</span><span className="val tnum">0127</span></div>
            </div>

            <div className="tx-bill-divider dashed" />

            <div className="tx-bill-items">
              {items.length === 0 ? (
                <div className="muted" style={{ fontSize: 11, textAlign: "center", padding: "8px 0" }}>No items in this sale yet.</div>
              ) : items.map(it => (
                <div key={it.id} className="tx-bill-row">
                  <span className="qty tnum">{it.qty || 1}</span>
                  <span className="nm">{it.name}</span>
                  <span className="amt tnum">${(it.price * (it.qty || 1)).toFixed(2)}</span>
                </div>
              ))}
            </div>

            <div className="tx-bill-divider" />

            <div className="tx-bill-totals">
              <div className="row"><span>Subtotal</span><span className="tnum">${subtotal.toFixed(2)}</span></div>
              <div className="row"><span>Tax ({(TAX_RATE * 100).toFixed(2)}%)</span><span className="tnum">${tax.toFixed(2)}</span></div>
              <div className="row total"><span>Total before tip</span><span className="tnum">${totalBeforeTip.toFixed(2)}</span></div>
            </div>

            {items.length > 0 && (
              <div className="tx-bill-tip-block">
                <div className="lbl">Suggested gratuity</div>
                {tipSuggestions.map(t => {
                  const tip = subtotal * t.pct;
                  const all = totalBeforeTip + tip;
                  return (
                    <div key={t.label} className="tx-bill-tip-row">
                      <span className="t">{t.label}</span>
                      <span className="muted tnum">${tip.toFixed(2)}</span>
                      <span className="tnum">${all.toFixed(2)}</span>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="tx-bill-divider" />

            <div className="tx-bill-write">
              <div className="row"><span>Tip</span><span className="line" /></div>
              <div className="row"><span>Total</span><span className="line" /></div>
              <div className="row sig"><span>Signature</span><span className="line wide" /></div>
            </div>

            <div className="tx-bill-foot">
              <div>Thank you{client && client !== "Walk-in client" ? `, ${client.split(" ")[0]}` : ""}.</div>
              <div className="muted">Book your next visit at lacquersalon.co/book</div>
            </div>
          </div>
        </div>

        <div className="tx-bill-sheet-foot">
          <button className="tx-btn ghost" onClick={onClose}><TI.Back size={16} /> Back to sale</button>
          <div style={{ flex: 1 }} />
          <button className="tx-btn secondary" onClick={onEmail} style={{ height: 40 }}>
            <TI.Mail size={16} /> Email
          </button>
          <button className="tx-btn" onClick={onPrint} style={{ height: 40 }}>
            <TI.Printer size={16} /> Print bill
          </button>
        </div>
      </div>
    </div>
  );
}

// Canvas-only artboard — shows the FlowSingle cart with a sample sale loaded
// and the bill sheet open on top, so you can see what the print preview looks
// like in context without manually adding services.
function BillPreviewArtboard({ density = "regular" }) {
  const items = SAMPLE_BILL_ITEMS;
  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const squareTax = subtotal * TAX_RATE;
  const total = subtotal + squareTax;

  return (
    <div className="tx-app" data-density={density}>
      <TxHeader client="Maya Patel · Gel polish appt" onCancel={() => {}} />

      <div style={{ padding: "6px 16px", borderBottom: "1px solid var(--border)", background: "var(--card)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 500 }}>Tech</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 8px 2px 2px", background: "color-mix(in oklch, var(--primary) 8%, transparent)", border: "1px solid color-mix(in oklch, var(--primary) 30%, var(--border))", borderRadius: 9999 }}>
            <TechAvatar tech={STAFF.find(s => s.id === "maya")} size={20} />
            <span style={{ fontSize: 12, fontWeight: 600 }}>Maya Patel</span>
          </div>
        </div>
      </div>

      <div className="tx-content">
        <div style={{ flex: 1, minWidth: 0, borderRight: "1px solid var(--border)", opacity: 0.45, pointerEvents: "none" }}>
          <ServiceTiles onPick={() => {}} columns={3} />
        </div>
        <aside className="tx-cart" style={{ width: 420, opacity: 0.45, pointerEvents: "none" }}>
          <div className="tx-cart-list">
            {items.map(it => (
              <div key={it.id} className="tx-cart-row">
                <div style={{ minWidth: 0 }}>
                  <div className="nm">{it.name}</div>
                  <div className="meta">{it.time} min · ${it.price}</div>
                </div>
                <div style={{ fontWeight: 600 }} className="tnum">${(it.price * it.qty).toFixed(0)}</div>
              </div>
            ))}
          </div>
          <div className="tx-cart-foot">
            <div className="tx-totals" style={{ padding: "8px 16px 6px", gap: 2 }}>
              <div className="row" style={{ fontSize: 12 }}><span className="muted">Subtotal</span><span className="num">${subtotal.toFixed(2)}</span></div>
              <div className="row" style={{ fontSize: 12 }}><span className="muted">Tax</span><span className="num">${squareTax.toFixed(2)}</span></div>
              <div className="row total" style={{ fontSize: 18, paddingTop: 6, marginTop: 2 }}><span>Total</span><span className="num">${total.toFixed(2)}</span></div>
            </div>
            <div style={{ padding: "8px 16px 14px", display: "flex", gap: 8 }}>
              <button className="tx-btn secondary"><TI.Printer size={16} /> Bill</button>
              <button className="tx-btn" style={{ flex: 1 }}>Charge ${total.toFixed(2)}</button>
            </div>
          </div>
        </aside>
      </div>

      <BillSheet items={items} client="Maya Patel" techId="maya" appt="2:55 PM · Today" onClose={() => {}} onPrint={() => {}} onEmail={() => {}} />
    </div>
  );
}

// Add Mail + Printer icons to TI namespace if missing
if (typeof TI !== "undefined") {
  if (!TI.Mail) TI.Mail = ({ size = 18, ...rest }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...rest}>
      <rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" />
    </svg>
  );
  if (!TI.Printer) TI.Printer = ({ size = 18, ...rest }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...rest}>
      <polyline points="6 9 6 2 18 2 18 9" /><rect x="4" y="9" width="16" height="9" rx="2" />
      <rect x="6" y="14" width="12" height="7" /><circle cx="17" cy="12" r="0.8" fill="currentColor" />
    </svg>
  );
}

window.BillSheet = BillSheet;
window.BillPreviewArtboard = BillPreviewArtboard;
