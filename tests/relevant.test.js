import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  baueRelevant, relevanteZeilen, gruppenListe, filtereGruppe, nachJahren, kopienAufgaben, istRelevanteBuchung, OHNE_GRUPPE,
  benenneBelege,
} from '../js/relevant.js';
import { baueBuchungen } from '../js/buchungen.js';

test('Eigener Eintrag: prüfen und bauen', () => {
  const e = baueRelevant({ betragCent: 450000, datum: '2012-05-03', partner: ' Küchenstudio Muster ', gruppe: '  Haus ', notiz: 'Einbauküche' }, { jetzt: 'T1' });
  assert.equal(e.partner, 'Küchenstudio Muster');
  assert.equal(e.gruppe, 'Haus');
  assert.equal(e.kategorieId, null, 'Kategorie ist optional');
  assert.deepEqual(e.belege, []);
  assert.equal(e.geloeschtAm, null);
  assert.throws(() => baueRelevant({ betragCent: null, datum: '2012-05-03' }), /Betrag/);
  assert.throws(() => baueRelevant({ betragCent: -5, datum: '2012-05-03' }), /ohne Minus/);
  assert.throws(() => baueRelevant({ betragCent: 5, datum: '2012-02-30' }), /Datum/);
  // Bearbeiten: ID, Belege und erstelltAm bleiben
  const neu = baueRelevant({ betragCent: 1, datum: '2013-01-01', notiz: 'Küche' }, { alt: { ...e, belege: [{ id: 'x' }] }, jetzt: 'T2' });
  assert.equal(neu.id, e.id);
  assert.equal(neu.erstelltAm, 'T1');
  assert.deepEqual(neu.belege, [{ id: 'x' }]);
});

test('Häkchen an der Buchung: nur Ausgaben, beim Bearbeiten erhalten', () => {
  const konten = [{ id: 'giro', name: 'Giro', stichtag: '2026-01-01' }];
  const basis = { art: 'ausgabe', betragCent: 100, datum: '2026-10-01', kontoId: 'giro', kategorieId: 'k1', notiz: 'Waschmaschine' };
  const [b] = baueBuchungen({ ...basis, relevant: true, relevantGruppe: ' Garantie ' }, { konten });
  assert.equal(b.relevant, true);
  assert.equal(b.relevantGruppe, 'Garantie');
  const [b2] = baueBuchungen({ ...basis }, { konten, bestehende: [b] });
  assert.equal(b2.relevant, true, 'undefined = unverändert');
  const [e] = baueBuchungen({ ...basis, art: 'einnahme', relevant: true }, { konten });
  assert.equal(e.relevant, false, 'Einnahmen nie');
  assert.equal(istRelevanteBuchung({ ...b, geloeschtAm: 'X' }), false, 'Papierkorb zählt nicht');
});

test('D142: Notiz ist Pflicht bei relevanten Ausgaben', () => {
  assert.throws(() => baueRelevant({ betragCent: 5, datum: '2012-05-03' }), /Notiz Pflicht/);
  assert.throws(() => baueRelevant({ betragCent: 5, datum: '2012-05-03', notiz: '   ' }), /Notiz Pflicht/);
  const konten = [{ id: 'giro', name: 'Giro', stichtag: '2026-01-01' }];
  const basis = { art: 'ausgabe', betragCent: 100, datum: '2026-10-01', kontoId: 'giro', kategorieId: 'k1' };
  assert.throws(() => baueBuchungen({ ...basis, relevant: true }, { konten }), /Notiz Pflicht/);
  // ohne Häkchen bleibt die Notiz freiwillig, Einnahmen sind nie relevant
  assert.equal(baueBuchungen({ ...basis }, { konten })[0].notiz, '');
  assert.equal(baueBuchungen({ ...basis, art: 'einnahme', relevant: true }, { konten })[0].relevant, false);
  // bestehende relevante Buchung ohne Notiz kann nicht ohne Notiz gespeichert werden
  const [alt] = baueBuchungen({ ...basis, relevant: true, notiz: 'Herd' }, { konten });
  assert.throws(() => baueBuchungen({ ...basis }, { konten, bestehende: [alt] }), /Notiz Pflicht/);
});

