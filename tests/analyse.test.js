// D125: Analyse-Ergänzungen – Vorperiode, Trend, Budget, größte Buchungen. Nur erfundene Testdaten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  vorperiode, budgetSchnitt, groessteBuchungen, veraenderungProzent,
} from '../js/auswertung.js';

test('Vorperiode je Zeitraum, gleich lang wie der gezeigte Zeitraum (bis heute)', () => {
  const heute = '2026-11-09';
  assert.equal(vorperiode({ zeitraum: 'alles' }, heute), null);
  assert.deepEqual(vorperiode({ zeitraum: 'jahr' }, heute), { von: '2025-01-01', bis: '2025-11-09', text: 'Vorjahr bis 09.11.' });
  assert.deepEqual(vorperiode({ zeitraum: 'monat' }, '2026-03-31'), { von: '2026-02-01', bis: '2026-02-28', text: 'Vormonat bis zum gleichen Tag' });
  // D174: Vormonat → der ganze Monat davor
  assert.deepEqual(vorperiode({ zeitraum: 'vormonat' }, '2026-11-13'), { von: '2026-09-01', bis: '2026-09-30', text: 'der Monat davor' });
  assert.deepEqual(vorperiode({ zeitraum: 'vormonat' }, '2026-03-31'), { von: '2026-01-01', bis: '2026-01-31', text: 'der Monat davor' });
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

test('Ausgaben-Verlauf: 12 Monate zurück, 12 voraus, erwartete Ausgaben heller (D126)', async () => {
  const { ausgabenVerlauf, filtere, STANDARD_FILTER } = await import('../js/auswertung.js');
  const { zeitleiste } = await import('../js/prognose.js');
  const heute = '2026-11-09';
  const konten = [{ id: 'giro', name: 'Giro', anfangssaldoCent: 500000, stichtag: '2026-01-01' }];
  const kat = [
    { id: 'wohnen', name: 'Wohnen', elternId: null, art: 'ausgabe' }, { id: 'miete', name: 'Miete', elternId: 'wohnen' },
    { id: 'leben', name: 'Lebensmittel', elternId: null, art: 'ausgabe' }, { id: 'super', name: 'Supermarkt', elternId: 'leben' },
  ];
  const b = (id, datum, cent, kategorieId, status = 'gebucht') => ({ id, datum, art: 'ausgabe', betragCent: cent, kontoId: 'giro', kategorieId, status, partner: '', notiz: '', belege: [] });
  const buchungen = [
    b('a', '2026-10-05', 10000, 'super'),
    b('b', '2026-11-02', 3000, 'super'),
    b('c', '2026-11-05', 2000, 'super', 'vorgemerkt'),
    b('d', '2026-11-20', 4000, 'super'), // erfasst, aber später datiert
  ];
  const wiederkehrende = [{ id: 'm', art: 'ausgabe', kontoId: 'giro', kategorieId: 'miete', start: '2026-11-15', intervall: 'monatlich', stufen: [{ ab: '2026-11-15', betragCent: 90000 }], erstelltAm: '2026-11-01T00:00:00Z' }];
  const budgets = [{ kategorieId: 'leben', kontoId: 'giro', typ: 'wiederkehrend', startMonat: '2026-01', endMonat: null, stufen: [{ ab: '2026-01', betragCent: 20000 }] }];
  const daten = { konten, kategorien: kat, buchungen, budgets, wiederkehrende, geplant: [] };
  const zl = zeitleiste(daten, heute, '2027-05');
  const filter = { ...STANDARD_FILTER };
  const istEintraege = filtere(buchungen, { ...filter, zeitraum: 'alles' }, { kategorien: kat, konten, heute });
  const v = ausgabenVerlauf({ istEintraege, zl, buchungen, kategorien: kat, filter, heute });
  assert.equal(v.length, 13, '6 zurück, laufender, 6 voraus (D127)');
  assert.deepEqual([v[0].jahr, v[0].monat], [2026, 5]);
  assert.deepEqual([v.at(-1).jahr, v.at(-1).monat], [2027, 5]);
  // Monate vor der ersten erfassten Buchung entfallen
  const abOktober = ausgabenVerlauf({ istEintraege, zl, buchungen, kategorien: kat, filter, heute, erster: '2026-10-05' });
  assert.deepEqual([abOktober[0].jahr, abOktober[0].monat], [2026, 10]);
  assert.equal(abOktober.length, 8);
  const nov = v.find((x) => x.aktuell);
  assert.equal(nov.ist, 3000, 'nur gebucht bis heute');
  // erwartet: vorgemerkt 20 + später datiert 40 + Miete 900 + Budgetrest Lebensmittel (200 − 30 − 20 − 40 = 110)
  assert.equal(nov.erwartet, 2000 + 4000 + 90000 + 11000);
  const dez = v.find((x) => x.jahr === 2026 && x.monat === 12);
  assert.equal(dez.ist, 0);
  assert.equal(dez.erwartet, 90000 + 20000, 'Miete + volles Budget');
  assert.equal(v.find((x) => x.monat === 10 && x.jahr === 2026).erwartet, null, 'Vergangenheit ohne Erwartung');
  // Kategoriefilter: nur Wohnen
  const nurWohnen = ausgabenVerlauf({ istEintraege, zl, buchungen, kategorien: kat, filter: { ...filter, kategorieIds: ['wohnen'] }, heute });
  assert.equal(nurWohnen.find((x) => x.aktuell).erwartet, 90000);
  // Empfängerfilter: Erwartung nicht zuordenbar
  assert.equal(ausgabenVerlauf({ istEintraege, zl, buchungen, kategorien: kat, filter: { ...filter, partner: ['X'] }, heute }).find((x) => x.aktuell).erwartet, null);
});
