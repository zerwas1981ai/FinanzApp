// Etappe 6: Export als CSV, die Excel (deutsch) direkt richtig öffnet.
// - Trennzeichen Semikolon, Dezimalkomma, Datum TT.MM.JJJJ
// - UTF-8 mit BOM (sonst zeigt Excel Umlaute falsch), Zeilenende CRLF
// Reine Funktionen – mit `npm test` geprüft. Siehe DECISIONS.md D63.

const BOM = '﻿';

/** Ein Feld für CSV: in Anführungszeichen, wenn nötig; innere " verdoppeln */
export function csvFeld(wert) {
  const text = wert == null ? '' : String(wert);
  // Formeln (=, +, -, @ am Anfang) als Text erzwingen – Schutz vor "CSV-Injection" in Excel
  const sicher = /^[=+\-@\t\r]/.test(text) && !/^-?\d+(,\d+)?$/.test(text) ? `'${text}` : text;
  return /[;"\r\n]/.test(sicher) ? `"${sicher.replace(/"/g, '""')}"` : sicher;
}

/** Cent → "1234,56" bzw. "-12,30" (ohne Tausenderpunkt, damit Excel eine Zahl erkennt) */
export function csvBetrag(cent) {
  const vorzeichen = cent < 0 ? '-' : '';
  const abs = Math.abs(cent);
  return `${vorzeichen}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

/** "2026-11-06" → "06.11.2026" */
export const csvDatum = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '');

export function alsCsv(kopf, zeilen) {
  return BOM + [kopf, ...zeilen].map((z) => z.map(csvFeld).join(';')).join('\r\n') + '\r\n';
}

const ART = { einnahme: 'Einnahme', ausgabe: 'Ausgabe', umbuchung: 'Umbuchung' };

/**
 * Buchungen als CSV. Umbuchungen erscheinen einmal (Abgang) mit "Von → Auf"; der Betrag
 * hat ein Vorzeichen aus Sicht des Kontos (Ausgabe negativ). Gelöschte (Papierkorb) fehlen.
 */
export function buchungenAlsCsv(buchungen, { konten, kategorien, projekte = [] }) {
  const konto = new Map(konten.map((k) => [k.id, k.name]));
  const kat = new Map(kategorien.map((k) => [k.id, k]));
  const projekt = new Map(projekte.map((p) => [p.id, p.name]));
  const kopf = ['Datum', 'Konto', 'Art', 'Empfänger/Absender', 'Hauptkategorie', 'Unterkategorie',
    'Betrag (€)', 'Status', 'Notiz', 'Projekt', 'Gegenkonto', 'Belege'];
  const zeilen = buchungen
    .filter((b) => !b.geloeschtAm && !(b.art === 'umbuchung' && b.richtung === 'zu'))
    .sort((a, b) => a.datum.localeCompare(b.datum) || (a.erstelltAm ?? '').localeCompare(b.erstelltAm ?? ''))
    .map((b) => {
      const unter = kat.get(b.kategorieId);
      const betrag = b.art === 'einnahme' ? b.betragCent : -b.betragCent;
      return [
        csvDatum(b.datum),
        konto.get(b.kontoId) ?? '',
        ART[b.art] ?? b.art,
        b.partner ?? '',
        kat.get(unter?.elternId)?.name ?? '',
        unter?.name ?? '',
        csvBetrag(betrag),
        b.status === 'vorgemerkt' ? 'vorgemerkt' : 'gebucht',
        b.notiz ?? '',
        projekt.get(b.projektId) ?? '',
        b.art === 'umbuchung' ? konto.get(b.gegenkontoId) ?? '' : '',
        String(b.belege?.length ?? 0),
      ];
    });
  return alsCsv(kopf, zeilen);
}

/** Dateiname mit Datum, z. B. "finanzen-buchungen-2026-11-06.csv" */
export const exportName = (teil, heute) => `finanzen-${teil}-${heute}.csv`;
