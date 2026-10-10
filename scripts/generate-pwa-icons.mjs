// Renders the favicon and PWA icons from the brand SVG sources (identity
// "Trajectoire", ADR 0028). Sources: docs/brand/{favicon,app-icon,app-icon-maskable}.svg.
// Output (frontend/public/):
//   favicon.svg                 vector favicon (optical mark on an indigo tile)
//   favicon.ico                 16/32/48 px fallback (PNG-in-ICO)
//   favicon.png                 64 px fallback
//   apple-touch-icon.png        180 px, full-bleed square (iOS rounds the corners itself)
//   pwa-192x192.png, pwa-512x512.png       rounded tile, purpose "any"
//   pwa-maskable-512x512.png    full-bleed, symbol inside the 80 % safe zone
//
// Rerun with `npm run generate:pwa-icons` after changing a source SVG.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(ROOT, 'docs', 'brand');
const OUT = resolve(ROOT, 'frontend', 'public');
mkdirSync(OUT, { recursive: true });

const read = (name) => readFileSync(resolve(SRC, name), 'utf8');
const favicon = read('favicon.svg');
const appIcon = read('app-icon.svg');
const maskable = read('app-icon-maskable.svg');
// Apple touch icons must be opaque and square: drop the tile's corner radius.
const appleIcon = appIcon.replace(/ rx="[\d.]+"/, '');
if (appleIcon === appIcon) throw new Error('app-icon.svg: rounded tile not found');

function png(svg, size) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
}

/** ICO container holding PNG images (supported by every current browser). */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, data } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // width
    e.writeUInt8(size >= 256 ? 0 : size, 1); // height
    e.writeUInt8(0, 2); // palette
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(0, 4); // colour planes: 0 for PNG frames (Chromium rejects 1)
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

const write = (name, data) => {
  writeFileSync(resolve(OUT, name), data);
  console.log(`wrote frontend/public/${name} (${data.length} bytes)`);
};

write('favicon.svg', Buffer.from(favicon));
write('favicon.ico', ico([16, 32, 48].map((size) => ({ size, data: png(favicon, size) }))));
write('favicon.png', png(favicon, 64));
write('apple-touch-icon.png', png(appleIcon, 180));
write('pwa-192x192.png', png(appIcon, 192));
write('pwa-512x512.png', png(appIcon, 512));
write('pwa-maskable-512x512.png', png(maskable, 512));
