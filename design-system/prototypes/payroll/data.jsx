// data.jsx — Payroll mock for Lacquer Studio
// Mirrors the spreadsheet logic:
//   tech_earnings = income * income_split  +  tips * tip_split
//   tech_earnings = check_portion (W-2)    +  cash_payment

// ── Per-tech rates (income_split & tip_split vary per tech) ─────────────
const TECHS = [
  { id: 'ayay',  name: 'Ayay Mao',     color: 'oklch(0.55 0.12 12)',  income_split: 0.90, tip_split: 1.00, status: 'active',   role: 'Senior tech' },
  { id: 'karin', name: 'Karin Phan',   color: 'oklch(0.60 0.13 240)', income_split: 0.85, tip_split: 1.00, status: 'active',   role: 'Senior tech' },
  { id: 'lily',  name: 'Lily Sok',     color: 'oklch(0.62 0.17 50)',  income_split: 0.65, tip_split: 0.90, status: 'active',   role: 'Tech' },
  { id: 'chheng',name: 'E Chheng',     color: 'oklch(0.62 0.13 150)', income_split: 0.65, tip_split: 1.00, status: 'active',   role: 'Tech' },
  { id: 'cindy', name: 'Cindy Tep',    color: 'oklch(0.55 0.13 270)', income_split: 0.65, tip_split: 1.00, status: 'leave',    role: 'Tech · on leave' },
  { id: 'phally',name: 'Phally Heng',  color: 'oklch(0.56 0.13 200)', income_split: 0.60, tip_split: 0.80, status: 'active',   role: 'Junior tech' },
  { id: 'thun',  name: 'Thun Bun',     color: 'oklch(0.76 0.14 75)',  income_split: 0.60, tip_split: 0.80, status: 'active',   role: 'Junior tech' },
];

// ── Daily breakdown for current period (May 1–15, 2026) ────────────────
// Each entry: [day_of_month, gross_income, gross_card_tips, ticket_count]
// Sundays we're closed; numbers are realistic for a 6-chair salon.
const DAILY = {
  ayay: [
    [1, 580, 62, 7], [2, 720, 84, 8], [3, 0, 0, 0],
    [4, 510, 48, 6], [5, 460, 52, 5], [6, 540, 56, 6], [7, 620, 70, 7], [8, 690, 78, 8], [9, 740, 82, 8], [10, 0, 0, 0],
    [11, 480, 44, 5], [12, 500, 56, 6], [13, 540, 60, 6], [14, 600, 68, 7], [15, 670, 24.99, 8],
  ],
  karin: [
    [1, 480, 40, 6], [2, 620, 56, 7], [3, 0, 0, 0],
    [4, 440, 38, 5], [5, 380, 32, 5], [6, 460, 42, 6], [7, 520, 48, 6], [8, 580, 54, 7], [9, 640, 60, 7], [10, 0, 0, 0],
    [11, 410, 28, 5], [12, 430, 31, 5], [13, 470, 38, 6], [14, 510, 44, 6], [15, 521, 36.03, 6],
  ],
  lily: [
    [1, 360, 42, 5], [2, 480, 56, 6], [3, 0, 0, 0],
    [4, 350, 38, 4], [5, 280, 32, 4], [6, 380, 44, 5], [7, 420, 48, 5], [8, 480, 56, 6], [9, 520, 62, 6], [10, 0, 0, 0],
    [11, 320, 36, 4], [12, 340, 38, 4], [13, 380, 42, 5], [14, 420, 48, 5], [15, 568, 52.22, 6],
  ],
  chheng: [
    [1, 240, 22, 3], [2, 320, 30, 4], [3, 0, 0, 0],
    [4, 220, 18, 3], [5, 200, 16, 3], [6, 260, 24, 3], [7, 280, 26, 4], [8, 320, 30, 4], [9, 360, 32, 4], [10, 0, 0, 0],
    [11, 200, 18, 3], [12, 220, 20, 3], [13, 260, 22, 3], [14, 280, 24, 3], [15, 394, 20.98, 4],
  ],
  cindy: [
    [1,0,0,0],[2,0,0,0],[3,0,0,0],[4,0,0,0],[5,0,0,0],[6,0,0,0],[7,0,0,0],
    [8,0,0,0],[9,0,0,0],[10,0,0,0],[11,0,0,0],[12,0,0,0],[13,0,0,0],[14,0,0,0],[15,0,0,0],
  ],
  phally: [
    [1, 180, 18, 2], [2, 240, 22, 3], [3, 0, 0, 0],
    [4, 160, 14, 2], [5, 140, 12, 2], [6, 180, 16, 2], [7, 200, 18, 3], [8, 220, 22, 3], [9, 260, 26, 3], [10, 0, 0, 0],
    [11, 160, 14, 2], [12, 180, 16, 2], [13, 200, 18, 2], [14, 240, 24, 3], [15, 282, 9.21, 3],
  ],
  thun: [
    [1, 80, 9, 1], [2, 120, 12, 2], [3, 0, 0, 0],
    [4, 60, 6, 1], [5, 0, 0, 0], [6, 80, 8, 1], [7, 100, 10, 1], [8, 120, 12, 2], [9, 140, 14, 2], [10, 0, 0, 0],
    [11, 80, 8, 1], [12, 100, 10, 1], [13, 120, 12, 2], [14, 140, 14, 2], [15, 134, 25.59, 2],
  ],
};

