// App-Sperre: PIN und – wenn vorhanden – Fingerabdruck/Gesicht bzw. Windows Hello.
// Siehe DECISIONS.md D67.
//
// Wichtig: Die Sperre ist ein Sichtschutz. Sie verschlüsselt die Daten im Browser nicht.
// Die Einstellungen liegen NUR auf diesem Gerät (meta "sperre", wird nicht abgeglichen):
//   { pin: { salz, hash, runden }, credentialId (Base64) | null, minuten }
// Die PIN selbst wird nie gespeichert, nur ein Hash (PBKDF2-SHA-256 mit Salz).

import * as db from './db.js';

const SCHLUESSEL = 'sperre';
const RUNDEN = 150000;
export const STANDARD_MINUTEN = 5;

const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const ausB64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const zufall = (n) => crypto.getRandomValues(new Uint8Array(n));

export const leseSperre = async () => (await db.leseMeta(SCHLUESSEL)) ?? null;
const schreibe = (wert) => db.schreibeMeta(SCHLUESSEL, wert);
export const istAktiv = async () => Boolean((await leseSperre())?.pin);

/** PIN prüfen: 4 bis 8 Ziffern */
export function pruefePin(pin) {
  if (!/^\d{4,8}$/.test(pin ?? '')) throw new Error('Die PIN muss aus 4 bis 8 Ziffern bestehen.');
}

async function hashe(pin, salz, runden = RUNDEN) {
  const schluessel = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salz, iterations: runden }, schluessel, 256);
  return b64(bits);
}

/** PIN festlegen oder ändern (Fingerabdruck-Einstellung und Zeit bleiben) */
export async function setzePin(pin) {
  pruefePin(pin);
  const salz = zufall(16);
  const alt = await leseSperre();
  await schreibe({
    minuten: STANDARD_MINUTEN, credentialId: null, ...alt,
    pin: { salz: b64(salz), hash: await hashe(pin, salz), runden: RUNDEN },
  });
}

export async function pinStimmt(pin) {
  const s = await leseSperre();
  if (!s?.pin) return true;
  return (await hashe(pin, ausB64(s.pin.salz), s.pin.runden)) === s.pin.hash;
}

export async function setzeMinuten(minuten) {
  const s = await leseSperre();
  if (s) await schreibe({ ...s, minuten });
}

/** Sperre komplett ausschalten (vorher PIN prüfen) */
export async function ausschalten() {
  await schreibe(null);
}

/* ---------- Fingerabdruck / Gesicht / Windows Hello (WebAuthn) ---------- */

/** Gibt es auf diesem Gerät eine eingebaute Entsperrung (Fingerabdruck, Gesicht, Windows Hello)? */
export async function geraeteEntsperrungMoeglich() {
  try {
    return Boolean(window.PublicKeyCredential
      && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch {
    return false;
  }
}

/** Geräteentsperrung einrichten: legt einen Schlüssel im Gerät an (nur für diese App/Adresse) */
export async function geraeteEntsperrungEinrichten() {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: zufall(32),
      rp: { name: 'Finanzen' },
      user: { id: zufall(16), name: 'finanzen', displayName: 'Finanzen' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000,
      attestation: 'none',
    },
  });
  if (!cred) throw new Error('Die Geräteentsperrung wurde nicht eingerichtet.');
  const s = await leseSperre();
  await schreibe({ ...s, credentialId: b64(cred.rawId) });
}

export async function geraeteEntsperrungEntfernen() {
  const s = await leseSperre();
  if (s) await schreibe({ ...s, credentialId: null });
}

/**
 * Mit Fingerabdruck/Gesicht/Windows Hello entsperren. Das Gerät prüft den Nutzer
 * (userVerification "required") – kommt eine Antwort zurück, ist er bestätigt.
 */
export async function mitGeraetEntsperren() {
  const s = await leseSperre();
  if (!s?.credentialId) return false;
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

/** Nach 5 falschen PINs wartet die App 30 s, danach jeweils doppelt so lange */
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
