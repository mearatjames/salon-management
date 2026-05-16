// PermissionCard — server-renderable summary of a role's grants + blocks.
//
// Rendered in step 4 (Review) of the Thorough wizard. Adapted from
// `design-system/prototypes/onboarding/OnboardSheet.jsx` `PermissionCard`.
// Pulls strings from `lib/auth/role-permissions.ts` — the single source of
// truth pinned by `tests/unit/auth/role-permissions.test.ts`.
//
// No client behavior — pure presentation. The owner role has zero blocks
// per the role table, so the "Can't do" section is conditionally hidden.

import { Ban, CheckCircle2 } from "lucide-react";

import { getRolePermissions } from "@/lib/auth/role-permissions";
import type { StudioRole } from "@/lib/auth/session";

export type PermissionCardProps = {
  role: StudioRole;
};

export function PermissionCard({ role }: PermissionCardProps) {
  const def = getRolePermissions(role);
  return (
    <section className="onb-perm-card" data-slot="onb-perm-card" aria-label="Role permissions">
      <header className="onb-perm-card-head">
        <h3 className="onb-perm-card-title">{def.label}</h3>
        <p className="onb-perm-card-summary">{def.summary}</p>
      </header>
      <div className="onb-perm-card-body">
        <div className="onb-perm-list" data-kind="grants">
          <span className="onb-perm-list-label">Can do</span>
          <ul className="onb-perm-list-items">
            {def.grants.map((g) => (
              <li className="onb-perm-item" key={g}>
                <CheckCircle2
                  size={16}
                  strokeWidth={1.5}
                  className="onb-perm-item-icon"
                  data-kind="grant"
                  aria-hidden
                />
                <span>{g}</span>
              </li>
            ))}
          </ul>
        </div>
        {def.blocks.length > 0 && (
          <div className="onb-perm-list" data-kind="blocks">
            <span className="onb-perm-list-label">Can&apos;t do</span>
            <ul className="onb-perm-list-items">
              {def.blocks.map((b) => (
                <li className="onb-perm-item" key={b}>
                  <Ban
                    size={16}
                    strokeWidth={1.5}
                    className="onb-perm-item-icon"
                    data-kind="block"
                    aria-hidden
                  />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
