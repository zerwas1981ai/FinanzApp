import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEuro, formatEuro, centZuEingabe, formatDatum, heuteIso, istGueltigesDatum } from '../js/format.js';

const nbsp = ' ';

test('parseEuro liest deutsche Schreibweisen', () => {
  assert.equal(parseEuro('1234,56'), 123456);
  assert.equal(parseEuro('1.234,56'), 123456);
  assert.equal(parseEuro('1.234.567,8'), 123456780);
  assert.equal(parseEuro('12,5'), 1250);
  assert.equal(parseEuro('12,'), 1200);
  assert.equal(parseEuro('0,01'), 1);
  assert.equal(parseEuro('-250,00'), -25000);
  assert.equal(parseEuro('−250'), -25000);
  assert.equal(parseEuro('+5'), 500);
  assert.equal(parseEuro('100 €'), 10000);
  assert.equal(parseEuro(' 1 234,56 '), 123456);
  assert.equal(parseEuro('-0'), 0);
});

test('parseEuro: Punkt ohne Komma', () => {
  assert.equal(parseEuro('1.234'), 123400);   // Tausenderpunkt
  assert.equal(parseEuro('12.5'), 1250);      // Dezimalpunkt
  assert.equal(parseEuro('1234.56'), 123456);
});

test('parseEuro: leer = null', () => {
  assert.equal(parseEuro(''), null);
  assert.equal(parseEuro('   '), null);
  assert.equal(parseEuro(undefined), null);
});

test('parseEuro lehnt Unsinn ab', () => {
  for (const s of ['abc', '1,2,3', '12,345', '1.23.4', ',5', '1..2', '12-3', '1.2345']) {
    assert.throws(() => parseEuro(s, 'Betrag'), /Betrag/, s);
  }
  assert.throws(() => parseEuro('1.000.000.000,00'));
});

test('formatEuro und centZuEingabe', () => {
  assert.equal(formatEuro(123456), `1.234,56${nbsp}€`);
  assert.equal(formatEuro(-32050), `-320,50${nbsp}€`);
  assert.equal(formatEuro(0), `0,00${nbsp}€`);
  assert.equal(formatEuro(-0), `0,00${nbsp}€`);
  assert.equal(centZuEingabe(123456), '1.234,56');
  assert.equal(parseEuro(centZuEingabe(-150000)), -150000);
});

test('Datum', () => {
  assert.equal(formatDatum('2026-03-01'), '01.03.2026');
  assert.equal(formatDatum(''), '–');
  assert.equal(heuteIso(new Date(2026, 0, 5)), '2026-01-05');
  assert.ok(istGueltigesDatum('2024-02-29'));
  assert.ok(!istGueltigesDatum('2026-02-30'));
  assert.ok(!istGueltigesDatum('05.11.2026'));
});
