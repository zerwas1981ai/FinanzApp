// D146: Suche über alles (Lupe oben in der Kopfzeile).
// Durchsucht Buchungen, eigene relevante Ausgaben, Projekte, wiederkehrende und geplante Buchungen.
// Reine Funktion – mit `npm test` geprüft.

import { formatEuro, formatDatum } from './format.js';

export const BEREICHE = [
  { schluessel: 'buchung', titel: 'Buchungen' },
  { schluessel: 'relevant', titel: 'Relevante Ausgaben (eigene Einträge)' },
  { schluessel: 'projekt', titel: 'Projekte' },
  { schluessel: 'vertrag', titel: 'Verträge' },
  { schluessel: 'wiederkehrend', titel: 'Wiederkehrende Buchungen' },
  { schluessel: 'geplant', titel: 'Geplante Einmalbuchungen' },
];

const klein = (text) => String(text ?? '').toLocaleLowerCase('de');

/** Suchbegriff in Wörter zerlegen; ein Treffer muss alle Wörter enthalten (Groß/klein egal) */
export const suchWoerter = (begriff) => klein(begriff).split(/\s+/).filter(Boolean);

const ZAHL = '\\d{1,3}(?:\\.\\d{3})+(?:,\\d{1,2})?|\\d+(?:,\\d{1,2})?';
/** "1.200,50" → 120050 Cent (Zahl nur so, wie sie in der Suche vorkommt) */
function centAus(text) {
  const [euro, cent = ''] = text.replace(/\./g, '').split(',');
  return Number(euro) * 100 + Number(cent.padEnd(2, '0'));
}

/**
 * D261: Suchbegriff zerlegen in Wörter und Betragsbedingungen.
 * „> 100“, „>=100“, „< 20“, „<= 49,99“ und „50-100“ (auch „50 - 100“) sind Bedingungen für den Betrag
 * (ohne Vorzeichen, in Euro); alles andere bleibt ein Suchwort. Ergebnis: { woerter, betrag: [{ von, bis }] } (Cent, je inklusive)
 */
export function zerlegeSuche(begriff) {
  const text = String(begriff ?? '')
    .replace(/([<>]=?)\s+(?=\d)/g, '$1') // „> 100“ → „>100“
    .replace(new RegExp(`(^|\\s)(${ZAHL})\\s+-\\s+(${ZAHL})(?=\\s|$)`, 'g'), '$1$2-$3'); // „50 - 100“ → „50-100“
  const woerter = [];
  const betrag = [];
  for (const teil of text.split(/\s+/).filter(Boolean)) {
    const vergleich = new RegExp(`^([<>]=?)(${ZAHL})€?$`).exec(teil);
    const bereich = new RegExp(`^(${ZAHL})-(${ZAHL})€?$`).exec(teil);
    if (vergleich) {
      const cent = centAus(vergleich[2]);
      const op = vergleich[1];
      betrag.push(op === '>' ? { von: cent + 1, bis: Infinity } : op === '>=' ? { von: cent, bis: Infinity }
        : op === '<' ? { von: 0, bis: cent - 1 } : { von: 0, bis: cent });
    } else if (bereich && centAus(bereich[1]) <= centAus(bereich[2])) {
      betrag.push({ von: centAus(bereich[1]), bis: centAus(bereich[2]) });
    } else {
      woerter.push(klein(teil));
    }
  }
  return { woerter, betrag };
}

/** Betrag in den Schreibweisen, nach denen man sucht: „1.200,00“, „1200,00“, „1200“ */
function betragTexte(cent) {
  if (cent == null) return [];
  const mitPunkt = formatEuro(Math.abs(cent)).replace(/\s*€/, '').trim();
  const ohnePunkt = mitPunkt.replace(/\./g, '');
  return [mitPunkt, ohnePunkt, ohnePunkt.replace(/,00$/, '')];
}

/**
 * Treffer suchen. daten: { buchungen, relevant, projekte, wiederkehrend, geplant, konten, kategorien }
 * Ergebnis: { buchung: [...], relevant: [...], projekt: [...], wiederkehrend: [...], geplant: [...] }
 * Treffer: { bereich, id, datum, titel, details, betragCent, art, ref }
 * Buchungen: neueste zuerst; Umbuchungen nur einmal (abgebende Seite); Papierkorb nie.
 */
