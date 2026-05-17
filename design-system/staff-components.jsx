// staff-components.jsx — Settings → Staff page components
// Loaded by Staff Settings.html via <script type="text/babel" src="...">.
// Requires: React (global), tweaks-panel.jsx (loaded first → TweaksPanel, useTweaks etc. on window).

const { useState, useEffect, useMemo } = React;

/* ─── SVG icon factory ──────────────────────────────────────────────────────── */
function SvgIcon({ size = 16, children }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" style={{ flexShrink: 0 }}>
      {children}
    </svg>
  );
}

function SearchIcon({ size = 16 }) {
  return <SvgIcon size={size}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></SvgIcon>;
}
function ShieldCheckIcon({ size = 16 }) {
  return <SvgIcon size={size}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" /></SvgIcon>;
}
function KeyRoundIcon({ size = 16 }) {
  return <SvgIcon size={size}><circle cx="7.5" cy="15.5" r="5.5" /><path d="m21 2-9.6 9.6" /><path d="m15.5 7.5 3 3L22 7l-3-3" /></SvgIcon>;
}
function ChevronRightIcon({ size = 16 }) {
  return <SvgIcon size={size}><polyline points="9 18 15 12 9 6" /></SvgIcon>;
}
function XIcon({ size = 16 }) {
  return <SvgIcon size={size}><path d="M18 6L6 18M6 6l12 12" /></SvgIcon>;
}
function PlusIcon({ size = 16 }) {
  return <SvgIcon size={size}><path d="M12 5v14M5 12h14" /></SvgIcon>;
}
function PowerOffIcon({ size = 16 }) {
  return <SvgIcon size={size}><path d="M18.36 6.64A9 9 0 1 1 5.64 5.64" /><path d="M12 2v8" /></SvgIcon>;
}
function TrashIcon({ size = 16 }) {
  return <SvgIcon size={size}><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M9 6V4h6v2" /></SvgIcon>;
}
function PowerIcon({ size = 16 }) {
  return <SvgIcon size={size}><path d="M18.36 6.64a9 9 0 1 1-12.73 0" /><line x1="12" y1="2" x2="12" y2="12" /></SvgIcon>;
}
function UsersIcon({ size = 40 }) {
  return (
    <SvgIcon size={size}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </SvgIcon>
  );
}
function CheckIcon({ size = 16 }) {
  return <SvgIcon size={size}><polyline points="20 6 9 17 4 12" /></SvgIcon>;
}

/* ─── Mock roster ────────────────────────────────────────────────────────────── */
const ROSTER = [
  { id: '1', display_name: 'Maya Chen',    role: 'owner',      color_token: '--avatar-rose',   active: true,  pin_set: true,  created_at: '2023-03-15T00:00:00Z' },
  { id: '2', display_name: 'Jordan Kim',   role: 'manager',    color_token: '--avatar-blue',   active: true,  pin_set: true,  created_at: '2023-05-02T00:00:00Z' },
  { id: '3', display_name: 'Priya Nair',   role: 'technician', color_token: '--avatar-green',  active: true,  pin_set: false, created_at: '2023-06-18T00:00:00Z' },
  { id: '4', display_name: 'Tom Wu',       role: 'technician', color_token: '--avatar-amber',  active: true,  pin_set: true,  created_at: '2023-08-09T00:00:00Z' },
  { id: '5', display_name: 'Alexa Torres', role: 'front_desk', color_token: '--avatar-teal',   active: true,  pin_set: true,  created_at: '2024-01-20T00:00:00Z' },
  { id: '6', display_name: 'Marcus Lee',   role: 'technician', color_token: '--avatar-purple', active: false, pin_set: true,  created_at: '2023-11-01T00:00:00Z' },
  { id: '7', display_name: 'Sasha Tan',    role: 'technician', color_token: '--avatar-orange', active: true,  pin_set: true,  created_at: '2024-02-14T00:00:00Z' },
];

