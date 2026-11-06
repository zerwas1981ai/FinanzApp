// App-Sperre: Sperrbildschirm und Einstellungen in den Stammdaten. Siehe DECISIONS.md D67.

import { h } from '../dom.js';
import * as db from '../db.js';
import { dialog, frage, toast, eingabe, auswahl, geraet } from '../ui.js';
import * as sperre from '../sperre.js';

let offen = null; // Promise, solange der Sperrbildschirm zu sehen ist
let imHintergrundSeit = null;

/** Beim App-Start: gesperrt anzeigen (falls eingerichtet) und auf das Entsperren warten */
export async function richteSperreEin() {
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'hidden') {
      imHintergrundSeit = Date.now();
      return;
    }
    const s = await sperre.leseSperre();
    if (!s?.pin || imHintergrundSeit === null) return;
    const minuten = s.minuten ?? sperre.STANDARD_MINUTEN;
    if (Date.now() - imHintergrundSeit >= minuten * 60000) sperren();
    imHintergrundSeit = null;
  });
  if (await sperre.istAktiv()) await sperren();
}

/** Sperrbildschirm zeigen; erfüllt sich, wenn entsperrt wurde */
export function sperren() {
  if (offen) return offen;
  offen = (async () => {
    const s = await sperre.leseSperre();
    if (!s?.pin) return;
    // Offene Dialoge schließen (ungespeicherte Eingaben gehen dabei verloren) und Inhalt verbergen
    document.querySelectorAll('dialog[open]').forEach((d) => d.close());
    document.body.classList.add('gesperrt');
    await new Promise((resolve) => zeigeSperrbildschirm(s, resolve));
    document.body.classList.remove('gesperrt');
  })().finally(() => { offen = null; });
  return offen;
}

function zeigeSperrbildschirm(s, entsperrt) {
  const fehler = h('p', { class: 'dialog-fehler', role: 'alert' });
  const pin = h('input', {
    type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: 8, class: 'sperre-pin',
    'aria-label': 'PIN', placeholder: 'PIN',
  });
  const fertig = () => {
    dlg.close();
    entsperrt();
  };
  const mitGeraet = s.credentialId && h('button', {
    type: 'button',
    class: 'knopf',
    onclick: async () => {
      try {
        if (await sperre.mitGeraetEntsperren()) fertig();
      } catch (err) {
        fehler.textContent = err?.name === 'NotAllowedError' ? 'Abgebrochen – bitte erneut versuchen oder PIN eingeben.' : (err.message ?? String(err));
      }
    },
  }, '🔓 Fingerabdruck / Windows Hello');

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
      const richtig = await sperre.pinStimmt(pin.value);
      sperre.merkeVersuch(richtig);
      if (richtig) fertig();
      else {
        fehler.textContent = 'Die PIN stimmt nicht.';
        pin.value = '';
        pin.focus();
      }
    },
  },
  h('img', { src: 'icons/icon.svg', alt: '', width: 56, height: 56 }),
  h('h2', {}, 'Finanzen ist gesperrt'),
  pin,
  fehler,
  h('button', { type: 'submit', class: 'knopf knopf-primaer' }, 'Entsperren'),
  mitGeraet,
  h('button', { type: 'button', class: 'link-knopf', onclick: () => pinVergessen() }, 'PIN vergessen?'));

  const dlg = h('dialog', { class: 'sperre-dialog', 'aria-label': 'App gesperrt' }, form);
  // Escape darf die Sperre nicht schließen
  dlg.addEventListener('cancel', (e) => e.preventDefault());
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  pin.focus();
  // Geräteentsperrung gleich anbieten (klappt nicht in jedem Browser ohne Antippen – dann per Knopf)
  if (mitGeraet && document.hasFocus()) mitGeraet.click();
}

async function pinVergessen() {
  const ok = await frage({
    titel: 'PIN vergessen?',
    text: [
      'Ohne PIN lässt sich die App nur zurücksetzen: Alle Daten auf DIESEM Gerät werden gelöscht, auch die PIN.',
      'Ist Google Drive verbunden, holst du danach deine Daten einfach wieder aus Drive (Stammdaten → Google Drive → verbinden). ' +
      'Änderungen, die noch nicht mit Drive abgeglichen wurden, gehen verloren.',
    ],
    jaText: 'Gerät zurücksetzen',
    gefahr: true,
  });
  if (!ok) return;
  await db.datenbankLoeschen();
  geraet.schreib('drive-letzter-abgleich', '');
  location.reload();
}

/* ---------- Bereich in den Stammdaten ---------- */

const ZEITEN = [[0, 'sofort beim Verlassen'], [1, 'nach 1 Minute'], [5, 'nach 5 Minuten'], [15, 'nach 15 Minuten'], [30, 'nach 30 Minuten']];

