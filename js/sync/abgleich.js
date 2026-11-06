// Etappe 6: Abgleich dieses Geräts mit Google Drive. Siehe DECISIONS.md D60–D62.
//
// Ablauf eines Abgleichs (gleicheAb):
//  1. Wartende Belege hochladen, zum Löschen vorgemerkte Belege in den Drive-Papierkorb legen.
//  2. Lokalen Stand und die gemerkte "Basis" (Stand beim letzten Abgleich) lesen.
//  3. Ist die Drive-Datei seit dem letzten Abgleich unverändert: nur hochladen, falls hier
//     etwas geändert wurde.
//  4. Sonst Drive-Stand laden, migrieren und Eintrag für Eintrag zusammenführen
//     (zusammenfuehren.js). Bei Konflikten fragt die App nach – sie überschreibt nie still.
//  5. Ergebnis hier speichern und nach Drive hochladen, Backup anlegen, Basis merken.
// Ausgelöst wird er beim Start (nach der Anmeldung), kurz nach jedem Speichern, wenn das
// Gerät wieder online ist und wenn die App wieder in den Vordergrund kommt.

import * as db from '../db.js';
import { DATENMODELL_VERSION, migriereDaten } from '../migrationen.js';
import { geraet } from '../ui.js';
import * as drive from './drive.js';
import {
  gleicherStand, fuehreZusammen, loeseKonflikte, istFrischerStand, backupsZumLoeschen, standKurz,
} from './zusammenfuehren.js';

const VERZOEGERUNG = 4000; // ms nach dem letzten Speichern
const BASIS = 'syncBasis'; // meta: { dateiId, version, daten, zeit }
const ZU_LOESCHEN = 'belegeZumLoeschen'; // meta: [driveId, …]

/* ---------- Einstellungen (nur auf diesem Gerät) ---------- */

export const clientId = () => geraet.lies('drive-client-id') ?? '';
export const setzeClientId = (id) => geraet.schreib('drive-client-id', id.trim());
export const istEingerichtet = () => Boolean(clientId()) && geraet.lies('drive-aktiv') === '1';

/* ---------- Status (für die Anzeige oben rechts und in den Stammdaten) ---------- */

export const status = { zustand: 'aus', text: 'Drive nicht eingerichtet', letzter: null };

function setzeStatus(zustand, text) {
  Object.assign(status, { zustand, text });
  window.dispatchEvent(new CustomEvent('sync-status', { detail: { ...status } }));
}

/* ---------- Fragen an den Nutzer (die Oberfläche hängt sich hier ein) ---------- */

let fragen = {
  // ({ lokal, remote }) → 'drive' | 'zusammen' | null (abbrechen)
  erstesVerbinden: async () => null,
  // (konflikte, daten) → Map("sammlung|id" → 'lokal'|'remote') | null (später)
  konflikte: async () => null,
};
export const setzeFragen = (f) => { fragen = { ...fragen, ...f }; };

/* ---------- Anmelden / Trennen ---------- */

export async function verbinden() {
  await drive.anmelden(clientId());
  geraet.schreib('drive-aktiv', '1');
  await gleicheAb();
}

export async function trennen() {
  drive.abmelden();
  geraet.schreib('drive-aktiv', '0');
  setzeStatus('aus', 'Drive getrennt – die Daten bleiben auf diesem Gerät');
}

/** Für den Knopf oben: angemeldet → abgleichen, sonst anmelden (aus einem Klick heraus) */
export async function jetzt() {
  if (!istEingerichtet()) return false;
  if (!drive.istAngemeldet()) await drive.anmelden(clientId(), { stumm: true });
  await gleicheAb();
  return true;
}

/* ---------- Der Abgleich ---------- */

let laeuft = null;
let nochmal = false;

