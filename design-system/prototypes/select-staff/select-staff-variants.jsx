// /select-staff redesign — shared primitives + 4 variant layouts.
// All variants target a full-viewport iPad-landscape surface (no brand panel)
// — the current 480px form panel can't fit a 20-person roster + keypad
// without scrolling.

const { useState, useEffect, useMemo, useRef, useCallback } = React;

/* ── Roster fixture ───────────────────────────────────────────────────── */

const COLORS = {
  '--avatar-rose':   'oklch(0.55 0.12 12)',
  '--avatar-amber':  'oklch(0.76 0.14 75)',
  '--avatar-purple': 'oklch(0.55 0.13 270)',
  '--avatar-blue':   'oklch(0.60 0.13 240)',
  '--avatar-green':  'oklch(0.62 0.13 150)',
  '--avatar-teal':   'oklch(0.62 0.10 195)',
  '--avatar-orange': 'oklch(0.65 0.16 50)',
  '--avatar-slate':  'oklch(0.55 0.02 250)',
};

const ROSTER = [
  { id:'1',  name:'Maya Patel',      role:'owner',       color:'--avatar-rose'   },
  { id:'2',  name:'Jordan Lee',      role:'manager',     color:'--avatar-amber'  },
  { id:'3',  name:'Linh Tran',       role:'manager',     color:'--avatar-purple' },
  { id:'4',  name:'Sam Chen',        role:'technician',  color:'--avatar-blue'   },
  { id:'5',  name:'Priya Singh',     role:'technician',  color:'--avatar-green'  },
  { id:'6',  name:'Kenji Watanabe',  role:'technician',  color:'--avatar-teal'   },
  { id:'7',  name:'Ana Rodríguez',   role:'technician',  color:'--avatar-orange' },
  { id:'8',  name:'Thuy Nguyen',     role:'technician',  color:'--avatar-rose'   },
  { id:'9',  name:'Hannah Kim',      role:'technician',  color:'--avatar-purple' },
  { id:'10', name:'Marco Bianchi',   role:'technician',  color:'--avatar-amber'  },
  { id:'11', name:'Yuki Tanaka',     role:'technician',  color:'--avatar-blue'   },
  { id:'12', name:'Olivia Brown',    role:'technician',  color:'--avatar-green'  },
  { id:'13', name:'Rosa Delgado',    role:'technician',  color:'--avatar-teal'   },
  { id:'14', name:'Diego Morales',   role:'technician',  color:'--avatar-orange' },
  { id:'15', name:'Aiko Sato',       role:'technician',  color:'--avatar-rose'   },
  { id:'16', name:'Tara O\u2019Brien',role:'front_desk', color:'--avatar-slate'  },
  { id:'17', name:'Emma Wilson',     role:'front_desk',  color:'--avatar-purple' },
  { id:'18', name:'Beatrix Hoang',   role:'front_desk',  color:'--avatar-amber'  },
];

const ROLE_PRIORITY = { owner:0, manager:1, technician:2, front_desk:3 };
const ROLE_LABEL = { owner:'Owner', manager:'Manager', technician:'Tech', front_desk:'Front desk' };

function initials(name) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0,2).toUpperCase();
  return (parts[0][0] + parts[parts.length-1][0]).toUpperCase();
}

function sortRoster(rows) {
  return [...rows].sort((a,b) => {
    const r = ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role];
    if (r !== 0) return r;
    return a.name.localeCompare(b.name);
  });
}

/* ── Shared primitives ────────────────────────────────────────────────── */

function Avatar({ staff, size = 40 }) {
  const tint = `oklch(from ${COLORS[staff.color]} l c h / 0.15)`;
  return (
    <span
      aria-hidden="true"
      style={{
        display:'inline-flex', alignItems:'center', justifyContent:'center',
        width: size, height: size, borderRadius:'var(--radius-full)',
        background: tint, color: COLORS[staff.color],
        fontWeight: 600, fontSize: size >= 56 ? 18 : 13,
        letterSpacing:'var(--tracking-wide)', flexShrink: 0,
      }}
    >{initials(staff.name)}</span>
  );
}

