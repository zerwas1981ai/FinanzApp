// D182–D185: „Schlaues“ Verhalten ohne KI – einfache Regeln aus den eigenen Buchungen.
// Die App schlägt nur vor oder markiert; sie ändert nie selbst etwas. Reine Funktionen, mit `npm test` geprüft.

import { partnerSchluessel } from './auswertung.js';
import { terminBetrag, naechsterTermin, plusTage } from './prognose.js';

const monat = (iso) => iso.slice(0, 7);
const plusMonat = (m, n) => {
  const j = Number(m.slice(0, 4));
  const x = Number(m.slice(5, 7)) - 1 + n;
  return `${j + Math.floor(x / 12)}-${String(((x % 12) + 12) % 12 + 1).padStart(2, '0')}`;
};
const median = (werte) => {
  const s = [...werte].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
};
const echte = (b) => !b.geloeschtAm && (b.art === 'ausgabe' || b.art === 'einnahme');

/* ======================= D182: wiederkehrende Zahlungen erkennen ======================= */

/**
 * Vorschläge „als wiederkehrend anlegen“: gleicher Empfänger/Absender und gleiche Art in mindestens 3
 * aufeinanderfolgenden Monaten bis zum Vormonat oder laufenden Monat – je Monat genau eine Buchung, jeweils um
 * denselben Tag (höchstens 3 Tage Abstand, Monatsende gilt als gleicher Tag), Beträge höchstens 10 % vom Median entfernt.
 * So gelten Einkäufe (mehrmals im Monat, wechselnde Tage) nicht als wiederkehrend.
 * Ausgenommen: Buchungen, die schon zu einer wiederkehrenden Buchung gehören; Empfänger, für die es schon eine
 * (eingeschaltete) wiederkehrende Buchung gibt; abgelehnte Empfänger („Nicht wiederkehrend“).
 * Ergebnis: [{ schluessel, partner, art, kontoId, kategorieId, betragCent, tag, monate, letzte }], die längsten zuerst.
 */
export function wiederkehrendVorschlaege(buchungen, wiederkehrend = [], abgelehnt = [], heute) {
  const aktuell = monat(heute);
  const vormonat = plusMonat(aktuell, -1);
  const vorhanden = new Set(wiederkehrend
    .filter((w) => w.aktiv !== false && !(w.ende && w.ende < heute))
    .map((w) => `${w.art}|${partnerSchluessel(w.partner)}`));
  const nein = new Set(abgelehnt);
  const gruppen = new Map();
  for (const b of buchungen) {
    if (!echte(b) || b.wiederkehrendId || !b.partner?.trim() || b.datum > heute) continue;
    const k = `${b.art}|${partnerSchluessel(b.partner)}`;
    if (!gruppen.has(k)) gruppen.set(k, []);
    gruppen.get(k).push(b);
  }
  const ergebnis = [];
  for (const [k, liste] of gruppen) {
    if (vorhanden.has(k) || nein.has(k)) continue;
    // je Monat die Buchungen
    const jeMonat = new Map();
    const anzahl = new Map();
    for (const b of [...liste].sort((a, c) => a.datum.localeCompare(c.datum))) {
      jeMonat.set(monat(b.datum), b);
      anzahl.set(monat(b.datum), (anzahl.get(monat(b.datum)) ?? 0) + 1);
    }
    // lückenlose Monatskette rückwärts ab dem neuesten Monat (laufender oder Vormonat)
    let m = jeMonat.has(aktuell) ? aktuell : vormonat;
    const kette = [];
    while (jeMonat.has(m)) { kette.push(jeMonat.get(m)); m = plusMonat(m, -1); }
    if (kette.length < 3) continue;
    if (kette.some((b) => anzahl.get(monat(b.datum)) > 1)) continue; // mehrmals im Monat → eher Einkauf
    const tage = kette.map((b) => Math.min(Number(b.datum.slice(8, 10)), 28)); // 29.–31. zählen wie der 28. (Monatsende)
    if (Math.max(...tage) - Math.min(...tage) > 3) continue;
    const mitte = median(kette.map((b) => b.betragCent));
    if (kette.some((b) => Math.abs(b.betragCent - mitte) > mitte * 0.1)) continue;
    const letzte = kette[0];
    ergebnis.push({
      schluessel: k, partner: letzte.partner.trim(), art: letzte.art, kontoId: letzte.kontoId, kategorieId: letzte.kategorieId ?? null,
      betragCent: letzte.betragCent, tag: Number(letzte.datum.slice(8, 10)), monate: kette.length, letzte: letzte.datum,
    });
  }
  return ergebnis.sort((a, b) => b.monate - a.monate || a.partner.localeCompare(b.partner, 'de'));
}

