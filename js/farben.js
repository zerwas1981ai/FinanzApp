// D155/D158/D159: Kategorie-Farben. Jede Ausgaben-Hauptkategorie hat eine Farbe (automatisch, in den
// Stammdaten änderbar); Unterkategorien erben sie. Einnahme-Kategorien haben keine Farbe (D158).
// In Buchungslisten steht davon ein kleiner Farbpunkt.
// Datenfeld an der Hauptkategorie: farbe = Schlüssel aus PALETTE (fehlt/null = automatisch).
// Reine Funktionen – mit `npm test` geprüft.

/**
 * D159: 80 Farben – eine Grauleiste (Weiß, 6 Grautöne, Schwarz) und 12 Farbtöne im Farbkreis
 * (Rot … Magenta) in je 6 Helligkeitsstufen (1 = sehr hell … 6 = sehr dunkel). Je Stufe sind Sättigung und
 * Helligkeit gleich, dadurch passen die Farben zueinander. Reihenfolge = Reihenfolge in der Auswahl.
 */
export const FARBTOENE = ['rot', 'orange', 'bernstein', 'gelb', 'limette', 'gruen', 'tuerkis', 'petrol', 'blau', 'indigo', 'violett', 'magenta'];
export const PALETTE = [
  { schluessel: 'weiss', name: 'Weiß', hex: '#ffffff', grau: true },
  { schluessel: 'grau-1', name: 'Grau 1', hex: '#dcdee0', grau: true },
  { schluessel: 'grau-2', name: 'Grau 2', hex: '#bbbfc3', grau: true },
  { schluessel: 'grau-3', name: 'Grau 3', hex: '#989da4', grau: true },
  { schluessel: 'grau-4', name: 'Grau 4', hex: '#787e87', grau: true },
  { schluessel: 'grau-5', name: 'Grau 5', hex: '#5b6067', grau: true },
  { schluessel: 'grau-6', name: 'Grau 6', hex: '#3c3f44', grau: true },
  { schluessel: 'schwarz', name: 'Schwarz', hex: '#000000', grau: true },
  { schluessel: 'rot-1', name: 'Rot 1', hex: '#edc1c0' },
  { schluessel: 'orange-1', name: 'Orange 1', hex: '#edd2c0' },
  { schluessel: 'bernstein-1', name: 'Bernstein 1', hex: '#eddec0' },
  { schluessel: 'gelb-1', name: 'Gelb 1', hex: '#ede7c0' },
  { schluessel: 'limette-1', name: 'Limette 1', hex: '#dcedc0' },
  { schluessel: 'gruen-1', name: 'Grün 1', hex: '#c0edcf' },
  { schluessel: 'tuerkis-1', name: 'Türkis 1', hex: '#c0ede5' },
  { schluessel: 'petrol-1', name: 'Petrol 1', hex: '#c0e5ed' },
  { schluessel: 'blau-1', name: 'Blau 1', hex: '#c0d5ed' },
  { schluessel: 'indigo-1', name: 'Indigo 1', hex: '#c0c4ed' },
  { schluessel: 'violett-1', name: 'Violett 1', hex: '#d3c0ed' },
  { schluessel: 'magenta-1', name: 'Magenta 1', hex: '#edc0df' },
  { schluessel: 'rot-2', name: 'Rot 2', hex: '#e09794' },
  { schluessel: 'orange-2', name: 'Orange 2', hex: '#e0b394' },
  { schluessel: 'bernstein-2', name: 'Bernstein 2', hex: '#e0c794' },
  { schluessel: 'gelb-2', name: 'Gelb 2', hex: '#e0d694' },
  { schluessel: 'limette-2', name: 'Limette 2', hex: '#c4e094' },
  { schluessel: 'gruen-2', name: 'Grün 2', hex: '#94e0ae' },
  { schluessel: 'tuerkis-2', name: 'Türkis 2', hex: '#94e0d3' },
  { schluessel: 'petrol-2', name: 'Petrol 2', hex: '#94d3e0' },
  { schluessel: 'blau-2', name: 'Blau 2', hex: '#94b8e0' },
  { schluessel: 'indigo-2', name: 'Indigo 2', hex: '#949ce0' },
  { schluessel: 'violett-2', name: 'Violett 2', hex: '#b594e0' },
  { schluessel: 'magenta-2', name: 'Magenta 2', hex: '#e094c9' },
  { schluessel: 'rot-3', name: 'Rot 3', hex: '#d06f6c' },
  { schluessel: 'orange-3', name: 'Orange 3', hex: '#d0946c' },
  { schluessel: 'bernstein-3', name: 'Bernstein 3', hex: '#d0af6c' },
  { schluessel: 'gelb-3', name: 'Gelb 3', hex: '#d0c36c' },
  { schluessel: 'limette-3', name: 'Limette 3', hex: '#acd06c' },
  { schluessel: 'gruen-3', name: 'Grün 3', hex: '#6cd08d' },
  { schluessel: 'tuerkis-3', name: 'Türkis 3', hex: '#6cd0c0' },
  { schluessel: 'petrol-3', name: 'Petrol 3', hex: '#6cc0d0' },
  { schluessel: 'blau-3', name: 'Blau 3', hex: '#6c9bd0' },
  { schluessel: 'indigo-3', name: 'Indigo 3', hex: '#6c76d0' },
  { schluessel: 'violett-3', name: 'Violett 3', hex: '#976cd0' },
  { schluessel: 'magenta-3', name: 'Magenta 3', hex: '#d06cb2' },
  { schluessel: 'rot-4', name: 'Rot 4', hex: '#c24b47' },
  { schluessel: 'orange-4', name: 'Orange 4', hex: '#c27847' },
  { schluessel: 'bernstein-4', name: 'Bernstein 4', hex: '#c29947' },
  { schluessel: 'gelb-4', name: 'Gelb 4', hex: '#c2b147' },
  { schluessel: 'limette-4', name: 'Limette 4', hex: '#95c247' },
  { schluessel: 'gruen-4', name: 'Grün 4', hex: '#47c270' },
  { schluessel: 'tuerkis-4', name: 'Türkis 4', hex: '#47c2ad' },
  { schluessel: 'petrol-4', name: 'Petrol 4', hex: '#47adc2' },
  { schluessel: 'blau-4', name: 'Blau 4', hex: '#4781c2' },
  { schluessel: 'indigo-4', name: 'Indigo 4', hex: '#4754c2' },
  { schluessel: 'violett-4', name: 'Violett 4', hex: '#7c47c2' },
  { schluessel: 'magenta-4', name: 'Magenta 4', hex: '#c2479d' },
  { schluessel: 'rot-5', name: 'Rot 5', hex: '#9f3b38' },
  { schluessel: 'orange-5', name: 'Orange 5', hex: '#9f6138' },
  { schluessel: 'bernstein-5', name: 'Bernstein 5', hex: '#9f7c38' },
  { schluessel: 'gelb-5', name: 'Gelb 5', hex: '#9f9138' },
  { schluessel: 'limette-5', name: 'Limette 5', hex: '#799f38' },
  { schluessel: 'gruen-5', name: 'Grün 5', hex: '#389f5a' },
  { schluessel: 'tuerkis-5', name: 'Türkis 5', hex: '#389f8d' },
  { schluessel: 'petrol-5', name: 'Petrol 5', hex: '#388d9f' },
  { schluessel: 'blau-5', name: 'Blau 5', hex: '#38689f' },
  { schluessel: 'indigo-5', name: 'Indigo 5', hex: '#38429f' },
  { schluessel: 'violett-5', name: 'Violett 5', hex: '#64389f' },
  { schluessel: 'magenta-5', name: 'Magenta 5', hex: '#9f3880' },
  { schluessel: 'rot-6', name: 'Rot 6', hex: '#772f2c' },
  { schluessel: 'orange-6', name: 'Orange 6', hex: '#774a2c' },
  { schluessel: 'bernstein-6', name: 'Bernstein 6', hex: '#775e2c' },
  { schluessel: 'gelb-6', name: 'Gelb 6', hex: '#776d2c' },
  { schluessel: 'limette-6', name: 'Limette 6', hex: '#5c772c' },
  { schluessel: 'gruen-6', name: 'Grün 6', hex: '#2c7745' },
  { schluessel: 'tuerkis-6', name: 'Türkis 6', hex: '#2c776b' },
  { schluessel: 'petrol-6', name: 'Petrol 6', hex: '#2c6b77' },
  { schluessel: 'blau-6', name: 'Blau 6', hex: '#2c4f77' },
  { schluessel: 'indigo-6', name: 'Indigo 6', hex: '#2c3477' },
  { schluessel: 'violett-6', name: 'Violett 6', hex: '#4d2c77' },
  { schluessel: 'magenta-6', name: 'Magenta 6', hex: '#772c61' },
];
const NACH_SCHLUESSEL = new Map(PALETTE.map((p) => [p.schluessel, p]));

