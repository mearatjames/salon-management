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
function CreditCardIcon({ size = 16 }) {
  return <SvgIcon size={size}><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /></SvgIcon>;
}
function PackageIcon({ size = 16 }) {
  return <SvgIcon size={size}><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></SvgIcon>;
}
function InfoIcon({ size = 16 }) {
  return <SvgIcon size={size}><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></SvgIcon>;
}

/* ─── Mock roster ────────────────────────────────────────────────────────────── */
// Each tech carries a `pay` block with independent exemption switches.
//   - card_fee_exempt: simple boolean
//   - supply_mode:    'apply' = all supplies deducted (default),
//                     'partial' = only some supply types are exempt (see supply_except),
//                     'exempt' = no supply costs ever deducted
//   - supply_except:  array of SUPPLY_CATEGORIES ids; used only when supply_mode === 'partial'
const ROSTER = [
  { id: '1', display_name: 'Maya Chen',    role: 'owner',      color_token: '--avatar-rose',   active: true,  pin_set: true,  created_at: '2023-03-15T00:00:00Z',
    pay: { card_fee_exempt: true,  supply_mode: 'exempt',  supply_except: [] } },
  { id: '2', display_name: 'Jordan Kim',   role: 'manager',    color_token: '--avatar-blue',   active: true,  pin_set: true,  created_at: '2023-05-02T00:00:00Z',
    pay: { card_fee_exempt: false, supply_mode: 'apply',   supply_except: [] } },
  { id: '3', display_name: 'Priya Nair',   role: 'technician', color_token: '--avatar-green',  active: true,  pin_set: false, created_at: '2023-06-18T00:00:00Z',
    pay: { card_fee_exempt: false, supply_mode: 'apply',   supply_except: [] } },
  { id: '4', display_name: 'Tom Wu',       role: 'technician', color_token: '--avatar-amber',  active: true,  pin_set: true,  created_at: '2023-08-09T00:00:00Z',
    pay: { card_fee_exempt: false, supply_mode: 'partial', supply_except: ['st_gelx'] } },
  { id: '5', display_name: 'Alexa Torres', role: 'front_desk', color_token: '--avatar-teal',   active: true,  pin_set: true,  created_at: '2024-01-20T00:00:00Z',
    pay: { card_fee_exempt: false, supply_mode: 'apply',   supply_except: [] } },
  { id: '6', display_name: 'Marcus Lee',   role: 'technician', color_token: '--avatar-purple', active: false, pin_set: true,  created_at: '2023-11-01T00:00:00Z',
    pay: { card_fee_exempt: false, supply_mode: 'apply',   supply_except: [] } },
  { id: '7', display_name: 'Sasha Tan',    role: 'technician', color_token: '--avatar-orange', active: true,  pin_set: true,  created_at: '2024-02-14T00:00:00Z',
    pay: { card_fee_exempt: false, supply_mode: 'apply',   supply_except: [] } },
];

// Global card-fee default — shown as the standard amount on the toggle subtitle.
// In a real build this comes from the policy store (services-data.jsx · POLICY).
const CARD_FEE_DEFAULT_LABEL = '$3';

// Supply types are managed in services-data.jsx via useSupplyTypes() so
// renames here update the Services page and vice versa. Usage stats are
// computed from window.SERVICES_DATA at render time.
function supplyTypeUsageForStaff(typeId) {
  const services = window.SERVICES_DATA || [];
  const using = services.filter(s => s.active && s.supply?.type_id === typeId);
  const sampleCents = using[0]?.supply?.amount_cents ?? null;
  return { service_count: using.length, sample_amount_cents: sampleCents };
}

function fmtPriceCents(cents) {
  if (cents == null) return '—';
  const dollars = cents / 100;
  return '$' + (Number.isInteger(dollars) ? dollars.toFixed(0) : dollars.toFixed(2));
}

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

