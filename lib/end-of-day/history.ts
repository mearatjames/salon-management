// Server-only query layer for the Past Cash Counts feature (020).
//
// Two read surfaces:
//   - `loadCashHistoryList`: paginated list of closed cash drawer
//     sessions for the `/end-of-day/history` index page.
//   - `loadCashHistoryDetail`: a single session plus its
//     `cash_drawer.edited` audit trail for the detail page.
//
// IMPORTANT — two clients, by design:
//   - `supabase`: server-cookie client. Used for `cash_drawer_sessions`
//     (SELECT-to-authenticated policy from 0014) and `staff` (likewise).
//   - `admin`: service-role client. Used for `audit_log` because the
//     table intentionally has NO SELECT-to-authenticated policy
//     (forensic data is server-side only). Passing both in as
//     parameters keeps the function testable (the tests can mock both)
//     and keeps RLS bypass scoped to the audit reads only.
//
// The "Edited" flag in the list view is DERIVED from `audit_log`
// (FR-009) — there's no denormalized boolean on `cash_drawer_sessions`.
// `updated_at` on the row powers the "Last edited at" timestamp only.
//
// Server-only by convention — the file reads `audit_log` via the
// service-role client and is consumed only from RSC pages / server
// actions. (We do not import the `server-only` marker package because
// this repo does not depend on it; see `lib/dashboard/queries.ts` for
// the same comment-only convention.)

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/types";

type DbClient = SupabaseClient<Database>;

// ── Shared types ────────────────────────────────────────────────────

export type CashHistoryRow = {
  sessionId: string;
  businessDay: string; // YYYY-MM-DD
  openingCents: number;
  expectedCents: number;
  countedCents: number;
  varianceCents: number;
  notes: string | null;
  closedByStaffId: string | null;
  closedByName: string;
  closedAt: string; // ISO
  edited: boolean; // count(audit) > 0
  lastEditedAt: string | null; // max(audit.created_at)
};

export type AuditEntry = {
  id: string;
  createdAt: string; // ISO
  editorStaffId: string | null;
  editorDisplayName: string;
  before: { countedCents: number; varianceCents: number; notes: string | null };
  after: { countedCents: number; varianceCents: number; notes: string | null };
};

export type CashHistoryDetail = {
  session: CashHistoryRow;
  audits: AuditEntry[];
};

// ── Internal helpers ────────────────────────────────────────────────

type StaffNameRow = { id: string; display_name: string };

function staffNameMap(rows: StaffNameRow[] | null | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows ?? []) {
    map.set(row.id, row.display_name);
  }
  return map;
}

type AuditPayloadSide = {
  counted_cents?: unknown;
  variance_cents?: unknown;
  notes?: unknown;
};
type AuditPayload = { before?: AuditPayloadSide; after?: AuditPayloadSide };

