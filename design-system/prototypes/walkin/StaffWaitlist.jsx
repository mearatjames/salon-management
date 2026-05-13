// StaffWaitlist — simplified front-desk view.
// Flow: Waiting → In chair → Done (crossed off). No "Called" step, no checkout.
// Two columns: quick-add form on the left, live queue on the right.

const { useState: _wlUseState, useMemo: _wlUseMemo } = React;

// ─── Icons (Lucide stroke 1.6) ─────────────────────────────────
const WI = {};
const _wi = (paths) => ({ size = 18, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...rest}>{paths}</svg>
);
WI.Plus     = _wi(<path d="M12 5v14M5 12h14"/>);
WI.Minus    = _wi(<path d="M5 12h14"/>);
WI.X        = _wi(<path d="M18 6L6 18M6 6l12 12"/>);
WI.Check    = _wi(<path d="M5 12l5 5L20 7"/>);
WI.Phone    = _wi(<path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.36 1.91.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0122 16.92z"/>);
WI.Chair    = _wi(<><path d="M6 19v2"/><path d="M18 19v2"/><path d="M5 19h14"/><path d="M5 14h14"/><path d="M5 14a2 2 0 01-2-2V5a2 2 0 014 0v7"/><path d="M19 14a2 2 0 002-2V5a2 2 0 00-4 0v7"/></>);
WI.More     = _wi(<><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="19" r="1.5"/></>);
WI.Edit     = _wi(<><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z"/></>);
WI.Clock    = _wi(<><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>);
WI.Trash    = _wi(<><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 01-2 2H9a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></>);
WI.UserPlus = _wi(<><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></>);
WI.ChevR    = _wi(<path d="M9 18l6-6-6-6"/>);
WI.ChevL    = _wi(<path d="M15 18l-6-6 6-6"/>);
WI.Users    = _wi(<><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></>);

// ─── Single waitlist card ──────────────────────────────────────
// Flow: waiting → serving (Seat button) → done (Done button)
function WaitlistCard({ entry, position, onSeat, onDone, onNoShow, onRemove, density = "regular" }) {
  const [menuOpen, setMenuOpen] = _wlUseState(false);
  const waitMin = minutesSince(entry.signedAt);
  const waitClass = waitMin >= 40 ? " very-long" : waitMin >= 25 ? " long" : "";
  const prefTech = entry.techPref ? STAFF.find(s => s.id === entry.techPref) : null;
  const assignedTech = entry.tech ? STAFF.find(s => s.id === entry.tech) : null;

  return (
    <div className={"wl-card " + entry.status}>
      {/* Position / avatar */}
      <div className="pos">
        {(entry.status === "done" || entry.status === "no-show")
          ? (assignedTech ? <TechAvatar tech={assignedTech} size={32} /> : "—")
          : entry.status === "serving" && assignedTech
            ? <TechAvatar tech={assignedTech} size={32} />
            : position}
      </div>

      {/* Main content */}
      <div className="wl-card-main">
        <div className="wl-card-name">
          <span>{entry.name}</span>
          {entry.party > 1 && (
            <span className="party"><WI.Users size={10} />party of {entry.party}</span>
          )}
          {entry.phone && <span className="wl-card-phone">· {entry.phone}</span>}
        </div>

        <div className="wl-card-svcs">
          {entry.services.map(id => (
            <span key={id} className="wl-svc-tag">
              {svcName(id)}<span className="px">· {svcPriceLabel(id)}</span>
            </span>
          ))}
        </div>

        <div className="wl-card-meta">
          <span className="tnum">Signed in {fmtTimeShort(entry.signedAt)}</span>

          {entry.status === "waiting" && (
            <>
              <span className="sep">·</span>
              <span className={"wl-wait" + waitClass}><WI.Clock size={10} /> {fmtDur(waitMin)} waiting</span>
            </>
          )}

          {entry.status === "serving" && entry.seatedAt && (
            <>
              <span className="sep">·</span>
              <span className="tnum">Seated {fmtTimeShort(entry.seatedAt)}</span>
            </>
          )}

          {entry.status === "done" && entry.doneAt && (
            <>
              <span className="sep">·</span>
              <span className="tnum">Done {fmtTimeShort(entry.doneAt)}</span>
            </>
          )}

          {entry.status === "no-show" && (
            <>
              <span className="sep">·</span>
              <span style={{ color: "var(--destructive)", fontWeight: 500 }}>No-show</span>
            </>
          )}

          {prefTech && entry.status === "waiting" && (
            <>
              <span className="sep">·</span>
              <span className="pref-tech"><TechAvatar tech={prefTech} size={16} />wants {prefTech.full.split(" ")[0]}</span>
            </>
          )}
          {!prefTech && entry.status === "waiting" && (
            <>
              <span className="sep">·</span>
              <span>Any tech</span>
            </>
          )}

          <span className="sep">·</span>
          <span className="tnum">~{entryEstMinutes(entry)}m</span>
        </div>

        {entry.note && <div className="wl-card-note">{entry.note}</div>}
      </div>

      {/* Actions */}
      <div className="wl-card-actions">
        {entry.status === "waiting" && (
          <button className="wl-act primary" onClick={() => onSeat(entry.id)}>
            <WI.Chair size={13} /> Seat
          </button>
        )}

        {entry.status === "serving" && (
          <button className="wl-act success" onClick={() => onDone(entry.id)}>
            <WI.Check size={13} /> Done
          </button>
        )}

        {(entry.status === "done" || entry.status === "no-show") && (
          <span className="muted" style={{ fontSize: 11 }}>
            {assignedTech ? `→ ${assignedTech.full.split(" ")[0]}` : ""}
          </span>
        )}

        {/* ··· menu */}
        {entry.status !== "done" && entry.status !== "no-show" && (
          <button className="wl-act icon" onClick={() => setMenuOpen(o => !o)}>
            <WI.More size={14} />
          </button>
        )}
        {menuOpen && (
          <>
            <div style={{ position: "fixed", inset: 0, zIndex: 19 }} onClick={() => setMenuOpen(false)} />
            <div className="wl-menu" onClick={e => e.stopPropagation()}>
              <button onClick={() => setMenuOpen(false)}><WI.Edit size={14} /> Edit details</button>
              {entry.status === "waiting" && (
                <>
                  <hr />
                  <button className="danger" onClick={() => { onNoShow(entry.id); setMenuOpen(false); }}>
                    <WI.X size={14} /> Mark no-show
                  </button>
                </>
              )}
              <button className="danger" onClick={() => { onRemove(entry.id); setMenuOpen(false); }}>
                <WI.Trash size={14} /> Remove from list
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Quick-add form ────────────────────────────────────────────
const POPULAR_SVCS = [
  "classic-mani", "manicure-gel", "classic-pedi", "deluxe-pedi",
  "gel-polish-change-natural", "polish-change-natural",
  "acrylic-fullset-gel", "acrylic-fills-gel",
  "gelx-fullset", "dipping-powder",
  "removal-gel", "addon-french-tips", "addon-designs",
];

function QuickAddForm({ onAdd }) {
  const [name, setName] = _wlUseState("");
  const [phone, setPhone] = _wlUseState("");
  const [party, setParty] = _wlUseState(1);
  const [services, setServices] = _wlUseState([]);
  const [techPref, setTechPref] = _wlUseState(null);
  const [note, setNote] = _wlUseState("");
  const [showAll, setShowAll] = _wlUseState(false);

  const toggleSvc = id => setServices(p => p.includes(id) ? p.filter(s => s !== id) : [...p, id]);
  const reset = () => { setName(""); setPhone(""); setParty(1); setServices([]); setTechPref(null); setNote(""); setShowAll(false); };
  const submit = () => {
    if (!name.trim() || services.length === 0) return;
    onAdd({ name: name.trim(), phone: phone.trim() || null, party, services, techPref, note: note.trim() || null });
    reset();
  };

  const visible = showAll ? SERVICES : SERVICES.filter(s => POPULAR_SVCS.includes(s.id));
  const canSubmit = name.trim().length > 0 && services.length > 0;

  return (
    <div className="wl-form">
      <div>
        <h2>Add walk-in</h2>
        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>Sign them in — they'll appear at the bottom of the queue.</div>
      </div>

      <div className="grp">
        <label>Name</label>
        <input className="wl-input" placeholder="First name or 'Walk-in'" value={name} onChange={e => setName(e.target.value)} />
      </div>

      <div className="wl-row cols-2">
        <div className="grp">
          <label>Phone</label>
          <input className="wl-input" placeholder="Optional" value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" />
        </div>
        <div className="grp">
          <label>Party size</label>
          <div className="wl-stepper">
            <button type="button" onClick={() => setParty(p => Math.max(1, p - 1))}><WI.Minus size={14} /></button>
            <span className="val">{party}</span>
            <button type="button" onClick={() => setParty(p => Math.min(8, p + 1))}><WI.Plus size={14} /></button>
          </div>
        </div>
      </div>

      <div className="grp">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <label>Services {services.length > 0 && <span style={{ marginLeft: 4, color: "var(--rose-700)" }}>· {services.length} picked</span>}</label>
          <button type="button" className="tx-link" style={{ fontSize: 11, padding: 0 }} onClick={() => setShowAll(s => !s)}>
            {showAll ? "Popular only" : "All services"}
          </button>
        </div>
        <div className="wl-svc-chips">
          {visible.map(s => (
            <button key={s.id} type="button"
              className={"wl-svc-chip" + (services.includes(s.id) ? " active" : "")}
              onClick={() => toggleSvc(s.id)}>
              {s.name}
              {services.includes(s.id) && <WI.X size={11} className="x" />}
            </button>
          ))}
        </div>
      </div>

      <div className="grp">
        <label>Preferred tech</label>
        <div className="wl-tech-pref">
          <button type="button" className={"wl-tech-pref-pill any" + (techPref === null ? " active" : "")} onClick={() => setTechPref(null)}>
            Any available
          </button>
          {STAFF.slice(0, 8).map(t => (
            <button key={t.id} type="button"
              className={"wl-tech-pref-pill" + (techPref === t.id ? " active" : "")}
              onClick={() => setTechPref(techPref === t.id ? null : t.id)}>
              <TechAvatar tech={t} size={20} />
              {t.full.split(" ")[0]}
            </button>
          ))}
        </div>
      </div>

      <div className="grp">
        <label>Notes</label>
        <textarea className="wl-textarea" placeholder="Allergies, design refs, kid in tow…" value={note} onChange={e => setNote(e.target.value)} />
      </div>

      <button className="tx-btn full" disabled={!canSubmit} onClick={submit}>
        <WI.UserPlus size={16} /> Add to waitlist
      </button>
    </div>
  );
}

// ─── Lane wrapper ──────────────────────────────────────────────
function Lane({ id, title, entries, children }) {
  return (
    <div className={"wl-lane " + id}>
      <div className="wl-lane-h">
        <span>{title}</span>
        <span className="count">{entries.length}</span>
      </div>
      <div className="wl-lane-list">{children}</div>
    </div>
  );
}

// ─── Main staff view ───────────────────────────────────────────
function StaffWaitlist({ density = "regular" }) {
  const [list, setList] = _wlUseState(() =>
    // Collapse any existing "called" entries back to "waiting" — the step no longer exists
    WAITLIST.map(w => ({ ...w, status: w.status === "called" ? "waiting" : w.status }))
  );
  const [filter, setFilter] = _wlUseState("active");

  const lanes = _wlUseMemo(() => byLane(list), [list]);
  const est   = _wlUseMemo(() => estimatedWait(list), [list]);

  const updateOne = (id, patch) => setList(l => l.map(w => w.id === id ? { ...w, ...patch } : w));

  const handleAdd  = (data) => {
    const nextId = `w-${String(list.length + 21).padStart(3, "0")}`;
    setList(l => [...l, {
      id: nextId, ...data,
      signedAt: NOW_HHMM, seatedAt: null, doneAt: null,
      status: "waiting", tech: null,
    }]);
  };
  const handleSeat   = (id) => {
    const entry = list.find(w => w.id === id);
    updateOne(id, { status: "serving", seatedAt: NOW_HHMM, tech: entry.techPref || "linh" });
  };
  const handleDone   = (id) => updateOne(id, { status: "done",    doneAt: NOW_HHMM });
  const handleNoShow = (id) => updateOne(id, { status: "no-show", doneAt: NOW_HHMM });
  const handleRemove = (id) => setList(l => l.filter(w => w.id !== id));

  const source = filter === "active"
    ? list.filter(w => w.status === "waiting" || w.status === "serving")
    : list;
  const vis = byLane(source);

  return (
    <div className="wl-app" data-density={density}>
      {/* ── Top bar ── */}
      <div className="wl-top">
        <div>
          <div className="eyebrow">Lacquer Studio · Front desk</div>
          <h1>Walk-in waitlist</h1>
          <div className="sub">Tuesday, May 12 · {STAFF.length} techs on shift</div>
        </div>
        <div className="wl-top-right">
          <div className="wl-clock"><span className="dot" />{NOW_DISPLAY}</div>
          <button className="tx-btn secondary" style={{ height: 40, padding: "0 14px" }}>
            <WI.Phone size={14} /> Kiosk mode
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="wl-body">
        <QuickAddForm onAdd={handleAdd} />

        <div className="wl-list-col">
          {/* List header */}
          <div className="wl-list-h">
            <div className="left">
              <div>
                <div className="eyebrow">Queue</div>
                <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em", marginTop: 2 }}>
                  <span className="tnum">{lanes.waiting.length}</span> waiting
                  <span className="muted" style={{ fontWeight: 400, fontSize: 13, marginLeft: 8 }}>
                    · {lanes.serving.length} in chair
                  </span>
                </div>
              </div>
              <div className="est">
                <WI.Clock size={12} />
                Est. wait <span className="v">{est}m</span>
              </div>
            </div>
            <div className="filter">
              {[{ id: "active", label: "Active" }, { id: "all", label: "All today" }].map(o => (
                <button key={o.id} className={filter === o.id ? "active" : ""} onClick={() => setFilter(o.id)}>{o.label}</button>
              ))}
            </div>
          </div>

          {/* Lanes */}
          <div className="wl-list-scroll">

            {/* Waiting */}
            <Lane id="waiting" title="Waiting" entries={vis.waiting}>
              {vis.waiting.length === 0
                ? <div className="wl-empty">No one waiting — the desk is clear.</div>
                : vis.waiting.map((w, i) => (
                  <WaitlistCard key={w.id} entry={w} position={i + 1} density={density}
                    onSeat={handleSeat} onDone={handleDone}
                    onNoShow={handleNoShow} onRemove={handleRemove} />
                ))
              }
            </Lane>

            {/* In chair */}
            {vis.serving.length > 0 && (
              <Lane id="serving" title="In chair" entries={vis.serving}>
                {vis.serving.map(w => (
                  <WaitlistCard key={w.id} entry={w} position="·" density={density}
                    onSeat={handleSeat} onDone={handleDone}
                    onNoShow={handleNoShow} onRemove={handleRemove} />
                ))}
              </Lane>
            )}

            {/* Earlier today — only when "All today" is active */}
            {filter === "all" && (lanes.done.length + lanes["no-show"].length) > 0 && (
              <Lane id="done" title="Earlier today" entries={[...lanes.done, ...lanes["no-show"]]}>
                {[...lanes.done, ...lanes["no-show"]].slice(0, 10).map(w => (
                  <WaitlistCard key={w.id} entry={w} position="·" density={density}
                    onSeat={handleSeat} onDone={handleDone}
                    onNoShow={handleNoShow} onRemove={handleRemove} />
                ))}
              </Lane>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { StaffWaitlist, WaitlistCard, QuickAddForm, WI });
