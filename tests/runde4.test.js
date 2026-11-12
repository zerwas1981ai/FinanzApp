// Tests zu D165–D168 (Monatsnotiz, Preisentwicklung, Notfall) – erfundene Daten
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baueMonatsnotiz } from '../js/monatsnotizen.js';
import { preisVerlauf } from '../js/vertraege.js';
import { notfallDaten } from '../js/notfall.js';
import { baueBuchungen } from '../js/buchungen.js';
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
  assert.equal(daten.version, 23);
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

test('D166: Preisentwicklung je Jahr', () => {
  const b = (datum, cent, extra = {}) => ({ datum, betragCent: cent, art: 'ausgabe', ...extra });
  const v = preisVerlauf([b('2025-03-05', 3499), b('2025-04-05', 3499), b('2026-03-05', 3999), b('2026-04-05', 3999),
    b('2026-05-05', 500, { art: 'einnahme' }), b('2026-06-05', 9999, { geloeschtAm: 'X' })]);
  assert.deepEqual(v.map((x) => [x.jahr, x.anzahl, x.schnittCent]), [[2025, 2, 3499], [2026, 2, 3999]]);
  assert.equal(v[0].veraenderung, null);
  assert.ok(Math.abs(v[1].veraenderung - 500 / 3499) < 1e-9);
});

test('D168: Notfall-Mappe stellt Konten, Verträge und Zahlungen zusammen', () => {
  const konten = [{ id: 'giro', name: 'Giro (Test)', anfangssaldoCent: 100000, stichtag: '2026-01-01', reihenfolge: 0 },
    { id: 'alt', name: 'Alt', archiviert: true, anfangssaldoCent: 0, stichtag: '2026-01-01' }];
  const d = notfallDaten({
    konten,
    buchungen: [{ id: 'b', kontoId: 'giro', art: 'ausgabe', betragCent: 2000, datum: '2026-02-01' }],
    abstimmungen: [{ kontoId: 'giro', datum: '2026-10-31' }, { kontoId: 'giro', datum: '2026-09-30' }],
    vertraege: [{ id: 'v', name: 'Internet', anbieter: 'Telefon AG', vertragsnummer: 'T-1', fristAnzahl: 1, fristEinheit: 'monate' },
      { id: 'v2', name: 'Alt', gekuendigtZum: '2025-01-31' }],
    wiederkehrend: [{ id: 'w', vertragId: 'v', art: 'ausgabe', kontoId: 'giro', partner: 'Telefon AG', intervall: 'monatlich', stufen: [{ ab: '2026-01-01', betragCent: 3999 }] },
      { id: 'w2', art: 'einnahme', kontoId: 'giro', partner: 'Muster GmbH', intervall: 'monatlich', stufen: [{ ab: '2026-01-01', betragCent: 300000 }] },
      { id: 'w3', art: 'ausgabe', kontoId: 'giro', partner: 'Aus', intervall: 'monatlich', stufen: [{ ab: '2026-01-01', betragCent: 1 }], aktiv: false }],
    heute: '2026-11-12',
  });
  assert.deepEqual(d.konten, [{ name: 'Giro (Test)', standCent: 98000, abgestimmtAm: '2026-10-31' }]);
  assert.equal(d.vertraege.length, 1, 'beendete Verträge fehlen');
  assert.equal(d.vertraege[0].monatCent, 3999);
  assert.equal(d.vertraege[0].ende, 'jederzeit kündbar');
  assert.deepEqual(d.zahlungen.map((z) => z.text), ['Muster GmbH', 'Telefon AG'], 'Einnahmen zuerst, ausgeschaltete fehlen');
});
