// Reihenfolge der Konten (D84): vom Nutzer per ▲/▼ in den Stammdaten festgelegt.
// Reine Funktionen ohne Datenbank – mit `npm test` geprüft.
//
// Jedes Konto trägt "reihenfolge" (0, 1, 2 …, ab Datenversion 11). Das Feld wird wie alle Daten mit
// Google Drive abgeglichen, die Reihenfolge gilt also auf allen Geräten.
// Archivierte Konten stehen immer hinter den aktiven.

const ENDE = Number.MAX_SAFE_INTEGER;
const nachName = (a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' });

/** Vergleich: aktive vor archivierten, dann nach Reihenfolge, bei Gleichstand nach Name */
export function nachKontoReihenfolge(a, b) {
  return Number(Boolean(a.archiviert)) - Number(Boolean(b.archiviert))
    || (a.reihenfolge ?? ENDE) - (b.reihenfolge ?? ENDE)
    || nachName(a, b);
}

export const sortiereKonten = (konten) => [...konten].sort(nachKontoReihenfolge);

/** Platz für ein neues Konto: ans Ende */
export const naechsteReihenfolge = (konten) => Math.max(-1, ...konten.map((k) => k.reihenfolge ?? -1)) + 1;

/**
 * Ein aktives Konto um eine Stelle nach oben (richtung -1) oder unten (+1) schieben.
 * Liefert nur die Konten, deren Reihenfolge sich ändert (zum Speichern) – leer, wenn es nicht geht.
 */
export function verschiebeKonto(konten, id, richtung, jetzt = new Date().toISOString()) {
  const aktiv = sortiereKonten(konten.filter((k) => !k.archiviert));
  const i = aktiv.findIndex((k) => k.id === id);
  const j = i + richtung;
  if (i < 0 || j < 0 || j >= aktiv.length) return [];
  [aktiv[i], aktiv[j]] = [aktiv[j], aktiv[i]];
  // Durchnummerieren (räumt dabei auch fehlende oder doppelte Nummern auf)
  return aktiv
    .map((k, n) => ({ k, n }))
    .filter(({ k, n }) => k.reihenfolge !== n)
    .map(({ k, n }) => ({ ...k, reihenfolge: n, geaendertAm: jetzt }));
}

/** Startreihenfolge für die Migration: wie bisher alphabetisch, archivierte zuletzt */
export function startReihenfolge(konten) {
  const sortiert = [...konten].sort((a, b) => Number(Boolean(a.archiviert)) - Number(Boolean(b.archiviert)) || nachName(a, b));
  return new Map(sortiert.map((k, n) => [k.id, n]));
}