function PinDots({ count, length = 4, error }) {
  return (
    <div
      style={{
        display:'flex', justifyContent:'center', alignItems:'center',
        gap: 14, height: 28,
      }}
    >
      {Array.from({length}, (_, i) => {
        const filled = i < count;
        return (
          <span
            key={i}
            style={{
              width: 14, height: 14, borderRadius:'var(--radius-full)',
              background: error
                ? 'var(--destructive)'
                : filled ? 'var(--foreground)' : 'transparent',
              border: filled || error
                ? `1.5px solid ${error ? 'var(--destructive)' : 'var(--foreground)'}`
                : '1.5px solid var(--border)',
              transition: 'all var(--duration-fast) var(--ease-out)',
              transform: filled ? 'scale(1)' : 'scale(0.85)',
            }}
          />
        );
      })}
    </div>
  );
}

function Keypad({ onDigit, onBackspace, onClear, size = 'md', disabled }) {
  // size: 'sm' (compact, fits in 360px col) | 'md' (regular) | 'lg' (hero)
  const key = size === 'lg' ? 88 : size === 'sm' ? 60 : 72;
  const fs  = size === 'lg' ? 30 : size === 'sm' ? 22 : 26;
  const gap = size === 'sm' ? 8 : 12;

  const Btn = ({ children, onClick, ariaLabel, dim }) => (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      disabled={disabled}
      style={{
        height: key, width: '100%',
        background: 'var(--card)', color: 'var(--card-foreground)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        fontSize: dim ? 'var(--text-base)' : fs,
        fontWeight: 500, fontVariantNumeric: 'tabular-nums',
        fontFamily: 'var(--font-sans)',
        color: dim ? 'var(--muted-foreground)' : 'var(--card-foreground)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        transition: 'background var(--duration-fast) var(--ease-out), transform 80ms var(--ease-out)',
        display:'inline-flex', alignItems:'center', justifyContent:'center',
      }}
      onMouseDown={e => !disabled && (e.currentTarget.style.background = 'var(--muted)')}
      onMouseUp={e => (e.currentTarget.style.background = 'var(--card)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'var(--card)')}
    >
      {children}
    </button>
  );

  return (
    <div
      style={{
        display:'grid',
        gridTemplateColumns:`repeat(3, ${key + 24}px)`,
        gap, width:'max-content', margin:'0 auto',
      }}
    >
      {['1','2','3','4','5','6','7','8','9'].map(d => (
        <Btn key={d} onClick={() => onDigit(d)} ariaLabel={`Digit ${d}`}>{d}</Btn>
      ))}
      <Btn dim onClick={onClear} ariaLabel="Clear">Clear</Btn>
      <Btn onClick={() => onDigit('0')} ariaLabel="Digit 0">0</Btn>
      <Btn dim onClick={onBackspace} ariaLabel="Backspace">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 7H8L3 12l5 5h13a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2Z"/>
          <line x1="18" y1="10" x2="12" y2="16"/>
          <line x1="12" y1="10" x2="18" y2="16"/>
        </svg>
      </Btn>
    </div>
  );
}

function SearchField({ value, onChange, placeholder = 'Search staff', autoFocus }) {
  return (
    <div style={{ position:'relative', width:'100%' }}>
      <svg
        width="16" height="16" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
        style={{
          position:'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
          color:'var(--muted-foreground)', pointerEvents:'none',
        }}
      >
        <circle cx="11" cy="11" r="7"/>
        <path d="m21 21-4.3-4.3"/>
      </svg>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        style={{
          width:'100%', height: 44, padding:'0 14px 0 40px',
          border:'1px solid var(--input)', borderRadius:'var(--radius-md)',
          background:'var(--card)', color:'var(--foreground)',
          fontSize:'var(--text-base)', fontFamily:'var(--font-sans)',
          outline:'none',
          transition:'border-color var(--duration-fast), box-shadow var(--duration-fast)',
        }}
        onFocus={e => {
          e.target.style.borderColor = 'var(--ring)';
          e.target.style.boxShadow = '0 0 0 3px color-mix(in oklch, var(--ring) 18%, transparent)';
        }}
        onBlur={e => {
          e.target.style.borderColor = 'var(--input)';
          e.target.style.boxShadow = 'none';
        }}
      />
    </div>
  );
}

function ScreenHeader({ title, subtitle, right }) {
  return (
    <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap: 16 }}>
      <div>
        <h1 style={{
          fontSize:'var(--text-3xl)', fontWeight:600,
          letterSpacing:'var(--tracking-snug)', lineHeight:1.2, margin:0,
        }}>{title}</h1>
        {subtitle && (
          <p style={{
            marginTop: 6, fontSize:'var(--text-sm)',
            color:'var(--muted-foreground)',
          }}>{subtitle}</p>
        )}
      </div>
      {right}
    </div>
  );
}

