// Startpunkt der App: Datenbank vorbereiten, Tabs umschalten, Hell/Dunkel.

import { initialisiere } from './db.js';
import { h } from './dom.js';
import { zeigeUebersicht, zeigeBuchungen, zeigeAnnahmen } from './views/platzhalter.js';
import { zeigeStammdaten } from './views/stammdaten.js';

const TABS = {
  uebersicht: { titel: 'Übersicht', zeige: zeigeUebersicht },
  buchungen: { titel: 'Alle Buchungen', zeige: zeigeBuchungen },
  annahmen: { titel: 'Annahmen', zeige: zeigeAnnahmen },
  stammdaten: { titel: 'Stammdaten', zeige: zeigeStammdaten },
};

const inhalt = document.getElementById('inhalt');

function aktuellerTab() {
  const name = location.hash.slice(1);
  return TABS[name] ? name : 'uebersicht';
}

async function zeigeTab() {
  const name = aktuellerTab();
  document.querySelectorAll('.nav a').forEach((a) => {
    if (a.dataset.tab === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  document.title = `${TABS[name].titel} – Finanzen`;
  try {
    await TABS[name].zeige(inhalt);
  } catch (err) {
    zeigeFehler(err);
  }
  window.scrollTo(0, 0);
}

function zeigeFehler(err) {
  console.error(err);
  inhalt.replaceChildren(
    h('div', { class: 'fehlerkarte', role: 'alert' },
      h('strong', {}, 'Es ist ein Fehler aufgetreten. '),
      err?.message ?? String(err)),
  );
}

/* ---------- Hell / Dunkel ---------- */

const themeKnopf = document.getElementById('theme-umschalter');

function setzeTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('finanzapp-theme', theme); } catch { /* privater Modus */ }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dunkel' ? '#0e1013' : '#f5f6f8');
  beschrifteThemeKnopf();
}

function beschrifteThemeKnopf() {
  const dunkel = document.documentElement.getAttribute('data-theme') === 'dunkel';
  const text = dunkel ? 'Zum hellen Modus wechseln' : 'Zum dunklen Modus wechseln';
  themeKnopf.setAttribute('aria-label', text);
  themeKnopf.title = text;
}

themeKnopf.addEventListener('click', () => {
  const dunkel = document.documentElement.getAttribute('data-theme') === 'dunkel';
  setzeTheme(dunkel ? 'hell' : 'dunkel');
});
beschrifteThemeKnopf();

/* ---------- Start ---------- */

async function start() {
  try {
    await initialisiere();
  } catch (err) {
    zeigeFehler(err);
    return;
  }
  window.addEventListener('hashchange', zeigeTab);
  await zeigeTab();
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service Worker nicht registriert:', err));
}

start();
