// App-Login (D83): Anmeldebildschirm, Einrichten beim ersten Start, "Passwort vergessen" und der
// Bereich in den Stammdaten. Ersetzt die PIN-Sperre aus D67.

import { h } from '../dom.js';
import { dialog, toast, eingabe, auswahl, geraet } from '../ui.js';
import * as sperre from '../sperre.js';
import { pruefePasswort, loginAusStand, MIN_LAENGE } from '../login.js';
import * as drive from '../sync/drive.js';
import { clientId, setzeClientId } from '../sync/abgleich.js';

let offen = null; // Promise, solange der Anmeldebildschirm zu sehen ist
let imHintergrundSeit = null;

/** Beim App-Start: anmelden (bzw. beim ersten Mal das Passwort festlegen) und erst dann weiter */
export async function richteSperreEin() {
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'hidden') {
      imHintergrundSeit = Date.now();
      return;
    }
    if (imHintergrundSeit === null || !(await sperre.istEingerichtet())) return;
    const { minuten } = await sperre.leseSperre();
    if (Date.now() - imHintergrundSeit >= minuten * 60000) sperren();
    imHintergrundSeit = null;
  });
  // Pflicht (Wunsch des Nutzers): ohne Passwort ist die App nicht nutzbar
  if (!(await sperre.istEingerichtet())) {
    document.body.classList.add('gesperrt'); // Inhalt verborgen, bis angemeldet
    await einrichten();
  }
  await sperren();
}

/** Anmeldebildschirm zeigen; erfüllt sich, wenn angemeldet wurde */
export function sperren() {
  if (offen) return offen;
  offen = (async () => {
    if (!(await sperre.istEingerichtet())) return;
    // Offene Dialoge schließen (ungespeicherte Eingaben gehen dabei verloren) und Inhalt verbergen
    document.querySelectorAll('dialog[open]').forEach((d) => d.close());
    document.body.classList.add('gesperrt');
    await new Promise((resolve) => zeigeAnmeldung(resolve));
    document.body.classList.remove('gesperrt');
    // Abgleich, der während der Sperre ausgesetzt war, jetzt nachholen
    window.dispatchEvent(new Event('entsperrt'));
  })().finally(() => { offen = null; });
  return offen;
}

/** Ganzseitiger Dialog, den Escape nicht schließen kann */
function sperrDialog(inhalt, ariaLabel) {
  const dlg = h('dialog', { class: 'sperre-dialog', 'aria-label': ariaLabel }, inhalt);
  dlg.addEventListener('cancel', (e) => e.preventDefault());
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

// Unsichtbarer Benutzername, damit Passwort-Manager das Passwort zuordnen und ausfüllen können
const benutzerFeld = () => h('input', { type: 'text', name: 'username', autocomplete: 'username', value: 'Finanzen', hidden: true, readonly: true, tabindex: '-1', 'aria-hidden': 'true' });

async function zeigeAnmeldung(angemeldet) {
  const { credentialId } = await sperre.leseSperre();
  const fehler = h('p', { class: 'dialog-fehler', role: 'alert' });
  const passwort = h('input', {
    type: 'password', name: 'password', autocomplete: 'current-password', class: 'sperre-pin', 'aria-label': 'Passwort', placeholder: 'Passwort',
  });
  const fertig = () => {
    dlg.close();
    angemeldet();
  };
  const mitPasskey = credentialId && h('button', {
    type: 'button',
    class: 'knopf',
    onclick: async () => {
      try {
        if (await sperre.mitPasskeyAnmelden()) fertig();
      } catch (err) {
        fehler.textContent = err?.name === 'NotAllowedError' ? 'Abgebrochen – bitte erneut versuchen oder das Passwort eingeben.' : (err.message ?? String(err));
      }
    },
  }, '🔑 Mit Passkey anmelden');

  const form = h('form', {
    class: 'sperre-form',
    novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      const warten = sperre.versuchErlaubt();
      if (warten) {
        fehler.textContent = `Zu viele Fehlversuche – bitte ${warten} Sekunden warten.`;
        return;
      }
      const richtig = await sperre.passwortStimmt(passwort.value);
      sperre.merkeVersuch(richtig);
      if (richtig) fertig();
      else {
        fehler.textContent = 'Das Passwort stimmt nicht.';
        passwort.value = '';
        passwort.focus();
      }
    },
  },
  h('img', { src: 'icons/icon.svg', alt: '', width: 56, height: 56 }),
  h('h2', {}, 'Finanzen – Anmelden'),
  benutzerFeld(),
  passwort,
  fehler,
  h('button', { type: 'submit', class: 'knopf knopf-primaer' }, 'Anmelden'),
  mitPasskey,
  h('button', { type: 'button', class: 'link-knopf', onclick: () => passwortVergessen(fertig) }, 'Passwort vergessen?'));

  const dlg = sperrDialog(form, 'Anmelden');
  passwort.focus();
  // Passkey gleich anbieten (klappt nicht in jedem Browser ohne Antippen – dann per Knopf)
  if (mitPasskey && document.hasFocus()) mitPasskey.click();
}