function pinDialog(titel, beiOk) {
  const a = eingabe({ label: 'Neue PIN (4–8 Ziffern)', type: 'password', inputmode: 'numeric', maxlength: 8, autofocus: true });
  const b = eingabe({ label: 'PIN wiederholen', type: 'password', inputmode: 'numeric', maxlength: 8 });
  dialog({
    titel,
    inhalt: [a.feld, b.feld, h('p', { class: 'hinweis' }, 'Merk dir die PIN gut. Vergessen lässt sie sich nur durch Zurücksetzen des Geräts (Daten kommen dann aus Google Drive zurück).')],
    onSpeichern: async () => {
      sperre.pruefePin(a.input.value);
      if (a.input.value !== b.input.value) throw new Error('Die beiden PINs stimmen nicht überein.');
      await sperre.setzePin(a.input.value);
      await beiOk();
    },
  });
}

/** Aktuelle PIN abfragen; erfüllt sich mit true, wenn sie stimmt */
function pinBestaetigen(titel) {
  return new Promise((resolve) => {
    let ok = false;
    const a = eingabe({ label: 'Aktuelle PIN', type: 'password', inputmode: 'numeric', maxlength: 8, autofocus: true });
    const dlg = dialog({
      titel,
      inhalt: [a.feld],
      speichernText: 'Weiter',
      onSpeichern: async () => {
        if (!(await sperre.pinStimmt(a.input.value))) throw new Error('Die PIN stimmt nicht.');
        ok = true;
      },
    });
    dlg.addEventListener('close', () => resolve(ok));
  });
}

export async function sperreBereich(neu) {
  const s = await sperre.leseSperre();
  const geraetMoeglich = await sperre.geraeteEntsperrungMoeglich();
  const sicher = (fn) => async () => { try { await fn(); } catch (err) { toast(err?.name === 'NotAllowedError' ? 'Abgebrochen' : (err.message ?? String(err))); } };

  const kopf = [
    h('h2', { id: 'titel-sperre' }, 'App-Sperre'),
    h('p', { class: 'hinweis' },
      'Sperrt die App beim Öffnen und nach einer Zeit im Hintergrund. Entsperren mit PIN' +
      (geraetMoeglich ? ' oder Fingerabdruck/Gesicht bzw. Windows Hello' : '') + '. ' +
      'Die Sperre schützt vor neugierigen Blicken, verschlüsselt die Daten aber nicht. Sie gilt nur auf diesem Gerät.'),
  ];

  if (!s?.pin) {
    return h('section', { class: 'bereich', 'aria-labelledby': 'titel-sperre' }, ...kopf,
      h('button', {
        type: 'button',
        class: 'knopf knopf-primaer',
        onclick: () => pinDialog('PIN festlegen', async () => {
          toast('App-Sperre eingeschaltet');
          neu();
        }),
      }, 'PIN festlegen'));
  }

  const zeit = auswahl({
    label: 'Sperren, wenn die App im Hintergrund war',
    optionen: ZEITEN.map(([wert, text]) => ({ wert: String(wert), text })),
    wert: String(s.minuten ?? sperre.STANDARD_MINUTEN),
  });
  zeit.select.addEventListener('change', sicher(async () => {
    await sperre.setzeMinuten(Number(zeit.select.value));
    toast('Gespeichert');
  }));

  return h('section', { class: 'bereich', 'aria-labelledby': 'titel-sperre' }, ...kopf,
    h('p', {}, h('strong', {}, 'Eingeschaltet'),
      ` · PIN${s.credentialId ? ' + Fingerabdruck/Windows Hello' : ''}`),
    zeit.feld,
    h('div', { class: 'knopfreihe' },
      h('button', { type: 'button', class: 'knopf', onclick: () => sperren() }, '🔒 Jetzt sperren'),
      geraetMoeglich && !s.credentialId && h('button', {
        type: 'button',
        class: 'knopf',
        onclick: sicher(async () => {
          await sperre.geraeteEntsperrungEinrichten();
          toast('Fingerabdruck / Windows Hello eingerichtet');
          neu();
        }),
      }, 'Fingerabdruck / Windows Hello einrichten'),
      s.credentialId && h('button', {
        type: 'button',
        class: 'knopf',
        onclick: sicher(async () => {
          await sperre.geraeteEntsperrungEntfernen();
          toast('Nur noch PIN');
          neu();
        }),
      }, 'Fingerabdruck entfernen'),
      h('button', {
        type: 'button',
        class: 'knopf',
        onclick: sicher(async () => {
          if (!(await pinBestaetigen('PIN ändern'))) return;
          pinDialog('Neue PIN', async () => toast('PIN geändert'));
        }),
      }, 'PIN ändern'),
      h('button', {
        type: 'button',
        class: 'knopf knopf-gefahr',
        onclick: sicher(async () => {
          if (!(await pinBestaetigen('Sperre ausschalten'))) return;
          await sperre.ausschalten();
          toast('App-Sperre ausgeschaltet');
          neu();
        }),
      }, 'Sperre ausschalten')));
}
