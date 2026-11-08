// D92: Monatliche Budgets mit festen Abweichungen je Kalendermonat („jeden Juli 200 €“). Nur erfundene Testdaten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budgetFuerMonat, regelBetrag, zeitleiste } from '../js/prognose.js';
import { baueBudget, budgetMitMonatsAusnahme } from '../js/annahmen.js';
import { migriereDaten } from '../js/migrationen.js';

const freizeit = {
  id: 'f', kategorieId: 'frei', kontoId: 'giro', typ: 'wiederkehrend', startMonat: '2026-01', endMonat: null,
  stufen: [{ ab: '2026-01', betragCent: 10000 }, { ab: '2028-01', betragCent: 12000 }],
  ausnahmen: [], kalenderMonate: [{ monat: 7, betragCent: 20000 }, { monat: 12, betragCent: 20000 }],
};

test('Fester Betrag je Kalendermonat, jedes Jahr – unabhängig von Betragsänderungen', () => {
  assert.equal(budgetFuerMonat([freizeit], 'frei', '2027-06', 'giro').betragCent, 10000);
  assert.equal(budgetFuerMonat([freizeit], 'frei', '2027-07', 'giro').betragCent, 20000);
  assert.equal(budgetFuerMonat([freizeit], 'frei', '2027-12', 'giro').betragCent, 20000);
  assert.equal(budgetFuerMonat([freizeit], 'frei', '2028-03', 'giro').betragCent, 12000, 'neue Stufe');
  assert.equal(budgetFuerMonat([freizeit], 'frei', '2028-07', 'giro').betragCent, 20000, 'Juli bleibt fest');
  assert.equal(regelBetrag(freizeit, '2030-12'), 20000);
  assert.equal(regelBetrag({ ...freizeit, kalenderMonate: undefined }, '2030-12'), 12000, 'ältere Datensätze ohne Feld');
});

test('Einzelne Monatsausnahme hat Vorrang; Zurücksetzen vergleicht mit dem Kalendermonat-Betrag', () => {
  const mit = budgetMitMonatsAusnahme(freizeit, '2027-07', 35000);
  assert.equal(budgetFuerMonat([mit], 'frei', '2027-07', 'giro').betragCent, 35000);
  assert.equal(budgetFuerMonat([mit], 'frei', '2028-07', 'giro').betragCent, 20000, 'nur Juli 2027');
  // 200 € im Juli eintragen = Regelbetrag → keine Ausnahme nötig
  assert.deepEqual(budgetMitMonatsAusnahme(freizeit, '2027-07', 20000).ausnahmen, []);
});

test('Zeitleiste rechnet mit dem Juli-Betrag', () => {
  const daten = {
    konten: [{ id: 'giro', name: 'Giro', anfangssaldoCent: 0, stichtag: '2026-01-01', mindestsaldoCent: null }],
    kategorien: [{ id: 'frei', name: 'Freizeit', elternId: null, art: 'ausgabe' }],
    buchungen: [], budgets: [freizeit], wiederkehrende: [], geplant: [],
  };
  const zl = zeitleiste(daten, '2026-11-06', '2027-12');
  const betrag = (m) => -zl.jeKonto.get('giro').find((z) => z.monat === m).posten.find((p) => p.quelle === 'budget').wirkung;
  assert.equal(betrag('2027-06'), 10000);
  assert.equal(betrag('2027-07'), 20000);
  assert.equal(betrag('2026-12'), 20000);
});

test('Anlegen: Abweichungen prüfen und sortiert speichern', () => {
  const kategorien = [{ id: 'frei', name: 'Freizeit', elternId: null, art: 'ausgabe' }];
  const basis = { kategorieId: 'frei', kontoId: 'giro', typ: 'wiederkehrend', startMonat: '2026-11', endMonat: '', stufen: [{ ab: '', betragCent: 10000 }] };
  const b = baueBudget({ ...basis, kalenderMonate: [{ monat: '12', betragCent: 20000 }, { monat: '7', betragCent: 20000 }] }, { kategorien, budgets: [] });
  assert.deepEqual(b.kalenderMonate, [{ monat: 7, betragCent: 20000 }, { monat: 12, betragCent: 20000 }]);
  assert.equal(baueBudget({ ...basis, kalenderMonate: [{ monat: '8', betragCent: 0 }] }, { kategorien, budgets: [] }).kalenderMonate[0].betragCent, 0, '0 erlaubt');
  assert.throws(() => baueBudget({ ...basis, kalenderMonate: [{ monat: '', betragCent: 1 }] }, { kategorien, budgets: [] }), /Monat wählen/);
  assert.throws(() => baueBudget({ ...basis, kalenderMonate: [{ monat: '7', betragCent: null }] }, { kategorien, budgets: [] }), /Betrag/);
  assert.throws(() => baueBudget({ ...basis, kalenderMonate: [{ monat: '7', betragCent: 1 }, { monat: '7', betragCent: 2 }] }, { kategorien, budgets: [] }), /nur einmal/);
  // Ohne Angabe (z. B. Budgetvorschlag) bleiben vorhandene Abweichungen erhalten
  assert.deepEqual(baueBudget(basis, { kategorien, budgets: [], alt: b }).kalenderMonate, b.kalenderMonate);
});

test('Migration auf Version 13 ergänzt das Feld', () => {
  const v12 = { version: 12, konten: [], kategorien: [], buchungen: [], budgets: [{ id: 'm', typ: 'wiederkehrend' }, { id: 'e', typ: 'einmalig' }] };
  const { daten } = migriereDaten(v12);
  assert.deepEqual(daten.budgets[0].kalenderMonate, []);
  assert.equal(daten.budgets[1].kalenderMonate, undefined);
});