/* ---------- Erster Start: Passwort festlegen oder aus Google Drive holen ---------- */

function einrichten() {
  return new Promise((fertig) => {
    const fehler = h('p', { class: 'dialog-fehler', role: 'alert' });
    const a = h('input', { type: 'password', name: 'new-password', autocomplete: 'new-password', class: 'sperre-pin', placeholder: `Neues Passwort (mind. ${MIN_LAENGE} Zeichen)`, 'aria-label': 'Neues Passwort' });
    const b = h('input', { type: 'password', autocomplete: 'new-password', class: 'sperre-pin', placeholder: 'Passwort wiederholen', 'aria-label': 'Passwort wiederholen' });
    const ende = () => {
      dlg.close();
      fertig();
    };

    const ausDrive = h('button', {
      type: 'button',
      class: 'knopf',
      onclick: async () => {
        fehler.textContent = '';
        try {
          const id = clientId() || await clientIdErfragen();
          if (!id) return;
          const daten = await driveStand(id);
          const login = loginAusStand(daten);
          if (!login) {
            fehler.textContent = 'In Google Drive ist noch kein Passwort festgelegt. Bitte hier ein neues festlegen.';
            return;
          }
          await sperre.uebernimmLogin(login);
          toast('Passwort aus Google Drive übernommen – bitte jetzt damit anmelden.');
          ende();
        } catch (err) {
          fehler.textContent = err.message ?? String(err);
        }
      },
    }, '☁ Von Google Drive holen');

    const form = h('form', {
      class: 'sperre-form',
      novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          pruefePasswort(a.value);
          if (a.value !== b.value) throw new Error('Die beiden Passwörter stimmen nicht überein.');
          await sperre.setzePasswort(a.value);
          toast('Passwort festgelegt');
          ende();
        } catch (err) {
          fehler.textContent = err.message ?? String(err);
        }
      },
    },
    h('img', { src: 'icons/icon.svg', alt: '', width: 56, height: 56 }),
    h('h2', {}, 'Passwort festlegen'),
    h('p', { class: 'hinweis' },
      'Die App ist ab jetzt nur mit Passwort nutzbar. Es gilt für alle deine Geräte (es wird über Google Drive abgeglichen). ' +
      'Auf jedem Gerät kannst du zusätzlich einen Passkey (Fingerabdruck, Gesicht, Windows Hello) einrichten.'),
    benutzerFeld(),
    a, b,
    fehler,
    h('button', { type: 'submit', class: 'knopf knopf-primaer' }, 'Passwort festlegen'),
    h('p', { class: 'hinweis' }, 'Schon auf einem anderen Gerät festgelegt?'),
    ausDrive);

    const dlg = sperrDialog(form, 'Passwort festlegen');
    a.focus();
  });
}

