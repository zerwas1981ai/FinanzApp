// Buchungen anlegen, ändern, in den Papierkorb legen, wiederherstellen.
//
// Datensatz Buchung (Datenversion 2):
// {
//   id, datum "JJJJ-MM-TT", betragCent (immer > 0),
//   art: 'einnahme' | 'ausgabe' | 'umbuchung',
//   kontoId,
//   kategorieId,            // Unterkategorie; bei Umbuchung null
//   notiz, status: 'gebucht' | 'vorgemerkt',
//   belege: [{ id, name, mime, groesse, driveId, hinzugefuegtAm }],  // Etappe 6, Dateien in Google Drive
//   umbuchungId,            // nur Umbuchung: gemeinsame ID beider Hälften
//   richtung,               // nur Umbuchung: 'ab' (Abgang) | 'zu' (Zugang)
//   gegenkontoId,           // nur Umbuchung: das andere Konto
//   geloeschtAm,            // null = aktiv, sonst Zeitpunkt (= im Papierkorb)
//   wiederkehrendId,        // ab Version 3: aus welcher wiederkehrenden Buchung (oder null)
//   faelligAm,              // ab Version 3: welcher Termin damit erledigt ist ("JJJJ-MM-TT")
//   geplantId,              // ab Version 4: welche geplante Einmalbuchung damit erledigt ist (oder null)
//   projektId,              // ab Version 5: zugeordnetes Projekt (oder null)
//   partner,                // ab Version 8: Empfänger (Ausgabe) bzw. Absender (Einnahme), '' = keine Angabe
//   relevant, relevantGruppe,  // ab Version 10: Häkchen "Relevante Ausgabe" (nur Ausgaben) und Gruppe (D74)
//   vertragId,              // ab Version 18: zugeordneter Vertrag (oder null, D148)
//   auslage,                // ab Version 24 (D214), nur Ausgaben: null oder { fuer, erledigtAm, restCent } – bekomme ich zurück
//   auslageId,              // ab Version 24 (D214), nur Einnahmen: Rückzahlung für diese Auslage (Buchungs-ID) oder null
//   aufrundungFuer,         // ab Version 24 (D215), nur Umbuchungen: Aufrundung zu dieser Ausgabe (Buchungs-ID) oder null
//   ausgleichFuer,          // ab Version 24 (D216), nur Umbuchungen: Ausgleich (z. B. Girokonto → PayPal) zu dieser Ausgabe oder null
//   erstelltAm, geaendertAm, testdaten?
// }

import * as db from './db.js';
import { formatDatum, istGueltigesDatum } from './format.js';
import { normGruppe } from './relevant.js';

/**
 * D214: Auslage vereinheitlichen. wert: null/false = keine Auslage, true oder { fuer } = Auslage.
 * Ein schon gesetzter Abschluss (erledigtAm, restCent) bleibt beim Bearbeiten erhalten.
 */
function normAuslage(wert, alt) {
  if (!wert) return null;
  const fuer = String((typeof wert === 'object' ? wert.fuer : alt?.fuer) ?? '').trim().slice(0, 80);
  return {
    fuer,
    erledigtAm: (typeof wert === 'object' && 'erledigtAm' in wert ? wert.erledigtAm : alt?.erledigtAm) ?? null,
    restCent: (typeof wert === 'object' && 'restCent' in wert ? wert.restCent : alt?.restCent) ?? null,
  };
}

/**
 * Baut aus den Formularwerten die zu speichernden Datensätze und prüft sie.
 * Normale Buchung → 1 Datensatz, Umbuchung → 2 Datensätze.
 * eingabe: { art, betragCent, datum, kontoId, gegenkontoId, kategorieId, notiz, status }
 * bestehende: beim Bearbeiten die bisherigen Datensätze (1 oder 2)
 */
