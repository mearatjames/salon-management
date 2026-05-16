// RemoveSheet.jsx — Hard remove (irreversible, anonymizes). Right-side sheet.
//
// Friction:
//   • Destructive header (tinted)
//   • Two acknowledgement checkboxes
//   • Typed-name confirmation (must match display name, case-insensitive)
//   • Destructive button stays disabled until both ack + typed-name match
//
// What it does:
//   • Deletes the Supabase Auth user
//   • Anonymizes their staff record (name → "Former staff #NNN")
//   • Keeps past tickets attached but unattributed
//   • Cannot be undone

const { useState: useStateR, useMemo: useMemoR } = React;

function RemoveSheet({ user, onClose, onConfirm }) {
  const [ackHistory, setAckHistory]   = useStateR(false);
  const [ackIrrev, setAckIrrev]       = useStateR(false);
  const [typed, setTyped]             = useStateR('');
  const [done, setDone]               = useStateR(false);

  const target = user.display_name;
  const typedOk = typed.trim().toLowerCase() === target.toLowerCase();
  const canRemove = ackHistory && ackIrrev && typedOk;

  function handleConfirm() {
    if (!canRemove) return;
    setDone(true);
    setTimeout(() => onConfirm(user.id), 900);
  }

  return (
    <div className="sheet-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet sheet-md">
        {/* Header */}
        <div className="off-header danger">
          <div className="off-header-row">
            <div className="off-header-titles">
              <div className="off-header-eyebrow"><UM.AlertTri size={11} style={{ display: 'inline', verticalAlign: '-1px', marginRight: 4 }} />Permanently remove</div>
              <div className="off-header-title">Remove {target}</div>
              <div className="off-header-sub">
                This deletes their account and anonymizes their record. Past tickets stay in the books, but the name is replaced with "Former staff". <b style={{ color: 'var(--destructive)' }}>This can't be undone.</b>
              </div>
            </div>
            <button className="btn btn-ghost btn-icon" type="button" onClick={onClose}>
              <UM.X size={16} />
            </button>
          </div>

          <div className="off-person-card">
            <StaffAv name={target} color={user.color} size={40} />
            <div className="off-person-info">
              <div className="off-person-name">{target}</div>
              <div className="off-person-meta">{getRoleLabel(user.role)} · {user.email || 'No email'}</div>
            </div>
            <UMBadge tone="destructive">Will be deleted</UMBadge>
          </div>
        </div>

        {done ? (
          <div className="sheet-success">
            <div className="success-icon-circle" style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}>
              <UM.Trash size={20} />
            </div>
            <div>
              <div className="sheet-success-title">{target} removed</div>
              <div className="sheet-success-sub">
                Their account is deleted and their record has been anonymized. This is permanent.
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
                    <div className="impact-icon danger"><UM.Trash size={13} /></div>
                    <div className="impact-text">
                      <div className="impact-title">Account deleted</div>
                      <div className="impact-sub">Their Supabase user is removed. Email becomes free to reuse.</div>
                    </div>
                  </div>
                  <div className="impact-row">
                    <div className="impact-icon danger"><UM.EyeOff size={13} /></div>
                    <div className="impact-text">
                      <div className="impact-title">Staff record anonymized</div>
                      <div className="impact-sub">Name and email replaced with "Former staff". Avatar reset to slate.</div>
                    </div>
                  </div>
                  <div className="impact-row">
                    <div className="impact-icon keep"><UM.Check size={13} /></div>
                    <div className="impact-text">
                      <div className="impact-title">Past tickets stay</div>
                      <div className="impact-sub">Revenue, refunds, and tip allocations remain on the books — just unattributed.</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Acknowledgements */}
              <div className="form-field">
                <label className="form-label">Acknowledge</label>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', background: ackHistory ? 'color-mix(in oklch, var(--primary) 5%, transparent)' : 'var(--card)' }}>
                  <input
                    type="checkbox"
                    checked={ackHistory}
                    onChange={e => setAckHistory(e.target.checked)}
                    style={{ marginTop: 3, accentColor: 'var(--primary)' }}
                  />
                  <span style={{ fontSize: 12, lineHeight: 1.5 }}>
                    I understand <b>past tickets and tip splits will remain</b> attributed to a placeholder, not <b>{target}</b>.
                  </span>
                </label>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', background: ackIrrev ? 'color-mix(in oklch, var(--primary) 5%, transparent)' : 'var(--card)' }}>
                  <input
                    type="checkbox"
                    checked={ackIrrev}
                    onChange={e => setAckIrrev(e.target.checked)}
                    style={{ marginTop: 3, accentColor: 'var(--primary)' }}
                  />
                  <span style={{ fontSize: 12, lineHeight: 1.5 }}>
                    I understand this is <b>irreversible</b>. If unsure, use <b>Offboard</b> instead — it's reversible.
                  </span>
                </label>
              </div>

              {/* Typed confirmation */}
              <div className="confirm-block">
                <div className="confirm-block-label">
                  To confirm, type <b>{target}</b> below.
                </div>
                <input
                  className={`input confirm-input${typed && (typedOk ? ' ok' : ' bad')}`}
                  placeholder={target}
                  value={typed}
                  onChange={e => setTyped(e.target.value)}
                  autoComplete="off"
                  spellCheck="false"
                />
              </div>
            </div>

            <div className="sheet-footer">
              <button className="btn btn-outline btn-sm" type="button" onClick={onClose}>Cancel</button>
              <button
                className="btn btn-danger btn-sm"
                type="button"
                disabled={!canRemove}
                onClick={handleConfirm}
              >
                <UM.Trash size={12} /> Permanently remove
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { RemoveSheet });
