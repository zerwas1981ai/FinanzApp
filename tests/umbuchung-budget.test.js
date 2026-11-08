// D98: Umbuchungen optional einem Budget auf dem abgebenden Konto zuordnen
// (z. B. Urlaubsbudget auf dem Girokonto, bezahlt per PayPal). Nur erfundene Testdaten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monatsprognose, zeitleiste, ausgabenJeKontoUndKategorie, budgetSchluessel, jahresbudgetPlan } from '../js/prognose.js';
import { baueBuchungen, anzahlFuerKategorien } from '../js/buchungen.js';
import { baueWiederkehrend, baueGeplant } from '../js/annahmen.js';

const konten = [
  { id: 'giro', name: 'Giro', anfangssaldoCent: 300000, stichtag: '2026-01-01', mindestsaldoCent: null },
  { id: 'paypal', name: 'PayPal', anfangssaldoCent: 0, stichtag: '2026-01-01', mindestsaldoCent: null },
];
const kategorien = [
  { id: 'frei', name: 'Freizeit', elternId: null, art: 'ausgabe' },
  { id: 'urlaub', name: 'Urlaub', elternId: 'frei' },
  { id: 'eink', name: 'Einkommen', elternId: null, art: 'einnahme' },
];
const budget = { id: 'b', kategorieId: 'frei', kontoId: 'giro', typ: 'wiederkehrend', startMonat: '2026-01', endMonat: null, stufen: [{ ab: '2026-01', betragCent: 50000 }] };
const umbuchung = (cent, datum, extra = {}) => baueBuchungen(
  { art: 'umbuchung', betragCent: cent, datum, kontoId: 'giro', gegenkontoId: 'paypal', notiz: '', status: 'gebucht', ...extra }, { konten },
);
const daten = (extra = {}) => ({ konten, kategorien, buchungen: [], budgets: [budget], wiederkehrende: [], geplant: [], ...extra });

test('Buchung speichert die Zuordnung an beiden Hälften, nur bei Umbuchungen', () => {
  const [ab, zu] = umbuchung(20000, '2026-11-03', { budgetKategorieId: 'frei' });
  assert.equal(ab.budgetKategorieId, 'frei');
  assert.equal(zu.budgetKategorieId, 'frei');
  assert.equal(baueBuchungen({ art: 'umbuchung', betragCent: 1, datum: '2026-11-03', kontoId: 'giro', gegenkontoId: 'paypal' }, { konten, bestehende: [ab, zu] })[0].budgetKategorieId, 'frei', 'undefined = unverändert');
  assert.equal(umbuchung(1, '2026-11-03', { budgetKategorieId: '' })[0].budgetKategorieId, null, 'leer = keine');
  const [ausgabe] = baueBuchungen({ art: 'ausgabe', betragCent: 1, datum: '2026-11-03', kontoId: 'giro', kategorieId: 'urlaub', budgetKategorieId: 'frei' }, { konten });
  assert.equal(ausgabe.budgetKategorieId, null);
});

test('Laufender Monat: Umbuchung verbraucht das Budget auf dem abgebenden Konto, bleibt aber keine Ausgabe', () => {
  const buchungen = [...umbuchung(20000, '2026-11-03', { budgetKategorieId: 'frei' })];
  const p = monatsprognose(daten({ buchungen }), '2026-11-06');
  const g = p.jeKonto.get('giro');
  assert.equal(g.rest, 30000, '500 − 200 Umbuchung');
  assert.equal(g.budgets[0].ist, 20000);
  assert.equal(p.ausgaben, 0, 'keine Ausgabe in den Kennzahlen');
  assert.equal(p.jeKonto.get('paypal').rest, 0);
  // Ohne Zuordnung: Budget bleibt voll – das Geld wäre doppelt eingeplant
  assert.equal(monatsprognose(daten({ buchungen: umbuchung(20000, '2026-11-03') }), '2026-11-06').jeKonto.get('giro').rest, 50000);
  // Für Budgethinweise zählt sie mit (nur die abgebende Seite)
  const ist = ausgabenJeKontoUndKategorie(buchungen, kategorien, '2026-11');
  assert.equal(ist.get(budgetSchluessel('giro', 'frei')), 20000);
  assert.equal(ist.get(budgetSchluessel('paypal', 'frei')), undefined);
});

