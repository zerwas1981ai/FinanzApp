// Tests zu D182–D185 (Erkennung ohne KI) – nur erfundene Testdaten
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wiederkehrendVorschlaege, ungewoehnlichHoch, ungewoehnlicheBuchungen, vorherigeBetraege, notizWoerter, kategorieAusNotiz, archivErinnerung,
} from '../js/erkennung.js';

const b = (id, datum, betragCent, partner, extra = {}) => ({ id, datum, betragCent, partner, art: 'ausgabe', kontoId: 'giro', kategorieId: 'abo', ...extra });

test('D182: wiederkehrende Zahlung erkennen – 3 Monate in Folge, ähnlicher Betrag', () => {
  const buchungen = [
    b('s1', '2026-08-14', 1299, 'Streaming-Dienst'), b('s2', '2026-09-14', 1299, 'Streaming-Dienst'), b('s3', '2026-10-14', 1299, 'streaming-dienst '),
    // Lücke im September → keine Kette
    b('f1', '2026-07-03', 2900, 'Fitnessstudio'), b('f2', '2026-08-03', 2900, 'Fitnessstudio'), b('f3', '2026-10-03', 2900, 'Fitnessstudio'),
    // Beträge zu unterschiedlich
    b('m1', '2026-08-02', 5000, 'Supermarkt'), b('m2', '2026-09-02', 9000, 'Supermarkt'), b('m3', '2026-10-02', 6000, 'Supermarkt'),
    // schon als wiederkehrende Buchung vorhanden
    b('t1', '2026-08-05', 3999, 'Telefon AG'), b('t2', '2026-09-05', 3999, 'Telefon AG'), b('t3', '2026-10-05', 3999, 'Telefon AG'),
    // gehört schon zu einer wiederkehrenden Buchung
    b('g1', '2026-08-01', 300000, 'Muster GmbH', { art: 'einnahme', wiederkehrendId: 'w' }), b('g2', '2026-09-01', 300000, 'Muster GmbH', { art: 'einnahme', wiederkehrendId: 'w' }),
    b('g3', '2026-10-01', 300000, 'Muster GmbH', { art: 'einnahme', wiederkehrendId: 'w' }),
    // abgelehnt
    b('z1', '2026-08-20', 1000, 'Zeitung'), b('z2', '2026-09-20', 1000, 'Zeitung'), b('z3', '2026-10-20', 1000, 'Zeitung'),
    // Papierkorb zählt nicht
    b('p1', '2026-08-09', 500, 'Papier'), b('p2', '2026-09-09', 500, 'Papier', { geloeschtAm: 'X' }), b('p3', '2026-10-09', 500, 'Papier'),
  ];
  const wk = [{ art: 'ausgabe', partner: 'Telefon AG', aktiv: true }];
  const v = wiederkehrendVorschlaege(buchungen, wk, ['ausgabe|zeitung'], '2026-11-13');
  assert.deepEqual(v.map((x) => x.partner), ['streaming-dienst'], 'nur der Streaming-Dienst');
  assert.equal(v[0].monate, 3);
  assert.equal(v[0].betragCent, 1299);
  assert.equal(v[0].tag, 14);
  assert.equal(v[0].schluessel, 'ausgabe|streaming-dienst');
  // mehrmals im Monat oder wechselnde Tage → kein Vorschlag
  const einkauf = [b('e1', '2026-08-02', 5000, 'Markt'), b('e2', '2026-09-02', 5000, 'Markt'), b('e3', '2026-10-02', 5000, 'Markt'), b('e4', '2026-10-20', 5000, 'Markt')];
  assert.equal(wiederkehrendVorschlaege(einkauf, [], [], '2026-11-13').length, 0, 'zweimal im Oktober');
  const tage = [b('d1', '2026-08-02', 5000, 'Laden'), b('d2', '2026-09-15', 5000, 'Laden'), b('d3', '2026-10-28', 5000, 'Laden')];
  assert.equal(wiederkehrendVorschlaege(tage, [], [], '2026-11-13').length, 0, 'wechselnde Tage');
  const ende = [b('m1', '2026-08-31', 5000, 'Miete'), b('m2', '2026-09-30', 5000, 'Miete'), b('m3', '2026-10-31', 5000, 'Miete')];
  assert.equal(wiederkehrendVorschlaege(ende, [], [], '2026-11-13').length, 1, 'Monatsende zählt als gleicher Tag');
  // ohne Buchung im Vormonat oder laufenden Monat ist die Kette abgerissen
  assert.equal(wiederkehrendVorschlaege(buchungen, wk, [], '2027-01-05').length, 0);
  // ausgeschaltete wiederkehrende Buchung zählt nicht als vorhanden
  assert.ok(wiederkehrendVorschlaege(buchungen, [{ art: 'ausgabe', partner: 'Telefon AG', aktiv: false }], [], '2026-11-13').some((x) => x.partner === 'Telefon AG'));
});

