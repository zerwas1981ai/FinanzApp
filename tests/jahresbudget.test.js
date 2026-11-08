// D90: Jahresbudgets in Tranchen (Zeitpunkt, Halbjahr, Quartale). Nur erfundene Testdaten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tranchen, jahresbudgetJahr, trancheImMonat, budgetZeitraum } from '../js/jahresbudget.js';
import { monatsprognose, zeitleiste, budgetFuerMonat, budgetHinweise } from '../js/prognose.js';
import { baueBudget } from '../js/annahmen.js';
import { baueBuchungen } from '../js/buchungen.js';

const jb = (extra) => ({ id: 'j', kategorieId: 'kleid', kontoId: 'giro', typ: 'jaehrlich', startJahr: 2026, endJahr: null, ...extra });
const halb = jb({ verteilung: 'halbjahr', betragCent: 120000 });
const proMonat = (werte) => (m) => werte[m] ?? 0;

test('Tranchen je Verteilung', () => {
  assert.deepEqual(tranchen(halb), [{ monat: 6, betragCent: 60000 }, { monat: 12, betragCent: 60000 }]);
  assert.deepEqual(tranchen(jb({ verteilung: 'halbjahr', betragCent: 1001 })).map((t) => t.betragCent), [500, 501]);
  assert.deepEqual(tranchen(jb({ verteilung: 'zeitpunkt', zeitpunktMonat: 5, betragCent: 1000 })), [{ monat: 5, betragCent: 1000 }]);
  assert.deepEqual(tranchen(jb({ verteilung: 'quartal', quartaleCent: [300, 0, 200, 100] })).map((t) => t.monat), [3, 9, 12]);
  assert.equal(trancheImMonat(halb, '2027-06'), 60000);
  assert.equal(trancheImMonat(halb, '2027-05'), 0);
  assert.equal(trancheImMonat(halb, '2025-06'), 0, 'vor dem Startjahr');
  assert.deepEqual(budgetZeitraum(jb({ endJahr: 2028 })), ['2026-01', '2028-12']);
});

test('Künftiges Jahr ohne Ausgaben: beide Hälften wirken zu ihrem Termin', () => {
  assert.deepEqual(jahresbudgetJahr(halb, 2027, () => 0, 1).map((p) => [p.monat, p.art, p.restCent]), [[6, 'tranche', 60000], [12, 'tranche', 60000]]);
  assert.deepEqual(jahresbudgetJahr(jb({ verteilung: 'halbjahr', betragCent: 100, endJahr: 2026 }), 2027, () => 0, 1), [], 'nach dem Endjahr');
});

test('Rest einer abgelaufenen Tranche wandert ins Restbudget zum 31.12.', () => {
  // August: Jan–Jun 400 € ausgegeben → 200 € Rest; Jul–Dez bisher 100 €
  const p = jahresbudgetJahr(halb, 2026, proMonat({ 3: 40000, 9: 10000 }), 8);
  assert.deepEqual(p.map((x) => [x.monat, x.art, x.betragCent, x.verbrauchtCent, x.restCent, x.uebertragCent]),
    [[12, 'rest', 80000, 10000, 70000, 20000]]);
});

test('Überziehung verringert das Restbudget (Jahr als Ganzes), kein Übertrag ins neue Jahr', () => {
  const p = jahresbudgetJahr(halb, 2026, proMonat({ 2: 90000, 8: 10000 }), 8);
  assert.deepEqual(p.map((x) => [x.monat, x.restCent]), [[12, 20000]], '600 − 300 Überziehung − 100');
  // Ganzes Jahr überzogen → nichts mehr erwartet
  assert.deepEqual(jahresbudgetJahr(halb, 2026, proMonat({ 2: 150000 }), 8), []);
  // Nächstes Jahr beginnt wieder mit vollen Tranchen
  assert.equal(jahresbudgetJahr(halb, 2027, () => 0, 1)[0].restCent, 60000);
});