/** Schlüssel früherer Paletten (D155: 12 Farben, D158: hell/mittel/dunkel) → passende neue Farbe */
const ALTE_SCHLUESSEL = {
  blau: 'blau-4', gruen: 'gruen-4', orange: 'orange-4', violett: 'violett-4', tuerkis: 'tuerkis-4', rot: 'rot-4',
  gelb: 'gelb-4', pink: 'magenta-4', oliv: 'limette-5', braun: 'orange-5', indigo: 'indigo-4', grau: 'grau-4',
};
export function paletteEintrag(schluessel) {
  if (!schluessel) return null;
  const alt = ALTE_SCHLUESSEL[schluessel]
    ?? schluessel.replace(/-hell$/, '-2').replace(/-mittel$/, '-4').replace(/-dunkel$/, '-5');
  return NACH_SCHLUESSEL.get(alt) ?? null;
}

/**
 * D159: Farbe passend zum Namen. Das erste Stichwort, das im Namen vorkommt, bestimmt die Wunschfarbe.
 * Ist sie schon vergeben, nimmt die App denselben Farbton in einer benachbarten Helligkeit.
 */
export const NAMENS_FARBEN = [
  [['tier'], 'limette-4'], // vor „Wohnen“, sonst passt „Haustier“ zu „haus…“
  [['wohn', 'miete', 'haushalt', 'nebenkost'], 'bernstein-4'],
  [['lebensmittel', 'einkauf', 'essen', 'supermarkt', 'nahrung'], 'gruen-4'],
  [['mobil', 'auto', 'kfz', 'verkehr', 'fahrzeug'], 'blau-4'],
  [['versicher'], 'indigo-4'],
  [['freizeit', 'hobby', 'urlaub', 'reise', 'sport'], 'orange-3'],
  [['gesundheit', 'pflege', 'arzt', 'apothek'], 'tuerkis-4'],
  [['kleidung', 'mode', 'schuh'], 'magenta-3'],
  [['kind', 'bildung', 'schule', 'kita'], 'gelb-3'],
  [['investition', 'spar', 'anlage', 'vorsorge', 'depot'], 'petrol-5'],
  [['kredit', 'finanzierung', 'darlehen', 'schulden'], 'rot-5'],
  [['geschenk', 'spende'], 'rot-3'],
  [['steuer', 'abgabe', 'gebühr'], 'violett-4'],
  [['abo', 'streaming', 'medien', 'telefon', 'internet'], 'violett-3'],
  [['bargeld'], 'grau-3'],
  [['sonstig', 'diverse', 'allgemein'], 'grau-4'],
];

