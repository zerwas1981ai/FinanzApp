// Tests zu D165 (Monatsnotiz) und zu ausgebauten Teilen (D169, D172, D236) – erfundene Daten
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baueMonatsnotiz } from '../js/monatsnotizen.js';
import { migriereDaten } from '../js/migrationen.js';

test('D169: Migration auf 22 entfernt Frei-verfügbar- und Steuer-Felder', () => {
  const { daten } = migriereDaten({ version: 21, konten: [{ id: 'k', freiVerfuegbar: false }], kategorien: [{ id: 'u', steuerthema: 'spenden' }],
    buchungen: [{ id: 'b', steuerthema: 'kein' }] }, undefined, 22);
  assert.deepEqual([daten.konten[0], daten.kategorien[0], daten.buchungen[0]], [{ id: 'k' }, { id: 'u' }, { id: 'b' }]);
  assert.equal(daten.version, 22);
});

test('D172: Migration auf 23 entfernt die Vorlagen', () => {
  const { daten } = migriereDaten({ version: 22, vorlagen: [{ id: 'v' }] });
  assert.equal(daten.vorlagen, undefined);
  assert.equal(daten.version, 27);
});

test('D165: Monatsnotiz bauen', () => {
  assert.deepEqual(baueMonatsnotiz('2026-10', '  Autoreparatur,   deshalb hoch ', { jetzt: 'T' }), { id: '2026-10', text: 'Autoreparatur, deshalb hoch', erstelltAm: 'T', geaendertAm: 'T' });
  assert.equal(baueMonatsnotiz('2026-10', '   '), null, 'leer = löschen');
  assert.throws(() => baueMonatsnotiz('2026-13', 'x'), /Monat/);
  assert.equal(baueMonatsnotiz('2026-10', 'neu', { alt: { erstelltAm: 'A' }, jetzt: 'B' }).erstelltAm, 'A');
  const { daten } = migriereDaten({ version: 20 }, undefined, 21);
  assert.deepEqual(daten.monatsnotizen, []);
  assert.equal(daten.version, 21);
});

test('D236: Migration auf 27 entfernt die Hinweise der Notfall-Mappe', () => {
  const { daten } = migriereDaten({ version: 26, einstellungen: [{ id: 'hinweise' }, { id: 'notfall', text: 'Testtext' }] }, undefined, 27);
  assert.deepEqual(daten.einstellungen, [{ id: 'hinweise' }]);
  assert.equal(daten.version, 27);
});
