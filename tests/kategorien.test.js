// D93: Unterkategorien zwischen Hauptkategorien gleicher Art verschieben. Nur erfundene Testdaten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moeglicheZiele, verschiebeUnterkategorie } from '../js/kategorien.js';
import { budgetFuerMonat, monatsprognose } from '../js/prognose.js';
import { baueBuchungen } from '../js/buchungen.js';

const kategorien = [
  { id: 'frei', name: 'Freizeit', elternId: null, art: 'ausgabe' },
  { id: 'liefer', name: 'Lieferdienst', elternId: 'frei', art: null },
  { id: 'lebensm', name: 'Lebensmittel', elternId: null, art: 'ausgabe' },
  { id: 'super', name: 'Supermarkt', elternId: 'lebensm', art: null },
  { id: 'alt', name: 'Altes', elternId: null, art: 'ausgabe', archiviert: true },
  { id: 'eink', name: 'Einkommen', elternId: null, art: 'einnahme' },
  { id: 'gehalt', name: 'Gehalt', elternId: 'eink', art: null },
];
const liefer = kategorien[1];

test('Mögliche Ziele: gleiche Art, nicht archiviert, nicht die eigene', () => {
  assert.deepEqual(moeglicheZiele(liefer, kategorien).map((k) => k.id), ['lebensm']);
  assert.deepEqual(moeglicheZiele(kategorien[6], kategorien).map((k) => k.id), [], 'keine zweite Einnahmen-Kategorie');
});

test('Verschieben ändert nur die Hauptkategorie', () => {
  const neu = verschiebeUnterkategorie(liefer, 'lebensm', kategorien, 'T');
  assert.deepEqual(neu, { ...liefer, elternId: 'lebensm', geaendertAm: 'T' });
});

test('Verschieben: Prüfungen', () => {
  assert.throws(() => verschiebeUnterkategorie(liefer, 'eink', kategorien), /gleicher Art/);
  assert.throws(() => verschiebeUnterkategorie(liefer, 'alt', kategorien), /archiviert/);
  assert.throws(() => verschiebeUnterkategorie(liefer, 'frei', kategorien), /schon zu dieser/);
  assert.throws(() => verschiebeUnterkategorie(liefer, 'super', kategorien), /Hauptkategorie wählen/);
  assert.throws(() => verschiebeUnterkategorie(kategorien[0], 'lebensm', kategorien), /Nur Unterkategorien/);
  const mitDoppelt = [...kategorien, { id: 'liefer2', name: 'lieferdienst ', elternId: 'lebensm' }];
  assert.throws(() => verschiebeUnterkategorie(liefer, 'lebensm', mitDoppelt), /gibt es „Lieferdienst“ schon/);
});

test('Nach dem Verschieben verbrauchen die Buchungen das Budget der neuen Hauptkategorie', () => {
  const konten = [{ id: 'giro', name: 'Giro', anfangssaldoCent: 0, stichtag: '2026-01-01', mindestsaldoCent: null }];
  const buchungen = baueBuchungen({ art: 'ausgabe', betragCent: 3000, datum: '2026-11-03', kontoId: 'giro', kategorieId: 'liefer', status: 'gebucht', notiz: '' }, { konten });
  const budgets = [{ id: 'b', kategorieId: 'lebensm', kontoId: 'giro', typ: 'wiederkehrend', startMonat: '2026-01', endMonat: null, stufen: [{ ab: '2026-01', betragCent: 40000 }] }];
  assert.equal(budgetFuerMonat(budgets, 'lebensm', '2026-11', 'giro').betragCent, 40000);
  const vorher = monatsprognose({ konten, kategorien, buchungen, budgets, wiederkehrende: [] }, '2026-11-06');
  assert.equal(vorher.jeKonto.get('giro').rest, 40000);
  const verschoben = kategorien.map((k) => (k.id === 'liefer' ? verschiebeUnterkategorie(k, 'lebensm', kategorien) : k));
  const nachher = monatsprognose({ konten, kategorien: verschoben, buchungen, budgets, wiederkehrende: [] }, '2026-11-06');
  assert.equal(nachher.jeKonto.get('giro').rest, 37000);
});
