// Jahresbudgets (Entscheidung D90): ein Budget je Hauptkategorie und Konto für ein ganzes Jahr,
// das in Tranchen wirkt – zu einem Monatsende, hälftig zum 30.06./31.12. oder je Quartalsende.
//
// Regeln (Wunsch des Nutzers):
// - Eine Tranche wird von den Ausgaben seit der vorigen Tranche verbraucht (die erste seit 1.1.).
// - Ist ihr Monat vorbei, wandert der Rest in das Restbudget zum 31.12. Eine Überziehung verringert
//   dieses Restbudget (das Jahr zählt als Ganzes).
// - Liegt die Tranche noch vor uns, wirkt ihr Rest in ihrem Monat wie eine erwartete Ausgabe.
// - Was am 31.12. übrig ist, verfällt; es gibt keinen Übertrag ins neue Jahr.
// Reine Funktionen ohne Datenbank – mit `npm test` geprüft.

export const VERTEILUNGEN = Object.freeze({
  zeitpunkt: 'Zu einem Zeitpunkt',
  halbjahr: 'Hälftig zum 30.06. und 31.12.',
  quartal: 'Zum Ende jedes Quartals',
});

export const istJaehrlich = (b) => b?.typ === 'jaehrlich';

/** Gilt das Jahresbudget im Jahr `jahr` (Zahl)? */
export const giltImJahr = (b, jahr) => b.startJahr <= jahr && (b.endJahr == null || jahr <= b.endJahr);

/** Tranchen eines Jahresbudgets: [{ monat: 1..12, betragCent }], nach Monat sortiert */
export function tranchen(b) {
  if (b.verteilung === 'zeitpunkt') return [{ monat: b.zeitpunktMonat, betragCent: b.betragCent }];
  if (b.verteilung === 'halbjahr') {
    const erste = Math.floor(b.betragCent / 2);
    return [{ monat: 6, betragCent: erste }, { monat: 12, betragCent: b.betragCent - erste }];
  }
  if (b.verteilung === 'quartal') {
    return (b.quartaleCent ?? []).map((c, i) => ({ monat: (i + 1) * 3, betragCent: c })).filter((t) => t.betragCent > 0);
  }
  return [];
}

/** Geplanter Tranchenbetrag eines Jahresbudgets in einem Monat ("JJJJ-MM"), ohne Übertrag */
export function trancheImMonat(b, monat) {
  if (!giltImJahr(b, Number(monat.slice(0, 4)))) return 0;
  const m = Number(monat.slice(5, 7));
  return tranchen(b).filter((t) => t.monat === m).reduce((s, t) => s + t.betragCent, 0);
}

/**
 * Wirkung eines Jahresbudgets in einem Jahr.
 * ausgabe(monat 1..12): erwartete Ausgaben dieser Kategorie auf diesem Konto im Monat
 *   (vergangene Monate: echte Buchungen; laufender: echte + offene; künftige: geplante/wiederkehrende).
 * ersterOffenerMonat: Monate davor sind vorbei (laufendes Jahr: aktueller Monat; künftige Jahre: 1).
 * Ergebnis: Posten, die ab dem ersten offenen Monat wirken:
 *   [{ monat, art: 'tranche' | 'rest', betragCent, verbrauchtCent, restCent, uebertragCent }]
 *   restCent > 0 ist der Betrag, der in diesem Monat zusätzlich als Ausgabe erwartet wird.
 */
export function jahresbudgetJahr(b, jahr, ausgabe, ersterOffenerMonat) {
  if (!giltImJahr(b, jahr) || ersterOffenerMonat > 12) return [];
  const summe = (von, bis) => {
    let s = 0;
    for (let m = von; m <= bis; m++) s += ausgabe(m);
    return s;
  };
  const alle = tranchen(b);
  const ergebnis = [];
  let uebertrag = 0;
  let vorher = 0;
  for (const t of alle.filter((x) => x.monat < 12)) {
    const verbraucht = summe(vorher + 1, t.monat);
    vorher = t.monat;
    const rest = t.betragCent - verbraucht;
    if (t.monat >= ersterOffenerMonat && rest > 0) {
      ergebnis.push({ monat: t.monat, art: 'tranche', betragCent: t.betragCent, verbrauchtCent: verbraucht, restCent: rest, uebertragCent: 0 });
    } else {
      uebertrag += rest; // vorbei (Rest oder Überziehung) bzw. schon überzogen → zum 31.12.
    }
  }
  const dezember = alle.filter((x) => x.monat === 12).reduce((s, x) => s + x.betragCent, 0);
  const topf = dezember + uebertrag;
  const verbraucht = summe(vorher + 1, 12);
  const rest = topf - verbraucht;
  if (rest > 0) {
    ergebnis.push({
      monat: 12, art: uebertrag !== 0 || dezember === 0 ? 'rest' : 'tranche',
      betragCent: topf, verbrauchtCent: verbraucht, restCent: rest, uebertragCent: uebertrag,
    });
  }
  return ergebnis;
}

/** Zeitraum eines Budgets als ["JJJJ-MM", "JJJJ-MM"] – für die Prüfung „entweder Monats- oder Jahresbudget“ */
export function budgetZeitraum(b) {
  if (b.typ === 'einmalig') return [b.monat, b.monat];
  if (istJaehrlich(b)) return [`${b.startJahr}-01`, b.endJahr ? `${b.endJahr}-12` : '9999-12'];
  return [b.startMonat, b.endMonat || '9999-12'];
}

export const ueberschneiden = ([a1, a2], [b1, b2]) => a1 <= b2 && b1 <= a2;
