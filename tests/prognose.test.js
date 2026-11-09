import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  monatsende, plusMonate, plusTage, betragAm, budgetFuerMonat, termine, naechsterTermin,
  offeneTermine, faelligListe, monatsprognose, budgetHinweise, terminWirkung,
  kennzahlKategorien, summenJeHauptkategorie,
} from '../js/prognose.js';
import { baueBudget, baueWiederkehrend, mitAusnahme, budgetMitVorschlag } from '../js/annahmen.js';
import { baueBuchungen } from '../js/buchungen.js';
import { migriereDaten } from '../js/migrationen.js';

const heute = '2026-11-06';
const giro = { id: 'giro', name: 'Giro', anfangssaldoCent: 100000, stichtag: '2026-08-01', mindestsaldoCent: 50000 };
const tg = { id: 'tg', name: 'Tagesgeld', anfangssaldoCent: 0, stichtag: '2026-08-01', mindestsaldoCent: null };
const konten = [giro, tg];
const kategorien = [
  { id: 'wohnen', name: 'Wohnen', elternId: null, art: 'ausgabe' },
  { id: 'miete', name: 'Miete', elternId: 'wohnen' },
  { id: 'lebensm', name: 'Lebensmittel', elternId: null, art: 'ausgabe' },
  { id: 'super', name: 'Supermarkt', elternId: 'lebensm' },
  { id: 'eink', name: 'Einkommen', elternId: null, art: 'einnahme' },
  { id: 'gehalt', name: 'Gehalt', elternId: 'eink' },
];
const buchung = (art, cent, datum, extra = {}) => baueBuchungen(
  { art, betragCent: cent, datum, kontoId: 'giro', status: 'gebucht', notiz: '', ...extra }, { konten },
);

test('Datums-Helfer', () => {
  assert.equal(monatsende('2028-02-10'), '2028-02-29');
  assert.equal(plusMonate('2026-11', 3), '2027-02');
  assert.equal(plusMonate('2026-01', -1), '2025-12');
  assert.equal(plusTage('2026-12-29', 7), '2027-01-05');
});

test('Stufen: es gilt die letzte Stufe vor dem Zeitpunkt', () => {
  const stufen = [{ ab: '2026-03', betragCent: 45000 }, { ab: '2026-01', betragCent: 40000 }];
  assert.equal(betragAm(stufen, '2026-02'), 40000);
  assert.equal(betragAm(stufen, '2026-03'), 45000);
  assert.equal(betragAm(stufen, '2027-01'), 45000);
});

test('Budget je Monat: wiederkehrend mit Stufen, Ende, plus einmalig', () => {
  const budgets = [
    { kategorieId: 'lebensm', typ: 'wiederkehrend', kontoId: 'giro', startMonat: '2026-01', endMonat: '2026-12', stufen: [{ ab: '2026-01', betragCent: 40000 }, { ab: '2026-06', betragCent: 45000 }] },
    { kategorieId: 'lebensm', typ: 'einmalig', kontoId: 'tg', monat: '2026-12', betragCent: 10000 },
  ];
  assert.deepEqual(budgetFuerMonat(budgets, 'lebensm', '2025-12'), { betragCent: 0, kontoId: null, vorhanden: false });
  assert.equal(budgetFuerMonat(budgets, 'lebensm', '2026-05').betragCent, 40000);
  assert.deepEqual(budgetFuerMonat(budgets, 'lebensm', '2026-12'), { betragCent: 55000, kontoId: 'giro', vorhanden: true });
  assert.equal(budgetFuerMonat(budgets, 'lebensm', '2027-01').vorhanden, false);
});

