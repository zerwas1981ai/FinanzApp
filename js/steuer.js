// D167: Steuer-Paket – steuerlich relevante Ausgaben je Jahr. Reine Funktionen, mit `npm test` geprüft.
//
// Markierung: Unterkategorie.steuerthema (Schlüssel aus STEUERTHEMEN) gilt für alle Ausgaben darauf.
// Eine einzelne Buchung kann abweichen: buchung.steuerthema = Schlüssel | 'kein' (nicht steuerlich) |
// null/fehlt (wie die Kategorie). Gezählt werden nur Ausgaben (keine Einnahmen/Umbuchungen), ohne Papierkorb.

import { alsCsv, csvBetrag, csvDatum } from './export.js';

export const STEUERTHEMEN = [
  { schluessel: 'handwerker', name: 'Handwerkerleistungen' },
  { schluessel: 'haushaltsnah', name: 'Haushaltsnahe Dienstleistungen' },
  { schluessel: 'werbungskosten', name: 'Werbungskosten / Arbeitsmittel' },
  { schluessel: 'kinderbetreuung', name: 'Kinderbetreuung' },
  { schluessel: 'krankheit', name: 'Krankheitskosten' },
  { schluessel: 'vorsorge', name: 'Versicherungen & Vorsorge' },
  { schluessel: 'spenden', name: 'Spenden' },
  { schluessel: 'sonstiges', name: 'Sonstiges (steuerlich)' },
];
const NAME = new Map(STEUERTHEMEN.map((t) => [t.schluessel, t.name]));
export const steuerthemaName = (schluessel) => NAME.get(schluessel) ?? null;

/** Wirksames Steuerthema einer Buchung (oder null) */
export function steuerthemaVon(b, katNachId) {
  if (b.art !== 'ausgabe' || b.geloeschtAm) return null;
  if (b.steuerthema === 'kein') return null;
  if (b.steuerthema && NAME.has(b.steuerthema)) return b.steuerthema;
  const t = katNachId.get(b.kategorieId)?.steuerthema;
  return t && NAME.has(t) ? t : null;
}

/**
 * Steuerlich relevante Ausgaben eines Jahres, je Thema (Reihenfolge wie STEUERTHEMEN), darin älteste zuerst.
 * Ergebnis: { jahr, themen: [{ schluessel, name, summeCent, buchungen }], gesamtCent, anzahl }
 */
export function steuerJahr(buchungen, kategorien, jahr, heute) {
  const kat = new Map(kategorien.map((k) => [k.id, k]));
  const je = new Map();
  for (const b of buchungen) {
    if (!b.datum.startsWith(`${jahr}-`) || b.datum > heute) continue;
    const t = steuerthemaVon(b, kat);
    if (!t) continue;
    if (!je.has(t)) je.set(t, []);
    je.get(t).push(b);
  }
  const themen = STEUERTHEMEN.filter((t) => je.has(t.schluessel)).map((t) => {
    const liste = je.get(t.schluessel).sort((a, b) => a.datum.localeCompare(b.datum) || a.betragCent - b.betragCent);
    return { schluessel: t.schluessel, name: t.name, summeCent: liste.reduce((s, b) => s + b.betragCent, 0), buchungen: liste };
  });
  return {
    jahr,
    themen,
    gesamtCent: themen.reduce((s, t) => s + t.summeCent, 0),
    anzahl: themen.reduce((s, t) => s + t.buchungen.length, 0),
  };
}

/** Jahre mit steuerlich relevanten Ausgaben, neueste zuerst */
export function steuerJahre(buchungen, kategorien, heute) {
  const kat = new Map(kategorien.map((k) => [k.id, k]));
  const jahre = new Set(buchungen.filter((b) => b.datum <= heute && steuerthemaVon(b, kat)).map((b) => Number(b.datum.slice(0, 4))));
  return [...jahre].sort((a, b) => b - a);
}

/** CSV für Excel: Thema, Datum, Empfänger, Kategorie, Notiz, Betrag, Belege; je Thema eine Summenzeile */
export function steuerCsv(ergebnis, { konten = [], kategorien = [] }) {
  const kat = new Map(kategorien.map((k) => [k.id, k]));
  const konto = new Map(konten.map((k) => [k.id, k.name]));
  const zeilen = [];
  for (const t of ergebnis.themen) {
    for (const b of t.buchungen) {
      const unter = kat.get(b.kategorieId);
      zeilen.push([t.name, csvDatum(b.datum), b.partner ?? '', [kat.get(unter?.elternId)?.name, unter?.name].filter(Boolean).join(' › '),
        b.notiz ?? '', konto.get(b.kontoId) ?? '', csvBetrag(b.betragCent), (b.belege ?? []).map((x) => x.name).join(', ')]);
    }
    zeilen.push([`Summe ${t.name}`, '', '', '', '', '', csvBetrag(t.summeCent), '']);
  }
  zeilen.push([`Gesamt ${ergebnis.jahr}`, '', '', '', '', '', csvBetrag(ergebnis.gesamtCent), '']);
  return alsCsv(['Steuerthema', 'Datum', 'Empfänger', 'Kategorie', 'Notiz', 'Konto', 'Betrag (€)', 'Belege'], zeilen);
}

/** Dateiname im ZIP: „Thema/JJJJ-MM-TT Belegname“ – unzulässige Zeichen ersetzt, doppelte nummeriert */
export function zipNamen(eintraege) {
  const vergeben = new Set();
  return eintraege.map(({ thema, beleg }) => {
    const ordner = (steuerthemaName(thema) ?? 'Sonstiges').replace(/[\\/:*?"<>|]/g, '-');
    let name = `${ordner}/${String(beleg.name ?? 'Beleg').replace(/[\\/:*?"<>|]/g, '-')}`;
    if (vergeben.has(name)) {
      const punkt = name.lastIndexOf('.');
      const basis = punkt > name.lastIndexOf('/') ? name.slice(0, punkt) : name;
      const endung = punkt > name.lastIndexOf('/') ? name.slice(punkt) : '';
      let i = 2;
      while (vergeben.has(`${basis} (${i})${endung}`)) i++;
      name = `${basis} (${i})${endung}`;
    }
    vergeben.add(name);
    return name;
  });
}