function BrandMark() {
  return (
    <div style={{ display:'flex', alignItems:'center', gap: 8 }}>
      <svg width="22" height="22" viewBox="0 0 64 64" fill="none">
        <path d="M32 4c-9 0-16 7-16 18 0 8 3 14 6 22 2 6 4 12 4 16 0 0 2 0 6 0s6 0 6 0c0-4 2-10 4-16 3-8 6-14 6-22 0-11-7-18-16-18z" fill="oklch(0.55 0.12 12)"/>
        <path d="M32 4c-9 0-16 7-16 18 0 4 1 8 2 11 4-3 9-5 14-5s10 2 14 5c1-3 2-7 2-11 0-11-7-18-16-18z" fill="oklch(0.76 0.07 12)"/>
      </svg>
      <span style={{
        fontSize:'var(--text-md)', fontWeight: 600,
        letterSpacing:'var(--tracking-snug)',
      }}>Tang Nails Studio</span>
    </div>
  );
}

function SignOutLink() {
  return (
    <button
      type="button"
      style={{
        background:'none', border:'none', cursor:'pointer',
        fontFamily:'var(--font-sans)', fontSize:'var(--text-sm)',
        color:'var(--muted-foreground)', textDecoration:'underline',
        textUnderlineOffset: 2, padding: 0,
      }}
    >Sign out</button>
  );
}

/* ── usePinEntry hook (shared logic) ──────────────────────────────────── */

function usePinEntry({ selectedId, onSuccess, validPin = '1234', length = 4 }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const append = useCallback(d => {
    if (!selectedId) return;
    setError(false);
    setPin(p => {
      if (p.length >= length) return p;
      const next = p + d;
      if (next.length === length) {
        // Simulate auth
        setTimeout(() => {
          if (next === validPin) {
            onSuccess?.();
            setPin('');
          } else {
            setError(true);
            setTimeout(() => { setPin(''); setError(false); }, 800);
          }
        }, 150);
      }
      return next;
    });
  }, [selectedId, length, validPin, onSuccess]);

  const backspace = useCallback(() => {
    setError(false);
    setPin(p => p.slice(0, -1));
  }, []);
  const clear = useCallback(() => { setError(false); setPin(''); }, []);

  // Reset pin when selection changes
  useEffect(() => { setPin(''); setError(false); }, [selectedId]);

  return { pin, error, append, backspace, clear };
}

/* ═══════════════════════════════════════════════════════════════════════
   VARIANT A — Split view: searchable roster (left) + always-on keypad (right)
   Best for: clear two-step mental model, no scrolling needed even at 25 staff.
   ═══════════════════════════════════════════════════════════════════════ */

