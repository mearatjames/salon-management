// Rasterize the Tang Nails email brand mark to a hosted PNG.
//
// The staff invitation email (hosted GoTrue template) can't rely on an inline
// <svg> — Gmail and Outlook strip it — so it references a hosted PNG by
// absolute URL. This script is the regeneratable bridge from the
// version-controlled SVG source to that PNG.
//
//   node scripts/build-email-logo.mjs
//
// Output: public/email/tang-nails-logo.png — 96×96 (4× the 24px display size
// for retina), transparent background so it sits on both the light and
// dark-mode card backgrounds in the template.

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const svgPath = resolve(here, "../public/email/tang-nails-logo.svg");
const pngPath = resolve(here, "../public/email/tang-nails-logo.png");

const SIZE = 96;

const svg = await readFile(svgPath);
await sharp(svg, { density: 384 }) // 4× the 96px viewport so curves stay crisp
  .resize(SIZE, SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile(pngPath);

console.log(`wrote ${pngPath} (${SIZE}×${SIZE}, transparent)`);
