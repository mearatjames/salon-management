// `/select-staff` — operator selection + PIN entry (the `(device)` route
// group, full-bleed via `app/(device)/layout.tsx`).
//
// Server component. Layered behind a valid Supabase device session
// (middleware excludes this path, so we verify here): if no device user,
// bounce to `/login`. The roster is read straight from `staff` (RLS allows
// authenticated reads of `active` staff) and handed to `<SelectStaffScreen>`,
// the client component that owns the avatar grid + transient keypad-modal
// state.
//
// 044-select-staff-redesign: the page reads ONLY `?next=` — the old
// `?error=pin_failed` and `?selectedTileId=` params are gone (PIN failure is
// now an inline `{ ok: false }` result the modal handles; tile selection is
// transient client state).

import { redirect } from "next/navigation";

import { signOut } from "@/app/(studio)/actions";
import {
  SelectStaffScreen,
  type StaffRosterEntry,
} from "@/components/lacquer/select-staff/select-staff-screen.client";
import { Button } from "@/components/ui/button";
import { createSupabaseServerClient } from "@/lib/db/server";

type SelectStaffSearchParams = {
  next?: string | string[];
};

function pickString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function nextSuffix(next: string | undefined): string {
  return next ? encodeURIComponent(next) : "";
}

export default async function SelectStaffPage({
  searchParams,
}: {
  searchParams: Promise<SelectStaffSearchParams>;
}) {
  const params = await searchParams;
  const next = pickString(params.next);

  // Resolve the device user — the operator cookie is what we're about to
  // issue, so it MUST NOT be required here. Middleware also excludes
  // `/select-staff` from the cookie check (it's the page that creates the
  // cookie).
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) {
    redirect(`/login?next=${nextSuffix(next)}`);
  }

  const { data: rosterData } = await supabase
    .from("staff")
    .select("id, display_name, role, color_token, pin_reset_admin_at")
    .eq("active", true)
    .not("pin_hash", "is", null)
    .order("role")
    .order("display_name");

  const roster = (rosterData ?? []) as StaffRosterEntry[];

  if (roster.length === 0) {
    return (
      <div className="select-staff-screen">
        <div className="select-staff-body">
          <div className="select-staff-screen-header">
            <h1 className="select-staff-title">No staff configured</h1>
            <p className="select-staff-subtitle">Ask the salon owner to add staff in Settings.</p>
          </div>
          <form action={signOut}>
            <Button type="submit" variant="outline">
              Sign out
            </Button>
          </form>
        </div>
      </div>
    );
  }

  return <SelectStaffScreen roster={roster} next={next ?? ""} />;
}