export function baueBuchungen(eingabe, { konten, bestehende = [], jetzt = new Date().toISOString() }) {
  const { art, betragCent, datum } = eingabe;
  if (!['einnahme', 'ausgabe', 'umbuchung'].includes(art)) throw new Error('Bitte die Art wählen.');
  if (betragCent == null || betragCent === 0) throw new Error('Bitte einen Betrag eingeben.');
  if (betragCent < 0) throw new Error('Bitte den Betrag ohne Minus eingeben – die Richtung ergibt sich aus der Art.');
  if (!istGueltigesDatum(datum)) throw new Error('Bitte ein gültiges Datum wählen.');

  const pruefeKonto = (id, rolle) => {
    const konto = konten.find((k) => k.id === id);
    if (!konto) throw new Error(`Bitte ${rolle} wählen.`);
    if (datum < konto.stichtag) {
      throw new Error(`Das Datum liegt vor dem Stichtag von „${konto.name}“ (${formatDatum(konto.stichtag)}). ` +
        'Alles davor steckt schon im Anfangssaldo.');
    }
    return konto;
  };

  const gemeinsam = {
    datum,
    betragCent,
    art,
    notiz: (eingabe.notiz ?? '').trim(),
    // Empfänger/Absender (Datenversion 8): undefined = unverändert; bei Umbuchungen nie
    partner: art === 'umbuchung' ? ''
      : (eingabe.partner === undefined ? bestehende[0]?.partner ?? '' : String(eingabe.partner ?? '').trim()).slice(0, 80),
    status: eingabe.status === 'vorgemerkt' ? 'vorgemerkt' : 'gebucht',
    // Verknüpfung mit einer wiederkehrenden Buchung (Etappe 4) – bleibt beim Bearbeiten erhalten
    wiederkehrendId: eingabe.wiederkehrendId ?? bestehende[0]?.wiederkehrendId ?? null,
    faelligAm: eingabe.faelligAm ?? bestehende[0]?.faelligAm ?? null,
    // Verknüpfung mit einer geplanten Einmalbuchung (Etappe 5)
    geplantId: eingabe.geplantId ?? bestehende[0]?.geplantId ?? null,
    // Belege (Etappe 6): undefined = unverändert
    belege: eingabe.belege ?? bestehende[0]?.belege ?? [],
    // Projekt (Datenversion 5): undefined = unverändert lassen, '' oder null = kein Projekt.
    // Umbuchungen gehören nie zu einem Projekt (sie sind keine Ausgabe).
    projektId: art === 'umbuchung' ? null
      : (eingabe.projektId === undefined ? bestehende[0]?.projektId ?? null : eingabe.projektId || null),
    // Budget-Zuordnung (Datenversion 16, D98): nur bei Umbuchungen; undefined = unverändert, '' = keine.
    // Verbraucht das Budget dieser Hauptkategorie auf dem abgebenden Konto.
    budgetKategorieId: art !== 'umbuchung' ? null
      : (eingabe.budgetKategorieId === undefined ? bestehende[0]?.budgetKategorieId ?? null : eingabe.budgetKategorieId || null),
    // Relevante Ausgabe (Datenversion 10): nur bei Ausgaben; undefined = unverändert
    relevant: art === 'ausgabe' && (eingabe.relevant === undefined ? Boolean(bestehende[0]?.relevant) : Boolean(eingabe.relevant)),
    relevantGruppe: art !== 'ausgabe' ? ''
      : normGruppe(eingabe.relevantGruppe === undefined ? bestehende[0]?.relevantGruppe : eingabe.relevantGruppe),
    // Vertrag (Datenversion 18, D148): undefined = unverändert, '' oder null = keiner
    vertragId: eingabe.vertragId === undefined ? bestehende[0]?.vertragId ?? null : eingabe.vertragId || null,
    // D214: Auslage (nur Ausgaben) bzw. Rückzahlung (nur Einnahmen); undefined = unverändert
    auslage: art !== 'ausgabe' ? null : normAuslage(eingabe.auslage === undefined ? bestehende[0]?.auslage : eingabe.auslage, bestehende[0]?.auslage),
    auslageId: art !== 'einnahme' ? null
      : (eingabe.auslageId === undefined ? bestehende[0]?.auslageId ?? null : eingabe.auslageId || null),
    // D215: automatische Aufrundung – an welcher Ausgabe die Umbuchung hängt; undefined = unverändert
    aufrundungFuer: art !== 'umbuchung' ? null
      : (eingabe.aufrundungFuer === undefined ? bestehende[0]?.aufrundungFuer ?? null : eingabe.aufrundungFuer || null),
    // D216: automatischer Ausgleich – an welcher Ausgabe die Umbuchung hängt; undefined = unverändert
    ausgleichFuer: art !== 'umbuchung' ? null
      : (eingabe.ausgleichFuer === undefined ? bestehende[0]?.ausgleichFuer ?? null : eingabe.ausgleichFuer || null),
    geaendertAm: jetzt,
  };
  // D142: relevante Ausgabe → Notiz ist Pflicht (sie benennt auch den Beleg)
  if (gemeinsam.relevant && !gemeinsam.notiz) throw new Error('Bei einer relevanten Ausgabe ist die Notiz Pflicht – sie benennt auch den Beleg.');
  const basis = (alt) => ({
    belege: [],
    geloeschtAm: null,
    erstelltAm: jetzt,
    ...(alt ?? { id: crypto.randomUUID() }),
  });

  if (art !== 'umbuchung') {
    pruefeKonto(eingabe.kontoId, 'ein Konto');
    if (!eingabe.kategorieId) throw new Error('Bitte eine Kategorie wählen.');
    return [{
      ...basis(bestehende[0]),
      ...gemeinsam,
      kontoId: eingabe.kontoId,
      kategorieId: eingabe.kategorieId,
      umbuchungId: null,
      richtung: null,
      gegenkontoId: null,
    }];
  }

  pruefeKonto(eingabe.kontoId, 'das Konto „Von“');
  pruefeKonto(eingabe.gegenkontoId, 'das Konto „Auf“');
  if (eingabe.kontoId === eingabe.gegenkontoId) throw new Error('Bitte zwei verschiedene Konten wählen.');

  const altAb = bestehende.find((b) => b.richtung === 'ab');
  const altZu = bestehende.find((b) => b.richtung === 'zu');
  const umbuchungId = altAb?.umbuchungId ?? crypto.randomUUID();
  return [
    {
      ...basis(altAb), ...gemeinsam, kategorieId: null, umbuchungId, richtung: 'ab',
      kontoId: eingabe.kontoId, gegenkontoId: eingabe.gegenkontoId,
    },
    {
      ...basis(altZu), ...gemeinsam, kategorieId: null, umbuchungId, richtung: 'zu',
      kontoId: eingabe.gegenkontoId, gegenkontoId: eingabe.kontoId,
    },
  ];
}

