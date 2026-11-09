import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STANDARD_FILTER, zeitraumFuer, filtere, sortiere, summen,
  monateZwischen, monateDerAuswertung, ersterErfassterTag, abgeschlosseneMonate, verlaufJeMonat, summenJeKategorie, schoeneObergrenze,
} from '../js/auswertung.js';
import { baueBuchungen } from '../js/buchungen.js';

const heute = '2026-11-06';
const konten = [
  { id: 'giro', name: 'Giro', anfangssaldoCent: 0, stichtag: '2026-01-01' },
  { id: 'tg', name: 'Tagesgeld', anfangssaldoCent: 0, stichtag: '2026-01-01' },
];
const kategorien = [
  { id: 'wohnen', name: 'Wohnen', elternId: null, art: 'ausgabe' },
  { id: 'miete', name: 'Miete', elternId: 'wohnen' },
  { id: 'strom', name: 'Strom', elternId: 'wohnen' },
  { id: 'lebensm', name: 'Lebensmittel', elternId: null, art: 'ausgabe' },
  { id: 'super', name: 'Supermarkt', elternId: 'lebensm' },
  { id: 'eink', name: 'Einkommen', elternId: null, art: 'einnahme' },
  { id: 'gehalt', name: 'Gehalt', elternId: 'eink' },
];
let zaehler = 0;
const b = (art, cent, datum, extra = {}) => baueBuchungen(
  { art, betragCent: cent, datum, kontoId: 'giro', status: 'gebucht', notiz: '', ...extra },
  { konten, jetzt: `T${String(++zaehler).padStart(3, '0')}` },
);

const daten = [
  ...b('einnahme', 300000, '2026-10-01', { kategorieId: 'gehalt' }),
  ...b('ausgabe', 95000, '2026-10-03', { kategorieId: 'miete' }),
  ...b('ausgabe', 6000, '2026-10-10', { kategorieId: 'super', notiz: 'Wocheneinkauf' }),
  ...b('einnahme', 300000, '2026-11-01', { kategorieId: 'gehalt' }),
  ...b('ausgabe', 95000, '2026-11-03', { kategorieId: 'miete' }),
  ...b('ausgabe', 8500, '2026-11-03', { kategorieId: 'strom', status: 'vorgemerkt' }),
  ...b('ausgabe', 4000, '2026-11-05', { kategorieId: 'super' }),
  ...b('umbuchung', 20000, '2026-11-02', { gegenkontoId: 'tg' }),
  { ...b('ausgabe', 99900, '2026-11-04', { kategorieId: 'super' })[0], geloeschtAm: 'X' },
];
const ctx = { kategorien, konten, heute };
// Filterlogik mit jedem Status und – wie früher als Standard – im laufenden Monat prüfen
const f = (aenderung) => ({ ...STANDARD_FILTER, zeitraum: 'monat', status: [], arten: [], ...aenderung });

test('Zeiträume', () => {
  assert.deepEqual(zeitraumFuer(f({ zeitraum: 'monat' }), heute), { von: '2026-11-01', bis: '2026-11-30' });
  assert.deepEqual(zeitraumFuer(f({ zeitraum: 'vormonat' }), '2026-01-15'), { von: '2025-12-01', bis: '2025-12-31' });
  assert.deepEqual(zeitraumFuer(f({ zeitraum: 'monat' }), '2028-02-10'), { von: '2028-02-01', bis: '2028-02-29' });
  assert.deepEqual(zeitraumFuer(f({ zeitraum: 'vorjahr' }), heute), { von: '2025-01-01', bis: '2025-12-31' });
  assert.deepEqual(zeitraumFuer(f({ zeitraum: 'alles' }), heute), { von: '', bis: '' });
  assert.deepEqual(zeitraumFuer(f({ zeitraum: 'eigen', von: '2026-10-05' }), heute), { von: '2026-10-05', bis: '' });
});

test('Standard: dieser Monat, Papierkorb fehlt, Umbuchung einmal mit Wirkung 0', () => {
  const e = filtere(daten, f({}), ctx);
  assert.equal(e.length, 5);
  const u = e.find((x) => x.buchung.art === 'umbuchung');
  assert.equal(u.buchung.richtung, 'ab');
  assert.equal(u.wirkung, 0);
});

