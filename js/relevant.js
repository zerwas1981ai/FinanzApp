// Relevante Ausgaben (D74): eine Sammelliste wichtiger Ausgaben unten im Tab "Projekte".
// Reine Funktionen ohne Datenbank – mit `npm test` geprüft.
//
// Zwei Quellen:
// 1. Eigene Einträge (Sammlung "relevant"), auch weit zurück (z. B. ab 2010). Sie gehören zu
//    keinem Konto und zählen NIRGENDS mit: nicht im Kontostand, nicht im Budget, nicht in der Prognose.
//    { id, datum, betragCent (> 0), partner, kategorieId (oder null), notiz, gruppe,
//      belege: [{ id, name, mime, groesse, driveId, hinzugefuegtAm }], geloeschtAm, erstelltAm, geaendertAm, testdaten? }
// 2. Echte Ausgaben-Buchungen mit Häkchen: buchung.relevant = true, buchung.relevantGruppe = '…'.
//    Sie erscheinen automatisch (keine Kopie der Daten). Ihre Belege bekommen in Drive zusätzlich
//    eine Kopie im Ordner "Relevante Ausgaben" (beleg.relevantDriveId).

import { istGueltigesDatum } from './format.js';

export const MAX_GRUPPE = 40;

/** Zählt eine Buchung als relevante Ausgabe? */
export const istRelevanteBuchung = (b) => Boolean(b.relevant) && b.art === 'ausgabe' && !b.geloeschtAm;

/**
 * D142: Belegname für relevante Ausgaben: „JJJJ-MM-TT Notiz“, mehrere Belege mit „ (2)“, „ (3)“ …
 * Unzulässige Zeichen für Dateinamen werden durch „-“ ersetzt. Nur noch nicht hochgeladene Belege
 * (ohne driveId) werden umbenannt – Dateien in Google Drive behalten ihren Namen.
 */
