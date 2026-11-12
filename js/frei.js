// D163: „Frei verfügbar“ und „Kann ich mir das leisten?“ – reine Funktionen, mit `npm test` geprüft.
//
// Frei verfügbar je Konto = Prognose Monatsende − Mindestsaldo (ohne Mindestsaldo: − 0).
// Die Prognose enthält schon alles Erwartete: offene wiederkehrende Termine, geplante Buchungen und
// offene Budgetreste (gelten als verplant). Pro Tag = frei ÷ verbleibende Tage einschließlich heute.
// Gesamt: nur Konten mit „Zählt zu Frei verfügbar“ (Feld freiVerfuegbar !== false, z. B. Tagesgeld aus).

const tagImMonat = (iso) => Number(iso.slice(8, 10));
const tageImMonat = (iso) => new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0)).getUTCDate();

/** Verbleibende Tage im Monat einschließlich heute */
export const resttage = (heute) => tageImMonat(heute) - tagImMonat(heute) + 1;

const proTag = (frei, heute) => (frei > 0 ? Math.floor(frei / resttage(heute)) : 0);

/**
 * jeKonto: Map aus der Monatsprognose (konto, prognose, …).
 * Ergebnis: { jeKonto: Map(id → { frei, proTag }), gesamt: { frei, proTag, anzahl } }
 */
export function freiVerfuegbar(jeKonto, heute) {
  const ergebnis = new Map();
  let gesamt = 0;
  let anzahl = 0;
  for (const [id, kd] of jeKonto) {
    const frei = kd.prognose - (kd.konto.mindestsaldoCent ?? 0);
    ergebnis.set(id, { frei, proTag: proTag(frei, heute) });
    if (kd.konto.freiVerfuegbar !== false && !kd.konto.archiviert) { gesamt += frei; anzahl++; }
  }
  return { jeKonto: ergebnis, gesamt: { frei: gesamt, proTag: proTag(gesamt, heute), anzahl } };
}

/**
 * „Kann ich mir das leisten?“ – rechnet eine Ausgabe probeweise ein, ohne etwas zu speichern.
 * kd: Monatsprognose des Kontos; zeilen: Zeitleiste dieses Kontos ab dem nächsten Monat ([{ monat, stand }]).
 * Geprüft werden der Monat der Ausgabe und die 12 Monate danach gegen den Mindestsaldo (ohne: 0 €).
 * Ergebnis: { urteil: 'ja' | 'knapp' | 'nein', freiVorher, freiNachher (nur laufender Monat),
 *   ersterUnter: { monat, stand } | null, schonVorherUnter: { monat, stand } | null, grenze }
 */
export function leistbarkeit({ kd, zeilen = [], heute, betragCent, datum }) {
  const grenze = kd.konto.mindestsaldoCent ?? 0;
  const aktuell = heute.slice(0, 7);
  const tag = !datum || datum < heute ? heute : datum;
  const monat = tag.slice(0, 7);
  const bis = (() => { // 12 Monate nach dem Kaufmonat
    const j = Number(monat.slice(0, 4)); const m = Number(monat.slice(5, 7)) + 12;
    return `${j + Math.floor((m - 1) / 12)}-${String(((m - 1) % 12) + 1).padStart(2, '0')}`;
  })();
  // Verlauf: laufender Monat (niedrigster erwarteter Stand) und die Zeitleiste
  const verlauf = [{ monat: aktuell, stand: Math.min(kd.niedrigster ?? kd.prognose, kd.prognose) }, ...zeilen]
    .filter((z) => z.monat >= monat && z.monat <= bis);
  // Bewertet werden nur Monate, die ohne die Ausgabe über der Grenze lägen – Monate, die ohnehin darunter
  // fallen, kommen als Hinweis (schonVorherUnter), sonst wäre bei einem knappen Konto jede Ausgabe „nein“.
  const schonVorherUnter = verlauf.find((z) => z.stand < grenze) ?? null;
  const nachher = verlauf.filter((z) => z.stand >= grenze).map((z) => ({ monat: z.monat, stand: z.stand - betragCent }));
  const ersterUnter = nachher.find((z) => z.stand < grenze) ?? null;
  const freiVorher = kd.prognose - grenze;
  const freiNachher = monat === aktuell ? freiVorher - betragCent : null;
  // knapp: bleibt über der Grenze, aber mit weniger als 10 % des Betrags (mind. 50 €) Luft
  const luft = nachher.length ? Math.min(...nachher.map((z) => z.stand - grenze)) : 0;
  const urteil = ersterUnter ? 'nein' : luft < Math.max(5000, Math.round(betragCent * 0.1)) ? 'knapp' : 'ja';
  return { urteil, freiVorher, freiNachher, ersterUnter, schonVorherUnter, grenze, luft, bis };
}
