// StudioShell.jsx — Lacquer Studio app chrome (sidebar + topbar) for use
// inside a fixed-size artboard. Pure inline styles so it doesn't fight the
// design canvas's layout. Renders children into the main content area.

const Shell_Ico = (paths) => ({ size = 16, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...rest}>{paths}</svg>
);
const Shell_Calendar  = Shell_Ico(<><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></>);
const Shell_Users     = Shell_Ico(<><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></>);
const Shell_Sparkles  = Shell_Ico(<path d="M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5z"/>);
const Shell_Dollar    = Shell_Ico(<><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></>);
const Shell_Box       = Shell_Ico(<><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></>);
const Shell_Chart     = Shell_Ico(<><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></>);
const Shell_Settings  = Shell_Ico(<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82 2 2 0 11-2.83 2.83 1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33 2 2 0 11-2.83-2.83 1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82 2 2 0 112.83-2.83 1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33 2 2 0 112.83 2.83 1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/></>);
const Shell_Search    = Shell_Ico(<><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></>);
const Shell_Plus      = Shell_Ico(<path d="M12 5v14M5 12h14"/>);
const Shell_Bell      = Shell_Ico(<><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></>);
const Shell_Cake      = Shell_Ico(<><path d="M20 21v-8a2 2 0 00-2-2H6a2 2 0 00-2 2v8M4 16h16M10 8V5M12 8V3M14 8V5"/></>);

const SHELL_NAV = [
  { id: 'calendar', label: 'Schedule', icon: Shell_Calendar },
  { id: 'clients',  label: 'Clients',  icon: Shell_Users, count: 248 },
  { id: 'services', label: 'Services', icon: Shell_Sparkles, active: true },
  { id: 'checkout', label: 'Checkout', icon: Shell_Dollar },
];
const SHELL_OPS = [
  { id: 'inventory', label: 'Inventory',   icon: Shell_Box },
  { id: 'reports',   label: 'Day report',  icon: Shell_Chart },
  { id: 'settings',  label: 'Settings',    icon: Shell_Settings },
];

function ShellSidebar() {
  return (
    <aside style={{
      width: 200,
      background: 'var(--card)',
      borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      padding: '14px 10px',
      gap: 2, flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px 12px' }}>
        <img src="assets/lacquer-mark.svg" alt="" style={{ width: 20, height: 20 }} />
        <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.02em' }}>lacquer</span>
      </div>
      <ShellNavSection title="Workspace" items={SHELL_NAV} />
      <ShellNavSection title="Operations" items={SHELL_OPS} />
      <div style={{ flex: 1 }} />
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 8px', borderTop: '1px solid var(--border)', marginTop: 4,
      }}>
        <span style={{
          width: 26, height: 26, borderRadius: '50%',
          background: 'color-mix(in oklch, var(--primary) 15%, transparent)',
          color: 'var(--rose-700)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10.5, fontWeight: 600,
        }}>PR</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 500, lineHeight: 1.2 }}>Priya Raman</div>
          <div style={{ fontSize: 10.5, color: 'var(--muted-foreground)', lineHeight: 1.2 }}>Owner</div>
        </div>
      </div>
    </aside>
  );
}

function ShellNavSection({ title, items }) {
  return (
    <>
      <div style={{
        fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.07em',
        color: 'var(--muted-foreground)', padding: '12px 8px 4px', fontWeight: 600,
      }}>{title}</div>
      {items.map(item => {
        const Icon = item.icon;
        return (
          <div key={item.id} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '6px 8px', borderRadius: 6,
            fontSize: 12.5,
            color: item.active ? 'var(--foreground)' : 'var(--foreground)',
            background: item.active ? 'var(--accent)' : 'transparent',
            fontWeight: item.active ? 500 : 400,
            cursor: 'pointer',
          }}>
            <Icon size={15} style={{
              color: item.active ? 'var(--foreground)' : 'var(--muted-foreground)',
              flex: 'none',
            }} />
            <span style={{ flex: 1, minWidth: 0 }}>{item.label}</span>
            {item.count != null && (
              <span className="tnum" style={{ fontSize: 10.5, color: 'var(--muted-foreground)', fontWeight: 500 }}>{item.count}</span>
            )}
          </div>
        );
      })}
    </>
  );
}

function ShellTopBar() {
  return (
    <header style={{
      height: 52, flexShrink: 0,
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '0 22px',
      borderBottom: '1px solid var(--border)',
      background: 'var(--card)',
    }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>Services</div>
      <div style={{
        flex: 1, maxWidth: 340, marginLeft: 18,
        display: 'inline-flex', alignItems: 'center', gap: 8,
        height: 32, padding: '0 12px',
        background: 'var(--background)',
        border: '1px solid var(--input)', borderRadius: 7,
      }}>
        <Shell_Search size={13} style={{ color: 'var(--muted-foreground)' }} />
        <span style={{ flex: 1, fontSize: 12.5, color: 'var(--muted-foreground)' }}>Search clients, services, or appointments…</span>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 9.5,
          color: 'var(--muted-foreground)',
          border: '1px solid var(--border)', borderRadius: 3, padding: '1px 4px',
          background: 'var(--card)',
        }}>⌘K</span>
      </div>
      <div style={{ flex: 1 }} />
      <button style={{
        width: 30, height: 30, borderRadius: 6, border: 'none',
        background: 'transparent', color: 'var(--foreground)',
        cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}><Shell_Bell size={15} /></button>
      <button style={{
        height: 30, padding: '0 12px', borderRadius: 6, border: 'none',
        background: 'var(--primary)', color: 'var(--primary-foreground)',
        cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5,
        fontSize: 12, fontWeight: 500, fontFamily: 'var(--font-sans)',
      }}>
        <Shell_Plus size={13} /> New booking
      </button>
    </header>
  );
}

function StudioShell({ children }) {
  return (
    <div style={{
      display: 'flex',
      width: '100%', height: '100%',
      background: 'var(--background)',
      color: 'var(--foreground)',
      fontFamily: 'var(--font-sans)',
      overflow: 'hidden',
    }}>
      <ShellSidebar />
      <div style={{
        flex: 1, minWidth: 0,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        <ShellTopBar />
        <main style={{ flex: 1, minHeight: 0, overflow: 'auto', background: 'var(--background)' }}>
          {children}
        </main>
      </div>
    </div>
  );
}

window.StudioShell = StudioShell;