test('Kontofilter zeigt Umbuchung aus Sicht des Kontos', () => {
  const e = filtere(daten, f({ zeitraum: 'alles', kontoIds: ['tg'] }), ctx);
  assert.equal(e.length, 1);
  assert.equal(e[0].wirkung, 20000);
});

test('Einzelne Filter', () => {
  const alles = { zeitraum: 'alles' };
  assert.equal(filtere(daten, f({ ...alles, arten: ['einnahme'] }), ctx).length, 2);
  assert.equal(filtere(daten, f({ ...alles, kategorieIds: ['wohnen'] }), ctx).length, 3, 'Hauptkategorie umfasst Unterkategorien');
  assert.equal(filtere(daten, f({ ...alles, kategorieIds: ['strom'] }), ctx).length, 1);
  assert.equal(filtere(daten, f({ ...alles, status: ['vorgemerkt'] }), ctx).length, 1);
  assert.equal(filtere(daten, f({ ...alles, betragMin: 5000, betragMax: 10000 }), ctx).length, 2);
  assert.equal(filtere(daten, f({ ...alles, suche: 'WOCHEN' }), ctx).length, 1, 'Suche in Notiz, ohne Groß/klein');
  assert.equal(filtere(daten, f({ ...alles, suche: 'lebensmittel' }), ctx).length, 2, 'Suche im Kategorienamen');
  assert.equal(filtere(daten, f({ ...alles, suche: 'tagesgeld' }), ctx).length, 1, 'Suche im Gegenkonto');
  assert.equal(filtere(daten, f({ ...alles, ohneBeleg: true }), ctx).length, 8);
  const mitBeleg = [{ ...daten[0], belege: [{ id: 'x' }] }, ...daten.slice(1)];
  assert.equal(filtere(mitBeleg, f({ ...alles, ohneBeleg: true }), ctx).length, 7);
});

test('Sortierung', () => {
  const e = filtere(daten, f({ zeitraum: 'alles' }), ctx);
  const datumAb = sortiere(e, { feld: 'datum', richtung: 'ab' });
  assert.equal(datumAb[0].buchung.datum, '2026-11-05');
  assert.equal(datumAb.at(-1).buchung.datum, '2026-10-01');
  const betragAb = sortiere(e, { feld: 'betrag', richtung: 'ab' });
  assert.equal(betragAb[0].buchung.betragCent, 300000);
  assert.equal(betragAb[0].buchung.datum, '2026-11-01', 'Gleichstand → neueres Datum zuerst');
  const katAuf = sortiere(e, { feld: 'kategorie', richtung: 'auf' }, ctx);
  assert.equal(katAuf[0].buchung.kategorieId, 'gehalt');
  // Gleicher Tag: zuletzt erfasst zuerst
  const tag = sortiere(filtere(daten, f({ zeitraum: 'eigen', von: '2026-11-03', bis: '2026-11-03' }), ctx), { feld: 'datum', richtung: 'ab' });
  assert.deepEqual(tag.map((x) => x.buchung.kategorieId), ['strom', 'miete']);
});

test('Summen ohne Umbuchungen', () => {
  const s = summen(filtere(daten, f({}), ctx));
  // D120: Anzahl, Summe und Ø nur über Einnahmen und Ausgaben; die Umbuchung wird extra gezählt
  assert.deepEqual(s, {
    anzahl: 4, anzahlUmbuchungen: 1, einnahmen: 300000, ausgaben: 107500, saldo: 192500, summe: 192500, umbuchungen: 0, schnitt: 48125,
  });
  const giro = summen(filtere(daten, f({ kontoIds: ['giro'] }), ctx));
  assert.equal(giro.umbuchungen, -20000);
  assert.equal(giro.ausgaben, 107500);
  const nurAusgaben = summen(filtere(daten, f({ arten: ['ausgabe'] }), ctx));
  assert.equal(nurAusgaben.summe, -107500);
  assert.equal(nurAusgaben.schnitt, Math.round(-107500 / nurAusgaben.anzahl), 'Ø je Ausgabe');
  assert.equal(summen([]).schnitt, null, 'ohne Buchungen kein Ø');
});

