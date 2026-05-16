// Onboarding.jsx — Settings → Onboarding page.
//
// Lists pending invites, active accounts, and offboarded users in three
// stacked sections, each with its own row actions. Primary CTA opens the
// OnboardSheet wizard. Per-row menus open OffboardSheet (soft) and
// RemoveSheet (hard).

const { useState: useStateOnb, useEffect: useEffectOnb, useRef: useRefOnb, useMemo: useMemoOnb } = React;

function OnboardingPage({ initialTweaks }) {
  const [users, setUsers]       = useStateOnb(INITIAL_USERS);
  const [query, setQuery]       = useStateOnb('');
  const [tab, setTab]           = useStateOnb('onboarding');

  // Sheets
  const [onboardOpen, setOnboardOpen] = useStateOnb(false);
  const [onboardMode, setOnboardMode] = useStateOnb(initialTweaks?.startMode || 'thorough');
  const [offboardTarget, setOffboardTarget] = useStateOnb(null); // user
  const [removeTarget, setRemoveTarget]     = useStateOnb(null); // user

  // Toast
  const [toast, setToast] = useStateOnb(null);
  const toastTimer = useRefOnb(null);
  function showToast(msg, tone = 'success') {
    setToast({ msg, tone });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }

  // ─── Demo state from tweaks ────────────────────────────────────────────
  useEffectOnb(() => {
    if (!initialTweaks) return;
    if (initialTweaks.demoSheet === 'onboard')  setOnboardOpen(true);
    if (initialTweaks.demoSheet === 'offboard') setOffboardTarget(users.find(u => u.state === 'active' && !u.is_you));
    if (initialTweaks.demoSheet === 'remove')   setRemoveTarget(users.find(u => u.state === 'offboarded'));
    setOnboardMode(initialTweaks.startMode || 'thorough');
  }, []);

  // ─── Derived ───────────────────────────────────────────────────────────
  const filtered = useMemoOnb(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(u =>
      u.display_name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q)
    );
  }, [users, query]);

  const pending      = filtered.filter(u => u.state === 'invited');
  const active       = filtered.filter(u => u.state === 'active')
    .sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9));
  const offboarded   = filtered.filter(u => u.state === 'offboarded');

  const stats = useMemoOnb(() => ({
    total: users.length,
    active: users.filter(u => u.state === 'active').length,
    pending: users.filter(u => u.state === 'invited').length,
    offboarded: users.filter(u => u.state === 'offboarded').length,
  }), [users]);

  // ─── Mutations ─────────────────────────────────────────────────────────
  function handleOnboard(newUser) {
    setUsers(prev => [newUser, ...prev]);
    showToast(`Invite sent to ${newUser.display_name}`);
  }

  function handleOffboard(updated) {
    setUsers(prev => prev.map(u => u.id === updated.id ? updated : u));
    showToast(`${updated.display_name} offboarded`);
  }

  function handleRemove(id) {
    const u = users.find(x => x.id === id);
    setUsers(prev => prev.filter(x => x.id !== id));
    showToast(`${u?.display_name || 'User'} permanently removed`, 'danger');
  }

  function handleResend(id) {
    showToast('Invite resent');
  }

  function handleCancelInvite(id) {
    const u = users.find(x => x.id === id);
    setUsers(prev => prev.filter(x => x.id !== id));
    showToast(`Invite to ${u?.display_name} cancelled`);
  }

  function handleReactivate(user) {
    setUsers(prev => prev.map(u => u.id === user.id ? {
      ...u,
      state: 'invited',
      invited_at: 'Just now',
      invited_by: 'Priya Raman',
      invite_method: 'magic_link',
      offboarded_at: null,
      offboarded_by: null,
      reason: null,
    } : u));
    showToast(`Reactivation invite sent to ${user.display_name}`);
  }

  // Settings tabs (now includes Onboarding)
  const TABS = ['general', 'staff', 'onboarding', 'notifications', 'billing'];
  const TAB_LABELS = {
    general: 'General',
    staff: 'Staff',
    onboarding: 'Onboarding',
    notifications: 'Notifications',
    billing: 'Billing',
  };

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

      {tab !== 'onboarding' ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted-foreground)', fontSize: 13 }}>
          <div style={{ textAlign: 'center', maxWidth: 320 }}>
            <div style={{ fontWeight: 600, fontSize: 16, color: 'var(--foreground)', marginBottom: 6 }}>{TAB_LABELS[tab]}</div>
            Not part of this prototype. The Onboarding tab shows the full flow.
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, overflow: 'auto' }}>
          <div className="onb-page">

            {/* Hero */}
            <div className="onb-hero">
              <div>
                <div className="onb-hero-title">Onboarding</div>
                <div className="onb-hero-sub">
                  Invite, manage, and offboard people with login access to Tang Nails Studio. Day-to-day staff edits (schedule, services, PIN) live in <a href="#" style={{ color: 'var(--foreground)' }}>Staff</a>.
                </div>
                <div className="onb-hero-stats">
                  <div className="onb-hero-stat">
                    <span className="onb-hero-stat-num">{stats.active}</span>
                    <span className="onb-hero-stat-label">Active</span>
                  </div>
                  <div className="onb-hero-stat">
                    <span className="onb-hero-stat-num" style={{ color: stats.pending > 0 ? 'oklch(0.55 0.13 75)' : 'var(--foreground)' }}>{stats.pending}</span>
                    <span className="onb-hero-stat-label">Pending</span>
                  </div>
                  <div className="onb-hero-stat">
                    <span className="onb-hero-stat-num" style={{ color: 'var(--muted-foreground)' }}>{stats.offboarded}</span>
                    <span className="onb-hero-stat-label">Offboarded</span>
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="input-wrap">
                  <UM.Search />
                  <input className="input input-sm with-icon" placeholder="Search name or email…" value={query} onChange={e => setQuery(e.target.value)} style={{ width: 220 }} />
                </div>
                <button className="btn btn-primary btn-sm" type="button" onClick={() => { setOnboardMode('thorough'); setOnboardOpen(true); }}>
                  <UM.UserPlus size={13} /> Onboard user
                </button>
              </div>
            </div>

            {/* Owners-only notice */}
            <div className="onb-notice">
              <UM.Info size={14} />
              <span>
                <b>Owners only.</b> Onboarding and offboarding are restricted to owner accounts. Managers can edit existing staff in the Staff tab but can't grant or revoke email login.
              </span>
            </div>

            {/* Pending invites */}
            <UserSection
              title="Pending invites"
              sub="Invitations sent but not yet accepted"
              icon={<UM.Mail size={13} />}
              count={pending.length}
              users={pending}
              kind="invited"
              onResend={handleResend}
              onCancel={handleCancelInvite}
              emptyText="No pending invites. Onboard someone to get started."
            />

            {/* Active accounts */}
            <UserSection
              title="Active accounts"
              sub="People with email login access"
              icon={<UM.Check size={13} />}
              count={active.length}
              users={active}
              kind="active"
              onOffboard={setOffboardTarget}
              emptyText="No active accounts yet."
            />

            {/* Offboarded */}
            {(offboarded.length > 0 || query) && (
              <UserSection
                title="Offboarded"
                sub="Login revoked. Reactivate to send a fresh invite. Permanent removal is one-way."
                icon={<UM.Archive size={13} />}
                count={offboarded.length}
                users={offboarded}
                kind="offboarded"
                onReactivate={handleReactivate}
                onRemove={setRemoveTarget}
                emptyText="No offboarded users."
              />
            )}
          </div>
        </div>
      )}

      {/* Sheets */}
      {onboardOpen && (
        <OnboardSheet
          initialMode={onboardMode}
          onClose={() => setOnboardOpen(false)}
          onSave={(u) => { handleOnboard(u); setOnboardOpen(false); }}
        />
      )}
      {offboardTarget && (
        <OffboardSheet
          user={offboardTarget}
          onClose={() => setOffboardTarget(null)}
          onConfirm={(u) => { handleOffboard(u); setOffboardTarget(null); }}
        />
      )}
      {removeTarget && (
        <RemoveSheet
          user={removeTarget}
          onClose={() => setRemoveTarget(null)}
          onConfirm={(id) => { handleRemove(id); setRemoveTarget(null); }}
        />
      )}

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
          {toast.tone === 'danger'
            ? <UM.AlertTri size={14} style={{ color: 'oklch(0.74 0.18 25)' }} />
            : <UM.Check size={14} style={{ color: 'var(--success)' }} />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ── Section of rows ────────────────────────────────────────────────────────
function UserSection({ title, sub, icon, count, users, kind, onResend, onCancel, onOffboard, onReactivate, onRemove, emptyText }) {
  return (
    <div className="onb-section">
      <div className="onb-section-head">
        <div className="onb-section-title">
          {icon}
          {title}
          <span className="onb-section-count">{count}</span>
        </div>
        <div className="onb-section-sub">{sub}</div>
      </div>

      <div className="onb-list">
        {users.length === 0 ? (
          <div className="onb-empty-row">{emptyText}</div>
        ) : (
          users.map(u => (
            <UserRow
              key={u.id}
              user={u}
              kind={kind}
              onResend={onResend}
              onCancel={onCancel}
              onOffboard={onOffboard}
              onReactivate={onReactivate}
              onRemove={onRemove}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── Single row ────────────────────────────────────────────────────────────
function UserRow({ user, kind, onResend, onCancel, onOffboard, onReactivate, onRemove }) {
  const [menuOpen, setMenuOpen] = useStateOnb(false);
  const anchorRef = useRefOnb(null);

  useEffectOnb(() => {
    if (!menuOpen) return;
    function onClick(e) {
      if (anchorRef.current && !anchorRef.current.contains(e.target)) setMenuOpen(false);
    }
    function onKey(e) { if (e.key === 'Escape') setMenuOpen(false); }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  let metaText, statusEl;
  if (kind === 'invited') {
    metaText = (
      <>
        <UM.Clock size={11} style={{ display: 'inline', verticalAlign: '-1px', marginRight: 4, color: 'var(--muted-foreground)' }} />
        Invited {user.invited_at}
      </>
    );
    statusEl = <span className="onb-status onb-status-invited"><span className="dot" />Invited</span>;
  } else if (kind === 'active') {
    metaText = <>Last sign-in {user.last_sign_in}</>;
    statusEl = <span className="onb-status onb-status-active"><span className="dot" />Active</span>;
  } else {
    metaText = <>Offboarded {user.offboarded_at}{user.reason ? ` · ${user.reason}` : ''}</>;
    statusEl = <span className="onb-status onb-status-offboard"><span className="dot" />Offboarded</span>;
  }

  return (
    <div className={`onb-row${user.is_you ? ' is-you' : ''}`}>
      <div className="onb-person">
        <StaffAv name={user.display_name} color={user.color} size={36} />
        <div className="onb-person-text">
          <div className="onb-person-name">
            {user.display_name}
            {user.is_you && <span className="onb-you-tag">You</span>}
          </div>
          <div className="onb-person-email">{user.email}</div>
        </div>
      </div>

      <div className="onb-role-chip">
        <span className="onb-role-dot" style={{ background: user.color }} />
        {getRoleLabel(user.role)}
      </div>

      <div>{statusEl}</div>

      <div className="onb-meta">{metaText}</div>

      <div className="onb-row-actions onb-menu-anchor" ref={anchorRef}>
        {kind === 'invited' && (
          <>
            <button className="onb-icon-btn" title="Resend invite" onClick={() => onResend(user.id)}>
              <UM.RefreshCcw size={13} />
            </button>
            <button className="onb-icon-btn" title="Copy link" onClick={() => {}}>
              <UM.Link size={13} />
            </button>
            <button className="onb-icon-btn" title="More" onClick={() => setMenuOpen(o => !o)}>
              <UM.MoreHoriz size={14} />
            </button>
            {menuOpen && (
              <div className="onb-menu">
                <button className="onb-menu-item" onClick={() => { onResend(user.id); setMenuOpen(false); }}>
                  <UM.Send size={13} /> Resend invite
                </button>
                <button className="onb-menu-item" onClick={() => { setMenuOpen(false); }}>
                  <UM.Copy size={13} /> Copy invite link
                </button>
                <div className="onb-menu-sep" />
                <button className="onb-menu-item danger" onClick={() => { onCancel(user.id); setMenuOpen(false); }}>
                  <UM.X size={13} /> Cancel invite
                </button>
              </div>
            )}
          </>
        )}

        {kind === 'active' && (
          <>
            <button className="onb-icon-btn" title="More" onClick={() => setMenuOpen(o => !o)}>
              <UM.MoreHoriz size={14} />
            </button>
            {menuOpen && (
              <div className="onb-menu">
                <button className="onb-menu-item" onClick={() => setMenuOpen(false)}>
                  <UM.Pencil size={13} /> Edit in Staff
                </button>
                <button className="onb-menu-item" onClick={() => setMenuOpen(false)}>
                  <UM.Key size={13} /> Reset PIN
                </button>
                <button className="onb-menu-item" onClick={() => setMenuOpen(false)}>
                  <UM.Mail size={13} /> Send password reset
                </button>
                <div className="onb-menu-sep" />
                {user.is_you ? (
                  <div style={{ padding: '8px 10px', fontSize: 11, color: 'var(--muted-foreground)', lineHeight: 1.5 }}>
                    You can't offboard yourself. Another owner has to do it.
                  </div>
                ) : (
                  <button className="onb-menu-item danger" onClick={() => { onOffboard(user); setMenuOpen(false); }}>
                    <UM.Archive size={13} /> Offboard {user.display_name.split(' ')[0]}…
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {kind === 'offboarded' && (
          <>
            <button className="onb-icon-btn" title="More" onClick={() => setMenuOpen(o => !o)}>
              <UM.MoreHoriz size={14} />
            </button>
            {menuOpen && (
              <div className="onb-menu">
                <button className="onb-menu-item" onClick={() => { onReactivate(user); setMenuOpen(false); }}>
                  <UM.RefreshCcw size={13} /> Reactivate (resend invite)
                </button>
                <div className="onb-menu-sep" />
                <button className="onb-menu-item danger" onClick={() => { onRemove(user); setMenuOpen(false); }}>
                  <UM.Trash size={13} /> Remove permanently…
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { OnboardingPage });
