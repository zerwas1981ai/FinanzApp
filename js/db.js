// Lokale Datenbank im Browser (IndexedDB).
//
// Zwei verschiedene Versionsnummern – bitte nicht verwechseln:
// 1. DB_STRUKTUR_VERSION: Welche "Schubladen" (Object Stores) es gibt.
//    Wird erhöht, wenn eine neue Schublade dazukommt (z. B. "buchungen" in Etappe 2).
// 2. DATENMODELL_VERSION (in migrationen.js): Wie die Datensätze aufgebaut sind.
//    Wird erhöht, wenn sich Felder ändern; dann laufen die Migrationen.

import { DATENMODELL_VERSION, STANDARD_EINSTELLUNGEN, migriereDaten } from './migrationen.js';
import { erzeugeStartKategorien } from './startdaten.js';

const DB_NAME = 'finanzapp';
// 2 = Etappe 2: buchungen, abstimmungen; 3 = Etappe 4: budgets usw.; 4 = Etappe 5: geplant, szenarien;
// 5 = Projekte statt Szenarien; 6 = Etappe 6: belegDateien (lokaler Zwischenspeicher für Belege);
// 7 = Archiv: archive (abgeglichen), archivDateien (lokaler Zwischenspeicher)
// 8 = Relevante Ausgaben: relevant (D74); 9 = Vorlagen für häufige Buchungen: vorlagen (D104)
// 10 = Verträge: vertraege (D148)
const DB_STRUKTUR_VERSION = 10;

/** Schubladen mit Nutzdaten. "meta" kommt zusätzlich dazu (Versionsnummer usw.). */
export const SAMMLUNGEN = [
  'konten', 'kategorien', 'buchungen', 'abstimmungen',
  'budgets', 'wiederkehrend', 'hinweise', 'einstellungen',
  'geplant', 'projekte', 'archive', 'relevant', 'vorlagen', 'vertraege',
];

/**
 * Schubladen, die es früher gab. Sie werden nur noch für die Migration gelesen
 * und danach geleert (die leere Schublade selbst stört nicht).
 */
const ALTE_SAMMLUNGEN = ['szenarien'];

/**
 * Nur auf diesem Gerät (wird NICHT mit Drive abgeglichen):
 * belegDateien = { id (lokale Beleg-ID), blob, name, mime } – Belegdatei, bis sie in Drive liegt,
 * danach als Zwischenspeicher zum schnellen Anzeigen.
 * archivDateien = { id ("archiv-JJJJ"), inhalt } – Inhalt einer Archivdatei zum Anzeigen ohne Netz.
 */
export const LOKALE_SAMMLUNGEN = ['belegDateien', 'archivDateien'];

let dbVersprechen = null;

function oeffne() {
  dbVersprechen ??= new Promise((resolve, reject) => {
    const anfrage = indexedDB.open(DB_NAME, DB_STRUKTUR_VERSION);
    anfrage.onupgradeneeded = () => {
      const db = anfrage.result;
      for (const name of [...SAMMLUNGEN, ...LOKALE_SAMMLUNGEN]) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'schluessel' });
    };
    anfrage.onsuccess = () => {
      const db = anfrage.result;
      // Falls eine neuere App-Version in einem anderen Tab die Datenbank umbaut
      db.onversionchange = () => { db.close(); location.reload(); };
      resolve(db);
    };
    anfrage.onerror = () => reject(anfrage.error);
    anfrage.onblocked = () => reject(new Error('Die App ist noch in einem anderen Tab geöffnet. Bitte diesen Tab schließen und neu laden.'));
  });
  return dbVersprechen;
}

const alsVersprechen = (anfrage) => new Promise((resolve, reject) => {
  anfrage.onsuccess = () => resolve(anfrage.result);
  anfrage.onerror = () => reject(anfrage.error);
});

const abgeschlossen = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error ?? new Error('Speichern abgebrochen.'));
});

/** Alle Datensätze einer Sammlung */
export async function alle(sammlung) {
  const db = await oeffne();
  return alsVersprechen(db.transaction(sammlung).objectStore(sammlung).getAll());
}

/**
 * Signal "Nutzdaten wurden geändert" – darauf hört der Abgleich mit Drive (Etappe 6).
 * Nur für abgeglichene Sammlungen, nicht für meta und lokale Zwischenspeicher.
 */
function meldeAenderung(sammlung) {
  if (SAMMLUNGEN.includes(sammlung) && typeof window !== 'undefined') window.dispatchEvent(new Event('db-geaendert'));
}

/** Einen oder mehrere Datensätze speichern (neu oder überschreiben) */
export async function speichere(sammlung, datensaetze) {
  const liste = Array.isArray(datensaetze) ? datensaetze : [datensaetze];
  const db = await oeffne();
  const tx = db.transaction(sammlung, 'readwrite');
  for (const d of liste) tx.objectStore(sammlung).put(d);
  await abgeschlossen(tx);
  meldeAenderung(sammlung);
}