/** Zu einer Buchung alle zusammengehörigen Datensätze (Umbuchung: beide Hälften) */
export function gruppeVon(buchung, alle) {
  if (!buchung.umbuchungId) return [buchung];
  return alle.filter((b) => b.umbuchungId === buchung.umbuchungId);
}

/** Wie viele Buchungen (auch im Papierkorb) hängen an einem Konto bzw. an Kategorien? */
export function anzahlFuerKonto(kontoId, alle) {
  return alle.filter((b) => b.kontoId === kontoId).length;
}
export function anzahlFuerKategorien(kategorieIds, alle) {
  const ids = new Set(kategorieIds);
  return alle.filter((b) => ids.has(b.kategorieId) || ids.has(b.budgetKategorieId)).length; // inkl. Budget-Zuordnung (D98)
}

/** D147: Vorgemerkte Buchungen eines Kontos (ohne Papierkorb), älteste zuerst */
export function vorgemerkteVonKonto(kontoId, alle) {
  return alle
    .filter((b) => !b.geloeschtAm && b.kontoId === kontoId && b.status === 'vorgemerkt')
    .sort((a, b) => a.datum.localeCompare(b.datum) || (a.erstelltAm ?? '').localeCompare(b.erstelltAm ?? ''));
}

/**
 * D147: Mehrere vorgemerkte Buchungen auf einmal auf „gebucht“ setzen.
 * Bei Umbuchungen werden beide Hälften geändert. Liefert die geänderten Datensätze.
 */