export function benenneBelege(belege, datum, notiz) {
  const basis = `${datum} ${String(notiz ?? '').trim().replace(/\s+/g, ' ')}`.trim();
  return belege.map((b, i) => {
    if (b.driveId) return b;
    const endung = (b.name ?? '').includes('.') ? b.name.split('.').pop() : (b.mime === 'application/pdf' ? 'pdf' : 'jpg');
    return { ...b, name: `${basis}${i > 0 ? ` (${i + 1})` : ''}.${endung}`.replace(/[\\/:*?"<>|]/g, '-') };
  });
}

/** Gruppe vereinheitlichen: Leerzeichen am Rand weg, höchstens 40 Zeichen */
export const normGruppe = (text) => String(text ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_GRUPPE);
const gruppenSchluessel = (text) => normGruppe(text).toLocaleLowerCase('de');

/** Prüft die Eingaben eines eigenen Eintrags und baut den Datensatz */
export function baueRelevant(eingabe, { alt = null, jetzt = new Date().toISOString() } = {}) {
  const { betragCent, datum } = eingabe;
  if (betragCent == null || betragCent === 0) throw new Error('Bitte einen Betrag eingeben.');
  if (betragCent < 0) throw new Error('Bitte den Betrag ohne Minus eingeben.');
  if (!istGueltigesDatum(datum)) throw new Error('Bitte ein gültiges Datum wählen.');
  if (datum < '1990-01-01') throw new Error('Bitte ein Datum ab 1990 wählen.');
  // D142: Notiz ist Pflicht (sie benennt auch den Beleg)
  if (!String(eingabe.notiz ?? '').trim()) throw new Error('Bei einer relevanten Ausgabe ist die Notiz Pflicht – sie benennt auch den Beleg.');
  return {
    belege: [],
    geloeschtAm: null,
    erstelltAm: jetzt,
    ...(alt ?? { id: crypto.randomUUID() }),
    datum,
    betragCent,
    partner: String(eingabe.partner ?? '').trim().slice(0, 80),
    kategorieId: eingabe.kategorieId || null,
    notiz: String(eingabe.notiz ?? '').trim().slice(0, 200),
    gruppe: normGruppe(eingabe.gruppe),
    belege: eingabe.belege ?? alt?.belege ?? [],
    geaendertAm: jetzt,
  };
}

/**
 * Alle relevanten Ausgaben als einheitliche Zeilen.
 * archivBuchungen: Buchungen aus archivierten Jahren (mit archivJahr), nur lesen.
 * Zeile: { quelle: 'eintrag' | 'buchung', id, datum, betragCent, partner, kategorieId, notiz, gruppe,
 *          belege, kontoId, archivJahr, ref }
 */
export function relevanteZeilen({ relevant = [], buchungen = [], archivBuchungen = [] }) {
  const zeilen = [];
  for (const e of relevant) {
    if (e.geloeschtAm) continue;
    zeilen.push({
      quelle: 'eintrag', id: e.id, datum: e.datum, betragCent: e.betragCent, partner: e.partner ?? '',
      kategorieId: e.kategorieId ?? null, notiz: e.notiz ?? '', gruppe: normGruppe(e.gruppe), belege: e.belege ?? [],
      kontoId: null, archivJahr: null, ref: e,
    });
  }
  for (const b of [...buchungen, ...archivBuchungen]) {
    if (!istRelevanteBuchung(b)) continue;
    zeilen.push({
      quelle: 'buchung', id: b.id, datum: b.datum, betragCent: b.betragCent, partner: b.partner ?? '',
      kategorieId: b.kategorieId ?? null, notiz: b.notiz ?? '', gruppe: normGruppe(b.relevantGruppe), belege: b.belege ?? [],
      kontoId: b.kontoId, archivJahr: b.archivJahr ?? null, ref: b,
    });
  }
  return zeilen;
}

/** Alle verwendeten Gruppen, A–Z (als Name gilt die zuerst gefundene Schreibweise) */
export function gruppenListe(zeilen) {
  const gruppen = new Map();
  for (const z of zeilen) {
    const k = gruppenSchluessel(z.gruppe);
    if (k && !gruppen.has(k)) gruppen.set(k, z.gruppe);
  }
  return [...gruppen.values()].sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' }));
}

/** Gruppenfilter: '' = alle, OHNE_GRUPPE = ohne Gruppe, sonst der Name (Groß/klein egal) */
export const OHNE_GRUPPE = '__ohne';
export function filtereGruppe(zeilen, gruppe) {
  if (!gruppe) return zeilen;
  if (gruppe === OHNE_GRUPPE) return zeilen.filter((z) => !z.gruppe);
  const k = gruppenSchluessel(gruppe);
  return zeilen.filter((z) => gruppenSchluessel(z.gruppe) === k);
}

/** Nach Jahren gruppiert, neuestes Jahr zuerst, innerhalb neueste Ausgabe zuerst */
export function nachJahren(zeilen) {
  const jahre = new Map();
  for (const z of zeilen) {
    const jahr = Number(z.datum.slice(0, 4));
    if (!jahre.has(jahr)) jahre.set(jahr, []);
    jahre.get(jahr).push(z);
  }
  return [...jahre.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([jahr, liste]) => ({
      jahr,
      zeilen: liste.sort((a, b) => b.datum.localeCompare(a.datum) || b.betragCent - a.betragCent),
      summeCent: liste.reduce((s, z) => s + z.betragCent, 0),
    }));
}

/**
 * Welche Beleg-Kopien im Ordner "Relevante Ausgaben" fehlen bzw. weg müssen? (für den Abgleich)
 * Ergebnis: { kopieren: [beleg …], entfernen: [beleg …] }
 */
export function kopienAufgaben(buchung) {
  const soll = istRelevanteBuchung(buchung);
  const belege = buchung.belege ?? [];
  return {
    kopieren: soll ? belege.filter((x) => x.driveId && !x.relevantDriveId) : [],
    entfernen: soll ? [] : belege.filter((x) => x.relevantDriveId),
  };
}
