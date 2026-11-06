// Wiederverwendbare Bausteine der Oberfläche: Dialog, Rückfrage, Meldung, Formularfelder.

import { h } from './dom.js';

let feldZaehler = 0;
let toastTimer = null;

/** Kurze Meldung unten am Bildschirm, verschwindet von selbst */
export function toast(text) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text;
  el.classList.add('sichtbar');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('sichtbar'), 2600);
}

/**
 * Öffnet einen Dialog mit Formular.
 * onSpeichern darf einen Fehler werfen – dessen Text erscheint dann im Dialog,
 * und der Dialog bleibt offen.
 */
export function dialog({ titel, inhalt, speichernText = 'Speichern', gefahr = false, onSpeichern, abbrechenText = 'Abbrechen', zusatz = null }) {
  const fehler = h('p', { class: 'dialog-fehler', role: 'alert' });
  const speichern = h('button', { type: 'submit', class: 'knopf ' + (gefahr ? 'knopf-gefahr-voll' : 'knopf-primaer') }, speichernText);
  const abbrechen = abbrechenText && h('button', { type: 'button', class: 'knopf' }, abbrechenText);
  // Optionaler Zusatzknopf links (z. B. "In den Papierkorb"). zusatz.onclick erhält den Dialog.
  const zusatzKnopf = zusatz && h('button', { type: 'button', class: `knopf ${zusatz.variante ?? ''} dialog-zusatz` }, zusatz.text);
  const form = h('form', { class: 'dialog-form', novalidate: true },
    h('h2', { class: 'dialog-titel' }, titel),
    h('div', { class: 'dialog-inhalt' }, inhalt),
    fehler,
    h('div', { class: 'dialog-fuss' }, zusatzKnopf, abbrechen, speichern),
  );
  const dlg = h('dialog', { class: 'dialog', 'aria-label': titel }, form);

  abbrechen?.addEventListener('click', () => dlg.close());
  zusatzKnopf?.addEventListener('click', async () => {
    try {
      await zusatz.onclick(dlg);
    } catch (err) {
      fehler.textContent = err?.message ?? String(err);
    }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    fehler.textContent = '';
    speichern.disabled = true;
    try {
      await onSpeichern?.();
      dlg.close();
    } catch (err) {
      fehler.textContent = err?.message ?? String(err);
    } finally {
      speichern.disabled = false;
    }
  });
  dlg.addEventListener('close', () => dlg.remove());

  document.body.append(dlg);
  dlg.showModal();
  (dlg.querySelector('[autofocus]') ?? dlg.querySelector('input, select') ?? speichern).focus();
  return dlg;
}

/** Reine Information mit nur einem OK-Knopf */
export function hinweis({ titel, text }) {
  return new Promise((resolve) => {
    const dlg = dialog({
      titel,
      inhalt: (Array.isArray(text) ? text : [text]).map((t) => (t instanceof Node ? t : h('p', {}, t))),
      speichernText: 'OK',
      abbrechenText: null,
    });
    dlg.addEventListener('close', () => resolve());
  });
}

/** Meldet der App, dass sich Daten geändert haben → aktueller Tab zeichnet sich neu */
export function datenGeaendert() {
  window.dispatchEvent(new Event('daten-geaendert'));
}

/** Kleines Gedächtnis pro Gerät (z. B. zuletzt benutztes Konto). Fehler werden ignoriert. */
export const geraet = {
  lies(schluessel) {
    try { return localStorage.getItem(`finanzapp-${schluessel}`); } catch { return null; }
  },
  schreib(schluessel, wert) {
    try { localStorage.setItem(`finanzapp-${schluessel}`, wert); } catch { /* egal */ }
  },
};

/** Ja/Nein-Rückfrage. Liefert true, wenn bestätigt. */
export function frage({ titel, text, jaText = 'OK', gefahr = false }) {
  return new Promise((resolve) => {
    let bestaetigt = false;
    const dlg = dialog({
      titel,
      inhalt: (Array.isArray(text) ? text : [text]).map((t) => h('p', {}, t)),
      speichernText: jaText,
      gefahr,
      onSpeichern: () => { bestaetigt = true; },
    });
    dlg.addEventListener('close', () => resolve(bestaetigt));
  });
}

/** Textfeld mit Beschriftung und optionalem Hilfetext */
export function eingabe({ label, hilfe, ...attribute }) {
  const id = `feld-${++feldZaehler}`;
  const input = h('input', { id, type: 'text', autocomplete: 'off', ...attribute });
  const feld = h('div', { class: 'feld' },
    h('label', { for: id }, label),
    input,
    hilfe && h('small', { class: 'feld-hilfe' }, hilfe),
  );
  return { feld, input };
}

/** Auswahlliste. optionen = [{ wert, text }] */
export function auswahl({ label, optionen, wert, hilfe }) {
  const id = `feld-${++feldZaehler}`;
  const select = h('select', { id }, optionen.map((o) => h('option', { value: o.wert }, o.text)));
  if (wert !== undefined) select.value = wert;
  const feld = h('div', { class: 'feld' },
    h('label', { for: id }, label),
    select,
    hilfe && h('small', { class: 'feld-hilfe' }, hilfe),
  );
  return { feld, select };
}

/** Gruppe von Optionsknöpfen. Liefert { feld, wert() } */
export function optionsGruppe({ label, optionen, wert }) {
  const name = `gruppe-${++feldZaehler}`;
  const feld = h('fieldset', { class: 'feld' },
    h('legend', {}, label),
    h('div', { class: 'optionen' }, optionen.map((o) =>
      h('label', { class: 'option' },
        h('input', { type: 'radio', name, value: o.wert, checked: o.wert === wert }),
        o.text))),
  );
  return { feld, wert: () => feld.querySelector('input:checked')?.value ?? null };
}

/** Kleiner Knopf für Aktionen in Listen */
export function knopf(text, onclick, variante = '') {
  return h('button', { type: 'button', class: `knopf knopf-klein ${variante}`.trim(), onclick }, text);
}

/** Ein-/Aus-Schalter (Checkbox mit Text) */
export function schalter(text, an, beiAenderung) {
  return h('label', { class: 'schalter' },
    h('input', { type: 'checkbox', checked: an, onchange: (e) => beiAenderung(e.target.checked) }),
    text);
}
