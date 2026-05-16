// `/select-staff` — operator selection + PIN entry.
//
// Server component. Layered behind a valid Supabase device session (middleware
// excludes this path, so we verify here): if no device user, bounce to
// `/login`. The roster is read straight from `staff` (RLS allows authenticated
// reads of `active` staff). When `?selectedTileId=<id>` matches a row, the
// page renders the PIN keypad below the roster.
//
// FR-019 echo: the alert text "PIN didn't match. Try again." is intentionally
// identical for "wrong pin" and "tile inactive" — see actions.ts.

import { redirect } from "next/navigation";

import { signOut } from "@/app/(studio)/actions";
import { PinKeypad } from "@/components/lacquer/pin-keypad";
import { StaffRoster } from "@/components/lacquer/staff-roster";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { createSupabaseServerClient } from "@/lib/db/server";

type SelectStaffSearchParams = {
  next?: string | string[];
  error?: string | string[];
  selectedTileId?: string | string[];
};

function pickString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function nextSuffix(next: string | undefined): string {
  return next ? encodeURIComponent(next) : "";
}

type StaffRow = {
  id: string;
  display_name: string;
  role: string;
  color_token: string;
  pin_reset_admin_at: string | null;
};

export default async function SelectStaffPage({
  searchParams,
}: {
  searchParams: Promise<SelectStaffSearchParams>;
}) {
  const params = await searchParams;
  const next = pickString(params.next);
  const error = pickString(params.error);
  const selectedTileId = pickString(params.selectedTileId);

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

  const roster = (rosterData ?? []) as StaffRow[];

  if (roster.length === 0) {
    return (
      <>
        <h1 className="auth-headline">No staff configured</h1>
        <p style={{ color: "var(--muted-foreground)", margin: 0 }}>
          Ask the salon owner to add staff in Settings.
        </p>
        <form action={signOut} className="auth-form-actions">
          <Button type="submit" variant="outline">
            Sign out
          </Button>
        </form>
      </>
    );
  }

  const selectedRow = selectedTileId ? roster.find((r) => r.id === selectedTileId) : undefined;

  return (
    <>
      <h1 className="auth-headline">Who&apos;s using this device?</h1>

      {error === "pin_failed" && (
        <Alert variant="destructive">PIN didn&apos;t match. Try again.</Alert>
      )}

      <StaffRoster staff={roster} selectedId={selectedRow?.id} next={next} />

      {selectedRow && <PinKeypad staffId={selectedRow.id} next={next ?? ""} />}
    </>
  );
}
