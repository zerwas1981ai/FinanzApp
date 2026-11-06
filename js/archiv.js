// Archivierung abgeschlossener Jahre (D68). Reine Funktionen – mit `npm test` geprüft.
//
// Ein Jahr J archivieren heißt:
//  - Alle (nicht gelöschten) Buchungen und Kontoabstimmungen aus J wandern in eine eigene
//    Archivdatei (in Google Drive: finanzapp-archiv-J.json).
//  - Jedes Konto, das vor dem 01.01.J+1 begonnen hat, startet danach am 01.01.J+1 mit dem
//    Kontostand vom 31.12.J als Anfangssaldo. Die Kontostände ändern sich dadurch nicht.
//  - Geplante Einmalbuchungen, die durch eine archivierte Buchung erledigt sind, werden als
//    erledigt markiert (sonst würden sie wieder als offen gelten).
//  - Projektkosten aus J werden im Archiv-Eintrag gemerkt, damit die Projektsumme stimmt.
//  - Ein Eintrag in der (abgeglichenen) Sammlung "archive" merkt sich, was nötig ist, um das
//    Jahr zurückzuholen.
// Archiviert wird immer das älteste Jahr zuerst und nur Jahre vor dem laufenden.

import { kontostand } from './rechnen.js';

const jahrVon = (datum) => Number(datum.slice(0, 4));

/**
 * Welches Jahr kann als Nächstes archiviert werden?
 * Ergebnis: { jahr, anzahl, hindernis } oder null (nichts zu archivieren).
 * hindernis: Text, warum es (noch) nicht geht – z. B. Buchungen dieses Jahres im Papierkorb.
 */
export function naechstesArchivJahr(daten, heute) {
  const aktiv = daten.buchungen.filter((b) => !b.geloeschtAm);
  if (!aktiv.length) return null;
  const jahr = Math.min(...aktiv.map((b) => jahrVon(b.datum)));
  if (jahr >= jahrVon(heute)) return null;
  const anzahl = aktiv.filter((b) => jahrVon(b.datum) === jahr && b.richtung !== 'zu').length;
  let hindernis = null;
  if (daten.buchungen.some((b) => b.geloeschtAm && jahrVon(b.datum) <= jahr)) {
    hindernis = `Im Papierkorb liegen noch Buchungen aus ${jahr} oder früher. Bitte zuerst wiederherstellen oder endgültig löschen.`;
  }
  return { jahr, anzahl, hindernis };
}

/**
 * Archiviert ein Jahr. Ergebnis:
 *  { daten (neuer Datenstand ohne das Jahr), inhalt (Inhalt der Archivdatei), eintrag (für "archive") }
 */
export function archiviere(daten, jahr, jetzt = new Date().toISOString()) {
  const ende = `${jahr}-12-31`;
  const neuerStichtag = `${jahr + 1}-01-01`;
  const imJahr = (x) => jahrVon(x.datum) === jahr;
  const archiviert = daten.buchungen.filter((b) => !b.geloeschtAm && imJahr(b));
  const ids = new Set(archiviert.map((b) => b.id));
  const abstimmungen = (daten.abstimmungen ?? []).filter(imJahr);

  // Konten: Endstand 31.12. als neuer Anfangssaldo zum 01.01.
  const kontenVorher = [];
  const konten = daten.konten.map((k) => {
    if (k.stichtag > ende) return k;
    kontenVorher.push({ id: k.id, anfangssaldoCent: k.anfangssaldoCent, stichtag: k.stichtag });
    return { ...k, anfangssaldoCent: kontostand(k, daten.buchungen, ende), stichtag: neuerStichtag, geaendertAm: jetzt };
  });

  // Geplante Einmalbuchungen, die durch archivierte Buchungen erledigt sind
  const erledigtDurch = new Set(archiviert.map((b) => b.geplantId).filter(Boolean));
  const geplantMarkiert = [];
  const geplant = (daten.geplant ?? []).map((g) => {
    if (!erledigtDurch.has(g.id) || g.erledigtAm) return g;
    geplantMarkiert.push(g.id);
    return { ...g, erledigtAm: jetzt, geaendertAm: jetzt };
  });

  // Projektkosten dieses Jahres (Ausgaben − Einnahmen)
  const projekte = {};
  for (const b of archiviert) {
    if (!b.projektId || b.art === 'umbuchung') continue;
    projekte[b.projektId] = (projekte[b.projektId] ?? 0) + (b.art === 'einnahme' ? -b.betragCent : b.betragCent);
  }

  const eintrag = {
    id: `archiv-${jahr}`,
    jahr,
    anzahlBuchungen: archiviert.filter((b) => b.richtung !== 'zu').length,
    driveId: null,
    erstelltAm: jetzt,
    kontenVorher,
    geplantMarkiert,
    geplantMarkiertAm: jetzt,
    projekte,
  };
  const inhalt = {
    art: 'finanzapp-archiv',
    version: daten.version,
    jahr,
    erstelltAm: jetzt,
    buchungen: archiviert,
    abstimmungen,
    // Zum Anzeigen der Namen, auch wenn Konten/Kategorien später gelöscht werden
    konten: daten.konten,
    kategorien: daten.kategorien,
    projekte: daten.projekte ?? [],
  };
  return {
    daten: {
      ...daten,
      buchungen: daten.buchungen.filter((b) => !ids.has(b.id)),
      abstimmungen: (daten.abstimmungen ?? []).filter((a) => !imJahr(a)),
      konten,
      geplant,
      archive: [...(daten.archive ?? []), eintrag],
    },
    inhalt,
    eintrag,
  };
}

/** Das zuletzt archivierte Jahr (nur dieses lässt sich zurückholen) oder null */
export const letztesArchiv = (daten) => [...(daten.archive ?? [])].sort((a, b) => b.jahr - a.jahr)[0] ?? null;

/**
 * Holt das zuletzt archivierte Jahr zurück: Buchungen und Abstimmungen kommen wieder hinein,
 * Anfangssalden und Stichtage der Konten werden wie vorher, Markierungen zurückgenommen.
 */
export function holeZurueck(daten, eintrag, inhalt, jetzt = new Date().toISOString()) {
  if (letztesArchiv(daten)?.id !== eintrag.id) throw new Error('Zurückholen geht nur für das zuletzt archivierte Jahr.');
  const vorher = new Map(eintrag.kontenVorher.map((k) => [k.id, k]));
  const markiert = new Set(eintrag.geplantMarkiert ?? []);
  const vorhanden = new Set(daten.buchungen.map((b) => b.id));
  return {
    ...daten,
    buchungen: [...daten.buchungen, ...inhalt.buchungen.filter((b) => !vorhanden.has(b.id))],
    abstimmungen: [...(daten.abstimmungen ?? []), ...(inhalt.abstimmungen ?? [])],
    konten: daten.konten.map((k) => (vorher.has(k.id)
      ? { ...k, anfangssaldoCent: vorher.get(k.id).anfangssaldoCent, stichtag: vorher.get(k.id).stichtag, geaendertAm: jetzt }
      : k)),
    geplant: (daten.geplant ?? []).map((g) => (markiert.has(g.id) && g.erledigtAm === eintrag.geplantMarkiertAm
      ? { ...g, erledigtAm: null, geaendertAm: jetzt }
      : g)),
    archive: (daten.archive ?? []).filter((a) => a.id !== eintrag.id),
  };
}

/** Projektkosten aus archivierten Jahren (für projektZahlen) */
export function archivKostenVon(projektId, archive = []) {
  return archive.reduce((s, a) => s + (a.projekte?.[projektId] ?? 0), 0);
}
