import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stabil, gleicherStand, fuehreZusammen, loeseKonflikte, istFrischerStand, backupsZumLoeschen,
} from '../js/sync/zusammenfuehren.js';
import { csvFeld, csvBetrag, buchungenAlsCsv } from '../js/export.js';
import { SAMMLUNGEN } from '../js/db.js';

const leer = () => Object.fromEntries([['version', 8], ...SAMMLUNGEN.map((s) => [s, []])]);
const stand = (buchungen) => ({ ...leer(), buchungen });
const b = (id, betragCent, extra = {}) => ({ id, betragCent, datum: '2026-11-01', ...extra });

test('stabil: Reihenfolge der Schlüssel egal', () => {
  assert.equal(stabil({ b: 1, a: [2, { y: 1, x: 2 }] }), stabil({ a: [2, { x: 2, y: 1 }], b: 1 }));
  assert.ok(gleicherStand(stand([b('1', 5), b('2', 6)]), stand([b('2', 6), b('1', 5)])));
  assert.ok(!gleicherStand(stand([b('1', 5)]), stand([b('1', 6)])));
});

test('Zusammenführen: Änderungen beider Seiten ohne Konflikt', () => {
  const basis = stand([b('a', 100), b('b', 200), b('c', 300), b('d', 400)]);
  const lokal = stand([b('a', 111), b('b', 200), b('d', 400), b('neuL', 1)]); // a geändert, c gelöscht, neu
  const remote = stand([b('a', 100), b('b', 222), b('c', 300), b('neuR', 2)]); // b geändert, d gelöscht, neu
  const { daten, konflikte, aenderungen } = fuehreZusammen(basis, lokal, remote, 8);
  assert.equal(konflikte.length, 0);
  const werte = Object.fromEntries(daten.buchungen.map((x) => [x.id, x.betragCent]));
  assert.deepEqual(werte, { a: 111, b: 222, neuL: 1, neuR: 2 });
  assert.equal(daten.version, 8);
  assert.deepEqual(aenderungen, { vonDrive: 3, vonGeraet: 3 });
});

test('Zusammenführen: Konflikte bei gleichem Eintrag, Auflösung je Eintrag', () => {
  const basis = stand([b('a', 100), b('b', 200)]);
  const lokal = stand([b('a', 111), b('b', 201)]);
  const remote = stand([b('a', 122)]); // a anders geändert, b gelöscht (lokal geändert)
  const { daten, konflikte } = fuehreZusammen(basis, lokal, remote, 8);
  assert.deepEqual(konflikte.map((k) => [k.id, k.lokal?.betragCent, k.remote?.betragCent ?? null]), [['a', 111, 122], ['b', 201, null]]);
  const geloest = loeseKonflikte(daten, konflikte, new Map([['buchungen|a', 'remote'], ['buchungen|b', 'remote']]));
  assert.deepEqual(geloest.buchungen.map((x) => [x.id, x.betragCent]), [['a', 122]], 'remote = gelöscht');
  const lokalGewaehlt = loeseKonflikte(daten, konflikte, new Map());
  assert.deepEqual(lokalGewaehlt.buchungen.map((x) => x.betragCent).sort(), [111, 201]);
});

test('Zusammenführen ohne Basis: nur Unterschiede sind Konflikte', () => {
  const lokal = stand([b('a', 1), b('x', 9)]);
  const remote = stand([b('a', 2), b('y', 8)]);
  const { daten, konflikte } = fuehreZusammen(null, lokal, remote, 8);
  assert.deepEqual(konflikte.map((k) => k.id), ['a']);
  assert.deepEqual(daten.buchungen.map((x) => x.id).sort(), ['a', 'x', 'y']);
});

test('Frischer Stand: nur unveränderter Startsatz', () => {
  const t = '2026-11-01T00:00:00Z';
  const frisch = { ...leer(), kategorien: [{ id: 'k', erstelltAm: t, geaendertAm: t }], einstellungen: [{ id: 'hinweise' }] };
  assert.ok(istFrischerStand(frisch));
  assert.ok(!istFrischerStand({ ...frisch, konten: [{ id: 'g' }] }));
  assert.ok(!istFrischerStand({ ...frisch, kategorien: [{ id: 'k', erstelltAm: t, geaendertAm: '2026-11-02T00:00:00Z' }] }));
});