/* ======================= D183: ungewöhnlich hohe Ausgaben ======================= */

export const UNGEWOEHNLICH = { mindestBuchungen: 3, faktor: 1.5, mindestCent: 2000 };

/**
 * Ist eine Ausgabe für diesen Empfänger ungewöhnlich hoch? Verglichen wird mit dem Durchschnitt der bis zu
 * 12 vorherigen Ausgaben an denselben Empfänger (mindestens 3). Ungewöhnlich = mehr als das 1,5-Fache und
 * mindestens 20 € darüber. Ergebnis: Durchschnitt in Cent oder null.
 */
export function ungewoehnlichHoch(betragCent, vorherige) {
  if (vorherige.length < UNGEWOEHNLICH.mindestBuchungen) return null;
  const letzte = vorherige.slice(-12);
  const schnitt = Math.round(letzte.reduce((s, x) => s + x, 0) / letzte.length);
  return betragCent > schnitt * UNGEWOEHNLICH.faktor && betragCent - schnitt >= UNGEWOEHNLICH.mindestCent ? schnitt : null;
}

/** Alle ungewöhnlich hohen Ausgaben: Map(buchungsId → Durchschnitt in Cent) – für die Marken in den Listen */
export function ungewoehnlicheBuchungen(buchungen) {
  const gruppen = new Map();
  for (const b of buchungen) {
    if (!echte(b) || b.art !== 'ausgabe' || !b.partner?.trim()) continue;
    const k = partnerSchluessel(b.partner);
    if (!gruppen.has(k)) gruppen.set(k, []);
    gruppen.get(k).push(b);
  }
  const ergebnis = new Map();
  for (const liste of gruppen.values()) {
    const sortiert = liste.sort((a, b) => a.datum.localeCompare(b.datum) || (a.erstelltAm ?? '').localeCompare(b.erstelltAm ?? ''));
    const bisher = [];
    for (const b of sortiert) {
      const schnitt = ungewoehnlichHoch(b.betragCent, bisher);
      // D186: vom Nutzer als richtig bestätigt (für genau diesen Betrag) → keine Marke mehr
      if (schnitt != null && b.hochOkCent !== b.betragCent) ergebnis.set(b.id, schnitt);
      bisher.push(b.betragCent);
    }
  }
  return ergebnis;
}

/** Für den Buchungsdialog: frühere Ausgaben an diesen Empfänger (ohne die Buchung selbst), älteste zuerst */
export function vorherigeBetraege(buchungen, partner, { ohneId = null, bisDatum = null } = {}) {
  const k = partnerSchluessel(partner);
  if (!k) return [];
  return buchungen
    .filter((b) => echte(b) && b.art === 'ausgabe' && b.id !== ohneId && partnerSchluessel(b.partner) === k && (!bisDatum || b.datum <= bisDatum))
    .sort((a, b) => a.datum.localeCompare(b.datum))
    .map((b) => b.betragCent);
}

/* ======================= D184: Kategorie-Vorschlag aus der Notiz ======================= */

const FUELLWOERTER = new Set(['und', 'oder', 'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'für', 'fuer', 'mit',
  'von', 'vom', 'zum', 'zur', 'bei', 'beim', 'auf', 'aus', 'nach', 'noch', 'auch', 'sowie', 'wegen']);

/** Wörter einer Notiz: klein, ohne Satzzeichen, mindestens 3 Buchstaben, ohne Füllwörter */
export function notizWoerter(text) {
  return [...new Set(String(text ?? '').toLocaleLowerCase('de').split(/[^a-zäöüß0-9]+/).filter((w) => w.length >= 3 && !FUELLWOERTER.has(w)))];
}

/**
 * Kategorie aus der Notiz vorschlagen: In früheren Buchungen derselben Art zählt jedes gemeinsame Wort als
 * Stimme für deren Kategorie. Vorschlag nur bei mindestens 2 Stimmen und klarem Vorsprung. Ergebnis: kategorieId | null.
 */
