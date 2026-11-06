// Rechenlogik für Kontostände und Monatsansicht.
// Reine Funktionen ohne Datenbank – dadurch mit `npm test` prüfbar.
//
// Grundregeln (siehe DECISIONS.md D17–D19):
// - Der Anfangssaldo ist der Stand zu Beginn des Stichtags. Buchungen ab dem Stichtag
//   (einschließlich) verändern ihn. Buchungen vor dem Stichtag gibt es nicht.
// - Beträge sind immer positiv gespeichert, die Art bestimmt die Richtung.
// - Umbuchungen verändern Kontostände, zählen aber nie als Einnahme oder Ausgabe.
// - Gelöschte Buchungen (im Papierkorb) zählen nirgends mit.

import { isoMonatsanfang, naechsterMonat } from './format.js';

/** Wirkung einer Buchung auf ihr Konto in Cent (+ = mehr Geld, − = weniger) */
export function wirkungCent(b) {
  switch (b.art) {
    case 'einnahme': return b.betragCent;
    case 'ausgabe': return -b.betragCent;
    case 'umbuchung': return b.richtung === 'zu' ? b.betragCent : -b.betragCent;
    default: return 0;
  }
}

export const istAktiv = (b) => !b.geloeschtAm;

const summe = (liste) => liste.reduce((s, b) => s + wirkungCent(b), 0);

const nachDatum = (a, b) =>
  a.datum.localeCompare(b.datum) || (a.erstelltAm ?? '').localeCompare(b.erstelltAm ?? '');

/** Alle zählenden Buchungen eines Kontos (nicht gelöscht, ab Stichtag), sortiert */
export function buchungenVonKonto(konto, buchungen) {
  return buchungen
    .filter((b) => istAktiv(b) && b.kontoId === konto.id && b.datum >= konto.stichtag)
    .sort(nachDatum);
}

/** Kontostand am Ende des Tages `bisDatum` (einschließlich aller Buchungen dieses Tages) */
export function kontostand(konto, buchungen, bisDatum) {
  return konto.anfangssaldoCent + summe(buchungenVonKonto(konto, buchungen).filter((b) => b.datum <= bisDatum));
}

/** Summe der noch vorgemerkten Buchungen bis einschließlich `bisDatum` */
export function vorgemerktBis(konto, buchungen, bisDatum) {
  return summe(buchungenVonKonto(konto, buchungen).filter((b) => b.datum <= bisDatum && b.status === 'vorgemerkt'));
}

/**
 * Alles für die Monatsansicht eines Kontos.
 * monat: 1–12
 */
export function monatsuebersicht(konto, buchungen, jahr, monat) {
  const erster = isoMonatsanfang(jahr, monat);
  const [nj, nm] = naechsterMonat(jahr, monat);
  const folgeErster = isoMonatsanfang(nj, nm);

  const alle = buchungenVonKonto(konto, buchungen);
  const imMonat = alle.filter((b) => b.datum >= erster && b.datum < folgeErster);
  const anfang = konto.anfangssaldoCent + summe(alle.filter((b) => b.datum < erster));

  const einnahmen = imMonat.filter((b) => b.art === 'einnahme').reduce((s, b) => s + b.betragCent, 0);
  const ausgaben = imMonat.filter((b) => b.art === 'ausgabe').reduce((s, b) => s + b.betragCent, 0);
  const umbuchungen = summe(imMonat.filter((b) => b.art === 'umbuchung'));

  // Nach Tagen gruppieren, mit Kontostand am Ende jedes Tages
  const tage = [];
  let stand = anfang;
  for (const b of imMonat) {
    stand += wirkungCent(b);
    let tag = tage.at(-1);
    if (!tag || tag.datum !== b.datum) {
      tag = { datum: b.datum, buchungen: [], standAbend: 0 };
      tage.push(tag);
    }
    tag.buchungen.push(b);
    tag.standAbend = stand;
  }

  return {
    erster,
    vorStichtag: folgeErster <= konto.stichtag, // ganzer Monat liegt vor dem Stichtag
    stichtagImMonat: konto.stichtag >= erster && konto.stichtag < folgeErster,
    anfang,
    einnahmen,
    ausgaben,
    umbuchungen,
    ende: stand,
    anzahl: imMonat.length,
    tage,
  };
}