export function alsGebuchtMarkieren(ids, alle, jetzt = new Date().toISOString()) {
  const gewaehlt = new Set(ids);
  const geaendert = new Map();
  for (const b of alle) {
    if (!gewaehlt.has(b.id)) continue;
    for (const teil of gruppeVon(b, alle)) {
      if (teil.status === 'vorgemerkt' && !teil.geloeschtAm) geaendert.set(teil.id, { ...teil, status: 'gebucht', geaendertAm: jetzt });
    }
  }
  return [...geaendert.values()];
}

/* ---------- D215: Aufrunden auf den nächsten vollen Euro ---------- */
// Einstellung (Sammlung einstellungen, id 'aufrunden'): { aktiv, vonKontoId, zielKontoId }.
// Ausgaben vom Von-Konto mit Cent-Betrag bekommen eine Umbuchung über den Rest bis zum vollen Euro aufs Ziel-Konto.
// Die Umbuchung trägt aufrundungFuer = ID der Ausgabe und folgt ihr beim Ändern, Löschen und Wiederherstellen.

/** Fehlender Betrag bis zum nächsten vollen Euro in Cent (12,30 € → 70; 12,00 € → 0) */
export const aufrundungCent = (betragCent) => (100 - (Number(betragCent) % 100)) % 100;

/** Ist das Aufrunden eingerichtet und gilt es für dieses Konto? */
export const aufrundenGilt = (einstellung, kontoId) => Boolean(einstellung?.aktiv && einstellung.vonKontoId && einstellung.zielKontoId
  && einstellung.vonKontoId !== einstellung.zielKontoId && kontoId === einstellung.vonKontoId);

/** Aufrundungs-Umbuchungen (beide Hälften) zu diesen Ausgaben */
export function aufrundungenVon(ausgabeIds, alle) {
  const ids = new Set(ausgabeIds);
  return alle.filter((b) => b.art === 'umbuchung' && b.aufrundungFuer && ids.has(b.aufrundungFuer));
}

/**
 * Passt die Aufrundung zu einer gespeicherten Ausgabe an. an: Häkchen im Dialog.
 * Ergebnis: Datensätze zum Speichern (neue/geänderte Umbuchung, oder die alte in den Papierkorb).
 * Keine Aufrundung, wenn sie nicht gilt, das Häkchen aus ist oder der Betrag glatte Euro hat.
 */
export function aufrundungAnpassen(ausgabe, einstellung, alle, { konten, an = true, jetzt = new Date().toISOString() }) {
  const alt = aufrundungenVon([ausgabe.id], alle).filter((b) => !b.geloeschtAm);
  const cent = aufrundungCent(ausgabe.betragCent);
  const soll = an && ausgabe.art === 'ausgabe' && !ausgabe.geloeschtAm && cent > 0 && aufrundenGilt(einstellung, ausgabe.kontoId);
  if (!soll) return alt.map((b) => ({ ...b, geloeschtAm: jetzt, geaendertAm: jetzt }));
  return baueBuchungen({
    art: 'umbuchung', betragCent: cent, datum: ausgabe.datum, kontoId: einstellung.vonKontoId, gegenkontoId: einstellung.zielKontoId,
    notiz: 'Aufrundung', status: ausgabe.status, aufrundungFuer: ausgabe.id,
  }, { konten, bestehende: alt, jetzt });
}

/* ---------- D216: Ausgaben eines Kontos automatisch ausgleichen (z. B. PayPal aus dem Girokonto) ---------- */
// Einstellung (einstellungen, id 'ausgleich'): { aktiv, kontoId (z. B. PayPal), vonKontoId (z. B. Girokonto) }.
// Jede Ausgabe auf kontoId bekommt eine Umbuchung in gleicher Höhe vonKontoId → kontoId, gleiches Datum.
// Die Umbuchung trägt das Budget der Hauptkategorie (D98) – so zählt die Ausgabe gegen das Budget auf dem Girokonto –,
// außer bei Projekt-Ausgaben und Auslagen (die zählen nicht gegen Budgets, D52/D214).

