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
import { kopienAufgaben } from '../relevant.js';
import { geraet } from '../ui.js';
import * as drive from './drive.js';
import { archiviere, holeZurueck } from '../archiv.js';
import {
  gleicherStand, fuehreZusammen, loeseKonflikte, istFrischerStand, backupsZumLoeschen, standKurz, anzahlUnterschiede,
} from './zusammenfuehren.js';

const VERZOEGERUNG = 4000; // ms nach dem letzten Speichern
const BASIS = 'syncBasis'; // meta: { dateiId, version, daten, zeit }
const ZU_LOESCHEN = 'belegeZumLoeschen'; // meta: [driveId, …]
const NEUSTART = 'neustartId'; // meta: Kennung des letzten "Alles löschen und neu beginnen" (D66)

/* ---------- Einstellungen (nur auf diesem Gerät) ---------- */

export const clientId = () => geraet.lies('drive-client-id') ?? '';
export const setzeClientId = (id) => geraet.schreib('drive-client-id', id.trim());
export const istEingerichtet = () => Boolean(clientId()) && geraet.lies('drive-aktiv') === '1';

/* ---------- Status (für die Anzeige oben rechts und in den Stammdaten) ---------- */

// offen = Anzahl der Einträge, die auf diesem Gerät geändert, aber noch nicht in Drive sind (D70)
export const status = { zustand: 'aus', text: 'Drive nicht eingerichtet', letzter: null, offen: 0 };

function setzeStatus(zustand, text) {
  Object.assign(status, { zustand, text });
  window.dispatchEvent(new CustomEvent('sync-status', { detail: { ...status } }));
}

/** Noch nicht hochgeladene Änderungen zählen (Vergleich mit dem Stand beim letzten Abgleich) */
async function zaehleOffene() {
  if (!istEingerichtet()) return;
  const basis = await db.leseMeta(BASIS);
  const offen = basis ? anzahlUnterschiede(basis.daten, await db.leseDatenstand()) : 0;
  if (offen === status.offen) return;
  status.offen = offen;
  window.dispatchEvent(new CustomEvent('sync-status', { detail: { ...status } }));
}

/* ---------- Fragen an den Nutzer (die Oberfläche hängt sich hier ein) ---------- */

