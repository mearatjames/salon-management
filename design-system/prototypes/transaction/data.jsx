// Shared transaction state, services catalog, and design tokens
// All variations consume this so they show the same data.

// `variable: true` means the price genuinely changes per booking (length, design,
// nail count). Those services open the price sheet automatically on add.
// `priceFrom` is the lower anchor for "from $X" display; absent => "Variable".
// `presets` are quick-pick buttons in the sheet; first preset becomes the default
// when the user hits "Use default" or skips.
const SERVICES = [
  // ───────── MANICURE ─────────
  { id: "classic-mani",                 name: "Classic mani",                              time: 30,  cat: "Manicure",    variable: true, price: 25 },
  { id: "manicure-gel",                 name: "Manicure Gel",                              time: 30,  cat: "Manicure",                    price: 40 },
  { id: "manicure-regular-polish",      name: "Manicure Regular Polish",                   time: 45,  cat: "Manicure",    variable: true, price: 25 },
  { id: "polish-change-natural",        name: "Polish change (On Natural Nails)",          time: 40,  cat: "Manicure",    variable: true, price: 15 },
  { id: "gel-polish-change-natural",    name: "Gel Polish Change On Natural Nails",        time: 60,  cat: "Manicure",    variable: true, price: 25 },
  { id: "mens-mani",                    name: "Mens mani",                                 time: 30,  cat: "Manicure",    variable: true, price: 25 },
  { id: "nails-cut",                    name: "Nails cut",                                 time: 30,  cat: "Manicure",    variable: true, price: 10 },
  { id: "regular-polish-change-hands",  name: "Regular polish change on hands",            time: 30,  cat: "Manicure",    variable: true, price: 15 },
  { id: "gel-color-change",             name: "Gel color change",                          time: 30,  cat: "Manicure",    variable: true, price: 20 },

  // ───────── PEDICURE ─────────
  { id: "classic-pedi",                 name: "Classic Pedicure",                          time: 45,  cat: "Pedicure",    variable: true, price: 38, priceFrom: 38, priceTo: 53,
    presets: [{ label: "Base", price: 38 }, { label: "With gel", price: 53 }] },
  { id: "classic-pedi-gel",             name: "Classic pedicure w Gel",                    time: 30,  cat: "Pedicure",    variable: true, price: 53 },
  { id: "express-pedi",                 name: "Express Pedi",                              time: 30,  cat: "Pedicure",    variable: true, price: 33, priceFrom: 33, priceTo: 48,
    presets: [{ label: "Base", price: 33 }, { label: "With gel", price: 48 }] },
  { id: "deluxe-pedi",                  name: "Deluxe Pedicure",                           time: 30,  cat: "Pedicure",    variable: true, price: 55, priceFrom: 55, priceTo: 70,
    presets: [{ label: "Base", price: 55 }, { label: "With gel", price: 70 }] },
  { id: "deluxe-pedi-reg",              name: "Deluxe Pedi w Reg Color",                   time: 30,  cat: "Pedicure",    variable: true, price: 60 },
  { id: "deluxe-pedi-gel",              name: "Deluxe Pedi w Gel Polish",                  time: 30,  cat: "Pedicure",    variable: true, price: 75 },
  { id: "deep-clean-pedi",              name: "Deep Clean Pedi",                           time: 30,  cat: "Pedicure",    variable: true, price: 50 },
  { id: "vitamin-recharge-pedi",        name: "Vitamin Recharge Pedicure",                 time: 30,  cat: "Pedicure",    variable: true, price: 78, priceFrom: 78, priceTo: 88,
    presets: [{ label: "Base", price: 78 }, { label: "With gel", price: 88 }] },
  { id: "energy-boost-pedi",            name: "Energy Boost Pedicure",                     time: 30,  cat: "Pedicure",    variable: true, price: 73, priceFrom: 73, priceTo: 88,
    presets: [{ label: "Base", price: 73 }, { label: "With gel", price: 88 }] },
  { id: "energy-boost-pedi-reg",        name: "Energy boost pedi w regular",               time: 30,  cat: "Pedicure",                    price: 70 },
  { id: "hemp-steam-pedi",              name: "Hemp Relaxation Steam Pedicure",            time: 30,  cat: "Pedicure",    variable: true, price: 86, priceFrom: 86, priceTo: 101,
    presets: [{ label: "Base", price: 86 }, { label: "With gel", price: 101 }] },
  { id: "lavender-steam-pedi-reg",      name: "Lavender Steam Pedi with Regular Color",    time: 60,  cat: "Pedicure",    variable: true, price: 86, priceFrom: 86, priceTo: 101,
    presets: [{ label: "Base", price: 86 }, { label: "Upgraded", price: 101 }] },
  { id: "milk-honey-pedi",              name: "Milk and Honey Pedicure",                   time: 30,  cat: "Pedicure",                    price: 0, promo: true, note: "Promo" },
  { id: "kid-pedi",                     name: "Kid Pedi (8 yr & under)",                   time: 30,  cat: "Pedicure",    variable: true, price: 25 },
  { id: "toe-polish-change",            name: "Toe polish change",                         time: 30,  cat: "Pedicure",    variable: true, price: 15 },
  { id: "toe-nails-cut",                name: "Toe nails cut",                             time: 30,  cat: "Pedicure",    variable: true, price: 10 },

  // ───────── ENHANCEMENT ─────────
  { id: "acrylic-fullset-gel",          name: "Acrylic Full Set w/Gel",                    time: 120, cat: "Enhancement", variable: true, price: 80 },
  { id: "acrylic-fills-gel",            name: "Acrylic Fills w/Gel",                       time: 120, cat: "Enhancement", variable: true, price: 65 },
  { id: "acrylic-fill-3wk",             name: "3+ week acrylic fill w/Gel",                time: 30,  cat: "Enhancement", variable: true, price: 70 },
  { id: "gel-polish-change-acrylic",    name: "Gel Polish Change on Acrylic",              time: 45,  cat: "Enhancement", variable: true, price: 30 },
  { id: "hard-gel-overlay",             name: "Hard Gel Overlay",                          time: 45,  cat: "Enhancement",                 price: 53 },
  { id: "hard-gel-rebase",              name: "Hard Gel Rebase",                           time: 75,  cat: "Enhancement",                 price: 53 },
  { id: "rebase-4wk",                   name: "4+ weeks Rebase",                           time: 30,  cat: "Enhancement",                 price: 58 },
  { id: "builder-gel",                  name: "Builder Gel",                               time: 75,  cat: "Enhancement",                 price: 53 },
  { id: "gelx-fullset",                 name: "Gel X Fullset (Soft Gel Extension)",        time: 90,  cat: "Enhancement",                 price: 65 },
  { id: "gelx-refill",                  name: "Gel X Refill",                              time: 30,  cat: "Enhancement", variable: true, price: 55 },
  { id: "gelx-apres",                   name: "Gel X (Aprés) Soft Gel Extension",          time: 30,  cat: "Enhancement", variable: true, price: 65 },
  { id: "dipping-powder",               name: "Dipping Powder",                            time: 30,  cat: "Enhancement",                 price: 50 },
  { id: "dipping-gel",                  name: "Dipping with Gel polish",                   time: 30,  cat: "Enhancement",                 price: 55 },

  // ───────── ADD-ONS · HANDS ─────────
  { id: "addon-french-tips",            name: "French Tips",                               time: 30, cat: "Add-ons", variable: true, price: 10 },
  { id: "addon-side-french",            name: "Side French",                               time: 30, cat: "Add-ons", variable: true, price: 10 },
  { id: "addon-double-french",          name: "Double French",                             time: 30, cat: "Add-ons", variable: true, price: 15 },
  { id: "addon-custom-pink-french",     name: "Custom pink on French",                     time: 30, cat: "Add-ons", variable: true, price: 15 },
  { id: "addon-designs",                name: "Designs",                                   time: 30, cat: "Add-ons", variable: true, price: 5 },
  { id: "addon-3d-designs",             name: "3D designs",                                time: 30, cat: "Add-ons", variable: true, price: 10 },
  { id: "addon-airbrush",               name: "Airbrush Designs",                          time: 30, cat: "Add-ons", variable: true, price: 10 },
  { id: "addon-airbrush-ombre",         name: "Air brush ombre",                           time: 30, cat: "Add-ons", variable: true, price: 15 },
  { id: "addon-ombre",                  name: "Ombre Designs",                             time: 30, cat: "Add-ons", variable: true, price: 15 },
  { id: "addon-cat-eyes",               name: "Cat eyes",                                  time: 30, cat: "Add-ons", variable: true, price: 10 },
  { id: "addon-foil",                   name: "Foil Transfer",                             time: 30, cat: "Add-ons", variable: true, price: 10 },
  { id: "addon-encapsulation",          name: "Encapsulation Design",                      time: 30, cat: "Add-ons", variable: true, price: 15 },
  { id: "addon-custom-art-all10",       name: "Custom nail art (all 10 nails)",            time: 30, cat: "Add-ons", variable: true, price: 25 },
  { id: "addon-rhinestones",            name: "Rhinestones Designs",                       time: 30, cat: "Add-ons", variable: true, price: 10 },
  { id: "addon-gold-flakes",            name: "Gold Flakes",                               time: 30, cat: "Add-ons", variable: true, price: 10 },
  { id: "addon-nail-charms",            name: "Nail Charms",                               time: 30, cat: "Add-ons", variable: true, price: 10 },
  { id: "addon-fairy-dust",             name: "Fairy dust",                                time: 30, cat: "Add-ons", variable: true, price: 5 },
  { id: "addon-sugar-effect",           name: "Sugar Effect",                              time: 30, cat: "Add-ons", variable: true, price: 5 },
  { id: "addon-matte",                  name: "Matte",                                     time: 30, cat: "Add-ons", variable: true, price: 5 },
  { id: "addon-chrome",                 name: "Chrome",                                    time: 30, cat: "Add-ons", variable: true, price: 10 },
  { id: "addon-stain-re-topcoat",       name: "Stain Re top coat",                         time: 30, cat: "Add-ons", variable: true, price: 5 },
  { id: "addon-shining-buff",           name: "Shining Buff",                              time: 30, cat: "Add-ons",                 price: 7 },
  { id: "addon-nail-length",            name: "Nail Length",                               time: 30, cat: "Add-ons", variable: true, price: 5 },
  { id: "addon-nail-shape",             name: "Nail shape",                                time: 30, cat: "Add-ons", variable: true, price: 5 },
  { id: "addon-changing-shape",         name: "Changing Shape",                            time: 30, cat: "Add-ons", variable: true, price: 5 },
  { id: "addon-cut-reshape",            name: "Cut Short and Reshape",                     time: 30, cat: "Add-ons", variable: true, price: 5 },
  { id: "addon-cuticle-trim",           name: "Cuticle Trim",                              time: 30, cat: "Add-ons", variable: true, price: 5 },
  { id: "addon-nail-fixing",            name: "Nail Fixing",                               time: 30, cat: "Add-ons", variable: true, price: 5 },
  { id: "addon-nail-replacing",         name: "Nail Replacing",                            time: 30, cat: "Add-ons", variable: true, price: 5 },
  { id: "addon-sculpted",               name: "Sculpted",                                  time: 30, cat: "Add-ons", variable: true, price: 10 },
  { id: "addon-gel-polish",             name: "Gel polish (add-on)",                       time: 30, cat: "Add-ons", variable: true, price: 15 },
  { id: "addon-colors-3plus",           name: "Up to 3+ colors",                           time: 30, cat: "Add-ons", variable: true, price: 5 },
  { id: "addon-colors-5plus",           name: "Up to 5+ colors",                           time: 30, cat: "Add-ons", variable: true, price: 10 },
  { id: "addon-colors-10plus",          name: "Up to 10+ colors",                          time: 30, cat: "Add-ons", variable: true, price: 15 },

  // ───────── ADD-ONS · FEET ─────────
  { id: "addon-paraffin",               name: "Paraffin (feet)",                           time: 30, cat: "Add-ons", variable: true, price: 10 },
  { id: "addon-callus",                 name: "Callus treatment",                          time: 30, cat: "Add-ons", variable: true, price: 10 },
  { id: "addon-sugar-scrub",            name: "Sugar scrub (feet)",                        time: 30, cat: "Add-ons", variable: true, price: 10 },
  { id: "addon-deep-clean-toes",        name: "Deep clean on toes",                        time: 30, cat: "Add-ons", variable: true, price: 10 },
  { id: "addon-toe-recon",              name: "Toe Nails Reconstruction",                  time: 30, cat: "Add-ons", variable: true, price: 10 },
  { id: "addon-gel-color-toes",         name: "GEL color change on toes",                  time: 30, cat: "Add-ons", variable: true, price: 20 },
  { id: "addon-acrylic-toes",           name: "Acrylic on toes",                           time: 30, cat: "Add-ons", variable: true, price: 20 },
  { id: "addon-acrylic-set-toes",       name: "Acrylic set on Toes",                       time: 30, cat: "Add-ons", variable: true, price: 30 },
  { id: "addon-acrylic-full-toes",      name: "Acrylic Full Set on Toes",                  time: 30, cat: "Add-ons", variable: true, price: 50 },
  { id: "addon-acrylic-take-off-toes",  name: "Acrylic Take off on toes",                  time: 30, cat: "Add-ons", variable: true, price: 10 },

  // ───────── WAXING ─────────
  { id: "wax-eyebrows",                 name: "Eyebrows Wax",                              time: 30, cat: "Waxing", variable: true, price: 12 },
  { id: "wax-chin",                     name: "Chin Wax",                                  time: 30, cat: "Waxing", variable: true, price: 10 },
  { id: "wax-lips",                     name: "Lips wax",                                  time: 30, cat: "Waxing", variable: true, price: 8 },
  { id: "wax-mustache",                 name: "Mustache Wax",                              time: 30, cat: "Waxing", variable: true, price: 10 },
  { id: "wax-full-face",                name: "Full face Wax",                             time: 30, cat: "Waxing", variable: true, price: 35 },
  { id: "wax-arms",                     name: "Arms Wax",                                  time: 30, cat: "Waxing", variable: true, price: 35 },
  { id: "wax-underarms",                name: "Underarms Wax",                             time: 30, cat: "Waxing", variable: true, price: 20 },
  { id: "wax-legs",                     name: "Legs wax",                                  time: 30, cat: "Waxing", variable: true, price: 50 },

  // ───────── REMOVAL ─────────
  { id: "removal-gel",                  name: "Gel Polish Removal",                        time: 30, cat: "Removal", variable: true, price: 10 },
  { id: "removal-acrylic",              name: "Acrylic Removal",                           time: 30, cat: "Removal", variable: true, price: 15 },
  { id: "removal-hard-gel",             name: "Hard Gel Removal",                          time: 30, cat: "Removal", variable: true, price: 15 },
  { id: "removal-gelx",                 name: "Gel X Removal",                             time: 30, cat: "Removal", variable: true, price: 10 },
  { id: "removal-dipping",              name: "Dipping Powder Removal",                    time: 30, cat: "Removal", variable: true, price: 15 },
];

