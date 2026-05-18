// Shared data + helpers for the Services-page variations.
// All money is in cents internally to match the existing schema; UI formats
// to dollars on display.
//
// ─── Supply types ─────────────────────────────────────────────────────────
// Supply costs are a first-class entity. Each `SupplyType` has a stable id
// and a display name. Service supplies reference the type by id, not by
// label, so renaming a type updates everywhere automatically and staff
// exemptions don't silently break.
//
// We expose a tiny module-level store + `useSupplyTypes()` hook so every
// component (V1/V2 service editors, EditPolicySheet manager, Staff Settings
// exemption picker) stays in sync without prop drilling. In a real build
// this is a server-side store; for the prototype, in-memory is fine.

const INITIAL_SUPPLY_TYPES = [
  { id: 'st_gelx',    name: 'GelX tips & gel', archived: false },
  { id: 'st_chrome',  name: 'Chrome powder',   archived: false },
  { id: 'st_cateye',  name: 'Cat-eye gel',     archived: false },
  { id: 'st_opi',     name: 'OPI bottle wear', archived: false },
];

let _supplyTypes = INITIAL_SUPPLY_TYPES.map(t => ({ ...t }));
const _supplyTypeSubs = new Set();
function _emitSupplyTypes() { _supplyTypeSubs.forEach(fn => fn()); }

function getSupplyTypes() { return _supplyTypes; }
function setSupplyTypes(next) {
  _supplyTypes = typeof next === 'function' ? next(_supplyTypes) : next;
  _emitSupplyTypes();
}

// React hook — re-renders the calling component when the supply-types list
// changes anywhere in the app.
function useSupplyTypes() {
  const [, force] = React.useState(0);
  React.useEffect(() => {
    const fn = () => force(x => x + 1);
    _supplyTypeSubs.add(fn);
    return () => { _supplyTypeSubs.delete(fn); };
  }, []);
  return [_supplyTypes, setSupplyTypes];
}

// Helpers
function findSupplyType(id, types = _supplyTypes) {
  return types.find(t => t.id === id) || null;
}
function supplyTypeName(id, types = _supplyTypes) {
  return findSupplyType(id, types)?.name || 'Unknown supply';
}
// Generate a stable-ish id from a name (prototype). Real impl uses uuid.
function makeSupplyTypeId(name) {
  const slug = String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 16) || 'type';
  let id = 'st_' + slug;
  let i = 2;
  while (_supplyTypes.some(t => t.id === id)) { id = 'st_' + slug + '_' + i++; }
  return id;
}
function addSupplyType(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;
  // De-dup by name (case-insensitive) — return existing if found
  const existing = _supplyTypes.find(t => t.name.toLowerCase() === trimmed.toLowerCase() && !t.archived);
  if (existing) return existing;
  const newType = { id: makeSupplyTypeId(trimmed), name: trimmed, archived: false };
  setSupplyTypes(prev => [...prev, newType]);
  return newType;
}

// ─── Services ──────────────────────────────────────────────────────────────
// service.supply is `{ amount_cents, type_id }` or null. The supply type is
// resolved via SUPPLY_TYPES; rename a type and every service updates.

