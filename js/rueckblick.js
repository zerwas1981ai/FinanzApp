// D156: Monats- und Jahresrückblick (D240: Umschalter „Rückblick“ im Tab Auswertungen).
// Monat: Vergleich mit den beiden Vormonaten. Jahr: Vergleich mit dem Vorjahr (laufendes Jahr: Vorjahr bis
// zum gleichen Tag). Gezählt werden echte Buchungen (gebucht und vorgemerkt) bis heute, ohne Papierkorb und
// ohne Umbuchungen – Umbuchungen sind weder Einnahme noch Ausgabe.
// Reine Funktionen – mit `npm test` geprüft.

import { sparquote } from './auswertung.js';
import { zaehltCent } from './rechnen.js';
import { monatKurz, monatLang } from './format.js';


const zwei = (n) => String(n).padStart(2, '0');
const monatsletzter = (j, m) => `${j}-${zwei(m)}-${zwei(new Date(Date.UTC(j, m, 0)).getUTCDate())}`;

/** 'JJJJ-MM' um n Monate verschieben */
export function plusMonat(schluessel, n) {
  const j = Number(schluessel.slice(0, 4));
  const m = Number(schluessel.slice(5, 7)) - 1 + n;
  return `${j + Math.floor(m / 12)}-${zwei((((m % 12) + 12) % 12) + 1)}`;
}


/** Echte Buchungen, die in Einnahmen/Ausgaben zählen */
// D214: offene Auslagen und Rückzahlungen zählen nicht (zaehltCent 0)
const zaehlt = (b, heute) => !b.geloeschtAm && (b.art === 'einnahme' || b.art === 'ausgabe') && b.datum <= heute && zaehltCent(b) > 0;

/** Summen eines Zeitraums: Einnahmen, Ausgaben, Saldo, Sparquote und Ausgaben je Hauptkategorie */
export function periodenSummen(buchungen, kategorien, von, bis, heute) {
  const kat = new Map(kategorien.map((k) => [k.id, k]));
  let einnahmen = 0;
  let ausgaben = 0;
  const jeHaupt = new Map();
  for (const b of buchungen) {
    if (!zaehlt(b, heute) || b.datum < von || b.datum > bis) continue;
    if (b.art === 'einnahme') { einnahmen += zaehltCent(b); continue; }
    ausgaben += zaehltCent(b);
    const unter = kat.get(b.kategorieId);
    const hId = unter?.elternId ?? unter?.id ?? 'unbekannt';
    jeHaupt.set(hId, (jeHaupt.get(hId) ?? 0) + zaehltCent(b));
  }
  return { von, bis, einnahmen, ausgaben, saldo: einnahmen - ausgaben, sparquote: sparquote(einnahmen, ausgaben), jeHaupt };
}

/** Tabelle Ausgaben je Hauptkategorie über mehrere Zeiträume, nach dem letzten Zeitraum absteigend */
function kategorieZeilen(perioden, kategorien) {
  const kat = new Map(kategorien.map((k) => [k.id, k]));
  const ids = new Set(perioden.flatMap((p) => [...p.jeHaupt.keys()]));
  return [...ids].map((id) => {
    const werte = perioden.map((p) => p.jeHaupt.get(id) ?? 0);
    const [vorher, jetzt] = werte.slice(-2);
    return { id, name: kat.get(id)?.name ?? 'Unbekannte Kategorie', werte, differenz: jetzt - vorher };
  }).sort((a, b) => b.werte.at(-1) - a.werte.at(-1) || b.werte.at(-2) - a.werte.at(-2) || a.name.localeCompare(b.name, 'de'));
}

/**
 * D242: Durchschnitt je Monat über die `anzahl` Monate VOR `monat` (der gewählte Monat zählt nicht mit, damit er fair
 * verglichen wird). Monate vor der ersten erfassten Buchung zählen nicht – sonst sähe „noch nichts erfasst“ wie 0 € aus.
 * Ergebnis: { monate, einnahmen, ausgaben, saldo, sparquote, jeHaupt } (gerundete Cent) oder null ohne Vormonate.
 */
export function schnittVormonate(buchungen, kategorien, monat, heute, anzahl = 6) {
  const erste = buchungen.filter((b) => zaehlt(b, heute)).reduce((min, b) => (b.datum < min ? b.datum : min), heute).slice(0, 7);
  const schluessel = Array.from({ length: anzahl }, (_, i) => plusMonat(monat, i - anzahl)).filter((s) => s >= erste);
  if (!schluessel.length) return null;
  const n = schluessel.length;
  const letzter = plusMonat(monat, -1);
  const summen = periodenSummen(buchungen, kategorien, `${schluessel[0]}-01`, monatsletzter(Number(letzter.slice(0, 4)), Number(letzter.slice(5, 7))), heute);
  const einnahmen = Math.round(summen.einnahmen / n);
  const ausgaben = Math.round(summen.ausgaben / n);
  return {
    monate: n, einnahmen, ausgaben, saldo: einnahmen - ausgaben, sparquote: sparquote(einnahmen, ausgaben),
    jeHaupt: new Map([...summen.jeHaupt].map(([id, cent]) => [id, Math.round(cent / n)])),
  };
}

/** D242: Pfeil, ob ein Wert über (▲), unter (▼) oder etwa auf (→, weniger als 1 €) dem Durchschnitt liegt */
export function trendPfeil(wert, schnitt) {
  if (schnitt == null) return null;
  const d = wert - schnitt;
  if (Math.abs(d) < 100) return '→';
  return d > 0 ? '▲' : '▼';
}