test('Backups: letzte 30 plus je Tag der letzten 30 Tage', () => {
  const jetzt = new Date('2026-11-06T12:00:00Z');
  const backups = [];
  // 40 Backups heute (jede Minute), dazu je 2 an den letzten 40 Tagen
  for (let i = 0; i < 40; i++) backups.push({ id: `heute${i}`, zeit: `2026-11-06T10:${String(i).padStart(2, '0')}:00.000Z` });
  for (let t = 1; t <= 40; t++) {
    const tag = new Date(jetzt.getTime() - t * 86400000).toISOString().slice(0, 10);
    backups.push({ id: `${tag}-a`, zeit: `${tag}T08:00:00.000Z` }, { id: `${tag}-b`, zeit: `${tag}T20:00:00.000Z` });
  }
  const weg = new Set(backupsZumLoeschen(backups, jetzt).map((x) => x.id));
  const bleiben = backups.filter((x) => !weg.has(x.id));
  // 30 neueste (alle von heute) + je Tag eins für Tag −1 … −30 (Tag −30 liegt genau auf der Grenze)
  assert.equal(bleiben.filter((x) => x.id.startsWith('heute')).length, 30);
  assert.ok(!weg.has('heute39') && weg.has('heute0'));
  const tage = bleiben.filter((x) => !x.id.startsWith('heute'));
  assert.ok(tage.every((x) => x.id.endsWith('-b')), 'je Tag das neueste');
  assert.equal(tage.length, 30);
});

test('CSV für Excel: Felder, Beträge, Buchungen', () => {
  assert.equal(csvFeld('a;b'), '"a;b"');
  assert.equal(csvFeld('sagt "hi"'), '"sagt ""hi"""');
  assert.equal(csvFeld('=SUMME(A1)'), "'=SUMME(A1)");
  assert.equal(csvFeld('-12,30'), '-12,30');
  assert.deepEqual([csvBetrag(123456), csvBetrag(-1230), csvBetrag(5)], ['1234,56', '-12,30', '0,05']);

  const konten = [{ id: 'g', name: 'Giro' }, { id: 't', name: 'Tagesgeld' }];
  const kategorien = [{ id: 'h', name: 'Lebensmittel' }, { id: 'u', name: 'Supermarkt', elternId: 'h' }];
  const csv = buchungenAlsCsv([
    { id: '2', datum: '2026-11-03', art: 'ausgabe', betragCent: 1250, kontoId: 'g', kategorieId: 'u', partner: 'Markt; Muster', notiz: '', status: 'gebucht', belege: [{}] },
    { id: '1', datum: '2026-11-01', art: 'einnahme', betragCent: 100000, kontoId: 'g', kategorieId: 'u', partner: '', notiz: 'Lohn', status: 'vorgemerkt', belege: [] },
    { id: '3a', datum: '2026-11-02', art: 'umbuchung', richtung: 'ab', betragCent: 5000, kontoId: 'g', gegenkontoId: 't', belege: [] },
    { id: '3b', datum: '2026-11-02', art: 'umbuchung', richtung: 'zu', betragCent: 5000, kontoId: 't', gegenkontoId: 'g', belege: [] },
    { id: 'x', datum: '2026-11-04', art: 'ausgabe', betragCent: 1, kontoId: 'g', kategorieId: 'u', geloeschtAm: 'X' },
  ], { konten, kategorien });
  assert.ok(csv.startsWith('﻿Datum;Konto;Art;'));
  const zeilen = csv.trim().split('\r\n');
  assert.equal(zeilen.length, 4, 'Kopf + 3 Buchungen (Umbuchung einmal, Papierkorb nicht)');
  assert.equal(zeilen[1], '01.11.2026;Giro;Einnahme;;Lebensmittel;Supermarkt;1000,00;vorgemerkt;Lohn;;;0');
  assert.equal(zeilen[2], '02.11.2026;Giro;Umbuchung;;;;-50,00;gebucht;;;Tagesgeld;0');
  assert.equal(zeilen[3], '03.11.2026;Giro;Ausgabe;"Markt; Muster";Lebensmittel;Supermarkt;-12,50;gebucht;;;;1');
});
