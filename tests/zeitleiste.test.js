import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  zeitleiste, jahresZeilen, mindestsaldoWarnungen, wirksam, nurWirksam, prognoseJahresende,
  offeneTermine, monatsprognose,
} from '../js/prognose.js';
import { baueGeplant, baueProjekt, projektZahlen, geplantErledigt, mitAusnahme, budgetMitMonatsAusnahme, baueBudget } from '../js/annahmen.js';
import { termine, budgetFuerMonat } from '../js/prognose.js';
import { baueBuchungen } from '../js/buchungen.js';

const heute = '2026-11-06';
const giro = { id: 'giro', name: 'Giro', anfangssaldoCent: 100000, stichtag: '2026-11-01', mindestsaldoCent: 50000 };
const tg = { id: 'tg', name: 'Tagesgeld', anfangssaldoCent: 0, stichtag: '2026-11-01', mindestsaldoCent: null };
const konten = [giro, tg];
const kategorien = [
  { id: 'wohnen', name: 'Wohnen', elternId: null, art: 'ausgabe' },
  { id: 'miete', name: 'Miete', elternId: 'wohnen' },
  { id: 'lebensm', name: 'Lebensmittel', elternId: null, art: 'ausgabe' },
  { id: 'super', name: 'Supermarkt', elternId: 'lebensm' },
  { id: 'mob', name: 'Mobilität', elternId: null, art: 'ausgabe' },
  { id: 'werkstatt', name: 'Werkstatt', elternId: 'mob' },
  { id: 'eink', name: 'Einkommen', elternId: null, art: 'einnahme' },
  { id: 'gehalt', name: 'Gehalt', elternId: 'eink' },
];
const w = (id, art, betragCent, start, extra = {}) => ({
  id, bezeichnung: id, art, kontoId: 'giro', gegenkontoId: null, kategorieId: null, intervall: 'monatlich', start,
  stufen: [{ ab: start, betragCent }], ausnahmen: [], erstelltAm: '2026-11-01T00:00:00Z', ...extra,
});

const basisDaten = () => ({
  konten,
  kategorien,
  buchungen: [],
  budgets: [{ id: 'b', kategorieId: 'lebensm', typ: 'wiederkehrend', kontoId: 'giro', startMonat: '2026-11', endMonat: null, stufen: [{ ab: '2026-11', betragCent: 30000 }] }],
  wiederkehrende: [
    w('gehalt', 'einnahme', 300000, '2026-11-25', { kategorieId: 'gehalt' }),
    w('miete', 'ausgabe', 100000, '2026-11-03', { kategorieId: 'miete', ende: '2027-06-30' }),
    w('spar', 'umbuchung', 20000, '2026-11-28', { gegenkontoId: 'tg' }),
  ],
  geplant: [],
});

test('Zeitleiste: Monate bis 2050, Fortschreibung je Konto und gesamt', () => {
  const zl = zeitleiste(basisDaten(), heute);
  assert.equal(zl.monate[0], '2026-12');
  assert.equal(zl.monate.at(-1), '2050-12');
  assert.equal(zl.monate.length, 289);

  const start = zl.start.jeKonto.get('giro').prognose;
  // Dezember: +3000 Gehalt − 1000 Miete − 200 Sparrate − 300 Budget Lebensmittel
  const dez = zl.jeKonto.get('giro')[0];
  assert.deepEqual([dez.einnahmen, dez.ausgaben, dez.umbuchungen], [300000, 130000, -20000]);
  assert.equal(dez.stand, start + 300000 - 130000 - 20000);
  assert.equal(zl.jeKonto.get('tg')[0].stand, zl.start.jeKonto.get('tg').prognose + 20000);
  // Gesamt: Umbuchung hebt sich auf
  assert.equal(zl.gesamt[0].umbuchungen, 0);
  assert.equal(zl.gesamt[0].stand, zl.start.gesamtPrognose + 300000 - 130000);
  // Miete endet im Juni 2027
  const juli = zl.jeKonto.get('giro').find((z) => z.monat === '2027-07');
  assert.equal(juli.ausgaben, 30000);
  assert.ok(juli.posten.every((p) => p.text !== 'miete'));
  // Budget-Posten mit Text
  assert.ok(dez.posten.some((p) => p.quelle === 'budget' && p.text === 'Budget Lebensmittel' && p.wirkung === -30000));
});

