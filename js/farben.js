// D155/D158: Kategorie-Farben. Jede Ausgaben-Hauptkategorie hat eine Farbe (automatisch, in den Stammdaten
// änderbar); Unterkategorien erben sie. Einnahme-Kategorien haben keine Farbe (D158).
// In Buchungslisten steht davon ein kleiner Farbpunkt.
// Datenfeld an der Hauptkategorie: farbe = Schlüssel aus PALETTE (fehlt/null = automatisch).
// Reine Funktionen – mit `npm test` geprüft.

/**
 * D158: 36 aufeinander abgestimmte Farben – 12 Farbtöne im Farbkreis, je hell / mittel / dunkel,
 * mit gleicher Sättigung und Helligkeit je Stufe (gut sichtbar im hellen und im dunklen Modus).
 * Reihenfolge: Stufe für Stufe, darin der Farbkreis von Rot bis Magenta (so steht sie auch in der Auswahl).
 */
export const FARBTOENE = ['Rot', 'Orange', 'Bernstein', 'Gelb', 'Limette', 'Grün', 'Türkis', 'Petrol', 'Blau', 'Indigo', 'Violett', 'Magenta'];
export const STUFEN = ['hell', 'mittel', 'dunkel'];
export const PALETTE = [
  { schluessel: 'rot-hell', name: 'Rot hell', hex: '#e1918e' },
  { schluessel: 'orange-hell', name: 'Orange hell', hex: '#e1af8e' },
  { schluessel: 'bernstein-hell', name: 'Bernstein hell', hex: '#e1c58e' },
  { schluessel: 'gelb-hell', name: 'Gelb hell', hex: '#e1d68e' },
  { schluessel: 'limette-hell', name: 'Limette hell', hex: '#c3e18e' },
  { schluessel: 'gruen-hell', name: 'Grün hell', hex: '#8ee1aa' },
  { schluessel: 'tuerkis-hell', name: 'Türkis hell', hex: '#8ee1d3' },
  { schluessel: 'petrol-hell', name: 'Petrol hell', hex: '#8ed3e1' },
  { schluessel: 'blau-hell', name: 'Blau hell', hex: '#8eb5e1' },
  { schluessel: 'indigo-hell', name: 'Indigo hell', hex: '#8e96e1' },
  { schluessel: 'violett-hell', name: 'Violett hell', hex: '#b28ee1' },
  { schluessel: 'magenta-hell', name: 'Magenta hell', hex: '#e18ec8' },
  { schluessel: 'rot-mittel', name: 'Rot mittel', hex: '#ca5c58' },
  { schluessel: 'orange-mittel', name: 'Orange mittel', hex: '#ca8658' },
  { schluessel: 'bernstein-mittel', name: 'Bernstein mittel', hex: '#caa458' },
  { schluessel: 'gelb-mittel', name: 'Gelb mittel', hex: '#cabb58' },
  { schluessel: 'limette-mittel', name: 'Limette mittel', hex: '#a1ca58' },
  { schluessel: 'gruen-mittel', name: 'Grün mittel', hex: '#58ca7e' },
  { schluessel: 'tuerkis-mittel', name: 'Türkis mittel', hex: '#58cab7' },
  { schluessel: 'petrol-mittel', name: 'Petrol mittel', hex: '#58b7ca' },
  { schluessel: 'blau-mittel', name: 'Blau mittel', hex: '#588eca' },
  { schluessel: 'indigo-mittel', name: 'Indigo mittel', hex: '#5864ca' },
  { schluessel: 'violett-mittel', name: 'Violett mittel', hex: '#8a58ca' },
  { schluessel: 'magenta-mittel', name: 'Magenta mittel', hex: '#ca58a8' },
  { schluessel: 'rot-dunkel', name: 'Rot dunkel', hex: '#9f3b38' },
  { schluessel: 'orange-dunkel', name: 'Orange dunkel', hex: '#9f6138' },
  { schluessel: 'bernstein-dunkel', name: 'Bernstein dunkel', hex: '#9f7c38' },
  { schluessel: 'gelb-dunkel', name: 'Gelb dunkel', hex: '#9f9138' },
  { schluessel: 'limette-dunkel', name: 'Limette dunkel', hex: '#799f38' },
  { schluessel: 'gruen-dunkel', name: 'Grün dunkel', hex: '#389f5a' },
  { schluessel: 'tuerkis-dunkel', name: 'Türkis dunkel', hex: '#389f8d' },
  { schluessel: 'petrol-dunkel', name: 'Petrol dunkel', hex: '#388d9f' },
  { schluessel: 'blau-dunkel', name: 'Blau dunkel', hex: '#38689f' },
  { schluessel: 'indigo-dunkel', name: 'Indigo dunkel', hex: '#38429f' },
  { schluessel: 'violett-dunkel', name: 'Violett dunkel', hex: '#64389f' },
  { schluessel: 'magenta-dunkel', name: 'Magenta dunkel', hex: '#9f3880' },
];
const NACH_SCHLUESSEL = new Map(PALETTE.map((p) => [p.schluessel, p]));

