// Lokale Datenbank im Browser (IndexedDB).
//
// Zwei verschiedene Versionsnummern – bitte nicht verwechseln:
// 1. DB_STRUKTUR_VERSION: Welche "Schubladen" (Object Stores) es gibt.
//    Wird erhöht, wenn eine neue Schublade dazukommt (z. B. "buchungen" in Etappe 2).
// 2. DATENMODELL_VERSION (in migrationen.js): Wie die Datensätze aufgebaut sind.
//    Wird erhöht, wenn sich Felder ändern; dann laufen die Migrationen.

import { DATENMODELL_VERSION, migriereDaten } from './migrationen.js';
import { erzeugeStartKategorien } from './startdaten.js';

const DB_NAME = 'finanzapp';
const DB_STRUKTUR_VERSION = 1;

/** Schubladen mit Nutzdaten. "meta" kommt zusätzlich dazu (Versionsnummer usw.). */
export const SAMMLUNGEN = ['konten', 'kategorien'];

let dbVersprechen = null;

function oeffne() {
  dbVersprechen ??= new Promise((resolve, reject) => {
    const anfrage = indexedDB.open(DB_NAME, DB_STRUKTUR_VERSION);
    anfrage.onupgradeneeded = () => {
      const db = anfrage.result;
      for (const name of SAMMLUNGEN) {
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

/** Einen oder mehrere Datensätze speichern (neu oder überschreiben) */
export async function speichere(sammlung, datensaetze) {
  const liste = Array.isArray(datensaetze) ? datensaetze : [datensaetze];
  const db = await oeffne();
  const tx = db.transaction(sammlung, 'readwrite');
  for (const d of liste) tx.objectStore(sammlung).put(d);
  await abgeschlossen(tx);
}

/** Einen oder mehrere Datensätze per ID endgültig löschen */
export async function loesche(sammlung, ids) {
  const liste = Array.isArray(ids) ? ids : [ids];
  const db = await oeffne();
  const tx = db.transaction(sammlung, 'readwrite');
  for (const id of liste) tx.objectStore(sammlung).delete(id);
  await abgeschlossen(tx);
}

async function leseMeta(schluessel) {
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

/** Ersetzt den kompletten Datenstand in EINEM Schritt (alles oder nichts). */
async function schreibeDatenstand(daten) {
  const db = await oeffne();
  const tx = db.transaction([...SAMMLUNGEN, 'meta'], 'readwrite');
  for (const s of SAMMLUNGEN) {
    const store = tx.objectStore(s);
    store.clear();
    for (const d of daten[s] ?? []) store.put(d);
  }
  tx.objectStore('meta').put({ schluessel: 'datenVersion', wert: daten.version });
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
    await schreibeDatenstand({ version: DATENMODELL_VERSION, konten: [], kategorien: erzeugeStartKategorien() });
    return { ersterStart: true, version: DATENMODELL_VERSION };
  }
  if (version !== DATENMODELL_VERSION) {
    const { daten, angewendet } = migriereDaten(await leseDatenstand());
    await schreibeDatenstand(daten);
    return { ersterStart: false, version: daten.version, migriert: angewendet };
  }
  return { ersterStart: false, version };
}