/* ─── Segmented control (3-way) ──────────────────────────────────────────── */
function Segmented({ value, onChange, options, ariaLabel }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} style={{
      display: 'inline-flex',
      background: 'var(--muted)',
      padding: 2,
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--border)',
      gap: 2,
      flexShrink: 0,
    }}>
      {options.map(opt => {
        const sel = opt.value === value;
        return (
          <button key={opt.value} type="button" role="radio" aria-checked={sel}
            onClick={() => onChange(opt.value)}
            style={{
              padding: '5px 11px',
              fontSize: 12,
              fontWeight: 500,
              border: 'none',
              background: sel ? 'var(--card)' : 'transparent',
              color: sel ? 'var(--foreground)' : 'var(--muted-foreground)',
              borderRadius: 'calc(var(--radius-md) - 2px)',
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
              boxShadow: sel ? 'var(--shadow-xs)' : 'none',
              transition: 'background 150ms var(--ease-out), color 150ms var(--ease-out)',
              whiteSpace: 'nowrap',
            }}>
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/* ─── Checkbox ───────────────────────────────────────────────────────────── */
function Checkbox({ checked, onChange, ariaLabel }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      style={{
        width: 18, height: 18, flexShrink: 0,
        border: checked ? 'none' : '1.5px solid oklch(from var(--foreground) l c h / 0.28)',
        background: checked ? 'var(--primary)' : 'transparent',
        borderRadius: 4,
        cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--primary-foreground)',
        padding: 0,
        transition: 'background 150ms var(--ease-out), border-color 150ms var(--ease-out)',
      }}>
      {checked && <CheckIcon size={12} />}
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

/* ─── PayDeductionsSection ───────────────────────────────────────────────────
 *
 * Per-tech, fine-grained exemption from each deduction type. Lives on the
 * staff record (not on individual services) — services define IF a deduction
 * can apply; this controls WHETHER it does for a given tech.
 *
 * Card fee: simple on/off (no per-method granularity yet).
 * Supply:   3-way mode (Apply all / Some / Exempt all).
 *           In "Some" mode the owner ticks which supply types this tech is
 *           exempt from; everything unchecked still applies normally.
 *
 * A plain-language summary at the bottom mirrors the resulting state so
 * the owner doesn't have to translate the toggles.
 * ───────────────────────────────────────────────────────────────────────── */
function PayDeductionsSection({ draft, patchPay, toggleExceptCategory, role, firstName }) {
  const [types] = useSupplyTypes();
  const activeTypes = types.filter(t => !t.archived);
  const cardExempt   = draft.pay.card_fee_exempt;
  const supplyMode   = draft.pay.supply_mode;
  const supplyExcept = draft.pay.supply_except;

  // Resolved supply state (handles the empty-partial edge case)
  const supplyFullyExempt    = supplyMode === 'exempt';
  const supplyPartialApplied = supplyMode === 'partial' && supplyExcept.length > 0;
  const anyExempt            = cardExempt || supplyFullyExempt || supplyPartialApplied;
  const bothFully            = cardExempt && supplyFullyExempt;

  // Map ids → labels for prose
  const exemptLabels = supplyExcept
    .map(id => activeTypes.find(t => t.id === id)?.name)
    .filter(Boolean);

  function exemptListProse(labels) {
    if (labels.length === 0) return '';
    if (labels.length === 1) return labels[0];
    if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
    return labels.slice(0, -1).join(', ') + ', and ' + labels[labels.length - 1];
  }

  // Plain-language summary of the net effect.
  let summary = null;
  if (bothFully) {
    summary = (
      <>
        <strong>{firstName} keeps 100% of every payout.</strong> No card fee
        or supply costs are ever deducted, regardless of payment method or service.
      </>
    );
  } else if (cardExempt && supplyPartialApplied) {
    summary = (
      <>
        <strong>Card fees are skipped for {firstName}, and supply costs
        for {exemptListProse(exemptLabels)} are too.</strong> All other supply
        costs still apply.
      </>
    );
  } else if (cardExempt) {
    summary = (
      <>
        <strong>Card fees are skipped for {firstName}.</strong> Per-service
        supply costs still apply on any service that has one configured.
      </>
    );
  } else if (supplyFullyExempt) {
    summary = (
      <>
        <strong>Supply costs are skipped for {firstName}.</strong> The standard
        card fee still applies on card- and gift-card-paid services.
      </>
    );
  } else if (supplyPartialApplied) {
    summary = (
      <>
        <strong>{firstName} is exempt from {exemptListProse(exemptLabels)}.</strong> All
        other supply costs and the standard card fee still apply.
      </>
    );
  }

  // Front-desk roles don't take services — surface that softly so the toggles
  // don't read as bugs when they appear to do nothing.
  const isNonServiceRole = role === 'front_desk';

  return (
    <div className="panel-section">
      <div className="section-eyebrow">Pay &amp; deductions</div>

      {/* Card fee */}
      <div className="access-row">
        <div style={{ minWidth: 0, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <CreditCardIcon size={15} style={{ color: 'var(--muted-foreground)', marginTop: 2, flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--foreground)' }}>
              Card processing fee
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--muted-foreground)', marginTop: 2, lineHeight: 1.5 }}>
              {cardExempt
                ? <>Exempt — card fee never deducted from payout.</>
                : <>Standard {CARD_FEE_DEFAULT_LABEL} deducted on card-paid services.</>
              }
            </div>
          </div>
        </div>
        <Toggle
          checked={!cardExempt}
          onChange={v => patchPay({ card_fee_exempt: !v })}
        />
      </div>

      {/* Supply — header row with 3-way segmented control */}
      <div className="access-row" style={{ flexWrap: 'wrap', borderBottom: supplyMode === 'partial' ? 'none' : '1px solid var(--border)' }}>
        <div style={{ minWidth: 0, display: 'flex', alignItems: 'flex-start', gap: 10, flex: '1 1 auto' }}>
          <PackageIcon size={15} style={{ color: 'var(--muted-foreground)', marginTop: 2, flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--foreground)' }}>
              Supply deductions
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--muted-foreground)', marginTop: 2, lineHeight: 1.5 }}>
              {supplyMode === 'apply'   && <>Per-service supply cost deducted from payout when configured.</>}
              {supplyMode === 'partial' && <>Apply most supply costs, but exempt {firstName} from specific types.</>}
              {supplyMode === 'exempt'  && <>Exempt — no supply costs ever deducted, on any service.</>}
            </div>
          </div>
        </div>
        <Segmented
          ariaLabel="Supply deduction mode"
          value={supplyMode}
          onChange={v => patchPay({ supply_mode: v })}
          options={[
            { value: 'apply',   label: 'Apply all' },
            { value: 'partial', label: 'Some'      },
            { value: 'exempt',  label: 'Exempt'    },
          ]}
        />
      </div>

      {/* Supply — per-type picker (only in partial mode) */}
      {supplyMode === 'partial' && (
        <div style={{
          padding: '12px 16px 14px',
          background: 'var(--muted)',
          borderTop: '1px solid var(--border)',
        }}>
          <div style={{ fontSize: 11, color: 'var(--muted-foreground)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 10 }}>
            Exempt {firstName} from these supply types
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {activeTypes.length === 0 && (
              <div style={{
                padding: '12px 14px',
                background: 'var(--card)',
                border: '1px dashed var(--border)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 12, color: 'var(--muted-foreground)', textAlign: 'center',
              }}>
                No supply types defined yet. Add some on the Services page first.
              </div>
            )}
            {activeTypes.map(cat => {
              const usage = supplyTypeUsageForStaff(cat.id);
              const checked = supplyExcept.includes(cat.id);
              return (
                <label key={cat.id}
                  onClick={(e) => {
                    // Block native label behavior so our custom checkbox handles state once.
                    if (e.target.tagName !== 'BUTTON') {
                      e.preventDefault();
                      toggleExceptCategory(cat.id, !checked);
                    }
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '9px 12px',
                    background: 'var(--card)',
                    border: '1px solid ' + (checked ? 'var(--ring)' : 'var(--border)'),
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    transition: 'border-color 150ms var(--ease-out)',
                  }}>
                  <Checkbox
                    checked={checked}
                    onChange={v => toggleExceptCategory(cat.id, v)}
                    ariaLabel={`Exempt from ${cat.name}`}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 'var(--text-sm)',
                      fontWeight: 500,
                      color: 'var(--foreground)',
                      textDecoration: checked ? 'line-through' : 'none',
                      textDecorationColor: 'var(--muted-foreground)',
                    }}>{cat.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 2 }}>
                      {usage.service_count === 0
                        ? 'Unused — no services reference this type yet.'
                        : `${usage.service_count} ${usage.service_count === 1 ? 'service' : 'services'} · typically ${fmtPriceCents(usage.sample_amount_cents)} per ticket`
                      }
                    </div>
                  </div>
                  {checked && (
                    <span style={{
                      fontSize: 11, fontWeight: 500,
                      padding: '2px 8px',
                      borderRadius: 9999,
                      background: 'oklch(from var(--muted-foreground) l c h / 0.14)',
                      color: 'var(--muted-foreground)',
                      whiteSpace: 'nowrap',
                    }}>Exempt</span>
                  )}
                </label>
              );
            })}
          </div>
          {supplyExcept.length === 0 && (
            <div style={{ fontSize: 11.5, color: 'var(--muted-foreground)', marginTop: 10, lineHeight: 1.5 }}>
              No supply types selected — all costs will be deducted normally until you tick at least one.
            </div>
          )}
        </div>
      )}

      {/* Summary note — only when at least one exemption is in effect */}
      {summary && (
        <div className="section-note">
          <InfoIcon size={13} style={{ color: 'var(--muted-foreground)', marginTop: 1, flexShrink: 0 }} />
          <span>{summary}</span>
        </div>
      )}

      {/* Non-service role hint */}
      {isNonServiceRole && !anyExempt && (
        <div className="section-note">
          <InfoIcon size={13} style={{ color: 'var(--muted-foreground)', marginTop: 1, flexShrink: 0 }} />
          <span>Front desk staff don't take services, so these settings normally don't affect their payouts. Configure if they occasionally cover service tickets.</span>
        </div>
      )}
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
    pay: {
      card_fee_exempt: target.pay?.card_fee_exempt ?? false,
      supply_mode:     target.pay?.supply_mode     ?? 'apply',
      supply_except:   [...(target.pay?.supply_except ?? [])],
    },
  });

  // Re-sync when a different row is selected
  useEffect(() => {
    setDraft({
      display_name: target.display_name,
      role:         target.role,
      color_token:  target.color_token,
      active:       target.active,
      pay: {
        card_fee_exempt: target.pay?.card_fee_exempt ?? false,
        supply_mode:     target.pay?.supply_mode     ?? 'apply',
        supply_except:   [...(target.pay?.supply_except ?? [])],
      },
    });
  }, [target.id]);

  const trimmedName = draft.display_name.trim();
  const targetPay = {
    card_fee_exempt: target.pay?.card_fee_exempt ?? false,
    supply_mode:     target.pay?.supply_mode     ?? 'apply',
    supply_except:   target.pay?.supply_except   ?? [],
  };
  const exceptChanged =
    draft.pay.supply_except.length !== targetPay.supply_except.length ||
    draft.pay.supply_except.some(id => !targetPay.supply_except.includes(id));
  const isDirty =
    draft.display_name !== target.display_name ||
    draft.role        !== target.role          ||
    draft.color_token !== target.color_token   ||
    draft.active      !== target.active        ||
    draft.pay.card_fee_exempt !== targetPay.card_fee_exempt ||
    draft.pay.supply_mode     !== targetPay.supply_mode     ||
    exceptChanged;
  const canSave = isDirty && trimmedName.length >= 2;
  const previewName = trimmedName || target.display_name;

  function patchPay(p) {
    setDraft(d => ({ ...d, pay: { ...d.pay, ...p } }));
  }
  function toggleExceptCategory(id, on) {
    setDraft(d => {
      const next = on
        ? [...d.pay.supply_except, id].filter((v, i, a) => a.indexOf(v) === i)
        : d.pay.supply_except.filter(x => x !== id);
      return { ...d, pay: { ...d.pay, supply_except: next } };
    });
  }

  return (
    <div className="edit-panel">

      {/* Profile preview */}
      <div className="panel-profile">
        <StaffAvatar name={previewName} colorToken={draft.color_token} size={52} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 'var(--text-md)', color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 'var(--leading-tight)' }}>
            {previewName}
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--muted-foreground)', marginTop: 4 }}>
            {ROLE_LABEL[draft.role]} · {formatDate(target.created_at)}
          </div>
          <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {target.active
              ? <Badge variant="success">Active</Badge>
              : <Badge variant="muted">Inactive</Badge>
            }
            {(() => {
              const cf = draft.pay.card_fee_exempt;
              const sm = draft.pay.supply_mode;
              const sx = draft.pay.supply_except.length > 0;
              if (cf && sm === 'exempt')   return <Badge variant="muted">No deductions</Badge>;
              if (cf && sm === 'partial' && sx) return <Badge variant="muted">Partial deductions</Badge>;
              if (cf)                      return <Badge variant="muted">Card-fee exempt</Badge>;
              if (sm === 'exempt')         return <Badge variant="muted">Supply-exempt</Badge>;
              if (sm === 'partial' && sx)  return <Badge variant="muted">Partial supply exemption</Badge>;
              return null;
            })()}
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

      {/* Pay & deductions */}
      <PayDeductionsSection
        draft={draft}
        patchPay={patchPay}
        toggleExceptCategory={toggleExceptCategory}
        role={draft.role}
        firstName={previewName.split(' ')[0]}
      />

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
