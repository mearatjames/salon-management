function DiscoverScreen({ onPickService }) {
  const services = [
    { name: "Russian manicure", price: 85, len: "60 min", img: "" },
    { name: "Gel polish",       price: 60, len: "45 min", img: "b" },
    { name: "Spa pedicure",     price: 95, len: "75 min", img: "c" },
    { name: "Nail art",         price: 30, len: "+ add-on", img: "d" },
  ];
  return (
    <div className="m-screen">
      <div className="m-header" style={{ paddingTop: 52 }}>
        <div>
          <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>Good morning</div>
          <div className="m-h1">Maya</div>
        </div>
        <div style={{ width: 40, height: 40, borderRadius: 9999, background: "color-mix(in oklch, var(--primary) 15%, transparent)", color: "var(--rose-700)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 500, fontSize: 14 }}>MP</div>
      </div>

      <div className="m-content">
        {/* Search */}
        <div style={{ position: "relative", marginBottom: 16 }}>
          <M.Search size={16} style={{ position: "absolute", left: 14, top: 14, color: "var(--muted-foreground)" }} />
          <input className="input" placeholder="Search services or techs" style={{ height: 44, paddingLeft: 38, fontSize: 14, width: "100%", borderRadius: 12 }} />
        </div>

        {/* Filter pills */}
        <div style={{ display: "flex", gap: 6, marginBottom: 18, overflowX: "auto", paddingBottom: 4 }}>
          <span className="m-pill active">All</span>
          <span className="m-pill">Manicure</span>
          <span className="m-pill">Pedicure</span>
          <span className="m-pill">Gel</span>
          <span className="m-pill">Nail art</span>
        </div>

        {/* Featured */}
        <div className="m-card" style={{ marginBottom: 20, padding: 16, display: "flex", gap: 14, alignItems: "center" }}>
          <div style={{ width: 56, height: 56, borderRadius: 9999, background: "color-mix(in oklch, var(--primary) 15%, transparent)", color: "var(--rose-700)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600 }}>PR</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 500, fontSize: 14 }}>Priya · your usual tech</div>
            <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>
              <M.Star size={12} style={{ color: "var(--warning)", fill: "var(--warning)" }} />
              <span className="tnum">4.9</span><span>· next slot Sat 10:00</span>
            </div>
          </div>
          <M.Chevron size={18} style={{ color: "var(--muted-foreground)" }} />
        </div>

        <div className="m-h2" style={{ marginBottom: 12 }}>Popular this week</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {services.map(s => (
            <div key={s.name} className="m-card" onClick={onPickService} style={{ cursor: "pointer" }}>
              <div className={"m-img " + s.img} />
              <div style={{ padding: "10px 12px 12px" }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{s.name}</div>
                <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 2 }} className="tnum">${s.price} · {s.len}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
window.DiscoverScreen = DiscoverScreen;
