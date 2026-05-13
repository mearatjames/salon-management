// Calendar / Schedule screen — tech-column day view
function CalendarScreen() {
  const techs = [
    { name: "Priya",  initials: "PR", primary: true },
    { name: "Maya",   initials: "MA" },
    { name: "Jules",  initials: "JU" },
    { name: "Sana",   initials: "SA" },
  ];
  const hours = ["9", "10", "11", "12", "1", "2", "3", "4", "5"];
  // Appointments: { col, startHour, durationHours, client, service, tone }
  const appts = [
    { col: 0, start: 0,   dur: 1,    client: "Maya Patel",   service: "Gel polish",       tone: "primary" },
    { col: 0, start: 1.5, dur: 1.25, client: "Liz Chen",     service: "Russian manicure", tone: "primary" },
    { col: 0, start: 3.5, dur: 0.75, client: "Walk-in",      service: "Polish change",    tone: "info" },
    { col: 1, start: 0.5, dur: 1.5,  client: "Jules Lambert", service: "Pedicure + paraffin", tone: "primary" },
    { col: 1, start: 3,   dur: 1,    client: "Aisha Khan",    service: "Gel removal",      tone: "default" },
    { col: 2, start: 0,   dur: 1.25, client: "Eva Rojas",     service: "Classic manicure", tone: "primary" },
    { col: 2, start: 2,   dur: 1,    client: "Hana Ito",      service: "Nail art",         tone: "warning" },
    { col: 2, start: 5,   dur: 1.5,  client: "Sam Wright",    service: "Spa pedicure",     tone: "primary" },
    { col: 3, start: 1,   dur: 1.25, client: "Dani Park",     service: "Gel polish",       tone: "primary" },
    { col: 3, start: 4,   dur: 1,    client: "Kim Suh",       service: "Acrylic fill",     tone: "default" },
  ];
  const HOUR_PX = 56;
  const toneStyles = (t) => ({
    primary: { bg: "color-mix(in oklch, var(--primary) 12%, var(--card))", border: "color-mix(in oklch, var(--primary) 35%, transparent)", accent: "var(--primary)" },
    info:    { bg: "color-mix(in oklch, var(--info) 10%, var(--card))",    border: "color-mix(in oklch, var(--info) 30%, transparent)",    accent: "var(--info)" },
    warning: { bg: "color-mix(in oklch, var(--warning) 14%, var(--card))", border: "color-mix(in oklch, var(--warning) 35%, transparent)", accent: "var(--warning)" },
    default: { bg: "var(--secondary)", border: "var(--border)", accent: "var(--muted-foreground)" },
  }[t]);

  return (
    <div>
      {/* Page header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div className="h-page">Tuesday, May 7</div>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>10 appointments · 4 staff · 2 walk-in slots</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 6, padding: 2, background: "var(--muted)" }}>
            {["Day","Week","Month"].map((l,i) => (
              <button key={l} className="btn btn-ghost btn-sm" style={{ height: 26, background: i === 0 ? "var(--card)" : "transparent", color: i === 0 ? "var(--foreground)" : "var(--muted-foreground)", boxShadow: i === 0 ? "var(--shadow-xs)" : "none" }}>{l}</button>
            ))}
          </div>
          <Button variant="outline" size="sm" icon={<I.Chevron style={{ transform: "rotate(180deg)" }} />} />
          <Button variant="outline" size="sm">Today</Button>
          <Button variant="outline" size="sm" icon={<I.Chevron />} />
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { l: "Booked", v: "8", s: "of 12 slots" },
          { l: "Revenue projected", v: "$1,840", s: "+12% vs last Tue" },
          { l: "First visits", v: "2", s: "Aisha, Hana" },
          { l: "Open slots", v: "4", s: "next at 11:30 AM" },
        ].map((s, i) => (
          <div key={i} className="card" style={{ padding: 14 }}>
            <div style={{ fontSize: 11, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 500 }}>{s.l}</div>
            <div className="tnum" style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em", marginTop: 4 }}>{s.v}</div>
            <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{s.s}</div>
          </div>
        ))}
      </div>

      {/* Schedule grid */}
      <div className="card" style={{ overflow: "hidden" }}>
        {/* Tech header */}
        <div style={{ display: "grid", gridTemplateColumns: `64px repeat(${techs.length}, 1fr)`, borderBottom: "1px solid var(--border)" }}>
          <div></div>
          {techs.map((t, i) => (
            <div key={i} style={{ padding: "12px 16px", borderLeft: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
              <Avatar initials={t.initials} primary={t.primary} size={28} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{t.name}</div>
                <div className="muted" style={{ fontSize: 11 }}>{["3 booked","2 booked","3 booked","2 booked"][i]}</div>
              </div>
            </div>
          ))}
        </div>
        {/* Hour rows + columns */}
        <div style={{ position: "relative", display: "grid", gridTemplateColumns: `64px repeat(${techs.length}, 1fr)` }}>
          <div>
            {hours.map((h, i) => (
              <div key={h} style={{ height: HOUR_PX, padding: "6px 8px", borderTop: i === 0 ? "none" : "1px solid var(--border)", fontSize: 11, color: "var(--muted-foreground)", fontVariantNumeric: "tabular-nums" }}>
                {h}{i < 3 ? " AM" : " PM"}
              </div>
            ))}
          </div>
          {techs.map((_, col) => (
            <div key={col} style={{ position: "relative", borderLeft: "1px solid var(--border)" }}>
              {hours.map((_, i) => <div key={i} style={{ height: HOUR_PX, borderTop: i === 0 ? "none" : "1px solid var(--border)" }} />)}
              {appts.filter(a => a.col === col).map((a, i) => {
                const ts = toneStyles(a.tone);
                return (
                  <div key={i} style={{
                    position: "absolute", top: a.start * HOUR_PX + 2, left: 6, right: 6,
                    height: a.dur * HOUR_PX - 4,
                    background: ts.bg, border: `1px solid ${ts.border}`,
                    borderLeft: `3px solid ${ts.accent}`,
                    borderRadius: 6, padding: "6px 8px",
                    fontSize: 12, lineHeight: 1.3,
                    cursor: "pointer", overflow: "hidden",
                  }}>
                    <div style={{ fontWeight: 500 }}>{a.client}</div>
                    <div className="muted" style={{ fontSize: 11 }}>{a.service}</div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

window.CalendarScreen = CalendarScreen;
