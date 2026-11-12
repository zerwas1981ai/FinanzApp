// D155: Kategorie-Farben. Jede Hauptkategorie hat eine Farbe (automatisch, in den Stammdaten änderbar);
// Unterkategorien erben sie. In Buchungslisten steht davon ein kleiner Farbpunkt.
// Datenfeld an der Hauptkategorie: farbe = Schlüssel aus PALETTE (fehlt/null = automatisch).
// Reine Funktionen – mit `npm test` geprüft.

/** Ruhige Farben, die im hellen und im dunklen Modus gut zu sehen sind */
export const PALETTE = [
  { schluessel: 'blau', name: 'Blau', hex: '#4f86f7' },
  { schluessel: 'gruen', name: 'Grün', hex: '#3fae6a' },
  { schluessel: 'orange', name: 'Orange', hex: '#ec9a3c' },
  { schluessel: 'violett', name: 'Violett', hex: '#9b6bdf' },
  { schluessel: 'tuerkis', name: 'Türkis', hex: '#2bb3b1' },
  { schluessel: 'rot', name: 'Rot', hex: '#e05d5d' },
  { schluessel: 'gelb', name: 'Gelb', hex: '#d4b12a' },
  { schluessel: 'pink', name: 'Pink', hex: '#e46aa6' },
  { schluessel: 'oliv', name: 'Oliv', hex: '#8aa83a' },
  { schluessel: 'braun', name: 'Braun', hex: '#a5794f' },
  { schluessel: 'indigo', name: 'Indigo', hex: '#5c6bd6' },
  { schluessel: 'grau', name: 'Grau', hex: '#8a94a3' },
];
const NACH_SCHLUESSEL = new Map(PALETTE.map((p) => [p.schluessel, p]));

/**
 * Farbe je Hauptkategorie: Map(id → Palette-Eintrag).
 * Selbst gewählte Farben gelten wie gewählt. Die übrigen bekommen der Reihe nach (älteste Kategorie zuerst,
 * damit sich bestehende Farben nicht verschieben, wenn neue Kategorien dazukommen) die nächste noch
 * nicht vergebene Farbe; sind alle vergeben, beginnt die Palette von vorn.
 */
export function farbenZuordnung(kategorien) {
  const haupt = kategorien.filter((k) => !k.elternId);
  const ergebnis = new Map();
  const benutzt = new Map(PALETTE.map((p) => [p.schluessel, 0]));
  for (const k of haupt) {
    const p = NACH_SCHLUESSEL.get(k.farbe);
    if (p) { ergebnis.set(k.id, p); benutzt.set(p.schluessel, benutzt.get(p.schluessel) + 1); }
  }
  const automatisch = haupt.filter((k) => !ergebnis.has(k.id))
    .sort((a, b) => (a.erstelltAm ?? '').localeCompare(b.erstelltAm ?? '') || String(a.id).localeCompare(String(b.id)));
  for (const k of automatisch) {
    // am wenigsten benutzte Farbe, bei Gleichstand die erste der Palette
    const p = PALETTE.reduce((best, x) => (benutzt.get(x.schluessel) < benutzt.get(best.schluessel) ? x : best), PALETTE[0]);
    ergebnis.set(k.id, p);
    benutzt.set(p.schluessel, benutzt.get(p.schluessel) + 1);
  }
  return ergebnis;
}

/** Farbe (Hex) für eine Kategorie-ID – Unterkategorien über ihre Hauptkategorie; unbekannt = null */
export function farbeVon(kategorieId, katNachId, zuordnung) {
  const k = katNachId.get(kategorieId);
  if (!k) return null;
  return zuordnung.get(k.elternId ?? k.id)?.hex ?? null;
}
