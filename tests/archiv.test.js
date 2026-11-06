import { test } from 'node:test';
import assert from 'node:assert/strict';
import { naechstesArchivJahr, archiviere, holeZurueck, letztesArchiv, archivKostenVon } from '../js/archiv.js';
import { kontostand } from '../js/rechnen.js';
import { baueBuchungen } from '../js/buchungen.js';

const giro = { id: 'giro', name: 'Giro', anfangssaldoCent: 100000, stichtag: '2025-03-01', mindestsaldoCent: null };
const tg = { id: 'tg', name: 'TG', anfangssaldoCent: 0, stichtag: '2025-03-01', mindestsaldoCent: null };
const neu = { id: 'neu', name: 'Neu', anfangssaldoCent: 500, stichtag: '2026-02-01', mindestsaldoCent: null };
const konten = [giro, tg, neu];
const b = (e) => baueBuchungen({ status: 'gebucht', kontoId: 'giro', kategorieId: 'k', ...e }, { konten })[0 + 0];
const alle = (e) => baueBuchungen({ status: 'gebucht', kontoId: 'giro', kategorieId: 'k', ...e }, { konten });

const stand = () => {
  const buchungen = [
    b({ art: 'ausgabe', betragCent: 2000, datum: '2025-05-01', projektId: 'p', geplantId: 'g1' }),
    b({ art: 'einnahme', betragCent: 50000, datum: '2025-12-31' }),
    ...alle({ art: 'umbuchung', betragCent: 10000, datum: '2025-07-01', gegenkontoId: 'tg' }),
    b({ art: 'ausgabe', betragCent: 300, datum: '2026-01-02' }),
  ];
  return {
    version: 9, konten, kategorien: [], buchungen, abstimmungen: [{ id: 'a1', kontoId: 'giro', datum: '2025-10-01' }, { id: 'a2', kontoId: 'giro', datum: '2026-01-05' }],
    geplant: [{ id: 'g1', datum: '2025-05-01', erledigtAm: null }, { id: 'g2', datum: '2025-06-01', erledigtAm: null }],
    projekte: [{ id: 'p', name: 'P' }], archive: [],
  };
};

test('Archiv: welches Jahr, Hindernis Papierkorb', () => {
  const d = stand();
  assert.deepEqual(naechstesArchivJahr(d, '2026-11-06'), { jahr: 2025, anzahl: 3, hindernis: null });
  assert.equal(naechstesArchivJahr(d, '2025-12-01'), null, 'laufendes Jahr nicht');
  d.buchungen.push({ ...d.buchungen[0], id: 'x', geloeschtAm: 'X' });
  assert.match(naechstesArchivJahr(d, '2026-11-06').hindernis, /Papierkorb/);
});

test('Archiv: Jahr archivieren – Kontostände bleiben gleich', () => {
  const d = stand();
  const vorher = Object.fromEntries(konten.map((k) => [k.id, kontostand(k, d.buchungen, '2026-12-31')]));
  const { daten, inhalt, eintrag } = archiviere(d, 2025, 'T');
  assert.equal(inhalt.buchungen.length, 4, 'inkl. beider Umbuchungshälften');
  assert.deepEqual(daten.buchungen.map((x) => x.datum), ['2026-01-02']);
  assert.deepEqual(daten.abstimmungen.map((a) => a.id), ['a2']);
  const g = daten.konten.find((k) => k.id === 'giro');
  assert.deepEqual([g.stichtag, g.anfangssaldoCent], ['2026-01-01', 100000 - 2000 + 50000 - 10000]);
  assert.equal(daten.konten.find((k) => k.id === 'tg').anfangssaldoCent, 10000);
  assert.equal(daten.konten.find((k) => k.id === 'neu').stichtag, '2026-02-01', 'späteres Konto unverändert');
  for (const k of daten.konten) assert.equal(kontostand(k, daten.buchungen, '2026-12-31'), vorher[k.id]);
  assert.equal(daten.geplant.find((x) => x.id === 'g1').erledigtAm, 'T');
  assert.equal(daten.geplant.find((x) => x.id === 'g2').erledigtAm, null);
  assert.deepEqual(eintrag.projekte, { p: 2000 });
  assert.equal(eintrag.anzahlBuchungen, 3);
  assert.equal(archivKostenVon('p', daten.archive), 2000);
  assert.equal(letztesArchiv(daten).jahr, 2025);
});

test('Archiv: zurückholen ergibt den alten Stand', () => {
  const d = stand();
  const { daten, inhalt, eintrag } = archiviere(d, 2025, 'T');
  const zurueck = holeZurueck(daten, eintrag, inhalt, 'U');
  assert.equal(zurueck.buchungen.length, d.buchungen.length);
  assert.deepEqual(zurueck.konten.map((k) => [k.id, k.anfangssaldoCent, k.stichtag]), konten.map((k) => [k.id, k.anfangssaldoCent, k.stichtag]));
  assert.equal(zurueck.geplant.find((x) => x.id === 'g1').erledigtAm, null);
  assert.equal(zurueck.abstimmungen.length, 2);
  assert.deepEqual(zurueck.archive, []);
  // Nur das letzte Archiv lässt sich zurückholen
  const zwei = { ...daten, archive: [...daten.archive, { id: 'archiv-2026', jahr: 2026 }] };
  assert.throws(() => holeZurueck(zwei, eintrag, inhalt), /zuletzt archivierte/);
});
