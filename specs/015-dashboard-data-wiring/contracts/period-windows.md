# Contract: Timezone & period-window helpers

**Feature**: 015-dashboard-data-wiring
**Module**: `lib/time/period-windows.ts` (new), `lib/time/format.ts` (new)
**Mandate**: Constitution v1.0.3 § Security & Data Integrity Constraints — *"All timestamps are stored UTC and formatted through the single `lib/time/*` helper against `SALON_TZ`. No ad-hoc timezone math."*

This file pins the contract for the timezone helper. The helper is the **only** module in the codebase allowed to do timezone-aware arithmetic; every other call site that needs salon-local dates or display formats must go through it.

---

## Design constraints

- **Pure functions only.** No Supabase, no React, no Node-only APIs (the helper must work in both Server Component contexts and unit-test contexts).
- **No external dependencies.** Built on `Intl.DateTimeFormat` only (research §1).
- **Inputs are always typed.** `Date` for instants; `string` for IANA TZ identifiers (e.g. `"America/Los_Angeles"`). Never accept untyped or string-dates.
- **Outputs are always UTC `Date`s** for window bounds. Display formats return `string`.
- **DST-safe.** Spring-forward and fall-back transitions in the target TZ must produce correct boundaries (verified by unit tests pinned to 2026-03-08 and 2026-11-01).

---

## API surface

### `salonNow(tz)`

```ts
function salonNow(tz: string): Date
```

**Returns**: the current wall-clock instant as a `Date` (UTC millis are global; the `tz` parameter is informational so callers reading the JSDoc remember to feed the right zone to window helpers downstream). Tested as a thin wrapper around `new Date()` so the orchestrator can inject a fixed `now` in unit tests by calling `todayWindow(tz, fixedNow)` directly.

---

### `todayWindow(tz, now)`

```ts
function todayWindow(tz: string, now: Date): readonly [Date, Date]
```

**Returns**: the `[startUtc, endUtc]` pair where:

- `startUtc` is the UTC instant that corresponds to midnight (00:00:00.000) *in the salon's local timezone on the local day containing `now`*.
- `endUtc` equals `now`.

**Example** — `tz = "America/Los_Angeles"`, `now = 2026-05-16T22:14:00.000Z`:
- Local datetime in LA at that instant: `2026-05-16 15:14:00 PDT (-07:00)`.
- Local midnight on 2026-05-16 in LA: `2026-05-16 00:00:00 PDT (-07:00)` → `startUtc = 2026-05-16T07:00:00.000Z`.
- `endUtc = 2026-05-16T22:14:00.000Z`.

**DST edge** — `tz = "America/Los_Angeles"`, `now = 2026-03-08T15:00:00.000Z` (the morning of spring-forward):
- Local datetime in LA at that instant: `2026-03-08 08:00:00 PDT (-07:00)`.
- Local midnight on 2026-03-08 in LA: `2026-03-08 00:00:00 PST (-08:00)` → `startUtc = 2026-03-08T08:00:00.000Z`. (Spring-forward happens at 02:00 local; midnight is still PST.)
- The window length is 7 hours (not 8) because of the lost hour — this is correct.

---

### `weekWindow(tz, now)`

```ts
function weekWindow(tz: string, now: Date): readonly [Date, Date]
```

**Returns**: the `[startUtc, endUtc]` pair where:

- `startUtc` is the UTC instant for **the most recent local Monday at 00:00:00.000** in the salon's timezone. "Most recent" means: if today *is* Monday in the salon's TZ, the start is today's local midnight (not last Monday's).
- `endUtc` equals `now`.

The week start day is **Monday** per FR-007.

**Example** — `tz = "America/Los_Angeles"`, `now = 2026-05-16T22:14:00.000Z` (Saturday in LA):
- Local day at `now`: Saturday 2026-05-16.
- Most recent local Monday: 2026-05-11.
- `startUtc = 2026-05-11T07:00:00.000Z` (LA midnight on 2026-05-11, PDT).
- `endUtc = 2026-05-16T22:14:00.000Z`.

