// OnboardSheet.jsx — Wizard sheet to invite a new user (Auth account).
//
// Two modes:
//   - quick:    1 screen — name, role, email. Send invite, defer everything else.
//   - thorough: 4 steps — Identity → Email invite → Set PIN → Permissions summary
//
// The user toggles between modes via the mode pill in the sheet header.
// "User" = Supabase Auth account; staff record is created alongside.

const { useState, useCallback, useEffect, useMemo } = React;

const PIN_LEN = 4;

// ── Role picker tiles ──────────────────────────────────────────────────────
function RolePicker({ value, onChange }) {
  const ROLES = [
    { id: 'owner',      label: 'Owner',      sub: 'Full access, all settings' },
    { id: 'manager',    label: 'Manager',    sub: 'Approves refunds & voids' },
    { id: 'technician', label: 'Tech',       sub: 'Performs services' },
    { id: 'front_desk', label: 'Front desk', sub: 'Books, runs kiosk' },
  ];
  return (
    <div className="role-grid">
      {ROLES.map(r => (
        <button
          key={r.id}
          type="button"
          className={`role-tile${value === r.id ? ' active' : ''}`}
          onClick={() => onChange(r.id)}
        >
          <span className="role-tile-radio" />
          <span className="role-tile-text">
            <span className="role-tile-label">{r.label}</span>
            <span className="role-tile-sub">{r.sub}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

// ── Color picker (compact) ────────────────────────────────────────────────
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

// ── Inline PIN entry (the same look as PinModal but inline) ───────────────
function InlinePin({ name, onConfirmed, onSkip }) {
  const [phase, setPhase] = useState(1); // 1=enter, 2=confirm
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const [err, setErr] = useState('');

  const digits = (phase === 1 ? first : second).split('');

  const handle = useCallback((d) => {
    setErr('');
    const cur = phase === 1 ? first : second;
    if (cur.length >= PIN_LEN) return;
    const next = cur + d;
    if (phase === 1) setFirst(next); else setSecond(next);
    if (next.length === PIN_LEN) {
      setTimeout(() => {
        if (phase === 1) setPhase(2);
        else if (next === first) onConfirmed(next);
        else { setErr("PINs didn't match. Try again."); setFirst(''); setSecond(''); setPhase(1); }
      }, 160);
    }
  }, [phase, first, second, onConfirmed]);

  const clear = useCallback((t) => {
    setErr('');
    if (phase === 1) setFirst(p => t === 'all' ? '' : p.slice(0, -1));
    else setSecond(p => t === 'all' ? '' : p.slice(0, -1));
  }, [phase]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>
          {phase === 1 ? `Choose a 4-digit PIN for ${name || 'this user'}` : 'Enter the same PIN again'}
        </div>
      </div>

      <div className="pin-dots">
        {Array.from({ length: PIN_LEN }, (_, i) => (
          <span key={i} className={`pin-dot${i < digits.length ? ' filled' : ''}${err ? ' error' : ''}`} />
        ))}
      </div>

      <div className="mini-keypad">
        {['1','2','3','4','5','6','7','8','9'].map(d => (
          <button key={d} className="mini-key" type="button" onClick={() => handle(d)}>{d}</button>
        ))}
        <span />
        <button className="mini-key" type="button" onClick={() => handle('0')}>0</button>
        <button className="mini-key fn" type="button" onClick={() => clear('back')}><UM.Backspace size={14} /></button>
      </div>

      <div className="pin-error-msg">{err}</div>

      <button className="btn btn-ghost btn-sm" type="button" onClick={onSkip} style={{ marginTop: -4 }}>
        Skip — they can set it on first login
      </button>
    </div>
  );
}

// ── Permission summary card ───────────────────────────────────────────────
function PermissionCard({ role, name, color }) {
  const def = ROLE_PERMISSIONS[role];
  if (!def) return null;
  return (
    <div className="perm-card">
      <div className="perm-card-head">
        <StaffAv name={name || '?'} color={color} size={28} />
        <div>
          <div className="perm-card-head-title">{name || 'New user'} · {def.label}</div>
          <div className="perm-card-head-sub">{def.summary}</div>
        </div>
      </div>
      <div className="perm-card-body">
        <div className="perm-list">
          <div className="perm-list-label">Can do</div>
          {def.grants.map(g => (
            <div className="perm-item grant" key={g}>
              <UM.Check className="ico" size={14} />
              <span>{g}</span>
            </div>
          ))}
        </div>
        {def.blocks.length > 0 && (
          <div className="perm-list">
            <div className="perm-list-label">Can't do</div>
            {def.blocks.map(b => (
              <div className="perm-item block" key={b}>
                <UM.Lock className="ico" size={13} />
                <span>{b}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Email preview ─────────────────────────────────────────────────────────
function EmailPreview({ name, email, method }) {
  const subject = 'Your invite to Tang Nails Studio';
  const cta = method === 'password' ? 'Set up your password' : 'Open Tang Nails Studio';
  const intro = method === 'password'
    ? `Priya Raman invited you to join Tang Nails Studio. Set a password to finish setting up your account.`
    : `Priya Raman invited you to join Tang Nails Studio. Tap the button below to sign in — no password needed.`;

  return (
    <div className="email-preview">
      <div className="email-preview-head">
        <span className="dot r" /><span className="dot y" /><span className="dot g" />
        <span style={{ marginLeft: 6 }}>Preview · this is what {name || 'they'} will see</span>
      </div>
      <div className="email-preview-body">
        <div className="email-preview-from">
          From <b>Tang Nails Studio</b> &lt;noreply@tangnails.com&gt;<br />
          To &lt;{email || 'their.email@example.com'}&gt;
        </div>
        <div className="email-preview-subject">{subject}</div>
        <p>Hi {name?.split(' ')[0] || 'there'},</p>
        <p>{intro}</p>
        <div className="email-preview-cta">{cta}</div>
        <div className="email-preview-foot">
          {method === 'magic_link'
            ? 'This link is valid for 24 hours. If you didn\'t expect this, ignore the email.'
            : 'This link is valid for 7 days. You\'ll be asked to choose a password.'}
        </div>
      </div>
    </div>
  );
}

// ── Main sheet ────────────────────────────────────────────────────────────
function OnboardSheet({ onClose, onSave, initialMode = 'thorough' }) {
  const [mode, setMode] = useState(initialMode); // 'quick' | 'thorough'
  const [step, setStep] = useState(1);

  // Form
  const [name, setName]   = useState('');
  const [role, setRole]   = useState('technician');
  const [color, setColor] = useState(STAFF_COLORS[2].value);
  const [email, setEmail] = useState('');
  const [method, setMethod] = useState('magic_link'); // 'magic_link' | 'password'
  const [pin, setPin]     = useState(null); // string | null
  const [done, setDone]   = useState(false);

  // Step navigation lives only in thorough mode
  const TOTAL_STEPS = 4;

  function emailValid(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

  const canProceedStep1 = name.trim().length >= 2;
  const canProceedStep2 = emailValid(email);
  const canSendQuick    = name.trim().length >= 2 && emailValid(email);

  function handleSendInvite(pinValue = null) {
    setDone(true);
    setTimeout(() => {
      onSave({
        id: 'u-' + Date.now(),
        display_name: name.trim(),
        email: email.trim(),
        role,
        color,
        state: 'invited',
        pin_set: !!pinValue,
        invited_at: 'Just now',
        invited_by: 'Priya Raman',
        invite_method: method,
      });
    }, 1100);
  }

  // ─── Quick mode ───────────────────────────────────────────────────────
  if (mode === 'quick') {
    return (
      <div className="sheet-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
        <div className="sheet">
          <div className="sheet-header">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="sheet-title">Onboard a user</div>
              <ModePill mode={mode} setMode={setMode} />
            </div>
            <button className="btn btn-ghost btn-icon" type="button" onClick={onClose}>
              <UM.X size={16} />
            </button>
          </div>

          {done ? (
            <SuccessState name={name} email={email} method={method} role={role} color={color} pinSet={false} onClose={onClose} />
          ) : (
            <>
              <div className="sheet-body">
                <div className="wiz-heading">
                  <div className="wiz-heading-title">Send an invite — fast</div>
                  <div className="wiz-heading-sub">
                    Email + role is enough to get them in. They'll set their own PIN and avatar on first login.
                  </div>
                </div>

                <div className="quick-form">
                  <div className="form-field">
                    <label className="form-label">Full name</label>
                    <input
                      className="input"
                      placeholder="e.g. Hana Soto"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <div className="form-field">
                    <label className="form-label">Work email</label>
                    <input
                      className="input"
                      type="email"
                      placeholder="hana@tangnails.com"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                    />
                    <span className="form-hint">We'll send the invite link here.</span>
                  </div>
                  <div className="form-field">
                    <label className="form-label">Role</label>
                    <RolePicker value={role} onChange={setRole} />
                  </div>
                  <div className="quick-tip">
                    <UM.Info size={12} style={{ display: 'inline', verticalAlign: '-1px', marginRight: 4, color: 'var(--muted-foreground)' }} />
                    <b>Quick mode</b> sends a magic-link invite and defers PIN + avatar. Need to set those now? Switch to <b>Thorough</b> above.
                  </div>
                </div>
              </div>

              <div className="sheet-footer">
                <button className="btn btn-outline btn-sm" type="button" onClick={onClose}>Cancel</button>
                <button
                  className="btn btn-primary btn-sm"
                  type="button"
                  disabled={!canSendQuick}
                  onClick={() => handleSendInvite()}
                >
                  <UM.Send size={12} /> Send invite
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ─── Thorough mode ────────────────────────────────────────────────────
  return (
    <div className="sheet-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet sheet-md">
        <div className="sheet-header">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="sheet-title">Onboard a user</div>
            <ModePill mode={mode} setMode={setMode} />
          </div>
          <button className="btn btn-ghost btn-icon" type="button" onClick={onClose}>
            <UM.X size={16} />
          </button>
        </div>

        {done ? (
          <SuccessState name={name} email={email} method={method} role={role} color={color} pinSet={!!pin} onClose={onClose} />
        ) : (
          <>
            {/* Step bar */}
            <div className="sheet-step-bar">
              {[
                { n: 1, label: 'Identity' },
                { n: 2, label: 'Invite' },
                { n: 3, label: 'PIN' },
                { n: 4, label: 'Review' },
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

            {/* Step body */}
            <div className="sheet-body">
              {step === 1 && (
                <>
                  <div className="wiz-heading">
                    <div className="wiz-heading-title">Who are you onboarding?</div>
                    <div className="wiz-heading-sub">
                      Their role determines what they can do in the app. You can change it anytime in Staff.
                    </div>
                  </div>

                  <div className="form-field">
                    <label className="form-label">Full name</label>
                    <input
                      className="input"
                      placeholder="e.g. Hana Soto"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      autoFocus
                    />
                  </div>

                  <div className="form-field">
                    <label className="form-label">Role</label>
                    <RolePicker value={role} onChange={setRole} />
                  </div>

                  <div className="form-field">
                    <label className="form-label">Avatar color</label>
                    <ColorPicker value={color} onChange={setColor} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
                      <StaffAv name={name || '?'} color={color} size={32} />
                      <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
                        Shown on the login screen and the calendar.
                      </span>
                    </div>
                  </div>
                </>
              )}

              {step === 2 && (
                <>
                  <div className="wiz-heading">
                    <div className="wiz-heading-title">Send {name?.split(' ')[0] || 'them'} an invite</div>
                    <div className="wiz-heading-sub">
                      Their email becomes their login. They'll receive a one-time link to finish setting up their account.
                    </div>
                  </div>

                  <div className="form-field">
                    <label className="form-label">Work email</label>
                    <div className="input-wrap">
                      <UM.Mail />
                      <input
                        className="input with-icon"
                        type="email"
                        placeholder="hana@tangnails.com"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                      />
                    </div>
                    {email && !emailValid(email) && (
                      <span className="form-hint" style={{ color: 'var(--destructive)' }}>That doesn't look like a valid email.</span>
                    )}
                  </div>

                  <div className="form-field">
                    <label className="form-label">Invite method</label>
                    <div className="invite-method-list">
                      <button
                        type="button"
                        className={`invite-method-tile${method === 'magic_link' ? ' active' : ''}`}
                        onClick={() => setMethod('magic_link')}
                      >
                        <span className="invite-method-icon"><UM.Link size={15} /></span>
                        <span className="invite-method-text">
                          <span className="invite-method-title">Magic link</span>
                          <span className="invite-method-sub">One-tap sign-in via email. Best for trusted devices.</span>
                        </span>
                        <UM.Check className="invite-method-check" size={16} />
                      </button>
                      <button
                        type="button"
                        className={`invite-method-tile${method === 'password' ? ' active' : ''}`}
                        onClick={() => setMethod('password')}
                      >
                        <span className="invite-method-icon"><UM.Key size={15} /></span>
                        <span className="invite-method-text">
                          <span className="invite-method-title">Set up a password</span>
                          <span className="invite-method-sub">They pick a password on first visit, then sign in normally.</span>
                        </span>
                        <UM.Check className="invite-method-check" size={16} />
                      </button>
                    </div>
                  </div>

                  {email && emailValid(email) && (
                    <EmailPreview name={name} email={email} method={method} />
                  )}
                </>
              )}

              {step === 3 && (
                <>
                  <div className="wiz-heading">
                    <div className="wiz-heading-title">Set a login PIN</div>
                    <div className="wiz-heading-sub">
                      Once {name?.split(' ')[0] || 'they'} sign in, they'll also need a 4-digit PIN to act as themselves on shared iPads. You can set it now, or let them choose.
                    </div>
                  </div>

                  {pin ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '20px 0' }}>
                      <div className="success-icon-circle"><UM.Check size={22} /></div>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>PIN set</div>
                      <div style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
                        {name?.split(' ')[0] || 'They'} can sign in and use this PIN immediately.
                      </div>
                      <button className="btn btn-ghost btn-sm" type="button" onClick={() => setPin(null)}>
                        Change PIN
                      </button>
                    </div>
                  ) : (
                    <InlinePin
                      name={name}
                      onConfirmed={(p) => setPin(p)}
                      onSkip={() => setPin(null)}
                    />
                  )}
                </>
              )}

              {step === 4 && (
                <>
                  <div className="wiz-heading">
                    <div className="wiz-heading-title">Review &amp; send</div>
                    <div className="wiz-heading-sub">
                      We'll create their staff record, send the invite email, and wait for them to accept.
                    </div>
                  </div>

                  <div className="review-list">
                    <div className="review-row">
                      <span className="review-row-label">Person</span>
                      <span className="review-row-value">
                        <StaffAv name={name} color={color} size={24} />
                        {name || '—'}
                      </span>
                    </div>
                    <div className="review-row">
                      <span className="review-row-label">Role</span>
                      <span className="review-row-value">{ROLE_PERMISSIONS[role]?.label}</span>
                    </div>
                    <div className="review-row">
                      <span className="review-row-label">Email</span>
                      <span className="review-row-value tnum">{email}</span>
                    </div>
                    <div className="review-row">
                      <span className="review-row-label">Invite method</span>
                      <span className="review-row-value">{method === 'magic_link' ? 'Magic link' : 'Password setup'}</span>
                    </div>
                    <div className="review-row">
                      <span className="review-row-label">Login PIN</span>
                      <span className="review-row-value" style={{ color: pin ? 'var(--success)' : 'var(--muted-foreground)' }}>
                        {pin ? <><UM.Check size={13} /> Set</> : 'Will set on first login'}
                      </span>
                    </div>
                  </div>

                  <PermissionCard role={role} name={name} color={color} />
                </>
              )}
            </div>

            {/* Footer */}
            <div className="sheet-footer">
              {step > 1 ? (
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => setStep(step - 1)}>
                  <UM.ArrowLeft size={12} /> Back
                </button>
              ) : (
                <button className="btn btn-outline btn-sm" type="button" onClick={onClose}>Cancel</button>
              )}

              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                {step < TOTAL_STEPS && (
                  <button
                    className="btn btn-primary btn-sm"
                    type="button"
                    disabled={
                      (step === 1 && !canProceedStep1) ||
                      (step === 2 && !canProceedStep2)
                    }
                    onClick={() => setStep(step + 1)}
                  >
                    Continue
                  </button>
                )}
                {step === TOTAL_STEPS && (
                  <button
                    className="btn btn-primary btn-sm"
                    type="button"
                    onClick={() => handleSendInvite(pin)}
                  >
                    <UM.Send size={12} /> Send invite
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Mode pill (quick / thorough) ──────────────────────────────────────────
function ModePill({ mode, setMode }) {
  return (
    <div className="sheet-mode">
      <button type="button" className={mode === 'quick' ? 'active' : ''} onClick={() => setMode('quick')}>
        Quick
      </button>
      <button type="button" className={mode === 'thorough' ? 'active' : ''} onClick={() => setMode('thorough')}>
        Thorough
      </button>
    </div>
  );
}

// ── Success splash ─────────────────────────────────────────────────────────
function SuccessState({ name, email, method, role, color, pinSet, onClose }) {
  return (
    <div className="sheet-success">
      <div className="success-icon-circle"><UM.Send size={20} /></div>
      <div>
        <div className="sheet-success-title">Invite sent</div>
        <div className="sheet-success-sub">
          {name?.split(' ')[0] || 'They'} should receive an email at <b>{email}</b> within a minute. They'll show up under <b>Pending invites</b> until they accept.
        </div>
      </div>

      <div className="sheet-success-card">
        <StaffAv name={name} color={color} size={36} />
        <div className="sheet-success-card-text">
          <div className="sheet-success-card-title">{name}</div>
          <div className="sheet-success-card-sub">
            {ROLE_PERMISSIONS[role]?.label} · {method === 'magic_link' ? 'Magic link sent' : 'Password setup link sent'}
            {pinSet ? ' · PIN ready' : ''}
          </div>
        </div>
      </div>

      <div className="sheet-footer" style={{ marginTop: 'auto', width: '100%', borderTop: '1px solid var(--border)' }}>
        <button className="btn btn-ghost btn-sm" type="button" onClick={onClose}>
          <UM.Copy size={12} /> Copy invite link
        </button>
        <button className="btn btn-primary btn-sm" type="button" onClick={onClose} style={{ marginLeft: 'auto' }}>
          Done
        </button>
      </div>
    </div>
  );
}

Object.assign(window, { OnboardSheet });
