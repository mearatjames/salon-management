// PhoneWaitlist — front-desk waitlist view on a phone.
// Tabs across the top filter by lane; FAB opens a sheet to add a walk-in.

const { useState: _pwUseState, useMemo: _pwUseMemo } = React;

function PhoneWaitlistCard({ entry, position, onSeat, onComplete }) {
  const waitMin = minutesSince(entry.signedAt);
  const waitClass = waitMin >= 40 ? " very-long" : waitMin >= 25 ? " long" : "";
  return (
    <div className={"wl-card " + entry.status} style={{ padding: "10px 12px", gap: 10 }}>
      <div className="pos" style={{ width: 30, height: 30, fontSize: 12 }}>
        {entry.status === "serving" && entry.tech ? <TechAvatar tech={STAFF.find(s => s.id === entry.tech)} size={28} /> : (entry.status === "called" || entry.status === "serving" || entry.status === "done" ? "·" : position)}
      </div>
      <div className="wl-card-main">
        <div className="wl-card-name" style={{ fontSize: 13 }}>
          <span>{entry.name}</span>
          {entry.party > 1 && <span className="party"><WI.Users size={9} />×{entry.party}</span>}
        </div>
        <div className="wl-card-svcs">
          {entry.services.slice(0, 2).map(id => (
            <span key={id} className="wl-svc-tag" style={{ fontSize: 10 }}>{svcName(id)}</span>
          ))}
          {entry.services.length > 2 && <span className="wl-svc-tag" style={{ fontSize: 10 }}>+{entry.services.length - 2}</span>}
        </div>
        <div className="wl-card-meta" style={{ marginTop: 2 }}>
          {entry.status === "waiting" && <span className={"wl-wait" + waitClass}><WI.Clock size={9} /> {fmtDur(waitMin)}</span>}
          {entry.status === "called" && entry.calledAt && <span className="wl-wait long"><WI.Bell size={9} /> {fmtDur(minutesSince(entry.calledAt))}</span>}
          {entry.status === "serving" && <span className="tnum">Seated {fmtTimeShort(entry.seatedAt)}</span>}
          {entry.status === "done" && <span className="tnum">done {fmtTimeShort(entry.doneAt)}</span>}
        </div>
      </div>
      <div className="wl-card-actions" style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}>
        {entry.status === "waiting" && (
          <button className="wl-act primary" onClick={() => onSeat(entry.id)} style={{ height: 28, padding: "0 10px" }}>
            <WI.Chair size={11} /> Seat
          </button>
        )}
        {entry.status === "called" && (
          <button className="wl-act success" onClick={() => onSeat(entry.id)} style={{ height: 28, padding: "0 10px" }}>
            <WI.Chair size={11} /> Seat
          </button>
        )}
        {entry.status === "serving" && (
          <button className="wl-act" onClick={() => onComplete(entry.id)} style={{ height: 28, padding: "0 10px" }}>
            <WI.Check size={11} /> Done
          </button>
        )}
      </div>
    </div>
  );
}