const COLOR_OPTIONS = [
  { token: '--avatar-rose',   label: 'Rose'   },
  { token: '--avatar-blue',   label: 'Blue'   },
  { token: '--avatar-green',  label: 'Green'  },
  { token: '--avatar-amber',  label: 'Amber'  },
  { token: '--avatar-purple', label: 'Purple' },
  { token: '--avatar-teal',   label: 'Teal'   },
  { token: '--avatar-orange', label: 'Orange' },
  { token: '--avatar-slate',  label: 'Slate'  },
];

const ROLE_LABEL = {
  owner:      'Owner',
  manager:    'Manager',
  technician: 'Tech',
  front_desk: 'Front desk',
};

const ROLE_OPTIONS = ['owner', 'manager', 'technician', 'front_desk'];

const TABS = [
  { id: 'general',       label: 'General'       },
  { id: 'staff',         label: 'Staff'         },
  { id: 'notifications', label: 'Notifications' },
  { id: 'billing',       label: 'Billing'       },
];

/* ─── Utilities ─────────────────────────────────────────────────────────────── */
function initials(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function formatDate(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return `Added ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/* ─── StaffAvatar ────────────────────────────────────────────────────────────── */
function StaffAvatar({ name, colorToken, size = 40 }) {
  return (
    <span aria-hidden="true" style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0, width: size, height: size, borderRadius: 9999,
      background: `oklch(from var(${colorToken}) l c h / 0.15)`,
      color: `var(${colorToken})`,
      fontWeight: 600, fontSize: Math.round(size * 0.38),
      letterSpacing: '0.04em', userSelect: 'none',
    }}>
      {initials(name)}
    </span>
  );
}

/* ─── Badge ──────────────────────────────────────────────────────────────────── */
const BADGE_VARS = {
  muted:   { bg: 'oklch(from var(--muted-foreground) l c h / 0.14)', fg: 'var(--muted-foreground)' },
  success: { bg: 'oklch(from var(--success) l c h / 0.14)',          fg: 'var(--success)'          },
  warning: { bg: 'oklch(from var(--warning) l c h / 0.14)',          fg: 'var(--warning)'          },
};

function Badge({ children, variant = 'muted' }) {
  const v = BADGE_VARS[variant] || BADGE_VARS.muted;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      padding: '2px 7px', borderRadius: 9999,
      background: v.bg, color: v.fg,
      fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap', lineHeight: 1,
    }}>
      {children}
    </span>
  );
}

/* ─── Toggle ─────────────────────────────────────────────────────────────────── */
function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      style={{
        position: 'relative', width: 36, height: 20, border: 'none',
        background: checked ? 'var(--primary)' : 'var(--border)',
        borderRadius: 9999, cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'background 150ms var(--ease-out)',
        flexShrink: 0, opacity: disabled ? 0.5 : 1,
      }}
    >
      <span style={{
        position: 'absolute', top: 2,
        left: checked ? 18 : 2,
        width: 16, height: 16, borderRadius: '50%',
        background: 'white', boxShadow: '0 1px 3px rgb(0 0 0 / .2)',
        transition: 'left 150ms var(--ease-out)',
      }} />
    </button>
  );
}

/* ─── ColorPicker ────────────────────────────────────────────────────────────── */
function ColorPicker({ value, onChange, disabled }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
      {COLOR_OPTIONS.map(opt => {
        const sel = opt.token === value;
        return (
          <button key={opt.token} title={opt.label} aria-label={opt.label} aria-pressed={sel}
            onClick={() => !disabled && onChange(opt.token)}
            style={{
              width: 26, height: 26, borderRadius: '50%', border: 'none',
              background: `var(${opt.token})`,
              cursor: disabled ? 'not-allowed' : 'pointer',
              boxShadow: sel ? `0 0 0 2px var(--background), 0 0 0 4px var(${opt.token})` : 'none',
              transition: 'box-shadow 150ms var(--ease-out)',
              opacity: disabled ? 0.5 : 1,
            }}
          />
        );
      })}
    </div>
  );
}

/* ─── TabBar ─────────────────────────────────────────────────────────────────── */
function TabBar({ active, onChange }) {
  return (
    <nav className="tab-bar" aria-label="Settings sections">
      {TABS.map(tab => (
        <button key={tab.id} onClick={() => onChange(tab.id)}
          className={'tab-item' + (active === tab.id ? ' tab-item--active' : '')}
          aria-current={active === tab.id ? 'page' : undefined}>
          {tab.label}
        </button>
      ))}
    </nav>
  );
}

/* ─── PageHeader ─────────────────────────────────────────────────────────────── */
function PageHeader({ onAddStaff }) {
  return (
    <header className="page-header">
      <div>
        <h2 style={{ margin: 0, fontSize: 'var(--text-2xl)', fontWeight: 600, letterSpacing: 'var(--tracking-snug)', color: 'var(--foreground)', lineHeight: 'var(--leading-tight)' }}>
          Staff
        </h2>
        <p style={{ margin: 0, marginTop: 3, fontSize: 'var(--text-sm)', color: 'var(--muted-foreground)', lineHeight: 'var(--leading-snug)' }}>
          Manage who can log in to the studio and what they can do.
        </p>
      </div>
      <button className="btn-add" onClick={onAddStaff}>
        <PlusIcon size={14} />
        Add staff
      </button>
    </header>
  );
}

/* ─── ControlsBar ────────────────────────────────────────────────────────────── */
function ControlsBar({ search, onSearch, filter, onFilter, activeCount, totalCount }) {
  const inactiveCount = totalCount - activeCount;
  const chips = [
    { id: 'all',      label: 'All',      count: totalCount     },
    { id: 'active',   label: 'Active',   count: activeCount    },
    { id: 'inactive', label: 'Inactive', count: inactiveCount  },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label className="search-wrap">
        <SearchIcon size={14} />
        <input
          type="search" placeholder="Search staff" value={search}
          onChange={e => onSearch(e.target.value)}
          className="search-input" aria-label="Search staff"
        />
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} role="group" aria-label="Filter by status">
        {chips.map(c => (
          <button key={c.id} onClick={() => onFilter(c.id)} aria-pressed={filter === c.id}
            className={'filter-chip' + (filter === c.id ? ' filter-chip--active' : '')}>
            {c.label}
            <span className="chip-count">{c.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─── StaffRow ───────────────────────────────────────────────────────────────── */
function StaffRow({ staff, isSelected, onClick }) {
  return (
    <div role="button" tabIndex={0} onClick={onClick}
      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onClick()}
      className="staff-row"
      data-selected={isSelected ? 'true' : 'false'}
      data-active={staff.active ? 'true' : 'false'}
      aria-pressed={isSelected}>

      {isSelected && <div className="row-sel-bar" />}

      <div className={'status-dot' + (staff.active ? ' status-dot--on' : ' status-dot--off')} />

      <StaffAvatar name={staff.display_name} colorToken={staff.color_token} size={36} />

      <div className="row-main">
        <span className="row-name">{staff.display_name}</span>
        <div className="row-sub">
          <Badge variant="muted">{ROLE_LABEL[staff.role]}</Badge>
          {!staff.pin_set && (
            <span className="pin-warn">
              <KeyRoundIcon size={11} /> No PIN
            </span>
          )}
        </div>
      </div>

      {/* Desktop trailing */}
      <div className="row-trailing">
        {staff.pin_set
          ? <span className="pin-chip pin-chip--set"><ShieldCheckIcon size={11} /> Set</span>
          : <span className="pin-chip pin-chip--unset"><KeyRoundIcon size={11} /> No PIN</span>
        }
        <span className="row-date">{formatDate(staff.created_at)}</span>
      </div>

      {/* Mobile-only chevron */}
      <span className="row-chevron"><ChevronRightIcon size={16} /></span>
    </div>
  );
}

/* ─── StaffList ──────────────────────────────────────────────────────────────── */
function StaffList({ roster, filter, search, selectedId, onSelect }) {
  const visible = useMemo(() => {
    let r = roster;
    if (filter === 'active')   r = r.filter(s => s.active);
    if (filter === 'inactive') r = r.filter(s => !s.active);
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter(s =>
        s.display_name.toLowerCase().includes(q) ||
        ROLE_LABEL[s.role].toLowerCase().includes(q)
      );
    }
    return r;
  }, [roster, filter, search]);

  return (
    <div className="staff-list" role="list" aria-label="Staff roster">
      {!visible.length ? (
        <p style={{ margin: 0, padding: '32px 16px', textAlign: 'center', fontSize: 'var(--text-sm)', color: 'var(--muted-foreground)' }}>
          {search ? `No staff match "${search}".` : 'No staff in this category.'}
        </p>
      ) : (
        visible.map(s => (
          <StaffRow key={s.id} staff={s} isSelected={s.id === selectedId} onClick={() => onSelect(s.id)} />
        ))
      )}
    </div>
  );
}

/* ─── EmptyPanel ─────────────────────────────────────────────────────────────── */
function EmptyPanel() {
  return (
    <div className="empty-panel">
      <span style={{ color: 'var(--border)' }}><UsersIcon size={40} /></span>
      <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--muted-foreground)', textAlign: 'center', maxWidth: 200, lineHeight: 'var(--leading-snug)' }}>
        Select a staff member to view and edit their details.
      </p>
    </div>
  );
}

/* ─── EditPanel ──────────────────────────────────────────────────────────────── */
function EditPanel({ target, onClose, inSheet }) {
  const [draft, setDraft] = useState({
    display_name: target.display_name,
    role:         target.role,
    color_token:  target.color_token,
    active:       target.active,
  });

  // Re-sync when a different row is selected
  useEffect(() => {
    setDraft({
      display_name: target.display_name,
      role:         target.role,
      color_token:  target.color_token,
      active:       target.active,
    });
  }, [target.id]);

  const trimmedName = draft.display_name.trim();
  const isDirty =
    draft.display_name !== target.display_name ||
    draft.role        !== target.role          ||
    draft.color_token !== target.color_token   ||
    draft.active      !== target.active;
  const canSave = isDirty && trimmedName.length >= 2;
  const previewName = trimmedName || target.display_name;

  return (
    <div className="edit-panel">

      {/* Profile preview */}
      <div className="panel-profile">
        <StaffAvatar name={previewName} colorToken={draft.color_token} size={52} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 'var(--text-md)', color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 'var(--leading-tight)' }}>
            {previewName}
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--muted-foreground)', marginTop: 4 }}>
            {ROLE_LABEL[draft.role]} · {formatDate(target.created_at)}
          </div>
          <div style={{ marginTop: 6 }}>
            {target.active
              ? <Badge variant="success">Active</Badge>
              : <Badge variant="muted">Inactive</Badge>
            }
          </div>
        </div>
      </div>

      {/* Identity */}
      <div className="panel-section">
        <div className="section-eyebrow">Identity</div>
        <div className="section-body">
          <div className="field">
            <label className="field-label" htmlFor={`edit-name-${target.id}`}>Display name</label>
            <input id={`edit-name-${target.id}`} type="text" value={draft.display_name}
              onChange={e => setDraft(d => ({ ...d, display_name: e.target.value }))}
              className="field-input" placeholder="e.g. Maya Chen" />
            {trimmedName.length > 0 && trimmedName.length < 2 && (
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--destructive)' }}>
                Name must be at least 2 characters.
              </span>
            )}
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`edit-role-${target.id}`}>Role</label>
            <select id={`edit-role-${target.id}`} value={draft.role}
              onChange={e => setDraft(d => ({ ...d, role: e.target.value }))}
              className="field-input" style={{ cursor: 'pointer' }}>
              {ROLE_OPTIONS.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </div>
          <div className="field">
            <span className="field-label">Avatar color</span>
            <ColorPicker value={draft.color_token} onChange={token => setDraft(d => ({ ...d, color_token: token }))} />
          </div>
        </div>
      </div>

      {/* Access */}
      <div className="panel-section">
        <div className="section-eyebrow">Access</div>
        <div className="access-row">
          <div>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--foreground)' }}>Active</div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--muted-foreground)', marginTop: 2 }}>
              {draft.active ? 'Can log in to the studio' : 'Locked out of the studio'}
            </div>
          </div>
          <Toggle checked={draft.active} onChange={v => setDraft(d => ({ ...d, active: v }))} />
        </div>
        <div className="access-row access-row--last">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            {target.pin_set
              ? <><ShieldCheckIcon size={15} style={{ color: 'var(--success)', flexShrink: 0 }} /><span style={{ fontSize: 'var(--text-sm)', color: 'var(--foreground)' }}>4-digit PIN set</span></>
              : <><KeyRoundIcon size={15} style={{ color: 'var(--warning)', flexShrink: 0 }} /><span style={{ fontSize: 'var(--text-sm)', color: 'var(--foreground)' }}>No PIN · <span style={{ color: 'var(--destructive)' }}>Required to log in</span></span></>
            }
          </div>
          <button className="btn-sm">
            {target.pin_set ? 'Change' : 'Set PIN'}
          </button>
        </div>
      </div>

      {/* Save */}
      <button className="btn-primary" disabled={!canSave}
        onClick={() => canSave && window.alert('Changes saved (prototype)')}>
        Save changes
      </button>

      {/* Danger zone */}
      <div className="danger-zone">
        <div className="danger-eyebrow">Danger zone</div>
        {target.active
          ? (
            <button className="danger-btn">
              <PowerOffIcon size={14} /> Deactivate
            </button>
          ) : (
            <button className="danger-btn danger-btn--safe">
              <PowerIcon size={14} /> Reactivate
            </button>
          )
        }
        <button className="danger-btn" style={{ borderBottom: 'none' }}>
          <TrashIcon size={14} /> Remove from roster
        </button>
      </div>

    </div>
  );
}

/* ─── MobileSheet ────────────────────────────────────────────────────────────── */
function MobileSheet({ open, onClose, target }) {
  // Prevent body scroll when sheet is open
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open || !target) return null;
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="mobile-sheet" role="dialog" aria-modal="true" aria-label="Staff details">
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span style={{ fontWeight: 600, fontSize: 'var(--text-base)', color: 'var(--foreground)' }}>
            {target.display_name}
          </span>
          <button className="btn-icon-sm" onClick={onClose} aria-label="Close"><XIcon size={16} /></button>
        </div>
        <div className="sheet-body">
          <EditPanel key={target.id} target={target} onClose={onClose} inSheet />
        </div>
      </div>
    </>
  );
}

/* ─── AddStaffSheet ──────────────────────────────────────────────────────────── */
function AddStaffSheet({ open, onClose }) {
  const [name, setName]   = useState('');
  const [role, setRole]   = useState('technician');
  const [color, setColor] = useState('--avatar-green');
  const canNext = name.trim().length >= 2;
  const preview = name.trim() || 'Display name';

  useEffect(() => {
    if (!open) { setName(''); setRole('technician'); setColor('--avatar-green'); }
  }, [open]);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="add-sheet" role="dialog" aria-modal="true" aria-label="Add staff member">

        {/* Header */}
        <div className="sheet-header">
          <span style={{ fontWeight: 600, fontSize: 'var(--text-base)', color: 'var(--foreground)' }}>
            Add staff member
          </span>
          <button className="btn-icon-sm" onClick={onClose} aria-label="Close"><XIcon size={16} /></button>
        </div>

        {/* Step pills */}
        <div className="wizard-steps">
          {['Details', 'Set PIN', 'Done'].map((label, i) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className={'step-dot' + (i === 0 ? ' step-dot--active' : ' step-dot--upcoming')}>
                {i === 0 ? '1' : i + 1}
              </span>
              <span style={{ fontSize: 12, fontWeight: i === 0 ? 500 : 400, color: i === 0 ? 'var(--foreground)' : 'var(--muted-foreground)' }}>
                {label}
              </span>
              {i < 2 && <span style={{ display: 'block', width: 16, height: 1, background: 'var(--border)', marginLeft: 4, marginRight: 4 }} />}
            </div>
          ))}
        </div>

        {/* Body */}
        <div className="add-sheet-body">

          {/* Live preview */}
          <div className="preview-card">
            <StaffAvatar name={preview} colorToken={color} size={40} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 500, fontSize: 'var(--text-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {preview}
              </div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--muted-foreground)', marginTop: 2 }}>
                {ROLE_LABEL[role]}
              </div>
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="add-name">Display name</label>
            <input id="add-name" type="text" value={name} onChange={e => setName(e.target.value)}
              className="field-input" placeholder="e.g. Maya Chen" autoFocus />
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--muted-foreground)' }}>
              This is how they'll appear on the login screen.
            </span>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="add-role">Role</label>
            <select id="add-role" value={role} onChange={e => setRole(e.target.value)}
              className="field-input" style={{ cursor: 'pointer' }}>
              {ROLE_OPTIONS.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--muted-foreground)' }}>
              Determines what they can access in the app.
            </span>
          </div>

          <div className="field">
            <span className="field-label">Avatar color</span>
            <ColorPicker value={color} onChange={setColor} />
          </div>

        </div>

        {/* Footer */}
        <div className="add-sheet-footer">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary-sm" disabled={!canNext}>Next: set PIN</button>
        </div>

      </div>
    </>
  );
}

/* ─── App ────────────────────────────────────────────────────────────────────── */
function App() {
  const [t, setTweak]    = useTweaks(TWEAK_DEFAULTS);
  const [activeTab, setActiveTab]   = useState('staff');
  const [selectedId, setSelectedId] = useState(null);
  const [addOpen, setAddOpen]       = useState(false);
  const [search, setSearch]         = useState('');
  const [filter, setFilter]         = useState('active');
  const [isSmall, setIsSmall]       = useState(false);

  // Real viewport size
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 899px)');
    const handler = () => setIsSmall(mq.matches);
    handler();
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Apply viewport simulation attribute
  useEffect(() => {
    const el = document.getElementById('staff-shell');
    if (el) el.setAttribute('data-vp', t.viewport);
  }, [t.viewport]);

  // Apply dark mode
  useEffect(() => {
    document.documentElement.classList.toggle('dark', t.dark);
  }, [t.dark]);

  const isMobile = t.viewport === 'mobile' || (t.viewport === 'auto' && isSmall);
  const activeCount  = ROSTER.filter(s => s.active).length;
  const totalCount   = ROSTER.length;
  const selectedStaff = selectedId ? ROSTER.find(s => s.id === selectedId) : null;

  const handleSelect = id => setSelectedId(prev => prev === id ? null : id);

  return (
    <div id="staff-shell" className="staff-shell" data-vp={t.viewport}>

      <TabBar active={activeTab} onChange={setActiveTab} />

      <div className="page-content">
        <div className="staff-grid">

          {/* Roster column */}
          <div className="roster-col">
            <PageHeader onAddStaff={() => setAddOpen(true)} />
            <ControlsBar
              search={search} onSearch={setSearch}
              filter={filter} onFilter={setFilter}
              activeCount={activeCount} totalCount={totalCount}
            />
            <StaffList
              roster={ROSTER} filter={filter} search={search}
              selectedId={selectedId} onSelect={handleSelect}
            />
          </div>

          {/* Panel column — desktop only */}
          <div className="panel-col">
            {selectedStaff
              ? <EditPanel key={selectedStaff.id} target={selectedStaff} onClose={() => setSelectedId(null)} />
              : <EmptyPanel />
            }
          </div>

        </div>
      </div>

      {/* Mobile bottom sheet */}
      {isMobile && (
        <MobileSheet open={!!selectedStaff} onClose={() => setSelectedId(null)} target={selectedStaff} />
      )}

      {/* Add staff sheet */}
      <AddStaffSheet open={addOpen} onClose={() => setAddOpen(false)} />

      {/* FAB — mobile only */}
      <button className="fab" onClick={() => setAddOpen(true)} aria-label="Add staff member">
        <PlusIcon size={18} />
        <span>Add staff</span>
      </button>

      {/* Tweaks panel */}
      <TweaksPanel>
        <TweakSection label="Viewport" />
        <TweakRadio
          label="Breakpoint"
          value={t.viewport}
          options={['auto', 'mobile', 'desktop']}
          onChange={v => setTweak('viewport', v)}
        />
        <TweakSection label="Appearance" />
        <TweakToggle label="Dark mode" value={t.dark} onChange={v => setTweak('dark', v)} />
        <TweakSection label="Filter" />
        <TweakRadio
          label="Default filter"
          value={filter}
          options={['all', 'active', 'inactive']}
          onChange={v => setFilter(v)}
        />
      </TweaksPanel>

    </div>
  );
}

Object.assign(window, { App });