test('Standardfilter: nur gebuchte, vorgemerkte erst über den Statusfilter (D120)', () => {
  const standard = filtere(daten, { ...STANDARD_FILTER, zeitraum: 'alles' }, ctx);
  assert.ok(standard.every((e) => e.buchung.status === 'gebucht'));
  const alle = filtere(daten, { ...STANDARD_FILTER, zeitraum: 'alles', status: [] }, ctx);
  assert.equal(alle.length - standard.length, 1, 'die eine vorgemerkte Buchung');
});

test('Monate und Verlauf', () => {
  assert.deepEqual(monateZwischen('2025-11-20', '2026-02-01'), [[2025, 11], [2025, 12], [2026, 1], [2026, 2]]);
  const e = filtere(daten, f({ zeitraum: 'alles' }), ctx);
  const erster = ersterErfassterTag(daten);
  assert.equal(erster, '2026-10-01');
  const monate = monateDerAuswertung(e, f({ zeitraum: 'alles' }), heute, erster);
  assert.deepEqual(monate, [[2026, 10], [2026, 11]]);
  // Ohne erfasste Buchungen: keine Monate
  assert.deepEqual(monateDerAuswertung([], f({ zeitraum: 'alles' }), heute, null), []);
  // "Dieses Jahr": beginnt beim ersten erfassten Monat, endet beim aktuellen Monat
  assert.deepEqual(monateDerAuswertung(e, f({ zeitraum: 'jahr' }), heute, erster), [[2026, 10], [2026, 11]]);
  // Seltene Kategorie: Monate trotzdem ab Erfassungsbeginn
  const nurStrom = filtere(daten, f({ zeitraum: 'alles', kategorieIds: ['strom'] }), ctx);
  assert.deepEqual(monateDerAuswertung(nurStrom, f({ zeitraum: 'alles' }), heute, erster), [[2026, 10], [2026, 11]]);
  // Eigener Zeitraum innerhalb der Daten bleibt unverändert
  assert.deepEqual(monateDerAuswertung(e, f({ zeitraum: 'eigen', von: '2026-11-01', bis: '2026-11-30' }), heute, erster), [[2026, 11]]);
  // Vorjahr ohne Daten: nichts
  assert.deepEqual(monateDerAuswertung([], f({ zeitraum: 'vorjahr' }), heute, erster), []);
  // Nach 14 erfassten Monaten umfasst "Alles" 14 Monate
  assert.equal(monateDerAuswertung(e, f({ zeitraum: 'alles' }), heute, '2025-10-15').length, 14);
  // Kontofilter: Erfassungsbeginn dieses Kontos
  assert.equal(ersterErfassterTag(daten, { kontoIds: ['tg'] }), '2026-11-02');

  const v = verlaufJeMonat(e, monate);
  assert.deepEqual(v[0], { jahr: 2026, monat: 10, einnahmen: 300000, ausgaben: 101000, saldo: 199000 });
  assert.equal(v[1].ausgaben, 107500);
});

test('Summen je Kategorie mit Anteil und Durchschnitt', () => {
  const e = filtere(daten, f({ zeitraum: 'alles' }), ctx);
  // Ø nur aus abgeschlossenen Monaten: heute = November → nur Oktober zählt
  const schnittMonate = abgeschlosseneMonate([[2026, 10], [2026, 11]], heute);
  assert.deepEqual(schnittMonate, [[2026, 10]]);
  const s = summenJeKategorie(e, kategorien, 'ausgabe', schnittMonate);
  assert.deepEqual(s.map((x) => x.name), ['Wohnen', 'Lebensmittel']);
  assert.equal(s[0].summe, 198500, 'Summe enthält weiter alle Monate');
  assert.equal(s[0].schnitt, 95000, 'Ø ohne laufenden Monat (nur Oktober-Miete)');
  assert.equal(s[0].unter.find((u) => u.name === 'Strom').schnitt, 0, 'Strom gab es nur im November');
  assert.ok(Math.abs(s[0].anteil + s[1].anteil - 1) < 1e-9);
  // D129: Unterkategorien – Anteil an ihrer Hauptkategorie, zusammen 100 %
  for (const g of s) assert.ok(Math.abs(g.unter.reduce((x, u) => x + u.anteil, 0) - 1) < 1e-9);
  assert.deepEqual(s[0].unter.map((u) => u.name), ['Miete', 'Strom']);
  assert.deepEqual(summenJeKategorie(e, kategorien, 'einnahme', schnittMonate)[0].summe, 600000);
  // Ohne abgeschlossene Monate: kein Ø
  assert.equal(summenJeKategorie(e, kategorien, 'ausgabe', [])[0].schnitt, null);
  // Zwei abgeschlossene Monate
  const zwei = summenJeKategorie(e, kategorien, 'ausgabe', [[2026, 10], [2026, 11]]);
  assert.equal(zwei[0].schnitt, 99250);
});

