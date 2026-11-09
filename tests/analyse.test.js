// D125: Analyse-Ergänzungen – Vorperiode, Trend, Budget, größte Buchungen. Nur erfundene Testdaten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  vorperiode, monatsSummenJeKategorie, letzteZwoelfMonate, budgetSchnitt, groessteBuchungen, veraenderungProzent,
} from '../js/auswertung.js';

test('Vorperiode je Zeitraum, gleich lang wie der gezeigte Zeitraum (bis heute)', () => {
  const heute = '2026-11-09';
  assert.equal(vorperiode({ zeitraum: 'alles' }, heute), null);
  assert.deepEqual(vorperiode({ zeitraum: 'jahr' }, heute), { von: '2025-01-01', bis: '2025-11-09', text: 'Vorjahr bis 09.11.' });
  assert.deepEqual(vorperiode({ zeitraum: 'monat' }, '2026-03-31'), { von: '2026-02-01', bis: '2026-02-28', text: 'Vormonat bis zum gleichen Tag' });
  assert.deepEqual(vorperiode({ zeitraum: 'letzte3' }, heute), { von: '2026-05-01', bis: '2026-07-31', text: 'die 3 Monate davor' });
  assert.deepEqual(vorperiode({ zeitraum: 'eigen', von: '2026-10-01', bis: '2026-10-10' }, heute), { von: '2026-09-21', bis: '2026-09-30', text: 'die 10 Tage davor' });
  assert.equal(vorperiode({ zeitraum: 'eigen', von: '', bis: '' }, heute), null);
});

const kategorien = [
  { id: 'leben', name: 'Lebensmittel', elternId: null, art: 'ausgabe' },
  { id: 'super', name: 'Supermarkt', elternId: 'leben' },
  { id: 'frei', name: 'Freizeit', elternId: null, art: 'ausgabe' },
  { id: 'kino', name: 'Kino', elternId: 'frei' },
];
const e = (datum, cent, kategorieId, art = 'ausgabe') => ({ buchung: { datum, betragCent: cent, kategorieId, art }, wirkung: -cent });

test('Trend: Monatssummen je Hauptkategorie über 12 Monate', () => {
  const monate = letzteZwoelfMonate('2026-11-09');
  assert.equal(monate.length, 12);
  assert.deepEqual(monate[0], [2025, 12]);
  assert.deepEqual(monate.at(-1), [2026, 11]);
  const summen = monatsSummenJeKategorie([e('2026-11-02', 500, 'super'), e('2026-11-20', 300, 'super'), e('2026-01-05', 900, 'kino'), e('2024-01-01', 1, 'kino')], kategorien, 'ausgabe', monate);
  assert.equal(summen.get('leben').at(-1), 800);
  assert.equal(summen.get('frei')[1], 900, 'Januar 2026');
  assert.equal(summen.get('frei').reduce((s, x) => s + x, 0), 900, 'außerhalb der 12 Monate zählt nicht');
});

test('Budget je Monat: Monats- und Jahresbudget, Kontofilter, ausgeschaltete zählen nicht', () => {
  const budgets = [
    { kategorieId: 'leben', kontoId: 'giro', typ: 'wiederkehrend', startMonat: '2026-01', endMonat: null, stufen: [{ ab: '2026-01', betragCent: 40000 }] },
    { kategorieId: 'leben', kontoId: 'kk', typ: 'wiederkehrend', startMonat: '2026-09', endMonat: null, stufen: [{ ab: '2026-09', betragCent: 6000 }] },
    { kategorieId: 'frei', kontoId: 'giro', typ: 'jaehrlich', startJahr: 2026, endJahr: null, verteilung: 'zeitpunkt', zeitpunktMonat: 7, betragCent: 120000 },
    { kategorieId: 'frei', kontoId: 'giro', typ: 'wiederkehrend', aktiv: false, startMonat: '2026-01', endMonat: null, stufen: [{ ab: '2026-01', betragCent: 99999 }] },
  ];
  const monate = [[2026, 8], [2026, 9], [2026, 10]];
  assert.equal(budgetSchnitt(budgets, 'leben', monate), Math.round((40000 * 3 + 6000 * 2) / 3), 'beide Konten');
  assert.equal(budgetSchnitt(budgets, 'leben', monate, ['giro']), 40000, 'nur Girokonto');
  assert.equal(budgetSchnitt(budgets, 'frei', monate), 10000, 'Jahresbudget 1.200 € → 100 € je Monat, ausgeschaltetes zählt nicht');
  assert.equal(budgetSchnitt(budgets, 'unbekannt', monate), null);
});

test('Größte Buchungen und Veränderung in Prozent', () => {
  const liste = [e('2026-11-01', 100, 'super'), e('2026-11-02', 900, 'kino'), e('2026-11-03', 500, 'super'), e('2026-11-04', 50000, 'x', 'einnahme')];
  assert.deepEqual(groessteBuchungen(liste, 'ausgabe', 2).map((x) => x.buchung.betragCent), [900, 500]);
  assert.equal(veraenderungProzent(110, 100), 10);
  assert.equal(veraenderungProzent(50, 100), -50);
  assert.equal(veraenderungProzent(50, 0), null);
});
