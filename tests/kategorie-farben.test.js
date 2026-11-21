// Tests zu D155/D159 (Kategorie-Farben), D158 und D237 – nur erfundene Testdaten
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PALETTE, farbenZuordnung, farbeVon, paletteEintrag, namensFarbe } from '../js/farben.js';
import { monatKurz, monatLang } from '../js/format.js';
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

test('D158: Migration auf 20 entfernt die Sparziele wieder', () => {
  const { daten } = migriereDaten({ version: 19, vertraege: [], sparziele: [{ id: 'z' }] }, undefined, 20);
  assert.equal(daten.sparziele, undefined);
  assert.equal(daten.version, 20);
});

test('D237: Monatsnamen kurz und lang', () => {
  assert.equal(monatKurz('2026-03'), 'Mär 26');
  assert.equal(monatLang('2026-12'), 'Dezember 2026');
});