**Sunday rollover** — `tz = "America/Los_Angeles"`, `now = 2026-05-17T06:59:00.000Z` (= Sunday 23:59 PDT):
- Most recent local Monday: 2026-05-11.
- `startUtc = 2026-05-11T07:00:00.000Z`.

`tz = "America/Los_Angeles"`, `now = 2026-05-18T07:01:00.000Z` (= Monday 00:01 PDT):
- Most recent local Monday: 2026-05-18 (today is Monday).
- `startUtc = 2026-05-18T07:00:00.000Z`.

---

### `monthWindow(tz, now)`

```ts
function monthWindow(tz: string, now: Date): readonly [Date, Date]
```

**Returns**: the `[startUtc, endUtc]` pair where:

- `startUtc` is the UTC instant for **the 1st of the current local month at 00:00:00.000** in the salon's timezone.
- `endUtc` equals `now`.

**Example** — `tz = "America/Los_Angeles"`, `now = 2026-05-16T22:14:00.000Z`:
- Local month: 2026-05.
- `startUtc = 2026-05-01T07:00:00.000Z` (LA midnight on 2026-05-01, PDT).

**Month boundary** — `tz = "America/Los_Angeles"`, `now = 2026-03-01T07:59:00.000Z` (= Feb 28 23:59 PST):
- Local month at `now`: 2026-02 (still February in LA).
- `startUtc = 2026-02-01T08:00:00.000Z` (LA midnight on 2026-02-01, PST).

`tz = "America/Los_Angeles"`, `now = 2026-03-01T08:01:00.000Z` (= March 1 00:01 PST):
- Local month at `now`: 2026-03.
- `startUtc = 2026-03-01T08:00:00.000Z`.

---

### `formatSubtitle(d, tz)` *(from `lib/time/format.ts`)*

```ts
function formatSubtitle(d: Date, tz: string): string
```

**Returns**: the day-of-week + date string for the dashboard's header subtitle, formatted in the salon's local timezone, locale `en-US`.

**Examples**:
- `formatSubtitle(new Date("2026-05-16T22:14:00.000Z"), "America/Los_Angeles")` → `"Saturday, May 16"`
- `formatSubtitle(new Date("2026-05-16T22:14:00.000Z"), "Asia/Tokyo")` → `"Sunday, May 17"` (proves the TZ argument is honored — May 16 22:14 UTC = May 17 07:14 JST)

---

### `formatTime(d, tz)` *(from `lib/time/format.ts`)*

```ts
function formatTime(d: Date, tz: string): string
```

**Returns**: the time-of-day string for the dashboard's header subtitle and the recent-transactions feed's row times, formatted in the salon's local timezone with 12-hour AM/PM, locale `en-US`.

**Examples**:
- `formatTime(new Date("2026-05-16T22:14:00.000Z"), "America/Los_Angeles")` → `"3:14 PM"`
- `formatTime(new Date("2026-05-16T00:00:00.000Z"), "America/Los_Angeles")` → `"5:00 PM"` (the previous day)

---

## Implementation note (informational, not the contract)

The plan implements `todayWindow` / `weekWindow` / `monthWindow` using `Intl.DateTimeFormat(tz, { year, month, day, hour, minute, second, hour12: false }).formatToParts(d)` to read the *local* parts at `now`, then constructs a candidate UTC instant for the boundary, then re-asks `Intl` for the offset *at that candidate boundary* (the "two-step technique"). This handles DST without ambiguity. The unit tests pin the behavior against fixed dates so any future refactor preserves the contract.

---

## What the helper does NOT do

- It does not parse or format strings other than the two display formats above (`formatSubtitle`, `formatTime`).
- It does not know about the dashboard, Supabase, or any other app surface.
- It does not depend on `process.env.TZ` or the Node process timezone — every function takes its TZ explicitly.
- It does not provide arbitrary-arithmetic helpers (`addDays`, `startOf`, etc.) — only the four contracts this feature needs. Future features can extend the module, but each new helper must come with the same DST + locale tests.