/* ---------- Passwort vergessen: nach Google-Anmeldung neu festlegen ---------- */

/** Bei Google anmelden und den Datenstand aus Drive lesen (nur Lesen, kein Abgleich) */
async function driveStand(id) {
  await drive.anmelden(id);
  const datei = await drive.datenDatei();
  if (!datei) throw new Error('In diesem Google-Konto gibt es keinen Finanzen-Datenstand.');
  // Die Verbindung für den späteren Abgleich merken
  if (id !== clientId()) setzeClientId(id);
  geraet.schreib('drive-aktiv', '1');
  return drive.ladeJson(datei.id);
}

/** Client-ID abfragen, falls dieses Gerät noch nicht mit Google Drive verbunden war */
function clientIdErfragen() {
  return new Promise((resolve) => {
    let wert = null;
    const feld = eingabe({
      label: 'Client-ID für Google Drive', placeholder: '…apps.googleusercontent.com', autofocus: true,
      hilfe: 'Dieselbe Client-ID wie auf deinen anderen Geräten (Stammdaten → Google Drive).',
    });
    const dlg = dialog({
      titel: 'Mit Google Drive verbinden',
      inhalt: [feld.feld],
      speichernText: 'Weiter',
      onSpeichern: () => {
        const id = feld.input.value.trim();
        if (!id.endsWith('.apps.googleusercontent.com')) throw new Error('Das sieht nicht wie eine Client-ID aus (endet auf .apps.googleusercontent.com).');
        wert = id;
      },
    });
    dlg.addEventListener('close', () => resolve(wert));
  });
}

function passwortVergessen(angemeldet) {
  const fehler = h('p', { class: 'dialog-fehler', role: 'alert' });
  const weiter = h('button', {
    type: 'button',
    class: 'knopf knopf-primaer',
    onclick: async () => {
      fehler.textContent = '';
      try {
        const id = clientId() || await clientIdErfragen();
        if (!id) return;
        await driveStand(id); // beweist: dein Google-Konto mit deinem Finanzen-Datenstand
        dlg.close();
        passwortDialog('Neues Passwort festlegen', async () => {
          toast('Neues Passwort festgelegt – es gilt nach dem nächsten Abgleich auf allen Geräten.');
          angemeldet();
        });
      } catch (err) {
        fehler.textContent = err?.message ?? String(err);
      }
    },
  }, 'Mit Google anmelden');
  const dlg = dialog({
    titel: 'Passwort vergessen?',
    inhalt: [
      h('p', {}, 'Melde dich mit dem Google-Konto an, in dem deine Finanzen-Daten liegen. Danach legst du ein neues Passwort fest. Deine Daten bleiben erhalten.'),
      weiter,
      fehler,
    ],
    speichernText: 'Schließen',
    abbrechenText: null,
  });
}

/* ---------- Bereich in den Stammdaten ---------- */

const ZEITEN = [[0, 'sofort beim Verlassen'], [1, 'nach 1 Minute'], [5, 'nach 5 Minuten'], [15, 'nach 15 Minuten'], [30, 'nach 30 Minuten']];

function passwortDialog(titel, beiOk) {
  const a = eingabe({ label: `Neues Passwort (mind. ${MIN_LAENGE} Zeichen)`, type: 'password', autocomplete: 'new-password', autofocus: true });
  const b = eingabe({ label: 'Passwort wiederholen', type: 'password', autocomplete: 'new-password' });
  dialog({
    titel,
    inhalt: [a.feld, b.feld, h('p', { class: 'hinweis' }, 'Das Passwort gilt nach dem nächsten Abgleich mit Google Drive auf allen Geräten.')],
    onSpeichern: async () => {
      pruefePasswort(a.input.value);
      if (a.input.value !== b.input.value) throw new Error('Die beiden Passwörter stimmen nicht überein.');
      await sperre.setzePasswort(a.input.value);
      await beiOk();
    },
  });
}