test('Schöne Achsengrenze', () => {
  assert.equal(schoeneObergrenze(3712), 5000);
  assert.equal(schoeneObergrenze(180), 200);
  assert.equal(schoeneObergrenze(1000), 1000);
  assert.equal(schoeneObergrenze(0), 1);
});

test('Empfänger/Absender: Filter, Suche, Sortierung, Liste und Summen', async () => {
  const { OHNE_PARTNER, partnerListe, summenJePartner } = await import('../js/auswertung.js');
  const b = (id, datum, art, cent, partner, extra = {}) => ({ id, datum, art, betragCent: cent, partner, kontoId: 'giro', kategorieId: 'super', status: 'gebucht', belege: [], notiz: '', ...extra });
  const buchungen = [
    b('1', '2026-10-02', 'ausgabe', 1000, 'Supermarkt Muster'),
    b('2', '2026-10-05', 'ausgabe', 2000, 'supermarkt muster '),
    b('3', '2026-10-07', 'ausgabe', 500, ''),
    b('4', '2026-10-08', 'einnahme', 9000, 'Muster GmbH'),
    b('5', '2026-10-09', 'umbuchung', 300, '', { richtung: 'ab', gegenkontoId: 'tg' }),
  ];
  const ctx = { heute: '2026-10-20' };
  const mit = (f) => filtere(buchungen, { ...STANDARD_FILTER, arten: [], zeitraum: 'alles', ...f }, ctx).map((e) => e.buchung.id);
  assert.deepEqual(mit({ partner: ['SUPERMARKT muster'] }).sort(), ['1', '2'], 'Groß/klein und Leerzeichen egal');
  assert.deepEqual(mit({ partner: [OHNE_PARTNER] }), ['3'], 'ohne Angabe – Umbuchungen nicht');
  assert.deepEqual(mit({ suche: 'gmbh' }), ['4']);
  const sortiert = sortiere(filtere(buchungen, { ...STANDARD_FILTER, arten: [], zeitraum: 'alles' }, ctx), { feld: 'partner', richtung: 'auf' });
  assert.deepEqual(sortiert.map((e) => e.buchung.id).slice(0, 3), ['4', '2', '1'], 'gleicher Name: neueste zuerst (D102)');

  const liste = partnerListe(buchungen);
  assert.deepEqual(liste.map((p) => [p.name, p.anzahl]), [['supermarkt muster', 2], ['Muster GmbH', 1]], 'jüngste Schreibweise, häufigste zuerst');

  const s = summenJePartner(filtere(buchungen, { ...STANDARD_FILTER, zeitraum: 'alles' }, ctx), 'ausgabe', [[2026, 10]]);
  assert.deepEqual(s.map((x) => [x.id, x.summe, x.anzahl]), [['supermarkt muster', 3000, 2], [OHNE_PARTNER, 500, 1]]);
  assert.equal(s[1].name, 'Ohne Angabe');
  assert.equal(s[0].schnitt, 3000);
});

test('Mehrfachauswahl in den Filtern (D72)', () => {
  const alles = { zeitraum: 'alles' };
  const n = (x) => filtere(daten, f({ ...alles, ...x }), ctx).length;
  assert.equal(n({ arten: ['einnahme', 'umbuchung'] }), 3, 'zwei Arten');
  assert.equal(n({ kategorieIds: ['strom', 'super'] }), 3, 'zwei Unterkategorien');
  assert.equal(n({ kategorieIds: ['wohnen', 'gehalt'] }), 5, 'Hauptkategorie + Unterkategorie');
  assert.equal(n({ status: ['gebucht', 'vorgemerkt'] }), 8, 'beide Status = alle');
  // Beide Konten gewählt: Umbuchung zwischen ihnen einmal und ohne Wirkung
  const beide = filtere(daten, f({ ...alles, kontoIds: ['giro', 'tg'] }), ctx);
  const u = beide.filter((x) => x.buchung.art === 'umbuchung');
  assert.equal(u.length, 1);
  assert.equal(u[0].wirkung, 0);
  assert.equal(beide.length, 8);
  assert.equal(summen(beide).umbuchungen, 0);
  assert.equal(ersterErfassterTag(daten, { kontoIds: ['giro', 'tg'] }), '2026-10-01');
});

