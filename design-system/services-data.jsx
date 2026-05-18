// Shared data + helpers for the Services-page variations.
// All money is in cents internally to match the existing schema; UI formats
// to dollars on display.

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
    cardFee: { mode: 'default' }, supply: { amount_cents: 500, label: 'GelX tips & gel' }, techCount: 5 },
  { id: 'gelx-refill',       name: 'GelX refill',         category: 'Enhancement', duration_min: 60, price_cents: 5500, color_token: '--avatar-purple', taxable: false, active: true, variable_price: false, price_from_cents: null, price_to_cents: null, variable_price_note: null,
    cardFee: { mode: 'default' }, supply: { amount_cents: 500, label: 'GelX tips & gel' }, techCount: 5 },
  { id: 'acrylic-fills-gel', name: 'Acrylic fills · gel', category: 'Enhancement', duration_min: 60, price_cents: 6500, color_token: '--avatar-amber', taxable: false, active: true, variable_price: false, price_from_cents: null, price_to_cents: null, variable_price_note: null,
    cardFee: { mode: 'default' }, supply: null, techCount: 4 },

  // --- Add-ons ---
  { id: 'addon-chrome',      name: 'Chrome finish',       category: 'Add-on',      duration_min: 15, price_cents: 1000, color_token: '--avatar-slate', taxable: false, active: true, variable_price: false, price_from_cents: null, price_to_cents: null, variable_price_note: null,
    cardFee: { mode: 'exempt' }, supply: { amount_cents: 500, label: 'Chrome powder' }, techCount: 8 },
  { id: 'addon-cat-eyes',    name: 'Cat-eye effect',      category: 'Add-on',      duration_min: 15, price_cents: 1000, color_token: '--avatar-slate', taxable: false, active: true, variable_price: false, price_from_cents: null, price_to_cents: null, variable_price_note: null,
    cardFee: { mode: 'exempt' }, supply: { amount_cents: 500, label: 'Cat-eye gel' }, techCount: 8 },
  { id: 'addon-opi',         name: 'OPI polish change',   category: 'Add-on',      duration_min: 15, price_cents: 0,    color_token: '--avatar-slate', taxable: false, active: true, variable_price: false, price_from_cents: null, price_to_cents: null, variable_price_note: null,
    cardFee: { mode: 'exempt' }, supply: { amount_cents: 500, label: 'OPI bottle wear' }, techCount: 8 },
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

window.SERVICES_DATA = SERVICES;
window.CATEGORY_ORDER = CATEGORY_ORDER;
window.POLICY = POLICY;
window.EXEMPT_TECHS = EXEMPT_TECHS;
window.fmtPrice = fmtPrice;
window.fmtRange = fmtRange;
window.priceLabel = priceLabel;
window.effectiveCardFeeCents = effectiveCardFeeCents;
window.netToTech = netToTech;