/** Aktuelles Passwort abfragen; erfüllt sich mit true, wenn es stimmt */
function passwortBestaetigen(titel) {
  return new Promise((resolve) => {
    let ok = false;
    const a = eingabe({ label: 'Aktuelles Passwort', type: 'password', autocomplete: 'current-password', autofocus: true });
    const dlg = dialog({
      titel,
      inhalt: [a.feld],
      speichernText: 'Weiter',
      onSpeichern: async () => {
        if (!(await sperre.passwortStimmt(a.input.value))) throw new Error('Das Passwort stimmt nicht.');
        ok = true;
      },
    });
    dlg.addEventListener('close', () => resolve(ok));
  });
}

export async function sperreBereich(neu) {
  const s = await sperre.leseSperre();
  const login = await sperre.leseLogin();
  const passkeyMoeglich = await sperre.passkeyMoeglich();
  const sicher = (fn) => async () => { try { await fn(); } catch (err) { toast(err?.name === 'NotAllowedError' ? 'Abgebrochen' : (err.message ?? String(err))); } };

  const zeit = auswahl({
    label: 'Erneut anmelden, wenn die App im Hintergrund war',
    optionen: ZEITEN.map(([wert, text]) => ({ wert: String(wert), text })),
    wert: String(s.minuten),
  });
  zeit.select.addEventListener('change', sicher(async () => {
    await sperre.setzeMinuten(Number(zeit.select.value));
    toast('Gespeichert');
  }));

  return h('section', { class: 'bereich', 'aria-labelledby': 'titel-sperre' },
    h('h2', { id: 'titel-sperre' }, 'App-Login'),
    h('p', { class: 'hinweis' },
      'Die App ist nur mit Passwort nutzbar – auf allen Geräten dasselbe (wird über Google Drive abgeglichen). ' +
      'Auf diesem Gerät geht es auch mit Passkey' + (passkeyMoeglich ? ' (Fingerabdruck, Gesicht bzw. Windows Hello)' : '') + '. ' +
      'Der Login schützt den Zugang, verschlüsselt die Daten im Browser aber nicht.'),
    h('p', {},
      h('strong', {}, 'Passwort festgelegt'),
      login?.geaendertAm && ` (zuletzt geändert ${new Date(login.geaendertAm).toLocaleDateString('de-DE')})`,
      ` · Passkey auf diesem Gerät: ${s.credentialId ? 'eingerichtet' : 'nein'}`),
    h('p', { class: 'hinweis' }, 'Die Zeit bis zur erneuten Anmeldung und der Passkey gelten nur für dieses Gerät.'),
    zeit.feld,
    h('div', { class: 'knopfreihe' },
      h('button', { type: 'button', class: 'knopf', onclick: () => sperren() }, '🔒 Jetzt abmelden'),
      passkeyMoeglich && !s.credentialId && h('button', {
        type: 'button',
        class: 'knopf',
        onclick: sicher(async () => {
          if (!(await passwortBestaetigen('Passkey einrichten'))) return;
          await sperre.passkeyEinrichten();
          toast('Passkey eingerichtet');
          neu();
        }),
      }, '🔑 Passkey einrichten'),
      s.credentialId && h('button', {
        type: 'button',
        class: 'knopf',
        onclick: sicher(async () => {
          await sperre.passkeyEntfernen();
          toast('Passkey entfernt – Anmeldung nur noch mit Passwort');
          neu();
        }),
      }, 'Passkey entfernen'),
      h('button', {
        type: 'button',
        class: 'knopf',
        onclick: sicher(async () => {
          if (!(await passwortBestaetigen('Passwort ändern'))) return;
          passwortDialog('Neues Passwort', async () => {
            toast('Passwort geändert');
            neu();
          });
        }),
      }, 'Passwort ändern')));
}