test('Mehrfachauswahl Empfänger/Absender', async () => {
  const { OHNE_PARTNER } = await import('../js/auswertung.js');
  const b = (id, partner) => ({ id, datum: '2026-10-02', art: 'ausgabe', betragCent: 100, partner, kontoId: 'giro', kategorieId: 'super', status: 'gebucht', belege: [], notiz: '' });
  const buchungen = [b('1', 'Bäcker'), b('2', 'Metzger'), b('3', ''), b('4', 'Kiosk')];
  const ids = (partner) => filtere(buchungen, { ...STANDARD_FILTER, zeitraum: 'alles', partner }, { heute: '2026-10-20' }).map((e) => e.buchung.id);
  assert.deepEqual(ids(['bäcker', 'Metzger']), ['1', '2']);
  assert.deepEqual(ids(['Kiosk', OHNE_PARTNER]), ['3', '4']);
});

test('Sortierung per Spaltenkopf: immer genau eine Spalte (D103)', async () => {
  const { sortiereNach, STANDARD_SORTIERUNG } = await import('../js/auswertung.js');
  let s = sortiereNach(STANDARD_SORTIERUNG, 'kategorie');
  assert.deepEqual(s.stufen, [{ feld: 'kategorie', richtung: 'auf' }], 'Texte zuerst A–Z');
  s = sortiereNach(s, 'betrag');
  assert.deepEqual(s.stufen, [{ feld: 'betrag', richtung: 'ab' }], 'Zahlen zuerst absteigend, nur eine Stufe');
  s = sortiereNach(s, 'betrag');
  assert.deepEqual(s.stufen, [{ feld: 'betrag', richtung: 'auf' }], 'gleiche Spalte erneut: Richtung umdrehen');
  s = sortiereNach(s, 'datum');
  assert.deepEqual(s.stufen, [{ feld: 'datum', richtung: 'ab' }]);
  assert.equal(STANDARD_SORTIERUNG.stufen.length, 1, 'Standard bleibt unverändert');

  // Sortieren: Kategorie A–Z, innerhalb gleicher Kategorie Betrag absteigend
  const e = filtere(daten, f({ zeitraum: 'alles' }), ctx).filter((x) => x.buchung.art === 'ausgabe');
  const r = sortiere(e, { stufen: [{ feld: 'kategorie', richtung: 'auf' }, { feld: 'betrag', richtung: 'ab' }] }, ctx);
  assert.deepEqual(r.map((x) => [x.buchung.kategorieId, x.buchung.betragCent]),
    [['super', 4000], ['super', 6000], ['miete', 95000], ['miete', 95000], ['strom', 8500]]);
  // Betrag mit Vorzeichen: aufsteigend = größte Ausgabe zuerst
  const auf = sortiere(filtere(daten, f({ zeitraum: 'alles' }), ctx), { stufen: [{ feld: 'betrag', richtung: 'auf' }] });
  assert.equal(auf[0].wirkung, -95000);
  assert.equal(auf.at(-1).wirkung, 300000);
});

