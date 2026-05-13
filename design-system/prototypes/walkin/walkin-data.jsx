// Walk-in waitlist data + helpers.
// A walk-in entry is a customer who came in without a booking and signed
// the waitlist. Each has a status that moves through the day:
//
//   waiting  → "signed in, hasn't been called yet"
//   called   → "we waved them over / SMS'd them, they're heading to a chair"
//   serving  → "currently with a tech" (also surfaces in the live calendar)
//   done     → "finished, transaction settled" (crossed off the sheet)
//   no-show  → "we called twice, they left or didn't respond"
//
// Times are stored as 24h "HH:MM" strings so they sort lexically. The current
// time is anchored at NOW_HHMM (3:47 PM) so the demo always looks "live".

const NOW_HHMM = "15:47"; // 3:47 PM, mid-afternoon Tuesday
const NOW_DISPLAY = "3:47 PM";

// Convert "HH:MM" to minutes-since-midnight
function _toMin(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
// Convert "HH:MM" to "h:mm a"
function fmtTime(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const am = h < 12;
  const hh = ((h % 12) || 12);
  return `${hh}:${String(m).padStart(2, "0")} ${am ? "AM" : "PM"}`;
}
function fmtTimeShort(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const am = h < 12;
  const hh = ((h % 12) || 12);
  return `${hh}:${String(m).padStart(2, "0")}${am ? "a" : "p"}`;
}
// Minutes elapsed since a given sign-in time relative to NOW
function minutesSince(hhmm) {
  return Math.max(0, _toMin(NOW_HHMM) - _toMin(hhmm));
}
// Format a duration in minutes as "12m" / "1h 04m"
function fmtDur(min) {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60), m = min % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

// ─── Sign-in book — a Tuesday's worth of walk-ins ─────────────
// Some have phone numbers (signed via kiosk / front-desk capture), older
// done ones may not (paper sign-in). techPref of null means "any tech".
const WAITLIST = [
  // ───── Done & crossed off (earlier in the day) ─────
  { id: "w-001", name: "Hannah K.",          phone: "415 555 0148", party: 1, services: ["classic-mani"],                                    techPref: null,     signedAt: "09:05", calledAt: "09:08", seatedAt: "09:10", doneAt: "09:42", status: "done",     tech: "maya" },
  { id: "w-002", name: "Walk-in",            phone: null,            party: 1, services: ["classic-pedi"],                                    techPref: null,     signedAt: "09:31", calledAt: "09:33", seatedAt: "09:35", doneAt: "10:24", status: "done",     tech: "linh" },
  { id: "w-003", name: "Dana R.",            phone: "415 555 0922", party: 1, services: ["manicure-gel"],                                    techPref: "aria",   signedAt: "09:51", calledAt: "10:00", seatedAt: "10:02", doneAt: "10:48", status: "done",     tech: "aria" },
  { id: "w-004", name: "Walk-in (2)",        phone: null,            party: 2, services: ["classic-mani", "classic-pedi"],                    techPref: null,     signedAt: "10:18", calledAt: "10:22", seatedAt: "10:24", doneAt: "11:30", status: "done",     tech: "jules" },
  { id: "w-005", name: "Sara K.",            phone: "415 555 0612", party: 1, services: ["gel-polish-change-natural"],                       techPref: "noor",   signedAt: "10:38", calledAt: "10:52", seatedAt: "10:55", doneAt: "11:34", status: "done",     tech: "noor" },
  { id: "w-006", name: "Maya G.",            phone: "415 555 0274", party: 1, services: ["deluxe-pedi"],                                     techPref: null,     signedAt: "11:02", calledAt: "11:18", seatedAt: "11:20", doneAt: "12:18", status: "done",     tech: "priya" },
  { id: "w-007", name: "Carla F.",           phone: "415 555 0331", party: 1, services: ["removal-gel", "manicure-gel"],                     techPref: null,     signedAt: "11:30", calledAt: "11:45", seatedAt: "11:48", doneAt: "12:42", status: "no-show", tech: null },
  { id: "w-008", name: "Bri R.",             phone: "415 555 0809", party: 1, services: ["acrylic-fullset-gel"],                             techPref: "maya",   signedAt: "11:58", calledAt: "12:12", seatedAt: "12:15", doneAt: "14:08", status: "done",     tech: "maya" },
  { id: "w-009", name: "Elena V.",           phone: "415 555 0145", party: 1, services: ["classic-pedi", "classic-mani"],                    techPref: null,     signedAt: "12:18", calledAt: "12:36", seatedAt: "12:40", doneAt: "13:48", status: "done",     tech: "aria" },
  { id: "w-010", name: "Walk-in",            phone: null,            party: 1, services: ["acrylic-fills-gel"],                              techPref: null,     signedAt: "12:42", calledAt: "13:00", seatedAt: "13:05", doneAt: "14:12", status: "done",     tech: "jules" },
  { id: "w-011", name: "Hannah B.",          phone: "415 555 0510", party: 1, services: ["dipping-powder", "addon-custom-art-all10"],        techPref: null,     signedAt: "13:08", calledAt: "13:28", seatedAt: "13:32", doneAt: "14:50", status: "done",     tech: "sasha" },
  { id: "w-012", name: "Walk-in",            phone: null,            party: 1, services: ["classic-mani"],                                    techPref: null,     signedAt: "13:42", calledAt: "13:58", seatedAt: "14:01", doneAt: "14:38", status: "done",     tech: "noor" },

  // ───── Currently in service (chairs occupied) ─────
  { id: "w-013", name: "Joy L.",             phone: "415 555 0388", party: 1, services: ["hemp-steam-pedi", "manicure-regular-polish"],     techPref: "priya",  signedAt: "13:42", calledAt: "14:22", seatedAt: "14:28", doneAt: null,      status: "serving",  tech: "priya" },
  { id: "w-014", name: "Walk-in",            phone: null,            party: 1, services: ["addon-french-tips", "manicure-gel"],              techPref: null,     signedAt: "14:36", calledAt: "14:50", seatedAt: "14:55", doneAt: null,      status: "serving",  tech: "maya" },
  { id: "w-015", name: "Riya P.",            phone: "415 555 0701", party: 1, services: ["addon-custom-art-all10", "manicure-gel"],         techPref: "aria",   signedAt: "14:58", calledAt: "15:18", seatedAt: "15:22", doneAt: null,      status: "serving",  tech: "aria" },

  // ───── Called (we've waved them over, on the way to chair) ─────
  { id: "w-016", name: "Tasha W.",           phone: "415 555 0094", party: 1, services: ["classic-pedi"],                                    techPref: null,     signedAt: "15:08", calledAt: "15:42", seatedAt: null,    doneAt: null,      status: "called",   tech: null,
    note: "Prefers warm water" },

  // ───── Waiting (current queue) ─────
  { id: "w-017", name: "Marcus G.",          phone: "415 555 0226", party: 1, services: ["mens-mani"],                                       techPref: null,     signedAt: "15:22", calledAt: null,    seatedAt: null,    doneAt: null,      status: "waiting",  tech: null },
  { id: "w-018", name: "Emily & Sarah",      phone: "415 555 0440", party: 2, services: ["classic-mani"],                                    techPref: null,     signedAt: "15:30", calledAt: null,    seatedAt: null,    doneAt: null,      status: "waiting",  tech: null,
    note: "Sisters — want to sit together" },
  { id: "w-019", name: "Anna B.",            phone: "415 555 0867", party: 1, services: ["manicure-gel", "addon-designs"],                   techPref: "linh",   signedAt: "15:38", calledAt: null,    seatedAt: null,    doneAt: null,      status: "waiting",  tech: null },
  { id: "w-020", name: "Olivia M.",          phone: "415 555 0518", party: 1, services: ["express-pedi"],                                    techPref: null,     signedAt: "15:43", calledAt: null,    seatedAt: null,    doneAt: null,      status: "waiting",  tech: null },
];

// ─── Helpers (services by id) ────────────────────────────────
function getService(id) { return SERVICES.find(s => s.id === id); }
function svcName(id) { const s = getService(id); return s ? s.name : id; }
function svcPriceLabel(id) {
  const s = getService(id);
  if (!s) return "";
  if (s.variable) return s.priceFrom ? `from $${s.priceFrom}` : `~$${s.price}`;
  if (s.price === 0) return "Free";
  return `$${s.price}`;
}
function svcMinutes(id) { const s = getService(id); return s ? s.time : 30; }
function entryEstMinutes(entry) {
  // Sum the service times; if multiple services, the longest dominates only
  // when techs overlap — for ETA we just sum which is conservative.
  return entry.services.reduce((s, id) => s + svcMinutes(id), 0);
}

// Average wait estimate for a newly-arrived walk-in:
// (#waiting + 1) × avg-handle / techs-on-shift … but simpler & honest:
// take the longest waiter + median service time, cap at 60m.
function estimatedWait(waitlist) {
  const waiting = waitlist.filter(w => w.status === "waiting");
  if (waiting.length === 0) return 5;
  // Rough heuristic: 8 minutes per person ahead in line (a chair clears every ~8m on a busy day).
  const est = Math.min(60, Math.max(5, waiting.length * 9));
  return est;
}

// Initials helper
function _initials2(name) {
  const parts = name.replace(/[()&,]/g, " ").split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "·";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// Group sign-ins by lane in chronological order.
function byLane(waitlist) {
  const lanes = { waiting: [], called: [], serving: [], done: [], "no-show": [] };
  for (const w of waitlist) lanes[w.status]?.push(w);
  // Waiting + called: oldest first (FIFO is fair)
  lanes.waiting.sort((a, b) => a.signedAt.localeCompare(b.signedAt));
  lanes.called.sort((a, b) => (a.calledAt || "").localeCompare(b.calledAt || ""));
  lanes.serving.sort((a, b) => (a.seatedAt || "").localeCompare(b.seatedAt || ""));
  // Done/no-show: newest first
  lanes.done.sort((a, b) => (b.doneAt || "").localeCompare(a.doneAt || ""));
  lanes["no-show"].sort((a, b) => (b.doneAt || "").localeCompare(a.doneAt || ""));
  return lanes;
}

window.WAITLIST = WAITLIST;
window.NOW_HHMM = NOW_HHMM;
window.NOW_DISPLAY = NOW_DISPLAY;
window.fmtTime = fmtTime;
window.fmtTimeShort = fmtTimeShort;
window.minutesSince = minutesSince;
window.fmtDur = fmtDur;
window.svcName = svcName;
window.svcPriceLabel = svcPriceLabel;
window.svcMinutes = svcMinutes;
window.entryEstMinutes = entryEstMinutes;
window.estimatedWait = estimatedWait;
window._initials2 = _initials2;
window.byLane = byLane;
