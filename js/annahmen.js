// Budgets, wiederkehrende Buchungen, Hinweis-Status und Einstellungen:
// Prüfen, Datensätze bauen (reine Funktionen) und speichern.
//
// Datensatz Budget (Datenversion 3):
// Alle Annahmen haben ab Datenversion 4 zusätzlich: aktiv (Ein/Aus-Schalter, Standard true).
// (Die Szenarien aus Datenversion 4 sind mit Version 5 entfallen, D51.)
//
// { id, kategorieId (Hauptkategorie, Art "ausgabe"), kontoId (belastetes Konto),
//   typ: 'wiederkehrend' | 'einmalig',
//   startMonat "JJJJ-MM", endMonat "JJJJ-MM"|null, stufen: [{ ab "JJJJ-MM", betragCent }]  // wiederkehrend
//   ausnahmen: [{ monat "JJJJ-MM", betragCent }]  // wiederkehrend, ab Version 7: nur dieser Monat anders
//   kalenderMonate: [{ monat 1..12, betragCent }]  // wiederkehrend, ab Version 13 (D92): jedes Jahr fester Betrag
//   monat "JJJJ-MM", betragCent                                                       // einmalig
//   ab Datenversion 12 (D90) auch typ 'jaehrlich':
//   startJahr, endJahr|null, verteilung: 'zeitpunkt'|'halbjahr'|'quartal', betragCent (pro Jahr),
//   zeitpunktMonat 1..12 (nur 'zeitpunkt'), quartaleCent [Q1, Q2, Q3, Q4] (nur 'quartal', Summe = betragCent)
//   notiz, erstelltAm, geaendertAm, testdaten? }
//
// Datensatz Wiederkehrende Buchung (Datenversion 3):
// { id, notiz (optional, ab Version 15 statt "bezeichnung", D96), art: 'einnahme'|'ausgabe'|'umbuchung', kontoId, gegenkontoId, kategorieId,
//   intervall: 'monatlich'|'vierteljaehrlich'|'jaehrlich', start "JJJJ-MM-TT", ende "JJJJ-MM-TT"|null,
//   monatsletzter: true|false  // true = jeder Termin am letzten Tag des Monats (fehlt = false)
//   stufen: [{ ab "JJJJ-MM-TT", betragCent }],
//   ausnahmen: [{ termin, aktion: 'ueberspringen'|'verschieben'|'aendern', neuesDatum?, betragCent? }],
//   partner (ab Version 8, Empfänger/Absender), erstelltAm, geaendertAm, testdaten? }

import * as db from './db.js';
import { istGueltigesDatum, formatDatum } from './format.js';
import { STANDARD_EINSTELLUNGEN } from './migrationen.js';
import { monatsende, betragAm, regelBetrag, terminBetrag } from './prognose.js';
import { istJaehrlich, budgetZeitraum, ueberschneiden } from './jahresbudget.js';

/** Empfänger/Absender (Datenversion 8): undefined = unverändert, bei Umbuchungen leer */
const partnerVon = (eingabe, alt) => (eingabe.art === 'umbuchung' ? ''
  : (eingabe.partner === undefined ? alt?.partner ?? '' : String(eingabe.partner ?? '').trim()).slice(0, 80));

const istMonat = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m ?? '');

function pruefeStufen(stufen, start, istGueltig, art) {
  if (!stufen?.length) throw new Error('Bitte einen Betrag eingeben.');
  const gesehen = new Set();
  for (const s of stufen) {
    if (!istGueltig(s.ab)) throw new Error(`Bitte für jede Betragsänderung ein gültiges ${art} angeben.`);
    if (s.ab < start) throw new Error('Eine Betragsänderung liegt vor dem Start.');
    if (gesehen.has(s.ab)) throw new Error('Zwei Betragsänderungen haben dasselbe Datum.');
    gesehen.add(s.ab);
    if (s.betragCent == null || s.betragCent <= 0) throw new Error('Bitte nur Beträge größer 0 eingeben (ohne Minus).');
  }
  return [...stufen].sort((a, b) => a.ab.localeCompare(b.ab));
}

/* ======================= Budget ======================= */

