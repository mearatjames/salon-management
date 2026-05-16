// StaffManagement.jsx — main settings screen: staff list, edit panel, add sheet
const { useState, useCallback, useEffect, useRef } = React;

// ── Constants ─────────────────────────────────────────────────────────────
const STAFF_COLORS = [
  { label: 'Rose',   value: 'oklch(0.55 0.12 12)' },
  { label: 'Blue',   value: 'oklch(0.60 0.13 240)' },
  { label: 'Green',  value: 'oklch(0.62 0.13 150)' },
  { label: 'Amber',  value: 'oklch(0.76 0.14 75)' },
  { label: 'Purple', value: 'oklch(0.55 0.13 270)' },
  { label: 'Teal',   value: 'oklch(0.56 0.13 200)' },
  { label: 'Orange', value: 'oklch(0.62 0.17 50)' },
  { label: 'Slate',  value: 'oklch(0.44 0.01 90)' },
];

const ROLE_ORDER = { owner: 0, manager: 1, technician: 2, front_desk: 3 };

const INITIAL_STAFF = [
  { id: '1', display_name: 'Priya Raman',   role: 'owner',      color: 'oklch(0.55 0.12 12)',  pin_set: true,  active: true,  created_at: 'Jan 2024' },
  { id: '2', display_name: 'Alexis Moore',  role: 'manager',    color: 'oklch(0.76 0.14 75)',  pin_set: true,  active: true,  created_at: 'Mar 2024' },
  { id: '3', display_name: 'Maya Chen',     role: 'technician', color: 'oklch(0.60 0.13 240)', pin_set: true,  active: true,  created_at: 'Feb 2024' },
  { id: '4', display_name: 'Tom Kwan',      role: 'technician', color: 'oklch(0.62 0.13 150)', pin_set: false, active: true,  created_at: 'Apr 2024' },
  { id: '5', display_name: 'Jin Park',      role: 'front_desk', color: 'oklch(0.56 0.13 200)', pin_set: true,  active: false, created_at: 'May 2024' },
];

// ── Color picker ───────────────────────────────────────────────────────────
function ColorPicker({ value, onChange }) {
  return (
    <div className="color-picker">
      {STAFF_COLORS.map(c => (
        <button
          key={c.value}
          type="button"
          title={c.label}
          className={`color-swatch${value === c.value ? ' active' : ''}`}
          style={{ background: c.value }}
          onClick={() => onChange(c.value)}
        />
      ))}
    </div>
  );
}

// ── Add staff sheet ────────────────────────────────────────────────────────
const PIN_LEN = 4;

