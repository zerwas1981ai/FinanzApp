// Tests zu D228 (Konto-Farben) – nur erfundene Testdaten
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BANK_FARBEN, kontoFarbe, schriftAuf } from '../js/farben.js';
import { migriereDaten } from '../js/migrationen.js';

test('D228: Konto ohne Farbe hat keine Konto-Farbe', () => {
  assert.equal(kontoFarbe({ id: 'k1', name: 'Girokonto' }), null);
  assert.equal(kontoFarbe({ id: 'k1', name: 'Girokonto', farbe: null }), null);
  assert.equal(kontoFarbe({ id: 'k1', name: 'Girokonto', farbe: 'gibt-es-nicht' }), null);
  assert.equal(kontoFarbe(undefined), null);
});

test('D228: Bankfarben und Palettenfarben werden erkannt', () => {
  assert.equal(BANK_FARBEN.length, 4);
  const n26 = kontoFarbe({ farbe: 'bank-n26' });
  assert.equal(n26.schluessel, 'bank-n26');
  assert.match(n26.hex, /^#[0-9a-f]{6}$/);
  const blau = kontoFarbe({ farbe: 'blau-4' });
  assert.equal(blau.schluessel, 'blau-4');
});

test('D228: Schrift auf dem Etikett – Weiß auf kräftigen, dunkel auf hellen Farben', () => {
  for (const b of BANK_FARBEN) assert.equal(schriftAuf(b.hex), '#ffffff', b.name);
  assert.equal(schriftAuf('#000000'), '#ffffff');
  assert.equal(schriftAuf('#ffffff'), '#1a1d23');
  assert.equal(schriftAuf('#ede7c0'), '#1a1d23'); // Gelb 1
  assert.equal(kontoFarbe({ farbe: 'weiss' }).schrift, '#1a1d23');
});

test('D228: Migration auf Version 25 – Konten bekommen farbe = null, gewählte Farben bleiben', () => {
  const { daten: d } = migriereDaten({
    version: 24, kategorien: [],
    konten: [{ id: 'a', name: 'Girokonto' }, { id: 'b', name: 'Tagesgeld', farbe: 'bank-n26' }],
  });
  assert.equal(d.version, 25);
  assert.equal(d.konten[0].farbe, null);
  assert.equal(d.konten[1].farbe, 'bank-n26');
});