function VariantSplit() {
  const [selectedId, setSelectedId] = useState(null);
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState(null);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    const list = q
      ? ROSTER.filter(s => s.name.toLowerCase().includes(q) || ROLE_LABEL[s.role].toLowerCase().includes(q))
      : ROSTER;
    return sortRoster(list);
  }, [query]);

  const selected = ROSTER.find(s => s.id === selectedId);
  const { pin, error, append, backspace, clear } = usePinEntry({
    selectedId,
    onSuccess: () => setToast(`Signed in as ${selected?.name}`),
  });

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1600);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <div style={{
      width:'100%', height:'100%',
      background:'var(--background)', color:'var(--foreground)',
      fontFamily:'var(--font-sans)',
      display:'grid', gridTemplateRows:'auto 1fr',
    }}>
      {/* Topbar */}
      <header style={{
        display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'16px 32px', borderBottom:'1px solid var(--border)',
        background:'var(--card)',
      }}>
        <BrandMark />
        <SignOutLink />
      </header>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 420px', minHeight: 0 }}>
        {/* ── Left: Roster ── */}
        <section style={{
          padding:'32px 40px', display:'flex', flexDirection:'column', gap: 20,
          minWidth: 0, minHeight: 0,
        }}>
          <ScreenHeader
            title="Who's using this device?"
            subtitle={`${ROSTER.length} staff on this device`}
          />

          <SearchField value={query} onChange={setQuery} />

          <div style={{
            flex: 1, overflowY:'auto', minHeight: 0,
            display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 8, alignContent:'start',
            paddingRight: 4,
          }}>
            {filtered.map(s => {
              const isSel = s.id === selectedId;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedId(s.id)}
                  style={{
                    display:'flex', alignItems:'center', gap: 12,
                    padding:'10px 12px', minHeight: 60,
                    background: isSel ? 'color-mix(in oklch, var(--ring) 10%, var(--card))' : 'var(--card)',
                    border: `1px solid ${isSel ? 'var(--primary)' : 'var(--border)'}`,
                    boxShadow: isSel ? '0 0 0 2px color-mix(in oklch, var(--ring) 30%, transparent)' : 'none',
                    borderRadius:'var(--radius-lg)',
                    cursor:'pointer', textAlign:'left',
                    fontFamily:'inherit',
                    transition:'all var(--duration-fast) var(--ease-out)',
                  }}
                >
                  <Avatar staff={s} size={36} />
                  <div style={{ display:'flex', flexDirection:'column', gap: 2, minWidth: 0, flex: 1 }}>
                    <span style={{
                      fontSize:'var(--text-sm)', fontWeight: 500,
                      whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
                    }}>{s.name}</span>
                    <span style={{
                      fontSize: 11, color:'var(--muted-foreground)',
                      letterSpacing:'var(--tracking-wide)', textTransform:'uppercase',
                    }}>{ROLE_LABEL[s.role]}</span>
                  </div>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <p style={{
                gridColumn:'1 / -1', textAlign:'center',
                color:'var(--muted-foreground)', fontSize:'var(--text-sm)',
                padding:'40px 0',
              }}>No staff match "{query}"</p>
            )}
          </div>
        </section>

        {/* ── Right: Keypad pane ── */}
        <aside style={{
          background:'var(--muted)', borderLeft:'1px solid var(--border)',
          padding:'40px 32px',
          display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
          gap: 28,
        }}>
          {selected ? (
            <>
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap: 12 }}>
                <Avatar staff={selected} size={72} />
                <div style={{ textAlign:'center' }}>
                  <div style={{ fontSize:'var(--text-xl)', fontWeight: 600 }}>{selected.name}</div>
                  <div style={{
                    fontSize:'var(--text-xs)', color:'var(--muted-foreground)',
                    letterSpacing:'var(--tracking-wide)', textTransform:'uppercase',
                    marginTop: 2,
                  }}>{ROLE_LABEL[selected.role]}</div>
                </div>
              </div>

              <PinDots count={pin.length} error={error} />

              <Keypad
                size="sm"
                onDigit={append}
                onBackspace={backspace}
                onClear={clear}
              />

              <button
                type="button"
                onClick={() => setSelectedId(null)}
                style={{
                  background:'none', border:'none', cursor:'pointer',
                  fontFamily:'var(--font-sans)', fontSize:'var(--text-sm)',
                  color:'var(--muted-foreground)', textDecoration:'underline',
                  textUnderlineOffset: 2, padding: 0,
                }}
              >Not me — pick again</button>
            </>
          ) : (
            <div style={{ textAlign:'center', maxWidth: 240 }}>
              <div style={{
                width: 56, height: 56, borderRadius:'var(--radius-full)',
                background:'var(--card)', border:'1px dashed var(--border)',
                display:'inline-flex', alignItems:'center', justifyContent:'center',
                marginBottom: 16,
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{color:'var(--muted-foreground)'}}>
                  <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
              </div>
              <div style={{ fontSize:'var(--text-md)', fontWeight: 500, marginBottom: 6 }}>
                Pick your tile to begin
              </div>
              <div style={{ fontSize:'var(--text-sm)', color:'var(--muted-foreground)' }}>
                Then enter your 4-digit PIN here.
              </div>
            </div>
          )}
        </aside>
      </div>

      {toast && <SuccessToast message={toast} />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   VARIANT B — PIN-first (identify by PIN, fastest for muscle memory)
   Hero keypad. Roster ghosts on the side and lights up when PIN matches.
   ═══════════════════════════════════════════════════════════════════════ */

function VariantPinFirst() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [toast, setToast] = useState(null);

  // Mock: each staff has a 4-digit PIN derived from their id (10 + id)
  const PIN_MAP = useMemo(() => {
    const m = {};
    ROSTER.forEach((s, i) => { m[String(1000 + i * 7 + 234).slice(-4)] = s; });
    // give 4321 to Maya so it always works
    m['4321'] = ROSTER[0];
    return m;
  }, []);

  // Highlight staff who could be matched given the current prefix
  const candidates = useMemo(() => {
    if (pin.length === 0) return [];
    return Object.entries(PIN_MAP)
      .filter(([p]) => p.startsWith(pin))
      .map(([, s]) => s);
  }, [pin, PIN_MAP]);

  const onDigit = useCallback(d => {
    setError(false);
    setPin(p => {
      if (p.length >= 4) return p;
      const next = p + d;
      if (next.length === 4) {
        setTimeout(() => {
          const match = PIN_MAP[next];
          if (match) {
            setToast(`Signed in as ${match.name}`);
            setPin('');
          } else {
            setError(true);
            setTimeout(() => { setPin(''); setError(false); }, 800);
          }
        }, 150);
      }
      return next;
    });
  }, [PIN_MAP]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1600);
    return () => clearTimeout(t);
  }, [toast]);

  const sorted = sortRoster(ROSTER);

  return (
    <div style={{
      width:'100%', height:'100%',
      background:'var(--background)', color:'var(--foreground)',
      fontFamily:'var(--font-sans)',
      display:'grid', gridTemplateRows:'auto 1fr',
    }}>
      <header style={{
        display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'16px 32px', borderBottom:'1px solid var(--border)',
        background:'var(--card)',
      }}>
        <BrandMark />
        <SignOutLink />
      </header>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 360px', minHeight: 0 }}>
        {/* ── Left: hero keypad ── */}
        <section style={{
          display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
          padding: 32, gap: 32,
        }}>
          <ScreenHeader
            title="Enter your PIN"
            subtitle="No need to find your tile — just type and we'll sign you in."
          />

          <PinDots count={pin.length} error={error} />

          <Keypad
            size="lg"
            onDigit={onDigit}
            onBackspace={() => { setError(false); setPin(p => p.slice(0,-1)); }}
            onClear={() => { setError(false); setPin(''); }}
          />

          <div style={{
            fontSize:'var(--text-xs)', color:'var(--muted-foreground)',
            letterSpacing:'var(--tracking-wide)', textTransform:'uppercase',
            display:'flex', alignItems:'center', gap: 8,
          }}>
            {error ? (
              <span style={{ color:'var(--destructive)' }}>PIN didn't match. Try again.</span>
            ) : (
              <>
                <kbd style={{
                  fontFamily:'var(--font-mono)', fontSize: 11,
                  padding:'2px 6px', background:'var(--card)',
                  border:'1px solid var(--border)', borderRadius: 4,
                }}>0–9</kbd>
                <span>or tap to enter PIN</span>
              </>
            )}
          </div>
        </section>

        {/* ── Right: roster ghosts, lights up on match ── */}
        <aside style={{
          background:'var(--muted)', borderLeft:'1px solid var(--border)',
          padding:'32px 24px',
          display:'flex', flexDirection:'column', gap: 16,
          minHeight: 0,
        }}>
          <div>
            <div style={{
              fontSize:'var(--text-xs)',
              letterSpacing:'var(--tracking-wide)', textTransform:'uppercase',
              color:'var(--muted-foreground)', fontWeight: 500,
            }}>On this device</div>
            <div style={{ fontSize:'var(--text-sm)', color:'var(--muted-foreground)', marginTop: 4 }}>
              {pin.length === 0
                ? `${ROSTER.length} staff`
                : candidates.length === 0
                  ? 'No matches'
                  : `${candidates.length} possible match${candidates.length === 1 ? '' : 'es'}`}
            </div>
          </div>

          <div style={{
            flex: 1, overflowY:'auto', minHeight: 0,
            display:'flex', flexDirection:'column', gap: 4,
          }}>
            {sorted.map(s => {
              const ghosted = pin.length > 0 && !candidates.find(c => c.id === s.id);
              const highlighted = pin.length > 0 && candidates.find(c => c.id === s.id);
              return (
                <div
                  key={s.id}
                  style={{
                    display:'flex', alignItems:'center', gap: 12,
                    padding:'8px 10px',
                    borderRadius:'var(--radius-md)',
                    background: highlighted ? 'var(--card)' : 'transparent',
                    border: `1px solid ${highlighted ? 'var(--primary)' : 'transparent'}`,
                    opacity: ghosted ? 0.3 : 1,
                    transition:'all var(--duration-base) var(--ease-out)',
                  }}
                >
                  <Avatar staff={s} size={28} />
                  <span style={{
                    fontSize:'var(--text-sm)',
                    fontWeight: highlighted ? 600 : 400,
                    flex: 1,
                  }}>{s.name}</span>
                  <span style={{
                    fontSize: 10, color:'var(--muted-foreground)',
                    letterSpacing:'var(--tracking-wide)', textTransform:'uppercase',
                  }}>{ROLE_LABEL[s.role]}</span>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            style={{
              alignSelf:'flex-start',
              background:'none', border:'none', cursor:'pointer',
              fontFamily:'var(--font-sans)', fontSize:'var(--text-xs)',
              color:'var(--muted-foreground)', textDecoration:'underline',
              textUnderlineOffset: 2, padding: 0,
            }}
          >Forgot your PIN?</button>
        </aside>
      </div>

      {toast && <SuccessToast message={toast} />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   VARIANT C — Recents + searchable list, inline keypad slide-in
   Best for: 80/20 case — same handful of staff sign in repeatedly.
   ═══════════════════════════════════════════════════════════════════════ */

function VariantRecents() {
  const [selectedId, setSelectedId] = useState(null);
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState(null);

  const recentIds = ['1','2','5','8']; // Maya, Jordan, Priya, Thuy
  const recents = recentIds.map(id => ROSTER.find(s => s.id === id));
  const others = sortRoster(ROSTER.filter(s => !recentIds.includes(s.id)));

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return null;
    return sortRoster(ROSTER.filter(s => s.name.toLowerCase().includes(q)));
  }, [query]);

  const selected = ROSTER.find(s => s.id === selectedId);
  const { pin, error, append, backspace, clear } = usePinEntry({
    selectedId,
    onSuccess: () => setToast(`Signed in as ${selected?.name}`),
  });

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1600);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <div style={{
      width:'100%', height:'100%',
      background:'var(--background)', color:'var(--foreground)',
      fontFamily:'var(--font-sans)',
      display:'grid', gridTemplateRows:'auto 1fr',
      overflow:'hidden',
    }}>
      <header style={{
        display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'16px 32px', borderBottom:'1px solid var(--border)',
        background:'var(--card)',
      }}>
        <BrandMark />
        <SignOutLink />
      </header>

      <div style={{
        display:'grid',
        gridTemplateColumns: selected ? '1fr 460px' : '1fr 0px',
        transition:'grid-template-columns var(--duration-base) var(--ease-out)',
        minHeight: 0,
      }}>
        {/* ── Left: roster ── */}
        <section style={{
          padding:'28px 40px',
          display:'flex', flexDirection:'column', gap: 20,
          minWidth: 0, minHeight: 0, overflowY:'auto',
        }}>
          <ScreenHeader
            title="Who's using this device?"
            subtitle="Tap your name to enter your PIN."
          />

          <SearchField value={query} onChange={setQuery} />

          {filtered ? (
            <Group title={`Results · ${filtered.length}`}>
              <RosterGrid staff={filtered} selectedId={selectedId} onSelect={setSelectedId} compact />
            </Group>
          ) : (
            <>
              <Group title="Recently on this device">
                <RosterGrid staff={recents} selectedId={selectedId} onSelect={setSelectedId} />
              </Group>
              <Group title={`All staff · ${others.length}`}>
                <RosterGrid staff={others} selectedId={selectedId} onSelect={setSelectedId} compact />
              </Group>
            </>
          )}
        </section>

        {/* ── Right: slide-in keypad ── */}
        <aside style={{
          background:'var(--card)', borderLeft:'1px solid var(--border)',
          display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
          padding: selected ? 32 : 0, gap: 24,
          overflow:'hidden',
          opacity: selected ? 1 : 0,
          transition:'opacity var(--duration-base) var(--ease-out)',
        }}>
          {selected && (
            <>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                style={{
                  alignSelf:'flex-start',
                  display:'inline-flex', alignItems:'center', gap: 6,
                  background:'none', border:'none', cursor:'pointer',
                  fontFamily:'var(--font-sans)', fontSize:'var(--text-sm)',
                  color:'var(--muted-foreground)', padding: 0,
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m15 18-6-6 6-6"/>
                </svg>
                Back
              </button>

              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap: 12, marginTop: 8 }}>
                <Avatar staff={selected} size={80} />
                <div style={{ textAlign:'center' }}>
                  <div style={{ fontSize:'var(--text-2xl)', fontWeight: 600 }}>{selected.name}</div>
                  <div style={{
                    fontSize:'var(--text-xs)', color:'var(--muted-foreground)',
                    letterSpacing:'var(--tracking-wide)', textTransform:'uppercase',
                    marginTop: 4,
                  }}>{ROLE_LABEL[selected.role]}</div>
                </div>
              </div>

              <div style={{ fontSize:'var(--text-sm)', color:'var(--muted-foreground)' }}>
                Enter your 4-digit PIN
              </div>

              <PinDots count={pin.length} error={error} />

              <Keypad
                size="md"
                onDigit={append}
                onBackspace={backspace}
                onClear={clear}
              />
            </>
          )}
        </aside>
      </div>

      {toast && <SuccessToast message={toast} />}
    </div>
  );
}

function Group({ title, children }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap: 10 }}>
      <h2 style={{
        fontSize:'var(--text-xs)',
        letterSpacing:'var(--tracking-wide)', textTransform:'uppercase',
        color:'var(--muted-foreground)', fontWeight: 500, margin: 0,
      }}>{title}</h2>
      {children}
    </div>
  );
}