test('Quartale mit eigener Aufteilung', () => {
  const q = jb({ verteilung: 'quartal', quartaleCent: [30000, 50000, 20000, 0], betragCent: 100000 });
  // November: Q1 100 € (Rest +200), Q2 600 € (−100), Q3 0 (+200) → Restbudget 300 €, Okt–Dez bisher 50 €
  const p = jahresbudgetJahr(q, 2026, proMonat({ 2: 10000, 5: 60000, 11: 5000 }), 11);
  assert.deepEqual(p.map((x) => [x.monat, x.art, x.betragCent, x.restCent]), [[12, 'rest', 30000, 25000]]);
  // Künftiges Jahr: Q2 schon überplant → Überziehung mindert das Restbudget
  const k = jahresbudgetJahr(q, 2027, proMonat({ 4: 70000 }), 1);
  assert.deepEqual(k.map((x) => [x.monat, x.restCent]), [[3, 30000], [9, 20000]], 'Dezember: 0 − 200 € → nichts');
});

test('Fester Zeitpunkt: Tranche zum Monatsende, danach nur noch Restbudget', () => {
  const z = jb({ verteilung: 'zeitpunkt', zeitpunktMonat: 5, betragCent: 100000 });
  assert.deepEqual(jahresbudgetJahr(z, 2026, proMonat({ 2: 30000 }), 3).map((x) => [x.monat, x.restCent]), [[5, 70000]]);
  // Juni: Mai vorbei, 300 € ausgegeben → 700 € Restbudget zum 31.12.
  assert.deepEqual(jahresbudgetJahr(z, 2026, proMonat({ 2: 30000 }), 6).map((x) => [x.monat, x.art, x.restCent]), [[12, 'rest', 70000]]);
});

/* ---------- Einbindung in Monatsprognose und Zeitleiste ---------- */

const konten = [
  { id: 'giro', name: 'Giro', anfangssaldoCent: 500000, stichtag: '2026-01-01', mindestsaldoCent: null },
  { id: 'karte', name: 'Karte', anfangssaldoCent: 0, stichtag: '2026-01-01', mindestsaldoCent: null },
];
const kategorien = [
  { id: 'kleid', name: 'Kleidung', elternId: null, art: 'ausgabe' },
  { id: 'hosen', name: 'Hosen', elternId: 'kleid' },
];
const ausgabe = (cent, datum, kontoId = 'giro') => baueBuchungen(
  { art: 'ausgabe', betragCent: cent, datum, kontoId, kategorieId: 'hosen', status: 'gebucht', notiz: '' }, { konten },
);
const daten = (buchungen) => ({ konten, kategorien, buchungen, budgets: [halb], wiederkehrende: [], geplant: [] });

test('Zeitleiste: Restbudget zum 31.12., im Folgejahr wieder Tranchen', () => {
  const b = [...ausgabe(40000, '2026-03-10'), ...ausgabe(10000, '2026-09-10'), ...ausgabe(99000, '2026-05-01', 'karte')];
  const zl = zeitleiste(daten(b), '2026-11-06', '2027-12');
  const dez = zl.jeKonto.get('giro').find((z) => z.monat === '2026-12');
  assert.deepEqual(dez.posten.map((p) => [p.text, p.wirkung]), [['Restbudget Kleidung (Jahr)', -70000]], 'Karte zählt nicht (D85)');
  assert.equal(dez.ausgaben, 70000);
  const jun = zl.jeKonto.get('giro').find((z) => z.monat === '2027-06');
  assert.deepEqual(jun.posten.map((p) => [p.text, p.wirkung]), [['Budget Kleidung (Jahr)', -60000]]);
  assert.ok(!zl.jeKonto.get('karte').some((z) => z.posten.length), 'Karte hat kein Budget');
  // Nicht einzeln änderbar (kein ref)
  assert.equal(dez.posten[0].ref, undefined);
});

