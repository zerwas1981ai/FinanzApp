// Datenmodell-Version und Migrationen.
//
// So funktioniert es:
// - Jeder gespeicherte Datenstand trägt eine Versionsnummer ("version").
// - Ändert sich in einer späteren Etappe das Datenmodell, wird DATENMODELL_VERSION
//   um 1 erhöht und unten ein Migrationsschritt ergänzt, z. B.:
//
//     {
//       nach: 2,
//       beschreibung: 'Konten bekommen ein Feld "farbe"',
//       migriere(daten) {
//         for (const k of daten.konten) k.farbe ??= null;
//         return daten;
//       },
//     },
//
// - Beim Start (und später beim Laden aus Google Drive) werden alle fehlenden
//   Schritte automatisch nacheinander ausgeführt: 1 → 2 → 3 …
// - Migrationen arbeiten auf einem einfachen Daten-Objekt
//   { version, konten: [...], kategorien: [...] } – unabhängig von IndexedDB.
//   So lassen sie sich mit derselben Funktion auf die Drive-JSON-Datei anwenden.

export const DATENMODELL_VERSION = 1;

export const MIGRATIONEN = [
  // Noch keine – Version 1 ist der erste Stand.
];

/**
 * Bringt einen Datenstand auf die Zielversion.
 * Gibt { daten, angewendet } zurück; das Original bleibt unverändert.
 */
export function migriereDaten(daten, migrationen = MIGRATIONEN, zielVersion = DATENMODELL_VERSION) {
  if (!daten || !Number.isInteger(daten.version)) {
    throw new Error('Datenstand ohne gültige Versionsnummer.');
  }
  if (daten.version > zielVersion) {
    throw new Error(
      `Die Daten stammen aus einer neueren App-Version (Datenversion ${daten.version}, ` +
      `diese App kennt bis ${zielVersion}). Bitte die App aktualisieren.`,
    );
  }

  let d = structuredClone(daten);
  const angewendet = [];
  const schritte = [...migrationen].sort((a, b) => a.nach - b.nach);

  while (d.version < zielVersion) {
    const schritt = schritte.find((m) => m.nach === d.version + 1);
    if (!schritt) throw new Error(`Migration auf Version ${d.version + 1} fehlt.`);
    d = schritt.migriere(d) ?? d;
    d.version = schritt.nach;
    angewendet.push(schritt.nach);
  }
  return { daten: d, angewendet };
}
