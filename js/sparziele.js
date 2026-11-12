// D157: Sparziele – gemessen am Kontostand eines Kontos (z. B. „Tagesgeld 10.000 € bis 12/2027“).
// Fortschritt = Stand heute; wann das Ziel erreicht wird, kommt aus der Prognose (Zeitleiste).
// Reine Funktionen – mit `npm test` geprüft.
//
// Datensatz Sparziel (Datenversion 19), Sammlung "sparziele":
// { id, name, kontoId, zielCent, zielDatum "JJJJ-MM-TT"|null, notiz, abgeschlossen, erstelltAm, geaendertAm, testdaten? }

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function baueSparziel(eingabe, { sparziele = [], konten = [], alt = null, jetzt = new Date().toISOString() } = {}) {
  const name = String(eingabe.name ?? '').trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('Bitte einen Namen eingeben, z. B. „Notgroschen“ oder „Neues Auto“.');
  if (name.length > 60) throw new Error('Der Name ist zu lang (höchstens 60 Zeichen).');
  if (sparziele.some((z) => z.id !== alt?.id && z.name.toLocaleLowerCase('de') === name.toLocaleLowerCase('de'))) {
    throw new Error(`Ein Sparziel „${name}“ gibt es schon.`);
  }
  if (!konten.some((k) => k.id === eingabe.kontoId)) throw new Error('Bitte ein Konto wählen.');
  if (!Number.isInteger(eingabe.zielCent) || eingabe.zielCent <= 0) throw new Error('Bitte einen Zielbetrag größer 0 eingeben.');
  const zielDatum = eingabe.zielDatum || null;
  if (zielDatum && (!ISO.test(zielDatum) || Number.isNaN(Date.parse(zielDatum)))) throw new Error('Bitte ein gültiges Zieldatum wählen.');
  return {
    id: alt?.id ?? crypto.randomUUID(),
    name,
    kontoId: eingabe.kontoId,
    zielCent: eingabe.zielCent,
    zielDatum,
    notiz: String(eingabe.notiz ?? '').trim().slice(0, 200),
    abgeschlossen: Boolean(eingabe.abgeschlossen ?? alt?.abgeschlossen),
    erstelltAm: alt?.erstelltAm ?? jetzt,
    geaendertAm: jetzt,
    ...(alt?.testdaten ? { testdaten: true } : {}),
  };
}

/** Ganze Monate zwischen zwei 'JJJJ-MM' (gleicher Monat = 0) */
export const monateZwischen = (von, bis) => (Number(bis.slice(0, 4)) - Number(von.slice(0, 4))) * 12 + Number(bis.slice(5, 7)) - Number(von.slice(5, 7));

/**
 * Stand eines Sparziels.
 * standHeute: Kontostand heute; prognoseMonatsende: Prognose zum Ende des laufenden Monats;
 * zeilen: Zeitleiste dieses Kontos ab dem nächsten Monat ([{ monat 'JJJJ-MM', stand }]).
 * Ergebnis: { standCent, anteil, erreicht, erreichtMonat ('JJJJ-MM' | null = bis Ende der Zeitleiste nicht),
 *   rechtzeitig (true/false/null ohne Zieldatum), standZumZiel, fehlbetragCent, noetigProMonatCent }
 */
export function sparzielStand(ziel, { standHeute, prognoseMonatsende, zeilen = [], heute }) {
  const aktuell = heute.slice(0, 7);
  const anteil = Math.max(0, Math.min(1, standHeute / ziel.zielCent));
  const erreicht = standHeute >= ziel.zielCent;
  let erreichtMonat = null;
  if (erreicht || prognoseMonatsende >= ziel.zielCent) erreichtMonat = aktuell;
  else erreichtMonat = zeilen.find((z) => z.stand >= ziel.zielCent)?.monat ?? null;

  let rechtzeitig = null;
  let standZumZiel = null;
  let fehlbetragCent = 0;
  let noetigProMonatCent = 0;
  if (ziel.zielDatum) {
    const zielMonat = ziel.zielDatum.slice(0, 7);
    rechtzeitig = erreichtMonat != null && erreichtMonat <= zielMonat;
    standZumZiel = zielMonat <= aktuell ? prognoseMonatsende : (zeilen.find((z) => z.monat === zielMonat)?.stand ?? null);
    if (!rechtzeitig && standZumZiel != null) {
      fehlbetragCent = Math.max(0, ziel.zielCent - standZumZiel);
      // so viel müsste ab jetzt zusätzlich je Monat zurückgelegt werden (bis einschließlich Zielmonat)
      const monate = Math.max(1, monateZwischen(aktuell, zielMonat) + (zielMonat > aktuell ? 0 : 1));
      noetigProMonatCent = Math.ceil(fehlbetragCent / monate / 100) * 100; // auf volle Euro aufgerundet
    }
  }
  return { standCent: standHeute, anteil, erreicht, erreichtMonat, rechtzeitig, standZumZiel, fehlbetragCent, noetigProMonatCent };
}
