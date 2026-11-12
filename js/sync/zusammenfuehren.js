// Etappe 6: Zusammenführen zweier Datenstände (dieses Gerät ↔ Google Drive).
// Reine Funktionen ohne Datenbank und ohne Netz – mit `npm test` geprüft. Siehe DECISIONS.md D60.
//
// Drei-Wege-Vergleich je Datensatz (Kennung = Sammlung + id):
//   basis  = der Stand beim letzten erfolgreichen Abgleich (auf diesem Gerät gemerkt)
//   lokal  = der Stand auf diesem Gerät
//   remote = der Stand in Drive
// Regeln:
//   lokal == remote            → übernehmen (egal ob geändert)
//   lokal == basis             → nur Drive hat geändert → Drive übernehmen (auch Löschen)
//   remote == basis            → nur dieses Gerät hat geändert → lokal übernehmen (auch Löschen)
//   sonst                      → KONFLIKT: beide haben denselben Eintrag verschieden geändert
//                                (auch: einer gelöscht, der andere geändert) → der Nutzer entscheidet.
// So geht nichts still verloren (CLAUDE.md: "darf nie still überschreiben").

import { SAMMLUNGEN } from '../db.js';

/** JSON mit sortierten Schlüsseln – damit gleiche Inhalte immer gleich aussehen */
export function stabil(wert) {
  if (Array.isArray(wert)) return `[${wert.map(stabil).join(',')}]`;
  if (wert && typeof wert === 'object') {
    return `{${Object.keys(wert).filter((k) => wert[k] !== undefined).sort()
      .map((k) => `${JSON.stringify(k)}:${stabil(wert[k])}`).join(',')}}`;
  }
  return JSON.stringify(wert ?? null);
}

const gleich = (a, b) => (a === undefined || b === undefined ? a === b : stabil(a) === stabil(b));
const nachId = (liste) => new Map((liste ?? []).map((x) => [x.id, x]));

/** Sind zwei Datenstände inhaltlich gleich? (Reihenfolge der Datensätze egal) */
export function gleicherStand(a, b) {
  if (!a || !b) return false;
  return SAMMLUNGEN.every((s) => {
    const x = nachId(a[s]);
    const y = nachId(b[s]);
    if (x.size !== y.size) return false;
    for (const [id, wert] of x) if (!gleich(wert, y.get(id))) return false;
    return true;
  });
}

/** Wie viele Datensätze unterscheiden sich zwischen zwei Ständen? (neu, geändert, gelöscht) */
export function anzahlUnterschiede(a, b) {
  let n = 0;
  for (const s of SAMMLUNGEN) {
    const x = nachId(a?.[s]);
    const y = nachId(b?.[s]);
    for (const [id, wert] of x) if (!gleich(wert, y.get(id))) n += 1;
    for (const id of y.keys()) if (!x.has(id)) n += 1;
  }
  return n;
}

/**
 * Führt zusammen. basis darf null sein (noch nie abgeglichen) – dann zählt jeder Unterschied
 * als Konflikt, außer ein Datensatz existiert nur auf einer Seite (dann wird er übernommen).
 * Ergebnis: { daten, konflikte: [{ sammlung, id, lokal, remote }], aenderungen: { vonDrive, vonGeraet } }
 * daten enthält bei Konflikten vorläufig die lokale Fassung; mit loeseKonflikte() anpassen.
 */