export function baueBudget(eingabe, kontext) {
  const neu = baueBudgetDatensatz(eingabe, kontext);
  // Pro Kategorie und Konto entweder Monats- oder Jahresbudget im selben Zeitraum (D90)
  const konflikt = kontext.budgets.find((b) => b.id !== neu.id && b.kategorieId === neu.kategorieId && b.kontoId === neu.kontoId
    && (istJaehrlich(b) || istJaehrlich(neu)) && ueberschneiden(budgetZeitraum(b), budgetZeitraum(neu)));
  if (konflikt) {
    const name = kontext.kategorien.find((k) => k.id === neu.kategorieId)?.name ?? '?';
    throw new Error(istJaehrlich(konflikt)
      ? `Für „${name}“ gibt es auf diesem Konto im selben Zeitraum schon ein Jahresbudget. Pro Kategorie und Konto gilt entweder ein Monats- oder ein Jahresbudget.`
      : `Für „${name}“ gibt es auf diesem Konto im selben Zeitraum schon ein Monatsbudget. Pro Kategorie und Konto gilt entweder ein Monats- oder ein Jahresbudget.`);
  }
  return neu;
}

function baueBudgetDatensatz(eingabe, { kategorien, budgets, alt = null, jetzt = new Date().toISOString() }) {
  const hk = kategorien.find((k) => k.id === eingabe.kategorieId);
  if (!hk || hk.elternId) throw new Error('Bitte eine Hauptkategorie wählen.');
  if (hk.art !== 'ausgabe') throw new Error('Budgets gibt es nur für Ausgaben-Kategorien.');
  if (!eingabe.kontoId) throw new Error('Bitte das belastete Konto wählen.');

  const basis = {
    id: alt?.id ?? crypto.randomUUID(),
    kategorieId: hk.id,
    kontoId: eingabe.kontoId,
    typ: eingabe.typ,
    notiz: (eingabe.notiz ?? '').trim(),
    aktiv: eingabe.aktiv ?? alt?.aktiv ?? true,
    erstelltAm: alt?.erstelltAm ?? jetzt,
    geaendertAm: jetzt,
    ...(alt?.testdaten ? { testdaten: true } : {}),
  };

  if (eingabe.typ === 'einmalig') {
    if (!istMonat(eingabe.monat)) throw new Error('Bitte den Monat wählen.');
    if (eingabe.betragCent == null || eingabe.betragCent <= 0) throw new Error('Bitte einen Betrag größer 0 eingeben.');
    return { ...basis, monat: eingabe.monat, betragCent: eingabe.betragCent };
  }
  if (eingabe.typ === 'jaehrlich') return { ...basis, ...jahresFelder(eingabe) };
  if (eingabe.typ !== 'wiederkehrend') throw new Error('Bitte monatlich, jährlich oder einmalig wählen.');
  if (!istMonat(eingabe.startMonat)) throw new Error('Bitte den Startmonat wählen.');
  if (eingabe.endMonat && !istMonat(eingabe.endMonat)) throw new Error('Der Endmonat ist ungültig.');
  if (eingabe.endMonat && eingabe.endMonat < eingabe.startMonat) throw new Error('Der Endmonat liegt vor dem Startmonat.');
  // Je Konto ein wiederkehrendes Budget pro Hauptkategorie (D85)
  if (budgets.some((b) => b.id !== basis.id && b.typ === 'wiederkehrend' && b.kategorieId === hk.id && b.kontoId === basis.kontoId)) {
    throw new Error(`Für „${hk.name}“ gibt es auf diesem Konto schon ein wiederkehrendes Budget. Ändere dort den Betrag ab einem Monat.`);
  }
  // Die erste Stufe beginnt immer mit dem Startmonat
  const stufen = [...eingabe.stufen];
  if (stufen.length) stufen[0] = { ...stufen[0], ab: eingabe.startMonat };
  return {
    ...basis,
    startMonat: eingabe.startMonat,
    endMonat: eingabe.endMonat || null,
    stufen: pruefeStufen(stufen, eingabe.startMonat, istMonat, 'Monat'),
    ausnahmen: alt?.ausnahmen ?? [], // einzelne Monate mit anderem Betrag (Datenversion 7)
    kalenderMonate: eingabe.kalenderMonate === undefined ? (alt?.kalenderMonate ?? []) : pruefeKalenderMonate(eingabe.kalenderMonate),
  };
}

