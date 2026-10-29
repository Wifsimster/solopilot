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
const appleIcon = appIcon.replace(/ rx="[\d.]+"/, '');
if (appleIcon === appIcon) throw new Error('app-icon.svg: rounded tile not found');

function png(svg, size) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
}

function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, data } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(0, 4);
    e.writeUInt16LE(32, 6);
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
