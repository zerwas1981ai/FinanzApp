// Tests zu D156/D240 (Monats- und Jahresrückblick) – nur erfundene Testdaten
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monatsRueckblick, jahresRueckblick, waehlbareZeitraeume, plusMonat } from '../js/rueckblick.js';
import { monatKurz } from '../js/format.js';

const kategorien = [
  { id: 'h1', name: 'Wohnen' }, { id: 'u1', name: 'Miete', elternId: 'h1' },
  { id: 'h2', name: 'Lebensmittel' }, { id: 'u2', name: 'Supermarkt', elternId: 'h2' },
  { id: 'e1', name: 'Einkommen' }, { id: 'eu', name: 'Gehalt', elternId: 'e1' },
];
const b = (id, datum, art, cent, kat, extra = {}) => ({ id, datum, art, betragCent: cent, kategorieId: kat, ...extra });
const buchungen = [
  b('1', '2026-08-01', 'einnahme', 300000, 'eu'), b('2', '2026-08-03', 'ausgabe', 95000, 'u1'), b('3', '2026-08-10', 'ausgabe', 20000, 'u2'),
  b('4', '2026-09-01', 'einnahme', 300000, 'eu'), b('5', '2026-09-03', 'ausgabe', 95000, 'u1'), b('6', '2026-09-12', 'ausgabe', 30000, 'u2'),
  b('7', '2026-10-01', 'einnahme', 320000, 'eu'), b('8', '2026-10-03', 'ausgabe', 95000, 'u1'), b('9', '2026-10-15', 'ausgabe', 25000, 'u2'),
  b('10', '2026-10-20', 'ausgabe', 99900, 'u2', { geloeschtAm: 'X' }),
  b('11', '2026-10-21', 'umbuchung', 50000, null, { richtung: 'ab' }),
  b('12', '2025-10-05', 'ausgabe', 90000, 'u1'), b('13', '2025-10-01', 'einnahme', 280000, 'eu'), b('14', '2025-12-20', 'ausgabe', 50000, 'u2'),
];

test('D156: Monatsrückblick mit den beiden Vormonaten', () => {
  const rb = monatsRueckblick(buchungen, kategorien, '2026-10', '2026-11-12');
  assert.deepEqual(rb.spalten, ['Aug 26', 'Sep 26', 'Okt 26']);
  assert.deepEqual(rb.perioden.map((p) => p.ausgaben), [115000, 125000, 120000], 'Papierkorb und Umbuchung zählen nicht');
  assert.deepEqual(rb.perioden.map((p) => p.einnahmen), [300000, 300000, 320000]);
  assert.equal(rb.perioden[2].saldo, 200000);
  assert.equal(rb.perioden[2].sparquote, 200000 / 320000);
  assert.equal(rb.laufend, false);
  assert.deepEqual(rb.kategorien.map((k) => [k.name, k.werte, k.differenz]), [
    ['Wohnen', [95000, 95000, 95000], 0],
    ['Lebensmittel', [20000, 30000, 25000], -5000],
  ]);
  assert.deepEqual(rb.groesste.map((x) => x.id), ['8', '9']);
  // laufender Monat: nur bis heute
  const lfd = monatsRueckblick([...buchungen, b('20', '2026-11-20', 'ausgabe', 1000, 'u2')], kategorien, '2026-11', '2026-11-12');
  assert.equal(lfd.laufend, true);
  assert.equal(lfd.perioden[2].ausgaben, 0, 'Buchung nach heute zählt nicht');
  assert.equal(plusMonat('2026-01', -2), '2025-11');
  assert.equal(monatKurz('2026-03'), 'Mär 26');
});

test('D156: Jahresrückblick – laufendes Jahr gegen Vorjahr bis zum gleichen Tag', () => {
  const rb = jahresRueckblick(buchungen, kategorien, 2026, '2026-11-12');
  assert.equal(rb.laufend, true);
  assert.equal(rb.vorjahrBis, '2025-11-12');
  assert.deepEqual(rb.spalten, ['2025', '2026']);
  assert.equal(rb.perioden[0].ausgaben, 90000, 'Dezember 2025 zählt im Vergleich nicht');
  assert.equal(rb.perioden[1].ausgaben, 360000);
  assert.equal(rb.monate.length, 11, 'Januar bis November');
  assert.equal(rb.monate[9].saldo, 200000);
  const vj = jahresRueckblick(buchungen, kategorien, 2025, '2026-11-12');
  assert.equal(vj.laufend, false);
  assert.equal(vj.perioden[1].ausgaben, 140000);
  assert.equal(vj.monate.length, 12);
  const w = waehlbareZeitraeume(buchungen, '2026-11-12');
  assert.equal(w.monate[0], '2026-11');
  assert.equal(w.monate.at(-1), '2025-10');
  assert.deepEqual(w.jahre, [2026, 2025]);
});

