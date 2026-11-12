// Tests zu D143–D147 (Verbesserungen vom 12.11.2026) – nur erfundene Testdaten
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { benenneBelege } from '../js/relevant.js';
import { relevantAlsCsv } from '../js/export.js';
import { tageZwischen, abstimmungFaellig } from '../js/konten.js';
import { suche, suchWoerter } from '../js/suche.js';
import { vorgemerkteVonKonto, alsGebuchtMarkieren } from '../js/buchungen.js';

test('D143: Belegname nach Empfänger, uploadete bleiben', () => {
  const neu = benenneBelege([{ id: 'a', name: '2026-11-01 Alt.jpg' }, { id: 'b', name: 'x.pdf', driveId: 'd' }], '2026-11-03', 'Bäckerei Muster');
  assert.deepEqual(neu.map((b) => b.name), ['2026-11-03 Bäckerei Muster.jpg', 'x.pdf']);
});

test('D144: Relevante Ausgaben als CSV mit Summenzeile, älteste zuerst', () => {
  const zeilen = [
    { quelle: 'buchung', datum: '2026-10-20', betragCent: 95000, partner: 'Möbel Muster', kategorieId: 'u1', notiz: 'Sofa', gruppe: 'Haus', kontoId: 'giro', belege: [{ name: '2026-10-20 Sofa.pdf' }] },
    { quelle: 'eintrag', datum: '2012-05-03', betragCent: 450000, partner: '', kategorieId: null, notiz: 'Einbauküche', gruppe: '', belege: [] },
  ];
  const csv = relevantAlsCsv(zeilen, { konten: [{ id: 'giro', name: 'Giro (Test)' }], kategorien: [{ id: 'h1', name: 'Wohnen' }, { id: 'u1', name: 'Möbel', elternId: 'h1' }] });
  const z = csv.replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(z[0], 'Datum;Empfänger;Hauptkategorie;Unterkategorie;Betrag (€);Notiz;Gruppe;Herkunft;Belege');
  assert.equal(z[1], '03.05.2012;;;;4500,00;Einbauküche;;Eigener Eintrag;');
  assert.equal(z[2], '20.10.2026;Möbel Muster;Wohnen;Möbel;950,00;Sofa;Haus;Giro (Test);2026-10-20 Sofa.pdf');
  assert.equal(z[3], 'Summe;;;;5450,00;;;;');
});

test('D145: Abstimmung nach mehr als 10 Tagen fällig', () => {
  assert.equal(tageZwischen('2026-11-01', '2026-11-11'), 10);
  assert.equal(tageZwischen('2026-02-25', '2026-03-03'), 6);
  assert.equal(tageZwischen('2026-03-20', '2026-04-01'), 12, 'Zeitumstellung stört nicht');
  assert.equal(abstimmungFaellig('2026-11-01', '2026-11-11'), false, 'genau 10 Tage: noch nicht');
  assert.equal(abstimmungFaellig('2026-11-01', '2026-11-12'), true);
  assert.equal(abstimmungFaellig(undefined, '2026-11-12'), true, 'nie abgestimmt');
});

