// Section — a top-level grouping inside /settings/onboarding.
//
// One section per bucket: Pending invites, Active users, Offboarded
// users. Each renders a head (icon + title + count + sub) and a body
// that's either the empty-state copy or the caller-supplied `children`
// (the list of <UserRow>s).
//
// Server Component — pure layout. The empty/populated branch is
// decided by `count` because the caller already binned the roster
// upstream (see `app/(studio)/settings/onboarding/_sort.ts`).

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

type Props = {
  icon: LucideIcon;
  title: string;
  count: number;
  sub: string;
  emptyCopy: string;
  children?: ReactNode;
};

export function Section({ icon: Icon, title, count, sub, emptyCopy, children }: Props) {
  return (
    <section className="onb-section">
      <header className="onb-section-head">
        <Icon size={20} strokeWidth={1.5} className="onb-section-icon" aria-hidden />
        <div className="onb-section-text">
          <h2 className="onb-section-title">
            {title} <span className="onb-section-count">{count}</span>
          </h2>
          <p className="onb-section-sub">{sub}</p>
        </div>
      </header>
      <div className="onb-section-body">
        {count === 0 ? <div className="onb-section-empty">{emptyCopy}</div> : children}
      </div>
    </section>
  );
}
