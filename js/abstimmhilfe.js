// D204: Hilfe bei der Kontoabstimmung – welche Posten könnten eine Differenz erklären?
// Reine Funktionen ohne Datenbank, mit `npm test` geprüft. Die App schlägt nur vor; geändert wird erst nach einem Klick.

import { wirkungCent, istAktiv } from './rechnen.js';
import { plusTage } from './prognose.js';

const TAGE_DANACH = 7; // so viele Tage nach dem Abstimm-Datum gelten Buchungen als „vielleicht schon bei der Bank“

/**
 * differenz = Bank − App (in Cent). Kandidaten:
 * - termin: offener fälliger Termin (wiederkehrend/geplant) bis zum Abstimm-Datum – bei der Bank schon da, in der App
 *   noch nicht gebucht (wirkung = Wirkung auf dieses Konto)
 * - spaeter: Buchung bis 7 Tage NACH dem Abstimm-Datum – bei der Bank vielleicht schon gebucht
 * - vorgemerkt: vorgemerkte Buchung bis zum Abstimm-Datum – in der App schon drin, bei der Bank vielleicht noch nicht
 *   (erklärt die Differenz mit umgekehrtem Vorzeichen)
 * Vorschläge: einzelne Kandidaten, deren Wirkung die Differenz genau erklärt, sonst Paare aus zwei Kandidaten.
 * termine: [{ t, wirkung }] (schon für dieses Konto ausgerechnet).
 * Ergebnis: [{ teile: [{ art, buchung? , termin?, wirkung }] }], höchstens 5.
 */
export function abstimmVorschlaege({ kontoId, buchungen, termine = [], datum, differenz }) {
  if (!differenz) return [];
  const kandidaten = [];
  for (const { t, wirkung } of termine) {
    if (wirkung && t.datum <= datum) kandidaten.push({ art: 'termin', termin: t, wirkung, erklaert: wirkung });
  }
  const bis = plusTage(datum, TAGE_DANACH);
  for (const b of buchungen) {
    if (!istAktiv(b) || b.kontoId !== kontoId) continue;
    const wirkung = wirkungCent(b);
    if (!wirkung) continue;
    if (b.datum > datum && b.datum <= bis) kandidaten.push({ art: 'spaeter', buchung: b, wirkung, erklaert: wirkung });
    else if (b.datum <= datum && b.status === 'vorgemerkt') kandidaten.push({ art: 'vorgemerkt', buchung: b, wirkung, erklaert: -wirkung });
  }
  const einzeln = kandidaten.filter((k) => k.erklaert === differenz).map((k) => ({ teile: [k] }));
  if (einzeln.length) return einzeln.slice(0, 5);
  const paare = [];
  const liste = kandidaten.slice(0, 60);
  for (let i = 0; i < liste.length && paare.length < 5; i++) {
    for (let j = i + 1; j < liste.length && paare.length < 5; j++) {
      if (liste[i].erklaert + liste[j].erklaert === differenz) paare.push({ teile: [liste[i], liste[j]] });
    }
  }
  return paare;
}