const CATEGORIES = ["All", "Manicure", "Pedicure", "Enhancement", "Add-ons", "Waxing", "Removal"];

const PAYMENT_METHODS = [
  { id: "card",   label: "Card",      hint: "Tap, chip, or swipe" },
  { id: "cash",   label: "Cash",      hint: "Enter amount given" },
  { id: "gift",   label: "Gift card", hint: "Scan or enter code" },
  { id: "split",  label: "Split",     hint: "Combine methods" },
];

const TIP_PRESETS = [
  { label: "No tip", pct: 0 },
  { label: "15%", pct: 0.15 },
  { label: "18%", pct: 0.18 },
  { label: "20%", pct: 0.20 },
  { label: "25%", pct: 0.25 },
];

// Keep small — single source of truth for tax rate (visible to user too)
const TAX_RATE = 0.0875;

// Nail tech roster — 6-mani / 6-pedi salon, ~6 techs on a typical shift.
// Initials are derived; tone is the avatar background hue (oklch chroma 0.06).
const STAFF = [
  { id: "maya",   name: "Maya P.",     full: "Maya Patel",         tone: 25  },
  { id: "linh",   name: "Linh T.",     full: "Linh Tran",          tone: 60  },
  { id: "aria",   name: "Aria K.",     full: "Aria Kim",           tone: 95  },
  { id: "jules",  name: "Jules M.",    full: "Jules Mendez",       tone: 140 },
  { id: "sasha",  name: "Sasha R.",    full: "Sasha Romanov",      tone: 200 },
  { id: "noor",   name: "Noor A.",     full: "Noor Abdi",          tone: 240 },
  { id: "priya",  name: "Priya S.",    full: "Priya Singh",        tone: 290 },
  { id: "tess",   name: "Tess W.",     full: "Tess Walker",        tone: 340 },
];

