// TechPicker — avatar-row picker for assigning a nail tech (or several) to a sale.
// Two flavors:
//   <TechAvatarRow value=[ids] onChange size="md" multi /> — primary picker, "first row" up front
//   <TechChip techId /> — small inline chip used on cart rows for per-service overrides
// Avatars are circular initials with a tone-derived background (no images).

function _initials(name) {
  return name.split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
}
function _staffById(id) { return STAFF.find(s => s.id === id); }

function TechAvatar({ tech, size = 36, ring = false, dim = false, badge = null }) {
  if (!tech) return null;
  const bg = `oklch(0.86 0.045 ${tech.tone})`;
  const fg = `oklch(0.32 0.06 ${tech.tone})`;
  return (
    <div className="tx-tech-avatar" style={{
      width: size, height: size, borderRadius: 9999,
      background: bg, color: fg,
      fontSize: Math.round(size * 0.38), fontWeight: 600, letterSpacing: "0.01em",
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      flexShrink: 0,
      boxShadow: ring ? "0 0 0 2px var(--card), 0 0 0 4px var(--primary)" : "0 0 0 2px var(--card)",
      opacity: dim ? 0.5 : 1,
      position: "relative",
    }}>
      <span>{_initials(tech.full)}</span>
      {badge}
    </div>
  );
}

// Stack of overlapping avatars (used in cart rows + history feed)
function TechStack({ ids = [], size = 24, max = 3 }) {
  const visible = ids.slice(0, max);
  const overflow = ids.length - visible.length;
  return (
    <span style={{ display: "inline-flex", alignItems: "center" }}>
      {visible.map((id, i) => {
        const t = _staffById(id);
        if (!t) return null;
        return (
          <span key={id} style={{ marginLeft: i === 0 ? 0 : -Math.round(size * 0.35) }}>
            <TechAvatar tech={t} size={size} />
          </span>
        );
      })}
      {overflow > 0 && (
        <span className="tx-tech-overflow" style={{
          width: size, height: size, borderRadius: 9999,
          marginLeft: -Math.round(size * 0.35),
          background: "var(--neutral-200)", color: "var(--muted-foreground)",
          fontSize: Math.round(size * 0.40), fontWeight: 600,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 0 0 2px var(--card)",
        }}>+{overflow}</span>
      )}
    </span>
  );
}

// Primary picker — used on the new-transaction header row.
function TechAvatarRow({ value = [], onChange, size = 44, multi = true, label = "Nail tech" }) {
  const toggle = (id) => {
    if (!multi) return onChange([id]);
    if (value.includes(id)) return onChange(value.filter(v => v !== id));
    return onChange([...value, id]);
  };
  return (
    <div className="tx-tech-row">
      {label && (
        <div className="tx-tech-row-h">
          <span className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 500 }}>{label}</span>
          {multi && value.length > 1 && (
            <span className="muted tnum" style={{ fontSize: 11 }}>{value.length} assigned</span>
          )}
        </div>
      )}
      <div className="tx-tech-avatars">
        {STAFF.map(t => {
          const active = value.includes(t.id);
          return (
            <button key={t.id} type="button"
              className={"tx-tech-pick" + (active ? " active" : "")}
              onClick={() => toggle(t.id)}
              title={t.full}>
              <TechAvatar tech={t} size={size} ring={active} dim={value.length > 0 && !active && !multi} />
              <span className="nm">{t.full.split(" ")[0]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Compact chip used inline (e.g. on cart rows) — opens a popover override.
function TechChip({ techId, allTechIds = [], onChange, size = "sm" }) {
  const [open, setOpen] = useState(false);
  const t = techId ? _staffById(techId) : null;
  const choices = allTechIds.length > 0 ? allTechIds.filter(id => id) : STAFF.map(s => s.id);
  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <button type="button" className={"tx-tech-chip" + (size === "xs" ? " xs" : "")} onClick={() => setOpen(o => !o)}>
        {t ? <TechAvatar tech={t} size={size === "xs" ? 16 : 20} /> : <span className="ph" />}
        <span className="nm">{t ? t.full.split(" ")[0] : "Assign"}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 30 }} onClick={() => setOpen(false)} />
          <div className="tx-tech-pop">
            <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 500, padding: "4px 10px 6px" }}>Assigned tech</div>
            {choices.map(id => {
              const c = _staffById(id);
              if (!c) return null;
              const active = id === techId;
              return (
                <button key={id} type="button" className={"tx-tech-pop-row" + (active ? " active" : "")} onClick={() => { onChange(id); setOpen(false); }}>
                  <TechAvatar tech={c} size={22} />
                  <span>{c.full}</span>
                  {active && <TI.Check size={14} style={{ marginLeft: "auto", color: "var(--primary)" }} />}
                </button>
              );
            })}
            <div className="tx-tech-pop-sep" />
            <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 500, padding: "4px 10px 6px" }}>All techs</div>
            {STAFF.filter(s => !choices.includes(s.id)).map(c => (
              <button key={c.id} type="button" className="tx-tech-pop-row" onClick={() => { onChange(c.id); setOpen(false); }}>
                <TechAvatar tech={c} size={22} />
                <span>{c.full}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

Object.assign(window, { TechAvatar, TechStack, TechAvatarRow, TechChip });
