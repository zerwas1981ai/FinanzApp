import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migriereDaten, DATENMODELL_VERSION } from '../js/migrationen.js';
import { STANDARD_KATEGORIEN, erzeugeStartKategorien } from '../js/startdaten.js';

test('aktueller Stand bleibt unverändert', () => {
  const d = { version: DATENMODELL_VERSION, konten: [], kategorien: [] };
  const { daten, angewendet } = migriereDaten(d);
  assert.deepEqual(daten, d);
  assert.deepEqual(angewendet, []);
});

test('Migrationen laufen der Reihe nach', () => {
  const schritte = [
    { nach: 3, migriere: (d) => { d.konten.forEach((k) => { k.c = k.b * 2; }); return d; } },
    { nach: 2, migriere: (d) => { d.konten.forEach((k) => { k.b = 1; }); return d; } },
  ];
  const original = { version: 1, konten: [{ id: 'x' }] };
  const { daten, angewendet } = migriereDaten(original, schritte, 3);
  assert.equal(daten.version, 3);
  assert.deepEqual(daten.konten[0], { id: 'x', b: 1, c: 2 });
  assert.deepEqual(angewendet, [2, 3]);
  assert.equal(original.version, 1, 'Original darf nicht verändert werden');
});

test('fehlende Migration und neuere Daten werden abgelehnt', () => {
  assert.throws(() => migriereDaten({ version: 1 }, [], 2), /fehlt/);
  assert.throws(() => migriereDaten({ version: 99 }), /neueren App-Version/);
  assert.throws(() => migriereDaten({}), /Versionsnummer/);
});

test('Startsatz: jede Hauptkategorie hat Art und Unterkategorien', () => {
  for (const k of STANDARD_KATEGORIEN) {
    assert.ok(['einnahme', 'ausgabe'].includes(k.art), k.name);
    assert.ok(k.unter.length > 0, k.name);
  }
  const liste = erzeugeStartKategorien();
  const haupt = liste.filter((k) => !k.elternId);
  assert.equal(haupt.length, STANDARD_KATEGORIEN.length);
  for (const u of liste.filter((k) => k.elternId)) {
    assert.ok(haupt.some((h) => h.id === u.elternId));
    assert.equal(u.art, null);
  }
});
