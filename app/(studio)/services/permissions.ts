// Permission matrix for the services-catalog mutations. The trust boundary —
// every Server Action calls `assertCanWriteCatalog` before any DB write,
// and the drawer client island uses `canWriteCatalog` to render the
// read-only path for technicians / front-desk. Pure functions, no I/O.
//
// Unlike the staff feature there is no per-target check (no analogue to
// the manager × owner asymmetry, no last-owner gate). The single rule is:
// only owner OR manager may write the catalog.
//
// `PermissionError.code = "forbidden"` is the canonical string that the
// Server Action prelude maps to `?error=forbidden` redirect param
// (matches the toast key in `contracts/ui.contract.md § 4`).

import type { StudioRole } from "@/lib/auth/session";

export type { StudioRole };

export type CatalogPermissionErrorCode = "forbidden";

export class PermissionError extends Error {
  readonly code: CatalogPermissionErrorCode;
  constructor(code: CatalogPermissionErrorCode = "forbidden", message?: string) {
    super(message ?? `permission: ${code}`);
    this.name = "PermissionError";
    this.code = code;
  }
}

const CATALOG_WRITERS: ReadonlySet<StudioRole> = new Set(["owner", "manager"]);

/** True iff the operator may add/edit/archive/restore catalog rows. */
export function canWriteCatalog(role: StudioRole): boolean {
  return CATALOG_WRITERS.has(role);
}

/** Throws `PermissionError("forbidden")` for technicians / front-desk. */
export function assertCanWriteCatalog(role: StudioRole): void {
  if (!canWriteCatalog(role)) {
    throw new PermissionError("forbidden");
  }
}
