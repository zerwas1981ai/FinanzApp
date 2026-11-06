// Buchungen anlegen, ändern, in den Papierkorb legen, wiederherstellen.
//
// Datensatz Buchung (Datenversion 2):
// {
//   id, datum "JJJJ-MM-TT", betragCent (immer > 0),
//   art: 'einnahme' | 'ausgabe' | 'umbuchung',
//   kontoId,
//   kategorieId,            // Unterkategorie; bei Umbuchung null
//   notiz, status: 'gebucht' | 'vorgemerkt',
//   belege: [],             // ab Etappe 6 (Google Drive)
//   umbuchungId,            // nur Umbuchung: gemeinsame ID beider Hälften
//   richtung,               // nur Umbuchung: 'ab' (Abgang) | 'zu' (Zugang)
//   gegenkontoId,           // nur Umbuchung: das andere Konto
//   geloeschtAm,            // null = aktiv, sonst Zeitpunkt (= im Papierkorb)
//   erstelltAm, geaendertAm, testdaten?
// }

import * as db from './db.js';
import { formatDatum, istGueltigesDatum } from './format.js';

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
    status: eingabe.status === 'vorgemerkt' ? 'vorgemerkt' : 'gebucht',
    geaendertAm: jetzt,
  };
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
  return alle.filter((b) => ids.has(b.kategorieId)).length;
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
