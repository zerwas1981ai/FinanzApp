// Etappe 6: Zugriff auf Google Drive (Anmeldung + Dateien). Siehe DECISIONS.md D60–D62.
//
// - Anmeldung mit "Google Identity Services" (Token-Verfahren für Web-Apps, ohne Server und
//   ohne Geheimnis). Die Client-ID gibt der Nutzer in den Stammdaten ein; sie steht nicht im Code.
// - Berechtigung "drive.file": Die App sieht in Drive NUR Dateien, die sie selbst angelegt hat.
// - Das Zugangs-Token gilt etwa eine Stunde und liegt nur im Arbeitsspeicher (nie gespeichert).
//
// Ablage in Drive:
//   Finanzapp/                      (Ordner)
//     finanzapp-daten.json          (der Datenstand)
//     Belege/                       (Fotos und PDFs)
//     Backups/                      (backup-JJJJ-MM-TTTHH-MM-SS.json)

const GSI_URL = 'https://accounts.google.com/gsi/client';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const MARKE = 'finanzapp'; // appProperties-Schlüssel, damit die App ihre Dateien wiederfindet

let token = null; // { wert, ablauf }
let tokenClient = null;
let tokenClientId = null;

/* ---------- Anmeldung ---------- */

function ladeGsi() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GSI_URL;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Die Google-Anmeldung konnte nicht geladen werden. Besteht eine Internetverbindung?'));
    document.head.append(s);
  });
}

export const istAngemeldet = () => Boolean(token && token.ablauf > Date.now() + 60000);

/**
 * Anmelden bzw. Token erneuern. Muss beim ersten Mal aus einem Klick heraus aufgerufen werden
 * (sonst blockiert der Browser das Google-Fenster).
 */
export async function anmelden(clientId, { stumm = false } = {}) {
  if (!clientId) throw new Error('Bitte zuerst unter Stammdaten → Google Drive die Client-ID eintragen.');
  await ladeGsi();
  if (!tokenClient || tokenClientId !== clientId) {
    tokenClientId = clientId;
    tokenClient = window.google.accounts.oauth2.initTokenClient({ client_id: clientId, scope: SCOPE, callback: () => {} });
  }
  return new Promise((resolve, reject) => {
    tokenClient.callback = (antwort) => {
      if (antwort.error) {
        reject(new Error(`Google-Anmeldung fehlgeschlagen (${antwort.error}).`));
        return;
      }
      if (!window.google.accounts.oauth2.hasGrantedAllScopes(antwort, SCOPE)) {
        reject(new Error('Der Zugriff auf Google Drive wurde nicht erlaubt.'));
        return;
      }
      token = { wert: antwort.access_token, ablauf: Date.now() + Number(antwort.expires_in ?? 3600) * 1000 };
      resolve();
    };
    tokenClient.error_callback = (fehler) => reject(new Error(fehler?.type === 'popup_closed'
      ? 'Die Anmeldung wurde abgebrochen.'
      : 'Das Google-Anmeldefenster wurde blockiert oder geschlossen.'));
    tokenClient.requestAccessToken({ prompt: stumm ? '' : undefined });
  });
}