// A realistic stream of "today's" transactions. Tied to STAFF + SERVICES so
// landing-page totals and the recent-transactions feed are internally consistent.
const TX_HISTORY = [
  { id: "tx-0114", time: "9:12 AM",  client: "Emily Chen",        techs: ["maya"],          items: [{ id: "classic-mani", qty: 1, price: 25 }, { id: "addon-paraffin", qty: 1, price: 10 }],                                  tipPct: 0.20, method: "card" },
  { id: "tx-0115", time: "9:35 AM",  client: "Walk-in",           techs: ["linh"],          items: [{ id: "classic-pedi", qty: 1, price: 38 }],                                                                               tipPct: 0.18, method: "cash" },
  { id: "tx-0116", time: "10:02 AM", client: "Dana Reyes",        techs: ["aria"],          items: [{ id: "manicure-gel", qty: 1 }],                                                                                          tipPct: 0.20, method: "card" },
  { id: "tx-0117", time: "10:24 AM", client: "Walk-in",           techs: ["jules", "sasha"],items: [{ id: "classic-mani", qty: 1, price: 25 }, { id: "classic-pedi", qty: 1, price: 38 }],                                    tipPct: 0.15, method: "card" },
  { id: "tx-0118", time: "10:55 AM", client: "Sara K.",           techs: ["noor"],          items: [{ id: "gel-polish-change-natural", qty: 1, price: 30 }],                                                                  tipPct: 0.25, method: "card" },
  { id: "tx-0119", time: "11:20 AM", client: "Maya G.",           techs: ["priya"],         items: [{ id: "deluxe-pedi", qty: 1, price: 70 }],                                                                                tipPct: 0.20, method: "card" },
  { id: "tx-0120", time: "11:48 AM", client: "Walk-in",           techs: ["tess"],          items: [{ id: "removal-gel", qty: 1, price: 10 }, { id: "manicure-gel", qty: 1 }],                                                tipPct: 0,    method: "gift" },
  { id: "tx-0121", time: "12:15 PM", client: "Bri R.",            techs: ["maya"],          items: [{ id: "acrylic-fullset-gel", qty: 1, price: 110 }],                                                                       tipPct: 0.20, method: "card" },
  { id: "tx-0122", time: "12:40 PM", client: "Elena V.",          techs: ["aria", "linh"],  items: [{ id: "classic-pedi", qty: 1, price: 38 }, { id: "classic-mani", qty: 1, price: 25 }],                                    tipPct: 0.18, method: "cash" },
  { id: "tx-0123", time: "1:05 PM",  client: "Walk-in",           techs: ["jules"],         items: [{ id: "acrylic-fills-gel", qty: 1, price: 65 }],                                                                          tipPct: 0.15, method: "card" },
  { id: "tx-0124", time: "1:32 PM",  client: "Hannah B.",         techs: ["sasha"],         items: [{ id: "dipping-powder", qty: 1 }, { id: "addon-custom-art-all10", qty: 1, price: 45 }],                                   tipPct: 0.22, method: "card" },
  { id: "tx-0125", time: "2:01 PM",  client: "Walk-in",           techs: ["noor"],          items: [{ id: "classic-mani", qty: 1, price: 25 }],                                                                               tipPct: 0.20, method: "cash" },
  { id: "tx-0126", time: "2:28 PM",  client: "Joy L.",            techs: ["priya", "tess"], items: [{ id: "hemp-steam-pedi", qty: 1, price: 86 }, { id: "manicure-regular-polish", qty: 1, price: 30 }],                      tipPct: 0.20, method: "card" },
  { id: "tx-0127", time: "2:55 PM",  client: "Walk-in",           techs: ["maya"],          items: [{ id: "addon-french-tips", qty: 1, price: 10 }, { id: "manicure-gel", qty: 1 }],                                          tipPct: 0,    method: "card" },
  { id: "tx-0128", time: "3:22 PM",  client: "Riya P.",           techs: ["aria"],          items: [{ id: "addon-custom-art-all10", qty: 1, price: 85 }, { id: "manicure-gel", qty: 1 }],                                    tipPct: 0.20, method: "card" },
  { id: "tx-0129", time: "3:50 PM",  client: "Tasha W.",          techs: ["linh"],          items: [{ id: "classic-pedi", qty: 1, price: 38 }],                                                                               tipPct: 0.18, method: "gift" },
  { id: "tx-0130", time: "4:14 PM",  client: "Walk-in",           techs: ["jules"],         items: [{ id: "classic-mani", qty: 1, price: 25 }, { id: "addon-paraffin", qty: 1, price: 10 }],                                  tipPct: 0.20, method: "card" },
];

