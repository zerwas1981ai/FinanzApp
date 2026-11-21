// D239: Jahreswechsel-Check. Vom 15.12. bis 31.01. steht oben in der Übersicht eine Liste wie beim
// Monatsabschluss (D206): Budgets fürs neue Jahr, Kündigungsfristen im 1. Quartal, Preisänderungen ab Januar,
// Archiv des Vorjahres (ersetzt die Archiv-Erinnerung aus D185) und eine Jahres-Sicherungsdatei.
// Was die App selbst prüfen kann, hakt sie ab; den Rest hakt der Nutzer von Hand ab.
// Reine Funktionen ohne Datenbank – mit `npm test` geprüft.

import { vertragsStand } from './vertraege.js';
import { naechstesArchivJahr } from './archiv.js';

/** Punkte, die nur von Hand abgehakt werden (gespeichert in einstellungen 'jahreswechsel') */
export const HAND_PUNKTE = ['preise', 'sicherung'];

/** Für welches neue Jahr gilt heute der Check? 15.12.–31.12. → nächstes Jahr, 01.01.–31.01. → dieses Jahr, sonst null */
export function jahreswechselJahr(heute) {
  const jahr = Number(heute.slice(0, 4));
  const mmtt = heute.slice(5);
  if (mmtt >= '12-15') return jahr + 1;
  if (mmtt <= '01-31') return jahr;
  return null;
}

/** Gilt ein Budget im Monat 'JJJJ-MM'? (Monatsbudget: Start-/Endmonat, Jahresbudget: Start-/Endjahr) */
function deckt(b, monat) {
  if (b.aktiv === false) return false;
  if (b.typ === 'jaehrlich') {
    const j = Number(monat.slice(0, 4));
    return b.startJahr <= j && (b.endJahr == null || b.endJahr >= j);
  }
  return (!b.startMonat || b.startMonat <= monat) && (!b.endMonat || b.endMonat >= monat);
}

/**
 * Prüfpunkte für den Wechsel ins Jahr `neuesJahr`.
 * daten: { budgets, kategorien, konten, vertraege, buchungen }; haken: von Hand abgehakte Punkt-IDs.
 * Ergebnis: [{ id, titel, ok, text, hand? }]
 */
export function jahreswechselPruefung(daten, neuesJahr, heute, haken = []) {
  const altesJahr = neuesJahr - 1;
  const dezember = `${altesJahr}-12`;
  const januar = `${neuesJahr}-01`;
  const name = (liste, id) => (liste ?? []).find((x) => x.id === id)?.name ?? '?';

  // Budgets, die im Dezember gelten, im Januar aber nicht mehr – ohne Nachfolger für Kategorie und Konto
  const budgets = daten.budgets ?? [];
  const endend = budgets.filter((b) => deckt(b, dezember) && !deckt(b, januar)
    && !budgets.some((n) => n.id !== b.id && n.kategorieId === b.kategorieId && n.kontoId === b.kontoId && deckt(n, januar)));

  // Laufende Verträge, deren Kündigungsfrist bis Ende März des neuen Jahres abläuft
  const bisMaerz = `${neuesJahr}-03-31`;
  const fristen = (daten.vertraege ?? [])
    .map((v) => ({ v, s: vertragsStand(v, heute) }))
    .filter(({ s }) => s.status === 'laufend' && s.kuendigenBis && s.kuendigenBis >= heute && s.kuendigenBis <= bisMaerz)
    .sort((a, b) => a.s.kuendigenBis.localeCompare(b.s.kuendigenBis));
  const datum = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;

  // Archiv: ein abgeschlossenes Jahr mit Buchungen, das archiviert werden kann (wie D185)
  const archiv = naechstesArchivJahr({ buchungen: daten.buchungen ?? [] }, heute);
  const archivOffen = archiv && archiv.anzahl > 0 ? archiv : null;

  return [
    {
      id: 'budgets', titel: `Budgets für ${neuesJahr}`, ok: endend.length === 0,
      text: endend.length ? `Endet mit ${altesJahr}: ${endend.map((b) => `${name(daten.kategorien, b.kategorieId)} (${name(daten.konten, b.kontoId)})`).join(', ')}` : '',
    },
    {
      id: 'vertraege', titel: 'Kündigungsfristen bis Ende März', ok: fristen.length === 0,
      text: fristen.length ? fristen.map(({ v, s }) => `${v.name} bis ${datum(s.kuendigenBis)}`).join(', ') : '',
    },
    {
      id: 'preise', titel: `Preisänderungen ab Januar ${neuesJahr} eingetragen`, ok: haken.includes('preise'), hand: true,
      text: 'z. B. neue Beiträge, Abos oder Abschläge bei den wiederkehrenden Buchungen',
    },
    {
      id: 'archiv', titel: 'Abgeschlossenes Jahr archiviert', ok: !archivOffen,
      text: archivOffen ? `${archivOffen.jahr} kann archiviert werden${archivOffen.hindernis ? ` – ${archivOffen.hindernis}` : ''}` : '',
    },
    {
      id: 'sicherung', titel: 'Jahres-Sicherungsdatei heruntergeladen', ok: haken.includes('sicherung'), hand: true,
      text: '„Kompletter Datenstand (JSON)“ unter Daten & Sicherheit',
    },
  ];
}

/** Gespeicherter Stand (einstellungen 'jahreswechsel'): { erledigt: [Jahre], haken: { Jahr: [Punkt-IDs] } } */
export function jahreswechselStand(einstellungen, neuesJahr) {
  const e = (einstellungen ?? []).find((x) => x.id === 'jahreswechsel') ?? {};
  return { erledigt: (e.erledigt ?? []).includes(neuesJahr), haken: e.haken?.[neuesJahr] ?? [] };
}

/** Hand-Haken umschalten; gibt den neuen Datensatz zurück (ältere Jahre werden aufgeräumt) */
export function hakenUmschalten(alt, neuesJahr, punkt, jetzt = new Date().toISOString()) {
  if (!HAND_PUNKTE.includes(punkt)) throw new Error('Dieser Punkt wird automatisch geprüft.');
  const basis = alt ?? { id: 'jahreswechsel', erledigt: [], haken: {} };
  const bisher = basis.haken?.[neuesJahr] ?? [];
  const neu = bisher.includes(punkt) ? bisher.filter((p) => p !== punkt) : [...bisher, punkt];
  return { ...basis, haken: { [neuesJahr]: neu }, geaendertAm: jetzt };
}

/** Ganzen Check als erledigt markieren */
export function alsErledigt(alt, neuesJahr, jetzt = new Date().toISOString()) {
  const basis = alt ?? { id: 'jahreswechsel', erledigt: [], haken: {} };
  return { ...basis, erledigt: [...new Set([...(basis.erledigt ?? []), neuesJahr])].sort().slice(-5), geaendertAm: jetzt };
}