/** Feste Abweichungen je Kalendermonat prüfen (D92): [{ monat 1..12, betragCent ≥ 0 }], je Monat höchstens einmal */
function pruefeKalenderMonate(liste, { nullErlaubt = true } = {}) {
  const ergebnis = [];
  for (const k of liste ?? []) {
    const monat = Number(k.monat);
    if (!Number.isInteger(monat) || monat < 1 || monat > 12) throw new Error('Bitte bei jeder Abweichung den Monat wählen.');
    if (k.betragCent == null) throw new Error('Bitte bei jeder Abweichung einen Betrag eingeben (0 = kein Budget in diesem Monat).');
    if (!Number.isInteger(k.betragCent) || k.betragCent < 0) throw new Error('Bitte die Beträge ohne Minus eingeben.');
    if (ergebnis.some((x) => x.monat === monat)) throw new Error('Jeder Monat darf nur einmal abweichen.');
    if (!nullErlaubt && k.betragCent === 0) throw new Error('Bitte einen Betrag größer 0 eingeben. Einzelne Termine lassen sich in der Übersicht überspringen.');
    ergebnis.push({ monat, betragCent: k.betragCent });
  }
  return ergebnis.sort((a, b) => a.monat - b.monat);
}

/** Felder eines Jahresbudgets prüfen (D90) */
function jahresFelder(eingabe) {
  const startJahr = Number(eingabe.startJahr);
  const endJahr = eingabe.endJahr === '' || eingabe.endJahr == null ? null : Number(eingabe.endJahr);
  if (!Number.isInteger(startJahr) || startJahr < 2000 || startJahr > 2100) throw new Error('Bitte das Startjahr eingeben (z. B. 2027).');
  if (endJahr !== null && (!Number.isInteger(endJahr) || endJahr > 2100)) throw new Error('Das Endjahr ist ungültig.');
  if (endJahr !== null && endJahr < startJahr) throw new Error('Das Endjahr liegt vor dem Startjahr.');
  const felder = { startJahr, endJahr, verteilung: eingabe.verteilung };
  if (eingabe.verteilung === 'quartal') {
    const q = [0, 1, 2, 3].map((i) => eingabe.quartaleCent?.[i] ?? 0);
    if (q.some((c) => !Number.isInteger(c) || c < 0)) throw new Error('Bitte die Quartalsbeträge ohne Minus eingeben.');
    const summe = q.reduce((s, c) => s + c, 0);
    if (summe <= 0) throw new Error('Bitte mindestens für ein Quartal einen Betrag eingeben.');
    return { ...felder, quartaleCent: q, betragCent: summe };
  }
  if (eingabe.verteilung !== 'zeitpunkt' && eingabe.verteilung !== 'halbjahr') throw new Error('Bitte die Verteilung wählen.');
  if (eingabe.betragCent == null || eingabe.betragCent <= 0) throw new Error('Bitte einen Betrag pro Jahr größer 0 eingeben.');
  if (eingabe.verteilung === 'halbjahr') return { ...felder, betragCent: eingabe.betragCent };
  const zeitpunktMonat = Number(eingabe.zeitpunktMonat);
  if (!Number.isInteger(zeitpunktMonat) || zeitpunktMonat < 1 || zeitpunktMonat > 12) throw new Error('Bitte den Monat wählen.');
  return { ...felder, betragCent: eingabe.betragCent, zeitpunktMonat };
}

/** Konto, auf dem eine Hauptkategorie am häufigsten gebucht wird (Vorschlag fürs Budget) */
export function haeufigstesKonto(hauptId, kategorien, buchungen, konten) {
  const unterIds = new Set(kategorien.filter((k) => k.elternId === hauptId).map((k) => k.id));
  const zaehler = new Map();
  for (const b of buchungen) {
    if (b.geloeschtAm || !unterIds.has(b.kategorieId)) continue;
    zaehler.set(b.kontoId, (zaehler.get(b.kontoId) ?? 0) + 1);
  }
  const aktiv = konten.filter((k) => !k.archiviert);
  return [...zaehler.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id).find((id) => aktiv.some((k) => k.id === id))
    ?? aktiv[0]?.id ?? null;
}

/* ======================= Wiederkehrende Buchung ======================= */