// Compute a single transaction's totals from its items + tip + tax.
function txTotals(tx) {
  const subtotal = tx.items.reduce((s, it) => {
    const svc = SERVICES.find(x => x.id === it.id);
    const price = it.price != null ? it.price : (svc ? svc.price : 0);
    return s + price * (it.qty || 1);
  }, 0);
  const tip = subtotal * (tx.tipPct || 0);
  const tax = (subtotal + tip) * TAX_RATE;
  const total = subtotal + tip + tax;
  const services = tx.items.reduce((n, it) => n + (it.qty || 1), 0);
  return { subtotal, tip, tax, total, services };
}

// Aggregate a list of transactions (for the dashboard cards).
function txAggregate(list) {
  const agg = { count: list.length, services: 0, subtotal: 0, tip: 0, tax: 0, total: 0, byMethod: { card: 0, cash: 0, gift: 0 } };
  for (const tx of list) {
    const t = txTotals(tx);
    agg.services += t.services;
    agg.subtotal += t.subtotal;
    agg.tip += t.tip;
    agg.tax += t.tax;
    agg.total += t.total;
    agg.byMethod[tx.method] = (agg.byMethod[tx.method] || 0) + t.total;
  }
  return agg;
}

window.SERVICES = SERVICES;
window.CATEGORIES = CATEGORIES;
window.PAYMENT_METHODS = PAYMENT_METHODS;
window.TIP_PRESETS = TIP_PRESETS;
window.TAX_RATE = TAX_RATE;
window.STAFF = STAFF;
window.TX_HISTORY = TX_HISTORY;
window.txTotals = txTotals;
window.txAggregate = txAggregate;
