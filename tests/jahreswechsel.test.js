// Tests zu D239 (Jahreswechsel-Check) – nur erfundene Testdaten
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jahreswechselJahr, jahreswechselPruefung, jahreswechselStand, hakenUmschalten, alsErledigt } from '../js/jahreswechsel.js';

test('D239: Zeitfenster 15.12. bis 31.01.', () => {
  assert.equal(jahreswechselJahr('2026-12-14'), null);
  assert.equal(jahreswechselJahr('2026-12-15'), 2027);
  assert.equal(jahreswechselJahr('2026-12-31'), 2027);
  assert.equal(jahreswechselJahr('2027-01-01'), 2027);
  assert.equal(jahreswechselJahr('2027-01-31'), 2027);
  assert.equal(jahreswechselJahr('2027-02-01'), null);
});

const kategorien = [{ id: 'leb', name: 'Lebensmittel' }, { id: 'frei', name: 'Freizeit' }, { id: 'urlaub', name: 'Urlaub' }];
const konten = [{ id: 'giro', name: 'Giro (Test)' }];

test('D239: Budgets ohne Nachfolger, Kündigungsfristen, Archiv', () => {
  const daten = {
    kategorien, konten,
    budgets: [
      { id: 'b1', typ: 'wiederkehrend', kategorieId: 'leb', kontoId: 'giro', startMonat: '2026-01', endMonat: '2026-12' },
      { id: 'b2', typ: 'wiederkehrend', kategorieId: 'frei', kontoId: 'giro', startMonat: '2026-01', endMonat: '2026-12' },
      { id: 'b3', typ: 'wiederkehrend', kategorieId: 'frei', kontoId: 'giro', startMonat: '2027-01', endMonat: null },
      { id: 'b4', typ: 'jaehrlich', kategorieId: 'urlaub', kontoId: 'giro', startJahr: 2026, endJahr: 2026 },
      { id: 'b5', typ: 'wiederkehrend', kategorieId: 'leb', kontoId: 'giro', startMonat: '2025-01', endMonat: '2025-12' },
    ],
    vertraege: [
      { id: 'v1', name: 'Fitness (Test)', beginn: '2025-02-01', mindestlaufzeitMonate: 12, verlaengerungMonate: 12, fristAnzahl: 1, fristEinheit: 'monate' },
      { id: 'v2', name: 'Handy (Test)', beginn: '2025-07-01', mindestlaufzeitMonate: 24, verlaengerungMonate: 12, fristAnzahl: 1, fristEinheit: 'monate' },
    ],
    buchungen: [{ id: 'a', art: 'ausgabe', datum: '2025-05-01', betragCent: 100 }, { id: 'b', art: 'ausgabe', datum: '2026-05-01', betragCent: 100 }],
  };
  const p = jahreswechselPruefung(daten, 2027, '2026-12-20');
  assert.deepEqual(p.map((x) => [x.id, x.ok]), [['budgets', false], ['vertraege', false], ['preise', false], ['archiv', false], ['sicherung', false]]);
  assert.equal(p[0].text, 'Endet mit 2026: Lebensmittel (Giro (Test)), Urlaub (Giro (Test))', 'Freizeit hat einen Nachfolger, 2025 ist schon vorbei');
  assert.equal(p[1].text, 'Fitness (Test) bis 31.12.', 'Handy erst 2027-06 – nicht im 1. Quartal');
  assert.match(p[3].text, /^2025 kann archiviert werden/);
  assert.ok(p[2].hand && p[4].hand);

  const leer = jahreswechselPruefung({ kategorien, konten, budgets: [], vertraege: [], buchungen: [] }, 2027, '2026-12-20', ['preise', 'sicherung']);
  assert.ok(leer.every((x) => x.ok));
});

test('D239: Haken und Erledigt speichern', () => {
  const a = hakenUmschalten(null, 2027, 'preise', 'T1');
  assert.deepEqual(a, { id: 'jahreswechsel', erledigt: [], haken: { 2027: ['preise'] }, geaendertAm: 'T1' });
  const b = hakenUmschalten(hakenUmschalten(a, 2027, 'sicherung', 'T2'), 2027, 'preise', 'T3');
  assert.deepEqual(b.haken[2027], ['sicherung']);
  assert.deepEqual(hakenUmschalten(b, 2028, 'preise').haken, { 2028: ['preise'] }, 'altes Jahr wird aufgeräumt');
  assert.throws(() => hakenUmschalten(null, 2027, 'archiv'), /automatisch/);
  const e = alsErledigt(b, 2027, 'T4');
  assert.deepEqual(jahreswechselStand([e], 2027), { erledigt: true, haken: ['sicherung'] });
  assert.deepEqual(jahreswechselStand([], 2027), { erledigt: false, haken: [] });
});
