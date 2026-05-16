// Settings → Onboarding page. Server Component.
//
// Owner-only (per routes.contract.md). Renders the hero (count totals +
// disabled Onboard CTA — wiring lands in US1), an owners-only notice,
// and three Section blocks (Pending / Active / Offboarded) populated
// from the staff table via the service-role client.
//
// Service-role is required because the page reads the new lifecycle
// columns (`state`, `email`, `invite_method`, etc.) and the
// straightforward RLS policy on `staff` masks rows that aren't `active`.
// All admin operations on this page run server-side; nothing
// service-role crosses the boundary.
//
// The OnboardingToaster client island consumes `?toast=` / `?error=` /
// `?name=` after a Server Action redirects back here.

import { Suspense } from "react";
import { Info, Mail, UserCheck, UserMinus } from "lucide-react";
import { redirect } from "next/navigation";

import { binAndSortRoster } from "@/app/(studio)/settings/onboarding/_sort";
import type { OnboardingUser } from "@/app/(studio)/settings/onboarding/_types";
import { OnboardCtaSheet } from "@/components/lacquer/onboarding/onboard-cta-sheet.client";
import { OnboardingSearch } from "@/components/lacquer/onboarding/onboarding-search.client";
import { Section } from "@/components/lacquer/onboarding/section";
import { UserRow } from "@/components/lacquer/onboarding/user-row";
import { UserRowMenu } from "@/components/lacquer/onboarding/user-row-menu.client";
import { OnboardingToaster } from "@/components/lacquer/onboarding/onboarding-toaster.client";
import { requireStudioSession } from "@/lib/auth/session";
import { createSupabaseServiceRoleClient } from "@/lib/db/admin";

export const dynamic = "force-dynamic";

// Mirrors `pickString` in app/(auth)/reset-password/page.tsx — narrow a
// `searchParams` entry that may be a string, an array of strings, or absent.
function pickString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

type OnboardingSearchParams = {
  q?: string | string[];
};

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return "—";
  const deltaMs = Date.now() - ts;
  if (deltaMs < 60_000) return "Just now";
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

