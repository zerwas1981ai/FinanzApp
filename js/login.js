// App-Login (D83): ein Passwort für alle Geräte, Pflicht – ersetzt die PIN je Gerät aus D67.
// Reine Funktionen ohne Datenbank – mit `npm test` geprüft.
//
// Gespeichert wird NIE das Passwort, nur ein Prüfwert (PBKDF2-SHA-256 mit Salz). Er liegt als
// Eintrag in der abgeglichenen Sammlung "einstellungen" und kommt so über Google Drive auf alle Geräte:
//   { id: 'login', passwort: { salz, hash, runden }, erstelltAm, geaendertAm }
// Wichtig: Der Login ist ein Zugangsschutz der Oberfläche. Die Daten im Browser werden nicht verschlüsselt.

export const LOGIN_ID = 'login';
export const MIN_LAENGE = 8;
const RUNDEN = 210000;

const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const ausB64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/** Passwort prüfen: mindestens 8 Zeichen, beliebige Zeichen */
export function pruefePasswort(passwort) {
  const p = passwort ?? '';
  if (p.length < MIN_LAENGE) throw new Error(`Das Passwort muss mindestens ${MIN_LAENGE} Zeichen lang sein.`);
  if (p.length > 200) throw new Error('Das Passwort darf höchstens 200 Zeichen lang sein.');
  if (p.trim() !== p) throw new Error('Das Passwort darf nicht mit einem Leerzeichen beginnen oder enden.');
}

export async function hashe(passwort, salz, runden = RUNDEN) {
  const schluessel = await crypto.subtle.importKey('raw', new TextEncoder().encode(passwort), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salz, iterations: runden }, schluessel, 256);
  return b64(bits);
}

/** Login-Eintrag mit neuem Passwort bauen (alt: bisheriger Eintrag, falls vorhanden) */
export async function baueLogin(passwort, { alt = null, jetzt = new Date().toISOString() } = {}) {
  pruefePasswort(passwort);
  const salz = crypto.getRandomValues(new Uint8Array(16));
  return {
    id: LOGIN_ID,
    passwort: { salz: b64(salz), hash: await hashe(passwort, salz), runden: RUNDEN },
    erstelltAm: alt?.erstelltAm ?? jetzt,
    geaendertAm: jetzt,
  };
}

/** Stimmt das Passwort zu diesem Login-Eintrag? */
export async function passwortStimmt(passwort, login) {
  if (!login?.passwort) return false;
  const { salz, hash, runden } = login.passwort;
  return (await hashe(passwort ?? '', ausB64(salz), runden)) === hash;
}

/** Login-Eintrag aus einem Datenstand (z. B. der Drive-Datei) holen – oder null */
export const loginAusStand = (daten) => (daten?.einstellungen ?? []).find((e) => e.id === LOGIN_ID && e.passwort) ?? null;
