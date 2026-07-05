// Generates the PWA icons (192, 512, 512-maskable) with zero dependencies:
// draws an eighth-note pair on the accent green and hand-encodes the PNGs.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const BG = [0x06, 0xa7, 0x7d, 0xff];
const FG = [0xff, 0xff, 0xff, 0xff];

function drawIcon(size, glyphScale) {
  const px = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) px.set(BG, i * 4);

  const put = (x, y) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    px.set(FG, (y * size + x) * 4);
  };
  const circle = (cx, cy, r) => {
    for (let y = Math.floor(cy - r); y <= cy + r; y++)
      for (let x = Math.floor(cx - r); x <= cx + r; x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) put(Math.round(x), Math.round(y));
  };
  const rect = (x0, y0, x1, y1) => {
    for (let y = Math.round(y0); y < y1; y++)
      for (let x = Math.round(x0); x < x1; x++) put(x, y);
  };

  // Geometry in unit space, scaled about the icon center.
  const s = (v) => size / 2 + (v - 0.5) * size * glyphScale;
  const w = (v) => v * size * glyphScale;

  const headR = w(0.085);
  const stemW = w(0.045);
  const beamTh = w(0.075);
  const h1 = { x: s(0.33), y: s(0.7) };
  const h2 = { x: s(0.67), y: s(0.64) };
  const beamY1 = s(0.26);
  const beamY2 = s(0.2);

  circle(h1.x, h1.y, headR);
  circle(h2.x, h2.y, headR);
  rect(h1.x + headR - stemW, beamY1, h1.x + headR, h1.y);
  rect(h2.x + headR - stemW, beamY2, h2.x + headR, h2.y);
  // slanted beam between stem tops
  const bx0 = h1.x + headR - stemW;
  const bx1 = h2.x + headR;
  for (let x = Math.round(bx0); x < bx1; x++) {
    const t = (x - bx0) / (bx1 - bx0);
    const top = beamY1 + (beamY2 - beamY1) * t;
    rect(x, top, x + 1, top + beamTh);
  }
  return px;
}

// ---- minimal PNG encoder (truecolor + alpha, no filtering) ----
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};

function encodePng(px, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(px.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, '192.png'), encodePng(drawIcon(192, 0.72), 192));
writeFileSync(join(OUT_DIR, '512.png'), encodePng(drawIcon(512, 0.72), 512));
// maskable: keep the glyph well inside the 80% safe zone
writeFileSync(join(OUT_DIR, '512-maskable.png'), encodePng(drawIcon(512, 0.52), 512));
console.log('icons written to', OUT_DIR);
