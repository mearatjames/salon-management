function AppointmentScreen({ onDone }) {
  return (
    <div className="m-screen">
      <div className="m-header" style={{ paddingTop: 52 }}>
        <div style={{ width: 22 }} />
        <div style={{ fontSize: 14, fontWeight: 600 }}>Booking confirmed</div>
        <div style={{ width: 22 }} />
      </div>
      <div className="m-content" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "16px 0 4px" }}>
          <div style={{ width: 64, height: 64, borderRadius: 9999, background: "color-mix(in oklch, var(--success) 15%, transparent)", color: "var(--success)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
            <M.Check size={28} />
          </div>
          <div className="m-h2">You're all set, Maya</div>
          <div style={{ fontSize: 13, color: "var(--muted-foreground)", marginTop: 4 }}>We'll text you a reminder Friday afternoon.</div>
        </div>

        <div className="m-card" style={{ padding: 18 }}>
          <div style={{ fontSize: 11, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 500, marginBottom: 6 }}>Russian manicure</div>
          <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em" }}>Saturday, May 10 · 11:30 AM</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
            <div style={{ width: 36, height: 36, borderRadius: 9999, background: "color-mix(in oklch, var(--primary) 15%, transparent)", color: "var(--rose-700)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 500, fontSize: 12 }}>PR</div>
            <div><div style={{ fontSize: 13, fontWeight: 500 }}>with Priya</div><div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>60 min · $85</div></div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--muted-foreground)", marginTop: 12 }}>
            <M.Pin size={13} /><span>Lacquer · 482 Hayes St, San Francisco</span>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <button className="m-btn m-btn-secondary" style={{ height: 44, fontSize: 13 }}>Add to calendar</button>
          <button className="m-btn m-btn-secondary" style={{ height: 44, fontSize: 13 }}>Get directions</button>
        </div>

        <div className="m-card" style={{ padding: 14, fontSize: 12, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
          Free to cancel up to 4 hours before. Within 4 hours, a 50% fee applies.
        </div>
      </div>
      <div style={{ padding: "12px 20px 24px", borderTop: "1px solid var(--border)", background: "var(--card)" }}>
        <button className="m-btn" onClick={onDone}>Done</button>
      </div>
    </div>
  );
}
window.AppointmentScreen = AppointmentScreen;