test('D146: Suche über alle Bereiche, alle Wörter müssen passen', () => {
  const daten = {
    konten: [{ id: 'giro', name: 'Giro (Test)' }, { id: 'tg', name: 'Tagesgeld (Test)' }],
    kategorien: [{ id: 'h1', name: 'Wohnen' }, { id: 'u1', name: 'Strom', elternId: 'h1' }],
    projekte: [{ id: 'p1', name: 'Badumbau', notiz: '' }],
    buchungen: [
      { id: 'b1', art: 'ausgabe', datum: '2026-10-03', betragCent: 8500, kontoId: 'giro', kategorieId: 'u1', partner: 'Stadtwerke Muster', notiz: 'Abschlag' },
      { id: 'b2', art: 'ausgabe', datum: '2026-11-03', betragCent: 8500, kontoId: 'giro', kategorieId: 'u1', partner: 'Stadtwerke Muster', notiz: 'Abschlag' },
      { id: 'b3', art: 'ausgabe', datum: '2026-11-04', betragCent: 8500, kontoId: 'giro', partner: 'Stadtwerke Muster', geloeschtAm: 'X' },
      { id: 'u-ab', art: 'umbuchung', richtung: 'ab', umbuchungId: 'u', datum: '2026-11-02', betragCent: 120000, kontoId: 'giro', gegenkontoId: 'tg' },
      { id: 'u-zu', art: 'umbuchung', richtung: 'zu', umbuchungId: 'u', datum: '2026-11-02', betragCent: 120000, kontoId: 'tg', gegenkontoId: 'giro' },
    ],
    relevant: [{ id: 'r1', datum: '2012-05-03', betragCent: 450000, notiz: 'Einbauküche Garantie', partner: '' }],
    wiederkehrend: [{ id: 'w1', art: 'ausgabe', partner: 'Stadtwerke Muster', kontoId: 'giro', kategorieId: 'u1', intervall: 'monatlich', start: '2026-01-03', stufen: [{ ab: '2026-01-03', betragCent: 8000 }, { ab: '2026-06-03', betragCent: 8500 }] }],
    geplant: [{ id: 'g1', art: 'ausgabe', bezeichnung: 'Fliesen Bad', datum: '2026-12-01', betragCent: 120000, kontoId: 'giro', projektId: 'p1' }],
  };
  const r = suche('stadtwerke', daten);
  assert.deepEqual(r.buchung.map((t) => t.id), ['b2', 'b1'], 'neueste zuerst, Papierkorb nie');
  assert.deepEqual(r.wiederkehrend.map((t) => t.id), ['w1']);
  assert.equal(r.wiederkehrend[0].betragCent, 8500, 'aktueller Betrag');
  assert.deepEqual(suche('STROM abschlag 85,00', daten).buchung.map((t) => t.id), ['b2', 'b1']);
  assert.deepEqual(suche('1.200', daten).buchung.map((t) => t.id), ['u-ab'], 'Umbuchung nur einmal');
  assert.deepEqual(suche('1200', daten).geplant.map((t) => t.id), ['g1']);
  assert.deepEqual(suche('badumbau', daten).geplant.map((t) => t.id), ['g1'], 'über den Projektnamen');
  assert.deepEqual(suche('badumbau', daten).projekt.map((t) => t.id), ['p1']);
  assert.deepEqual(suche('garantie', daten).relevant.map((t) => t.id), ['r1']);
  assert.equal(suche('   ', daten).buchung.length, 0);
  assert.deepEqual(suchWoerter('  Strom  Abschlag '), ['strom', 'abschlag']);
});

test('D147: Vorgemerkte gesammelt buchen, Umbuchung mit beiden Hälften', () => {
  const alle = [
    { id: 'a', kontoId: 'giro', datum: '2026-11-05', status: 'vorgemerkt', art: 'ausgabe' },
    { id: 'b', kontoId: 'giro', datum: '2026-11-02', status: 'vorgemerkt', art: 'ausgabe' },
    { id: 'c', kontoId: 'giro', datum: '2026-11-01', status: 'gebucht', art: 'ausgabe' },
    { id: 'd', kontoId: 'giro', datum: '2026-11-01', status: 'vorgemerkt', art: 'ausgabe', geloeschtAm: 'X' },
    { id: 'u1', kontoId: 'giro', datum: '2026-11-03', status: 'vorgemerkt', art: 'umbuchung', umbuchungId: 'u', richtung: 'ab' },
    { id: 'u2', kontoId: 'tg', datum: '2026-11-03', status: 'vorgemerkt', art: 'umbuchung', umbuchungId: 'u', richtung: 'zu' },
  ];
  assert.deepEqual(vorgemerkteVonKonto('giro', alle).map((b) => b.id), ['b', 'u1', 'a']);
  const neu = alsGebuchtMarkieren(['a', 'u1'], alle, 'T');
  assert.deepEqual(neu.map((b) => b.id).sort(), ['a', 'u1', 'u2']);
  assert.ok(neu.every((b) => b.status === 'gebucht' && b.geaendertAm === 'T'));
});
