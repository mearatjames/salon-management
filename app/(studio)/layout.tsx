import "@/styles/dashboard.css";

import type { ReactNode } from "react";

// The "Switch staff" anchor and the "Reconnecting…" banner are placeholders
// for the auth feature and the realtime-presence feature respectively; both
// are kept disabled / hidden in v1 to anchor the markup contract.
export default function StudioLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <main className="tx-landing" data-density="regular">
      <header className="tx-studio-header" aria-label="Studio chrome">
        <a
          className="tx-studio-switch-staff"
          aria-disabled="true"
          tabIndex={-1}
          role="link"
        >
          Switch staff
        </a>
        <div
          className="tx-studio-reconnect"
          role="status"
          aria-live="polite"
          hidden
        >
          Reconnecting…
        </div>
      </header>
      {children}
    </main>
  );
}
