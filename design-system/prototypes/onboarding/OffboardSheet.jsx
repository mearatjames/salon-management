// OffboardSheet.jsx — Soft offboard (reversible). Right-side sheet.
//
// What it does:
//   • Revokes the user's email login (Supabase user banned)
//   • Hides them from the login PIN picker
//   • Keeps their history, past appointments, tip splits
//   • Reversible from the Offboarded list ("Reactivate")
//
// What it does NOT do:
//   • Delete or anonymize anything
//   • Touch their past tickets / payments
//
// Tone: calm and procedural. Mild friction (reason + final confirm).

const { useState: useStateO } = React;

function OffboardSheet({ user, onClose, onConfirm }) {
  const [reason, setReason] = useStateO(null);
  const [done, setDone]     = useStateO(false);

  function handleConfirm() {
    setDone(true);
    setTimeout(() => {
      onConfirm({
        ...user,
        state: 'offboarded',
        pin_set: false,
        offboarded_at: 'Just now',
        offboarded_by: 'Priya Raman',
        reason: reason || 'Not specified',
      });
    }, 900);
  }

  return (
    <div className="sheet-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet sheet-md">
        {/* Header */}
        <div className="off-header">
          <div className="off-header-row">
            <div className="off-header-titles">
              <div className="off-header-eyebrow">Offboard</div>
              <div className="off-header-title">Offboard {user.display_name.split(' ')[0]}?</div>
              <div className="off-header-sub">
                Their login is revoked and they're hidden from the staff list. History is preserved. You can reactivate them later.
              </div>
            </div>
            <button className="btn btn-ghost btn-icon" type="button" onClick={onClose}>
              <UM.X size={16} />
            </button>
          </div>

          <div className="off-person-card">
            <StaffAv name={user.display_name} color={user.color} size={40} />
            <div className="off-person-info">
              <div className="off-person-name">{user.display_name}</div>
              <div className="off-person-meta">{getRoleLabel(user.role)} · {user.email}</div>
            </div>
            <UMBadge tone="success">Active</UMBadge>
          </div>
        </div>

        {done ? (
          <div className="sheet-success">
            <div className="success-icon-circle" style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}>
              <UM.Archive size={20} />
            </div>
            <div>
              <div className="sheet-success-title">{user.display_name.split(' ')[0]} offboarded</div>
              <div className="sheet-success-sub">
                Their login is revoked and they've been moved to the Offboarded list. You can reactivate them anytime.
              </div>
            </div>

            <div className="sheet-footer" style={{ marginTop: 'auto', width: '100%', borderTop: '1px solid var(--border)' }}>
              <button className="btn btn-primary btn-sm" type="button" onClick={onClose} style={{ marginLeft: 'auto' }}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="sheet-body">
              {/* What happens */}
              <div className="form-field">
                <label className="form-label">What happens</label>
                <div className="impact-list">
                  <div className="impact-row">
                    <div className="impact-icon revoke"><UM.LogOut size={13} /></div>
                    <div className="impact-text">
                      <div className="impact-title">Email login revoked</div>
                      <div className="impact-sub">Their email + password / magic link stops working immediately.</div>
                    </div>
                  </div>
                  <div className="impact-row">
                    <div className="impact-icon revoke"><UM.EyeOff size={13} /></div>
                    <div className="impact-text">
                      <div className="impact-title">Hidden from the login picker</div>
                      <div className="impact-sub">They won't appear on shared iPads. Their PIN is cleared.</div>
                    </div>
                  </div>
                  <div className="impact-row">
                    <div className="impact-icon keep"><UM.Check size={13} /></div>
                    <div className="impact-text">
                      <div className="impact-title">History stays</div>
                      <div className="impact-sub">Past appointments, payments, and tip splits are unchanged.</div>
                    </div>
                  </div>
                  <div className="impact-row">
                    <div className="impact-icon keep"><UM.RefreshCcw size={13} /></div>
                    <div className="impact-text">
                      <div className="impact-title">Reversible</div>
                      <div className="impact-sub">Reactivate from the Offboarded list — invite re-issued, PIN reset.</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Reason */}
              <div className="form-field">
                <label className="form-label">Reason <span style={{ color: 'var(--muted-foreground)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
                <div className="reason-options">
                  {OFFBOARD_REASONS.map(r => (
                    <button
                      key={r}
                      type="button"
                      className={`reason-tile${reason === r ? ' active' : ''}`}
                      onClick={() => setReason(reason === r ? null : r)}
                    >
                      {r}
                    </button>
                  ))}
                </div>
                <span className="form-hint">Logged in the audit trail. Only visible to owners.</span>
              </div>
            </div>

            <div className="sheet-footer">
              <button className="btn btn-outline btn-sm" type="button" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary btn-sm" type="button" onClick={handleConfirm}>
                <UM.Archive size={12} /> Offboard {user.display_name.split(' ')[0]}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { OffboardSheet });
