// Tests zu D155/D156 (Kategorie-Farben, Rückblick) und D158 – nur erfundene Testdaten
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PALETTE, farbenZuordnung, farbeVon, paletteEintrag, namensFarbe } from '../js/farben.js';
import { monatsRueckblick, jahresRueckblick, waehlbareZeitraeume, plusMonat, monatKurz } from '../js/rueckblick.js';
import { migriereDaten } from '../js/migrationen.js';

test('D159: 80 Farben, automatische Wahl passend zum Namen, Einnahmen ohne Farbe', () => {
  assert.equal(PALETTE.length, 80);
  assert.equal(new Set(PALETTE.map((p) => p.hex)).size, 80, 'alle Farben verschieden');
  assert.deepEqual(PALETTE.filter((p) => p.grau).map((p) => p.schluessel)[0], 'weiss');
  assert.equal(paletteEintrag('schwarz').hex, '#000000');
  const kategorien = [
    { id: 'h1', name: 'Wohnen', art: 'ausgabe', erstelltAm: '2026-01-01' },
    { id: 'h2', name: 'Freizeit', art: 'ausgabe', erstelltAm: '2026-01-02', farbe: 'bernstein-4' },
    { id: 'h3', name: 'Mobilität', art: 'ausgabe', erstelltAm: '2026-01-03' },
    { id: 'h4', name: 'Haustier (Test)', art: 'ausgabe', erstelltAm: '2026-01-04' },
    { id: 'h5', name: 'Urlaubskasse', art: 'ausgabe', erstelltAm: '2026-01-05' },
    { id: 'h6', name: 'Zzz', art: 'ausgabe', erstelltAm: '2026-01-06' },
    { id: 'e1', name: 'Einkommen', art: 'einnahme', erstelltAm: '2025-12-01', farbe: 'rot-4' },
    { id: 'u1', name: 'Miete', elternId: 'h1', art: 'ausgabe' },
  ];
  const z = farbenZuordnung(kategorien);
  assert.equal(z.get('h2').schluessel, 'bernstein-4', 'selbst gewählt');
  assert.equal(z.get('h1').schluessel, 'bernstein-3', 'Wunschfarbe vergeben → gleicher Ton, Nachbarstufe');
  assert.equal(z.get('h3').schluessel, 'blau-4');
  assert.equal(z.get('h4').schluessel, 'limette-4', 'Haustier nicht als Wohnen');
  assert.equal(z.get('h5').schluessel, 'orange-3', 'Urlaub → Freizeit-Farbe');
  assert.equal(z.get('h6').schluessel, 'gruen-4', 'ohne Stichwort: erste freie Reservefarbe (Blau ist vergeben)');
  assert.equal(z.has('e1'), false, 'Einnahmen ohne Farbe');
  assert.equal(namensFarbe('Sonstiges'), 'grau-4');
  assert.equal(namensFarbe('Gesundheit & Pflege'), 'tuerkis-4');
  const katMap = new Map(kategorien.map((k) => [k.id, k]));
  assert.equal(farbeVon('u1', katMap, z), z.get('h1').hex);
  // Neue Kategorie verschiebt die bestehenden nicht
  const z2 = farbenZuordnung([...kategorien, { id: 'h7', name: 'Neu', art: 'ausgabe', erstelltAm: '2026-05-01' }]);
  assert.equal(z2.get('h6').schluessel, 'gruen-4');
  // Schlüssel früherer Paletten bleiben gültig
  assert.equal(paletteEintrag('pink').schluessel, 'magenta-4');
  assert.equal(paletteEintrag('blau-hell').schluessel, 'blau-2');
  assert.equal(paletteEintrag('rot-dunkel').schluessel, 'rot-5');
});

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

test('D158: Migration auf 20 entfernt die Sparziele wieder', () => {
  const { daten } = migriereDaten({ version: 19, vertraege: [], sparziele: [{ id: 'z' }] }, undefined, 20);
  assert.equal(daten.sparziele, undefined);
  assert.equal(daten.version, 20);
});
