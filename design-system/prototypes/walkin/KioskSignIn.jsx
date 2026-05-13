// KioskSignIn — customer-facing self-serve sign-in.
// Big tappable controls. 4 steps: (1) name + phone + party, (2) services,
// (3) preferred tech (optional), (4) confirmation with queue position + estimated wait.
// Designed to live on a tablet propped at the front desk.

const { useState: _kUseState, useMemo: _kUseMemo } = React;

const KIOSK_CATS = ["Popular", "Manicure", "Pedicure", "Gel & Extensions", "Polish change", "Add-ons"];

function _svcInCat(s, cat) {
  if (cat === "Popular") {
    return ["classic-mani", "manicure-gel", "classic-pedi", "deluxe-pedi",
            "gel-polish-change-natural", "polish-change-natural",
            "acrylic-fullset-gel", "gelx-fullset"].includes(s.id);
  }
  if (cat === "Polish change") return s.cat === "Polish change";
  if (cat === "Add-ons") return s.cat === "Add-on";
  return s.cat === cat;
}

// Big tappable tech card for the kiosk
function KioskTechCard({ tech, active, onClick }) {
  const bg = `oklch(0.86 0.045 ${tech.tone})`;
  const fg = `oklch(0.36 0.055 ${tech.tone})`;
  const initials = tech.full.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase();
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? `oklch(0.92 0.055 ${tech.tone})` : "var(--card)",
        border: active ? `2px solid oklch(0.55 0.10 ${tech.tone})` : "2px solid var(--border)",
        borderRadius: 16,
        padding: "18px 16px 14px",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
        cursor: "pointer", fontFamily: "var(--font-sans)",
        transition: "all 120ms var(--ease-out)",
        position: "relative",
      }}>
      {active && (
        <span style={{
          position: "absolute", top: 10, right: 10,
          width: 22, height: 22, borderRadius: "50%",
          background: `oklch(0.55 0.10 ${tech.tone})`, color: "white",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}><WI.Check size={13} /></span>
      )}
      {/* Big avatar */}
      <div style={{
        width: 72, height: 72, borderRadius: "50%",
        background: bg, color: fg,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 26, fontWeight: 700, letterSpacing: "-0.01em",
        border: active ? `3px solid oklch(0.60 0.10 ${tech.tone})` : "3px solid transparent",
      }}>{initials}</div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--foreground)" }}>{tech.full.split(" ")[0]}</div>
        <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2, lineHeight: 1.3 }}>{tech.full.split(" ").slice(1).join(" ")}</div>
      </div>
    </button>
  );
}

