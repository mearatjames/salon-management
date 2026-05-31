// Builds the user_metadata payload handed to Supabase's
// `inviteUserByEmail` for staff invites.
//
// The hosted invite email template (configured on the preview + prod
// Supabase projects, not version-controlled) personalises itself from this
// metadata via GoTrue's `{{ .Data.<key> }}` interpolation. It reads four
// fields — `salon_name`, `role`, `invited_by_name`, `expires_human` — so all
// four MUST appear here or the template renders blanks (issue #159: the
// "Salon" and "Invited by" rows were empty because the action only sent
// `role` + a raw `invited_by` UUID the template never reads).
//
// Server-only: pulls in the service-role Supabase client to read salon
// settings. Keep callers on the server (Server Actions).

import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import { getSalonTimezone, getSetting } from "@/lib/db/settings";
import { formatExpiry } from "@/lib/time/format";
import type { StudioRole } from "@/lib/auth/session";

/**
 * Invite link validity, in days. The email body copy ("This invitation
 * expires in 7 days") and the preview-text `expires_human` date are derived
 * from this single constant so they can't drift apart.
 */
export const INVITE_TTL_DAYS = 7;

/** Shown when `salon.name` is unset — matches the brand wordmark. */
const SALON_NAME_FALLBACK = "Tang Nails";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type InviteEmailMetadata = {
  display_name: string;
  role: StudioRole;
  /** The inviter's `staff.id`. Persisted in user_metadata; not rendered. */
  invited_by: string;
  /** Inviter's display name — `{{ .Data.invited_by_name }}`. */
  invited_by_name: string;
  /** Salon name — `{{ .Data.salon_name }}`. */
  salon_name: string;
  /** Human expiry date for the inbox preview — `{{ .Data.expires_human }}`. */
  expires_human: string;
};

/**
 * Resolve the full invite-email metadata. Reads `salon.name` (falling back
 * to the brand wordmark when unset/blank) and the salon timezone so the
 * expiry date renders in the operator's locale. `now` is injectable for
 * deterministic tests.
 */
export async function buildInviteMetadata(args: {
  displayName: string;
  role: StudioRole;
  inviterId: string;
  inviterName: string;
  now?: Date;
}): Promise<InviteEmailMetadata> {
  const now = args.now ?? new Date();
  const supabase = createSupabaseServiceRoleClient();

  const salonNameRaw = await getSetting<unknown>(supabase, "salon.name");
  const salon_name =
    typeof salonNameRaw === "string" && salonNameRaw.trim()
      ? salonNameRaw.trim()
      : SALON_NAME_FALLBACK;

  const tz = await getSalonTimezone(supabase);
  const expires = new Date(now.getTime() + INVITE_TTL_DAYS * MS_PER_DAY);

  return {
    display_name: args.displayName,
    role: args.role,
    invited_by: args.inviterId,
    invited_by_name: args.inviterName,
    salon_name,
    expires_human: formatExpiry(expires, tz),
  };
}