export function fuehreZusammen(basis, lokal, remote, version) {
  const daten = { version };
  const konflikte = [];
  const aenderungen = { vonDrive: 0, vonGeraet: 0 };

  for (const s of SAMMLUNGEN) {
    const b = nachId(basis?.[s]);
    const l = nachId(lokal[s]);
    const r = nachId(remote[s]);
    const ids = new Set([...l.keys(), ...r.keys(), ...b.keys()]);
    const ergebnis = [];
    for (const id of ids) {
      const lw = l.get(id);
      const rw = r.get(id);
      const bw = basis ? b.get(id) : undefined;
      let wahl;
      if (gleich(lw, rw)) wahl = lw;
      else if (basis && gleich(lw, bw)) { wahl = rw; aenderungen.vonDrive += 1; }
      else if (basis && gleich(rw, bw)) { wahl = lw; aenderungen.vonGeraet += 1; }
      else if (!basis && lw === undefined) { wahl = rw; aenderungen.vonDrive += 1; }
      else if (!basis && rw === undefined) { wahl = lw; aenderungen.vonGeraet += 1; }
      else {
        konflikte.push({ sammlung: s, id, lokal: lw ?? null, remote: rw ?? null });
        wahl = lw;
      }
      if (wahl !== undefined) ergebnis.push(wahl);
    }
    daten[s] = ergebnis;
  }
  return { daten, konflikte, aenderungen };
}

/**
 * Wendet die Entscheidungen des Nutzers an.
 * entscheidungen: Map("sammlung|id" → 'lokal' | 'remote'); fehlend = 'lokal'.
 * Eine gewählte Seite ohne Datensatz (null) bedeutet: gelöscht.
 */
export function loeseKonflikte(daten, konflikte, entscheidungen) {
  const neu = structuredClone(daten);
  for (const k of konflikte) {
    const seite = entscheidungen.get(`${k.sammlung}|${k.id}`) ?? 'lokal';
    const wert = seite === 'remote' ? k.remote : k.lokal;
    const liste = neu[k.sammlung].filter((x) => x.id !== k.id);
    if (wert) liste.push(wert);
    neu[k.sammlung] = liste;
  }
  return neu;
}

/**
 * Ist dieser Stand "frisch" – also nur der Startsatz ohne eigene Daten?
 * (Erstes Verbinden eines neuen Geräts: dann wird einfach der Drive-Stand übernommen,
 * statt die zufällig anders nummerierten Start-Kategorien doppelt anzulegen.)
 */
export function istFrischerStand(daten) {
  const leer = (s) => (daten[s] ?? []).length === 0;
  return ['konten', 'buchungen', 'budgets', 'wiederkehrend', 'geplant', 'projekte', 'abstimmungen', 'archive', 'relevant', 'vertraege', 'monatsnotizen'].every(leer)
    && (daten.kategorien ?? []).every((k) => !k.geaendertAm || k.geaendertAm === k.erstelltAm);
}

/** Kurzbeschreibung eines Stands, z. B. für die Nachfrage beim ersten Verbinden */
export function standKurz(daten) {
  const aktiv = (daten.buchungen ?? []).filter((b) => !b.geloeschtAm).length;
  return `${(daten.konten ?? []).length} Konten, ${aktiv} Buchungen`;
}

/* ======================= Backups ======================= */

/**
 * Welche Backups dürfen weg? (D61, Entscheidung des Nutzers: letzte 30 + je Tag)
 * backups: [{ id, zeit (ISO-Zeitpunkt) }]. Behalten werden
 *  - die 30 neuesten und
 *  - je Kalendertag der letzten 30 Tage das neueste.
 * Ergebnis: Liste der zu löschenden Backups.
 */
export function backupsZumLoeschen(backups, jetzt = new Date(), anzahl = 30, tage = 30) {
  const sortiert = [...backups].sort((a, b) => b.zeit.localeCompare(a.zeit));
  const behalten = new Set(sortiert.slice(0, anzahl).map((x) => x.id));
  const grenze = new Date(jetzt.getTime() - tage * 86400000).toISOString().slice(0, 10);
  const gesehen = new Set();
  for (const x of sortiert) {
    const tag = x.zeit.slice(0, 10);
    if (tag < grenze || gesehen.has(tag)) continue;
    gesehen.add(tag);
    behalten.add(x.id);
  }
  return sortiert.filter((x) => !behalten.has(x.id));
}