export function abmelden() {
  if (token && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(token.wert, () => {});
  token = null;
  ordnerCache = null;
}

/* ---------- Anfragen ---------- */

export class NichtAngemeldet extends Error {}

async function anfrage(url, optionen = {}) {
  if (!istAngemeldet()) throw new NichtAngemeldet('Bitte bei Google anmelden.');
  const antwort = await fetch(url, {
    ...optionen,
    headers: { Authorization: `Bearer ${token.wert}`, ...(optionen.headers ?? {}) },
  });
  if (antwort.status === 401) {
    token = null;
    throw new NichtAngemeldet('Die Google-Anmeldung ist abgelaufen. Bitte neu anmelden.');
  }
  if (!antwort.ok) {
    let text = '';
    try { text = (await antwort.json())?.error?.message ?? ''; } catch { /* kein JSON */ }
    throw new Error(`Google Drive meldet einen Fehler (${antwort.status}${text ? `: ${text}` : ''}).`);
  }
  return antwort;
}

const json = async (url, optionen) => (await anfrage(url, optionen)).json();
const q = (bedingung) => encodeURIComponent(bedingung);

/** Dateien suchen, die die App selbst markiert hat */
async function suche(art, elternId = null) {
  let bedingung = `appProperties has { key='${MARKE}' and value='${art}' } and trashed=false`;
  if (elternId) bedingung += ` and '${elternId}' in parents`;
  const felder = 'files(id,name,version,modifiedTime,size,mimeType,appProperties)';
  const ergebnis = [];
  let seite = '';
  do {
    const r = await json(`${API}/files?q=${q(bedingung)}&fields=nextPageToken,${felder}&pageSize=200&spaces=drive${seite ? `&pageToken=${seite}` : ''}`);
    ergebnis.push(...r.files);
    seite = r.nextPageToken ?? '';
  } while (seite);
  return ergebnis;
}

async function neuerOrdner(name, art, elternId = null) {
  return json(`${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name, mimeType: 'application/vnd.google-apps.folder', appProperties: { [MARKE]: art },
      ...(elternId ? { parents: [elternId] } : {}),
    }),
  });
}

let ordnerCache = null;

/** Ordner "Finanzapp", "Belege", "Backups" finden oder anlegen */
export async function ordner() {
  if (ordnerCache) return ordnerCache;
  const haupt = (await suche('ordner'))[0] ?? await neuerOrdner('Finanzapp', 'ordner');
  const belege = (await suche('belege-ordner', haupt.id))[0] ?? await neuerOrdner('Belege', 'belege-ordner', haupt.id);
  const backups = (await suche('backup-ordner', haupt.id))[0] ?? await neuerOrdner('Backups', 'backup-ordner', haupt.id);
  ordnerCache = { haupt: haupt.id, belege: belege.id, backups: backups.id };
  return ordnerCache;
}

/** Die Datendatei (oder null): { id, version, modifiedTime } */
export async function datenDatei() {
  const { haupt } = await ordner();
  const dateien = await suche('daten', haupt);
  // Sollte es je zwei geben, gilt die zuletzt geänderte
  return dateien.sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime))[0] ?? null;
}

export async function metadaten(id) {
  return json(`${API}/files/${id}?fields=id,name,version,modifiedTime,size,mimeType`);
}

export async function ladeJson(id) {
  return (await anfrage(`${API}/files/${id}?alt=media`)).json();
}

export async function ladeDatei(id) {
  return (await anfrage(`${API}/files/${id}?alt=media`)).blob();
}

/**
 * Datei anlegen (id = null) oder Inhalt ersetzen. inhalt: Blob oder Text.
 * Gibt { id, version, modifiedTime } zurück.
 */
export async function speichereDatei({ id = null, name, mimeType, inhalt, art, elternId }) {
  const meta = id ? {} : { name, mimeType, appProperties: { [MARKE]: art }, parents: [elternId] };
  const grenze = `finanzapp-${crypto.randomUUID()}`;
  const daten = inhalt instanceof Blob ? inhalt : new Blob([inhalt], { type: mimeType });
  const body = new Blob([
    `--${grenze}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
    `--${grenze}\r\nContent-Type: ${mimeType}\r\n\r\n`, daten, `\r\n--${grenze}--`,
  ]);
  const url = `${UPLOAD}/files${id ? `/${id}` : ''}?uploadType=multipart&fields=id,version,modifiedTime`;
  return json(url, { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${grenze}` }, body });
}

/** In den Drive-Papierkorb legen (nicht endgültig löschen – dort 30 Tage wiederherstellbar) */
export async function inPapierkorb(id) {
  await anfrage(`${API}/files/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }),
  });
}

/** Alle (nicht gelöschten) Dateien einer Art, egal in welchem Ordner */
export const dateienVon = (art) => suche(art);

/** Datei ENDGÜLTIG löschen (nicht in den Papierkorb) – nur für "Alles löschen und neu beginnen" */
export async function endgueltigLoeschen(id) {
  await anfrage(`${API}/files/${id}`, { method: 'DELETE' });
}

export async function backupListe() {
  const { backups } = await ordner();
  return suche('backup', backups);
}
