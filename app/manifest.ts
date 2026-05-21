import type { MetadataRoute } from "next";

// Web app manifest — Next.js serves this at `/manifest.webmanifest` and emits
// the `<link rel="manifest">` tag automatically.
//
// Colours: `theme_color` / `background_color` are the app's own warm
// near-white background (`--background` → `--neutral-50`, styles/tokens.css),
// so the installed-app title bar and the launch splash stay calm and blend
// into the studio chrome. Icons are rasterised from `app/icon.svg` (the
// Lacquer "Squircle, light" mark).

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Tang Nails Studio",
    short_name: "Tang Nails",
    description:
      "Salon management for Tang Nails Studio — checkout, transactions, payroll, and daily reporting.",
    start_url: "/",
    display: "standalone",
    background_color: "#FCFCF9",
    theme_color: "#FCFCF9",
    icons: [
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any" },
      { src: "/icons/icon-192.png", type: "image/png", sizes: "192x192", purpose: "any" },
      { src: "/icons/icon-512.png", type: "image/png", sizes: "512x512", purpose: "any" },
      { src: "/icons/icon-512.png", type: "image/png", sizes: "512x512", purpose: "maskable" },
    ],
  };
}