test('Zeitleiste: Budget umfasst alles (geplante Ausgabe verbraucht das Budget)', () => {
  const daten = basisDaten();
  daten.geplant = [{ id: 'g', bezeichnung: 'Großeinkauf', art: 'ausgabe', kontoId: 'giro', kategorieId: 'super', datum: '2027-01-15', betragCent: 50000 }];
  const jan = zeitleiste(daten, heute).jeKonto.get('giro').find((z) => z.monat === '2027-01');
  // 500 € geplant > 300 € Budget → kein zusätzlicher Budgetrest
  assert.equal(jan.ausgaben, 100000 + 50000);
  assert.ok(!jan.posten.some((p) => p.quelle === 'budget'));
});

test('Jahreszeilen und Mindestsaldo-Warnung mit erstem Monat', () => {
  const daten = basisDaten();
  daten.wiederkehrende = daten.wiederkehrende.filter((x) => x.id !== 'gehalt'); // ohne Gehalt sinkt das Konto
  const zl = zeitleiste(daten, heute);
  const jahre = jahresZeilen(zl.jeKonto.get('giro'));
  assert.equal(jahre[0].jahr, 2026);
  assert.equal(jahre[0].monate.length, 1);
  assert.equal(jahre[1].monate.length, 12);
  assert.equal(jahre[1].stand, jahre[1].monate.at(-1).stand);

  const warn = mindestsaldoWarnungen(zl);
  assert.equal(warn.length, 1);
  assert.equal(warn[0].konto.id, 'giro');
  // Giro fällt schon im laufenden Monat unter 500 € (1000 − 1000 Miete − 200 − 300 Budget)
  assert.equal(warn[0].wann, 'monatsende');

  const reich = { ...daten, konten: [{ ...giro, anfangssaldoCent: 300000 }, tg] };
  const w2 = mindestsaldoWarnungen(zeitleiste(reich, heute));
  assert.equal(w2[0].wann, 'zukunft');
  assert.equal(w2[0].monat, '2026-12');
});

test('Ein/Aus-Schalter', () => {
  assert.equal(wirksam({}), true);
  assert.equal(wirksam({ aktiv: false }), false);
  const daten = basisDaten();
  daten.geplant = [{ id: 'g', bezeichnung: 'Anzahlung', art: 'ausgabe', kontoId: 'giro', kategorieId: 'werkstatt', datum: '2027-03-01', betragCent: 800000, aktiv: false }];
  assert.equal(nurWirksam(daten).geplant.length, 0);
  const aus = zeitleiste(nurWirksam(daten), heute).gesamt.at(-1).stand;
  daten.geplant[0].aktiv = true;
  const an = zeitleiste(nurWirksam(daten), heute).gesamt.at(-1).stand;
  assert.equal(aus - an, 800000);
});

test('Projekt: geplante Ausgabe verbraucht in der Zukunft kein Budget', () => {
  const daten = basisDaten();
  // 200 € geplant auf Lebensmittel (Budget 300 €)
  daten.geplant = [{ id: 'g', bezeichnung: 'Feier', art: 'ausgabe', kontoId: 'giro', kategorieId: 'super', datum: '2027-01-15', betragCent: 20000, projektId: 'p' }];
  const jan = zeitleiste(daten, heute).jeKonto.get('giro').find((z) => z.monat === '2027-01');
  // Miete 1000 + Projekt 200 + volles Budget 300 (nicht nur der Rest von 100)
  assert.equal(jan.ausgaben, 100000 + 20000 + 30000);
  daten.geplant[0].projektId = null;
  const ohne = zeitleiste(daten, heute).jeKonto.get('giro').find((z) => z.monat === '2027-01');
  assert.equal(ohne.ausgaben, 100000 + 30000, 'ohne Projekt verbraucht sie das Budget');
});

