// D252/D253: Raster und Tagesmarken der Verlaufsgrafik im Kontokopf
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rasterSchritte, tagesMarken, tagesBeschriftung } from '../js/views/verlauf-grafik.js';
import { gesamtVerlauf } from '../js/prognose.js';

test('D253: runde, feine Rasterschritte (etwa 8 Linien)', () => {
  // 250 € bis 2.200 € → Schritte zu 250 €; Tief- und Höchstwert liegen zu nah am Rand → je eine Stufe Luft
  assert.deepEqual(rasterSchritte(25000, 220000), { von: 0, bis: 250000, linien: [0, 25000, 50000, 75000, 100000, 125000, 150000, 175000, 200000, 225000, 250000] });
  // ins Minus: −120 € bis 480 € → Schritte zu 100 €, mit 0
  assert.deepEqual(rasterSchritte(-12000, 48000).linien, [-20000, -10000, 0, 10000, 20000, 30000, 40000, 50000, 60000]);
  // gleicher Wert: mindestens zwei Linien, Schritte nie unter 1 €
  const flach = rasterSchritte(50000, 50000);
  assert.ok(flach.linien.length >= 2);
  assert.ok(flach.linien[1] - flach.linien[0] >= 100);
});

test('D252: kräftigere Tageslinien je Monatslänge', () => {
  assert.deepEqual(tagesMarken(30), [1, 5, 10, 15, 20, 25, 30]);
  assert.deepEqual(tagesMarken(31), [1, 5, 10, 15, 20, 25, 31]);
  assert.deepEqual(tagesMarken(28), [1, 5, 10, 15, 20, 28]);
});

test('D253: jeder Tag beschriftet, am Handy jeder zweite', () => {
  const b30 = tagesBeschriftung(30);
  assert.equal(b30.length, 30);
  assert.deepEqual(b30.filter((x) => x.schmal).map((x) => x.tag), [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 30]);
  assert.deepEqual(tagesBeschriftung(31).filter((x) => x.schmal).map((x) => x.tag).slice(-2), [29, 31]);
});

test('D253: Verlauf aller Konten zusammen', () => {
  const a = [{ datum: '2026-11-30', stand: 100, prognose: false }, { datum: '2026-12-01', stand: 50, prognose: false }];
  const b = [{ datum: '2026-11-30', stand: 10, prognose: false }, { datum: '2026-12-01', stand: 20, prognose: true }];
  assert.deepEqual(gesamtVerlauf([a, b, []]), [
    { datum: '2026-11-30', stand: 110, prognose: false }, { datum: '2026-12-01', stand: 70, prognose: true }]);
  assert.deepEqual(gesamtVerlauf([]), []);
});
