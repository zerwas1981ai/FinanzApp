// Zeitleiste bis 2050 (Etappe 5) – unter der Monatsansicht eines Kontos oder für "Alle Konten".
// - Rest des laufenden Jahres: jeder Monat als kompakte Zeile, aufklappbar zu den Posten
// - Folgejahre bis 2050: je eine Zeile, einzeln aufklappbar zu den 12 Monaten
// Alle Werte sind Annahmen und stehen kursiv auf getöntem Hintergrund.

import { h } from '../dom.js';
import { formatEuro, formatMonat } from '../format.js';
import { jahresZeilen } from '../prognose.js';

// Welche Jahre und Monate sind aufgeklappt? Bleibt beim Neuzeichnen erhalten.
const offen = new Set();

const QUELLE = { wiederkehrend: 'wiederkehrend', geplant: 'geplant', budget: 'Budget', gebucht: 'gebucht' };
const monatText = (m) => formatMonat(Number(m.slice(0, 4)), Number(m.slice(5, 7)));
const mitVorzeichen = (cent) => (cent > 0 ? '+' : '') + formatEuro(cent);

/**
 * zeilen: Monatszeilen aus zeitleiste() (je Konto oder gesamt)
 * schluessel: unterscheidet Konten, damit Aufgeklapptes je Konto gemerkt wird
 * beiKlick(posten): optional – Posten anklicken zum Ändern
 */
export function zeitleisteBereich(zeilen, schluessel, beiKlick = null) {
  if (!zeilen.length) return null;

  const jahre = jahresZeilen(zeilen);
  const aktuellesJahr = jahre[0].jahr === Number(zeilen[0].monat.slice(0, 4)) && Number(zeilen[0].monat.slice(5, 7)) > 1
    ? jahre.shift()
    : null; // Rest des laufenden Jahres (falls der nächste Monat nicht schon Januar ist)

  return h('section', { class: 'bereich zukunft', 'aria-labelledby': `titel-zukunft-${schluessel}` },
    h('div', { class: 'bereich-kopf' }, h('h2', { id: `titel-zukunft-${schluessel}` }, 'Zukunft bis 2050')),
    h('p', { class: 'hinweis' },
      'Annahmen aus wiederkehrenden Buchungen, Budgets und geplanten Einmalbuchungen – ohne Prozent-Steigerungen. ' +
      'Zum Aufklappen auf eine Zeile tippen, einen Posten antippen zum Ändern.'),
    h('div', { class: 'zl-kopf' }, h('span', {}, 'Zeitraum'), h('span', {}, 'Veränderung'), h('span', {}, 'Stand am Ende')),
    aktuellesJahr && aktuellesJahr.monate.map((z) => monatZeile(z, schluessel, beiKlick)),
    jahre.map((j) => jahrZeile(j, schluessel, beiKlick)),
  );
}

function zahlen(veraenderung, stand) {
  return [
    h('span', { class: 'zl-wert annahme' + (veraenderung < 0 ? ' negativ' : '') }, mitVorzeichen(veraenderung)),
    h('span', { class: 'zl-wert annahme' + (stand < 0 ? ' negativ' : '') }, formatEuro(stand)),
  ];
}

function merkeOffen(el, id) {
  el.addEventListener('toggle', () => (el.open ? offen.add(id) : offen.delete(id)));
  return el;
}

function monatZeile(z, schluessel, beiKlick) {
  const id = `${schluessel}|${z.monat}`;
  const veraenderung = z.einnahmen - z.ausgaben + z.umbuchungen;
  return merkeOffen(h('details', { class: 'zl-monat', open: offen.has(id) },
    h('summary', { class: 'zl-zeile' }, h('span', { class: 'zl-name' }, monatText(z.monat)), ...zahlen(veraenderung, z.stand)),
    h('div', { class: 'zl-details' },
      h('div', { class: 'klein' },
        `Einnahmen ${formatEuro(z.einnahmen)} · Ausgaben ${formatEuro(z.ausgaben)}` +
        (z.umbuchungen !== 0 ? ` · Umbuchungen ${mitVorzeichen(z.umbuchungen)}` : '')),
      postenListe(z.posten, beiKlick)),
  ), id);
}

/**
 * Posten eines Zukunftsmonats (Datum, Text, Herkunft, Betrag) – auch für die Monatsansicht.
 * beiKlick(posten): wenn angegeben, sind Posten mit Quelle (ref) anklickbar und lassen sich ändern.
 */
export function postenListe(posten, beiKlick = null) {
  return posten.length === 0
    ? h('p', { class: 'leer' }, 'Keine Posten in diesem Monat.')
    : h('ul', { class: 'liste' }, [...posten].sort((a, b) => a.datum.localeCompare(b.datum) || a.wirkung - b.wirkung).map((p) => {
      const inhalt = [
        h('span', { class: 'datum-klein' }, `${p.datum.slice(8, 10)}.${p.datum.slice(5, 7)}.`),
        h('span', { class: 'zl-posten-text' }, p.text,
          h('span', { class: 'marke' }, QUELLE[p.quelle] ?? p.quelle),
          (p.ref?.einzelBetrag || p.ref?.verschoben || p.ref?.budget?.einzelBetrag) && h('span', { class: 'marke marke-projekt' }, p.ref?.budget ? 'nur dieser Monat geändert' : 'nur dieser Termin geändert')),
        h('span', { class: 'betrag annahme' + (p.wirkung > 0 ? ' plus' : '') }, mitVorzeichen(p.wirkung)),
      ];
      return beiKlick && p.ref
        ? h('li', {}, h('button', { type: 'button', class: 'zl-posten zl-posten-knopf', title: 'Ändern', onclick: () => beiKlick(p) }, inhalt))
        : h('li', { class: 'zl-posten' }, inhalt);
    }));
}

function jahrZeile(j, schluessel, beiKlick) {
  const id = `${schluessel}|${j.jahr}`;
  const veraenderung = j.einnahmen - j.ausgaben + j.umbuchungen;
  return merkeOffen(h('details', { class: 'zl-jahr', open: offen.has(id) },
    h('summary', { class: 'zl-zeile' }, h('span', { class: 'zl-name' }, String(j.jahr)), ...zahlen(veraenderung, j.stand)),
    h('div', { class: 'zl-monate' }, j.monate.map((z) => monatZeile(z, schluessel, beiKlick)))), id);
}