/** Ist der Ausgleich eingerichtet und gilt er für dieses Konto? */
export const ausgleichGilt = (einstellung, kontoId) => Boolean(einstellung?.aktiv && einstellung.kontoId && einstellung.vonKontoId
  && einstellung.kontoId !== einstellung.vonKontoId && kontoId === einstellung.kontoId);

/** Ausgleichs-Umbuchungen (beide Hälften) zu diesen Ausgaben */
export function ausgleicheVon(ausgabeIds, alle) {
  const ids = new Set(ausgabeIds);
  return alle.filter((b) => b.art === 'umbuchung' && b.ausgleichFuer && ids.has(b.ausgleichFuer));
}

/**
 * Passt den Ausgleich zu einer gespeicherten Ausgabe an (an: Häkchen im Dialog). kategorien: für die Budget-Zuordnung.
 * Ergebnis: Datensätze zum Speichern (neue/geänderte Umbuchung, oder die alte in den Papierkorb).
 */
export function ausgleichAnpassen(ausgabe, einstellung, alle, { konten, kategorien = [], an = true, jetzt = new Date().toISOString() }) {
  const alt = ausgleicheVon([ausgabe.id], alle).filter((b) => !b.geloeschtAm);
  const soll = an && ausgabe.art === 'ausgabe' && !ausgabe.geloeschtAm && ausgleichGilt(einstellung, ausgabe.kontoId);
  if (!soll) return alt.map((b) => ({ ...b, geloeschtAm: jetzt, geaendertAm: jetzt }));
  const zaehltGegenBudget = !ausgabe.projektId && !ausgabe.auslage;
  const hauptId = kategorien.find((k) => k.id === ausgabe.kategorieId)?.elternId ?? null;
  return baueBuchungen({
    art: 'umbuchung', betragCent: ausgabe.betragCent, datum: ausgabe.datum, kontoId: einstellung.vonKontoId, gegenkontoId: einstellung.kontoId,
    notiz: [einstellung.notiz ?? 'Ausgleich', ausgabe.partner].filter(Boolean).join(' '), status: ausgabe.status, ausgleichFuer: ausgabe.id,
    budgetKategorieId: zaehltGegenBudget ? hauptId : null,
  }, { konten, bestehende: alt, jetzt });
}

/* ---------- Datenbank-Operationen ---------- */

export const alleBuchungen = () => db.alle('buchungen');

export async function speichereBuchung(eingabe, bestehende = []) {
  const konten = await db.alle('konten');
  const datensaetze = baueBuchungen(eingabe, { konten, bestehende });
  await db.speichere('buchungen', datensaetze);
  return datensaetze;
}

/** D215: Gruppe plus die Aufrundungen ihrer Ausgaben (nur solche mit passendem Papierkorb-Zustand) */
async function mitAufrundungen(gruppe, geloescht) {
  const ausgaben = gruppe.filter((b) => b.art === 'ausgabe').map((b) => b.id);
  if (!ausgaben.length) return gruppe;
  const alle = await db.alle('buchungen');
  const dazu = [...aufrundungenVon(ausgaben, alle), ...ausgleicheVon(ausgaben, alle)] // D215/D216
    .filter((b) => Boolean(b.geloeschtAm) === geloescht && !gruppe.some((g) => g.id === b.id));
  return [...gruppe, ...dazu];
}

export async function inPapierkorb(gruppe) {
  const zeit = new Date().toISOString();
  const alle = await mitAufrundungen(gruppe, false);
  await db.speichere('buchungen', alle.map((b) => ({ ...b, geloeschtAm: zeit, geaendertAm: zeit })));
}

export async function wiederherstellen(gruppe) {
  const zeit = new Date().toISOString();
  const alle = await mitAufrundungen(gruppe, true);
  await db.speichere('buchungen', alle.map((b) => ({ ...b, geloeschtAm: null, geaendertAm: zeit })));
}

export async function endgueltigLoeschen(gruppe) {
  const alle = await mitAufrundungen(gruppe, true);
  await db.loesche('buchungen', alle.map((b) => b.id));
}
