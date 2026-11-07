import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortiereKonten, verschiebeKonto, naechsteReihenfolge, startReihenfolge } from '../js/konten.js';
import { migriereDaten } from '../js/migrationen.js';

const k = (id, name, reihenfolge, archiviert = false) => ({ id, name, reihenfolge, archiviert });

test('Sortieren: eigene Reihenfolge, archivierte zuletzt, ohne Nummer ans Ende (D84)', () => {
  const konten = [k('a', 'Anton', 2), k('b', 'Berta', 0), k('c', 'Cäsar', 1), k('x', 'Alt', 0, true), k('n', 'Neu', undefined)];
  assert.deepEqual(sortiereKonten(konten).map((x) => x.id), ['b', 'c', 'a', 'n', 'x']);
  assert.equal(naechsteReihenfolge(konten), 3);
  assert.equal(naechsteReihenfolge([]), 0);
});

test('Verschieben mit ▲/▼: nur geänderte Konten zurück', () => {
  const konten = [k('a', 'A', 0), k('b', 'B', 1), k('c', 'C', 2), k('x', 'X', 3, true)];
  const runter = verschiebeKonto(konten, 'a', 1, 'T');
  assert.deepEqual(runter.map((x) => [x.id, x.reihenfolge]).sort(), [['a', 1], ['b', 0]]);
  assert.equal(runter[0].geaendertAm, 'T');
  assert.deepEqual(verschiebeKonto(konten, 'a', -1), [], 'oberstes Konto kann nicht weiter hoch');
  assert.deepEqual(verschiebeKonto(konten, 'c', 1), [], 'unterstes aktives Konto kann nicht weiter runter');
  assert.deepEqual(verschiebeKonto(konten, 'x', -1), [], 'archivierte Konten werden nicht verschoben');
  // Fehlende/doppelte Nummern werden dabei aufgeräumt
  const unordentlich = [k('a', 'A', 5), k('b', 'B', 5), k('c', 'C', undefined)];
  const r = verschiebeKonto(unordentlich, 'c', -1);
  const neu = sortiereKonten(unordentlich.map((x) => r.find((y) => y.id === x.id) ?? x));
  assert.deepEqual(neu.map((x) => [x.id, x.reihenfolge]), [['a', 0], ['c', 1], ['b', 2]]);
});

test('Migration auf Version 11: Start alphabetisch, archivierte zuletzt', () => {
  assert.deepEqual([...startReihenfolge([k('z', 'Zeta'), k('a', 'Alpha', undefined, true), k('m', 'Mitte')])], [['m', 0], ['z', 1], ['a', 2]]);
  const { daten } = migriereDaten({ version: 10, konten: [k('z', 'Zeta'), k('m', 'Mitte'), k('f', 'Fest', 7)], kategorien: [] });
  assert.deepEqual(daten.konten.map((x) => [x.id, x.reihenfolge]), [['z', 2], ['m', 1], ['f', 7]], 'vorhandene Nummer bleibt');
});