function PhoneAddSheet({ open, onClose, onAdd }) {
  const [name, setName] = _pwUseState("");
  const [phone, setPhone] = _pwUseState("");
  const [services, setServices] = _pwUseState([]);
  if (!open) return null;
  const POP = ["classic-mani", "manicure-gel", "classic-pedi", "deluxe-pedi", "gel-polish-change-natural", "polish-change-natural", "acrylic-fullset-gel", "removal-gel", "addon-french-tips"];
  const visible = SERVICES.filter(s => POP.includes(s.id));
  const toggle = (id) => setServices(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const canSubmit = name.trim().length > 0 && services.length > 0;
  const submit = () => { onAdd({ name: name.trim(), phone: phone.trim() || null, party: 1, services, techPref: null, note: null }); setName(""); setPhone(""); setServices([]); onClose(); };
  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(20,18,16,0.5)", zIndex: 50, display: "flex", alignItems: "flex-end" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "var(--card)", width: "100%", borderRadius: "16px 16px 0 0", padding: "18px 16px 24px", display: "flex", flexDirection: "column", gap: 12, maxHeight: "80%", overflow: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Add walk-in</div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", padding: 4, color: "var(--muted-foreground)" }}><WI.X size={18} /></button>
        </div>
        <div className="grp" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 500, color: "var(--muted-foreground)" }}>Name</label>
          <input className="wl-input" placeholder="First name" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="grp" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 500, color: "var(--muted-foreground)" }}>Phone</label>
          <input className="wl-input" placeholder="Optional" value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" />
        </div>
        <div className="grp" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 500, color: "var(--muted-foreground)" }}>Services</label>
          <div className="wl-svc-chips" style={{ maxHeight: 180 }}>
            {visible.map(s => (
              <button key={s.id} type="button" className={"wl-svc-chip" + (services.includes(s.id) ? " active" : "")} onClick={() => toggle(s.id)}>
                {s.name}
              </button>
            ))}
          </div>
        </div>
        <button className="tx-btn full" disabled={!canSubmit} onClick={submit}><WI.UserPlus size={14} /> Add to waitlist</button>
      </div>
    </div>
  );
}

function PhoneWaitlist() {
  const [list, setList] = _pwUseState(() =>
    WAITLIST.map(w => ({ ...w, status: w.status === "called" ? "waiting" : w.status }))
  );
  const [tab, setTab] = _pwUseState("waiting");
  const [showAdd, setShowAdd] = _pwUseState(false);

  const lanes = _pwUseMemo(() => byLane(list), [list]);

  const updateOne = (id, patch) => setList(l => l.map(w => w.id === id ? { ...w, ...patch } : w));
  const handleAdd = (data) => {
    const nextId = `w-${String(list.length + 21).padStart(3, "0")}`;
    setList(l => [...l, { id: nextId, ...data, signedAt: NOW_HHMM, calledAt: null, seatedAt: null, doneAt: null, status: "waiting", tech: null }]);
  };
  const handleSeat = (id) => {
    const e = list.find(w => w.id === id);
    updateOne(id, { status: "serving", seatedAt: NOW_HHMM, tech: e.techPref || "linh" });
  };
  const handleComplete = (id) => updateOne(id, { status: "done", doneAt: NOW_HHMM });

  const est = estimatedWait(list);
  const TABS = [
    { id: "waiting", label: "Waiting",  n: lanes.waiting.length },
    { id: "serving", label: "In chair", n: lanes.serving.length },
    { id: "done",    label: "Done",     n: lanes.done.length + lanes["no-show"].length },
  ];
  const visible = tab === "done" ? [...lanes.done, ...lanes["no-show"]] : lanes[tab];

  return (
    <div className="wl-app" data-density="compact" style={{ position: "relative" }}>
      <div className="wl-phone-top">
        <div>
          <div className="title">Walk-in queue</div>
          <div className="sub">Tue · {lanes.waiting.length} waiting · ~{est}m est. wait</div>
        </div>
        <div className="wl-clock"><span className="dot" />{NOW_DISPLAY}</div>
      </div>
      <div className="wl-phone-tabs">
        {TABS.map(t => (
          <button key={t.id} className={"wl-phone-tab" + (tab === t.id ? " active" : "")} onClick={() => setTab(t.id)}>
            {t.label}<span className="n">{t.n}</span>
          </button>
        ))}
      </div>
      <div className="wl-phone-list">
        {visible.length === 0 ? (
          <div className="wl-empty">Nothing here yet.</div>
        ) : visible.map((w, i) => (
          <PhoneWaitlistCard key={w.id} entry={w} position={i + 1}
            onSeat={handleSeat} onComplete={handleComplete} />
        ))}
      </div>
      <button className="wl-fab" onClick={() => setShowAdd(true)} title="Add walk-in">
        <WI.Plus size={26} />
      </button>
      <PhoneAddSheet open={showAdd} onClose={() => setShowAdd(false)} onAdd={handleAdd} />
    </div>
  );
}

window.PhoneWaitlist = PhoneWaitlist;