export function suche(begriff, daten) {
  const { woerter, betrag } = zerlegeSuche(begriff); // D261: auch „> 100“, „< 20“, „50-100“
  const leer = Object.fromEntries(BEREICHE.map((b) => [b.schluessel, []]));
  if (woerter.length === 0 && betrag.length === 0) return leer;

  const konto = new Map((daten.konten ?? []).map((k) => [k.id, k.name]));
  const kat = new Map((daten.kategorien ?? []).map((k) => [k.id, k]));
  const projekt = new Map((daten.projekte ?? []).map((p) => [p.id, p.name]));
  const katText = (id) => {
    const unter = kat.get(id);
    return unter ? [kat.get(unter.elternId)?.name, unter.name].filter(Boolean).join(' › ') : '';
  };
  // cent: Betrag des Eintrags; mit Betragsbedingung fallen Einträge ohne Betrag (Projekte, Verträge) heraus
  const passt = (teile, cent = null) => {
    if (betrag.some(({ von, bis }) => cent == null || Math.abs(cent) < von || Math.abs(cent) > bis)) return false;
    const text = klein(teile.flat().filter((t) => t != null && t !== '').join(' \u0001 '));
    return woerter.every((w) => text.includes(w));
  };
  const belegNamen = (x) => (x.belege ?? []).map((b) => b.name);

  const ergebnis = leer;
  for (const b of daten.buchungen ?? []) {
    if (b.geloeschtAm || (b.art === 'umbuchung' && b.richtung === 'zu')) continue;
    const ziel = b.art === 'umbuchung' ? konto.get(b.gegenkontoId) : '';
    const teile = [b.partner, b.notiz, katText(b.kategorieId), konto.get(b.kontoId), ziel, projekt.get(b.projektId),
      b.relevantGruppe, belegNamen(b), formatDatum(b.datum), betragTexte(b.betragCent), b.art === 'umbuchung' ? 'Umbuchung' : ''];
    if (!passt(teile, b.betragCent)) continue;
    ergebnis.buchung.push({
      bereich: 'buchung', id: b.id, datum: b.datum, art: b.art, betragCent: b.betragCent, ref: b,
      titel: b.partner || (b.art === 'umbuchung' ? `Umbuchung → ${ziel ?? ''}` : katText(b.kategorieId).split(' › ').pop()) || 'Buchung',
      details: [formatDatum(b.datum), konto.get(b.kontoId), b.art !== 'umbuchung' && katText(b.kategorieId), b.notiz,
        b.status === 'vorgemerkt' && 'vorgemerkt'].filter(Boolean).join(' · '),
    });
  }
  for (const e of daten.relevant ?? []) {
    if (e.geloeschtAm) continue;
    if (!passt([e.partner, e.notiz, e.gruppe, katText(e.kategorieId), belegNamen(e), formatDatum(e.datum), betragTexte(e.betragCent)], e.betragCent)) continue;
    ergebnis.relevant.push({
      bereich: 'relevant', id: e.id, datum: e.datum, art: 'ausgabe', betragCent: e.betragCent, ref: e,
      titel: e.notiz || e.partner || 'Relevante Ausgabe',
      details: [formatDatum(e.datum), e.partner, e.gruppe && `Gruppe ${e.gruppe}`].filter(Boolean).join(' · '),
    });
  }
  for (const p of daten.projekte ?? []) {
    if (!passt([p.name, p.notiz])) continue;
    ergebnis.projekt.push({
      bereich: 'projekt', id: p.id, datum: null, art: null, betragCent: p.rahmenCent ?? null, ref: p,
      titel: p.name, details: [p.abgeschlossen ? 'abgeschlossen' : 'laufend', p.rahmenCent != null && 'Rahmen', p.notiz].filter(Boolean).join(' · '),
    });
  }
  for (const v of daten.vertraege ?? []) { // D148
    if (!passt([v.name, v.anbieter, v.vertragsnummer, v.notiz, belegNamen(v)])) continue;
    ergebnis.vertrag.push({
      bereich: 'vertrag', id: v.id, datum: null, art: null, betragCent: null, ref: v,
      titel: v.name, details: [v.anbieter, v.vertragsnummer && `Nr. ${v.vertragsnummer}`, v.gekuendigtZum && `gekündigt zum ${formatDatum(v.gekuendigtZum)}`].filter(Boolean).join(' · '),
    });
  }
  for (const w of daten.wiederkehrend ?? []) {
    const aktuell = [...(w.stufen ?? [])].sort((a, b) => a.ab.localeCompare(b.ab)).pop()?.betragCent ?? null;
    if (!passt([w.partner, w.notiz, katText(w.kategorieId), konto.get(w.kontoId), konto.get(w.gegenkontoId), betragTexte(aktuell)], aktuell)) continue;
    ergebnis.wiederkehrend.push({
      bereich: 'wiederkehrend', id: w.id, datum: w.start, art: w.art, betragCent: aktuell, ref: w,
      titel: w.partner || w.notiz || katText(w.kategorieId).split(' › ').pop() || 'Wiederkehrend',
      details: [{ woechentlich: 'wöchentlich', zweiwoechentlich: 'zweiwöchentlich', monatlich: 'monatlich', vierteljaehrlich: 'vierteljährlich', halbjaehrlich: 'halbjährlich', jaehrlich: 'jährlich' }[w.intervall],
        konto.get(w.kontoId), katText(w.kategorieId), w.aktiv === false && 'ausgeschaltet'].filter(Boolean).join(' · '),
    });
  }
  for (const g of daten.geplant ?? []) {
    if (!passt([g.bezeichnung, g.partner, g.notiz, katText(g.kategorieId), konto.get(g.kontoId), projekt.get(g.projektId),
      formatDatum(g.datum), betragTexte(g.betragCent)], g.betragCent)) continue;
    ergebnis.geplant.push({
      bereich: 'geplant', id: g.id, datum: g.datum, art: g.art, betragCent: g.betragCent, ref: g,
      titel: g.bezeichnung || 'Geplant',
      details: [formatDatum(g.datum), konto.get(g.kontoId), katText(g.kategorieId)].filter(Boolean).join(' · '),
    });
  }
  const neuesteZuerst = (a, b) => (b.datum ?? '').localeCompare(a.datum ?? '');
  ergebnis.buchung.sort(neuesteZuerst);
  ergebnis.relevant.sort(neuesteZuerst);
  ergebnis.geplant.sort(neuesteZuerst);
  ergebnis.projekt.sort((a, b) => a.titel.localeCompare(b.titel, 'de'));
  ergebnis.vertrag.sort((a, b) => a.titel.localeCompare(b.titel, 'de'));
  return ergebnis;
}