function coerceInt(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
function coerceNullableString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function readPayloadSide(side: AuditPayloadSide | undefined) {
  return {
    countedCents: coerceInt(side?.counted_cents),
    varianceCents: coerceInt(side?.variance_cents),
    notes: coerceNullableString(side?.notes),
  };
}

// ── List query ──────────────────────────────────────────────────────

export async function loadCashHistoryList(
  supabase: DbClient,
  admin: DbClient,
  opts: { limit: number; offset: number }
): Promise<CashHistoryRow[]> {
  const { limit, offset } = opts;

  // 1. Closed sessions, newest first, paginated.
  const { data: sessions, error: sessionsError } = await supabase
    .from("cash_drawer_sessions")
    .select(
      "id, business_day, opening_cents, expected_cents, counted_cents, variance_cents, notes, closed_at, closed_by_staff_id"
    )
    .not("closed_at", "is", null)
    .order("business_day", { ascending: false })
    .range(offset, offset + limit - 1);

  if (sessionsError) {
    throw sessionsError;
  }
  const rows = (sessions ?? []) as Array<{
    id: string;
    business_day: string;
    opening_cents: number;
    expected_cents: number | null;
    counted_cents: number | null;
    variance_cents: number | null;
    notes: string | null;
    closed_at: string | null;
    closed_by_staff_id: string | null;
  }>;

  if (rows.length === 0) {
    return [];
  }

  const sessionIds = rows.map((r) => r.id);
  const closerIds = Array.from(
    new Set(rows.map((r) => r.closed_by_staff_id).filter((id): id is string => Boolean(id)))
  );

  // 2. Audit aggregate — service-role read (audit_log has no
  //    SELECT-to-authenticated policy). Bucket per session_id so we can
  //    project `edited` + `lastEditedAt` without a SQL aggregate.
  // `audit_log.ts` is the timestamp column (see migration 0001). The test
  // fixtures and the public `lastEditedAt` field both use the `created_at`
  // alias for readability; we project ts → createdAt here.
  const { data: audits, error: auditsError } = await admin
    .from("audit_log")
    .select("entity_id, ts")
    .eq("action", "cash_drawer.edited")
    .in("entity_id", sessionIds);

  if (auditsError) {
    throw auditsError;
  }
  const lastEditedBySession = new Map<string, string>();
  for (const row of (audits ?? []) as Array<{ entity_id: string | null; ts: string }>) {
    if (!row.entity_id) continue;
    const prev = lastEditedBySession.get(row.entity_id);
    if (!prev || row.ts > prev) {
      lastEditedBySession.set(row.entity_id, row.ts);
    }
  }

  // 3. Closer display names.
  let closerNameMap = new Map<string, string>();
  if (closerIds.length > 0) {
    const { data: staffRows, error: staffError } = await supabase
      .from("staff")
      .select("id, display_name")
      .in("id", closerIds);
    if (staffError) {
      throw staffError;
    }
    closerNameMap = staffNameMap(staffRows as StaffNameRow[] | null);
  }

  return rows.map((r) => {
    const lastEditedAt = lastEditedBySession.get(r.id) ?? null;
    return {
      sessionId: r.id,
      businessDay: r.business_day,
      openingCents: r.opening_cents,
      expectedCents: r.expected_cents ?? 0,
      countedCents: r.counted_cents ?? 0,
      varianceCents: r.variance_cents ?? 0,
      notes: r.notes,
      closedByStaffId: r.closed_by_staff_id,
      closedByName: r.closed_by_staff_id
        ? (closerNameMap.get(r.closed_by_staff_id) ?? "")
        : "",
      closedAt: r.closed_at ?? "",
      edited: lastEditedAt !== null,
      lastEditedAt,
    };
  });
}

// ── Detail query ────────────────────────────────────────────────────

export async function loadCashHistoryDetail(
  supabase: DbClient,
  admin: DbClient,
  sessionId: string
): Promise<CashHistoryDetail | null> {
  // 1. The session row.
  const { data: session, error: sessionError } = await supabase
    .from("cash_drawer_sessions")
    .select(
      "id, business_day, opening_cents, expected_cents, counted_cents, variance_cents, notes, closed_at, closed_by_staff_id"
    )
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionError) {
    throw sessionError;
  }
  if (!session) {
    return null;
  }
  const s = session as {
    id: string;
    business_day: string;
    opening_cents: number;
    expected_cents: number | null;
    counted_cents: number | null;
    variance_cents: number | null;
    notes: string | null;
    closed_at: string | null;
    closed_by_staff_id: string | null;
  };

  // 2. Audit trail for this session, newest first. Service-role read.
  //    `ts` is the column name in `audit_log`; we expose it as
  //    `createdAt` on the public AuditEntry type.
  const { data: auditRows, error: auditError } = await admin
    .from("audit_log")
    .select("id, ts, acting_as_staff_id, payload")
    .eq("action", "cash_drawer.edited")
    .eq("entity_id", sessionId)
    .order("ts", { ascending: false });

  if (auditError) {
    throw auditError;
  }
  const audits = (auditRows ?? []) as Array<{
    id: string;
    ts: string;
    acting_as_staff_id: string | null;
    payload: AuditPayload | null;
  }>;

  // 3. Resolve every editor + the closer to a display name in one read.
  const staffIds = Array.from(
    new Set(
      [
        ...audits.map((a) => a.acting_as_staff_id),
        s.closed_by_staff_id,
      ].filter((id): id is string => Boolean(id))
    )
  );
  let nameMap = new Map<string, string>();
  if (staffIds.length > 0) {
    const { data: staffRows, error: staffError } = await supabase
      .from("staff")
      .select("id, display_name")
      .in("id", staffIds);
    if (staffError) {
      throw staffError;
    }
    nameMap = staffNameMap(staffRows as StaffNameRow[] | null);
  }

  const lastEditedAt = audits.length > 0 ? audits[0]!.ts : null;

  const row: CashHistoryRow = {
    sessionId: s.id,
    businessDay: s.business_day,
    openingCents: s.opening_cents,
    expectedCents: s.expected_cents ?? 0,
    countedCents: s.counted_cents ?? 0,
    varianceCents: s.variance_cents ?? 0,
    notes: s.notes,
    closedByStaffId: s.closed_by_staff_id,
    closedByName: s.closed_by_staff_id
      ? (nameMap.get(s.closed_by_staff_id) ?? "")
      : "",
    closedAt: s.closed_at ?? "",
    edited: audits.length > 0,
    lastEditedAt,
  };

  return {
    session: row,
    audits: audits.map((a) => ({
      id: a.id,
      createdAt: a.ts,
      editorStaffId: a.acting_as_staff_id,
      editorDisplayName: a.acting_as_staff_id
        ? (nameMap.get(a.acting_as_staff_id) ?? "")
        : "",
      before: readPayloadSide(a.payload?.before),
      after: readPayloadSide(a.payload?.after),
    })),
  };
}
