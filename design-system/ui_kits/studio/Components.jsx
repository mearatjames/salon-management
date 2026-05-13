// Shared primitives for Lacquer Studio
const { useState } = React;

// ---------- Lucide-style inline icons (1.5px stroke) ----------
const I = {};
const mkIcon = (paths) => ({ size = 16, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...rest}>{paths}</svg>
);
I.Calendar  = mkIcon(<><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></>);
I.Users     = mkIcon(<><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></>);
I.Sparkles  = mkIcon(<path d="M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5z"/>);
I.Dollar    = mkIcon(<><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></>);
I.Box       = mkIcon(<><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></>);
I.Chart     = mkIcon(<><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></>);
I.Settings  = mkIcon(<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></>);
I.Search    = mkIcon(<><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></>);
I.Plus      = mkIcon(<path d="M12 5v14M5 12h14"/>);
I.Bell      = mkIcon(<><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></>);
I.Chevron   = mkIcon(<path d="M9 18l6-6-6-6"/>);
I.More      = mkIcon(<><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></>);
I.Clock     = mkIcon(<><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></>);
I.Check     = mkIcon(<path d="M5 12l5 5L20 7"/>);
I.X         = mkIcon(<path d="M18 6L6 18M6 6l12 12"/>);
I.Phone     = mkIcon(<path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/>);
I.Mail      = mkIcon(<><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></>);
I.CreditCard= mkIcon(<><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></>);

// ---------- Components ----------
function Avatar({ initials, primary, size = 32, ...rest }) {
  return <span className={"avatar" + (primary ? " primary" : "")} style={{ width: size, height: size, fontSize: size <= 24 ? 10 : size >= 48 ? 16 : 11 }} {...rest}>{initials}</span>;
}

function Button({ variant = "primary", size, icon, children, ...rest }) {
  const cls = ["btn", `btn-${variant}`, size === "sm" && "btn-sm", !children && "btn-icon"].filter(Boolean).join(" ");
  return <button className={cls} {...rest}>{icon}{children}</button>;
}

function Input({ icon, ...rest }) {
  if (!icon) return <input className="input" {...rest} />;
  return <div className="input-wrap">{icon}<input className="input with-icon" {...rest} /></div>;
}

function Badge({ tone = "default", dot, children }) {
  const map = {
    default:    { bg: "var(--secondary)",                                          fg: "var(--secondary-foreground)", bd: "var(--border)" },
    primary:    { bg: "color-mix(in oklch, var(--primary) 15%, transparent)",      fg: "var(--rose-700)",             bd: "color-mix(in oklch, var(--primary) 30%, transparent)" },
    success:    { bg: "color-mix(in oklch, var(--success) 15%, transparent)",      fg: "oklch(0.42 0.13 150)" },
    warning:    { bg: "color-mix(in oklch, var(--warning) 18%, transparent)",      fg: "oklch(0.45 0.14 75)" },
    destructive:{ bg: "color-mix(in oklch, var(--destructive) 13%, transparent)",  fg: "var(--destructive)" },
    info:       { bg: "color-mix(in oklch, var(--info) 13%, transparent)",         fg: "oklch(0.42 0.13 240)" },
  }[tone];
  const dotColor = { success: "var(--success)", warning: "var(--warning)", destructive: "var(--destructive)", info: "var(--info)", primary: "var(--primary)" }[tone] || "var(--muted-foreground)";
  return <span className="badge" style={{ background: map.bg, color: map.fg, borderColor: map.bd || "transparent" }}>{dot && <span className="dot" style={{ background: dotColor }} />}{children}</span>;
}

function Sidebar({ active, onNavigate }) {
  const items = [
    { id: "calendar", label: "Schedule", icon: <I.Calendar /> },
    { id: "clients",  label: "Clients",  icon: <I.Users />, count: 248 },
    { id: "services", label: "Services", icon: <I.Sparkles /> },
    { id: "checkout", label: "Checkout", icon: <I.Dollar /> },
  ];
  const ops = [
    { id: "inventory", label: "Inventory", icon: <I.Box /> },
    { id: "reports",   label: "Reports",   icon: <I.Chart /> },
    { id: "settings",  label: "Settings",  icon: <I.Settings /> },
  ];
  const NavItem = ({ item }) => (
    <div className={"nav-item" + (active === item.id ? " active" : "")} onClick={() => onNavigate?.(item.id)}>
      {item.icon}<span>{item.label}</span>
      {item.count != null && <span className="count tnum">{item.count}</span>}
    </div>
  );
  return (
    <aside className="app-sidebar">
      <div className="brand"><img src="../../assets/lacquer-mark.svg" alt="" /><span className="brand-name">lacquer</span></div>
      <div className="nav-section">Workspace</div>
      {items.map(i => <NavItem key={i.id} item={i} />)}
      <div className="nav-section">Operations</div>
      {ops.map(i => <NavItem key={i.id} item={i} />)}
      <div style={{ flex: 1 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 8px", borderTop: "1px solid var(--border)" }}>
        <Avatar initials="PR" primary size={28} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 500, lineHeight: 1.2 }}>Priya Raman</div>
          <div style={{ fontSize: 11, color: "var(--muted-foreground)", lineHeight: 1.2 }}>Owner</div>
        </div>
      </div>
    </aside>
  );
}

function TopBar({ title }) {
  return (
    <header className="app-topbar">
      <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
      <div className="topbar-search" style={{ marginLeft: 24 }}>
        <Input icon={<I.Search />} placeholder="Search clients, services, or appointments…" />
        <span className="kbd-hint">⌘K</span>
      </div>
      <div className="topbar-spacer" />
      <Button variant="ghost" icon={<I.Bell />} aria-label="Notifications" />
      <Button variant="primary" size="sm" icon={<I.Plus />}>New booking</Button>
    </header>
  );
}

Object.assign(window, { I, Avatar, Button, Input, Badge, Sidebar, TopBar });
