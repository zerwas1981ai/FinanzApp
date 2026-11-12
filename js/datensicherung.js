// Vorschau vor dem Wiederherstellen eines Backups (D108). Reine Funktionen – mit `npm test` geprüft.
// Vergleicht den jetzigen Stand mit dem Backup in wenigen, verständlichen Zahlen, damit man
// vor dem Ersetzen sieht, ob man den richtigen Stand erwischt hat.

import { kontostand, istAktiv } from './rechnen.js';
import { sortiereKonten } from './konten.js';

const aktiv = (liste) => (liste ?? []).filter(istAktiv);
const spaetestes = (werte) => werte.filter(Boolean).reduce((max, w) => (max === null || w > max ? w : max), null);

/** Kennzahlen eines Datenstands (heute = Stichtag für die Kontostände) */
export function standUebersicht(daten, heute) {
  const buchungen = daten.buchungen ?? [];
  const aktive = aktiv(buchungen);
  // Umbuchungen bestehen aus zwei Hälften – für die Anzahl nur einmal zählen
  const anzahl = aktive.filter((b) => b.art !== 'umbuchung' || b.richtung !== 'zu').length;
  const konten = sortiereKonten((daten.konten ?? []).filter((k) => !k.archiviert));
  return {
    buchungen: anzahl,
    papierkorb: buchungen.filter((b) => b.geloeschtAm && (b.art !== 'umbuchung' || b.richtung !== 'zu')).length,
    letzteBuchung: spaetestes(aktive.map((b) => b.datum)),
    zuletztGeaendert: spaetestes(buchungen.map((b) => b.geaendertAm ?? b.erstelltAm)),
    konten: konten.map((k) => ({ id: k.id, name: k.name, standCent: kontostand(k, buchungen, heute) })),
    budgets: (daten.budgets ?? []).length,
    wiederkehrend: (daten.wiederkehrend ?? []).length,
    geplant: (daten.geplant ?? []).length,
    projekte: (daten.projekte ?? []).length,
  };
}

/**
 * Vergleich jetzt ↔ Backup als Zeilen [{ text, jetzt, backup, anders }] für eine Tabelle.
 * Konten, die nur auf einer Seite existieren, erscheinen mit "–" auf der anderen.
 */
export function vergleiche(jetzt, backup, { euro = String, datum = String } = {}) {
  const zeile = (text, a, b, fmt = String) => ({ text, jetzt: a == null ? '–' : fmt(a), backup: b == null ? '–' : fmt(b), anders: a !== b });
  const zeilen = [
    zeile('Buchungen', jetzt.buchungen, backup.buchungen),
    zeile('Letzte Buchung vom', jetzt.letzteBuchung, backup.letzteBuchung, datum),
    zeile('Im Papierkorb', jetzt.papierkorb, backup.papierkorb),
    zeile('Wiederkehrende Buchungen', jetzt.wiederkehrend, backup.wiederkehrend),
    zeile('Budgets', jetzt.budgets, backup.budgets),
    zeile('Geplante Einmalbuchungen', jetzt.geplant, backup.geplant),
    zeile('Projekte', jetzt.projekte, backup.projekte),
  ];
  const ids = [...new Set([...jetzt.konten.map((k) => k.id), ...backup.konten.map((k) => k.id)])];
  for (const id of ids) {
    const a = jetzt.konten.find((k) => k.id === id);
    const b = backup.konten.find((k) => k.id === id);
    zeilen.push(zeile(`Stand ${(a ?? b).name}`, a?.standCent ?? null, b?.standCent ?? null, euro));
  }
  return zeilen;
}