test('Projekt: Buchungen im laufenden Monat zählen nicht gegen das Budget', () => {
  const daten = basisDaten();
  daten.buchungen = [
    ...baueBuchungen({ art: 'ausgabe', betragCent: 10000, datum: '2026-11-02', kontoId: 'giro', kategorieId: 'super', status: 'gebucht' }, { konten }),
    ...baueBuchungen({ art: 'ausgabe', betragCent: 50000, datum: '2026-11-03', kontoId: 'giro', kategorieId: 'super', status: 'gebucht', projektId: 'p' }, { konten }),
  ];
  const p = monatsprognose(daten, heute);
  const lm = p.kategorien.find((k) => k.id === 'lebensm');
  assert.equal(lm.ist, 10000);
  assert.equal(lm.rest, 20000);
  // Kontostand enthält trotzdem beide Buchungen
  assert.equal(p.jeKonto.get('giro').heute, 100000 - 60000);
  assert.equal(p.ausgaben, 60000, 'Ausgaben des Monats enthalten Projektausgaben');
});

test('Projekt bauen und Zahlen: Ist, offen geplant, Rahmen', () => {
  const p = baueProjekt({ name: ' Umbau Bad ', rahmenCent: 1000000 }, { projekte: [] });
  assert.deepEqual([p.name, p.rahmenCent, p.abgeschlossen], ['Umbau Bad', 1000000, false]);
  assert.throws(() => baueProjekt({ name: 'umbau bad' }, { projekte: [p] }), /gibt es schon/);
  assert.throws(() => baueProjekt({ name: ' ' }, { projekte: [] }), /Namen/);
  assert.throws(() => baueProjekt({ name: 'x', rahmenCent: 0 }, { projekte: [] }), /größer 0/);

  const g = (id, datum, betragCent, extra = {}) => ({ id, bezeichnung: id, art: 'ausgabe', kontoId: 'giro', kategorieId: 'werkstatt', datum, betragCent, projektId: p.id, aktiv: true, ...extra });
  const geplant = [
    g('planung', '2026-11-02', 80000),
    g('fliesen', '2026-11-04', 120000), // vergangen, nicht gebucht
    g('handwerker', '2026-12-20', 600000),
    g('aus', '2027-01-01', 99900, { aktiv: false }),
    g('fremd', '2027-01-01', 5000, { projektId: null }),
  ];
  const buchungen = [
    ...baueBuchungen({ art: 'ausgabe', betragCent: 95000, datum: '2026-11-03', kontoId: 'giro', kategorieId: 'werkstatt', status: 'gebucht', geplantId: 'planung', projektId: p.id }, { konten }),
    ...baueBuchungen({ art: 'einnahme', betragCent: 20000, datum: '2026-11-05', kontoId: 'giro', kategorieId: 'gehalt', status: 'gebucht', projektId: p.id }, { konten }),
  ];
  const z = projektZahlen(p, { buchungen, geplant }, heute);
  assert.equal(z.istCent, 95000 - 20000, 'Zuschuss mindert die Kosten');
  assert.equal(z.offenCent, 120000 + 600000, 'gebuchte Planung und ausgeschaltete zählen nicht');
  assert.equal(z.gesamtCent, 75000 + 720000);
  assert.equal(z.restCent, 1000000 - 795000);
  assert.deepEqual(z.offen.map((x) => [x.geplant.id, x.vergangen]), [['fliesen', true], ['handwerker', false]]);
  assert.equal(z.ist.find((x) => x.buchung.geplantId === 'planung').planCent, 80000);
  // Geplante Umbuchung gehört nie zu einem Projekt
  assert.equal(baueGeplant({ bezeichnung: 'x', art: 'umbuchung', kontoId: 'giro', gegenkontoId: 'tg', datum: '2026-12-01', betragCent: 1, projektId: p.id }, { konten, kategorien }).projektId, null);
});