const wkUmbuchung = (extra = {}) => ({
  id: 'w', notiz: 'PayPal aufladen', art: 'umbuchung', kontoId: 'giro', gegenkontoId: 'paypal', kategorieId: null,
  intervall: 'monatlich', start: '2026-11-20', stufen: [{ ab: '2026-11-20', betragCent: 10000 }], ausnahmen: [],
  erstelltAm: '2026-11-01T00:00:00Z', budgetKategorieId: 'frei', ...extra,
});

test('Offene wiederkehrende Umbuchung im laufenden Monat verbraucht das Budget', () => {
  const p = monatsprognose(daten({ wiederkehrende: [wkUmbuchung()] }), '2026-11-06');
  assert.equal(p.jeKonto.get('giro').rest, 40000);
  assert.equal(p.jeKonto.get('giro').budgets[0].offen, 10000);
});

test('Zeitleiste: wiederkehrende und geplante Umbuchungen mit Budget', () => {
  const geplant = [{ id: 'g', bezeichnung: 'Ferienwohnung', art: 'umbuchung', kontoId: 'giro', gegenkontoId: 'paypal', datum: '2027-01-10', betragCent: 30000, budgetKategorieId: 'frei' }];
  const zl = zeitleiste(daten({ wiederkehrende: [wkUmbuchung()], geplant }), '2026-11-06', '2027-01');
  const budgetIm = (m) => -(zl.jeKonto.get('giro').find((z) => z.monat === m).posten.find((p) => p.quelle === 'budget')?.wirkung ?? 0);
  assert.equal(budgetIm('2026-12'), 40000, '500 − 100 Aufladung');
  assert.equal(budgetIm('2027-01'), 10000, '500 − 100 − 300');
  // Umbuchung selbst bleibt Umbuchung (keine Ausgabe)
  const jan = zl.jeKonto.get('giro').find((z) => z.monat === '2027-01');
  assert.equal(jan.umbuchungen, -40000);
  assert.equal(jan.ausgaben, 10000, 'nur der Budgetrest');
});

test('Jahresbudget wird ebenfalls verbraucht', () => {
  const jahr = { id: 'j', kategorieId: 'frei', kontoId: 'giro', typ: 'jaehrlich', startJahr: 2027, endJahr: null, verteilung: 'zeitpunkt', zeitpunktMonat: 7, betragCent: 150000 };
  const geplant = [{ id: 'g', bezeichnung: 'Urlaub', art: 'umbuchung', kontoId: 'giro', gegenkontoId: 'paypal', datum: '2027-06-01', betragCent: 100000, budgetKategorieId: 'frei' }];
  const plan = jahresbudgetPlan({ ...daten({ geplant }), budgets: [jahr] }, '2026-11-06', '2027-12');
  assert.equal(plan.get('2027-07')[0].restCent, 50000);
});

test('Wiederkehrend und geplant: Zuordnung prüfen und speichern', () => {
  const basis = { notiz: '', art: 'umbuchung', kontoId: 'giro', gegenkontoId: 'paypal', intervall: 'monatlich', start: '2026-12-01', ende: '', stufen: [{ ab: '', betragCent: 100 }] };
  assert.equal(baueWiederkehrend({ ...basis, budgetKategorieId: 'frei' }, { konten, kategorien }).budgetKategorieId, 'frei');
  assert.equal(baueWiederkehrend({ ...basis, budgetKategorieId: '' }, { konten, kategorien }).budgetKategorieId, null);
  assert.throws(() => baueWiederkehrend({ ...basis, budgetKategorieId: 'eink' }, { konten, kategorien }), /Ausgaben-Hauptkategorie/);
  assert.throws(() => baueWiederkehrend({ ...basis, budgetKategorieId: 'urlaub' }, { konten, kategorien }), /Ausgaben-Hauptkategorie/);
  const g = baueGeplant({ bezeichnung: 'Urlaub', art: 'umbuchung', kontoId: 'giro', gegenkontoId: 'paypal', datum: '2027-01-10', betragCent: 100, budgetKategorieId: 'frei' }, { konten, kategorien });
  assert.equal(g.budgetKategorieId, 'frei');
  assert.equal(baueGeplant({ bezeichnung: 'X', art: 'ausgabe', kontoId: 'giro', kategorieId: 'urlaub', datum: '2027-01-10', betragCent: 100, budgetKategorieId: 'frei' }, { konten, kategorien }).budgetKategorieId, null, 'nur bei Umbuchungen');
});

test('Löschsperre zählt Buchungen mit Budget-Zuordnung mit', () => {
  assert.equal(anzahlFuerKategorien(['frei'], umbuchung(100, '2026-11-03', { budgetKategorieId: 'frei' })), 2);
});