export async function gleicheAb() {
  if (!istEingerichtet()) return setzeStatus('aus', 'Drive nicht eingerichtet');
  if (!navigator.onLine) return setzeStatus('offline', 'Offline – Änderungen werden später abgeglichen');
  if (!drive.istAngemeldet()) return setzeStatus('anmelden', 'Zum Abgleichen bei Google anmelden');
  if (laeuft) {
    nochmal = true;
    return laeuft;
  }
  laeuft = (async () => {
    try {
      do {
        nochmal = false;
        await einDurchlauf();
      } while (nochmal);
    } catch (err) {
      if (err instanceof drive.NichtAngemeldet) setzeStatus('anmelden', err.message);
      else if (err instanceof Abbruch) setzeStatus(err.zustand, err.message);
      else {
        console.error(err);
        setzeStatus('fehler', err.message ?? String(err));
      }
    } finally {
      laeuft = null;
    }
  })();
  return laeuft;
}

class Abbruch extends Error {
  constructor(zustand, text) {
    super(text);
    this.zustand = zustand;
  }
}

async function einDurchlauf() {
  setzeStatus('laeuft', 'Gleiche mit Drive ab …');
  await belegeAbgleichen();

  const lokal = await db.leseDatenstand();
  const basis = await db.leseMeta(BASIS);
  const datei = await drive.datenDatei();

  // Noch keine Datei in Drive: diesen Stand hochladen
  if (!datei) {
    await hochladen(null, lokal);
    return fertig();
  }

  const unveraendert = basis && basis.dateiId === datei.id && basis.version === datei.version;
  if (unveraendert) {
    if (!gleicherStand(lokal, basis.daten)) await hochladen(datei, lokal);
    return fertig();
  }

  // Drive hat sich geändert (oder dieses Gerät gleicht zum ersten Mal ab)
  const remote = migriereDaten(await drive.ladeJson(datei.id)).daten; // wirft bei neuerer App-Version
  let ergebnis;
  if (!basis) {
    if (istFrischerStand(lokal) || gleicherStand(lokal, remote)) ergebnis = remote;
    else if (istFrischerStand(remote)) ergebnis = lokal;
    else {
      setzeStatus('konflikt', 'Bitte entscheiden: Drive-Stand übernehmen oder zusammenführen?');
      const wahl = await fragen.erstesVerbinden({ lokal: standKurz(lokal), remote: standKurz(remote) });
      if (!wahl) throw new Abbruch('konflikt', 'Abgleich offen – bitte oben auf das Wolken-Symbol tippen.');
      ergebnis = wahl === 'drive' ? remote : await zusammenfuehren(null, lokal, remote);
    }
  } else {
    ergebnis = await zusammenfuehren(basis.daten, lokal, remote);
  }
  ergebnis = { ...ergebnis, version: DATENMODELL_VERSION };

  // Hat sich hier während des Abgleichs etwas geändert? Dann lieber noch einmal von vorn.
  if (!gleicherStand(await db.leseDatenstand(), lokal)) {
    nochmal = true;
    return null;
  }
  if (!gleicherStand(ergebnis, lokal)) {
    // Hatte dieses Gerät noch nicht abgeglichene Änderungen, wird sein Stand vorher als Backup
    // gesichert – so ist auch eine bei einem Konflikt verworfene Fassung nicht verloren.
    if (!istFrischerStand(lokal) && !(basis && gleicherStand(lokal, basis.daten))) {
      await backup(JSON.stringify({ ...lokal, version: DATENMODELL_VERSION }), 'geraet');
    }
    await db.schreibeDatenstand(ergebnis); // löst kein "db-geaendert" aus → keine Schleife
    window.dispatchEvent(new Event('daten-geaendert'));
  }
  if (!gleicherStand(ergebnis, remote)) await hochladen(datei, ergebnis);
  else await db.schreibeMeta(BASIS, { dateiId: datei.id, version: datei.version, daten: ergebnis, zeit: new Date().toISOString() });
  return fertig();
}

async function zusammenfuehren(basis, lokal, remote) {
  const { daten, konflikte } = fuehreZusammen(basis, lokal, remote, DATENMODELL_VERSION);
  if (konflikte.length === 0) return daten;
  setzeStatus('konflikt', `${konflikte.length === 1 ? '1 Eintrag wurde' : `${konflikte.length} Einträge wurden`} auf beiden Geräten geändert – bitte entscheiden`);
  const entscheidungen = await fragen.konflikte(konflikte, lokal);
  if (!entscheidungen) throw new Abbruch('konflikt', 'Abgleich offen – bitte oben auf das Wolken-Symbol tippen.');
  return loeseKonflikte(daten, konflikte, entscheidungen);
}