test('Geplante Einmalbuchung: offen, erledigt per Buchung oder Markierung', () => {
  const g = baueGeplant({ bezeichnung: ' Reparatur ', art: 'ausgabe', kontoId: 'giro', kategorieId: 'werkstatt', datum: '2026-11-04', betragCent: 60000 }, { konten, kategorien });
  assert.equal(g.bezeichnung, 'Reparatur');
  assert.equal(g.aktiv, true);
  assert.equal(g.projektId, null);
  const daten = { ...basisDaten(), geplant: [g] };
  const offen = offeneTermine(daten, heute, '2026-11-30');
  const eintrag = offen.find((t) => t.quelle === 'geplant');
  assert.equal(eintrag.ueberfaellig, true);
  assert.equal(eintrag.betragCent, 60000);
  // Prognose: Mobilität hat kein Budget → geplante 600 € zählen voll
  const p = monatsprognose(daten, heute);
  assert.equal(p.kategorien.find((k) => k.id === 'mob').prognose, 60000);

  // Erledigt durch Buchung mit geplantId
  const b = baueBuchungen({ art: 'ausgabe', betragCent: 65000, datum: '2026-11-05', kontoId: 'giro', kategorieId: 'werkstatt', status: 'gebucht', geplantId: g.id }, { konten });
  assert.equal(offeneTermine({ ...daten, buchungen: b }, heute, '2026-11-30').some((t) => t.quelle === 'geplant'), false);
  assert.equal(geplantErledigt(g, b).id, b[0].id);
  // Erledigt per Markierung
  assert.equal(offeneTermine({ ...daten, geplant: [{ ...g, erledigtAm: 'X' }] }, heute, '2026-11-30').some((t) => t.quelle === 'geplant'), false);
  // Prüfungen
  assert.throws(() => baueGeplant({ bezeichnung: 'x', art: 'ausgabe', kontoId: 'giro', kategorieId: 'gehalt', datum: '2026-12-01', betragCent: 1 }, { konten, kategorien }), /passt nicht/);
  assert.throws(() => baueGeplant({ bezeichnung: 'x', art: 'ausgabe', kontoId: 'giro', kategorieId: 'super', datum: '2026-10-01', betragCent: 1 }, { konten, kategorien }), /Stichtag/);
});

test('Einzelner Termin: Betrag/Datum nur für diesen Termin, zurücksetzen', () => {
  const miete = w('miete', 'ausgabe', 100000, '2026-11-03', { kategorieId: 'miete' });
  const geaendert = mitAusnahme(miete, '2027-01-03', 'aendern', '2027-01-05', 120000);
  const jan = termine(geaendert, '2027-01-01', '2027-01-31')[0];
  assert.deepEqual([jan.datum, jan.betragCent, jan.einzelBetrag], ['2027-01-05', 120000, true]);
  assert.equal(termine(geaendert, '2027-02-01', '2027-02-28')[0].betragCent, 100000, 'Folgemonat unverändert');
  // Nur Datum geändert → wird als "verschieben" gespeichert
  assert.deepEqual(mitAusnahme(miete, '2027-01-03', 'aendern', '2027-01-04', 100000).ausnahmen, [{ termin: '2027-01-03', aktion: 'verschieben', neuesDatum: '2027-01-04' }]);
  // Wie die Regel → keine Ausnahme
  assert.deepEqual(mitAusnahme(geaendert, '2027-01-03', 'aendern', '2027-01-03', 100000).ausnahmen, []);
  assert.deepEqual(mitAusnahme(geaendert, '2027-01-03', null).ausnahmen, []);
  assert.throws(() => mitAusnahme(miete, '2027-01-03', 'aendern', '2027-01-03', 0), /größer 0/);
  // Wirkt in der Zeitleiste und trägt den Verweis zum Ändern
  const daten = { ...basisDaten(), wiederkehrende: [geaendert] };
  const p = zeitleiste(daten, heute).jeKonto.get('giro').find((z) => z.monat === '2027-01').posten.find((x) => x.text === 'miete');
  assert.equal(p.wirkung, -120000);
  assert.deepEqual([p.ref.wiederkehrend.id, p.ref.termin], ['miete', '2027-01-03']);
});

