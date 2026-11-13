// D179: Belege-Übersicht – alle Belege aus Buchungen, relevanten Ausgaben und Verträgen an einem Ort.
// Reine Funktionen, mit `npm test` geprüft.

/**
 * Alle Belege als flache Liste, neueste zuerst.
 * Eintrag: { beleg, name, datum, quelle: 'buchung' | 'relevant' | 'vertrag', titel, betragCent, ref }
 * Papierkorb zählt nicht; Umbuchungen haben keine Belege.
 */
export function belegListe({ buchungen = [], relevant = [], vertraege = [], kategorien = [] }) {
  const kat = new Map(kategorien.map((k) => [k.id, k]));
  const liste = [];
  for (const b of buchungen) {
    if (b.geloeschtAm) continue;
    for (const beleg of b.belege ?? []) {
      liste.push({
        beleg, name: beleg.name ?? 'Beleg', datum: b.datum, quelle: 'buchung', betragCent: b.art === 'einnahme' ? b.betragCent : -b.betragCent, ref: b,
        titel: [b.partner, kat.get(b.kategorieId)?.name, b.notiz].filter(Boolean).join(' · ') || 'Buchung',
      });
    }
  }
  for (const e of relevant) {
    if (e.geloeschtAm) continue;
    for (const beleg of e.belege ?? []) {
      liste.push({
        beleg, name: beleg.name ?? 'Beleg', datum: e.datum, quelle: 'relevant', betragCent: -e.betragCent, ref: e,
        titel: [e.notiz, e.partner].filter(Boolean).join(' · ') || 'Relevante Ausgabe',
      });
    }
  }
  for (const v of vertraege) {
    for (const beleg of v.belege ?? []) {
      liste.push({
        beleg, name: beleg.name ?? 'Unterlage', datum: (beleg.hinzugefuegtAm ?? v.erstelltAm ?? '').slice(0, 10), quelle: 'vertrag', betragCent: null, ref: v,
        titel: [`Vertrag ${v.name}`, v.anbieter].filter(Boolean).join(' · '),
      });
    }
  }
  return liste.sort((a, b) => (b.datum ?? '').localeCompare(a.datum ?? '') || a.name.localeCompare(b.name, 'de'));
}

/** Suche: alle Wörter müssen in Name, Titel oder Datum (TT.MM.JJJJ) vorkommen */
export function filtereBelege(liste, begriff) {
  const woerter = String(begriff ?? '').toLocaleLowerCase('de').split(/\s+/).filter(Boolean);
  if (!woerter.length) return liste;
  return liste.filter((x) => {
    const d = x.datum ? `${x.datum.slice(8, 10)}.${x.datum.slice(5, 7)}.${x.datum.slice(0, 4)} ${x.datum}` : '';
    const text = `${x.name} ${x.titel} ${d}`.toLocaleLowerCase('de');
    return woerter.every((w) => text.includes(w));
  });
}
