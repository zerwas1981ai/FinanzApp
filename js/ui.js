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

/** Datei zum Speichern anbieten (Export) */
export function herunterladen(inhalt, name, typ) {
  const url = URL.createObjectURL(inhalt instanceof Blob ? inhalt : new Blob([inhalt], { type: typ }));
  const a = h('a', { href: url, download: name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
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

/**
 * Erklärtexte hinter „ⓘ“ (D109): Absätze mit der Klasse "erklaerung" sind eingeklappt. Ein kleiner
 * ⓘ-Knopf an der zugehörigen Überschrift (die nächste davor) blendet sie ein und aus. Ein Beobachter
 * erledigt das auch für Bereiche, die sich später neu zeichnen. Was aufgeklappt ist, bleibt so,
 * solange die App offen ist.
 */
const offeneErklaerungen = new Set();

function ueberschriftVor(el, wurzel) {
  for (let x = el; x && x !== wurzel; x = x.parentElement) {
    for (let s = x.previousElementSibling; s; s = s.previousElementSibling) {
      const kopf = s.matches('h1, h2, h3') ? s : s.querySelector('h1, h2, h3');
      if (kopf) return kopf;
    }
  }
  return null;
}

function bereiteErklaerungVor(p, wurzel) {
  p.dataset.bereit = '1';
  const kopf = ueberschriftVor(p, wurzel);
  if (!kopf) return; // ohne Überschrift bleibt der Text sichtbar
  const schluessel = `${kopf.textContent.trim()}|${p.textContent.slice(0, 40)}`;
  let knopf = kopf.querySelector('.info-knopf');
  if (!knopf) {
    knopf = h('button', { type: 'button', class: 'info-knopf', 'aria-expanded': 'false', title: 'Erklärung anzeigen', 'aria-label': 'Erklärung anzeigen' }, 'ⓘ');
    knopf.erklaerungen = [];
    knopf.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const auf = knopf.getAttribute('aria-expanded') !== 'true';
      knopf.setAttribute('aria-expanded', String(auf));
      // D154: steht das ⓘ in einer eingeklappten Klappzeile, den Bereich dabei aufklappen
      const klapp = knopf.closest('summary')?.parentElement;
      if (auf && klapp?.tagName === 'DETAILS' && !klapp.open) klapp.open = true;
      for (const { absatz, key } of knopf.erklaerungen) {
        absatz.hidden = !auf;
        if (auf) offeneErklaerungen.add(key); else offeneErklaerungen.delete(key);
      }
    });
    kopf.append(' ', knopf);
  }
  knopf.erklaerungen.push({ absatz: p, key: schluessel });
  const auf = offeneErklaerungen.has(schluessel);
  p.hidden = !auf;
  if (auf) knopf.setAttribute('aria-expanded', 'true');
}

export function richteErklaerungenEin(wurzel) {
  const bearbeite = () => wurzel.querySelectorAll('p.erklaerung:not([data-bereit])').forEach((p) => bereiteErklaerungVor(p, wurzel));
  new MutationObserver(bearbeite).observe(wurzel, { childList: true, subtree: true });
  bearbeite();
}

/**
 * Einklappbarer Bereich (D112): Kopfzeile mit ▸, Titel und rechts einem Wert; Inhalt erst nach Antippen.
 * offen: Startzustand; beiWechsel(offen) merkt sich den Zustand (z. B. solange die App offen ist).
 */
export function klappBereich({ klasse = '', titel, zusatz = null, rechts = null, offen = false, beiWechsel = null }, ...inhalt) {
  const d = h('details', { class: `bereich klapp-bereich ${klasse}`.trim(), open: offen },
    h('summary', { class: 'klapp-kopf' },
      h('span', { class: 'klapp-titel' }, h('span', { class: 'klapp-text' }, titel), zusatz),
      rechts && h('span', { class: 'klapp-wert' }, rechts)),
    h('div', { class: 'klapp-inhalt' }, ...inhalt));
  if (beiWechsel) d.addEventListener('toggle', () => beiWechsel(d.open));
  return d;
}

/**
 * D160: Umschalter-Leiste für die Bereiche eines Tabs (wie die Konto-Wahl in der Übersicht).
 * ansichten: [[schluessel, text, zahl?]]; die Wahl merkt sich das Gerät unter `speicher`.
 * rechts: optionaler Knopf am rechten Rand; info: true = Platz für ein „ⓘ“ zur Seiten-Erklärung.
 * Liefert { aktuell, leiste(beiWahl) }.
 */
/**
 * D171: Seitlich scrollbare Leisten (Umschalter, Konten, Zeitraum …) behalten ihre Scrollposition, wenn der
 * Bereich nach einem Antippen neu gezeichnet wird – sie springen nicht mehr nach ganz links. Ohne gemerkte
 * Position (erstes Öffnen) wird der gewählte Eintrag sichtbar gemacht. Gilt, solange die App offen ist.
 */
const scrollPositionen = new Map();
export function merkeScroll(leiste, schluessel) {
  if (!leiste) return leiste;
  requestAnimationFrame(() => {
    if (scrollPositionen.has(schluessel)) leiste.scrollLeft = scrollPositionen.get(schluessel);
    else {
      const gewaehlt = leiste.querySelector('[aria-pressed="true"]');
      if (gewaehlt && gewaehlt.offsetLeft + gewaehlt.offsetWidth > leiste.clientWidth) {
        leiste.scrollLeft = gewaehlt.offsetLeft - leiste.offsetLeft - 16;
      }
    }
  });
  leiste.addEventListener('scroll', () => scrollPositionen.set(schluessel, leiste.scrollLeft), { passive: true });
  return leiste;
}

/** Langer Name am PC, Kurzform am Handy (für Umschalter) */
export const kurzLang = (lang, kurz) => [h('span', { class: 'nur-breit' }, lang), h('span', { class: 'nur-schmal' }, kurz)];

export function bereichsWahl(speicher, ansichten, standard = ansichten[0][0]) {
  const gemerkt = geraet.lies(speicher);
  const aktuell = ansichten.some(([k]) => k === gemerkt) ? gemerkt : standard;
  return {
    aktuell,
    leiste(beiWahl, { rechts = null, info = false } = {}) {
      return h('div', { class: 'umschalter-zeile' },
        merkeScroll(h('div', { class: 'chips', role: 'group', 'aria-label': 'Bereich wählen' },
          ansichten.map(([k, text, zahl]) => h('button', {
            type: 'button',
            class: 'chip',
            'aria-pressed': String(k === aktuell),
            onclick: () => { geraet.schreib(speicher, k); beiWahl(k); },
          }, text, zahl > 0 && h('span', { class: 'chip-zahl', 'aria-hidden': 'true' }, String(zahl))))), speicher), // D171
        // leere Überschrift: daran hängt richteErklaerungenEin das „ⓘ“ der Seiten-Erklärung (D109)
        info && h('h3', { class: 'umschalter-info', 'aria-label': 'Erklärung' }),
        rechts);
    },
  };
}

/** D155: kleiner Farbpunkt einer Kategorie (hex oder null = kein Punkt) */
export function katPunkt(hex, titel = null) {
  return hex ? h('span', { class: 'kat-punkt', style: `--kat-farbe:${hex}`, title: titel, 'aria-hidden': 'true' }) : null;
}

/** Ein-/Aus-Schalter (Checkbox mit Text) */
export function schalter(text, an, beiAenderung) {
  return h('label', { class: 'schalter' },
    h('input', { type: 'checkbox', checked: an, onchange: (e) => beiAenderung(e.target.checked) }),
    text);
}
