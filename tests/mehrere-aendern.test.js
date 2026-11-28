// Tests zu D260: mehrere Buchungen auf einmal ändern – nur erfundene Testdaten
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baueBuchungen, mehrereAendern, aufrundungAnpassen, ausgleichAnpassen } from '../js/buchungen.js';

const konten = [
  { id: 'giro', name: 'Giro (Test)', stichtag: '2026-01-01' },
  { id: 'paypal', name: 'PayPal (Test)', stichtag: '2026-01-01' },
  { id: 'spar', name: 'Sparen (Test)', stichtag: '2026-01-01' },
  { id: 'neu', name: 'Neues Konto (Test)', stichtag: '2026-06-01' },
];
const kategorien = [
  { id: 'leb', elternId: null, art: 'ausgabe', name: 'Lebensmittel' }, { id: 'super', elternId: 'leb', name: 'Supermarkt' },
  { id: 'frei', elternId: null, art: 'ausgabe', name: 'Freizeit' }, { id: 'kino', elternId: 'frei', name: 'Kino' },
  { id: 'ein', elternId: null, art: 'einnahme', name: 'Einkommen' }, { id: 'gehalt', elternId: 'ein', name: 'Gehalt' },
];
const buchung = (id, art, betragCent, extra = {}) => baueBuchungen({
  art, betragCent, datum: '2026-03-10', kontoId: 'giro', kategorieId: art === 'einnahme' ? 'gehalt' : 'super', partner: `Partner ${id}`, ...extra,
}, { konten, jetzt: 'T0' }).map((x, i) => (i === 0 ? { ...x, id } : x));

test('D260: Kategorie für mehrere Buchungen – andere Art, Umbuchung, Papierkorb, Archiv werden übersprungen', () => {
  const a = buchung('a', 'ausgabe', 1000, { notiz: 'Wocheneinkauf' })[0];
  const b = buchung('b', 'ausgabe', 2000)[0];
  const e = buchung('e', 'einnahme', 300000)[0];
  const [u1, u2] = baueBuchungen({ art: 'umbuchung', betragCent: 500, datum: '2026-03-10', kontoId: 'giro', gegenkontoId: 'spar' }, { konten });
  const weg = { ...buchung('weg', 'ausgabe', 50)[0], geloeschtAm: 'X' };
  const archiv = { ...buchung('alt', 'ausgabe', 70)[0], archivJahr: 2025 };
  const schon = buchung('schon', 'ausgabe', 90, { kategorieId: 'kino' })[0];
  const alle = [a, b, e, u1, u2, weg, archiv, schon];

  const r = mehrereAendern(['a', 'b', 'e', u1.id, 'weg', 'alt', 'schon'], { kategorieId: 'kino' }, { alle, konten, kategorien, jetzt: 'T1' });
  assert.equal(r.anzahl, 2);
  assert.deepEqual(r.geaendert.map((x) => [x.id, x.kategorieId, x.geaendertAm]), [['a', 'kino', 'T1'], ['b', 'kino', 'T1']]);
  assert.equal(r.geaendert[0].notiz, 'Wocheneinkauf', 'alles andere bleibt');
  assert.equal(r.geaendert[0].erstelltAm, a.erstelltAm);
  assert.deepEqual(r.vorher.map((x) => x.kategorieId), ['super', 'super'], 'für „Rückgängig“');
  assert.deepEqual(r.uebersprungen.map((x) => [x.buchung.id, x.grund]),
    [['e', 'Einnahme'], [u1.id, 'Umbuchung'], ['weg', 'im Papierkorb'], ['alt', 'archiviert'], ['schon', 'schon so']]);
  assert.throws(() => mehrereAendern(['a'], { kategorieId: 'leb' }, { alle, konten, kategorien }), /Unterkategorie/);
});

test('D260: Konto für mehrere Buchungen – Stichtag wird geprüft', () => {
  const a = buchung('a', 'ausgabe', 1000)[0];
  const e = buchung('e', 'einnahme', 5000)[0];
  const r = mehrereAendern(['a', 'e'], { kontoId: 'spar' }, { alle: [a, e], konten, kategorien, jetzt: 'T1' });
  assert.deepEqual(r.geaendert.map((x) => [x.id, x.kontoId]), [['a', 'spar'], ['e', 'spar']]);

  const s = mehrereAendern(['a'], { kontoId: 'neu' }, { alle: [a], konten, kategorien });
  assert.equal(s.anzahl, 0);
  assert.match(s.uebersprungen[0].grund, /vor dem Stichtag/);
  assert.throws(() => mehrereAendern(['a'], { kontoId: 'gibtsnicht' }, { alle: [a], konten, kategorien }), /Konto/);
});

test('D260: Aufrundung und Ausgleich folgen dem neuen Konto bzw. der neuen Kategorie', () => {
  const aufrunden = { aktiv: true, vonKontoId: 'giro', zielKontoId: 'spar' };
  const ausgleich = { aktiv: true, kontoId: 'paypal', vonKontoId: 'giro' };
  const ausgabe = buchung('a', 'ausgabe', 1230)[0];
  const rundung = aufrundungAnpassen(ausgabe, aufrunden, [ausgabe], { konten, jetzt: 'T0' });
  const ohne = buchung('o', 'ausgabe', 2340)[0]; // ohne Aufrundung (Häkchen war aus)
  const pp = buchung('p', 'ausgabe', 4000, { kontoId: 'paypal' })[0];
  const ausgl = ausgleichAnpassen(pp, ausgleich, [pp], { konten, kategorien, jetzt: 'T0' });
  assert.equal(ausgl[0].budgetKategorieId, 'leb');
  const alle = [ausgabe, ...rundung, ohne, pp, ...ausgl];

  // Kategorie: Ausgleich trägt danach das Budget der neuen Hauptkategorie
  const k = mehrereAendern(['p'], { kategorieId: 'kino' }, { alle, konten, kategorien, aufrunden, ausgleich, jetzt: 'T1' });
  const ab = k.geaendert.find((x) => x.ausgleichFuer === 'p' && x.richtung === 'ab');
  assert.equal(ab.budgetKategorieId, 'frei');
  assert.equal(ab.id, ausgl.find((x) => x.richtung === 'ab').id, 'dieselbe Umbuchung, keine neue');

  // Konto: Aufrundung gilt auf PayPal nicht mehr → Papierkorb; ohne Aufrundung entsteht keine
  const r = mehrereAendern(['a', 'o'], { kontoId: 'paypal' }, { alle, konten, kategorien, aufrunden, ausgleich, jetzt: 'T2' });
  assert.equal(r.anzahl, 2);
  const umb = r.geaendert.filter((x) => x.art === 'umbuchung');
  assert.equal(umb.length, 2);
  assert.ok(umb.every((x) => x.aufrundungFuer === 'a' && x.geloeschtAm === 'T2'));
  assert.ok(!r.geaendert.some((x) => x.ausgleichFuer), 'kein neuer Ausgleich ohne Häkchen');
  assert.equal(r.vorher.length, r.geaendert.length);
});
