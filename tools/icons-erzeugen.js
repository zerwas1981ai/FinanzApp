// Erzeugt die App-Symbole (PNG) ohne zusätzliche Programme.
// Aufruf: npm run icons
// Motiv: blaues Quadrat mit drei aufsteigenden weißen Balken.

import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ZIEL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'icons');
const BLAU = [37, 99, 235];
const WEISS = [255, 255, 255];

// Balken in einem 100×100-Raster (x, y, Breite, Höhe)
const BALKEN = [
  [24, 56, 14, 22],
  [43, 42, 14, 36],
  [62, 26, 14, 52],
];

function inRundRechteck(x, y, x0, y0, b, hoehe, r) {
  if (x < x0 || x > x0 + b || y < y0 || y > y0 + hoehe) return false;
  const cx = Math.min(Math.max(x, x0 + r), x0 + b - r);
  const cy = Math.min(Math.max(y, y0 + r), y0 + hoehe - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/** Farbe (RGBA) an Position u,v im 100er-Raster */
function farbe(u, v, maskierbar) {
  const imHintergrund = maskierbar ? true : inRundRechteck(u, v, 0, 0, 100, 100, 22);
  if (!imHintergrund) return [0, 0, 0, 0];
  // Maskierbare Icons: Motiv kleiner, damit es im "sicheren Bereich" bleibt
  const s = maskierbar ? 0.72 : 1;
  const mu = (u - 50) / s + 50;
  const mv = (v - 50) / s + 50;
  const balken = BALKEN.some(([x, y, b, hh]) => inRundRechteck(mu, mv, x, y, b, hh, 3));
  return [...(balken ? WEISS : BLAU), 255];
}

function erzeugePng(groesse, maskierbar) {
  const UEBER = 4; // Kantenglättung durch 4×4-Abtastung
  const zeilen = Buffer.alloc(groesse * (groesse * 4 + 1));
  for (let y = 0; y < groesse; y++) {
    const start = y * (groesse * 4 + 1);
    zeilen[start] = 0;
    for (let x = 0; x < groesse; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < UEBER; sy++) {
        for (let sx = 0; sx < UEBER; sx++) {
          const u = ((x + (sx + 0.5) / UEBER) / groesse) * 100;
          const v = ((y + (sy + 0.5) / UEBER) / groesse) * 100;
          const [cr, cg, cb, ca] = farbe(u, v, maskierbar);
          r += cr * ca; g += cg * ca; b += cb * ca; a += ca;
        }
      }
      const o = start + 1 + x * 4;
      zeilen[o] = a ? Math.round(r / a) : 0;
      zeilen[o + 1] = a ? Math.round(g / a) : 0;
      zeilen[o + 2] = a ? Math.round(b / a) : 0;
      zeilen[o + 3] = Math.round(a / (UEBER * UEBER));
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(groesse, 0);
  ihdr.writeUInt32BE(groesse, 4);
  ihdr[8] = 8; // Bittiefe
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(zeilen, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC_TABELLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABELLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(typ, daten) {
  const laenge = Buffer.alloc(4);
  laenge.writeUInt32BE(daten.length);
  const typUndDaten = Buffer.concat([Buffer.from(typ, 'ascii'), daten]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typUndDaten));
  return Buffer.concat([laenge, typUndDaten, crc]);
}

for (const [datei, groesse, maskierbar] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
]) {
  writeFileSync(path.join(ZIEL, datei), erzeugePng(groesse, maskierbar));
  console.log('erstellt:', datei);
}
