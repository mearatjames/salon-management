import "@/styles/dashboard.css";

import type { ReactNode } from "react";

export default function StudioLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return <>{children}</>;
}