export function namensFarbe(name) {
  const n = String(name ?? '').toLocaleLowerCase('de');
  return NAMENS_FARBEN.find(([woerter]) => woerter.some((w) => n.includes(w)))?.[1] ?? null;
}

/** Ohne passendes Stichwort: mittlere Stufen, im Farbkreis gut verteilt (benachbarte Kategorien unterscheidbar) */
const VERTEILT = ['blau', 'gruen', 'orange', 'violett', 'tuerkis', 'rot', 'indigo', 'limette', 'magenta', 'petrol', 'bernstein', 'gelb'];
const RESERVE = [4, 3, 5, 2].flatMap((st) => VERTEILT.map((t) => `${t}-${st}`));

/** Andere Helligkeiten desselben Farbtons, nach Nähe zur Wunschstufe (Grau: die übrigen Grautöne) */
function nachbarn(schluessel) {
  const [ton, st] = schluessel.split('-');
  if (ton === 'grau' || ton === 'weiss' || ton === 'schwarz') return ['grau-3', 'grau-4', 'grau-2', 'grau-5', 'grau-1', 'grau-6'].filter((k) => k !== schluessel);
  const s = Number(st);
  return [s - 1, s + 1, s - 2, s + 2, s + 3, s - 3].filter((x) => x >= 1 && x <= 6).map((x) => `${ton}-${x}`);
}

