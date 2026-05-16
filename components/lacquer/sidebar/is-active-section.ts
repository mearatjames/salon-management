/**
 * Returns true when `pathname` is exactly `href` or a route nested under `href`.
 *
 * Contract: `specs/007-left-panel-nav/contracts/nav-items.contract.md` § 3.
 *
 * - Disabled items (`href === null`) are never active.
 * - Empty `pathname` is never active.
 * - Trailing slash on `pathname` is normalized (except the root `"/"`).
 * - Prefix collisions are avoided: `/calendar-archive` does NOT match `/calendar`.
 */
export function isActiveSection(pathname: string, href: string | null): boolean {
  if (!href || !pathname) return false;
  const p = pathname.endsWith("/") && pathname !== "/" ? pathname.slice(0, -1) : pathname;
  return p === href || p.startsWith(href + "/");
}