test('D142: Belegname „JJJJ-MM-TT Notiz“, hochgeladene behalten ihren Namen', () => {
  const liste = [
    { id: 'a', name: '2026-10-01 Muster.jpg' },
    { id: 'b', name: 'scan.PDF' },
    { id: 'c', name: 'alt.pdf', driveId: 'd1' },
    { id: 'd', name: 'ohne-endung', mime: 'application/pdf' },
  ];
  const neu = benenneBelege(liste, '2026-10-05', '  Herd /  Küche ');
  assert.deepEqual(neu.map((b) => b.name), [
    '2026-10-05 Herd - Küche.jpg',
    '2026-10-05 Herd - Küche (2).PDF',
    'alt.pdf',
    '2026-10-05 Herd - Küche (4).pdf',
  ]);
  assert.equal(neu[0].id, 'a');
});

test('Liste: eigene Einträge, markierte Buchungen und Archiv, nach Jahren', () => {
  const relevant = [
    { id: 'r1', datum: '2012-05-03', betragCent: 450000, gruppe: 'Haus', belege: [] },
    { id: 'r2', datum: '2019-03-01', betragCent: 120000, gruppe: 'haus', belege: [] },
    { id: 'r3', datum: '2019-08-01', betragCent: 5000, gruppe: '', geloeschtAm: 'X' },
  ];
  const buchungen = [
    { id: 'b1', datum: '2026-10-20', art: 'ausgabe', betragCent: 95000, relevant: true, relevantGruppe: 'Garantie', kontoId: 'giro' },
    { id: 'b2', datum: '2026-10-21', art: 'ausgabe', betragCent: 100, relevant: false },
    { id: 'b3', datum: '2026-10-22', art: 'einnahme', betragCent: 100, relevant: true },
  ];
  const archivBuchungen = [{ id: 'a1', datum: '2025-04-01', art: 'ausgabe', betragCent: 30000, relevant: true, archivJahr: 2025 }];
  const zeilen = relevanteZeilen({ relevant, buchungen, archivBuchungen });
  assert.deepEqual(zeilen.map((z) => z.id).sort(), ['a1', 'b1', 'r1', 'r2']);
  assert.equal(zeilen.find((z) => z.id === 'b1').quelle, 'buchung');
  assert.equal(zeilen.find((z) => z.id === 'a1').archivJahr, 2025);

  assert.deepEqual(gruppenListe(zeilen), ['Garantie', 'Haus'], 'Groß/klein zusammengefasst');
  assert.deepEqual(filtereGruppe(zeilen, 'HAUS').map((z) => z.id).sort(), ['r1', 'r2']);
  assert.deepEqual(filtereGruppe(zeilen, OHNE_GRUPPE).map((z) => z.id), ['a1']);

  const jahre = nachJahren(zeilen);
  assert.deepEqual(jahre.map((j) => [j.jahr, j.summeCent]), [[2026, 95000], [2025, 30000], [2019, 120000], [2012, 450000]]);
});

test('Beleg-Kopien im Ordner "Relevante Ausgaben"', () => {
  const belege = [
    { id: 'x1', driveId: 'd1' },
    { id: 'x2', driveId: null }, // noch nicht hochgeladen → erst danach kopieren
    { id: 'x3', driveId: 'd3', relevantDriveId: 'k3' },
  ];
  const b = { art: 'ausgabe', relevant: true, belege };
  assert.deepEqual(kopienAufgaben(b).kopieren.map((x) => x.id), ['x1']);
  assert.deepEqual(kopienAufgaben(b).entfernen, []);
  // Häkchen weg oder Papierkorb: Kopien entfernen
  assert.deepEqual(kopienAufgaben({ ...b, relevant: false }).entfernen.map((x) => x.id), ['x3']);
  assert.deepEqual(kopienAufgaben({ ...b, geloeschtAm: 'X' }).entfernen.map((x) => x.id), ['x3']);
  assert.deepEqual(kopienAufgaben({ ...b, relevant: false }).kopieren, []);
});