function fertig() {
  status.letzter = new Date().toISOString();
  geraet.schreib('drive-letzter-abgleich', status.letzter);
  setzeStatus('ok', 'Mit Drive abgeglichen');
}

/** Stand nach Drive schreiben (datei = null: neu anlegen), Basis merken, Backup anlegen */
async function hochladen(datei, daten) {
  // Kurz vorher prüfen, ob ein anderes Gerät gerade hochgeladen hat
  if (datei) {
    const aktuell = await drive.metadaten(datei.id);
    if (aktuell.version !== datei.version) {
      nochmal = true; // erst den neuen Drive-Stand zusammenführen
      return;
    }
  }
  const { haupt } = await drive.ordner();
  const text = JSON.stringify({ ...daten, version: DATENMODELL_VERSION });
  const neu = await drive.speichereDatei({
    id: datei?.id ?? null, name: 'finanzapp-daten.json', mimeType: 'application/json', inhalt: text, art: 'daten', elternId: haupt,
  });
  await db.schreibeMeta(BASIS, { dateiId: neu.id, version: neu.version, daten, zeit: new Date().toISOString() });
  await backup(text);
}

/* ---------- Backups (D61) ---------- */

async function backup(text, zusatz = '') {
  const { backups } = await drive.ordner();
  const zeit = new Date().toISOString();
  await drive.speichereDatei({
    name: `backup-${zeit.slice(0, 19).replace(/:/g, '-')}${zusatz ? `-${zusatz}` : ''}.json`, mimeType: 'application/json', inhalt: text, art: 'backup', elternId: backups,
  });
  const liste = (await drive.backupListe()).map((b) => ({ id: b.id, zeit: b.modifiedTime }));
  for (const alt of backupsZumLoeschen(liste)) await drive.inPapierkorb(alt.id);
}

/** Backups für die Stammdaten: neueste zuerst [{ id, zeit, groesse }] */
export async function backups() {
  return (await drive.backupListe())
    .map((b) => ({ id: b.id, zeit: b.modifiedTime, groesse: Number(b.size ?? 0) }))
    .sort((a, b) => b.zeit.localeCompare(a.zeit));
}

/**
 * Backup wiederherstellen: ersetzt den Stand auf diesem Gerät UND in Drive.
 * Der bisherige Stand wird vorher selbst als Backup gesichert.
 */
export async function wiederherstellen(backupId) {
  const alt = await db.leseDatenstand();
  await backup(JSON.stringify({ ...alt, version: DATENMODELL_VERSION }), 'vor-wiederherstellung');
  const daten = { ...migriereDaten(await drive.ladeJson(backupId)).daten, version: DATENMODELL_VERSION };
  await db.schreibeDatenstand(daten);
  const datei = await drive.datenDatei();
  const { haupt } = await drive.ordner();
  const neu = await drive.speichereDatei({
    id: datei?.id ?? null, name: 'finanzapp-daten.json', mimeType: 'application/json', inhalt: JSON.stringify(daten), art: 'daten', elternId: haupt,
  });
  await db.schreibeMeta(BASIS, { dateiId: neu.id, version: neu.version, daten, zeit: new Date().toISOString() });
  window.dispatchEvent(new Event('daten-geaendert'));
  fertig();
}

/* ---------- Belege (D62) ---------- */

