// D108: Vorschau vor dem Wiederherstellen eines Backups. Nur erfundene Testdaten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { standUebersicht, vergleiche } from '../js/datensicherung.js';

const konto = { id: 'giro', name: 'Giro (Test)', anfangssaldoCent: 100000, stichtag: '2026-01-01', reihenfolge: 0 };
const b = (id, datum, art, cent, extra = {}) => ({ id, datum, art, betragCent: cent, kontoId: 'giro', erstelltAm: `${datum}T08:00:00Z`, ...extra });

test('Kennzahlen eines Stands: Umbuchung einmal, Papierkorb getrennt, Stand bis heute', () => {
  const daten = {
    konten: [konto, { id: 'alt', name: 'Alt', archiviert: true, anfangssaldoCent: 0, stichtag: '2026-01-01' }],
    buchungen: [
      b('1', '2026-10-01', 'einnahme', 50000),
      b('2', '2026-10-05', 'ausgabe', 20000),
      b('3a', '2026-10-06', 'umbuchung', 1000, { richtung: 'ab', gegenkontoId: 'alt' }),
      b('3b', '2026-10-06', 'umbuchung', 1000, { richtung: 'zu', kontoId: 'alt', gegenkontoId: 'giro' }),
      b('4', '2026-10-07', 'ausgabe', 999, { geloeschtAm: '2026-10-08T00:00:00Z' }),
      b('5', '2026-12-24', 'ausgabe', 5000),
    ],
    budgets: [{}],
  };
  const s = standUebersicht(daten, '2026-11-09');
  assert.equal(s.buchungen, 4, '1, 2, Umbuchung einmal, 5');
  assert.equal(s.papierkorb, 1);
  assert.equal(s.letzteBuchung, '2026-12-24');
  assert.deepEqual(s.konten, [{ id: 'giro', name: 'Giro (Test)', standCent: 100000 + 50000 - 20000 - 1000 }], 'nur aktive Konten, Stand bis heute');
  assert.equal(s.budgets, 1);
  assert.equal(s.wiederkehrend, 0, 'fehlende Sammlung = 0');
});

test('Vergleich markiert Unterschiede, Konten nur auf einer Seite mit „–“', () => {
  const jetzt = standUebersicht({ konten: [konto], buchungen: [b('1', '2026-10-01', 'ausgabe', 100)] }, '2026-11-09');
  const backup = standUebersicht({ konten: [konto, { ...konto, id: 'tg', name: 'TG', reihenfolge: 1 }], buchungen: [] }, '2026-11-09');
  const zeilen = vergleiche(jetzt, backup, { euro: (c) => `${c / 100} €` });
  const z = (text) => zeilen.find((x) => x.text === text);
  assert.deepEqual(z('Buchungen'), { text: 'Buchungen', jetzt: '1', backup: '0', anders: true });
  assert.equal(z('Letzte Buchung vom').backup, '–');
  assert.equal(z('Budgets').anders, false);
  assert.deepEqual(z('Stand TG'), { text: 'Stand TG', jetzt: '–', backup: '1000 €', anders: true });
});