function KioskSignIn() {
  const [step, setStep] = _kUseState(1);
  const [name, setName] = _kUseState("");
  const [phone, setPhone] = _kUseState("");
  const [party, setParty] = _kUseState(1);
  const [services, setServices] = _kUseState([]);
  const [techPref, setTechPref] = _kUseState(null); // null = any available
  const [cat, setCat] = _kUseState("Popular");
  const [smsOptIn, setSmsOptIn] = _kUseState(true);

  const filteredSvcs = _kUseMemo(() => SERVICES.filter(s => _svcInCat(s, cat)), [cat]);
  const toggleSvc = (id) => setServices(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);

  const subtotal = services.reduce((sum, id) => {
    const s = SERVICES.find(x => x.id === id);
    return sum + (s ? (s.priceFrom || s.price || 0) : 0);
  }, 0);
  const totalMin = services.reduce((sum, id) => sum + svcMinutes(id), 0);

  const canStep2 = name.trim().length > 0;
  const canStep3 = services.length > 0;

  // Position in queue if signed in now
  const waitingCount = WAITLIST.filter(w => w.status === "waiting").length;
  const myPosition = waitingCount + 1;
  const estWait = Math.min(60, Math.max(5, waitingCount * 9));

  const selectedTech = techPref ? STAFF.find(s => s.id === techPref) : null;

  const STEPS = [
    { n: 1, label: "Who's here" },
    { n: 2, label: "Services" },
    { n: 3, label: "Your tech" },
    { n: 4, label: "All set" },
  ];

  return (
    <div className="wl-kiosk">
      <div className="wl-kiosk-top">
        <div className="logo"><span className="dot" />Lacquer Studio</div>
        <div className="wl-kiosk-steps">
          {STEPS.map(s => (
            <div key={s.n} className={"wl-kiosk-step" + (step === s.n ? " active" : step > s.n ? " done" : "")}>
              <span className="num">{step > s.n ? <WI.Check size={11} /> : s.n}</span>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Step 1: Who's here ────────────────────────── */}
      {step === 1 && (
        <>
          <div className="wl-kiosk-body">
            <div>
              <div className="wl-kiosk-h">Welcome — what's your name?</div>
              <div className="wl-kiosk-sub">We'll add you to the waitlist. Average wait right now is about {estWait} minutes.</div>
            </div>
            <div className="wl-kiosk-grid" style={{ gridTemplateColumns: "1fr 1fr", alignContent: "start" }}>
              <div>
                <label className="wl-kiosk-label">First name</label>
                <input className="wl-kiosk-input" placeholder="e.g. Sarah" value={name} onChange={e => setName(e.target.value)} autoFocus />
              </div>
              <div>
                <label className="wl-kiosk-label">Phone (so we can text you)</label>
                <input className="wl-kiosk-input" placeholder="Optional" value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label className="wl-kiosk-label">How many in your party?</label>
                <div className="wl-party-pick">
                  {[1, 2, 3, 4, 5, "6+"].map(n => (
                    <button key={n} className={party === (n === "6+" ? 6 : n) ? "active" : ""}
                      onClick={() => setParty(n === "6+" ? 6 : n)}>{n}</button>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className="wl-kiosk-foot">
            <div className="summary">
              <span className="ttl">Step 1 of 4</span>
              <span className="v">Tell us about your visit</span>
            </div>
            <button className="wl-kiosk-btn" disabled={!canStep2} onClick={() => setStep(2)}>
              Continue <WI.ChevR size={18} />
            </button>
          </div>
        </>
      )}

      {/* ── Step 2: Services ──────────────────────────── */}
      {step === 2 && (
        <>
          <div className="wl-kiosk-body">
            <div>
              <div className="wl-kiosk-h">What would you like done?</div>
              <div className="wl-kiosk-sub">Hi {name.split(" ")[0]} — pick everything you'd like. Your tech will confirm with you in the chair.</div>
            </div>
            <div className="wl-kiosk-cats">
              {KIOSK_CATS.map(c => (
                <button key={c} className={"wl-kiosk-cat" + (cat === c ? " active" : "")} onClick={() => setCat(c)}>{c}</button>
              ))}
            </div>
            <div className="wl-kiosk-svcs">
              {filteredSvcs.map(s => {
                const active = services.includes(s.id);
                return (
                  <button key={s.id} className={"wl-kiosk-svc" + (active ? " active" : "")} onClick={() => toggleSvc(s.id)}>
                    {active && <span className="checked"><WI.Check size={13} /></span>}
                    <div className="nm">{s.name}</div>
                    <div className="meta">
                      <span>{s.time}m</span>
                      <span className="price">{svcPriceLabel(s.id)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="wl-kiosk-foot">
            <button className="wl-kiosk-btn secondary" onClick={() => setStep(1)}>
              <WI.ChevL size={18} /> Back
            </button>
            <div className="summary" style={{ flex: 1, alignItems: "center" }}>
              <span className="ttl">{services.length === 0 ? "Pick at least one service" : `${services.length} service${services.length > 1 ? "s" : ""} · ~${totalMin}m`}</span>
              {services.length > 0 && <span className="v" style={{ fontVariantNumeric: "tabular-nums" }}>est. ${subtotal}</span>}
            </div>
            <button className="wl-kiosk-btn" disabled={!canStep3} onClick={() => setStep(3)}>
              Next <WI.ChevR size={18} />
            </button>
          </div>
        </>
      )}

      {/* ── Step 3: Preferred tech (optional) ─────────── */}
      {step === 3 && (
        <>
          <div className="wl-kiosk-body">
            <div>
              <div className="wl-kiosk-h">Do you have a preferred nail tech?</div>
              <div className="wl-kiosk-sub">Totally optional — picking a tech may add a little extra wait if they're busy. We'll always match you with the best available if you leave it open.</div>
            </div>

            {/* "Any available" first — large prominent card */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 12, flex: 1, alignContent: "start" }}>
              {/* Any card */}
              <button
                onClick={() => setTechPref(null)}
                style={{
                  background: techPref === null ? "color-mix(in oklch, var(--primary) 10%, var(--card))" : "var(--card)",
                  border: techPref === null ? "2px solid var(--primary)" : "2px solid var(--border)",
                  borderRadius: 16,
                  padding: "18px 16px 14px",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
                  cursor: "pointer", fontFamily: "var(--font-sans)",
                  position: "relative",
                }}>
                {techPref === null && (
                  <span style={{
                    position: "absolute", top: 10, right: 10,
                    width: 22, height: 22, borderRadius: "50%",
                    background: "var(--primary)", color: "var(--primary-foreground)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}><WI.Check size={13} /></span>
                )}
                <div style={{
                  width: 72, height: 72, borderRadius: "50%",
                  background: "var(--muted)", color: "var(--muted-foreground)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  border: techPref === null ? "3px solid var(--primary)" : "3px solid transparent",
                }}>
                  <WI.Users size={30} />
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "var(--foreground)" }}>Any available</div>
                  <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 2, lineHeight: 1.3 }}>Fastest wait</div>
                </div>
              </button>

              {/* One card per tech */}
              {STAFF.map(tech => (
                <KioskTechCard
                  key={tech.id}
                  tech={tech}
                  active={techPref === tech.id}
                  onClick={() => setTechPref(techPref === tech.id ? null : tech.id)}
                />
              ))}
            </div>
          </div>
          <div className="wl-kiosk-foot">
            <button className="wl-kiosk-btn secondary" onClick={() => setStep(2)}>
              <WI.ChevL size={18} /> Back
            </button>
            <div className="summary" style={{ flex: 1, alignItems: "center" }}>
              <span className="ttl">Tech preference</span>
              <span className="v" style={{ fontWeight: 500 }}>
                {techPref === null ? "Any available (recommended)" : selectedTech ? selectedTech.full : ""}
              </span>
            </div>
            <button className="wl-kiosk-btn" onClick={() => setStep(4)}>
              {techPref === null ? "Skip & sign in" : "Confirm & sign in"} <WI.ChevR size={18} />
            </button>
          </div>
        </>
      )}

      {/* ── Step 4: Confirmation ──────────────────────── */}
      {step === 4 && (
        <div className="wl-kiosk-confirm">
          <div className="check">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>
          </div>
          <div>
            <h2>You're on the list, {name.split(" ")[0] || "friend"}.</h2>
            <div className="summary-line" style={{ marginTop: 6 }}>
              {services.map(svcName).join(" · ")}
              {party > 1 && ` · party of ${party}`}
            </div>
            {selectedTech && (
              <div className="summary-line" style={{ marginTop: 4, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <TechAvatar tech={selectedTech} size={20} />
                Requested with {selectedTech.full} — we'll do our best!
              </div>
            )}
          </div>
          <div className="pos-card">
            <div>
              <div className="lbl">You're</div>
              <div className="v">#{myPosition}<small>in line</small></div>
            </div>
            <div className="sep" />
            <div>
              <div className="lbl">Est. wait</div>
              <div className="v">{estWait}<small>min</small></div>
            </div>
          </div>
          {phone && (
            <label className="sms-opt">
              <input type="checkbox" checked={smsOptIn} onChange={e => setSmsOptIn(e.target.checked)} />
              Text {phone} when a chair is ready
            </label>
          )}
          <div className="summary-line">
            Feel free to grab a coffee. We'll wave when it's your turn.
          </div>
          <button className="wl-kiosk-btn secondary" onClick={() => { setStep(1); setName(""); setPhone(""); setParty(1); setServices([]); setTechPref(null); setCat("Popular"); }}>
            Done — next guest
          </button>
        </div>
      )}
    </div>
  );
}

window.KioskSignIn = KioskSignIn;
