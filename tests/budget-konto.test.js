// D85: Budgets gelten je Konto. Nur Ausgaben (echte, wiederkehrende, geplante) auf dem
// Konto des Budgets verbrauchen es; Budgethinweise erscheinen je Konto. Nur erfundene Testdaten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monatsprognose, zeitleiste, budgetHinweise, budgetFuerMonat, budgetPaare } from '../js/prognose.js';
import { baueBudget, budgetMitVorschlag } from '../js/annahmen.js';
import { baueBuchungen } from '../js/buchungen.js';

const heute = '2026-11-06';
const giro = { id: 'giro', name: 'Giro', anfangssaldoCent: 100000, stichtag: '2026-08-01', mindestsaldoCent: null };
const karte = { id: 'karte', name: 'Kreditkarte', anfangssaldoCent: 0, stichtag: '2026-08-01', mindestsaldoCent: null };
const konten = [giro, karte];
const kategorien = [
  { id: 'lebensm', name: 'Lebensmittel', elternId: null, art: 'ausgabe' },
  { id: 'super', name: 'Supermarkt', elternId: 'lebensm' },
];
const ausgabe = (cent, datum, kontoId, extra = {}) => baueBuchungen(
  { art: 'ausgabe', betragCent: cent, datum, kontoId, kategorieId: 'super', status: 'gebucht', notiz: '', ...extra }, { konten },
);
const budget = (id, kontoId, betragCent, start = '2026-08') => ({
  id, kategorieId: 'lebensm', typ: 'wiederkehrend', kontoId, startMonat: start, endMonat: null, stufen: [{ ab: start, betragCent }],
});

test('Laufender Monat: Ausgabe auf anderem Konto verbraucht das Budget nicht', () => {
  const budgets = [budget('b1', 'giro', 40000)];
  const buchungen = [...ausgabe(15000, '2026-11-04', 'karte'), ...ausgabe(5000, '2026-11-05', 'giro')];
  const p = monatsprognose({ konten, kategorien, buchungen, budgets, wiederkehrende: [] }, heute);

  const g = p.jeKonto.get('giro');
  assert.equal(g.rest, 35000, 'nur die 50 € auf dem Giro verbrauchen das Budget');
  assert.deepEqual(g.budgets.map((b) => [b.id, b.kontoId, b.ist, b.budget]), [['lebensm', 'giro', 5000, 40000]]);
  const k = p.jeKonto.get('karte');
  assert.equal(k.rest, 0, 'Kreditkarte hat kein Budget');
  assert.deepEqual(k.budgets, []);
  assert.equal(k.prognose, -15000, 'Ausgabe zählt als normale Ausgabe im Kontostand');
  assert.equal(p.gesamtPrognose, g.prognose + k.prognose);
});

test('Zwei Budgets derselben Kategorie auf zwei Konten werden getrennt verbraucht', () => {
  const budgets = [budget('b1', 'giro', 40000), budget('b2', 'karte', 10000)];
  const buchungen = [...ausgabe(12000, '2026-11-04', 'karte'), ...ausgabe(5000, '2026-11-05', 'giro')];
  const p = monatsprognose({ konten, kategorien, buchungen, budgets, wiederkehrende: [] }, heute);
  assert.equal(p.jeKonto.get('giro').rest, 35000);
  assert.equal(p.jeKonto.get('karte').rest, 0, 'Karte überzogen: kein Rest, Prognose = Ist');
  assert.equal(p.jeKonto.get('karte').budgets[0].prognose, 12000);
  assert.equal(budgetFuerMonat(budgets, 'lebensm', '2026-11', 'giro').betragCent, 40000);
  assert.equal(budgetFuerMonat(budgets, 'lebensm', '2026-11', 'karte').betragCent, 10000);
  assert.equal(budgetFuerMonat(budgets, 'lebensm', '2026-11').betragCent, 50000, 'ohne Konto: Summe für die Anzeige');
  assert.equal(budgetPaare(budgets).length, 2);
});

test('Offene wiederkehrende Ausgabe zählt nur gegen das Budget ihres Kontos', () => {
  const budgets = [budget('b1', 'giro', 40000)];
  const wiederkehrende = [{
    id: 'abo', bezeichnung: 'Lieferabo', art: 'ausgabe', kontoId: 'karte', gegenkontoId: null, kategorieId: 'super',
    intervall: 'monatlich', start: '2026-11-20', stufen: [{ ab: '2026-11-20', betragCent: 30000 }], ausnahmen: [],
  }];
  const p = monatsprognose({ konten, kategorien, buchungen: [], budgets, wiederkehrende }, heute);
  assert.equal(p.jeKonto.get('giro').rest, 40000);
  assert.equal(p.jeKonto.get('karte').prognose, -30000);
});

