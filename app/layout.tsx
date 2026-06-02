import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { cookies } from "next/headers";
import "@/styles/globals.css";

// Inter is the Lacquer body + heading face. Loaded via `next/font/google` so
// it is self-hosted, auto-preloaded, and subset to latin — no render-blocking
// external `@import` to fonts.googleapis.com. Inter is a variable font, so a
// single woff2 covers the design system's 400/500/600 weights (and anything
// between) without enumerating static instances. The `--font-sans` token in
// `styles/tokens.css` leads with this `--font-inter` variable.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Tang Nails Studio",
  description:
    "Salon management for Tang Nails Studio — checkout, transactions, payroll, and daily reporting.",
};

// Tints the mobile browser address bar and the installed-app title bar with
// the app's own warm near-white background, so the chrome blends into the
// studio surface. Mirrors `theme_color` in `app/manifest.ts`.
//
// `viewportFit: "cover"` lets the layout extend under the notch / home
// indicator so `env(safe-area-inset-*)` resolves to real values — the studio
// topbar, drawer, and main slot pad themselves with those insets on phones.
export const viewport: Viewport = {
  themeColor: "#FCFCF9",
  viewportFit: "cover",
};

// Studio sidebar collapse preference is persisted in a cookie so the root
// layout can render `<html data-studio-sidebar-collapsed>` with the correct
// value SSR-side — eliminating the flash and the hydration mismatch entirely.
// Cookie name + values are mirrored in `components/lacquer/sidebar/sidebar-shell.client.tsx`.
const SIDEBAR_COOKIE = "tn-studio-sidebar-collapsed";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const collapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === "1";

  return (
    <html
      lang="en"
      className={`${inter.variable} h-full antialiased`}
      data-studio-sidebar-collapsed={collapsed ? "true" : "false"}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
