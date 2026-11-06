// Budgets, wiederkehrende Buchungen, Hinweis-Status und Einstellungen:
// Prüfen, Datensätze bauen (reine Funktionen) und speichern.
//
// Datensatz Budget (Datenversion 3):
// { id, kategorieId (Hauptkategorie, Art "ausgabe"), kontoId (belastetes Konto),
//   typ: 'wiederkehrend' | 'einmalig',
//   startMonat "JJJJ-MM", endMonat "JJJJ-MM"|null, stufen: [{ ab "JJJJ-MM", betragCent }]  // wiederkehrend
//   monat "JJJJ-MM", betragCent                                                       // einmalig
//   notiz, erstelltAm, geaendertAm, testdaten? }
//
// Datensatz Wiederkehrende Buchung (Datenversion 3):
// { id, bezeichnung, art: 'einnahme'|'ausgabe'|'umbuchung', kontoId, gegenkontoId, kategorieId,
//   intervall: 'monatlich'|'vierteljaehrlich'|'jaehrlich', start "JJJJ-MM-TT", ende "JJJJ-MM-TT"|null,
//   monatsletzter: true|false  // true = jeder Termin am letzten Tag des Monats (fehlt = false)
//   stufen: [{ ab "JJJJ-MM-TT", betragCent }],
//   ausnahmen: [{ termin, aktion: 'ueberspringen'|'verschieben', neuesDatum? }],
//   erstelltAm, geaendertAm, testdaten? }

import * as db from './db.js';
import { istGueltigesDatum, formatDatum } from './format.js';
import { STANDARD_EINSTELLUNGEN } from './migrationen.js';
import { monatsende } from './prognose.js';

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

export function baueBudget(eingabe, { kategorien, budgets, alt = null, jetzt = new Date().toISOString() }) {
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
    erstelltAm: alt?.erstelltAm ?? jetzt,
    geaendertAm: jetzt,
    ...(alt?.testdaten ? { testdaten: true } : {}),
  };

  if (eingabe.typ === 'einmalig') {
    if (!istMonat(eingabe.monat)) throw new Error('Bitte den Monat wählen.');
    if (eingabe.betragCent == null || eingabe.betragCent <= 0) throw new Error('Bitte einen Betrag größer 0 eingeben.');
    return { ...basis, monat: eingabe.monat, betragCent: eingabe.betragCent };
  }
  if (eingabe.typ !== 'wiederkehrend') throw new Error('Bitte wiederkehrend oder einmalig wählen.');
  if (!istMonat(eingabe.startMonat)) throw new Error('Bitte den Startmonat wählen.');
  if (eingabe.endMonat && !istMonat(eingabe.endMonat)) throw new Error('Der Endmonat ist ungültig.');
  if (eingabe.endMonat && eingabe.endMonat < eingabe.startMonat) throw new Error('Der Endmonat liegt vor dem Startmonat.');
  if (budgets.some((b) => b.id !== basis.id && b.typ === 'wiederkehrend' && b.kategorieId === hk.id)) {
    throw new Error(`Für „${hk.name}“ gibt es schon ein wiederkehrendes Budget. Ändere dort den Betrag ab einem Monat.`);
  }
  // Die erste Stufe beginnt immer mit dem Startmonat
  const stufen = [...eingabe.stufen];
  if (stufen.length) stufen[0] = { ...stufen[0], ab: eingabe.startMonat };
  return {
    ...basis,
    startMonat: eingabe.startMonat,
    endMonat: eingabe.endMonat || null,
    stufen: pruefeStufen(stufen, eingabe.startMonat, istMonat, 'Monat'),
  };
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
  const bezeichnung = (eingabe.bezeichnung ?? '').trim();
  if (!bezeichnung) throw new Error('Bitte eine Bezeichnung eingeben, z. B. „Miete“.');
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
    bezeichnung,
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
    erstelltAm: alt?.erstelltAm ?? jetzt,
    geaendertAm: jetzt,
    ...(alt?.testdaten ? { testdaten: true } : {}),
  };
}

/** Termin überspringen oder verschieben (ersetzt eine vorhandene Ausnahme für diesen Termin) */
export function mitAusnahme(w, termin, aktion, neuesDatum = null) {
  if (aktion === 'verschieben' && !istGueltigesDatum(neuesDatum)) throw new Error('Bitte ein gültiges neues Datum wählen.');
  if (aktion === 'verschieben' && neuesDatum === termin) throw new Error(`Der Termin ist bereits am ${formatDatum(termin)}.`);
  const ausnahmen = (w.ausnahmen ?? []).filter((a) => a.termin !== termin);
  if (aktion) ausnahmen.push(aktion === 'verschieben' ? { termin, aktion, neuesDatum } : { termin, aktion });
  return { ...w, ausnahmen: ausnahmen.sort((a, b) => a.termin.localeCompare(b.termin)), geaendertAm: new Date().toISOString() };
}

/* ======================= Budgetvorschlag übernehmen ======================= */

/**
 * Übernimmt einen Budgetvorschlag ab einem Monat: beim wiederkehrenden Budget der
 * Kategorie kommt eine Stufe dazu (gleicher Monat wird ersetzt). Gibt es keins,
 * entsteht ein neues wiederkehrendes Budget ab diesem Monat.
 */
export function budgetMitVorschlag(budgets, { kategorieId, abMonat, betragCent, kontoId }, jetzt = new Date().toISOString()) {
  const vorhanden = budgets.find((b) => b.typ === 'wiederkehrend' && b.kategorieId === kategorieId);
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
    bisMonat: hinweis.bisMonat,
    status, // uebernommen | abgelehnt | spaeter
    erinnernAb,
    erstelltAm: new Date().toISOString(),
  });
}
