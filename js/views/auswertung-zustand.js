// Tab „Auswertungen“: gemeinsamer Zustand (Filter, Sortierung, Ansicht) für Liste, Filter und Analyse.
// Bis D258 Teil von alle-buchungen.js.

import { STANDARD_FILTER, STANDARD_SORTIERUNG } from '../auswertung.js';

export const nachName = (a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' });
// D124: zunächst 20 Buchungen (Umbuchungen zählen dabei nicht mit), der Rest per Knopf darunter
export const SEITE = 20;

// Zustand bleibt erhalten, solange die App offen ist (beim Neuladen: Standard)
export const zustand = {
  filter: { ...STANDARD_FILTER },
  sortierung: STANDARD_SORTIERUNG,
  modus: 'liste', // liste | analyse | rueckblick (D240) | belege
  analyseArt: 'ausgabe',
  analyseGruppe: 'kategorie', // kategorie | partner
  vorjahr: false, // Vorjahr im Verlauf zeigen (D107)
  sichtbar: SEITE,
  offen: new Set(), // aufgeklappte Kategorien in der Analyse
  auswahl: null, // D260: null = normale Liste, sonst Set der angehakten Buchungs-IDs
};

/** "Ansehen" eines archivierten Jahres (aus den Stammdaten): Filter auf dieses Jahr stellen */
export function zeigeJahr(jahr) {
  zustand.sichtbar = SEITE;
  zustand.filter = { ...STANDARD_FILTER, zeitraum: 'eigen', von: `${jahr}-01-01`, bis: `${jahr}-12-31` };
}

// D122: Reihenfolge nach Wunsch des Nutzers; „Vormonat“ und „Vorjahr“ entfallen
export const ZEITRAEUME = [
  ['alles', 'Alles'],
  ['jahr', 'Dieses Jahr'],
  ['monat', 'Dieser Monat'],
  ['vormonat', 'Vormonat'], // D174
  ['letzte3', 'Letzte 3 Monate'],
  ['eigen', 'Eigener Zeitraum'],
];