export function kategorieAusNotiz(notiz, buchungen, art) {
  const woerter = notizWoerter(notiz);
  if (!woerter.length) return null;
  const stimmen = new Map();
  for (const b of buchungen) {
    if (!echte(b) || b.art !== art || !b.kategorieId || !b.notiz) continue;
    const treffer = notizWoerter(b.notiz).filter((w) => woerter.includes(w)).length;
    if (treffer) stimmen.set(b.kategorieId, (stimmen.get(b.kategorieId) ?? 0) + treffer);
  }
  const rang = [...stimmen.entries()].sort((a, b) => b[1] - a[1]);
  if (!rang.length || rang[0][1] < 2) return null;
  if (rang[1] && rang[1][1] * 1.5 > rang[0][1]) return null; // kein klarer Vorsprung
  return rang[0][0];
}

/* ======================= D185: Archiv-Erinnerung ======================= */

/**
 * Erinnerung „Jahr X ist abgeschlossen – archivieren?“ – sobald es ein archivierbares Jahr gibt
 * (archiv.naechstesArchivJahr) und die Erinnerung nicht bis zu einem späteren Tag zurückgestellt ist.
 * naechstes: Ergebnis von naechstesArchivJahr; spaeterBis: 'JJJJ-MM-TT' | null.
 */
export function archivErinnerung(naechstes, heute, spaeterBis = null) {
  if (!naechstes || naechstes.anzahl === 0) return null;
  if (spaeterBis && spaeterBis >= heute) return null;
  return naechstes;
}

/* ======================= D203: Preisänderung bei wiederkehrenden Buchungen ======================= */

/** Gleicher Betrag (höchstens 1 % oder 1 Cent Unterschied) */
const gleich = (a, b) => Math.abs(a - b) <= Math.max(1, Math.round(Math.max(a, b) * 0.01));
/** Spürbare Abweichung vom geplanten Betrag: mindestens 50 Cent und 2 % */
const abweichend = (ist, plan) => Math.abs(ist - plan) >= Math.max(50, Math.round(plan * 0.02));

/**
 * Vorschläge „Betrag anpassen“: Die letzten zwei gebuchten Termine einer wiederkehrenden Buchung hatten
 * (fast) denselben Betrag, und beide weichen spürbar vom geplanten Betrag ab – z. B. Strom jetzt 92 € statt 85 €.
 * Vorgeschlagen wird eine Wertänderung ab dem nächsten Termin nach der letzten Buchung.
 * Ohne Vorschlag: ausgeschaltete/beendete, Umbuchungen, schon angepasste, abgelehnte („id|betrag“).
 * Ergebnis: [{ schluessel, w, altCent, neuCent, ab, letzte }]
 */
export function preisAenderungen(wiederkehrend, buchungen, heute, abgelehnt = []) {
  const nein = new Set(abgelehnt);
  const ergebnis = [];
  for (const w of wiederkehrend) {
    if (w.aktiv === false || (w.ende && w.ende < heute) || w.art === 'umbuchung') continue;
    const gebucht = buchungen
      .filter((b) => echte(b) && b.wiederkehrendId === w.id && b.faelligAm)
      .sort((a, b) => b.faelligAm.localeCompare(a.faelligAm));
    if (gebucht.length < 2) continue;
    const [a, b] = gebucht;
    if (!gleich(a.betragCent, b.betragCent)) continue;
    if (!abweichend(a.betragCent, terminBetrag(w, a.faelligAm)) || !abweichend(b.betragCent, terminBetrag(w, b.faelligAm))) continue;
    const naechster = naechsterTermin(w, plusTage(a.faelligAm, 1));
    if (!naechster) continue;
    const altCent = terminBetrag(w, naechster.termin);
    if (gleich(altCent, a.betragCent)) continue; // schon angepasst
    const schluessel = `${w.id}|${a.betragCent}`;
    if (nein.has(schluessel)) continue;
    ergebnis.push({ schluessel, w, altCent, neuCent: a.betragCent, ab: naechster.termin, letzte: a.datum });
  }
  return ergebnis;
}

/** Wertänderung ab einem Termin eintragen (D203): vorhandene Stufe am selben Tag wird ersetzt */
export function mitWertAenderung(w, ab, betragCent) {
  const stufen = [...(w.stufen ?? []).filter((s) => s.ab !== ab), { ab, betragCent }].sort((x, y) => x.ab.localeCompare(y.ab));
  return { ...w, stufen };
}