const SERVICES = [
  // --- Manicures ---
  { id: 'classic-mani',      name: 'Classic manicure',    category: 'Manicure',    duration_min: 30, price_cents: 2500, color_token: '--avatar-rose',  taxable: false, active: true, variable_price: false, price_from_cents: null, price_to_cents: null, variable_price_note: null,
    cardFee: { mode: 'default' }, supply: null, techCount: 8 },
  { id: 'gel-mani',          name: 'Gel manicure',        category: 'Manicure',    duration_min: 45, price_cents: 4000, color_token: '--avatar-rose',  taxable: false, active: true, variable_price: false, price_from_cents: null, price_to_cents: null, variable_price_note: null,
    cardFee: { mode: 'default' }, supply: null, techCount: 8 },
  { id: 'russian-mani',      name: 'Russian manicure',    category: 'Manicure',    duration_min: 75, price_cents: 6500, color_token: '--avatar-rose',  taxable: false, active: true, variable_price: false, price_from_cents: null, price_to_cents: null, variable_price_note: null,
    cardFee: { mode: 'default' }, supply: null, techCount: 4 },

  // --- Pedicures ---
  { id: 'classic-pedi',      name: 'Classic pedicure',    category: 'Pedicure',    duration_min: 45, price_cents: 3800, color_token: '--avatar-teal',  taxable: false, active: true, variable_price: false, price_from_cents: null, price_to_cents: null, variable_price_note: null,
    cardFee: { mode: 'default' }, supply: null, techCount: 8 },
  { id: 'deluxe-pedi',       name: 'Deluxe pedicure',     category: 'Pedicure',    duration_min: 60, price_cents: 6000, color_token: '--avatar-teal',  taxable: false, active: true, variable_price: true,  price_from_cents: 6000, price_to_cents: 6500, variable_price_note: 'Regular polish · Gel adds $5',
    cardFee: { mode: 'default' }, supply: null, techCount: 6 },
  { id: 'energy-boost-pedi', name: 'Energy boost pedi',   category: 'Pedicure',    duration_min: 60, price_cents: 7300, color_token: '--avatar-green', taxable: false, active: true, variable_price: false, price_from_cents: null, price_to_cents: null, variable_price_note: null,
    cardFee: { mode: 'default' }, supply: null, techCount: 5 },
  { id: 'hemp-steam-pedi',   name: 'Hemp steam pedicure', category: 'Pedicure',    duration_min: 75, price_cents: 8600, color_token: '--avatar-green', taxable: false, active: true, variable_price: false, price_from_cents: null, price_to_cents: null, variable_price_note: null,
    cardFee: { mode: 'default' }, supply: null, techCount: 3 },

  // --- Enhancements (GelX, acrylic) ---
  { id: 'gelx-fullset',      name: 'GelX full set',       category: 'Enhancement', duration_min: 75, price_cents: 6500, color_token: '--avatar-purple', taxable: false, active: true, variable_price: false, price_from_cents: null, price_to_cents: null, variable_price_note: null,
    cardFee: { mode: 'default' }, supply: { amount_cents: 500, type_id: 'st_gelx' }, techCount: 5 },
  { id: 'gelx-refill',       name: 'GelX refill',         category: 'Enhancement', duration_min: 60, price_cents: 5500, color_token: '--avatar-purple', taxable: false, active: true, variable_price: false, price_from_cents: null, price_to_cents: null, variable_price_note: null,
    cardFee: { mode: 'default' }, supply: { amount_cents: 500, type_id: 'st_gelx' }, techCount: 5 },
  { id: 'acrylic-fills-gel', name: 'Acrylic fills · gel', category: 'Enhancement', duration_min: 60, price_cents: 6500, color_token: '--avatar-amber', taxable: false, active: true, variable_price: false, price_from_cents: null, price_to_cents: null, variable_price_note: null,
    cardFee: { mode: 'default' }, supply: null, techCount: 4 },

  // --- Add-ons ---
  { id: 'addon-chrome',      name: 'Chrome finish',       category: 'Add-on',      duration_min: 15, price_cents: 1000, color_token: '--avatar-slate', taxable: false, active: true, variable_price: false, price_from_cents: null, price_to_cents: null, variable_price_note: null,
    cardFee: { mode: 'exempt' }, supply: { amount_cents: 500, type_id: 'st_chrome' }, techCount: 8 },
  { id: 'addon-cat-eyes',    name: 'Cat-eye effect',      category: 'Add-on',      duration_min: 15, price_cents: 1000, color_token: '--avatar-slate', taxable: false, active: true, variable_price: false, price_from_cents: null, price_to_cents: null, variable_price_note: null,
    cardFee: { mode: 'exempt' }, supply: { amount_cents: 500, type_id: 'st_cateye' }, techCount: 8 },
  { id: 'addon-opi',         name: 'OPI polish change',   category: 'Add-on',      duration_min: 15, price_cents: 0,    color_token: '--avatar-slate', taxable: false, active: true, variable_price: false, price_from_cents: null, price_to_cents: null, variable_price_note: null,
    cardFee: { mode: 'exempt' }, supply: { amount_cents: 500, type_id: 'st_opi' }, techCount: 8 },
  { id: 'addon-nail-art',    name: 'Nail art (per nail)', category: 'Add-on',      duration_min: 10, price_cents: 500,  color_token: '--avatar-slate', taxable: false, active: true, variable_price: true,  price_from_cents: 500,  price_to_cents: 1500, variable_price_note: 'Depends on complexity',
    cardFee: { mode: 'exempt' }, supply: null, techCount: 5 },

  // --- Waxing & Removal ---
  { id: 'brow-wax',          name: 'Brow wax',            category: 'Waxing',      duration_min: 15, price_cents: 1500, color_token: '--avatar-orange', taxable: false, active: true, variable_price: false, price_from_cents: null, price_to_cents: null, variable_price_note: null,
    cardFee: { mode: 'custom', custom_cents: 100 }, supply: null, techCount: 6 },
  { id: 'lip-wax',           name: 'Lip wax',             category: 'Waxing',      duration_min: 10, price_cents: 1200, color_token: '--avatar-orange', taxable: false, active: true, variable_price: false, price_from_cents: null, price_to_cents: null, variable_price_note: null,
    cardFee: { mode: 'custom', custom_cents: 100 }, supply: null, techCount: 6 },
  { id: 'soak-off',          name: 'Soak-off removal',    category: 'Removal',     duration_min: 20, price_cents: 1500, color_token: '--avatar-blue',  taxable: false, active: true, variable_price: false, price_from_cents: null, price_to_cents: null, variable_price_note: null,
    cardFee: { mode: 'exempt' }, supply: null, techCount: 8 },
  { id: 'old-french-mani',   name: 'French manicure (regular)', category: 'Manicure', duration_min: 35, price_cents: 3000, color_token: '--avatar-rose', taxable: false, active: false, variable_price: false, price_from_cents: null, price_to_cents: null, variable_price_note: null,
    cardFee: { mode: 'default' }, supply: null, techCount: 0 },
];

