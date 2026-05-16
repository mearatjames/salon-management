// PinModal.jsx — PIN setup/change modal + ConfirmDialog
const { useState, useCallback, useEffect } = React;

const PIN_LENGTH = 4;
const DIGITS = ['1','2','3','4','5','6','7','8','9','0'];

// ── Mini keypad (reusable) ─────────────────────────────────────────────────
function MiniKeypad({ digits, onAppend, onClear, errorState }) {
  useEffect(() => {
    function onKey(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (DIGITS.includes(e.key)) { e.preventDefault(); onAppend(e.key); }
      else if (e.key === 'Backspace') { e.preventDefault(); onClear('back'); }
      else if (e.key === 'Escape') { e.preventDefault(); onClear('all'); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onAppend, onClear]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, width: '100%' }}>
      {/* Dot display */}
      <div className="pin-dots">
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <span key={i} className={`pin-dot${i < digits.length ? ' filled' : ''}${errorState ? ' error' : ''}`} />
        ))}
      </div>
      {/* Keypad grid */}
      <div className="mini-keypad">
        {['1','2','3','4','5','6','7','8','9'].map(d => (
          <button key={d} className="mini-key" type="button" onClick={() => onAppend(d)}>{d}</button>
        ))}
        <span />
        <button className="mini-key" type="button" onClick={() => onAppend('0')}>0</button>
        <button className="mini-key fn" type="button" onClick={() => onClear('back')}>
          <UM.Backspace size={15} />
        </button>
      </div>
    </div>
  );
}

// ── PinModal ──────────────────────────────────────────────────────────────
// mode: 'set' | 'change'
// onSuccess(pin): called when PIN confirmed
// onClose(): called on cancel
function PinModal({ staffName, mode = 'set', onSuccess, onClose }) {
  const [step, setStep] = useState(1);   // 1 = enter, 2 = confirm
  const [first, setFirst]   = useState('');
  const [second, setSecond] = useState('');
  const [error, setError]   = useState('');

  const currentDigits = step === 1 ? first.split('') : second.split('');
  const isError = !!error;

  const handleAppend = useCallback((d) => {
    setError('');
    if (step === 1) {
      setFirst(prev => {
        if (prev.length >= PIN_LENGTH) return prev;
        const next = prev + d;
        if (next.length === PIN_LENGTH) {
          // auto-advance after short delay so user sees 4th dot
          setTimeout(() => setStep(2), 160);
        }
        return next;
      });
    } else {
      setSecond(prev => {
        if (prev.length >= PIN_LENGTH) return prev;
        const next = prev + d;
        if (next.length === PIN_LENGTH) {
          setTimeout(() => {
            if (next === first) {
              onSuccess(next);
            } else {
              setError("PINs didn't match. Try again.");
              setFirst('');
              setSecond('');
              setStep(1);
            }
          }, 160);
        }
        return next;
      });
    }
  }, [step, first, onSuccess]);

  const handleClear = useCallback((type) => {
    setError('');
    if (type === 'all') {
      if (step === 1) setFirst(''); else setSecond('');
    } else {
      if (step === 1) setFirst(p => p.slice(0, -1));
      else setSecond(p => p.slice(0, -1));
    }
  }, [step]);

  const verb = mode === 'change' ? 'Change PIN' : 'Set PIN';
  const stepLabel = step === 1 ? 'Enter a new 4-digit PIN' : 'Confirm your PIN';

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title">{verb} — {staffName}</div>
          <div className="modal-sub">{stepLabel}</div>
        </div>

        {/* Step indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 20px 0', justifyContent: 'center' }}>
          {[1, 2].map((s, idx) => (
            <React.Fragment key={s}>
              {idx > 0 && <div style={{ width: 32, height: 1, background: 'var(--border)' }} />}
              <div style={{
                width: 22, height: 22, borderRadius: '50%',
                background: s < step ? 'var(--success)' : s === step ? 'var(--primary)' : 'var(--border)',
                color: s <= step ? 'white' : 'var(--muted-foreground)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 700
              }}>
                {s < step ? <UM.Check size={11} /> : s}
              </div>
              <span style={{ fontSize: 12, color: s === step ? 'var(--foreground)' : 'var(--muted-foreground)', fontWeight: s === step ? 500 : 400 }}>
                {s === 1 ? 'Enter PIN' : 'Confirm'}
              </span>
            </React.Fragment>
          ))}
        </div>

        <div className="modal-body">
          <MiniKeypad
            digits={currentDigits}
            onAppend={handleAppend}
            onClear={handleClear}
            errorState={isError}
          />
          <div className="pin-error-msg">{error}</div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost btn-sm" type="button" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── ConfirmDialog ─────────────────────────────────────────────────────────
// variant: 'deactivate' | 'remove'
function ConfirmDialog({ staffName, variant, onConfirm, onClose }) {
  const isRemove = variant === 'remove';
  const title = isRemove
    ? `Remove ${staffName}?`
    : `Deactivate ${staffName}?`;
  const body = isRemove
    ? `${staffName} will be removed from the staff roster and won't appear on the login screen. Their appointment history stays on record.`
    : `${staffName} won't be able to log in until you reactivate them. Their appointments and history are unaffected.`;
  const cta = isRemove ? 'Remove' : 'Deactivate';

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal confirm-modal">
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'color-mix(in oklch, var(--destructive) 12%, transparent)', color: 'var(--destructive)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {isRemove ? <UM.UserX size={16} /> : <UM.EyeOff size={16} />}
            </div>
            <div className="modal-title" style={{ textAlign: 'left' }}>{title}</div>
          </div>
        </div>
        <div className="modal-body">
          <p>{body}</p>
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline btn-sm" type="button" onClick={onClose}>Cancel</button>
          <button className="btn btn-destructive btn-sm" type="button" onClick={onConfirm}>{cta}</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { PinModal, ConfirmDialog });