/**
 * D242: Ausgaben einer Hauptkategorie in einem oder mehreren Zeiträumen ([[von, bis], …]) – gleiche Zählregel wie
 * der Rückblick (ohne Papierkorb, Umbuchungen, offene Auslagen; nur bis heute). Neueste zuerst.
 */
export function kategorieBuchungen(buchungen, kategorien, hauptId, zeitraeume, heute) {
  const kat = new Map(kategorien.map((k) => [k.id, k]));
  const hauptVon = (b) => { const u = kat.get(b.kategorieId); return u?.elternId ?? u?.id ?? 'unbekannt'; };
  return buchungen
    .filter((b) => zaehlt(b, heute) && b.art === 'ausgabe' && hauptVon(b) === hauptId
      && zeitraeume.some(([von, bis]) => b.datum >= von && b.datum <= bis))
    .sort((a, b) => b.datum.localeCompare(a.datum) || b.betragCent - a.betragCent);
}

/** Die größten Ausgaben eines Zeitraums */
function groesste(buchungen, von, bis, heute, anzahl) {
  return buchungen
    .filter((b) => zaehlt(b, heute) && b.art === 'ausgabe' && b.datum >= von && b.datum <= bis)
    .sort((a, b) => b.betragCent - a.betragCent || b.datum.localeCompare(a.datum))
    .slice(0, anzahl);
}

/**
 * Monatsrückblick für 'JJJJ-MM' mit den beiden Vormonaten (älteste zuerst).
 * D241: anzahl = 6 → „6 Monate“: der Monat und die 5 davor; größte Ausgaben dann über alle 6 Monate (10 Stück).
 * Der laufende Monat zählt nur bis heute (laufend = true).
 */
export function monatsRueckblick(buchungen, kategorien, monat, heute, anzahl = 3) {
  const schluessel = Array.from({ length: anzahl }, (_, i) => plusMonat(monat, i - anzahl + 1));
  const perioden = schluessel.map((s) => {
    const j = Number(s.slice(0, 4));
    const m = Number(s.slice(5, 7));
    const bis = monatsletzter(j, m);
    return { schluessel: s, ...periodenSummen(buchungen, kategorien, `${s}-01`, bis < heute ? bis : heute, heute) };
  });
  const letzte = perioden.at(-1);
  const sechs = anzahl === 6;
  return {
    art: sechs ? 'sechs' : 'monat',
    titel: sechs ? `Rückblick 6 Monate bis ${monatLang(monat)}` : `Monatsrückblick ${monatLang(monat)}`,
    laufend: heute.slice(0, 7) === monat,
    spalten: schluessel.map(monatKurz),
    perioden,
    kategorien: kategorieZeilen(perioden, kategorien),
    groesste: sechs ? groesste(buchungen, perioden[0].von, letzte.bis, heute, 10) : groesste(buchungen, letzte.von, letzte.bis, heute, 5),
    schnitt: schnittVormonate(buchungen, kategorien, monat, heute), // D242
  };
}

/**
 * Jahresrückblick mit Vorjahr. Im laufenden Jahr wird das Vorjahr nur bis zum gleichen Tag gezählt,
 * damit der Vergleich fair ist. Dazu die Monate des Jahres einzeln.
 */
export function jahresRueckblick(buchungen, kategorien, jahr, heute) {
  const laufend = Number(heute.slice(0, 4)) === jahr;
  const bis = laufend ? heute : `${jahr}-12-31`;
  const vorjahrBis = laufend ? `${jahr - 1}-${heute.slice(5, 10) === '02-29' ? '02-28' : heute.slice(5, 10)}` : `${jahr - 1}-12-31`;
  const perioden = [
    { schluessel: String(jahr - 1), ...periodenSummen(buchungen, kategorien, `${jahr - 1}-01-01`, vorjahrBis, heute) },
    { schluessel: String(jahr), ...periodenSummen(buchungen, kategorien, `${jahr}-01-01`, bis, heute) },
  ];
  const monate = [];
  for (let m = 1; m <= 12; m++) {
    const von = `${jahr}-${zwei(m)}-01`;
    if (von > heute) break;
    const ende = monatsletzter(jahr, m);
    const s = periodenSummen(buchungen, kategorien, von, ende < heute ? ende : heute, heute);
    monate.push({ schluessel: `${jahr}-${zwei(m)}`, einnahmen: s.einnahmen, ausgaben: s.ausgaben, saldo: s.saldo });
  }
  return {
    art: 'jahr',
    titel: `Jahresrückblick ${jahr}`,
    laufend,
    vorjahrBis: laufend ? vorjahrBis : null,
    spalten: [String(jahr - 1), String(jahr)],
    perioden,
    kategorien: kategorieZeilen(perioden, kategorien),
    monate,
    groesste: groesste(buchungen, `${jahr}-01-01`, bis, heute, 10),
  };
}

/** Wählbare Monate und Jahre: von der ersten echten Buchung bis heute, neueste zuerst */
export function waehlbareZeitraeume(buchungen, heute) {
  const erste = buchungen.filter((b) => zaehlt(b, heute)).reduce((min, b) => (b.datum < min ? b.datum : min), heute);
  const monate = [];
  for (let s = heute.slice(0, 7); s >= erste.slice(0, 7); s = plusMonat(s, -1)) monate.push(s);
  const jahre = [];
  for (let j = Number(heute.slice(0, 4)); j >= Number(erste.slice(0, 4)); j--) jahre.push(j);
  return { monate, jahre };
}