test('Termine: Intervalle, Monatsende, Ende, Stufen, Ausnahmen', () => {
  const w = { start: '2026-01-31', intervall: 'monatlich', ende: '2026-05-31', stufen: [{ ab: '2026-01-31', betragCent: 100 }, { ab: '2026-04-01', betragCent: 200 }] };
  assert.deepEqual(termine(w, '2026-01-01', '2026-12-31').map((t) => t.datum), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  assert.deepEqual(termine(w, '2026-03-01', '2026-04-30').map((t) => t.betragCent), [100, 200]);

  const q = { start: '2026-02-15', intervall: 'vierteljaehrlich', stufen: [{ ab: '2026-02-15', betragCent: 5508 }] };
  assert.deepEqual(termine(q, '2026-01-01', '2027-03-01').map((t) => t.datum), ['2026-02-15', '2026-05-15', '2026-08-15', '2026-11-15', '2027-02-15']);
  const j = { start: '2024-02-29', intervall: 'jaehrlich', stufen: [{ ab: '2024-02-29', betragCent: 1 }] };
  assert.deepEqual(termine(j, '2025-01-01', '2028-12-31').map((t) => t.datum), ['2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);

  let m = { start: '2026-11-03', intervall: 'monatlich', stufen: [{ ab: '2026-11-03', betragCent: 95000 }] };
  m = mitAusnahme(m, '2026-12-03', 'ueberspringen');
  m = mitAusnahme(m, '2027-01-03', 'verschieben', '2026-12-28');
  const t = termine(m, '2026-12-01', '2026-12-31');
  assert.deepEqual(t.map((x) => [x.termin, x.datum, x.verschoben]), [['2027-01-03', '2026-12-28', true]]);
  assert.equal(naechsterTermin(m, '2026-11-04').termin, '2027-01-03');
  // Ausnahme wieder entfernen
  assert.equal(mitAusnahme(m, '2026-12-03', null).ausnahmen.length, 1);
});

test('Termine immer am Monatsletzten', () => {
  const w = { start: '2026-11-30', intervall: 'monatlich', monatsletzter: true, stufen: [{ ab: '2026-11-30', betragCent: 1 }] };
  assert.deepEqual(termine(w, '2026-11-01', '2027-03-31').map((t) => t.datum), ['2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31']);
  // Ohne Häkchen bleibt es beim 30.
  assert.deepEqual(termine({ ...w, monatsletzter: false }, '2026-12-01', '2027-03-31').map((t) => t.datum), ['2026-12-30', '2027-01-30', '2027-02-28', '2027-03-30']);
  // Bauen: Start wird auf den Monatsletzten gesetzt
  const gebaut = baueWiederkehrend({
    bezeichnung: 'Test', art: 'ausgabe', kontoId: 'giro', kategorieId: 'miete', intervall: 'monatlich',
    start: '2026-11-10', monatsletzter: true, ende: '', stufen: [{ ab: '', betragCent: 100 }],
  }, { konten, kategorien });
  assert.equal(gebaut.start, '2026-11-30');
  assert.equal(gebaut.monatsletzter, true);
  assert.equal(gebaut.stufen[0].ab, '2026-11-30');
});

test('Drei Kategorien für die Übersicht: gespeicherte Wahl, sonst größte Ausgaben', () => {
  const kats = [
    ...kategorien,
    { id: 'freizeit', name: 'Freizeit', elternId: null, art: 'ausgabe' },
    { id: 'alt', name: 'Alt', elternId: null, art: 'ausgabe', archiviert: true },
  ];
  const summen = new Map([['freizeit', 500], ['wohnen', 900]]);
  assert.deepEqual(kennzahlKategorien([], kats, summen), ['wohnen', 'freizeit', 'lebensm']);
  assert.deepEqual(kennzahlKategorien([{ id: 'uebersicht', kategorien: ['eink', 'alt'] }], kats, summen), ['eink', 'wohnen', 'freizeit']);
  const b = buchung('ausgabe', 1234, '2026-11-02', { kategorieId: 'super' });
  assert.equal(summenJeHauptkategorie(b, kategorien, '2026-11').get('lebensm'), 1234);
});

test('Offene Termine: erledigt durch verknüpfte Buchung, Fenster ab Vormonat bzw. Anlage', () => {
  const miete = { id: 'w1', art: 'ausgabe', kontoId: 'giro', kategorieId: 'miete', start: '2026-08-03', intervall: 'monatlich', stufen: [{ ab: '2026-08-03', betragCent: 95000 }], erstelltAm: '2026-08-01T00:00:00Z' };
  const buchungen = [
    ...buchung('ausgabe', 95000, '2026-10-03', { kategorieId: 'miete', wiederkehrendId: 'w1', faelligAm: '2026-10-03' }),
  ];
  const daten = { wiederkehrende: [miete], buchungen, konten };
  const offen = faelligListe(daten, heute);
  // Oktober erledigt, November (03.11.) offen und überfällig; Dezember noch zu weit weg
  assert.deepEqual(offen.map((t) => [t.termin, t.ueberfaellig]), [['2026-11-03', true]]);

  // Gerade erst angelegt → Oktober zählt nicht als offen
  const neu = { ...miete, erstelltAm: '2026-11-05T10:00:00Z' };
  assert.deepEqual(offeneTermine({ ...daten, wiederkehrende: [neu], buchungen: [] }, heute, '2026-11-30').map((t) => t.termin), ['2026-11-03']);
  // Gelöschte Buchung erledigt nichts
  const geloescht = [{ ...buchungen[0], geloeschtAm: 'X' }];
  assert.equal(offeneTermine({ ...daten, buchungen: geloescht }, heute, '2026-11-30').length, 2);
});

test('Termin-Wirkung je Konto', () => {
  const u = { art: 'umbuchung', kontoId: 'giro', gegenkontoId: 'tg' };
  assert.equal(terminWirkung(u, 100, 'giro'), -100);
  assert.equal(terminWirkung(u, 100, 'tg'), 100);
  assert.equal(terminWirkung({ art: 'einnahme', kontoId: 'giro' }, 100, 'tg'), 0);
});

test('Monatsprognose: Budgetrest, offene wiederkehrende, Mindestsaldo', () => {
  const wiederkehrende = [
    { id: 'gehalt', art: 'einnahme', kontoId: 'giro', kategorieId: 'gehalt', start: '2026-08-25', intervall: 'monatlich', stufen: [{ ab: '2026-08-25', betragCent: 300000 }], erstelltAm: '2026-08-01T00:00:00Z' },
    { id: 'miete', art: 'ausgabe', kontoId: 'giro', kategorieId: 'miete', start: '2026-08-03', intervall: 'monatlich', stufen: [{ ab: '2026-08-03', betragCent: 95000 }], erstelltAm: '2026-08-01T00:00:00Z' },
    { id: 'spar', art: 'umbuchung', kontoId: 'giro', gegenkontoId: 'tg', start: '2026-08-28', intervall: 'monatlich', stufen: [{ ab: '2026-08-28', betragCent: 20000 }], erstelltAm: '2026-08-01T00:00:00Z' },
  ];
  const budgets = [
    { kategorieId: 'lebensm', typ: 'wiederkehrend', kontoId: 'giro', startMonat: '2026-08', endMonat: null, stufen: [{ ab: '2026-08', betragCent: 40000 }] },
    { kategorieId: 'wohnen', typ: 'wiederkehrend', kontoId: 'giro', startMonat: '2026-08', endMonat: null, stufen: [{ ab: '2026-08', betragCent: 100000 }] },
  ];
  // Oktober: alles erledigt
  const buchungen = [
    ...buchung('einnahme', 300000, '2026-10-25', { kategorieId: 'gehalt', wiederkehrendId: 'gehalt', faelligAm: '2026-10-25' }),
    ...buchung('ausgabe', 95000, '2026-10-03', { kategorieId: 'miete', wiederkehrendId: 'miete', faelligAm: '2026-10-03' }),
    ...baueBuchungen({ art: 'umbuchung', betragCent: 20000, datum: '2026-10-28', kontoId: 'giro', gegenkontoId: 'tg', wiederkehrendId: 'spar', faelligAm: '2026-10-28' }, { konten }),
    // November bisher: Supermarkt 150 €
    ...buchung('ausgabe', 15000, '2026-11-04', { kategorieId: 'super' }),
  ];
  const p = monatsprognose({ konten, kategorien, buchungen, budgets, wiederkehrende }, heute);

  const giroHeute = 100000 + 300000 - 95000 - 20000 - 15000; // 270.000
  assert.equal(p.jeKonto.get('giro').heute, giroHeute);
  // Offen im November: Miete −950, Gehalt +3000, Sparrate −200; Budgetrest Lebensmittel 400−150 = 250;
  // Wohnen: Budget 1000, Ist 0 + offen 950 → Rest 50
  assert.equal(p.jeKonto.get('giro').prognose, giroHeute - 95000 + 300000 - 20000 - 25000 - 5000);
  assert.equal(p.jeKonto.get('tg').prognose, 20000 + 20000);
  // Aufschlüsselung je Konto
  const g = p.jeKonto.get('giro');
  assert.equal(g.offenWirkung, -95000 + 300000 - 20000);
  assert.equal(g.rest, 30000);
  assert.equal(g.prognose, g.endeEcht + g.offenWirkung - g.rest);
  assert.deepEqual(g.termine.map((t) => [t.wiederkehrend.id, t.wirkung]), [['miete', -95000], ['gehalt', 300000], ['spar', -20000]]);
  assert.deepEqual(g.budgets.map((b) => b.id).sort(), ['lebensm', 'wohnen']);
  assert.deepEqual(p.jeKonto.get('tg').termine.map((t) => t.wirkung), [20000]);
  assert.deepEqual(p.jeKonto.get('tg').budgets, []);
  assert.equal(p.gesamtPrognose, p.jeKonto.get('giro').prognose + p.jeKonto.get('tg').prognose);
  assert.equal(p.einnahmen, 0);
  assert.equal(p.ausgaben, 15000);

  const leb = p.kategorien.find((k) => k.id === 'lebensm');
  assert.deepEqual([leb.ist, leb.budget, leb.prognose, leb.rest], [15000, 40000, 40000, 25000]);
  const wohn = p.kategorien.find((k) => k.id === 'wohnen');
  assert.deepEqual([wohn.ist, wohn.offen, wohn.prognose, wohn.rest], [0, 95000, 100000, 5000]);
  assert.equal(p.groesste.id, 'lebensm');
  assert.deepEqual(p.warnungen, []);

  // Überzogenes Budget: Prognose = Ist (mindestens die echten Buchungen), kein Rest
  const viel = [...buchungen, ...buchung('ausgabe', 50000, '2026-11-05', { kategorieId: 'super' })];
  const p2 = monatsprognose({ konten, kategorien, buchungen: viel, budgets, wiederkehrende }, heute);
  const leb2 = p2.kategorien.find((k) => k.id === 'lebensm');
  assert.deepEqual([leb2.prognose, leb2.rest], [65000, 0]);

  // Mindestsaldo 5.000 € → bei hohem Mindestsaldo Warnung zum Monatsende bzw. heute
  const streng = konten.map((k) => (k.id === 'giro' ? { ...k, mindestsaldoCent: 400000 } : k));
  const p3 = monatsprognose({ konten: streng, kategorien, buchungen, budgets, wiederkehrende }, heute);
  assert.deepEqual(p3.warnungen.map((w) => [w.konto.id, w.wann]), [['giro', 'heute']]);
  const mittel = konten.map((k) => (k.id === 'giro' ? { ...k, mindestsaldoCent: 260000 } : k));
  const ohneGehalt = wiederkehrende.filter((w) => w.id !== 'gehalt');
  const p4 = monatsprognose({ konten: mittel, kategorien, buchungen, budgets, wiederkehrende: ohneGehalt }, heute);
  assert.deepEqual(p4.warnungen.map((w) => w.wann), ['monatsende']);
});

test('Budgethinweise: 3 Monate in Folge über bzw. unter Budget, Unterdrückung', () => {
  const budgets = [
    { kategorieId: 'lebensm', typ: 'wiederkehrend', kontoId: 'giro', startMonat: '2026-08', endMonat: null, stufen: [{ ab: '2026-08', betragCent: 40000 }] },
    { kategorieId: 'wohnen', typ: 'wiederkehrend', kontoId: 'giro', startMonat: '2026-08', endMonat: null, stufen: [{ ab: '2026-08', betragCent: 100000 }] },
  ];
  const b = [];
  for (const [monat, leb, wohn] of [['08', 46000, 95000], ['09', 48000, 95000], ['10', 50000, 95000]]) {
    b.push(...buchung('ausgabe', leb, `2026-${monat}-10`, { kategorieId: 'super' }));
    b.push(...buchung('ausgabe', wohn, `2026-${monat}-03`, { kategorieId: 'miete' }));
  }
  const daten = { kategorien, buchungen: b, budgets, hinweise: [], einstellungen: [{ id: 'hinweise', monate: 3, prozent: 10 }] };
  const h = budgetHinweise(daten, heute);
  // Lebensmittel: +15 %, +20 %, +25 % → Ø +20 % → Hinweis; Wohnen: −5 % → kein Hinweis
  assert.equal(h.length, 1);
  assert.equal(h[0].kategorie.id, 'lebensm');
  assert.equal(h[0].richtung, 'ueber');
  assert.ok(Math.abs(h[0].abweichung - 0.2) < 1e-9);
  assert.equal(h[0].vorschlagCent, 48000);
  assert.equal(h[0].bisMonat, '2026-10');

  // Schwelle 25 % → kein Hinweis
  assert.equal(budgetHinweise({ ...daten, einstellungen: [{ id: 'hinweise', monate: 3, prozent: 25 }] }, heute).length, 0);
  // Nur 2 Monate gefordert → weiter Hinweis
  assert.equal(budgetHinweise({ ...daten, einstellungen: [{ id: 'hinweise', monate: 2, prozent: 10 }] }, heute).length, 1);
  // Ein Monat unter Budget → nicht "in Folge"
  const gemischt = [...b, ...buchung('ausgabe', 1, '2026-09-11', { kategorieId: 'super' })].filter((x) => !(x.datum === '2026-09-10'));
  assert.equal(budgetHinweise({ ...daten, buchungen: gemischt }, heute).length, 0);

  // Später erinnern
  const spaeter = [{ kategorieId: 'lebensm', status: 'spaeter', erinnernAb: '2026-11-13', bisMonat: '2026-10' }];
  assert.equal(budgetHinweise({ ...daten, hinweise: spaeter }, heute).length, 0);
  assert.equal(budgetHinweise({ ...daten, hinweise: spaeter }, '2026-11-13').length, 1);
  // Abgelehnt: unterdrückt, solange sich das Fenster überschneidet
  const abgelehnt = [{ kategorieId: 'lebensm', status: 'abgelehnt', bisMonat: '2026-10' }];
  assert.equal(budgetHinweise({ ...daten, hinweise: abgelehnt }, heute).length, 0);
  // Zu wenig Daten (erste Buchung im September) → keine Auswertung
  assert.equal(budgetHinweise({ ...daten, buchungen: b.filter((x) => x.datum >= '2026-09') }, heute).length, 0);
});

test('Budget bauen und prüfen', () => {
  const ctx = { kategorien, budgets: [] };
  const b = baueBudget({ kategorieId: 'lebensm', kontoId: 'giro', typ: 'wiederkehrend', startMonat: '2026-11', endMonat: '', stufen: [{ ab: 'egal', betragCent: 40000 }, { ab: '2027-03', betragCent: 45000 }] }, ctx);
  assert.equal(b.stufen[0].ab, '2026-11');
  assert.equal(b.endMonat, null);
  assert.throws(() => baueBudget({ kategorieId: 'eink', kontoId: 'giro', typ: 'einmalig', monat: '2026-12', betragCent: 1 }, ctx), /Ausgaben/);
  assert.throws(() => baueBudget({ kategorieId: 'super', kontoId: 'giro', typ: 'einmalig', monat: '2026-12', betragCent: 1 }, ctx), /Hauptkategorie/);
  assert.throws(() => baueBudget({ kategorieId: 'lebensm', kontoId: 'giro', typ: 'wiederkehrend', startMonat: '2026-11', stufen: [{ ab: '', betragCent: 1 }] }, { kategorien, budgets: [b] }), /schon ein wiederkehrendes/);
  assert.throws(() => baueBudget({ kategorieId: 'lebensm', kontoId: 'giro', typ: 'wiederkehrend', startMonat: '2026-11', stufen: [{ ab: '', betragCent: 1 }, { ab: '2026-05', betragCent: 2 }] }, ctx), /vor dem Start/);
  assert.equal(baueBudget({ kategorieId: 'lebensm', kontoId: 'giro', typ: 'einmalig', monat: '2026-12', betragCent: 30000 }, ctx).betragCent, 30000);

  // Vorschlag übernehmen
  const mit = budgetMitVorschlag([b], { kategorieId: 'lebensm', abMonat: '2026-12', betragCent: 48000, kontoId: 'giro' });
  assert.deepEqual(mit.stufen.map((s) => [s.ab, s.betragCent]), [['2026-11', 40000], ['2026-12', 48000], ['2027-03', 45000]]);
  const neu = budgetMitVorschlag([], { kategorieId: 'wohnen', abMonat: '2026-12', betragCent: 90000, kontoId: 'giro' });
  assert.deepEqual([neu.typ, neu.startMonat, neu.stufen.length], ['wiederkehrend', '2026-12', 1]);
});

test('Wiederkehrende Buchung bauen und prüfen', () => {
  const ctx = { konten, kategorien };
  const w = baueWiederkehrend({ notiz: ' Miete ', art: 'ausgabe', kontoId: 'giro', kategorieId: 'miete', intervall: 'monatlich', start: '2026-11-03', ende: '', stufen: [{ ab: '', betragCent: 95000 }] }, ctx);
  assert.equal(w.notiz, 'Miete');
  assert.equal(w.bezeichnung, undefined, 'keine Pflicht-Bezeichnung mehr (D96)');
  assert.equal(baueWiederkehrend({ ...w, notiz: '', stufen: w.stufen }, ctx).notiz, '', 'Notiz ist optional');
  assert.equal(w.stufen[0].ab, '2026-11-03');
  assert.deepEqual(w.ausnahmen, []);
  assert.throws(() => baueWiederkehrend({ ...w, kategorieId: 'gehalt', stufen: w.stufen }, ctx), /passt nicht/);
  assert.throws(() => baueWiederkehrend({ ...w, ende: '2026-10-01', stufen: w.stufen }, ctx), /vor dem Start/);
  assert.throws(() => baueWiederkehrend({ ...w, art: 'umbuchung', gegenkontoId: 'giro', stufen: w.stufen }, ctx), /verschiedene/);
  assert.throws(() => baueWiederkehrend({ ...w, stufen: [{ ab: '', betragCent: -5 }] }, ctx), /größer 0/);
});

test('Migration 2 → 17', () => {
  const v2 = { version: 2, konten: [], kategorien: [], buchungen: [{ id: 'b' }], abstimmungen: [] };
  const { daten } = migriereDaten(v2);
  assert.equal(daten.version, 17);
  assert.deepEqual(daten.budgets, []);
  assert.deepEqual(daten.archive, []);
  assert.deepEqual(daten.wiederkehrend, []);
  assert.deepEqual(daten.geplant, []);
  assert.deepEqual(daten.projekte, []);
  assert.deepEqual(daten.relevant, []);
  assert.deepEqual(daten.vorlagen, [], 'Version 17: Vorlagen');
  assert.equal('szenarien' in daten, false);
  assert.deepEqual(daten.einstellungen, [{ id: 'hinweise', monate: 3, prozent: 10 }]);
  assert.deepEqual(daten.buchungen[0], {
    id: 'b', wiederkehrendId: null, faelligAm: null, geplantId: null, projektId: null, partner: '', relevant: false, relevantGruppe: '', budgetKategorieId: null,
  });
});

test('Migration 3 → 8: Annahmen bekommen Schalter', () => {
  const v3 = {
    version: 3, konten: [], kategorien: [], buchungen: [], abstimmungen: [], hinweise: [], einstellungen: [],
    budgets: [{ id: 'b1' }], wiederkehrend: [{ id: 'w1' }, { id: 'w2', aktiv: false, monatsletzter: true }],
  };
  const { daten } = migriereDaten(v3);
  assert.deepEqual(daten.budgets[0], { id: 'b1', aktiv: true });
  assert.deepEqual(daten.wiederkehrend[0], { id: 'w1', aktiv: true, monatsletzter: false, partner: '', kalenderMonate: [], notiz: '', budgetKategorieId: null });
  assert.equal(daten.wiederkehrend[1].aktiv, false, 'vorhandene Werte bleiben');
  assert.equal(daten.wiederkehrend[1].monatsletzter, true);
});

test('Migration 4 → 8: Szenarien entfallen, Posten ausgeschalteter Szenarien werden ausgeschaltet', () => {
  const v4 = {
    version: 4, konten: [], kategorien: [], buchungen: [{ id: 'b' }], abstimmungen: [], hinweise: [], einstellungen: [],
    szenarien: [{ id: 'aus', aktiv: false }, { id: 'an', aktiv: true }],
    budgets: [{ id: 'b1', aktiv: true, szenarioId: null }],
    wiederkehrend: [{ id: 'w1', aktiv: true, szenarioId: 'aus' }, { id: 'w2', aktiv: true, szenarioId: 'an' }],
    geplant: [{ id: 'g1', aktiv: true, szenarioId: 'aus' }],
  };
  const { daten } = migriereDaten(v4);
  assert.equal('szenarien' in daten, false);
  assert.deepEqual(daten.budgets[0], { id: 'b1', aktiv: true });
  assert.deepEqual(daten.wiederkehrend.map((w) => w.aktiv), [false, true]);
  assert.deepEqual(daten.geplant[0], { id: 'g1', aktiv: false, projektId: null, partner: '', budgetKategorieId: null });
  assert.equal(daten.buchungen[0].projektId, null);
});

test('Migration 5 → 6: Hauptkategorien Investitionen und Bargeldabhebung', () => {
  const sonstiges = { id: 'so', name: 'Sonstiges', elternId: null, art: 'ausgabe' };
  const bar = { id: 'bar', name: 'Bargeldabhebung', elternId: 'so', art: null };
  const v5 = { version: 5, kategorien: [sonstiges, bar, { id: 'g', name: 'Geschenke', elternId: 'so' }], buchungen: [{ id: 'b', kategorieId: 'bar' }] };
  const { daten } = migriereDaten(v5);
  const haupt = (name) => daten.kategorien.find((k) => !k.elternId && k.name === name);
  const inv = haupt('Investitionen');
  assert.equal(inv.art, 'ausgabe');
  assert.ok(daten.kategorien.some((k) => k.elternId === inv.id && k.name === 'ETF & Fonds'));
  const bh = haupt('Bargeldabhebung');
  assert.equal(bh.art, 'ausgabe');
  // Die alte Unterkategorie wandert mit ihrer ID – die Buchung hängt jetzt an "Bargeldabhebung"
  const umgehaengt = daten.kategorien.find((k) => k.id === 'bar');
  assert.deepEqual([umgehaengt.elternId, umgehaengt.name], [bh.id, 'Geldautomat']);
  assert.equal(daten.kategorien.filter((k) => k.elternId === bh.id).length, 1);

  // Gibt es die Hauptkategorien schon, ändert sich nichts
  const schon = { version: 5, kategorien: [{ id: 'i', name: 'investitionen', elternId: null, art: 'ausgabe' }, { id: 'x', name: 'Bargeld', elternId: null, art: 'ausgabe' }] };
  assert.equal(migriereDaten(schon).daten.kategorien.length, 2);
  // Ohne alte Unterkategorie: neue Hauptkategorie mit "Geldautomat"
  const leer = migriereDaten({ version: 5, kategorien: [] }).daten.kategorien;
  const bh2 = leer.find((k) => k.name === 'Bargeldabhebung');
  assert.ok(leer.some((k) => k.elternId === bh2.id && k.name === 'Geldautomat'));
});

test('Migration 6 → 7: wiederkehrende Budgets bekommen ausnahmen', () => {
  const { daten } = migriereDaten({ version: 6, kategorien: [], budgets: [{ id: 'w', typ: 'wiederkehrend' }, { id: 'e', typ: 'einmalig' }] });
  assert.deepEqual(daten.budgets[0].ausnahmen, []);
  assert.equal('ausnahmen' in daten.budgets[1], false);
});

test('Migration 7 → 8: Empfänger/Absender kommt dazu, vorhandene Werte bleiben', () => {
  const { daten } = migriereDaten({ version: 7, kategorien: [], buchungen: [{ id: 'a' }, { id: 'b', partner: 'X' }], wiederkehrend: [{ id: 'w' }], geplant: [{ id: 'g' }] });
  assert.deepEqual(daten.buchungen.map((b) => b.partner), ['', 'X']);
  assert.equal(daten.wiederkehrend[0].partner, '');
  assert.equal(daten.geplant[0].partner, '');
});