function RosterGrid({ staff, selectedId, onSelect, compact }) {
  const min = compact ? 200 : 220;
  return (
    <div style={{
      display:'grid',
      gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`,
      gap: compact ? 6 : 10,
    }}>
      {staff.map(s => {
        const isSel = s.id === selectedId;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(s.id)}
            style={{
              display:'flex', alignItems:'center', gap: 12,
              padding: compact ? '8px 12px' : '12px 14px',
              minHeight: compact ? 56 : 72,
              background: isSel ? 'color-mix(in oklch, var(--ring) 10%, var(--card))' : 'var(--card)',
              border: `1px solid ${isSel ? 'var(--primary)' : 'var(--border)'}`,
              boxShadow: isSel ? '0 0 0 2px color-mix(in oklch, var(--ring) 30%, transparent)' : 'none',
              borderRadius:'var(--radius-lg)',
              cursor:'pointer', textAlign:'left',
              fontFamily:'inherit',
              transition:'all var(--duration-fast) var(--ease-out)',
            }}
          >
            <Avatar staff={s} size={compact ? 32 : 40} />
            <div style={{ display:'flex', flexDirection:'column', gap: 2, minWidth: 0, flex: 1 }}>
              <span style={{
                fontSize: compact ? 'var(--text-sm)' : 'var(--text-md)', fontWeight: 500,
                whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
              }}>{s.name}</span>
              <span style={{
                fontSize: 11, color:'var(--muted-foreground)',
                letterSpacing:'var(--tracking-wide)', textTransform:'uppercase',
              }}>{ROLE_LABEL[s.role]}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   VARIANT D — Avatar grid + modal keypad
   Compact, visual. Names + initials only, modal centers focus during PIN.
   ═══════════════════════════════════════════════════════════════════════ */

function VariantAvatarGrid() {
  const [selectedId, setSelectedId] = useState(null);
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState(null);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    const list = q ? ROSTER.filter(s => s.name.toLowerCase().includes(q)) : ROSTER;
    return sortRoster(list);
  }, [query]);

  const selected = ROSTER.find(s => s.id === selectedId);
  const { pin, error, append, backspace, clear } = usePinEntry({
    selectedId,
    onSuccess: () => {
      setToast(`Signed in as ${selected?.name}`);
      setSelectedId(null);
    },
  });

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1600);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <div style={{
      width:'100%', height:'100%',
      background:'var(--background)', color:'var(--foreground)',
      fontFamily:'var(--font-sans)',
      display:'grid', gridTemplateRows:'auto 1fr',
      position:'relative',
    }}>
      <header style={{
        display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'16px 32px', borderBottom:'1px solid var(--border)',
        background:'var(--card)',
      }}>
        <BrandMark />
        <SignOutLink />
      </header>

      <section style={{
        padding:'32px 48px',
        display:'flex', flexDirection:'column', gap: 24,
        maxWidth: 1080, width:'100%', margin:'0 auto',
        minHeight: 0, overflowY:'auto',
      }}>
        <ScreenHeader
          title="Who's using this device?"
          subtitle="Tap your avatar to sign in"
        />

        <div style={{ maxWidth: 400 }}>
          <SearchField value={query} onChange={setQuery} />
        </div>

        <div style={{
          display:'grid',
          gridTemplateColumns:'repeat(auto-fill, minmax(120px, 1fr))',
          gap: 16,
        }}>
          {filtered.map(s => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSelectedId(s.id)}
              style={{
                display:'flex', flexDirection:'column', alignItems:'center', gap: 10,
                padding:'20px 12px',
                background:'var(--card)',
                border:'1px solid var(--border)',
                borderRadius:'var(--radius-lg)',
                cursor:'pointer', textAlign:'center',
                fontFamily:'inherit',
                transition:'all var(--duration-fast) var(--ease-out)',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = 'var(--ring)';
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = 'var(--shadow-md)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'var(--border)';
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <Avatar staff={s} size={56} />
              <div style={{
                fontSize:'var(--text-sm)', fontWeight: 500,
                whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
                maxWidth:'100%',
              }}>{s.name}</div>
              <div style={{
                fontSize: 10, color:'var(--muted-foreground)',
                letterSpacing:'var(--tracking-wide)', textTransform:'uppercase',
              }}>{ROLE_LABEL[s.role]}</div>
            </button>
          ))}
          {filtered.length === 0 && (
            <p style={{
              gridColumn:'1 / -1', textAlign:'center',
              color:'var(--muted-foreground)', fontSize:'var(--text-sm)',
              padding:'40px 0',
            }}>No staff match "{query}"</p>
          )}
        </div>
      </section>

      {/* ── Modal ── */}
      {selected && (
        <div
          onClick={() => setSelectedId(null)}
          style={{
            position:'absolute', inset: 0,
            background:'color-mix(in oklch, var(--foreground) 50%, transparent)',
            display:'flex', alignItems:'center', justifyContent:'center',
            padding: 24,
            animation:'fadeIn 200ms var(--ease-out)',
            zIndex: 10,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background:'var(--card)', borderRadius:'var(--radius-xl)',
              padding:'32px 28px',
              width: 380, maxWidth:'100%',
              display:'flex', flexDirection:'column', alignItems:'center', gap: 20,
              boxShadow:'var(--shadow-lg)',
              animation:'sheetIn 240ms var(--ease-out)',
            }}
          >
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              aria-label="Close"
              style={{
                position:'absolute', top: 12, right: 12,
                width: 32, height: 32, border:'none', background:'none',
                cursor:'pointer', color:'var(--muted-foreground)',
                display:'inline-flex', alignItems:'center', justifyContent:'center',
                borderRadius:'var(--radius-full)',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
              </svg>
            </button>

            <Avatar staff={selected} size={80} />
            <div style={{ textAlign:'center' }}>
              <div style={{ fontSize:'var(--text-2xl)', fontWeight: 600 }}>{selected.name}</div>
              <div style={{
                fontSize:'var(--text-xs)', color:'var(--muted-foreground)',
                letterSpacing:'var(--tracking-wide)', textTransform:'uppercase',
                marginTop: 4,
              }}>{ROLE_LABEL[selected.role]}</div>
            </div>

            <div style={{ fontSize:'var(--text-sm)', color:'var(--muted-foreground)' }}>
              Enter your 4-digit PIN
            </div>

            <PinDots count={pin.length} error={error} />

            <Keypad
              size="md"
              onDigit={append}
              onBackspace={backspace}
              onClear={clear}
            />
          </div>
        </div>
      )}

      {toast && <SuccessToast message={toast} />}
    </div>
  );
}

/* ── Toast ────────────────────────────────────────────────────────────── */

function SuccessToast({ message }) {
  return (
    <div
      role="status"
      style={{
        position:'absolute', bottom: 24, left:'50%',
        transform:'translateX(-50%)',
        background:'var(--foreground)', color:'var(--background)',
        padding:'12px 18px', borderRadius:'var(--radius-full)',
        fontSize:'var(--text-sm)', fontWeight: 500,
        display:'inline-flex', alignItems:'center', gap: 10,
        boxShadow:'var(--shadow-md)',
        animation:'toastIn 200ms var(--ease-out)',
        zIndex: 20,
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6 9 17l-5-5"/>
      </svg>
      {message}
    </div>
  );
}

// inject minor keyframes
if (typeof document !== 'undefined' && !document.getElementById('ss-anim')) {
  const s = document.createElement('style');
  s.id = 'ss-anim';
  s.textContent = `
    @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
    @keyframes sheetIn { from { opacity: 0; transform: translateY(12px) scale(0.98) } to { opacity: 1; transform: translateY(0) scale(1) } }
    @keyframes toastIn { from { opacity: 0; transform: translate(-50%, 8px) } to { opacity: 1; transform: translate(-50%, 0) } }
  `;
  document.head.appendChild(s);
}

// Export to window so the main HTML can pick them up
Object.assign(window, {
  VariantSplit,
  VariantPinFirst,
  VariantRecents,
  VariantAvatarGrid,
});
