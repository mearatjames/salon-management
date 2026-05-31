import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "@/styles/globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      data-studio-sidebar-collapsed={collapsed ? "true" : "false"}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
