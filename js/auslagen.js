// D214: Auslagen – Geld, das ich für jemand anderen ausgelegt habe und zurückbekomme.
// Reine Funktionen ohne Datenbank – mit `npm test` geprüft.
//
// - Auslage = Ausgabe mit Feld `auslage: { fuer, erledigtAm, restCent }` (fuer = von wem ich es zurückbekomme).
// - Rückzahlung = Einnahme mit `auslageId` (ID der Auslage). Mehrere Teil-Rückzahlungen sind möglich.
// - Offene Auslagen und Rückzahlungen zählen nicht als Ausgabe/Einnahme und verbrauchen kein Budget
//   (zaehltCent in rechnen.js). Der Kontostand stimmt immer, denn dort zählt der volle Betrag.
// - Kommt weniger zurück, kann der Rest per Klick als normale Ausgabe zählen („abschließen“).

import { partnerSchluessel } from './auswertung.js';

const aktiv = (b) => !b.geloeschtAm;

/**
 * Alle Auslagen mit Stand. Ergebnis: [{ buchung, zurueckCent, offenCent, rueckzahlungen, status }],
 * status: 'offen' | 'zurueck' (alles da) | 'abgeschlossen' (Rest zählt als Ausgabe). Offene zuerst (älteste oben),
 * danach die übrigen (neueste oben).
 */
export function auslagenUebersicht(buchungen) {
  const rueck = new Map();
  for (const b of buchungen) {
    if (!aktiv(b) || b.art !== 'einnahme' || !b.auslageId) continue;
    if (!rueck.has(b.auslageId)) rueck.set(b.auslageId, []);
    rueck.get(b.auslageId).push(b);
  }
  const liste = buchungen.filter((b) => aktiv(b) && b.art === 'ausgabe' && b.auslage).map((b) => {
    const rueckzahlungen = (rueck.get(b.id) ?? []).sort((x, y) => x.datum.localeCompare(y.datum));
    const zurueckCent = rueckzahlungen.reduce((s, r) => s + r.betragCent, 0);
    const status = b.auslage.erledigtAm ? 'abgeschlossen' : zurueckCent >= b.betragCent ? 'zurueck' : 'offen';
    return { buchung: b, zurueckCent, offenCent: status === 'offen' ? b.betragCent - zurueckCent : 0, rueckzahlungen, status };
  });
  const offen = liste.filter((a) => a.status === 'offen').sort((a, b) => a.buchung.datum.localeCompare(b.buchung.datum));
  const rest = liste.filter((a) => a.status !== 'offen').sort((a, b) => b.buchung.datum.localeCompare(a.buchung.datum));
  return [...offen, ...rest];
}

/** Anzeigename einer Auslage: „für wen“ bzw. Empfänger bzw. Notiz */
export function auslageTitel(b) {
  return b.auslage?.fuer || b.partner?.trim() || b.notiz || 'Auslage';
}

/**
 * Vorschläge für eine neue Einnahme: offene Auslagen, zu denen sie passt. Passend heißt: der Absender
 * entspricht „für wen“ oder dem Empfänger der Auslage, oder der Betrag entspricht genau dem offenen Rest.
 * Beste zuerst (Name und Betrag > nur Betrag > nur Name). Die App schlägt nur vor; verknüpft wird per Klick.
 */
export function passendeAuslagen(einnahme, uebersicht) {
  const k = partnerSchluessel(einnahme.partner);
  const treffer = [];
  for (const a of uebersicht) {
    if (a.status !== 'offen') continue;
    const name = Boolean(k) && [a.buchung.auslage.fuer, a.buchung.partner].some((n) => partnerSchluessel(n) === k);
    const betrag = einnahme.betragCent != null && einnahme.betragCent === a.offenCent;
    if (name || betrag) treffer.push({ auslage: a, punkte: (name ? 1 : 0) + (betrag ? 2 : 0) });
  }
  return treffer.sort((x, y) => y.punkte - x.punkte || x.auslage.buchung.datum.localeCompare(y.auslage.buchung.datum)).map((t) => t.auslage);
}

/** Auslage abschließen: der nicht zurückgezahlte Rest zählt ab jetzt als normale Ausgabe */
export function auslageAbschliessen(a, jetzt = new Date().toISOString()) {
  const b = a.buchung;
  return { ...b, auslage: { ...b.auslage, erledigtAm: jetzt, restCent: Math.max(0, b.betragCent - a.zurueckCent) }, geaendertAm: jetzt };
}

/** Abschluss rückgängig machen – die Auslage ist wieder offen */
export function auslageWiederOeffnen(b, jetzt = new Date().toISOString()) {
  return { ...b, auslage: { ...b.auslage, erledigtAm: null, restCent: null }, geaendertAm: jetzt };
}