export function baueWiederkehrend(eingabe, { konten, kategorien, alt = null, jetzt = new Date().toISOString() }) {
  const notiz = (eingabe.notiz ?? '').trim(); // optional (D96, ersetzt die Pflicht-Bezeichnung)
  if (!['einnahme', 'ausgabe', 'umbuchung'].includes(eingabe.art)) throw new Error('Bitte die Art wählen.');
  if (!['monatlich', 'vierteljaehrlich', 'jaehrlich'].includes(eingabe.intervall)) throw new Error('Bitte das Intervall wählen.');
  if (!istGueltigesDatum(eingabe.start)) throw new Error('Bitte ein gültiges Startdatum wählen.');
  if (eingabe.ende && !istGueltigesDatum(eingabe.ende)) throw new Error('Das Enddatum ist ungültig.');
  if (eingabe.ende && eingabe.ende < eingabe.start) throw new Error('Das Enddatum liegt vor dem Start.');

  const konto = konten.find((k) => k.id === eingabe.kontoId);
  if (!konto) throw new Error('Bitte ein Konto wählen.');
  let kategorieId = null;
  let gegenkontoId = null;
  if (eingabe.art === 'umbuchung') {
    if (!konten.some((k) => k.id === eingabe.gegenkontoId)) throw new Error('Bitte das Konto „Auf“ wählen.');
    if (eingabe.gegenkontoId === eingabe.kontoId) throw new Error('Bitte zwei verschiedene Konten wählen.');
    gegenkontoId = eingabe.gegenkontoId;
  } else {
    const unter = kategorien.find((k) => k.id === eingabe.kategorieId);
    const haupt = kategorien.find((k) => k.id === unter?.elternId);
    if (!unter || !haupt) throw new Error('Bitte eine Kategorie wählen.');
    if (haupt.art !== eingabe.art) throw new Error('Die Kategorie passt nicht zur Art (Einnahme/Ausgabe).');
    kategorieId = unter.id;
  }

  // "Immer am Monatsletzten": Start wird auf den letzten Tag seines Monats gesetzt
  const monatsletzter = Boolean(eingabe.monatsletzter);
  const start = monatsletzter ? monatsende(eingabe.start) : eingabe.start;
  if (eingabe.ende && eingabe.ende < start) throw new Error('Das Enddatum liegt vor dem ersten Termin.');

  const stufen = [...eingabe.stufen];
  if (stufen.length) stufen[0] = { ...stufen[0], ab: start };

  return {
    id: alt?.id ?? crypto.randomUUID(),
    notiz,
    art: eingabe.art,
    kontoId: eingabe.kontoId,
    gegenkontoId,
    kategorieId,
    intervall: eingabe.intervall,
    start,
    monatsletzter,
    ende: eingabe.ende || null,
    stufen: pruefeStufen(stufen, start, istGueltigesDatum, 'Datum'),
    ausnahmen: alt?.ausnahmen ?? [],
    // D94: feste Abweichung je Kalendermonat (jedes Jahr), z. B. Weihnachtsgeld im November
    kalenderMonate: eingabe.kalenderMonate === undefined ? (alt?.kalenderMonate ?? []) : pruefeKalenderMonate(eingabe.kalenderMonate, { nullErlaubt: false }),
    partner: partnerVon(eingabe, alt),
    aktiv: eingabe.aktiv ?? alt?.aktiv ?? true,
    erstelltAm: alt?.erstelltAm ?? jetzt,
    geaendertAm: jetzt,
    ...(alt?.testdaten ? { testdaten: true } : {}),
  };
}

/* ======================= Geplante Einmalbuchung (Etappe 5) ======================= */
//
// Datensatz (Datenversion 4):
// { id, bezeichnung, art: 'einnahme'|'ausgabe'|'umbuchung', kontoId, gegenkontoId, kategorieId,
//   datum "JJJJ-MM-TT", betragCent, erledigtAm (null | Zeitpunkt, "schon gebucht" ohne Verknüpfung),
//   aktiv, projektId (ab Version 5), erstelltAm, geaendertAm, testdaten? }
// Erledigt ist sie, wenn erledigtAm gesetzt ist ODER eine (nicht gelöschte) Buchung mit
// geplantId auf sie zeigt.

