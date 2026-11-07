// App-Login (D83, ersetzt die PIN-Sperre aus D67): Passwort für alle Geräte + Passkey je Gerät.
//
// - Das Passwort (genauer: sein Prüfwert) liegt in der Sammlung "einstellungen" (Eintrag "login")
//   und wird mit Google Drive abgeglichen → gilt auf allen Geräten. Siehe js/login.js.
// - Nur auf diesem Gerät (meta "sperre", wird nicht abgeglichen):
//   { minuten, credentialId (Base64) | null } – Sperrzeit und Passkey dieses Geräts.
// Wichtig: Der Login ist ein Zugangsschutz. Er verschlüsselt die Daten im Browser nicht.

import * as db from './db.js';
import { LOGIN_ID, baueLogin, passwortStimmt as stimmt } from './login.js';

const SCHLUESSEL = 'sperre';
export const STANDARD_MINUTEN = 5;

const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const ausB64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const zufall = (n) => crypto.getRandomValues(new Uint8Array(n));

/** Einstellungen dieses Geräts: { minuten, credentialId } */
export async function leseSperre() {
  const s = (await db.leseMeta(SCHLUESSEL)) ?? {};
  return { minuten: s.minuten ?? STANDARD_MINUTEN, credentialId: s.credentialId ?? null };
}
const schreibe = async (aenderung) => db.schreibeMeta(SCHLUESSEL, { ...(await leseSperre()), ...aenderung });

/** Der gemeinsame Login-Eintrag (oder null, wenn noch kein Passwort festgelegt ist) */
export const leseLogin = async () => {
  const login = await db.hole('einstellungen', LOGIN_ID);
  return login?.passwort ? login : null;
};
export const istEingerichtet = async () => Boolean(await leseLogin());

/** Passwort festlegen oder ändern – gilt nach dem nächsten Abgleich auf allen Geräten */
export async function setzePasswort(passwort) {
  await db.speichere('einstellungen', await baueLogin(passwort, { alt: await leseLogin() }));
}

/** Einen Login-Eintrag übernehmen (z. B. aus Google Drive) */
export const uebernimmLogin = (login) => db.speichere('einstellungen', login);

export const passwortStimmt = async (passwort) => stimmt(passwort, await leseLogin());

export const setzeMinuten = (minuten) => schreibe({ minuten });

/* ---------- Passkey: Fingerabdruck / Gesicht / Windows Hello (WebAuthn) ---------- */

/** Gibt es auf diesem Gerät eine eingebaute Entsperrung (Fingerabdruck, Gesicht, Windows Hello)? */
export async function passkeyMoeglich() {
  try {
    return Boolean(window.PublicKeyCredential
      && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch {
    return false;
  }
}

/** Passkey für dieses Gerät anlegen (nur für diese App/Adresse) */
export async function passkeyEinrichten() {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: zufall(32),
      rp: { name: 'Finanzen' },
      user: { id: zufall(16), name: 'Finanzen', displayName: 'Finanzen' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      timeout: 60000,
      attestation: 'none',
    },
  });
  if (!cred) throw new Error('Der Passkey wurde nicht eingerichtet.');
  await schreibe({ credentialId: b64(cred.rawId) });
}

export const passkeyEntfernen = () => schreibe({ credentialId: null });

/**
 * Mit dem Passkey dieses Geräts anmelden. Das Gerät prüft den Nutzer
 * (userVerification "required") – kommt eine Antwort zurück, ist er bestätigt.
 */
export async function mitPasskeyAnmelden() {
  const s = await leseSperre();
  if (!s.credentialId) return false;
  const antwort = await navigator.credentials.get({
    publicKey: {
      challenge: zufall(32),
      allowCredentials: [{ type: 'public-key', id: ausB64(s.credentialId) }],
      userVerification: 'required',
      timeout: 60000,
    },
  });
  return Boolean(antwort);
}

/* ---------- Fehlversuche ---------- */

let fehlversuche = 0;
let gesperrtBis = 0;

/** Nach 5 falschen Passwörtern wartet die App 30 s, danach jeweils doppelt so lange */
export function versuchErlaubt() {
  return Date.now() >= gesperrtBis ? 0 : Math.ceil((gesperrtBis - Date.now()) / 1000);
}
export function merkeVersuch(richtig) {
  if (richtig) {
    fehlversuche = 0;
    return;
  }
  fehlversuche += 1;
  if (fehlversuche >= 5) gesperrtBis = Date.now() + 30000 * 2 ** (fehlversuche - 5);
}
