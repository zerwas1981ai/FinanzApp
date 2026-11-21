// D206: Monatsabschluss-Checkliste. Vom 1. bis 10. eines Monats prüft die App den Vormonat:
// Konten abgestimmt, vorgemerkte gebucht, offene Termine erledigt, Belege bei relevanten Ausgaben.
// D238: dazu Zählerstände Strom/Gas; deshalb erscheint die Liste schon am Monatsletzten (Ablesetag).
// Reine Funktionen ohne Datenbank – mit `npm test` geprüft.

import { istAktiv } from './rechnen.js';
import { monatsende, plusMonate } from './prognose.js';
import { offeneAblesungen } from './energie.js';

export const ABSCHLUSS_BIS_TAG = 10;

/**
 * Monat, für den heute die Checkliste gilt ('JJJJ-MM'), oder null.
 * Am Monatsletzten der laufende Monat (D238: Zähler ablesen), vom 1. bis 10. der Vormonat.
 */
export function abschlussMonat(heute) {
  if (heute === monatsende(heute)) return heute.slice(0, 7);
  return Number(heute.slice(8, 10)) <= ABSCHLUSS_BIS_TAG ? plusMonate(heute.slice(0, 7), -1) : null;
}

/**
 * Prüfpunkte für einen Monat. daten: { konten, buchungen, abstimmungen, relevant, zaehler }; termine: offene Termine
 * (wiederkehrend/geplant) – gezählt werden die bis zum Monatsende fälligen.
 * Ergebnis: [{ id, titel, ok, text }]; der Punkt „zaehler“ (D238) nur mit eingeschalteten Zählern, dazu `offen`.
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
  const mitZaehlern = (daten.zaehler ?? []).some((z) => z.aktiv !== false);
  const ohneStand = mitZaehlern ? offeneAblesungen(daten.zaehler, monat) : [];
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
    mitZaehlern && {
      id: 'zaehler', titel: 'Zählerstände eingetragen', ok: ohneStand.length === 0, offen: ohneStand,
      text: ohneStand.length ? `Zum Monatsende noch ablesen: ${ohneStand.map((z) => z.name).join(', ')}` : '',
    },
  ].filter(Boolean);
}