export function baueGeplant(eingabe, { konten, kategorien, alt = null, jetzt = new Date().toISOString() }) {
  const bezeichnung = (eingabe.bezeichnung ?? '').trim();
  if (!bezeichnung) throw new Error('Bitte eine Bezeichnung eingeben, z. B. „Autoreparatur“.');
  if (!['einnahme', 'ausgabe', 'umbuchung'].includes(eingabe.art)) throw new Error('Bitte die Art wählen.');
  if (!istGueltigesDatum(eingabe.datum)) throw new Error('Bitte ein gültiges Datum wählen.');
  if (eingabe.betragCent == null || eingabe.betragCent <= 0) throw new Error('Bitte einen Betrag größer 0 eingeben (ohne Minus).');
  const konto = konten.find((k) => k.id === eingabe.kontoId);
  if (!konto) throw new Error('Bitte ein Konto wählen.');
  if (eingabe.datum < konto.stichtag) throw new Error(`Das Datum liegt vor dem Stichtag von „${konto.name}“ (${formatDatum(konto.stichtag)}).`);

  let kategorieId = null;
  let gegenkontoId = null;
  if (eingabe.art === 'umbuchung') {
    if (!konten.some((k) => k.id === eingabe.gegenkontoId)) throw new Error('Bitte das Konto „Auf“ wählen.');
    if (eingabe.gegenkontoId === eingabe.kontoId) throw new Error('Bitte zwei verschiedene Konten wählen.');
    gegenkontoId = eingabe.gegenkontoId;
  } else {
    const unter = kategorien.find((k) => k.id === eingabe.kategorieId);
    const haupt = kategorien.find((k) => k.id === unter?.elternId);
    if (!unter || !haupt) throw new Error('Bitte eine Kategorie wählen.');
    if (haupt.art !== eingabe.art) throw new Error('Die Kategorie passt nicht zur Art (Einnahme/Ausgabe).');
    kategorieId = unter.id;
  }
  return {
    id: alt?.id ?? crypto.randomUUID(),
    bezeichnung,
    art: eingabe.art,
    kontoId: eingabe.kontoId,
    gegenkontoId,
    kategorieId,
    datum: eingabe.datum,
    betragCent: eingabe.betragCent,
    erledigtAm: alt?.erledigtAm ?? null,
    partner: partnerVon(eingabe, alt),
    aktiv: eingabe.aktiv ?? alt?.aktiv ?? true,
    // Projekt (Datenversion 5); Umbuchungen gehören nie zu einem Projekt
    projektId: eingabe.art === 'umbuchung' ? null
      : ((eingabe.projektId === undefined ? alt?.projektId : eingabe.projektId) || null),
    erstelltAm: alt?.erstelltAm ?? jetzt,
    geaendertAm: jetzt,
    ...(alt?.testdaten ? { testdaten: true } : {}),
  };
}

/** Ist eine geplante Einmalbuchung erledigt? Liefert die verknüpfte Buchung, true oder false. */
export function geplantErledigt(g, buchungen) {
  const b = buchungen.find((x) => !x.geloeschtAm && x.geplantId === g.id);
  return b ?? Boolean(g.erledigtAm);
}

/* ======================= Projekt (Datenversion 5) ======================= */
// Datensatz: { id, name, rahmenCent (null = ohne Rahmen), notiz, abgeschlossen,
//   erstelltAm, geaendertAm, testdaten? }
// Zugeordnet werden echte Buchungen (buchung.projektId) und geplante Einmalbuchungen
// (geplant.projektId). Projektausgaben zählen nicht gegen das Monatsbudget (D52).

export function baueProjekt(eingabe, { projekte, alt = null, jetzt = new Date().toISOString() }) {
  const name = (eingabe.name ?? '').trim();
  if (!name) throw new Error('Bitte einen Namen eingeben, z. B. „Umbau Bad“.');
  if (projekte.some((p) => p.id !== alt?.id && p.name.toLocaleLowerCase('de') === name.toLocaleLowerCase('de'))) {
    throw new Error(`Ein Projekt „${name}“ gibt es schon.`);
  }
  if (eingabe.rahmenCent != null && eingabe.rahmenCent <= 0) throw new Error('Bitte einen Rahmen größer 0 eingeben oder das Feld leer lassen.');
  return {
    id: alt?.id ?? crypto.randomUUID(),
    name,
    rahmenCent: eingabe.rahmenCent ?? null,
    notiz: (eingabe.notiz ?? '').trim(),
    abgeschlossen: Boolean(eingabe.abgeschlossen ?? alt?.abgeschlossen),
    erstelltAm: alt?.erstelltAm ?? jetzt,
    geaendertAm: jetzt,
    ...(alt?.testdaten ? { testdaten: true } : {}),
  };
}

