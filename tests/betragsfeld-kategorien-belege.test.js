// Tests zu D175–D179 (Rechnen im Betragsfeld, häufige Kategorien, Belege-Übersicht) – erfundene Daten
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rechneBetrag, parseEuro } from '../js/format.js';
import { haeufigeKategorien } from '../js/auswertung.js';
import { belegListe, filtereBelege } from '../js/belegliste.js';

test('D175: Rechnen im Betragsfeld', () => {
  assert.equal(rechneBetrag('12,50+3,20'), 1570);
  assert.equal(rechneBetrag('89,90 - 10'), 7990);
  assert.equal(rechneBetrag('3*2,49'), 747);
  assert.equal(rechneBetrag('3 x 2,49 + 0,25'), 772, 'Punkt vor Strich, x als Malzeichen');
  assert.equal(rechneBetrag('1.200,00+50'), 125000, 'Tausenderpunkt bleibt erlaubt');
  assert.equal(rechneBetrag('10−2,50'), 750, 'typografisches Minus');
  assert.equal(rechneBetrag('12,50'), null, 'keine Rechnung → parseEuro wie bisher');
  assert.equal(rechneBetrag('-5'), null, 'Vorzeichen allein ist keine Rechnung');
  assert.equal(rechneBetrag(''), null);
  assert.equal(parseEuro('12,50'), 1250);
  assert.throws(() => rechneBetrag('12++3'), /Betrag/);
  assert.throws(() => rechneBetrag('12+abc'), /Betrag/);
  assert.throws(() => rechneBetrag('3*'), /Rechnung/);
});

test('D175: häufige Kategorien – ab 2 Buchungen, häufigste zuerst, je Art', () => {
  const b = (kategorieId, datum, art = 'ausgabe', extra = {}) => ({ kategorieId, datum, art, ...extra });
  const buchungen = [
    b('super', '2026-10-01'), b('super', '2026-10-08'), b('super', '2026-10-15'),
    b('tanken', '2026-10-02'), b('tanken', '2026-11-02'),
    b('baecker', '2026-09-01'), b('baecker', '2026-11-05'),
    b('einmal', '2026-11-01'),
    b('geloescht', '2026-11-01', 'ausgabe', { geloeschtAm: 'X' }), b('geloescht', '2026-11-02', 'ausgabe', { geloeschtAm: 'X' }),
    b('gehalt', '2026-10-01', 'einnahme'), b('gehalt', '2026-11-01', 'einnahme'),
    { art: 'umbuchung', datum: '2026-11-01', kategorieId: null },
  ];
  assert.deepEqual(haeufigeKategorien(buchungen, 'ausgabe'), ['super', 'baecker', 'tanken'], 'Gleichstand: zuletzt benutzt zuerst');
  assert.deepEqual(haeufigeKategorien(buchungen, 'einnahme'), ['gehalt']);
  assert.deepEqual(haeufigeKategorien(buchungen, 'ausgabe', 1), ['super']);
});

test('D179: Belege-Übersicht aus Buchungen, relevanten Ausgaben und Verträgen', () => {
  const daten = {
    kategorien: [{ id: 'u', name: 'Supermarkt' }],
    buchungen: [
      { id: 'b1', datum: '2026-11-06', art: 'ausgabe', betragCent: 6240, partner: 'Supermarkt Muster', kategorieId: 'u', belege: [{ id: '1', name: '2026-11-06 Supermarkt Muster.jpg' }] },
      { id: 'b2', datum: '2026-11-07', art: 'ausgabe', betragCent: 100, belege: [{ id: '2', name: 'weg.jpg' }], geloeschtAm: 'X' },
      { id: 'b3', datum: '2026-10-01', art: 'einnahme', betragCent: 320000, partner: 'Muster GmbH', belege: [{ id: '3', name: 'Lohn.pdf' }, { id: '4', name: 'Anlage.pdf' }] },
    ],
    relevant: [{ id: 'r1', datum: '2012-05-03', betragCent: 450000, notiz: 'Einbauküche', belege: [{ id: '5', name: '2012-05-03 Einbauküche.pdf' }] }],
    vertraege: [{ id: 'v1', name: 'Internet', anbieter: 'Telefon AG', erstelltAm: '2026-11-12T10:00:00Z', belege: [{ id: '6', name: 'Vertrag Internet.pdf', hinzugefuegtAm: '2026-11-12T10:00:00Z' }] }],
  };
  const liste = belegListe(daten);
  assert.deepEqual(liste.map((x) => x.beleg.id), ['6', '1', '4', '3', '5'], 'neueste zuerst, Papierkorb fehlt');
  assert.equal(liste[1].titel, 'Supermarkt Muster · Supermarkt');
  assert.equal(liste[1].betragCent, -6240);
  assert.equal(liste[2].betragCent, 320000, 'Einnahme positiv');
  assert.equal(liste[0].quelle, 'vertrag');
  assert.deepEqual(filtereBelege(liste, 'muster').map((x) => x.beleg.id), ['1', '4', '3']);
  assert.deepEqual(filtereBelege(liste, 'küche 2012').map((x) => x.beleg.id), ['5']);
  assert.deepEqual(filtereBelege(liste, '06.11.2026').map((x) => x.beleg.id), ['1']);
  assert.equal(filtereBelege(liste, '').length, 5);
});
