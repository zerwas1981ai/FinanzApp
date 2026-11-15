// Kategorien: Unterkategorie in eine andere Hauptkategorie verschieben (Entscheidung D93).
// Reine Funktion ohne Datenbank – mit `npm test` geprüft.
//
// Unterkategorien haben keine eigene Art, sie erben sie von der Hauptkategorie. Deshalb nur
// zwischen Hauptkategorien GLEICHER Art (Ausgabe ↔ Ausgabe, Einnahme ↔ Einnahme) – sonst passten
// vorhandene Buchungen (Art „Ausgabe“) nicht mehr zu ihrer Kategorie.

const gleicherName = (a, b) => a.trim().localeCompare(b.trim(), 'de', { sensitivity: 'base' }) === 0;

/** Hauptkategorien, in die eine Unterkategorie verschoben werden kann (gleiche Art, nicht archiviert, nicht die eigene) */
export function moeglicheZiele(unter, kategorien) {
  const eltern = kategorien.find((k) => k.id === unter.elternId);
  return kategorien.filter((k) => !k.elternId && !k.archiviert && k.id !== unter.elternId && k.art === eltern?.art);
}

/**
 * Verschiebt eine Unterkategorie in eine andere Hauptkategorie. Gibt den geänderten Datensatz zurück.
 * Buchungen und Annahmen verweisen auf die Unterkategorie (kategorieId) und gehören damit
 * automatisch zur neuen Hauptkategorie – auch rückwirkend in Auswertungen und Budgets.
 */
export function verschiebeUnterkategorie(unter, zielId, kategorien, jetzt = new Date().toISOString()) {
  if (!unter?.elternId) throw new Error('Nur Unterkategorien lassen sich verschieben.');
  const alt = kategorien.find((k) => k.id === unter.elternId);
  const ziel = kategorien.find((k) => k.id === zielId);
  if (!ziel || ziel.elternId) throw new Error('Bitte eine Hauptkategorie wählen.');
  if (ziel.id === unter.elternId) throw new Error('Die Unterkategorie gehört schon zu dieser Hauptkategorie.');
  if (ziel.archiviert) throw new Error('In eine archivierte Hauptkategorie kann nicht verschoben werden.');
  if (alt && ziel.art !== alt.art) {
    throw new Error('Verschieben geht nur zwischen Hauptkategorien gleicher Art (Ausgabe zu Ausgabe, Einnahme zu Einnahme).');
  }
  if (kategorien.some((k) => k.elternId === ziel.id && k.id !== unter.id && gleicherName(k.name, unter.name))) {
    throw new Error(`In „${ziel.name}“ gibt es „${unter.name}“ schon (eventuell archiviert). Bitte vorher umbenennen.`);
  }
  return { ...unter, elternId: ziel.id, geaendertAm: jetzt };
}

/* ---------- D210: Unterkategorien zusammenführen ---------- */

/** Sammlungen mit einem Verweis auf eine Unterkategorie (Feld kategorieId) */
export const KATEGORIE_SAMMLUNGEN = ['buchungen', 'wiederkehrend', 'geplant', 'relevant'];

/** Mögliche Ziele zum Zusammenführen: andere, nicht archivierte Unterkategorien gleicher Art – dieselbe Hauptkategorie zuerst */
export function zusammenfuehrZiele(unter, kategorien) {
  const kat = new Map(kategorien.map((k) => [k.id, k]));
  const art = kat.get(unter.elternId)?.art;
  return kategorien
    .filter((k) => k.elternId && k.id !== unter.id && !k.archiviert && kat.get(k.elternId)?.art === art && !kat.get(k.elternId)?.archiviert)
    .map((k) => ({ ...k, pfad: `${kat.get(k.elternId)?.name ?? '?'} › ${k.name}` }))
    .sort((a, b) => (a.elternId !== unter.elternId) - (b.elternId !== unter.elternId)
      || a.pfad.localeCompare(b.pfad, 'de', { sensitivity: 'base' }));
}

/**
 * Alles, was auf `quelleId` verweist, zeigt danach auf `zielId`. daten: { buchungen, wiederkehrend, geplant, relevant }.
 * Ergebnis: { sammlung: [geänderte Datensätze] } – die Quell-Kategorie löscht der Aufrufer danach.
 */
export function unterkategorieZusammenfuehren(quelleId, zielId, daten, jetzt = new Date().toISOString()) {
  if (!zielId || quelleId === zielId) throw new Error('Bitte eine andere Unterkategorie wählen.');
  const ergebnis = {};
  for (const s of KATEGORIE_SAMMLUNGEN) {
    const geaendert = (daten[s] ?? []).filter((x) => x.kategorieId === quelleId).map((x) => ({ ...x, kategorieId: zielId, geaendertAm: jetzt }));
    if (geaendert.length) ergebnis[s] = geaendert;
  }
  return ergebnis;
}