/** Belege, die noch nur auf diesem Gerät liegen, nach Drive hochladen; Löschungen nachholen */
async function belegeAbgleichen() {
  const zuLoeschen = (await db.leseMeta(ZU_LOESCHEN)) ?? [];
  for (const id of zuLoeschen) {
    try { await drive.inPapierkorb(id); } catch (err) { if (!String(err.message).includes('404')) throw err; }
  }
  if (zuLoeschen.length) await db.schreibeMeta(ZU_LOESCHEN, []);

  const buchungen = await db.alle('buchungen');
  const offen = buchungen.filter((b) => (b.belege ?? []).some((x) => !x.driveId));
  if (!offen.length) return;
  const { belege: ordnerId } = await drive.ordner();
  for (const b of offen) {
    const belege = [];
    for (const x of b.belege) {
      if (x.driveId) { belege.push(x); continue; }
      const datei = await db.hole('belegDateien', x.id);
      if (!datei) { belege.push(x); continue; } // Datei liegt auf einem anderen Gerät
      const neu = await drive.speichereDatei({ name: x.name, mimeType: x.mime, inhalt: datei.blob, art: 'beleg', elternId: ordnerId });
      belege.push({ ...x, driveId: neu.id });
    }
    // Drive-Kennungen in die AKTUELLE Fassung der Buchung eintragen (sie kann sich während des
    // Hochladens geändert haben; ein inzwischen entfernter Beleg kommt in den Drive-Papierkorb)
    const hochgeladen = new Map(belege.filter((x) => x.driveId).map((x) => [x.id, x.driveId]));
    const aktuell = await db.hole('buchungen', b.id);
    const nochDa = new Set((aktuell?.belege ?? []).map((x) => x.id));
    for (const [belegId, driveId] of hochgeladen) {
      if (!nochDa.has(belegId) && !b.belege.find((x) => x.id === belegId)?.driveId) await drive.inPapierkorb(driveId);
    }
    if (aktuell) {
      await db.speichere('buchungen', {
        ...aktuell,
        belege: aktuell.belege.map((x) => (x.driveId || !hochgeladen.has(x.id) ? x : { ...x, driveId: hochgeladen.get(x.id) })),
        geaendertAm: new Date().toISOString(),
      });
    }
  }
  // Ansicht neu zeichnen, damit Listen die Drive-Kennungen kennen
  window.dispatchEvent(new Event('daten-geaendert'));
}

/** Beleg aus Drive löschen (in den Papierkorb), sobald möglich */
export async function belegSpaeterLoeschen(driveId) {
  if (!driveId) return;
  const liste = (await db.leseMeta(ZU_LOESCHEN)) ?? [];
  await db.schreibeMeta(ZU_LOESCHEN, [...liste, driveId]);
}

/** Belegdatei holen: aus dem Zwischenspeicher oder aus Drive (dann zwischenspeichern) */
export async function belegDatei(beleg) {
  const lokal = await db.hole('belegDateien', beleg.id);
  if (lokal) return lokal.blob;
  if (!beleg.driveId) throw new Error('Dieser Beleg liegt noch auf einem anderen Gerät und ist noch nicht hochgeladen.');
  if (!drive.istAngemeldet()) {
    if (!istEingerichtet()) throw new Error('Zum Anzeigen bitte unter Stammdaten mit Google Drive verbinden.');
    await drive.anmelden(clientId(), { stumm: true });
  }
  const blob = await drive.ladeDatei(beleg.driveId);
  await db.speichere('belegDateien', { id: beleg.id, blob, name: beleg.name, mime: beleg.mime });
  return blob;
}

/* ---------- Automatik ---------- */

let timer = null;
let letzterVordergrund = 0;

export function starteAutomatik() {
  status.letzter = geraet.lies('drive-letzter-abgleich');
  if (!istEingerichtet()) setzeStatus('aus', 'Drive nicht eingerichtet');
  else setzeStatus('anmelden', 'Zum Abgleichen bei Google anmelden');

  // Jede Änderung an den Nutzdaten (db.speichere/db.loesche) → kurz danach abgleichen
  window.addEventListener('db-geaendert', () => {
    if (!istEingerichtet()) return;
    clearTimeout(timer);
    timer = setTimeout(() => gleicheAb(), VERZOEGERUNG);
  });
  window.addEventListener('online', () => gleicheAb());
  window.addEventListener('offline', () => istEingerichtet() && setzeStatus('offline', 'Offline – Änderungen werden später abgeglichen'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || Date.now() - letzterVordergrund < 60000) return;
    letzterVordergrund = Date.now();
    if (drive.istAngemeldet()) gleicheAb();
  });
}