/**
 * Zahlen eines Projekts. Kosten = Ausgaben − Einnahmen (z. B. Zuschuss).
 * - ist: alle (nicht gelöschten) Buchungen des Projekts, neueste zuerst; bei Buchungen
 *   aus einer geplanten Einmalbuchung steht der geplante Betrag dabei (planCent)
 * - offen: eingeschaltete, noch nicht erledigte geplante Einmalbuchungen, nach Datum;
 *   vergangen = Datum vor heute (in den Listen ausgeblendet, zählt aber weiter mit)
 * Ergebnis: { istCent, offenCent, gesamtCent, restCent (null ohne Rahmen), ist, offen }
 */
export function projektZahlen(projekt, { buchungen, geplant, archive = [] }, heute) {
  const kosten = (art, cent) => (art === 'einnahme' ? -cent : cent);
  const geplantNach = new Map(geplant.map((g) => [g.id, g]));
  const ist = buchungen
    .filter((b) => !b.geloeschtAm && b.projektId === projekt.id && b.art !== 'umbuchung')
    .map((b) => ({ buchung: b, kostenCent: kosten(b.art, b.betragCent), planCent: b.geplantId ? geplantNach.get(b.geplantId)?.betragCent ?? null : null }))
    .sort((a, b) => b.buchung.datum.localeCompare(a.buchung.datum));
  const offen = geplant
    .filter((g) => g.projektId === projekt.id && g.aktiv !== false && !geplantErledigt(g, buchungen))
    .map((g) => ({ geplant: g, kostenCent: kosten(g.art, g.betragCent), vergangen: g.datum < heute }))
    .sort((a, b) => a.geplant.datum.localeCompare(b.geplant.datum));
  // Kosten aus archivierten Jahren (D68) zählen mit, auch wenn die Buchungen nicht mehr hier liegen
  const archivCent = archive.reduce((s, a) => s + (a.projekte?.[projekt.id] ?? 0), 0);
  const istCent = ist.reduce((s, x) => s + x.kostenCent, 0) + archivCent;
  const offenCent = offen.reduce((s, x) => s + x.kostenCent, 0);
  const gesamtCent = istCent + offenCent;
  return {
    istCent, offenCent, gesamtCent, archivCent,
    restCent: projekt.rahmenCent != null ? projekt.rahmenCent - gesamtCent : null,
    ist, offen,
  };
}

/**
 * Termin überspringen, verschieben oder nur für diesen Termin ändern (ersetzt eine vorhandene
 * Ausnahme für diesen Termin; aktion null = Ausnahme entfernen).
 * - 'verschieben': neuesDatum
 * - 'aendern': neuesDatum und betragCent – entspricht beides dem Regelfall, wird die
 *   Ausnahme einfach entfernt
 */
export function mitAusnahme(w, termin, aktion, neuesDatum = null, betragCent = null) {
  if (aktion === 'verschieben' && !istGueltigesDatum(neuesDatum)) throw new Error('Bitte ein gültiges neues Datum wählen.');
  if (aktion === 'verschieben' && neuesDatum === termin) throw new Error(`Der Termin ist bereits am ${formatDatum(termin)}.`);
  if (aktion === 'aendern') {
    if (!istGueltigesDatum(neuesDatum)) throw new Error('Bitte ein gültiges Datum wählen.');
    if (betragCent == null || betragCent <= 0) throw new Error('Bitte einen Betrag größer 0 eingeben (ohne Minus). Zum Weglassen „Überspringen“ wählen.');
  }
  let ausnahmen = (w.ausnahmen ?? []).filter((a) => a.termin !== termin);
  if (aktion === 'verschieben') ausnahmen.push({ termin, aktion, neuesDatum });
  else if (aktion === 'aendern') {
    const regel = terminBetrag(w, termin); // inkl. Kalendermonat-Abweichung (D94)
    if (neuesDatum !== termin || betragCent !== regel) {
      ausnahmen.push(betragCent === regel ? { termin, aktion: 'verschieben', neuesDatum } : { termin, aktion, neuesDatum, betragCent });
    }
  } else if (aktion) ausnahmen.push({ termin, aktion });
  ausnahmen = ausnahmen.sort((a, b) => a.termin.localeCompare(b.termin));
  return { ...w, ausnahmen, geaendertAm: new Date().toISOString() };
}