/** Einen oder mehrere Datensätze per ID endgültig löschen */
export async function loesche(sammlung, ids) {
  const liste = Array.isArray(ids) ? ids : [ids];
  const db = await oeffne();
  const tx = db.transaction(sammlung, 'readwrite');
  for (const id of liste) tx.objectStore(sammlung).delete(id);
  await abgeschlossen(tx);
  meldeAenderung(sammlung);
}

/** Einen Datensatz per ID lesen (oder undefined) */
export async function hole(sammlung, id) {
  const db = await oeffne();
  return alsVersprechen(db.transaction(sammlung).objectStore(sammlung).get(id));
}

export async function schreibeMeta(schluessel, wert) {
  const db = await oeffne();
  const tx = db.transaction('meta', 'readwrite');
  tx.objectStore('meta').put({ schluessel, wert });
  await abgeschlossen(tx);
}

export async function leseMeta(schluessel) {
  const db = await oeffne();
  const eintrag = await alsVersprechen(db.transaction('meta').objectStore('meta').get(schluessel));
  return eintrag?.wert;
}

/** Gesamter Datenstand als einfaches Objekt (für Migrationen, später Sync/Backup) */
export async function leseDatenstand() {
  const version = await leseMeta('datenVersion');
  const daten = { version };
  for (const s of SAMMLUNGEN) daten[s] = await alle(s);
  return daten;
}

/** Wie leseDatenstand, aber mit den alten Schubladen (nur für Migrationen) */
async function leseDatenstandMitAltem() {
  const daten = await leseDatenstand();
  const db = await oeffne();
  for (const s of ALTE_SAMMLUNGEN) {
    if (db.objectStoreNames.contains(s)) daten[s] = await alle(s);
  }
  return daten;
}

/** Ersetzt den kompletten Datenstand in EINEM Schritt (alles oder nichts). */
export async function schreibeDatenstand(daten) {
  const db = await oeffne();
  const alte = ALTE_SAMMLUNGEN.filter((s) => db.objectStoreNames.contains(s));
  const tx = db.transaction([...SAMMLUNGEN, ...alte, 'meta'], 'readwrite');
  for (const s of alte) tx.objectStore(s).clear();
  for (const s of SAMMLUNGEN) {
    const store = tx.objectStore(s);
    store.clear();
    for (const d of daten[s] ?? []) store.put(d);
  }
  tx.objectStore('meta').put({ schluessel: 'datenVersion', wert: daten.version });
  await abgeschlossen(tx);
}

/**
 * Die komplette Datenbank dieses Geräts löschen ("PIN vergessen", D67).
 * Danach muss die Seite neu geladen werden.
 */
export async function datenbankLoeschen() {
  if (dbVersprechen) {
    const db = await dbVersprechen;
    db.onversionchange = null;
    db.close();
    dbVersprechen = null;
  }
  await new Promise((resolve, reject) => {
    const anfrage = indexedDB.deleteDatabase(DB_NAME);
    anfrage.onsuccess = () => resolve();
    anfrage.onerror = () => reject(anfrage.error);
    anfrage.onblocked = () => reject(new Error('Bitte die App in allen anderen Tabs schließen und erneut versuchen.'));
  });
}

/** Ein frischer Datenstand: nur der Kategorie-Startsatz und die Standard-Einstellungen */
export function leererStand() {
  const daten = { version: DATENMODELL_VERSION };
  for (const s of SAMMLUNGEN) daten[s] = [];
  daten.kategorien = erzeugeStartKategorien();
  daten.einstellungen = [{ ...STANDARD_EINSTELLUNGEN }];
  return daten;
}

/** Eine Schublade komplett leeren (ohne Änderungs-Signal) */
export async function leere(sammlung) {
  const db = await oeffne();
  const tx = db.transaction(sammlung, 'readwrite');
  tx.objectStore(sammlung).clear();
  await abgeschlossen(tx);
}

/**
 * Beim App-Start aufrufen:
 * - Erster Start: Startsatz an Kategorien anlegen.
 * - Älterer Datenstand: automatisch migrieren.
 * - Neuerer Datenstand: Fehler (nie etwas überschreiben).
 */
export async function initialisiere() {
  if (!('indexedDB' in window)) throw new Error('Dieser Browser unterstützt keine lokale Datenbank (IndexedDB).');
  const version = await leseMeta('datenVersion');

  if (version === undefined) {
    await schreibeDatenstand(leererStand());
    return { ersterStart: true, version: DATENMODELL_VERSION };
  }
  if (version !== DATENMODELL_VERSION) {
    const { daten, angewendet } = migriereDaten(await leseDatenstandMitAltem());
    await schreibeDatenstand(daten);
    return { ersterStart: false, version: daten.version, migriert: angewendet };
  }
  return { ersterStart: false, version };
}
