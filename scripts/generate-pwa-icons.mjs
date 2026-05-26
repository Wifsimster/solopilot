// Generates PWA icons as PNGs using only Node built-ins.
// Output: frontend/public/{pwa-192x192,pwa-512x512,pwa-maskable-512x512,apple-touch-icon,favicon}.png
//
// Design: dark slate background with a centered white "X" mark.
// Rerun via `node scripts/generate-pwa-icons.mjs` if the brand changes.

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'frontend', 'public');
mkdirSync(OUT_DIR, { recursive: true });

const BG = [15, 23, 42, 255]; // slate-900
const FG = [255, 255, 255, 255];

// CRC32 table
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, pixels) {
  // pixels: Buffer of length width*height*4 (RGBA)
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  // Insert filter byte (0) per scanline
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function blend(dst, src) {
  // src over dst, both [r,g,b,a] 0-255
  const sa = src[3] / 255;
  const da = dst[3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa === 0) return [0, 0, 0, 0];
  const r = (src[0] * sa + dst[0] * da * (1 - sa)) / oa;
  const g = (src[1] * sa + dst[1] * da * (1 - sa)) / oa;
  const b = (src[2] * sa + dst[2] * da * (1 - sa)) / oa;
  return [Math.round(r), Math.round(g), Math.round(b), Math.round(oa * 255)];
}

function drawIcon(size, { maskable = false } = {}) {
  const pixels = Buffer.alloc(size * size * 4);
  // Safe zone for maskable icons: keep content within central 80% (per W3C maskable spec).
  const safe = maskable ? 0.8 : 1.0;
  // Background: rounded square (only non-maskable rounds the corners; maskable fills the whole canvas)
  const radius = maskable ? 0 : size * 0.18;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let inside = true;
      if (radius > 0) {
        // distance to nearest corner center
        const cx = x < radius ? radius : x > size - radius ? size - radius : x;
        const cy = y < radius ? radius : y > size - radius ? size - radius : y;
        const dx = x - cx;
        const dy = y - cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        const a = Math.max(0, Math.min(1, radius - d + 0.5));
        const alpha = (cx !== x || cy !== y) ? a : 1;
        if (alpha <= 0) continue;
        const idx = (y * size + x) * 4;
        const blended = blend([0, 0, 0, 0], [BG[0], BG[1], BG[2], Math.round(BG[3] * alpha)]);
        pixels[idx] = blended[0];
        pixels[idx + 1] = blended[1];
        pixels[idx + 2] = blended[2];
        pixels[idx + 3] = blended[3];
        inside = alpha > 0;
      } else {
        const idx = (y * size + x) * 4;
        pixels[idx] = BG[0];
        pixels[idx + 1] = BG[1];
        pixels[idx + 2] = BG[2];
        pixels[idx + 3] = BG[3];
      }
      if (!inside) continue;
    }
  }

  // Draw "X" mark with two diagonal strokes, centered.
  const cx = size / 2;
  const cy = size / 2;
  const armLen = (size * safe) * 0.30; // half-length of each diagonal arm
  const thickness = size * safe * 0.10; // stroke width
  const half = thickness / 2;

  // Two line segments forming the X.
  const segments = [
    { x1: cx - armLen, y1: cy - armLen, x2: cx + armLen, y2: cy + armLen },
    { x1: cx - armLen, y1: cy + armLen, x2: cx + armLen, y2: cy - armLen },
  ];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let strokeAlpha = 0;
      for (const seg of segments) {
        // distance from point to line segment
        const dx = seg.x2 - seg.x1;
        const dy = seg.y2 - seg.y1;
        const lenSq = dx * dx + dy * dy;
        let t = ((x - seg.x1) * dx + (y - seg.y1) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const projX = seg.x1 + t * dx;
        const projY = seg.y1 + t * dy;
        const d = Math.sqrt((x - projX) ** 2 + (y - projY) ** 2);
        const a = Math.max(0, Math.min(1, half - d + 0.5));
        if (a > strokeAlpha) strokeAlpha = a;
      }
      if (strokeAlpha > 0) {
        const idx = (y * size + x) * 4;
        const dst = [pixels[idx], pixels[idx + 1], pixels[idx + 2], pixels[idx + 3]];
        const src = [FG[0], FG[1], FG[2], Math.round(FG[3] * strokeAlpha)];
        const out = blend(dst, src);
        pixels[idx] = out[0];
        pixels[idx + 1] = out[1];
        pixels[idx + 2] = out[2];
        pixels[idx + 3] = out[3];
      }
    }
  }

  return encodePng(size, size, pixels);
}

const targets = [
  { name: 'pwa-192x192.png', size: 192 },
  { name: 'pwa-512x512.png', size: 512 },
  { name: 'pwa-maskable-512x512.png', size: 512, maskable: true },
  { name: 'apple-touch-icon.png', size: 180 },
  { name: 'favicon.png', size: 64 },
];

for (const t of targets) {
  const png = drawIcon(t.size, { maskable: !!t.maskable });
  const outPath = resolve(OUT_DIR, t.name);
  writeFileSync(outPath, png);
  console.log(`wrote ${outPath} (${png.length} bytes)`);
}