/**
 * Wiederkehrendes Budget nur für einen Monat ändern (Datenversion 7).
 * betragCent null oder gleich der geltenden Stufe → Ausnahme entfernen. 0 ist erlaubt
 * (in diesem Monat kein Budget).
 */
export function budgetMitMonatsAusnahme(budget, monat, betragCent) {
  if (betragCent != null && betragCent < 0) throw new Error('Bitte den Betrag ohne Minus eingeben.');
  let ausnahmen = (budget.ausnahmen ?? []).filter((a) => a.monat !== monat);
  if (betragCent != null && betragCent !== regelBetrag(budget, monat)) ausnahmen.push({ monat, betragCent });
  ausnahmen = ausnahmen.sort((a, b) => a.monat.localeCompare(b.monat));
  return { ...budget, ausnahmen, geaendertAm: new Date().toISOString() };
}

/* ======================= Budgetvorschlag übernehmen ======================= */

/**
 * Übernimmt einen Budgetvorschlag ab einem Monat: beim wiederkehrenden Budget der
 * Kategorie auf diesem Konto (D85) kommt eine Stufe dazu (gleicher Monat wird ersetzt). Gibt es keins,
 * entsteht ein neues wiederkehrendes Budget ab diesem Monat.
 */
export function budgetMitVorschlag(budgets, { kategorieId, abMonat, betragCent, kontoId }, jetzt = new Date().toISOString()) {
  const vorhanden = budgets.find((b) => b.typ === 'wiederkehrend' && b.kategorieId === kategorieId && b.kontoId === kontoId);
  if (!vorhanden) {
    return {
      id: crypto.randomUUID(), kategorieId, kontoId, typ: 'wiederkehrend', notiz: '',
      startMonat: abMonat, endMonat: null, stufen: [{ ab: abMonat, betragCent }],
      erstelltAm: jetzt, geaendertAm: jetzt,
    };
  }
  const stufen = vorhanden.stufen.filter((s) => s.ab !== abMonat);
  stufen.push({ ab: abMonat, betragCent });
  stufen.sort((a, b) => a.ab.localeCompare(b.ab));
  return {
    ...vorhanden,
    startMonat: abMonat < vorhanden.startMonat ? abMonat : vorhanden.startMonat,
    endMonat: vorhanden.endMonat && vorhanden.endMonat < abMonat ? null : vorhanden.endMonat,
    stufen,
    geaendertAm: jetzt,
  };
}

/* ======================= Datenbank ======================= */

export async function leseEinstellungen() {
  const alle = await db.alle('einstellungen');
  return { ...STANDARD_EINSTELLUNGEN, ...(alle.find((e) => e.id === 'hinweise') ?? {}) };
}

export async function speichereEinstellungen({ monate, prozent }) {
  if (!Number.isInteger(monate) || monate < 2 || monate > 12) throw new Error('Monate: bitte eine ganze Zahl von 2 bis 12.');
  if (!Number.isFinite(prozent) || prozent < 1 || prozent > 100) throw new Error('Prozent: bitte eine Zahl von 1 bis 100.');
  await db.speichere('einstellungen', { id: 'hinweise', monate, prozent });
}

/** Merkt sich die Entscheidung zu einem Budgethinweis */
export async function merkeHinweis(hinweis, status, erinnernAb = null) {
  await db.speichere('hinweise', {
    id: crypto.randomUUID(),
    kategorieId: hinweis.kategorie.id,
    kontoId: hinweis.kontoId ?? null, // Hinweise gelten je Konto (D85)
    bisMonat: hinweis.bisMonat,
    status, // uebernommen | abgelehnt | spaeter
    erinnernAb,
    erstelltAm: new Date().toISOString(),
  });
}