test('Budget nur für einen Monat ändern', () => {
  const b = baueBudget({ typ: 'wiederkehrend', kategorieId: 'lebensm', kontoId: 'giro', startMonat: '2026-11', stufen: [{ ab: '', betragCent: 30000 }] }, { kategorien, budgets: [] });
  assert.deepEqual(b.ausnahmen, []);
  const neu = budgetMitMonatsAusnahme(b, '2026-12', 60000);
  assert.equal(budgetFuerMonat([neu], 'lebensm', '2026-12').betragCent, 60000);
  assert.equal(budgetFuerMonat([neu], 'lebensm', '2027-01').betragCent, 30000);
  assert.equal(budgetFuerMonat([budgetMitMonatsAusnahme(b, '2026-12', 0)], 'lebensm', '2026-12').betragCent, 0, '0 = kein Budget');
  assert.deepEqual(budgetMitMonatsAusnahme(neu, '2026-12', null).ausnahmen, []);
  assert.deepEqual(budgetMitMonatsAusnahme(b, '2026-12', 30000).ausnahmen, [], 'gleich der Regel → keine Ausnahme');
  // Bearbeiten im Annahmen-Dialog behält die Ausnahmen
  assert.deepEqual(baueBudget({ typ: 'wiederkehrend', kategorieId: 'lebensm', kontoId: 'giro', startMonat: '2026-11', stufen: [{ ab: '', betragCent: 35000 }] }, { kategorien, budgets: [neu], alt: neu }).ausnahmen, neu.ausnahmen);
  // Zeitleiste: Dezember mit 600 € Budget, Posten mit Verweis
  const dez = zeitleiste({ ...basisDaten(), budgets: [neu] }, heute).jeKonto.get('giro')[0];
  const bp = dez.posten.find((x) => x.quelle === 'budget');
  assert.equal(bp.wirkung, -60000);
  assert.deepEqual([bp.ref.budget.kategorieId, bp.ref.budget.monat], ['lebensm', '2026-12']);
});

test('Prognose Jahresende über alle Konten (D116)', () => {
  const zl = zeitleiste(basisDaten(), heute);
  const dez = zl.gesamt.find((g) => g.monat === '2026-12');
  assert.equal(prognoseJahresende(zl, heute), dez.stand, 'November: Stand Ende Dezember aus der Zeitleiste');
  const imDezember = zeitleiste(basisDaten(), '2026-12-10');
  assert.equal(prognoseJahresende(imDezember, '2026-12-10'), imDezember.start.gesamtPrognose, 'Dezember: Prognose Monatsende');
});

test('Prognose Jahresende je Konto (D118)', () => {
  const zl = zeitleiste(basisDaten(), heute);
  const giroDez = zl.jeKonto.get('giro').find((z) => z.monat === '2026-12');
  assert.equal(prognoseJahresende(zl, heute, 'giro'), giroDez.stand);
  const summe = [...zl.jeKonto.keys()].reduce((s, id) => s + prognoseJahresende(zl, heute, id), 0);
  assert.equal(summe, prognoseJahresende(zl, heute), 'Konten zusammen = Gesamtwert');
  const imDezember = zeitleiste(basisDaten(), '2026-12-10');
  assert.equal(prognoseJahresende(imDezember, '2026-12-10', 'giro'), imDezember.start.jeKonto.get('giro').prognose);
  assert.equal(prognoseJahresende(zl, heute, 'gibtsnicht'), null);
});
