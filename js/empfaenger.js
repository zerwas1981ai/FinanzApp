// D205: Empfänger/Absender vereinheitlichen (Stammdaten → Empfänger).
// Reine Funktionen ohne Datenbank – mit `npm test` geprüft. Ein Empfänger ist kein eigener Datensatz,
// sondern der Text im Feld „Empfänger/Absender“ (Buchungen, wiederkehrende, geplante, relevante Ausgaben)
// bzw. „An (Empfänger)“ bei Verträgen. Zusammenfassen = alle Schreibweisen auf einen Namen ändern.

import { partnerSchluessel } from './auswertung.js';

/** Sammlungen und ihr Feld für den Empfänger */
export const EMPFAENGER_FELDER = [
  ['buchungen', 'partner'], ['wiederkehrend', 'partner'], ['geplant', 'partner'], ['relevant', 'partner'], ['vertraege', 'anbieter'],
];

const zaehlt = (sammlung, x) => !x.geloeschtAm && !(sammlung === 'buchungen' && x.art === 'umbuchung');

/**
 * Alle Empfänger mit Anzahl. daten: { buchungen, wiederkehrend, geplant, relevant, vertraege }.
 * Groß-/Kleinschreibung und Leerzeichen am Rand gelten als gleich; angezeigt wird die häufigste Schreibweise.
 * Ergebnis: [{ schluessel, name, anzahl, schreibweisen: [name, …] }], häufigste zuerst.
 */
export function empfaengerListe(daten) {
  const je = new Map();
  for (const [sammlung, feld] of EMPFAENGER_FELDER) {
    for (const x of daten[sammlung] ?? []) {
      const name = String(x[feld] ?? '').trim();
      if (!name || !zaehlt(sammlung, x)) continue;
      const k = partnerSchluessel(name);
      if (!je.has(k)) je.set(k, { schluessel: k, anzahl: 0, namen: new Map() });
      const e = je.get(k);
      e.anzahl += 1;
      e.namen.set(name, (e.namen.get(name) ?? 0) + 1);
    }
  }
  return [...je.values()].map((e) => {
    // häufigste Schreibweise zuerst; bei Gleichstand lieber mit Großbuchstaben („Rewe“ vor „rewe“)
    const klein = (n) => (n === n.toLocaleLowerCase('de') ? 1 : 0);
    const schreibweisen = [...e.namen.entries()].sort((a, b) => b[1] - a[1] || klein(a[0]) - klein(b[0]) || a[0].localeCompare(b[0], 'de')).map(([n]) => n);
    return { schluessel: e.schluessel, name: schreibweisen[0], anzahl: e.anzahl, schreibweisen };
  }).sort((a, b) => b.anzahl - a.anzahl || a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }));
}

// Zusätze, die bei der Ähnlichkeit nicht zählen (Rechtsform, Filiale …)
const ZUSAETZE = new Set(['gmbh', 'mbh', 'ag', 'kg', 'ohg', 'se', 'ev', 'eg', 'ek', 'co', 'und', 'markt', 'city', 'filiale',
  'online', 'shop', 'de', 'com', 'deutschland', 'germany', 'gruppe', 'group', 'the', 'der', 'die', 'das']);

/** Kern eines Namens: klein, Umlaute vereinfacht, ohne Satzzeichen und ohne Zusätze – „REWE Markt GmbH“ → „rewe“ */
export function namensKern(name) {
  const woerter = String(name ?? '').toLocaleLowerCase('de')
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .split(/[^a-z0-9]+/).filter((w) => w && !ZUSAETZE.has(w));
  return woerter.join('');
}

/**
 * Gruppen ähnlicher Empfänger (mindestens zwei): gleicher Kern, oder ein Kern beginnt mit dem anderen
 * (mindestens 4 Zeichen, z. B. „amazon“ und „amazonmarketplace“). Ergebnis: [[eintrag, …], …], größte zuerst.
 */
export function aehnlicheGruppen(liste) {
  const kerne = liste.map((e) => namensKern(e.name));
  const eltern = liste.map((_, i) => i);
  const wurzel = (i) => (eltern[i] === i ? i : (eltern[i] = wurzel(eltern[i])));
  for (let i = 0; i < liste.length; i++) {
    for (let j = i + 1; j < liste.length; j++) {
      const [a, b] = [kerne[i], kerne[j]];
      if (!a || !b) continue;
      const kurz = a.length <= b.length ? a : b;
      const lang = kurz === a ? b : a;
      if (a === b || (kurz.length >= 4 && lang.startsWith(kurz))) eltern[wurzel(i)] = wurzel(j);
    }
  }
  const gruppen = new Map();
  liste.forEach((e, i) => {
    const w = wurzel(i);
    if (!gruppen.has(w)) gruppen.set(w, []);
    gruppen.get(w).push(e);
  });
  return [...gruppen.values()].filter((g) => g.length > 1)
    .map((g) => g.sort((a, b) => b.anzahl - a.anzahl))
    .sort((a, b) => b.reduce((s, e) => s + e.anzahl, 0) - a.reduce((s, e) => s + e.anzahl, 0));
}

/**
 * Umbenennen/Zusammenfassen: alle Datensätze, deren Empfänger zu einem der Schlüssel gehört, bekommen `neuerName`.
 * Ergebnis: { sammlung: [geänderte Datensätze], … } (nur Sammlungen mit Änderungen).
 */
export function umbenennen(daten, schluessel, neuerName, jetzt = new Date().toISOString()) {
  const name = String(neuerName ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (!name) throw new Error('Bitte einen Namen eingeben.');
  const set = new Set(schluessel);
  const ergebnis = {};
  for (const [sammlung, feld] of EMPFAENGER_FELDER) {
    const geaendert = (daten[sammlung] ?? [])
      .filter((x) => x[feld] && set.has(partnerSchluessel(x[feld])) && x[feld] !== name)
      .map((x) => ({ ...x, [feld]: name, geaendertAm: jetzt }));
    if (geaendert.length) ergebnis[sammlung] = geaendert;
  }
  return ergebnis;
}
