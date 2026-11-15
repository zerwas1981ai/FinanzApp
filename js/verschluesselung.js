// D212: Sicherungsdatei mit Passwort verschlüsseln – nur Bordmittel des Browsers (Web Crypto):
// Aus dem Passwort wird mit PBKDF2 (SHA-256, viele Durchläufe, zufälliges Salz) ein Schlüssel abgeleitet,
// damit wird der Datenstand mit AES-GCM verschlüsselt. Das Passwort wird nirgends gespeichert.
// Ohne Passwort lässt sich die Datei nicht mehr öffnen – auch nicht von der App.

export const FORMAT = 'finanzapp-verschluesselt';
const DURCHLAEUFE = 310000;
const crypto = globalThis.crypto;

const zuBase64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const ausBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function schluessel(passwort, salz, durchlaeufe) {
  const roh = await crypto.subtle.importKey('raw', new TextEncoder().encode(passwort), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salz, iterations: durchlaeufe },
    roh, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

/** Passwort-Regel für Sicherungsdateien */
export function pruefePasswort(passwort, wiederholung) {
  if (String(passwort ?? '').length < 8) throw new Error('Das Passwort braucht mindestens 8 Zeichen.');
  if (passwort !== wiederholung) throw new Error('Die beiden Passwörter stimmen nicht überein.');
}

/** Text verschlüsseln → Objekt, das als JSON-Datei gespeichert wird */
export async function verschluesseln(text, passwort, { durchlaeufe = DURCHLAEUFE } = {}) {
  const salz = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await schluessel(passwort, salz, durchlaeufe);
  const daten = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)));
  return { format: FORMAT, version: 1, verfahren: 'PBKDF2-SHA256/AES-GCM-256', durchlaeufe, salz: zuBase64(salz), iv: zuBase64(iv), daten: zuBase64(daten) };
}

/** Ist das eingelesene JSON eine verschlüsselte Sicherung? */
export const istVerschluesselt = (roh) => Boolean(roh && roh.format === FORMAT && roh.daten && roh.salz && roh.iv);

/** Entschlüsseln; falsches Passwort → Fehler mit verständlichem Text */
export async function entschluesseln(roh, passwort) {
  const key = await schluessel(passwort, ausBase64(roh.salz), roh.durchlaeufe ?? DURCHLAEUFE);
  try {
    const klar = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ausBase64(roh.iv) }, key, ausBase64(roh.daten));
    return new TextDecoder().decode(klar);
  } catch {
    throw new Error('Das Passwort passt nicht zu dieser Datei.');
  }
}