test('Monatsprognose: fällige Tranche im laufenden Monat', () => {
  const b = [...ausgabe(40000, '2026-03-10'), ...ausgabe(10000, '2026-12-02')];
  const p = monatsprognose(daten(b), '2026-12-05');
  const g = p.jeKonto.get('giro');
  assert.equal(g.rest, 70000, '600 + 200 Übertrag − 100 im Dezember');
  const z = g.budgets[0];
  assert.deepEqual([z.name, z.budget, z.ist, z.rest, z.jaehrlich], ['Kleidung (Restbudget Jahr)', 80000, 10000, 70000, true]);
  // Im November ist nichts fällig
  assert.equal(monatsprognose(daten(b), '2026-11-06').jeKonto.get('giro').rest, 0);
});

test('Jahresbudget zählt nicht als Monatsbudget und erzeugt keine Budgethinweise', () => {
  assert.equal(budgetFuerMonat([halb], 'kleid', '2026-06', 'giro').vorhanden, false);
  const d = { ...daten(ausgabe(5000, '2026-08-01')), hinweise: [], einstellungen: [] };
  assert.deepEqual(budgetHinweise(d, '2026-11-06'), []);
});

test('Anlegen: Prüfungen und „entweder Monats- oder Jahresbudget“', () => {
  const ctx = { kategorien, budgets: [] };
  const basis = { kategorieId: 'kleid', kontoId: 'giro', typ: 'jaehrlich', startJahr: '2027', endJahr: '' };
  const h = baueBudget({ ...basis, verteilung: 'halbjahr', betragCent: 60000 }, ctx);
  assert.deepEqual([h.startJahr, h.endJahr, h.verteilung, h.betragCent], [2027, null, 'halbjahr', 60000]);
  const q = baueBudget({ ...basis, verteilung: 'quartal', quartaleCent: [100, 0, 300, null] }, ctx);
  assert.deepEqual([q.quartaleCent, q.betragCent], [[100, 0, 300, 0], 400]);
  assert.equal(baueBudget({ ...basis, verteilung: 'zeitpunkt', zeitpunktMonat: '5', betragCent: 1 }, ctx).zeitpunktMonat, 5);
  assert.throws(() => baueBudget({ ...basis, verteilung: 'quartal', quartaleCent: [0, 0, 0, 0] }, ctx), /mindestens/);
  assert.throws(() => baueBudget({ ...basis, verteilung: 'halbjahr', betragCent: null }, ctx), /Betrag pro Jahr/);
  assert.throws(() => baueBudget({ ...basis, endJahr: '2026', verteilung: 'halbjahr', betragCent: 1 }, ctx), /vor dem Startjahr/);

  const monatlich = { id: 'm', kategorieId: 'kleid', kontoId: 'giro', typ: 'wiederkehrend', startMonat: '2026-01', endMonat: null, stufen: [{ ab: '2026-01', betragCent: 5000 }] };
  assert.throws(() => baueBudget({ ...basis, verteilung: 'halbjahr', betragCent: 1 }, { kategorien, budgets: [monatlich] }), /schon ein Monatsbudget/);
  // Anderes Konto oder anderer Zeitraum: erlaubt
  assert.ok(baueBudget({ ...basis, kontoId: 'karte', verteilung: 'halbjahr', betragCent: 1 }, { kategorien, budgets: [monatlich] }));
  assert.ok(baueBudget({ ...basis, verteilung: 'halbjahr', betragCent: 1 }, { kategorien, budgets: [{ ...monatlich, endMonat: '2026-12' }] }));
  // Umgekehrt: Monatsbudget neben bestehendem Jahresbudget
  assert.throws(() => baueBudget({ kategorieId: 'kleid', kontoId: 'giro', typ: 'einmalig', monat: '2027-03', betragCent: 100 }, { kategorien, budgets: [h] }), /schon ein Jahresbudget/);
  // Zwei Jahresbudgets nur ohne Überschneidung
  assert.throws(() => baueBudget({ ...basis, startJahr: '2030', verteilung: 'halbjahr', betragCent: 1 }, { kategorien, budgets: [h] }), /schon ein Jahresbudget/);
  assert.ok(baueBudget({ ...basis, startJahr: '2030', verteilung: 'halbjahr', betragCent: 1 }, { kategorien, budgets: [{ ...h, endJahr: 2029 }] }));
});