/** Schlüssel der ersten Palette (D155, 12 Farben) → passende neue Farbe, damit schon gewählte Farben bleiben */
const ALTE_SCHLUESSEL = {
  blau: 'blau-mittel', gruen: 'gruen-mittel', orange: 'orange-mittel', violett: 'violett-mittel', tuerkis: 'tuerkis-mittel',
  rot: 'rot-mittel', gelb: 'gelb-mittel', pink: 'magenta-mittel', oliv: 'limette-dunkel', braun: 'orange-dunkel',
  indigo: 'indigo-mittel', grau: 'blau-dunkel',
};
export const paletteEintrag = (schluessel) => NACH_SCHLUESSEL.get(ALTE_SCHLUESSEL[schluessel] ?? schluessel) ?? null;

/**
 * Reihenfolge für die automatische Vergabe: erst die mittleren Töne, im Farbkreis so verteilt, dass
 * aufeinanderfolgende Kategorien gut unterscheidbar sind; danach die dunklen, dann die hellen.
 */
const VERTEILT = [8, 5, 1, 10, 6, 0, 9, 4, 11, 7, 2, 3];
export const AUTO_REIHENFOLGE = ['mittel', 'dunkel', 'hell'].flatMap((stufe) => VERTEILT.map((i) => NACH_SCHLUESSEL.get(`${PALETTE[i].schluessel.split('-')[0]}-${stufe}`)));

/**
 * Farbe je Ausgaben-Hauptkategorie: Map(id → Palette-Eintrag). Einnahme-Kategorien bekommen keine (D158).
 * Selbst gewählte Farben gelten wie gewählt. Die übrigen bekommen der Reihe nach (älteste Kategorie zuerst,
 * damit sich bestehende Farben nicht verschieben, wenn neue Kategorien dazukommen) die nächste noch nicht
 * vergebene Farbe der automatischen Reihenfolge; sind alle vergeben, beginnt sie von vorn.
 */
export function farbenZuordnung(kategorien) {
  const haupt = kategorien.filter((k) => !k.elternId && k.art !== 'einnahme');
  const ergebnis = new Map();
  const benutzt = new Map(PALETTE.map((p) => [p.schluessel, 0]));
  for (const k of haupt) {
    const p = paletteEintrag(k.farbe);
    if (p) { ergebnis.set(k.id, p); benutzt.set(p.schluessel, benutzt.get(p.schluessel) + 1); }
  }
  const automatisch = haupt.filter((k) => !ergebnis.has(k.id))
    .sort((a, b) => (a.erstelltAm ?? '').localeCompare(b.erstelltAm ?? '') || String(a.id).localeCompare(String(b.id)));
  for (const k of automatisch) {
    // am wenigsten benutzte Farbe, bei Gleichstand die erste der automatischen Reihenfolge
    const p = AUTO_REIHENFOLGE.reduce((best, x) => (benutzt.get(x.schluessel) < benutzt.get(best.schluessel) ? x : best), AUTO_REIHENFOLGE[0]);
    ergebnis.set(k.id, p);
    benutzt.set(p.schluessel, benutzt.get(p.schluessel) + 1);
  }
  return ergebnis;
}

/** Farbe (Hex) für eine Kategorie-ID – Unterkategorien über ihre Hauptkategorie; unbekannt/Einnahme = null */
export function farbeVon(kategorieId, katNachId, zuordnung) {
  const k = katNachId.get(kategorieId);
  if (!k) return null;
  return zuordnung.get(k.elternId ?? k.id)?.hex ?? null;
}