let fragen = {
  // ({ lokal, remote }) → 'drive' | 'zusammen' | null (abbrechen)
  erstesVerbinden: async () => null,
  // (konflikte, daten) → Map("sammlung|id" → 'lokal'|'remote') | null (später)
  konflikte: async () => null,
  // () → true (dieses Gerät auch leeren) | null (später)
  neustart: async () => null,
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
  // Nicht hinter dem Anmeldebildschirm abgleichen (D83): Rückfragen würden sonst Buchungsdaten zeigen.
  // Nach dem Anmelden holt das Ereignis "entsperrt" den Abgleich nach.
  if (typeof document !== 'undefined' && document.body.classList.contains('gesperrt')) return null;
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
  const remoteRoh = await drive.ladeJson(datei.id);
  // Wurde auf einem anderen Gerät "Alles löschen und neu beginnen" gewählt? (D66)
  if (basis && (remoteRoh.neustartId ?? null) !== (basis.neustartId ?? null)) {
    await neustartUebernehmen(remoteRoh, datei);
    return fertig();
  }
  if (!basis) await db.schreibeMeta(NEUSTART, remoteRoh.neustartId ?? null);
  const remote = migriereDaten(remoteRoh).daten; // wirft bei neuerer App-Version
  let ergebnis;
  if (!basis) {
    if (istFrischerStand(lokal) || gleicherStand(lokal, remote)) ergebnis = remote;
    // Leerer Drive-Stand: lokal übernehmen – außer er ist leer, weil bewusst neu begonnen wurde
    else if (istFrischerStand(remote) && !remoteRoh.neustartId) ergebnis = lokal;
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
  else await merkeBasis(datei.id, datei.version, ergebnis);
  return fertig();
}

/** Basis merken – mit der Neustart-Kennung, die dieses Gerät gerade kennt */
async function merkeBasis(dateiId, version, daten) {
  await db.schreibeMeta(BASIS, { dateiId, version, daten, neustartId: (await db.leseMeta(NEUSTART)) ?? null, zeit: new Date().toISOString() });
}

/** Ein anderes Gerät hat neu begonnen: nach Rückfrage dieses Gerät ebenfalls leeren */
async function neustartUebernehmen(remoteRoh, datei) {
  setzeStatus('konflikt', 'Auf einem anderen Gerät wurde neu begonnen – bitte bestätigen');
  const ok = await fragen.neustart();
  if (!ok) throw new Abbruch('konflikt', 'Neubeginn auf einem anderen Gerät – bitte oben auf das Wolken-Symbol tippen.');
  const daten = { ...migriereDaten(remoteRoh).daten, version: DATENMODELL_VERSION };
  await db.schreibeDatenstand(daten);
  await db.leere('belegDateien');
  await db.schreibeMeta(ZU_LOESCHEN, []);
  await db.schreibeMeta(NEUSTART, remoteRoh.neustartId ?? null);
  await merkeBasis(datei.id, datei.version, daten);
  window.dispatchEvent(new Event('daten-geaendert'));
}

/**
 * "Alles löschen und neu beginnen" (D66): Auf diesem Gerät bleibt nur der Kategorie-Startsatz.
 * Ist Drive verbunden, werden dort Belege, Backups und Archive ENDGÜLTIG gelöscht und die
 * Datendatei mit dem leeren Stand und einer neuen Neustart-Kennung überschrieben. Andere Geräte
 * erkennen die Kennung beim nächsten Abgleich und leeren sich nach Rückfrage ebenfalls.
 */
export async function allesNeuBeginnen() {
  const mitDrive = istEingerichtet();
  if (mitDrive) {
    if (!navigator.onLine) throw new Error('Bitte mit dem Internet verbinden – die Daten in Google Drive werden ebenfalls gelöscht.');
    if (!drive.istAngemeldet()) await drive.anmelden(clientId(), { stumm: true });
  }
  if (laeuft) await laeuft;
  let fertigMeldung;
  laeuft = (async () => {
    setzeStatus('laeuft', 'Lösche alle Daten …');
    if (mitDrive) {
      for (const art of ['beleg', 'backup', 'archiv']) {
        for (const f of await drive.dateienVon(art)) await drive.endgueltigLoeschen(f.id);
      }
    }
    const neu = db.leererStand();
    // Das App-Passwort (D83) bleibt beim Neubeginn erhalten – sonst wäre die App danach ohne Login
    const login = await db.hole('einstellungen', 'login');
    if (login) neu.einstellungen.push(login);
    const neustartId = crypto.randomUUID();
    await db.schreibeDatenstand(neu);
    await db.leere('belegDateien');
    await db.leere('archivDateien');
    await db.schreibeMeta(ZU_LOESCHEN, []);
    await db.schreibeMeta(NEUSTART, neustartId);
    if (mitDrive) {
      const datei = await drive.datenDatei();
      const { haupt } = await drive.ordner();
      const gespeichert = await drive.speichereDatei({
        id: datei?.id ?? null, name: 'finanzapp-daten.json', mimeType: 'application/json',
        inhalt: JSON.stringify({ ...neu, neustartId }), art: 'daten', elternId: haupt,
      });
      await merkeBasis(gespeichert.id, gespeichert.version, neu);
      fertigMeldung = 'Alles gelöscht – auch in Google Drive';
    } else {
      await db.schreibeMeta(BASIS, null);
      fertigMeldung = 'Alles auf diesem Gerät gelöscht';
    }
  })();
  try {
    await laeuft;
  } finally {
    laeuft = null;
  }
  window.dispatchEvent(new Event('daten-geaendert'));
  if (mitDrive) fertig();
  return fertigMeldung;
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
  status.offen = 0;
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
  const text = JSON.stringify({ ...daten, version: DATENMODELL_VERSION, neustartId: (await db.leseMeta(NEUSTART)) ?? null });
  const neu = await drive.speichereDatei({
    id: datei?.id ?? null, name: 'finanzapp-daten.json', mimeType: 'application/json', inhalt: text, art: 'daten', elternId: haupt,
  });
  await merkeBasis(neu.id, neu.version, daten);
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
    id: datei?.id ?? null, name: 'finanzapp-daten.json', mimeType: 'application/json',
    inhalt: JSON.stringify({ ...daten, neustartId: (await db.leseMeta(NEUSTART)) ?? null }), art: 'daten', elternId: haupt,
  });
  await merkeBasis(neu.id, neu.version, daten);
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

  let geaendert = await belegeHochladen('buchungen', 'belege');
  // Relevante Ausgaben (D74): eigene Einträge in ihren eigenen Ordner, Kopien markierter Buchungen
  if (await belegeHochladen('relevant', 'relevant')) geaendert = true;
  if (await kopienAbgleichen()) geaendert = true;
  // Ansicht neu zeichnen, damit Listen die Drive-Kennungen kennen
  if (geaendert) window.dispatchEvent(new Event('daten-geaendert'));
}