test('D183: ungewöhnlich hohe Ausgabe', () => {
  assert.equal(ungewoehnlichHoch(14000, [8500, 8500]), null, 'zu wenig Vergleichswerte');
  assert.equal(ungewoehnlichHoch(14000, [8500, 8500, 8500]), 8500);
  assert.equal(ungewoehnlichHoch(12000, [8500, 8500, 8500]), null, 'unter dem 1,5-Fachen');
  assert.equal(ungewoehnlichHoch(3000, [1000, 1000, 1000]), 1000, 'genau 20 € darüber zählt');
  assert.equal(ungewoehnlichHoch(2999, [1000, 1000, 1000]), null, 'weniger als 20 € darüber');
  const liste = [
    b('a', '2026-07-03', 8500, 'Stadtwerke'), b('b', '2026-08-03', 8500, 'Stadtwerke'), b('c', '2026-09-03', 8500, 'stadtwerke'),
    b('d', '2026-10-03', 14000, 'Stadtwerke'), b('e', '2026-11-03', 8500, 'Stadtwerke'),
    b('x', '2026-11-04', 99900, 'Neu'),
  ];
  const m = ungewoehnlicheBuchungen(liste);
  assert.deepEqual([...m.entries()], [['d', 8500]]);
  // D186: bestätigter Betrag → keine Marke; geänderter Betrag → wieder Marke
  const bestaetigt = liste.map((x) => (x.id === 'd' ? { ...x, hochOkCent: 14000 } : x));
  assert.equal(ungewoehnlicheBuchungen(bestaetigt).size, 0);
  const geaendert = liste.map((x) => (x.id === 'd' ? { ...x, hochOkCent: 14000, betragCent: 16000 } : x));
  assert.deepEqual([...ungewoehnlicheBuchungen(geaendert).entries()], [['d', 8500]]);
  assert.deepEqual(vorherigeBetraege(liste, 'STADTWERKE', { ohneId: 'd' }), [8500, 8500, 8500, 8500]);
  assert.deepEqual(vorherigeBetraege(liste, ''), []);
});

test('D184: Kategorie aus der Notiz', () => {
  assert.deepEqual(notizWoerter('Wocheneinkauf für die Woche, Getränke!'), ['wocheneinkauf', 'woche', 'getränke']);
  const buchungen = [
    b('1', '2026-10-01', 100, '', { kategorieId: 'super', notiz: 'Wocheneinkauf' }),
    b('2', '2026-10-08', 100, '', { kategorieId: 'super', notiz: 'Wocheneinkauf groß' }),
    b('3', '2026-10-09', 100, '', { kategorieId: 'tanken', notiz: 'Tanken Urlaub' }),
    b('4', '2026-10-10', 100, '', { kategorieId: 'urlaub', notiz: 'Urlaub Hotel' }),
    b('5', '2026-10-11', 100, '', { kategorieId: 'urlaub', notiz: 'Urlaub Fähre' }),
    b('6', '2026-10-12', 100, '', { kategorieId: 'gehalt', notiz: 'Wocheneinkauf', art: 'einnahme' }),
  ];
  assert.equal(kategorieAusNotiz('wocheneinkauf', buchungen, 'ausgabe'), 'super');
  assert.equal(kategorieAusNotiz('Urlaub', buchungen, 'ausgabe'), 'urlaub', '2 : 1 – klarer Vorsprung');
  assert.equal(kategorieAusNotiz('Tanken Urlaub', buchungen, 'ausgabe'), null, '2 : 2 – kein klarer Vorsprung');
  assert.equal(kategorieAusNotiz('Urlaub Hotel', buchungen, 'ausgabe'), 'urlaub', '3 : 1');
  assert.equal(kategorieAusNotiz('Kino', buchungen, 'ausgabe'), null);
  assert.equal(kategorieAusNotiz('', buchungen, 'ausgabe'), null);
});

test('D185: Archiv-Erinnerung', () => {
  const n = { jahr: 2025, anzahl: 120, hindernis: null };
  assert.equal(archivErinnerung(n, '2026-01-10'), n);
  assert.equal(archivErinnerung(n, '2026-01-10', '2026-02-09'), null, 'zurückgestellt');
  assert.equal(archivErinnerung(n, '2026-02-10', '2026-02-09'), n, 'Frist abgelaufen');
  assert.equal(archivErinnerung(null, '2026-01-10'), null);
  assert.equal(archivErinnerung({ jahr: 2025, anzahl: 0 }, '2026-01-10'), null);
});