function AddStaffSheet({ onClose, onSave }) {
  const [step, setStep]         = useState(1);
  const [name, setName]         = useState('');
  const [role, setRole]         = useState('technician');
  const [color, setColor]       = useState(STAFF_COLORS[2].value);
  const [wantPin, setWantPin]   = useState(true);
  // PIN sub-state
  const [pinPhase, setPinPhase] = useState(1); // 1=enter, 2=confirm
  const [pinFirst, setPinFirst] = useState('');
  const [pinSec, setPinSec]     = useState('');
  const [pinError, setPinError] = useState('');
  const [savedPin, setSavedPin] = useState(null);

  const pinDigits = (pinPhase === 1 ? pinFirst : pinSec).split('');

  const handlePinAppend = useCallback((d) => {
    setPinError('');
    const setter = pinPhase === 1 ? setPinFirst : setPinSec;
    const current = pinPhase === 1 ? pinFirst : pinSec;
    if (current.length >= PIN_LEN) return;
    const next = current + d;
    setter(next);
    if (next.length === PIN_LEN) {
      setTimeout(() => {
        if (pinPhase === 1) {
          setPinPhase(2);
        } else {
          if (next === pinFirst) {
            setSavedPin(next);
            setStep(3);
          } else {
            setPinError("PINs didn't match. Try again.");
            setPinFirst(''); setPinSec(''); setPinPhase(1);
          }
        }
      }, 160);
    }
  }, [pinPhase, pinFirst, pinSec]);

  const handlePinClear = useCallback((type) => {
    setPinError('');
    if (pinPhase === 1) setPinFirst(p => type === 'all' ? '' : p.slice(0, -1));
    else setPinSec(p => type === 'all' ? '' : p.slice(0, -1));
  }, [pinPhase]);

  function handleSkipPin() { setSavedPin(null); setStep(3); }

  function handleSave() {
    onSave({
      id: String(Date.now()),
      display_name: name.trim(),
      role,
      color,
      pin_set: !!savedPin,
      active: true,
      created_at: 'May 2026',
    });
  }

  const canProceed = name.trim().length >= 2;

  return (
    <div className="sheet-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet">
        {/* Header */}
        <div className="sheet-header">
          <div className="sheet-title">Add staff member</div>
          <button className="btn btn-ghost btn-icon" type="button" onClick={onClose}>
            <UM.X size={16} />
          </button>
        </div>

        {/* Step bar */}
        <div className="sheet-step-bar">
          {[
            { n: 1, label: 'Details' },
            { n: 2, label: 'Set PIN' },
            { n: 3, label: 'Done' },
          ].map((s, i) => (
            <React.Fragment key={s.n}>
              {i > 0 && <div className="sheet-step-line" />}
              <div className={`sheet-step-dot ${step > s.n ? 'done' : step === s.n ? 'active' : 'pending'}`}>
                {step > s.n ? <UM.Check size={11} /> : s.n}
              </div>
              <span className={`sheet-step-label${step === s.n ? ' active' : ''}`}>{s.label}</span>
            </React.Fragment>
          ))}
        </div>

        {/* Step 1 — Details */}
        {step === 1 && (
          <div className="sheet-body">
            <div className="form-field">
              <label className="form-label">Display name</label>
              <input
                className="input"
                placeholder="e.g. Maya Chen"
                value={name}
                onChange={e => setName(e.target.value)}
                autoFocus
              />
              <span className="form-hint">This is how they'll appear on the login screen.</span>
            </div>

            <div className="form-field">
              <label className="form-label">Role</label>
              <select className="um-select" value={role} onChange={e => setRole(e.target.value)}>
                <option value="owner">Owner</option>
                <option value="manager">Manager</option>
                <option value="technician">Tech</option>
                <option value="front_desk">Front desk</option>
              </select>
              <span className="form-hint">Determines what they can access in the app.</span>
            </div>

            <div className="form-field">
              <label className="form-label">Avatar color</label>
              <ColorPicker value={color} onChange={setColor} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <StaffAv name={name || '?'} color={color} size={32} />
                <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
                  {name || 'Display name'} · {getRoleLabel(role)}
                </span>
              </div>
            </div>

            <div style={{ padding: '12px 14px', background: 'var(--muted)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>Set a login PIN</div>
                  <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 2 }}>Staff need a 4-digit PIN to log in on this device</div>
                </div>
                <UMToggle checked={wantPin} onChange={setWantPin} />
              </div>
            </div>
          </div>
        )}

        {/* Step 2 — PIN setup */}
        {step === 2 && (
          <div className="sheet-body" style={{ alignItems: 'center' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>
                {pinPhase === 1 ? 'Enter a 4-digit PIN' : 'Confirm the PIN'}
              </div>
              <div style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>
                {pinPhase === 1 ? `Choose a PIN for ${name}` : 'Enter the same PIN again'}
              </div>
            </div>

            {/* step sub-indicator */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {[1,2].map((p, i) => (
                <React.Fragment key={p}>
                  {i > 0 && <div style={{ width: 24, height: 1, background: 'var(--border)' }} />}
                  <div style={{
                    width: 20, height: 20, borderRadius: '50%', fontSize: 10, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: p < pinPhase ? 'var(--success)' : p === pinPhase ? 'var(--primary)' : 'var(--border)',
                    color: p <= pinPhase ? 'white' : 'var(--muted-foreground)',
                  }}>
                    {p < pinPhase ? <UM.Check size={10} /> : p}
                  </div>
                  <span style={{ fontSize: 11, color: p === pinPhase ? 'var(--foreground)' : 'var(--muted-foreground)', fontWeight: p === pinPhase ? 500 : 400 }}>
                    {p === 1 ? 'Enter' : 'Confirm'}
                  </span>
                </React.Fragment>
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              <div className="pin-dots">
                {Array.from({ length: PIN_LEN }, (_, i) => (
                  <span key={i} className={`pin-dot${i < pinDigits.length ? ' filled' : ''}${pinError ? ' error' : ''}`} />
                ))}
              </div>
              <div className="mini-keypad">
                {['1','2','3','4','5','6','7','8','9'].map(d => (
                  <button key={d} className="mini-key" type="button" onClick={() => handlePinAppend(d)}>{d}</button>
                ))}
                <span />
                <button className="mini-key" type="button" onClick={() => handlePinAppend('0')}>0</button>
                <button className="mini-key fn" type="button" onClick={() => handlePinClear('back')}><UM.Backspace size={14} /></button>
              </div>
              <div className="pin-error-msg">{pinError}</div>
            </div>
          </div>
        )}

        {/* Step 3 — Success */}
        {step === 3 && (
          <div className="sheet-body" style={{ alignItems: 'center', justifyContent: 'center', flex: 1 }}>
            <div className="success-icon-circle">
              <UM.Check size={22} />
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>{name} added</div>
              <div style={{ fontSize: 13, color: 'var(--muted-foreground)', lineHeight: 1.55 }}>
                {savedPin
                  ? `${name} can now log in with their 4-digit PIN.`
                  : `${name} has been added. Set a PIN before they can log in.`}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, padding: '14px 20px', background: 'var(--muted)', borderRadius: 10, border: '1px solid var(--border)', width: '100%' }}>
              <StaffAv name={name} color={color} size={40} />
              <div>
                <div style={{ fontWeight: 500, fontSize: 14 }}>{name}</div>
                <div style={{ fontSize: 12, color: 'var(--muted-foreground)', marginTop: 2 }}>{getRoleLabel(role)} · {savedPin ? 'PIN set' : 'No PIN'}</div>
              </div>
              {savedPin && (
                <div style={{ marginLeft: 'auto' }}>
                  <UMBadge tone="success">PIN set</UMBadge>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="sheet-footer">
          {step === 1 && (
            <>
              <button className="btn btn-outline btn-sm" type="button" onClick={onClose}>Cancel</button>
              <button
                className="btn btn-primary btn-sm"
                type="button"
                disabled={!canProceed}
                onClick={() => wantPin ? setStep(2) : setStep(3)}
              >
                {wantPin ? 'Next: set PIN' : 'Add staff member'}
              </button>
            </>
          )}
          {step === 2 && (
            <>
              <button className="btn btn-ghost btn-sm" type="button" onClick={handleSkipPin}>Skip for now</button>
            </>
          )}
          {step === 3 && (
            <button className="btn btn-primary btn-sm" type="button" onClick={handleSave}>
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Edit panel (right column) ─────────────────────────────────────────────
function EditPanel({ staff, onUpdate, onPinOpen, onDeactivate, onRemove }) {
  const [draftName,   setDraftName]   = useState(staff.display_name);
  const [draftRole,   setDraftRole]   = useState(staff.role);
  const [draftColor,  setDraftColor]  = useState(staff.color);
  const [draftActive, setDraftActive] = useState(staff.active);

  // Reset draft when a different staff member is selected
  useEffect(() => {
    setDraftName(staff.display_name);
    setDraftRole(staff.role);
    setDraftColor(staff.color);
    setDraftActive(staff.active);
  }, [staff.id]);

  const dirty = draftName !== staff.display_name || draftRole !== staff.role
    || draftColor !== staff.color || draftActive !== staff.active;

  function handleSave() {
    onUpdate(staff.id, { display_name: draftName, role: draftRole, color: draftColor, active: draftActive });
  }

  return (
    <div className="edit-panel">
      {/* Header */}
      <div className="edit-panel-head">
        <StaffAv name={draftName || staff.display_name} color={draftColor} size={40} />
        <div>
          <div className="edit-panel-name">{draftName || staff.display_name}</div>
          <div className="edit-panel-role">{getRoleLabel(draftRole)}</div>
        </div>
      </div>

      {/* Body */}
      <div className="edit-panel-body">
        {/* Name */}
        <div className="form-field">
          <label className="form-label">Display name</label>
          <input
            className="input input-sm"
            value={draftName}
            onChange={e => setDraftName(e.target.value)}
          />
        </div>

        {/* Role */}
        <div className="form-field">
          <label className="form-label">Role</label>
          <select className="um-select" value={draftRole} onChange={e => setDraftRole(e.target.value)}>
            <option value="owner">Owner</option>
            <option value="manager">Manager</option>
            <option value="technician">Tech</option>
            <option value="front_desk">Front desk</option>
          </select>
        </div>

        {/* Color */}
        <div className="form-field">
          <label className="form-label">Avatar color</label>
          <ColorPicker value={draftColor} onChange={setDraftColor} />
        </div>

        {/* PIN */}
        <div className="form-field">
          <label className="form-label">Login PIN</label>
          <div className="pin-row">
            <div className="pin-row-left">
              <div className={`pin-dot-icon ${staff.pin_set ? 'set' : 'unset'}`}>
                {staff.pin_set ? <UM.Shield size={14} /> : <UM.Key size={14} />}
              </div>
              <div>
                <div className="pin-row-label">{staff.pin_set ? '4-digit PIN set' : 'No PIN set'}</div>
                <div className="pin-row-sub">{staff.pin_set ? 'Last changed when added' : 'Required to log in'}</div>
              </div>
            </div>
            <button
              className="btn btn-outline btn-sm"
              type="button"
              onClick={() => onPinOpen(staff.id, staff.pin_set ? 'change' : 'set')}
            >
              {staff.pin_set ? 'Change' : 'Set PIN'}
            </button>
          </div>
        </div>

        {/* Active toggle */}
        <div style={{ padding: '10px 12px', background: 'var(--muted)', borderRadius: 8, border: '1px solid var(--border)' }}>
          <div className="toggle-row">
            <div>
              <div className="toggle-row-label">Active</div>
              <div className="toggle-row-sub">{draftActive ? 'Appears on the login screen' : 'Hidden from the login screen'}</div>
            </div>
            <UMToggle checked={draftActive} onChange={setDraftActive} />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="edit-panel-footer">
        <button
          className="btn btn-primary btn-sm"
          type="button"
          disabled={!dirty || draftName.trim().length < 1}
          style={{ width: '100%' }}
          onClick={handleSave}
        >
          Save changes
        </button>
        <div className="divider" style={{ margin: '4px -20px' }} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {staff.active && (
            <button className="danger-link" type="button" onClick={() => onDeactivate(staff.id)}>
              Deactivate
            </button>
          )}
          {!staff.active && (
            <button
              className="btn btn-outline btn-sm"
              type="button"
              onClick={() => onUpdate(staff.id, { active: true })}
            >
              Reactivate
            </button>
          )}
          <button
            className="danger-link"
            type="button"
            style={{ marginLeft: 'auto' }}
            onClick={() => onRemove(staff.id)}
          >
            Remove from salon
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Staff settings screen ─────────────────────────────────────────────────
function StaffSettings() {
  const [staff, setStaff]           = useState(INITIAL_STAFF);
  const [selected, setSelected]     = useState(null);       // id
  const [query, setQuery]           = useState('');
  const [showInactive, setShowInactive] = useState(true);
  const [tab, setTab]               = useState('staff');

  // Overlay states
  const [sheetOpen, setSheetOpen]   = useState(false);
  const [pinModal, setPinModal]     = useState(null);  // { id, mode }
  const [confirmDialog, setConfirmDialog] = useState(null); // { id, variant }

  // Toast
  const [toast, setToast]           = useState(null);
  const toastTimer = useRef(null);

  function showToast(msg) {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }

  // Derived
  const filtered = staff
    .filter(s => showInactive ? true : s.active)
    .filter(s => !query || s.display_name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) || a.display_name.localeCompare(b.display_name));

  const selectedStaff = selected ? staff.find(s => s.id === selected) : null;

  function handleUpdate(id, patch) {
    setStaff(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
    showToast('Changes saved');
  }

  function handleAddSave(newMember) {
    setStaff(prev => [...prev, newMember]);
    setSelected(newMember.id);
    setSheetOpen(false);
    showToast(`${newMember.display_name} added to the roster`);
  }

  function handlePinSaved(id) {
    setStaff(prev => prev.map(s => s.id === id ? { ...s, pin_set: true } : s));
    setPinModal(null);
    showToast('PIN updated');
  }

  function handleConfirm() {
    if (!confirmDialog) return;
    const { id, variant } = confirmDialog;
    const member = staff.find(s => s.id === id);
    if (variant === 'remove') {
      setStaff(prev => prev.filter(s => s.id !== id));
      if (selected === id) setSelected(null);
      showToast(`${member?.display_name} removed`);
    } else {
      setStaff(prev => prev.map(s => s.id === id ? { ...s, active: false } : s));
      showToast(`${member?.display_name} deactivated`);
    }
    setConfirmDialog(null);
  }

  const TABS = ['general', 'staff', 'notifications', 'billing'];
  const TAB_LABELS = { general: 'General', staff: 'Staff', notifications: 'Notifications', billing: 'Billing' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Settings tab bar */}
      <div className="settings-tabs">
        {TABS.map(t => (
          <button key={t} className={`settings-tab${tab === t ? ' active' : ''}`} type="button" onClick={() => setTab(t)}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab !== 'staff' ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted-foreground)', fontSize: 13 }}>
          <div style={{ textAlign: 'center', maxWidth: 320 }}>
            <div style={{ fontWeight: 600, fontSize: 16, color: 'var(--foreground)', marginBottom: 6 }}>{TAB_LABELS[tab]}</div>
            Not part of this prototype. The Staff tab shows the full flow.
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, overflow: 'auto', padding: '24px 32px' }}>
          {/* Section header */}
          <div className="section-header">
            <div>
              <div className="section-title">Staff</div>
              <div className="section-sub">
                {staff.filter(s => s.active).length} active · {staff.length} total
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted-foreground)', cursor: 'pointer', userSelect: 'none' }}>
                <UMToggle checked={showInactive} onChange={setShowInactive} />
                Show inactive
              </label>
              <button className="btn btn-primary btn-sm" type="button" onClick={() => setSheetOpen(true)}>
                <UM.Plus size={13} /> Add staff
              </button>
            </div>
          </div>

          {/* Table + panel */}
          <div className="staff-layout">
            {/* Table */}
            <div className="card staff-table-wrap">
              {/* Search bar */}
              <div className="staff-search-bar">
                <div className="input-wrap" style={{ flex: 1 }}>
                  <UM.Search />
                  <input className="input with-icon" placeholder="Search staff…" value={query} onChange={e => setQuery(e.target.value)} />
                </div>
              </div>

              <table className="staff-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Role</th>
                    <th>PIN</th>
                    <th>Status</th>
                    <th>Added</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr><td colSpan={5} style={{ padding: '32px', textAlign: 'center', color: 'var(--muted-foreground)', fontSize: 13 }}>
                      No staff match your search.
                    </td></tr>
                  )}
                  {filtered.map(s => (
                    <tr
                      key={s.id}
                      className={selected === s.id ? 'selected' : ''}
                      onClick={() => setSelected(s.id === selected ? null : s.id)}
                      style={{ opacity: s.active ? 1 : 0.55 }}
                    >
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <StaffAv name={s.display_name} color={s.color} size={30} />
                          <div>
                            <div style={{ fontWeight: 500, fontSize: 13 }}>{s.display_name}</div>
                          </div>
                        </div>
                      </td>
                      <td><UMBadge tone="default">{getRoleLabel(s.role)}</UMBadge></td>
                      <td>
                        {s.pin_set
                          ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--success)' }}><UM.Check size={12} />Set</span>
                          : <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>—</span>}
                      </td>
                      <td>
                        <UMBadge tone={s.active ? 'success' : 'default'}>
                          {s.active ? 'Active' : 'Inactive'}
                        </UMBadge>
                      </td>
                      <td style={{ color: 'var(--muted-foreground)', fontSize: 12, whiteSpace: 'nowrap' }}>{s.created_at}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Right panel */}
            {selectedStaff ? (
              <EditPanel
                key={selectedStaff.id}
                staff={selectedStaff}
                onUpdate={handleUpdate}
                onPinOpen={(id, mode) => setPinModal({ id, mode })}
                onDeactivate={id => setConfirmDialog({ id, variant: 'deactivate' })}
                onRemove={id => setConfirmDialog({ id, variant: 'remove' })}
              />
            ) : (
              <div className="card">
                <div className="empty-panel">
                  <UM.Users size={28} style={{ color: 'var(--muted-foreground)', opacity: 0.5 }} />
                  <div>
                    <div style={{ fontWeight: 500, color: 'var(--foreground)', marginBottom: 4 }}>Select a staff member</div>
                    <div style={{ color: 'var(--muted-foreground)', lineHeight: 1.5 }}>Click a row to view and edit their details, role, and PIN.</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Overlays */}
      {sheetOpen && (
        <AddStaffSheet
          onClose={() => setSheetOpen(false)}
          onSave={handleAddSave}
        />
      )}

      {pinModal && (() => {
        const member = staff.find(s => s.id === pinModal.id);
        return member ? (
          <PinModal
            staffName={member.display_name}
            mode={pinModal.mode}
            onSuccess={() => handlePinSaved(pinModal.id)}
            onClose={() => setPinModal(null)}
          />
        ) : null;
      })()}

      {confirmDialog && (() => {
        const member = staff.find(s => s.id === confirmDialog.id);
        return member ? (
          <ConfirmDialog
            staffName={member.display_name}
            variant={confirmDialog.variant}
            onConfirm={handleConfirm}
            onClose={() => setConfirmDialog(null)}
          />
        ) : null;
      })()}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--neutral-900)', color: 'white',
          padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 500,
          boxShadow: 'var(--shadow-md)', zIndex: 100,
          display: 'flex', alignItems: 'center', gap: 8,
          animation: 'umFadeIn 200ms var(--ease-out)',
          pointerEvents: 'none',
        }}>
          <UM.Check size={14} style={{ color: 'var(--success)' }} />
          {toast}
        </div>
      )}
    </div>
  );
}

window.StaffSettings = StaffSettings;