/**
 * Farbe je Ausgaben-Hauptkategorie: Map(id → Palette-Eintrag). Einnahme-Kategorien bekommen keine (D158).
 * 1. Selbst gewählte Farben gelten wie gewählt.
 * 2. Übrige (älteste zuerst, damit sich nichts verschiebt, wenn neue dazukommen): Wunschfarbe zum Namen,
 *    sonst eine freie Farbe der Reserve; ist alles vergeben, die am wenigsten benutzte.
 */
export function farbenZuordnung(kategorien) {
  const haupt = kategorien.filter((k) => !k.elternId && k.art !== 'einnahme');
  const ergebnis = new Map();
  const benutzt = new Map(PALETTE.map((p) => [p.schluessel, 0]));
  const vergib = (k, schluessel) => {
    ergebnis.set(k.id, NACH_SCHLUESSEL.get(schluessel));
    benutzt.set(schluessel, benutzt.get(schluessel) + 1);
  };
  for (const k of haupt) {
    const p = paletteEintrag(k.farbe);
    if (p) vergib(k, p.schluessel);
  }
  const automatisch = haupt.filter((k) => !ergebnis.has(k.id))
    .sort((a, b) => (a.erstelltAm ?? '').localeCompare(b.erstelltAm ?? '') || String(a.id).localeCompare(String(b.id)));
  const frei = (s) => benutzt.get(s) === 0;
  // erst alle mit passendem Namen (sie haben Vorrang auf ihre Wunschfarbe), dann der Rest
  const mitWunsch = automatisch.filter((k) => namensFarbe(k.name));
  for (const k of mitWunsch) {
    const wunsch = namensFarbe(k.name);
    const wahl = [wunsch, ...nachbarn(wunsch)].find(frei);
    if (wahl) vergib(k, wahl);
  }
  for (const k of automatisch.filter((x) => !ergebnis.has(x.id))) {
    const wahl = RESERVE.find(frei)
      ?? RESERVE.reduce((best, s) => (benutzt.get(s) < benutzt.get(best) ? s : best), RESERVE[0]);
    vergib(k, wahl);
  }
  return ergebnis;
}

/** Farbe (Hex) für eine Kategorie-ID – Unterkategorien über ihre Hauptkategorie; unbekannt/Einnahme = null */
export function farbeVon(kategorieId, katNachId, zuordnung) {
  const k = katNachId.get(kategorieId);
  if (!k) return null;
  return zuordnung.get(k.elternId ?? k.id)?.hex ?? null;
}