/** Wartende Belege einer Sammlung in den Drive-Ordner hochladen. true = etwas geändert */
async function belegeHochladen(sammlung, ordnerSchluessel) {
  const eintraege = await db.alle(sammlung);
  const offen = eintraege.filter((b) => (b.belege ?? []).some((x) => !x.driveId));
  if (!offen.length) return false;
  const ordnerId = (await drive.ordner())[ordnerSchluessel];
  for (const b of offen) {
    const belege = [];
    for (const x of b.belege) {
      if (x.driveId) { belege.push(x); continue; }
      const datei = await db.hole('belegDateien', x.id);
      if (!datei) { belege.push(x); continue; } // Datei liegt auf einem anderen Gerät
      const neu = await drive.speichereDatei({ name: x.name, mimeType: x.mime, inhalt: datei.blob, art: 'beleg', elternId: ordnerId });
      belege.push({ ...x, driveId: neu.id });
    }
    // Drive-Kennungen in die AKTUELLE Fassung eintragen (sie kann sich während des
    // Hochladens geändert haben; ein inzwischen entfernter Beleg kommt in den Drive-Papierkorb)
    const hochgeladen = new Map(belege.filter((x) => x.driveId).map((x) => [x.id, x.driveId]));
    const aktuell = await db.hole(sammlung, b.id);
    const nochDa = new Set((aktuell?.belege ?? []).map((x) => x.id));
    for (const [belegId, driveId] of hochgeladen) {
      if (!nochDa.has(belegId) && !b.belege.find((x) => x.id === belegId)?.driveId) await drive.inPapierkorb(driveId);
    }
    if (aktuell) {
      await db.speichere(sammlung, {
        ...aktuell,
        belege: aktuell.belege.map((x) => (x.driveId || !hochgeladen.has(x.id) ? x : { ...x, driveId: hochgeladen.get(x.id) })),
        geaendertAm: new Date().toISOString(),
      });
    }
  }
  return true;
}

/**
 * Belege markierter Buchungen (Häkchen "Relevante Ausgabe") zusätzlich in den Ordner
 * "Relevante Ausgaben" kopieren; ohne Häkchen (oder im Papierkorb) kommt die Kopie in den
 * Drive-Papierkorb. Das Original im Ordner "Belege" bleibt immer, wo es ist. true = etwas geändert
 */
