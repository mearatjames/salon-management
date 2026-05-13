function BookingScreen({ onBack, onConfirm }) {
  const [tech, setTech] = React.useState(0);
  const [slot, setSlot] = React.useState(2);
  const techs = [
    { name: "Priya", initials: "PR", rating: 4.9 },
    { name: "Maya",  initials: "MA", rating: 4.8 },
    { name: "Jules", initials: "JU", rating: 4.7 },
  ];
  const days = [
    { dow: "Wed", d: 7,  open: true },
    { dow: "Thu", d: 8,  open: true },
    { dow: "Fri", d: 9,  open: false },
    { dow: "Sat", d: 10, open: true, sel: true },
    { dow: "Sun", d: 11, open: true },
  ];
  const slots = ["10:00", "10:30", "11:30", "1:00", "2:30", "4:00"];

  return (
    <div className="m-screen">
      <div className="m-header" style={{ paddingTop: 52 }}>
        <div onClick={onBack} style={{ cursor: "pointer", padding: 4 }}><M.Back size={22} /></div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Russian manicure</div>
        <div style={{ width: 22 }} />
      </div>

      <div className="m-content">
        <div className="m-card" style={{ padding: 16, marginBottom: 18 }}>
          <div className="tnum" style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em" }}>$85</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted-foreground)", marginTop: 4 }}>
            <M.Clock size={12} /><span>60 min</span><span>·</span><M.Pin size={12} /><span>Hayes Valley</span>
          </div>
        </div>

        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Choose your tech</div>
        <div style={{ display: "flex", gap: 10, marginBottom: 22, overflowX: "auto" }}>
          {techs.map((t, i) => (
            <div key={t.name} onClick={() => setTech(i)} className="m-card" style={{ padding: 12, minWidth: 110, textAlign: "center", cursor: "pointer", borderColor: tech === i ? "var(--primary)" : "var(--border)", borderWidth: tech === i ? 2 : 1 }}>
              <div style={{ width: 44, height: 44, borderRadius: 9999, background: "color-mix(in oklch, var(--primary) 15%, transparent)", color: "var(--rose-700)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 6px", fontWeight: 500, fontSize: 13 }}>{t.initials}</div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{t.name}</div>
              <div style={{ fontSize: 11, color: "var(--muted-foreground)", display: "flex", alignItems: "center", justifyContent: "center", gap: 3, marginTop: 2 }}>
                <M.Star size={10} style={{ color: "var(--warning)", fill: "var(--warning)" }} /><span className="tnum">{t.rating}</span>
              </div>
            </div>
          ))}
        </div>

        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Pick a date</div>
        <div style={{ display: "flex", gap: 6, marginBottom: 22 }}>
          {days.map((d, i) => (
            <div key={i} className="m-card" style={{ flex: 1, padding: "10px 0", textAlign: "center", opacity: d.open ? 1 : 0.4, ...(d.sel ? { background: "var(--foreground)", color: "var(--background)", borderColor: "var(--foreground)" } : {}) }}>
              <div style={{ fontSize: 10, opacity: 0.7 }}>{d.dow}</div>
              <div className="tnum" style={{ fontSize: 16, fontWeight: 500, marginTop: 2 }}>{d.d}</div>
            </div>
          ))}
        </div>

        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Available times</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 24 }}>
          {slots.map((s, i) => (
            <div key={s} onClick={() => setSlot(i)} className="m-card tnum" style={{ padding: "12px 0", textAlign: "center", fontSize: 13, fontWeight: 500, cursor: "pointer", ...(slot === i ? { borderColor: "var(--primary)", background: "color-mix(in oklch, var(--primary) 8%, transparent)", color: "var(--rose-700)", borderWidth: 2 } : {}) }}>{s}</div>
          ))}
        </div>
      </div>

      <div style={{ padding: "12px 20px 24px", borderTop: "1px solid var(--border)", background: "var(--card)" }}>
        <button className="m-btn" onClick={onConfirm}>Confirm — Sat 11:30 with {techs[tech].name}</button>
      </div>
    </div>
  );
}
window.BookingScreen = BookingScreen;