test('Zeitleiste: Budget wird nur von Bewegungen auf seinem Konto verbraucht', () => {
  const daten = {
    konten, kategorien, buchungen: [], budgets: [budget('b1', 'giro', 30000, '2026-11')], wiederkehrende: [],
    geplant: [{ id: 'g', bezeichnung: 'Großeinkauf', art: 'ausgabe', kontoId: 'karte', kategorieId: 'super', datum: '2027-01-15', betragCent: 50000 }],
  };
  const zl = zeitleiste(daten, heute);
  const janGiro = zl.jeKonto.get('giro').find((z) => z.monat === '2027-01');
  const janKarte = zl.jeKonto.get('karte').find((z) => z.monat === '2027-01');
  assert.equal(janGiro.ausgaben, 30000, 'volles Budget bleibt, Großeinkauf ist auf der Karte');
  assert.ok(janGiro.posten.some((p) => p.quelle === 'budget' && p.text === 'Budget Lebensmittel' && p.ref.budget.kontoId === 'giro'));
  assert.equal(janKarte.ausgaben, 50000);
  assert.ok(!janKarte.posten.some((p) => p.quelle === 'budget'));

  // Budgets auf beiden Konten: Konto steht im Text, damit die Gesamtsicht eindeutig ist
  daten.budgets.push(budget('b2', 'karte', 10000, '2026-11'));
  const dez = zeitleiste(daten, heute).gesamt[0];
  assert.deepEqual(dez.posten.filter((p) => p.quelle === 'budget').map((p) => p.text).sort(),
    ['Budget Lebensmittel (Giro)', 'Budget Lebensmittel (Kreditkarte)']);
});

test('Budgethinweise je Konto', () => {
  const budgets = [budget('b1', 'giro', 40000), budget('b2', 'karte', 10000)];
  const b = [];
  for (const m of ['08', '09', '10']) {
    b.push(...ausgabe(48000, `2026-${m}-10`, 'giro')); // Giro: 20 % über Budget → Hinweis
    b.push(...ausgabe(10000, `2026-${m}-12`, 'karte')); // Karte: genau im Budget → kein Hinweis
  }
  const daten = { konten, kategorien, buchungen: b, budgets, hinweise: [], einstellungen: [{ id: 'hinweise', monate: 3, prozent: 10 }] };
  const h = budgetHinweise(daten, heute);
  assert.equal(h.length, 1);
  assert.deepEqual([h[0].kategorie.id, h[0].kontoId, h[0].konto.name, h[0].richtung], ['lebensm', 'giro', 'Giro', 'ueber']);
  assert.equal(h[0].aktuellesBudgetCent, 40000, 'nur das Budget dieses Kontos');
  assert.equal(h[0].vorschlagCent, 48000);

  // Entscheidung für ein anderes Konto unterdrückt nicht, eine alte ohne Konto schon
  const andere = [{ kategorieId: 'lebensm', kontoId: 'karte', status: 'abgelehnt', bisMonat: '2026-10' }];
  assert.equal(budgetHinweise({ ...daten, hinweise: andere }, heute).length, 1);
  const alt = [{ kategorieId: 'lebensm', status: 'abgelehnt', bisMonat: '2026-10' }];
  assert.equal(budgetHinweise({ ...daten, hinweise: alt }, heute).length, 0);

  // Archiviertes Konto → kein Hinweis
  const archiv = konten.map((k) => (k.id === 'giro' ? { ...k, archiviert: true } : k));
  assert.equal(budgetHinweise({ ...daten, konten: archiv }, heute).length, 0);
});

test('Wiederkehrendes Budget je Konto einmal; Vorschlag trifft das richtige Konto', () => {
  const ctx = { kategorien, budgets: [] };
  const eingabe = (kontoId) => ({ kategorieId: 'lebensm', kontoId, typ: 'wiederkehrend', startMonat: '2026-11', endMonat: '', stufen: [{ ab: '', betragCent: 40000 }] });
  const b1 = baueBudget(eingabe('giro'), ctx);
  const b2 = baueBudget(eingabe('karte'), { kategorien, budgets: [b1] });
  assert.equal(b2.kontoId, 'karte', 'gleiche Kategorie auf anderem Konto erlaubt');
  assert.throws(() => baueBudget(eingabe('giro'), { kategorien, budgets: [b1, b2] }), /auf diesem Konto schon/);

  const neu = budgetMitVorschlag([b1, b2], { kategorieId: 'lebensm', abMonat: '2026-12', betragCent: 15000, kontoId: 'karte' });
  assert.equal(neu.id, b2.id);
  assert.deepEqual(neu.stufen.map((s) => s.ab), ['2026-11', '2026-12']);
});