test('Datum nach Betrag: Datum entscheidet, Richtung lässt sich umschalten (D102)', async () => {
  const { sortiereNach, STANDARD_SORTIERUNG } = await import('../js/auswertung.js');
  const b = (id, datum, cent) => ({ buchung: { id, datum, betragCent: cent, art: 'ausgabe', erstelltAm: `${datum}T10:00:00Z` }, wirkung: -cent });
  const e = [b('a', '2026-10-01', 500), b('b', '2026-10-03', 100), b('c', '2026-10-02', 900), b('d', '2026-10-03', 700)];
  const ids = (s) => sortiere(e, s).map((x) => x.buchung.id).join('');
  // Klickfolge: Betrag, Datum, Datum, Datum
  let s = sortiereNach(STANDARD_SORTIERUNG, 'betrag');
  assert.equal(ids(s), 'badc', 'Betrag ↓ (kleinste Ausgabe zuerst)');
  s = sortiereNach(s, 'datum');
  assert.deepEqual(s.stufen, [{ feld: 'datum', richtung: 'ab' }]);
  assert.equal(ids(s), 'dbca', 'Datum ↓, am selben Tag nach Erfassung/ID');
  s = sortiereNach(s, 'datum');
  assert.equal(ids(s), 'acbd', 'Datum ↑');
  s = sortiereNach(s, 'datum');
  assert.equal(ids(s), 'dbca', 'wieder Datum ↓');
  // Ohne Datums-Stufe: bei Gleichstand neueste zuerst
  const gleich = [b('x', '2026-10-01', 100), b('y', '2026-10-05', 100)];
  assert.deepEqual(sortiere(gleich, { stufen: [{ feld: 'betrag', richtung: 'auf' }] }).map((x) => x.buchung.id), ['y', 'x']);
});


test('Sparquote und Vorjahr je Monat (D107)', async () => {
  const { sparquote, vorjahrJeMonat } = await import('../js/auswertung.js');
  assert.equal(sparquote(300000, 240000), 0.2);
  assert.equal(sparquote(100000, 150000), -0.5, 'mehr ausgegeben als eingenommen');
  assert.equal(sparquote(0, 5000), null, 'ohne Einnahmen keine Quote');
  const e = (datum, art, cent) => ({ buchung: { datum, art, betragCent: cent }, wirkung: art === 'einnahme' ? cent : -cent });
  const alle = [e('2025-10-05', 'ausgabe', 1000), e('2025-11-02', 'einnahme', 5000), e('2025-11-03', 'umbuchung', 999), e('2026-10-05', 'ausgabe', 2000)];
  const vj = vorjahrJeMonat(alle, [[2026, 9], [2026, 10], [2026, 11]], '2025-10-01');
  assert.equal(vj[0], null, 'September 2025: vor der ersten Buchung → nicht erfasst');
  assert.deepEqual(vj[1], { jahr: 2025, monat: 10, einnahmen: 0, ausgaben: 1000, saldo: -1000 });
  assert.deepEqual(vj[2], { jahr: 2025, monat: 11, einnahmen: 5000, ausgaben: 0, saldo: 5000 }, 'Umbuchung zählt nicht');
});

test('Nur Buchungen bis heute (D121)', () => {
  const zukunft = [...daten, { id: 'z', datum: '2026-11-25', art: 'ausgabe', betragCent: 999, kontoId: 'giro', kategorieId: 'super', status: 'gebucht', belege: [], notiz: '' }];
  const ids = filtere(zukunft, f({}), ctx).map((e) => e.buchung.id);
  assert.ok(!ids.includes('z'), 'erfasste Buchung mit späterem Datum fehlt');
  assert.ok(ctx.heute < '2026-11-25');
});

test('Zeitraum: Standard „Alles“, „Letzte 3 Monate“ = drei abgeschlossene Monate (D122)', () => {
  assert.equal(STANDARD_FILTER.zeitraum, 'alles');
  assert.deepEqual(zeitraumFuer({ zeitraum: 'letzte3' }, '2026-11-09'), { von: '2026-08-01', bis: '2026-10-31' });
  assert.deepEqual(zeitraumFuer({ zeitraum: 'letzte3' }, '2027-02-15'), { von: '2026-11-01', bis: '2027-01-31' }, 'über den Jahreswechsel');
  assert.deepEqual(zeitraumFuer({ zeitraum: 'letzte3' }, '2027-03-31'), { von: '2026-12-01', bis: '2027-02-28' }, 'Februar endet am 28.');
});

test('Standard-Art: nur Ausgaben (D126)', () => {
  assert.deepEqual([...STANDARD_FILTER.arten], ['ausgabe']);
  const e = filtere(daten, { ...STANDARD_FILTER, zeitraum: 'alles', status: [] }, ctx);
  assert.ok(e.length > 0 && e.every((x) => x.buchung.art === 'ausgabe'));
});