async function kopienAbgleichen() {
  const aufgaben = (await db.alle('buchungen'))
    .map((b) => ({ b, ...kopienAufgaben(b) }))
    .filter((a) => a.kopieren.length || a.entfernen.length);
  if (!aufgaben.length) return false;
  const { relevant: ordnerId } = await drive.ordner();
  const fehlt = (err) => String(err.message).includes('404');
  for (const { b, kopieren, entfernen } of aufgaben) {
    const neu = new Map(); // Beleg-ID → Kennung der Kopie (null = entfernt)
    for (const x of kopieren) {
      try {
        neu.set(x.id, (await drive.kopiere(x.driveId, { name: x.name, elternId: ordnerId, art: 'beleg' })).id);
      } catch (err) {
        if (!fehlt(err)) throw err; // Original gibt es nicht mehr: nichts zu kopieren
      }
    }
    for (const x of entfernen) {
      try { await drive.inPapierkorb(x.relevantDriveId); } catch (err) { if (!fehlt(err)) throw err; }
      neu.set(x.id, null);
    }
    const aktuell = await db.hole('buchungen', b.id);
    if (!aktuell) {
      for (const id of neu.values()) if (id) await drive.inPapierkorb(id);
      continue;
    }
    await db.speichere('buchungen', {
      ...aktuell,
      belege: (aktuell.belege ?? []).map((x) => (neu.has(x.id) ? { ...x, relevantDriveId: neu.get(x.id) } : x)),
      geaendertAm: new Date().toISOString(),
    });
  }
  return true;
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
let zaehlTimer = null;
let letzterVordergrund = 0;
let erneuernAus = false; // nach Abbruch/Fehler erst beim nächsten Vordergrund wieder versuchen

/**
 * Anmeldung automatisch erneuern (D70): Google erlaubt das Anmeldefenster nur direkt nach einem
 * Antippen. Deshalb erneuert die App beim nächsten Antippen irgendwo in der App, wenn die
 * Anmeldung abgelaufen ist oder in den nächsten 10 Minuten abläuft. Weil die Zustimmung schon
 * erteilt ist, blitzt das Google-Fenster nur kurz auf.
 */
async function erneuereBeimAntippen() {
  if (erneuernAus || !istEingerichtet() || !navigator.onLine) return;
  if (drive.restMinuten() > 10) return;
  if (document.body.classList.contains('gesperrt')) return; // nicht über dem Sperrbildschirm
  try {
    await drive.anmelden(clientId(), { stumm: true });
    await gleicheAb();
  } catch (err) {
    erneuernAus = true;
    setzeStatus('anmelden', `${err.message ?? err} – zum Anmelden auf das Wolken-Symbol tippen`);
  }
}

export function starteAutomatik() {
  status.letzter = geraet.lies('drive-letzter-abgleich');
  if (!istEingerichtet()) setzeStatus('aus', 'Drive nicht eingerichtet');
  else {
    setzeStatus('anmelden', 'Zum Abgleichen bei Google anmelden');
    drive.vorladen();
    zaehleOffene();
  }

  // Jede Änderung an den Nutzdaten (db.speichere/db.loesche) → zählen und kurz danach abgleichen
  window.addEventListener('db-geaendert', () => {
    if (!istEingerichtet()) return;
    clearTimeout(zaehlTimer);
    zaehlTimer = setTimeout(zaehleOffene, 300);
    clearTimeout(timer);
    timer = setTimeout(() => gleicheAb(), VERZOEGERUNG);
  });
  window.addEventListener('online', () => gleicheAb());
  window.addEventListener('entsperrt', () => gleicheAb());
  window.addEventListener('offline', () => istEingerichtet() && setzeStatus('offline', 'Offline – Änderungen werden später abgeglichen'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    erneuernAus = false;
    if (Date.now() - letzterVordergrund < 60000) return;
    letzterVordergrund = Date.now();
    if (drive.istAngemeldet()) gleicheAb();
  });
  // "click" zählt für den Browser als Antippen, das ein Fenster öffnen darf
  document.addEventListener('click', () => { erneuereBeimAntippen(); }, true);
}

/* ---------- Archiv alter Jahre (D68) ---------- */

/** Für Archivieren und Zurückholen: Drive muss verbunden, online und abgeglichen sein */
async function vorbereitenFuerArchiv() {
  if (!istEingerichtet()) throw new Error('Das Archiv wird in Google Drive gespeichert. Bitte zuerst unter „Google Drive“ verbinden.');
  if (!navigator.onLine) throw new Error('Bitte mit dem Internet verbinden.');
  if (!drive.istAngemeldet()) await drive.anmelden(clientId(), { stumm: true });
  await gleicheAb();
  if (status.zustand !== 'ok') throw new Error(`Bitte zuerst den Abgleich abschließen: ${status.text}`);
  if (laeuft) await laeuft;
}

/** Unter der Sperre des Abgleichs etwas am Datenstand ändern, danach abgleichen */
async function exklusiv(arbeit) {
  laeuft = arbeit();
  try {
    await laeuft;
  } finally {
    laeuft = null;
  }
  window.dispatchEvent(new Event('daten-geaendert'));
  await gleicheAb();
}

/** Ein Jahr archivieren: Archivdatei in Drive anlegen, dann den Datenstand verkleinern */
export async function archiviereJahr(jahr) {
  await vorbereitenFuerArchiv();
  await exklusiv(async () => {
    setzeStatus('laeuft', `Archiviere ${jahr} …`);
    const daten = { ...(await db.leseDatenstand()), version: DATENMODELL_VERSION };
    const { daten: neu, inhalt, eintrag } = archiviere(daten, jahr);
    const { haupt } = await drive.ordner();
    const datei = await drive.speichereDatei({
      name: `finanzapp-archiv-${jahr}.json`, mimeType: 'application/json', inhalt: JSON.stringify(inhalt), art: 'archiv', elternId: haupt,
    });
    eintrag.driveId = datei.id; // eintrag steckt auch in neu.archive
    await db.speichere('archivDateien', { id: eintrag.id, inhalt });
    await db.schreibeDatenstand(neu);
  });
}

/** Das zuletzt archivierte Jahr zurückholen; die Archivdatei kommt in den Drive-Papierkorb */
export async function holeArchivZurueck(eintrag) {
  await vorbereitenFuerArchiv();
  const inhalt = await archivInhalt(eintrag);
  await exklusiv(async () => {
    setzeStatus('laeuft', `Hole ${eintrag.jahr} zurück …`);
    const daten = { ...(await db.leseDatenstand()), version: DATENMODELL_VERSION };
    await db.schreibeDatenstand(holeZurueck(daten, eintrag, inhalt));
    await db.loesche('archivDateien', eintrag.id);
    if (eintrag.driveId) await drive.inPapierkorb(eintrag.driveId);
  });
}

/**
 * Inhalt eines archivierten Jahres: aus dem Zwischenspeicher oder aus Drive.
 * Ohne Anmeldung bei Google gibt es null zurück – außer anmelden ist true (nur aus einem Klick
 * heraus, weil sich dann das Google-Fenster öffnen kann).
 */
export async function archivInhalt(eintrag, { anmelden = true } = {}) {
  const lokal = await db.hole('archivDateien', eintrag.id);
  if (lokal) return lokal.inhalt;
  if (!eintrag.driveId) throw new Error('Die Archivdatei ist noch nicht in Google Drive angekommen.');
  if (!istEingerichtet()) throw new Error('Zum Laden des Archivs bitte unter Stammdaten mit Google Drive verbinden.');
  if (!drive.istAngemeldet()) {
    if (!anmelden) return null;
    await drive.anmelden(clientId(), { stumm: true });
  }
  const inhalt = await drive.ladeJson(eintrag.driveId);
  await db.speichere('archivDateien', { id: eintrag.id, inhalt });
  return inhalt;
}

