// D206: Monatsabschluss-Checkliste. Vom 1. bis 10. eines Monats prüft die App den Vormonat:
// Konten abgestimmt, vorgemerkte gebucht, offene Termine erledigt, Belege bei relevanten Ausgaben.
// Reine Funktionen ohne Datenbank – mit `npm test` geprüft.

import { istAktiv } from './rechnen.js';
import { monatsende, plusMonate } from './prognose.js';

export const ABSCHLUSS_BIS_TAG = 10;

/** Monat, für den heute die Checkliste gilt ('JJJJ-MM'), oder null (nach dem 10. eines Monats) */
export function abschlussMonat(heute) {
  return Number(heute.slice(8, 10)) <= ABSCHLUSS_BIS_TAG ? plusMonate(heute.slice(0, 7), -1) : null;
}

/**
 * Prüfpunkte für einen Monat. daten: { konten, buchungen, abstimmungen, relevant }; termine: offene Termine
 * (wiederkehrend/geplant) – gezählt werden die bis zum Monatsende fälligen.
 * Ergebnis: [{ id, titel, ok, text }]
 */
export function abschlussPruefung(daten, termine, monat) {
  const erster = `${monat}-01`;
  const letzter = monatsende(erster);
  const imMonat = (d) => d >= erster && d <= letzter;

  const konten = (daten.konten ?? []).filter((k) => !k.archiviert && k.stichtag <= letzter);
  const nichtAbgestimmt = konten.filter((k) => {
    const a = (daten.abstimmungen ?? []).filter((x) => x.kontoId === k.id && x.datum >= erster)
      .sort((x, y) => y.datum.localeCompare(x.datum) || (y.erstelltAm ?? '').localeCompare(x.erstelltAm ?? ''))[0];
    return !a || a.bankstandCent !== a.berechnetCent;
  });

  const vorgemerkt = (daten.buchungen ?? []).filter((b) => istAktiv(b) && b.status === 'vorgemerkt' && b.datum <= letzter
    && !(b.art === 'umbuchung' && b.richtung === 'zu'));

  const offen = termine.filter((t) => t.datum <= letzter);

  const ohneBeleg = [
    ...(daten.buchungen ?? []).filter((b) => istAktiv(b) && b.relevant && b.art === 'ausgabe' && imMonat(b.datum) && !(b.belege?.length)),
    ...(daten.relevant ?? []).filter((r) => !r.geloeschtAm && imMonat(r.datum) && !(r.belege?.length)),
  ];

  const anzahl = (n, eins, mehr) => `${n} ${n === 1 ? eins : mehr}`;
  return [
    {
      id: 'abgestimmt', titel: 'Konten abgestimmt', ok: nichtAbgestimmt.length === 0,
      text: nichtAbgestimmt.length ? `Noch nicht ohne Differenz abgestimmt: ${nichtAbgestimmt.map((k) => k.name).join(', ')}` : '',
    },
    {
      id: 'vorgemerkt', titel: 'Vorgemerkte gebucht', ok: vorgemerkt.length === 0,
      text: vorgemerkt.length ? `${anzahl(vorgemerkt.length, 'Buchung ist', 'Buchungen sind')} noch vorgemerkt` : '',
    },
    {
      id: 'termine', titel: 'Offene Termine erledigt', ok: offen.length === 0,
      text: offen.length ? `${anzahl(offen.length, 'Termin ist', 'Termine sind')} fällig, aber nicht gebucht` : '',
    },
    {
      id: 'belege', titel: 'Belege vorhanden', ok: ohneBeleg.length === 0,
      text: ohneBeleg.length ? `${anzahl(ohneBeleg.length, 'relevante Ausgabe hat', 'relevante Ausgaben haben')} noch keinen Beleg` : '',
    },
  ];
}
