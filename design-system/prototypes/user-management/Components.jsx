// Components.jsx — shared Lacquer Studio primitives for User Management prototype

// ── Icon factory (Lucide-style, 1.5px stroke) ──────────────────────────────
const mkIcon = (paths) => ({ size = 16, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...rest}>
    {paths}
  </svg>
);

const UM = {};
UM.Calendar    = mkIcon(<><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></>);
UM.Users       = mkIcon(<><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></>);
UM.Sparkles    = mkIcon(<path d="M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5z"/>);
UM.Dollar      = mkIcon(<><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></>);
UM.Box         = mkIcon(<><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></>);
UM.Chart       = mkIcon(<><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></>);
UM.Settings    = mkIcon(<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.6 9a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9z"/></>);
UM.Plus        = mkIcon(<path d="M12 5v14M5 12h14"/>);
UM.X           = mkIcon(<path d="M18 6L6 18M6 6l12 12"/>);
UM.Check       = mkIcon(<path d="M5 12l5 5L20 7"/>);
UM.Search      = mkIcon(<><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></>);
UM.Key         = mkIcon(<><circle cx="7.5" cy="15.5" r="5.5"/><path d="M21 2l-9.6 9.6M15.5 7.5l3 3M17 6l2 2"/></>);
UM.Shield      = mkIcon(<><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></>);
UM.Trash       = mkIcon(<><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></>);
UM.UserMinus   = mkIcon(<><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="23" y1="11" x2="17" y2="11"/></>);
UM.UserX       = mkIcon(<><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="18" y1="8" x2="23" y2="13"/><line x1="23" y1="8" x2="18" y2="13"/></>);
UM.ChevronRight= mkIcon(<path d="M9 18l6-6-6-6"/>);
UM.MoreHoriz   = mkIcon(<><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>);
UM.Bell        = mkIcon(<><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></>);
UM.CreditCard  = mkIcon(<><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></>);
UM.Building    = mkIcon(<><rect x="2" y="3" width="20" height="18" rx="1"/><path d="M8 21V8m8 13V8M2 12h20"/></>);
UM.EyeOff      = mkIcon(<><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></>);
UM.Backspace   = mkIcon(<><path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/></>);
UM.AlertCircle = mkIcon(<><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></>);
UM.Pencil      = mkIcon(<><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></>);
UM.Home        = mkIcon(<><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></>);
UM.Cash        = mkIcon(<><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 12h.01M18 12h.01"/></>);
UM.FileBar     = mkIcon(<><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/><line x1="10" y1="9" x2="14" y2="9"/></>);
UM.Footprints  = mkIcon(<><path d="M8 3.5c0 .83-.67 1.5-1.5 1.5S5 4.33 5 3.5 5.67 2 6.5 2 8 2.67 8 3.5z"/><path d="M5 8l1.5 4h3L11 8"/><path d="M16 3.5c0 .83.67 1.5 1.5 1.5S19 4.33 19 3.5 18.33 2 17.5 2 16 2.67 16 3.5z"/><path d="M19 8l-1.5 4h-3L13 8"/><path d="M8.5 14l.5 3H7l-1.5-3h3z"/><path d="M15.5 14l-.5 3H17l1.5-3h-3z"/></>);

// ── Helper functions ───────────────────────────────────────────────────────
function getInitials(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getRoleLabel(role) {
  const map = { owner: 'Owner', manager: 'Manager', technician: 'Tech', front_desk: 'Front desk' };
  return map[role] || role;
}

// ── Staff avatar (color-tinted circle) ─────────────────────────────────────
function StaffAv({ name, color, size = 32 }) {
  const bg = `color-mix(in oklch, ${color} 18%, transparent)`;
  return (
    <div className="staff-av" style={{ width: size, height: size, background: bg, color, fontSize: size <= 24 ? 10 : 11 }}>
      {getInitials(name)}
    </div>
  );
}

// ── Badge ─────────────────────────────────────────────────────────────────
function UMBadge({ tone = 'default', children }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

// ── Toggle switch ─────────────────────────────────────────────────────────
function UMToggle({ checked, onChange }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className="toggle-track" />
      <span className="toggle-thumb" />
    </label>
  );
}

// Chevron icons for sidebar toggle
const ChevronLeft  = mkIcon(<path d="M15 18l-6-6 6-6"/>);
const ChevronRight = mkIcon(<path d="M9 18l6-6-6-6"/>);
const MenuIcon     = mkIcon(<><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></>);

// ── App Sidebar ───────────────────────────────────────────────────────────
function UMSidebar() {
  const [collapsed, setCollapsed] = React.useState(() => {
    try { return localStorage.getItem('um-sidebar-collapsed') === '1'; } catch { return false; }
  });

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem('um-sidebar-collapsed', next ? '1' : '0'); } catch {}
    // sync grid on parent
    const app = document.querySelector('.app');
    if (app) app.classList.toggle('sidebar-collapsed', next);
  }

  // Sync class on mount
  React.useEffect(() => {
    const app = document.querySelector('.app');
    if (app) app.classList.toggle('sidebar-collapsed', collapsed);
  }, []);

  const workspace = [
    { id: 'calendar', label: 'Schedule',  icon: <UM.Calendar /> },
    { id: 'clients',  label: 'Clients',   icon: <UM.Users />, count: 248 },
    { id: 'services', label: 'Services',  icon: <UM.Sparkles /> },
    { id: 'checkout', label: 'Checkout',  icon: <UM.Dollar />,     href: '../transaction/Transaction Flows.html' },
    { id: 'walkin',   label: 'Walk-in',   icon: <UM.Footprints />, href: '../walkin/Quick Walk-in.html' },
  ];
  const ops = [
    { id: 'eod',      label: 'End of Day Cash', icon: <UM.Cash />,    href: '../transaction/End of Day Cash.html' },
    { id: 'report',   label: 'Day Report',       icon: <UM.FileBar />, href: '../transaction/Day Report.html' },
    { id: 'settings', label: 'Settings',         icon: <UM.Settings />, active: true },
  ];

  const tip = (label) => collapsed ? { title: label } : {};

  function NavItem({ item }) {
    const cls = `nav-item${item.active ? ' active' : ''}`;
    const inner = <>
      {item.icon}
      <span>{item.label}</span>
      {item.count != null && <span className="nav-count">{item.count}</span>}
    </>;
    return item.href
      ? <a className={cls} href={item.href} {...tip(item.label)}>{inner}</a>
      : <div className={cls} {...tip(item.label)}>{inner}</div>;
  }

  return (
    <aside className={`app-sidebar${collapsed ? ' collapsed' : ''}`}>
      {/* Sidebar toggle */}
      <div className="brand">
        <button className="sidebar-toggle" type="button" onClick={toggle} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
        </button>
      </div>

      {/* Back to Dashboard */}
      <a className="nav-item nav-home" href="../transaction/Transaction Flows.html" {...tip('Dashboard')}>
        <UM.Home />
        <span>Dashboard</span>
      </a>
      <div style={{ width: '100%', height: 1, background: 'var(--border)', margin: '6px 0', flexShrink: 0 }} />

      {!collapsed && <div className="nav-section">Workspace</div>}
      {workspace.map(i => <NavItem key={i.id} item={i} />)}

      {collapsed
        ? <div style={{ width: 32, height: 1, background: 'var(--border)', margin: '6px 0', flexShrink: 0 }} />
        : <div className="nav-section">Operations</div>
      }
      {ops.map(i => <NavItem key={i.id} item={i} />)}

      <div style={{ flex: 1 }} />

      {/* User chip at bottom */}
      <div className="sidebar-user" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 8px', borderTop: '1px solid var(--border)', width: '100%' }} {...tip('Priya Raman · Owner')}>
        <StaffAv name="Priya Raman" color="oklch(0.55 0.12 12)" size={26} />
        <div className="sidebar-user-text" style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 500, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Priya Raman</div>
          <div style={{ fontSize: 11, color: 'var(--muted-foreground)', lineHeight: 1.2 }}>Owner</div>
        </div>
      </div>
    </aside>
  );
}

// ── Top Bar ───────────────────────────────────────────────────────────────
function UMTopBar() {
  return (
    <header className="app-topbar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <UM.Sparkles size={17} style={{ color: 'var(--primary)' }} />
        <span style={{ fontWeight: 600, fontSize: 14 }}>Tang Nails Studio</span>
      </div>
      <div className="topbar-spacer" />
      <div className="op-chip">
        <StaffAv name="Priya Raman" color="oklch(0.55 0.12 12)" size={24} />
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, lineHeight: 1 }}>Priya Raman</div>
          <div style={{ fontSize: 10, color: 'var(--muted-foreground)', marginTop: 2 }}>Owner</div>
        </div>
      </div>
    </header>
  );
}

Object.assign(window, { UM, getInitials, getRoleLabel, StaffAv, UMBadge, UMToggle, UMSidebar, UMTopBar });