// Check portions (the W-2 reported wage that's paid by physical check).
// Owner sets per tech; the remainder is paid as cash. Senior techs get a
// flat $2,500 / period; mid-tier $1,000–$1,500; junior $0–$1,500.
const CHECK_PORTION = {
  ayay: 2500, karin: 2500, lily: 1003, chheng: 799, cindy: 0, phally: 1500, thun: 0,
};

// Past payouts (history). Each one already locked & paid.
const HISTORY = [
  {
    period_label: 'Apr 16 – Apr 30, 2026',
    paid_on: 'May 2, 2026',
    locked_by: 'Priya Raman',
    totals: { income: 36421, tip_card: 3214, cash: 19847, check: 8302 },
    rows: [
      { tech: 'ayay',  income: 8120, tip: 812.40,  check: 2500, cash: 5620.40, method: 'Zelle'  },
      { tech: 'karin', income: 7240, tip: 691.20,  check: 2500, cash: 3845.20, method: 'Zelle'  },
      { tech: 'lily',  income: 5980, tip: 580.45,  check: 1003, cash: 3279.40, method: 'Cash'   },
      { tech: 'chheng',income: 3120, tip: 318.20,  check: 799,  cash: 1547.20, method: 'Cash'   },
      { tech: 'cindy', income: 0,    tip: 0,       check: 0,    cash: 0,        method: '—'      },
      { tech: 'phally',income: 2240, tip: 224.00,  check: 1500, cash: 23.20,    method: 'Cash'   },
      { tech: 'thun',  income: 1320, tip: 144.10,  check: 0,    cash: 907.28,   method: 'Cash'   },
    ],
  },
  {
    period_label: 'Apr 1 – Apr 15, 2026',
    paid_on: 'Apr 17, 2026',
    locked_by: 'Priya Raman',
    totals: { income: 34280, tip_card: 3110, cash: 18420, check: 8302 },
    rows: [],
  },
  {
    period_label: 'Mar 16 – Mar 31, 2026',
    paid_on: 'Apr 2, 2026',
    locked_by: 'Priya Raman',
    totals: { income: 38110, tip_card: 3402, cash: 21340, check: 8302 },
    rows: [],
  },
  {
    period_label: 'Mar 1 – Mar 15, 2026',
    paid_on: 'Mar 17, 2026',
    locked_by: 'Priya Raman',
    totals: { income: 35920, tip_card: 3188, cash: 19120, check: 8302 },
    rows: [],
  },
];

// ── Derivations ────────────────────────────────────────────────────────
function calcRow(tech) {
  const days = DAILY[tech.id] || [];
  const income  = days.reduce((a, d) => a + d[1], 0);
  const tipCard = days.reduce((a, d) => a + d[2], 0);
  const tickets = days.reduce((a, d) => a + d[3], 0);
  const incomeAfter = income * tech.income_split;
  const tipAfter    = tipCard * tech.tip_split;
  const earnings    = incomeAfter + tipAfter;
  const check       = CHECK_PORTION[tech.id] || 0;
  const cash        = Math.max(0, earnings - check);
  return {
    ...tech,
    days,
    income, tipCard, tickets,
    incomeAfter, tipAfter, earnings,
    check, cash,
  };
}

function periodRows() { return TECHS.map(calcRow); }

function periodTotals(rows) {
  return rows.reduce((a, r) => ({
    income: a.income + r.income,
    incomeAfter: a.incomeAfter + r.incomeAfter,
    tipCard: a.tipCard + r.tipCard,
    tipAfter: a.tipAfter + r.tipAfter,
    earnings: a.earnings + r.earnings,
    check: a.check + r.check,
    cash: a.cash + r.cash,
    tickets: a.tickets + r.tickets,
  }), { income:0, incomeAfter:0, tipCard:0, tipAfter:0, earnings:0, check:0, cash:0, tickets:0 });
}

// Pay periods this year. Current = May 1–15, 2026.
const PERIODS = [
  { id: 'p-2026-05a', label: 'May 1 – May 15, 2026',   short: 'May 1 – 15',   status: 'open',   pay_date: 'May 17, 2026',  is_current: true  },
  { id: 'p-2026-04b', label: 'Apr 16 – Apr 30, 2026',  short: 'Apr 16 – 30',  status: 'paid',   pay_date: 'May 2, 2026'   },
  { id: 'p-2026-04a', label: 'Apr 1 – Apr 15, 2026',   short: 'Apr 1 – 15',   status: 'paid',   pay_date: 'Apr 17, 2026'  },
  { id: 'p-2026-03b', label: 'Mar 16 – Mar 31, 2026',  short: 'Mar 16 – 31',  status: 'paid',   pay_date: 'Apr 2, 2026'   },
];

// Format helpers
function $$(n, opts = {}) {
  const { showCents = true, sign = false } = opts;
  if (!isFinite(n)) return '—';
  const abs = Math.abs(n);
  const formatted = showCents
    ? abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : abs.toLocaleString('en-US', { maximumFractionDigits: 0 });
  const s = sign && n > 0 ? '+' : (n < 0 ? '−' : '');
  return `${s}$${formatted}`;
}
function $$round(n) { return $$(n, { showCents: false }); }
function pct(n) { return `${Math.round(n * 100)}%`; }

Object.assign(window, {
  TECHS, DAILY, CHECK_PORTION, HISTORY, PERIODS,
  calcRow, periodRows, periodTotals,
  $$, $$round, pct,
});
