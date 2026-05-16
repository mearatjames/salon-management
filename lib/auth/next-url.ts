// Sanitize the `?next=<...>` query parameter that propagates from middleware
// through `/login` → `/auth/callback` → `/select-staff` → studio.
//
// Conditions (research R6): a value is accepted iff it is
//   1. a non-empty string,
//   2. begins with a single `/` (not `//`, not a protocol),
//   3. starts with one of the seven `STUDIO_PREFIXES`,
//   4. is NOT `/login` (we never bounce back to login).
//
// Anything else returns `/dashboard` — the canonical fallback landing route.

export const STUDIO_PREFIXES = [
  "/dashboard",
  "/calendar",
  "/checkout",
  "/clients",
  "/services",
  "/walkin",
  "/end-of-day",
  "/settings",
] as const;

export function sanitizeNext(raw: string | null | undefined): string {
  if (typeof raw !== "string") return "/dashboard";
  if (raw.length === 0) return "/dashboard";

  // Reject anything that doesn't start with a single slash (rejects `//foo`,
  // protocol-relative URLs, absolute URLs, and `javascript:` URIs).
  if (!raw.startsWith("/")) return "/dashboard";
  if (raw.startsWith("//")) return "/dashboard";

  // Reject `/login` (and anything beneath it) — we never bounce back.
  if (raw === "/login" || raw.startsWith("/login/")) return "/dashboard";

  // Must start with one of the studio prefixes — exact match OR followed by
  // `/` so `/dashboard/x` is accepted but `/dashboard-evil` is not.
  for (const prefix of STUDIO_PREFIXES) {
    if (raw === prefix || raw.startsWith(prefix + "/")) {
      return raw;
    }
  }

  return "/dashboard";
}
