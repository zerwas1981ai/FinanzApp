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
//   erstelltAm, geaendertAm, testdaten?
// }

import * as db from './db.js';
import { formatDatum, istGueltigesDatum } from './format.js';
import { normGruppe } from './relevant.js';

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
    // Steuerthema (D167): undefined = unverändert, '' / null = wie die Kategorie, 'kein' = nicht steuerlich
    steuerthema: art !== 'ausgabe' ? null
      : (eingabe.steuerthema === undefined ? bestehende[0]?.steuerthema ?? null : eingabe.steuerthema || null),
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

/* ---------- Datenbank-Operationen ---------- */

export const alleBuchungen = () => db.alle('buchungen');

export async function speichereBuchung(eingabe, bestehende = []) {
  const konten = await db.alle('konten');
  const datensaetze = baueBuchungen(eingabe, { konten, bestehende });
  await db.speichere('buchungen', datensaetze);
  return datensaetze;
}

export async function inPapierkorb(gruppe) {
  const zeit = new Date().toISOString();
  await db.speichere('buchungen', gruppe.map((b) => ({ ...b, geloeschtAm: zeit, geaendertAm: zeit })));
}

export async function wiederherstellen(gruppe) {
  const zeit = new Date().toISOString();
  await db.speichere('buchungen', gruppe.map((b) => ({ ...b, geloeschtAm: null, geaendertAm: zeit })));
}

export async function endgueltigLoeschen(gruppe) {
  await db.loesche('buchungen', gruppe.map((b) => b.id));
}
