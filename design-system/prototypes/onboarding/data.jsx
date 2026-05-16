// data.jsx — Mock roster for the Onboarding prototype
// Three buckets: pending invites, active accounts, offboarded.
// "User" here means an Auth account (email login) — distinct from Staff
// (operational record on the login PIN screen).

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

// Each row's `state` is one of: 'invited' | 'active' | 'offboarded'
const INITIAL_USERS = [
  // ── Pending invites ──────────────────────────────────────────────────
  {
    id: 'u-1',
    display_name: 'Hana Soto',
    email: 'hana.soto@gmail.com',
    role: 'technician',
    color: 'oklch(0.62 0.17 50)',
    state: 'invited',
    pin_set: false,
    invited_at: '2 days ago',
    invited_by: 'Priya Raman',
    invite_method: 'magic_link',
  },
  {
    id: 'u-2',
    display_name: 'Jordan Lee',
    email: 'jordan@tangnails.com',
    role: 'front_desk',
    color: 'oklch(0.56 0.13 200)',
    state: 'invited',
    pin_set: false,
    invited_at: '6 hours ago',
    invited_by: 'Priya Raman',
    invite_method: 'password',
  },

  // ── Active accounts ──────────────────────────────────────────────────
  {
    id: 'u-3',
    display_name: 'Priya Raman',
    email: 'priya@tangnails.com',
    role: 'owner',
    color: 'oklch(0.55 0.12 12)',
    state: 'active',
    pin_set: true,
    joined_at: 'Jan 2024',
    last_sign_in: 'Today',
    is_you: true,
  },
  {
    id: 'u-4',
    display_name: 'Alexis Moore',
    email: 'alexis@tangnails.com',
    role: 'manager',
    color: 'oklch(0.76 0.14 75)',
    state: 'active',
    pin_set: true,
    joined_at: 'Mar 2024',
    last_sign_in: '2 hours ago',
  },
  {
    id: 'u-5',
    display_name: 'Maya Chen',
    email: 'maya.c@gmail.com',
    role: 'technician',
    color: 'oklch(0.60 0.13 240)',
    state: 'active',
    pin_set: true,
    joined_at: 'Feb 2024',
    last_sign_in: 'Yesterday',
  },
  {
    id: 'u-6',
    display_name: 'Tom Kwan',
    email: 'tomk@gmail.com',
    role: 'technician',
    color: 'oklch(0.62 0.13 150)',
    state: 'active',
    pin_set: false,
    joined_at: 'Apr 2024',
    last_sign_in: '3 days ago',
  },

  // ── Offboarded ───────────────────────────────────────────────────────
  {
    id: 'u-7',
    display_name: 'Jin Park',
    email: 'jin.park@gmail.com',
    role: 'front_desk',
    color: 'oklch(0.56 0.13 200)',
    state: 'offboarded',
    pin_set: false,
    offboarded_at: 'Apr 2026',
    offboarded_by: 'Priya Raman',
    reason: 'Left the salon',
  },
];

const ROLE_PERMISSIONS = {
  owner: {
    label: 'Owner',
    summary: 'Full access. Can manage staff, billing, settings, and offboard anyone except themselves.',
    grants: [
      'Calendar, Clients, Checkout, Walk-in',
      'Services & pricing',
      'End of Day & Day Report',
      'Refunds & voids (no manager approval needed)',
      'Settings (Staff, Billing, Onboarding)',
    ],
    blocks: [],
  },
  manager: {
    label: 'Manager',
    summary: 'Day-to-day operations. Can approve refunds/voids inline. Cannot manage billing or onboard new users.',
    grants: [
      'Calendar, Clients, Checkout, Walk-in',
      'Services & pricing',
      'End of Day & Day Report',
      'Refunds & voids (authorizing manager)',
      'Settings → Staff (edit-only)',
    ],
    blocks: [
      'Billing & subscription',
      'Onboarding new users',
    ],
  },
  technician: {
    label: 'Tech',
    summary: 'Performs services, takes payments. Most won\'t have email login — PIN only on shared iPad.',
    grants: [
      'Calendar (own column)',
      'Clients (read + notes)',
      'Checkout (their tickets)',
      'Walk-in (seat next)',
    ],
    blocks: [
      'Refunds & voids',
      'Services & pricing edits',
      'Any Settings tab',
    ],
  },
  front_desk: {
    label: 'Front desk',
    summary: 'Books appointments, runs the kiosk, takes payments. No edit access to services or staff.',
    grants: [
      'Calendar (all techs)',
      'Clients',
      'Checkout (all tickets)',
      'Walk-in & kiosk pairing',
    ],
    blocks: [
      'Refunds & voids (manager required)',
      'Services & pricing',
      'Any Settings tab',
    ],
  },
};

const OFFBOARD_REASONS = [
  'Left the salon',
  'On extended leave',
  'Role change',
  'Performance',
  'Other',
];

Object.assign(window, {
  STAFF_COLORS,
  ROLE_ORDER,
  INITIAL_USERS,
  ROLE_PERMISSIONS,
  OFFBOARD_REASONS,
});
