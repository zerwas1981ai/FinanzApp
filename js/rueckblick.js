// D156: Monats- und Jahresrückblick (Knopf „Rückblick“ in „Alle Buchungen“).
// Monat: Vergleich mit den beiden Vormonaten. Jahr: Vergleich mit dem Vorjahr (laufendes Jahr: Vorjahr bis
// zum gleichen Tag). Gezählt werden echte Buchungen (gebucht und vorgemerkt) bis heute, ohne Papierkorb und
// ohne Umbuchungen – Umbuchungen sind weder Einnahme noch Ausgabe.
// Reine Funktionen – mit `npm test` geprüft.

import { sparquote } from './auswertung.js';

const MONAT_KURZ = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const MONAT_LANG = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

const zwei = (n) => String(n).padStart(2, '0');
const monatsletzter = (j, m) => `${j}-${zwei(m)}-${zwei(new Date(Date.UTC(j, m, 0)).getUTCDate())}`;

/** 'JJJJ-MM' um n Monate verschieben */
export function plusMonat(schluessel, n) {
  const j = Number(schluessel.slice(0, 4));
  const m = Number(schluessel.slice(5, 7)) - 1 + n;
  return `${j + Math.floor(m / 12)}-${zwei((((m % 12) + 12) % 12) + 1)}`;
}

export const monatKurz = (schluessel) => `${MONAT_KURZ[Number(schluessel.slice(5, 7)) - 1]} ${schluessel.slice(2, 4)}`;
export const monatLang = (schluessel) => `${MONAT_LANG[Number(schluessel.slice(5, 7)) - 1]} ${schluessel.slice(0, 4)}`;

/** Echte Buchungen, die in Einnahmen/Ausgaben zählen */
const zaehlt = (b, heute) => !b.geloeschtAm && (b.art === 'einnahme' || b.art === 'ausgabe') && b.datum <= heute;

/** Summen eines Zeitraums: Einnahmen, Ausgaben, Saldo, Sparquote und Ausgaben je Hauptkategorie */
export function periodenSummen(buchungen, kategorien, von, bis, heute) {
  const kat = new Map(kategorien.map((k) => [k.id, k]));
  let einnahmen = 0;
  let ausgaben = 0;
  const jeHaupt = new Map();
  for (const b of buchungen) {
    if (!zaehlt(b, heute) || b.datum < von || b.datum > bis) continue;
    if (b.art === 'einnahme') { einnahmen += b.betragCent; continue; }
    ausgaben += b.betragCent;
    const unter = kat.get(b.kategorieId);
    const hId = unter?.elternId ?? unter?.id ?? 'unbekannt';
    jeHaupt.set(hId, (jeHaupt.get(hId) ?? 0) + b.betragCent);
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

/** Die größten Ausgaben eines Zeitraums */
function groesste(buchungen, von, bis, heute, anzahl) {
  return buchungen
    .filter((b) => zaehlt(b, heute) && b.art === 'ausgabe' && b.datum >= von && b.datum <= bis)
    .sort((a, b) => b.betragCent - a.betragCent || b.datum.localeCompare(a.datum))
    .slice(0, anzahl);
}

/**
 * Monatsrückblick für 'JJJJ-MM' mit den beiden Vormonaten (älteste zuerst).
 * Der laufende Monat zählt nur bis heute (laufend = true).
 */
export function monatsRueckblick(buchungen, kategorien, monat, heute) {
  const schluessel = [plusMonat(monat, -2), plusMonat(monat, -1), monat];
  const perioden = schluessel.map((s) => {
    const j = Number(s.slice(0, 4));
    const m = Number(s.slice(5, 7));
    const bis = monatsletzter(j, m);
    return { schluessel: s, ...periodenSummen(buchungen, kategorien, `${s}-01`, bis < heute ? bis : heute, heute) };
  });
  const letzte = perioden.at(-1);
  return {
    art: 'monat',
    titel: `Monatsrückblick ${monatLang(monat)}`,
    laufend: heute.slice(0, 7) === monat,
    spalten: schluessel.map(monatKurz),
    perioden,
    kategorien: kategorieZeilen(perioden, kategorien),
    groesste: groesste(buchungen, letzte.von, letzte.bis, heute, 5),
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