export default async function OnboardingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<OnboardingSearchParams>;
}) {
  const viewer = await requireStudioSession();

  // Owner-only per contracts/routes.contract.md. Send non-owners to the
  // Staff page (the closest sibling tab they can read).
  if (viewer.staff.role !== "owner") {
    redirect("/settings/staff");
  }

  const params = await searchParams;
  const q = (pickString(params.q) ?? "").trim();

  const supabase = createSupabaseServiceRoleClient();

  // Roster fetch (filtered when q is present).
  // ILIKE on display_name OR email — PostgREST .or() takes a comma-joined
  // expression. Escape `%` and `_` in `q` so user-typed wildcards are
  // treated as literal characters.
  let rosterQuery = supabase
    .from("staff")
    .select(
      "id, user_id, display_name, email, role, color_token, state, pin_hash, invited_at, invited_by, invite_method, offboarded_at, offboarded_by, offboard_reason, last_sign_in_at, pin_reset_admin_at"
    )
    .is("removed_at", null);
  if (q.length > 0) {
    const escaped = q.replace(/[%_]/g, "\\$&");
    rosterQuery = rosterQuery.or(`display_name.ilike.%${escaped}%,email.ilike.%${escaped}%`);
  }
  const { data, error } = await rosterQuery;

  if (error) {
    throw new Error(`Failed to load onboarding roster: ${error.message}`);
  }

  // Hero stats — always the UNFILTERED salon-wide totals
  // (ui-views.contract.md § Hero stats). One small `select state` query
  // regardless of q to keep the read path simple.
  const { data: stateRows, error: stateErr } = await supabase
    .from("staff")
    .select("state")
    .is("removed_at", null);
  if (stateErr) {
    throw new Error(`Failed to load onboarding stats: ${stateErr.message}`);
  }
  const heroStats = {
    pending: (stateRows ?? []).filter((r) => (r as { state?: string }).state === "invited").length,
    active: (stateRows ?? []).filter((r) => (r as { state?: string }).state === "active").length,
    offboarded: (stateRows ?? []).filter((r) => (r as { state?: string }).state === "offboarded")
      .length,
  };

  const rows: OnboardingUser[] = (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id),
      user_id: (r.user_id as string | null) ?? null,
      display_name: String(r.display_name),
      email: (r.email as string | null) ?? null,
      role: r.role as OnboardingUser["role"],
      color_token: String(r.color_token),
      state: (r.state as OnboardingUser["state"]) ?? "active",
      invite_method: (r.invite_method as OnboardingUser["invite_method"]) ?? null,
      invited_at: (r.invited_at as string | null) ?? null,
      offboarded_at: (r.offboarded_at as string | null) ?? null,
      offboard_reason: (r.offboard_reason as string | null) ?? null,
      last_sign_in_at: (r.last_sign_in_at as string | null) ?? null,
      pin_set: r.pin_hash != null,
      // Stamped by binAndSortRoster against viewer.deviceUserId.
      is_you: false,
    };
  });

  const buckets = binAndSortRoster(rows, viewer.deviceUserId);

  // Compute active-owner count for the last-owner guard. Mirrors the
  // staff-page approach: count active, non-removed owners; the target itself
  // is the last owner when no OTHER owners exist.
  const activeOwnerCount = buckets.active.filter((u) => u.role === "owner").length;
  function isLastOwner(u: OnboardingUser): boolean {
    return u.role === "owner" && activeOwnerCount <= 1;
  }

  return (
    <div className="onb-page">
      <header className="onb-hero">
        <div>
          <h1 className="onb-hero-title">Onboarding</h1>
          <p className="onb-hero-sub">
            Invite new staff, manage pending invites, and offboard people who&apos;ve left.
          </p>
          <div className="onb-hero-stats" aria-label="Roster counts">
            <div className="onb-hero-stat">
              <div className="onb-hero-stat-num">{heroStats.pending}</div>
              <div className="onb-hero-stat-label">Pending</div>
            </div>
            <div className="onb-hero-stat">
              <div className="onb-hero-stat-num">{heroStats.active}</div>
              <div className="onb-hero-stat-label">Active</div>
            </div>
            <div className="onb-hero-stat">
              <div className="onb-hero-stat-num">{heroStats.offboarded}</div>
              <div className="onb-hero-stat-label">Offboarded</div>
            </div>
          </div>
        </div>
        <div className="onb-hero-cta">
          <OnboardingSearch initial={q} />
          <OnboardCtaSheet />
        </div>
      </header>

      <aside className="onb-notice" role="note">
        <Info size={16} strokeWidth={1.5} aria-hidden />
        <span>
          Only owners can invite, offboard, or remove users. Managers can edit existing staff on the
          Staff tab.
        </span>
      </aside>

      {(q.length === 0 || buckets.pending.length > 0) && (
        <Section
          icon={Mail}
          title="Pending invites"
          count={buckets.pending.length}
          sub="People who haven't accepted yet. Magic links and password-setup links expire after 7 days."
          emptyCopy="No pending invites."
        >
          {buckets.pending.map((u) => (
            <UserRow
              key={u.id}
              user={u}
              meta={`Invited ${formatRelative(u.invited_at)}`}
              menu={
                <UserRowMenu
                  kind="pending"
                  target={{
                    id: u.id,
                    display_name: u.display_name,
                    email: u.email,
                    role: u.role,
                    color_token: u.color_token,
                    is_you: u.is_you,
                  }}
                  isLastOwner={false}
                />
              }
            />
          ))}
        </Section>
      )}

      {(q.length === 0 || buckets.active.length > 0) && (
        <Section
          icon={UserCheck}
          title="Active users"
          count={buckets.active.length}
          sub="Owners, managers, technicians, and front desk staff with current access."
          emptyCopy="No active users."
        >
          {buckets.active.map((u) => (
            <UserRow
              key={u.id}
              user={u}
              meta={
                u.last_sign_in_at
                  ? `Signed in ${formatRelative(u.last_sign_in_at)}`
                  : "Never signed in"
              }
              menu={
                <UserRowMenu
                  kind="active"
                  target={{
                    id: u.id,
                    display_name: u.display_name,
                    email: u.email,
                    role: u.role,
                    color_token: u.color_token,
                    is_you: u.is_you,
                  }}
                  isLastOwner={isLastOwner(u)}
                />
              }
            />
          ))}
        </Section>
      )}

      {(q.length === 0 || buckets.offboarded.length > 0) && (
        <Section
          icon={UserMinus}
          title="Offboarded"
          count={buckets.offboarded.length}
          sub="People who've been offboarded. Reactivate to send a fresh invite, or remove permanently."
          emptyCopy="No offboarded users."
        >
          {buckets.offboarded.map((u) => (
            <UserRow
              key={u.id}
              user={u}
              meta={
                u.offboard_reason
                  ? `${formatRelative(u.offboarded_at)} · ${u.offboard_reason}`
                  : formatRelative(u.offboarded_at)
              }
              menu={
                <UserRowMenu
                  kind="offboarded"
                  target={{
                    id: u.id,
                    display_name: u.display_name,
                    email: u.email,
                    role: u.role,
                    color_token: u.color_token,
                    is_you: u.is_you,
                  }}
                  isLastOwner={false}
                />
              }
            />
          ))}
        </Section>
      )}

      <Suspense fallback={null}>
        <OnboardingToaster />
      </Suspense>
    </div>
  );
}
