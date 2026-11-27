// D252: Raster und Tagesmarken der Verlaufsgrafik im Kontokopf
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rasterSchritte, tagesMarken } from '../js/views/verlauf-grafik.js';

test('D252: runde Rasterschritte', () => {
  // 250 € bis 2.200 € → Schritte zu 500 €
  assert.deepEqual(rasterSchritte(25000, 220000), { von: 0, bis: 250000, linien: [0, 50000, 100000, 150000, 200000, 250000] });
  // ins Minus: −120 € bis 480 € → Schritte zu 200 €, mit 0
  assert.deepEqual(rasterSchritte(-12000, 48000).linien, [-20000, 0, 20000, 40000, 60000]);
  // gleicher Wert: mindestens 1 € Spanne
  assert.ok(rasterSchritte(50000, 50000).linien.length >= 2);
});

test('D252: Tagesmarken je Monatslänge', () => {
  assert.deepEqual(tagesMarken(30), [1, 5, 10, 15, 20, 25, 30]);
  assert.deepEqual(tagesMarken(31), [1, 5, 10, 15, 20, 25, 31]);
  assert.deepEqual(tagesMarken(28), [1, 5, 10, 15, 20, 28]);
});