const CATEGORY_ORDER = ['Manicure', 'Pedicure', 'Enhancement', 'Add-on', 'Waxing', 'Removal'];

// Global card-fee policy default (the hybrid model — service-level override beats this).
const POLICY = {
  cardFeeDefaultCents: 300, // $3 per qualifying service paid by card/gift
  cardFeeMethods: ['Card', 'Gift card'],
  cardFeeMainCategories: ['Manicure', 'Pedicure', 'Enhancement', 'Waxing', 'Removal'],
};

const EXEMPT_TECHS = [
  { id: 'maya', name: 'Maya', initials: 'MA', color: '--avatar-rose',  role: 'Owner' },
  { id: 'linh', name: 'Linh', initials: 'LI', color: '--avatar-green', role: 'Family · senior tech' },
];

// ---------- Format helpers ----------
function fmtPrice(cents) {
  if (cents == null) return '—';
  const d = cents / 100;
  return d % 1 === 0 ? `$${d}` : `$${d.toFixed(2)}`;
}
function fmtRange(fromC, toC) {
  return `${fmtPrice(fromC)}–${fmtPrice(toC).replace('$', '')}`;
}
function priceLabel(s) {
  if (s.variable_price && s.price_from_cents != null && s.price_to_cents != null) {
    return fmtRange(s.price_from_cents, s.price_to_cents);
  }
  return fmtPrice(s.price_cents);
}

// Effective card fee in cents for a service (or null if exempt / no fee).
function effectiveCardFeeCents(s, policy = POLICY) {
  if (!s.cardFee || s.cardFee.mode === 'exempt') return null;
  if (s.cardFee.mode === 'custom') return s.cardFee.custom_cents ?? 0;
  return policy.cardFeeDefaultCents;
}

// Net to tech for a fixed-price service paid by card: price − cardFee − supply.
// Used in V2's payout preview. Cash payouts skip the card fee.
function netToTech(s, method = 'card', policy = POLICY) {
  const base = s.variable_price ? (s.price_from_cents ?? 0) : (s.price_cents ?? 0);
  let net = base;
  if (method === 'card' || method === 'gift') {
    const cf = effectiveCardFeeCents(s, policy);
    if (cf != null) net -= cf;
  }
  if (s.supply) net -= s.supply.amount_cents;
  return net;
}

// Count services currently referencing a supply type (active services only).
function supplyTypeUsageCount(typeId, services = SERVICES) {
  return services.filter(s => s.active && s.supply?.type_id === typeId).length;
}

// ─── SupplyTypePicker ──────────────────────────────────────────────────────
// A dropdown of active supply types with an inline "+ Create new type"
// option. Used in the service edit panel (V1, V2).
//
// Behavior:
//   - Closed: shows current selected type name (or "Pick a type")
//   - Open: lists active types, each clickable; bottom row is "+ Create new"
//   - "+ Create new" reveals an inline text input + confirm/cancel buttons.
//     Pressing Enter (or clicking ✓) creates the type and selects it.
//
// Props:
//   value:   currently selected type_id (string | null)
//   onChange: (typeId: string) => void
function SupplyTypePicker({ value, onChange, placeholder = 'Pick a supply type' }) {
  const [types] = useSupplyTypes();
  const [open, setOpen]           = React.useState(false);
  const [adding, setAdding]       = React.useState(false);
  const [newName, setNewName]     = React.useState('');
  const rootRef                   = React.useRef(null);
  const inputRef                  = React.useRef(null);
  const activeTypes               = types.filter(t => !t.archived);
  const selected                  = findSupplyType(value, types);

  // Close on outside click / Esc
  React.useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
        setAdding(false);
        setNewName('');
      }
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        setOpen(false);
        setAdding(false);
        setNewName('');
      }
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  React.useEffect(() => {
    if (adding && inputRef.current) inputRef.current.focus();
  }, [adding]);

  function pick(id) {
    onChange(id);
    setOpen(false);
    setAdding(false);
    setNewName('');
  }
  function commitNew() {
    const created = addSupplyType(newName);
    if (created) pick(created.id);
    else { setAdding(false); setNewName(''); }
  }

  return (
    <div ref={rootRef} style={{ position: 'relative', minWidth: 0 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%', gap: 8,
          padding: '7px 10px',
          background: 'var(--background)',
          border: '1px solid var(--input)',
          borderRadius: 'var(--radius-md)',
          fontSize: 13, fontFamily: 'var(--font-sans)',
          color: selected ? 'var(--foreground)' : 'var(--muted-foreground)',
          cursor: 'pointer',
          textAlign: 'left',
          minWidth: 0,
        }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
          {selected ? selected.name : placeholder}
        </span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          style={{ flexShrink: 0, opacity: 0.7, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div role="listbox" style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          background: 'var(--popover)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-md)',
          padding: 4,
          zIndex: 30,
          maxHeight: 280, overflowY: 'auto',
        }}>
          {activeTypes.length === 0 && !adding && (
            <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--muted-foreground)' }}>
              No supply types yet. Create one below.
            </div>
          )}
          {activeTypes.map(t => {
            const isSel = t.id === value;
            return (
              <button key={t.id} type="button" role="option" aria-selected={isSel}
                onClick={() => pick(t.id)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  width: '100%', gap: 8,
                  padding: '7px 10px',
                  background: isSel ? 'var(--accent)' : 'transparent',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 13, color: 'var(--foreground)',
                  fontFamily: 'var(--font-sans)',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
                onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = 'var(--accent)'; }}
                onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = 'transparent'; }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                {isSel && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            );
          })}

          {/* Divider + add row */}
          <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
          {!adding ? (
            <button type="button"
              onClick={() => setAdding(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                width: '100%',
                padding: '7px 10px',
                background: 'transparent',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                fontSize: 13, color: 'var(--rose-700)',
                fontFamily: 'var(--font-sans)',
                fontWeight: 500,
                cursor: 'pointer', textAlign: 'left',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Create new supply type…
            </button>
          ) : (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 6px 6px 10px',
            }}>
              <input
                ref={inputRef}
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); commitNew(); }
                  if (e.key === 'Escape') { e.preventDefault(); setAdding(false); setNewName(''); }
                }}
                placeholder="e.g. Builder gel, Polygel"
                style={{
                  flex: 1, minWidth: 0,
                  padding: '6px 8px',
                  fontSize: 13, fontFamily: 'var(--font-sans)',
                  border: '1px solid var(--input)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--background)',
                  color: 'var(--foreground)',
                  outline: 'none',
                }}
              />
              <button type="button" onClick={commitNew}
                disabled={!newName.trim()}
                style={{
                  padding: '6px 10px',
                  background: 'var(--primary)', color: 'var(--primary-foreground)',
                  border: 'none', borderRadius: 'var(--radius-sm)',
                  fontSize: 12, fontWeight: 600, cursor: newName.trim() ? 'pointer' : 'not-allowed',
                  opacity: newName.trim() ? 1 : 0.4,
                  fontFamily: 'var(--font-sans)',
                }}>
                Add
              </button>
              <button type="button" onClick={() => { setAdding(false); setNewName(''); }}
                style={{
                  padding: '6px 8px',
                  background: 'transparent', color: 'var(--muted-foreground)',
                  border: 'none', borderRadius: 'var(--radius-sm)',
                  fontSize: 12, cursor: 'pointer',
                  fontFamily: 'var(--font-sans)',
                }}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Globals ────────────────────────────────────────────────────────────────
window.SERVICES_DATA = SERVICES;
window.CATEGORY_ORDER = CATEGORY_ORDER;
window.POLICY = POLICY;
window.EXEMPT_TECHS = EXEMPT_TECHS;
window.SUPPLY_TYPES = _supplyTypes; // legacy direct read; prefer useSupplyTypes()
window.getSupplyTypes = getSupplyTypes;
window.setSupplyTypes = setSupplyTypes;
window.useSupplyTypes = useSupplyTypes;
window.findSupplyType = findSupplyType;
window.supplyTypeName = supplyTypeName;
window.supplyTypeUsageCount = supplyTypeUsageCount;
window.addSupplyType = addSupplyType;
window.SupplyTypePicker = SupplyTypePicker;
window.fmtPrice = fmtPrice;
window.fmtRange = fmtRange;
window.priceLabel = priceLabel;
window.effectiveCardFeeCents = effectiveCardFeeCents;
window.netToTech = netToTech;
