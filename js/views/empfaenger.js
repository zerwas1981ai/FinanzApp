// D205: Stammdaten → Empfänger: ähnliche Schreibweisen zusammenfassen, einzelne Empfänger umbenennen.

import { h } from '../dom.js';
import * as db from '../db.js';
import { dialog, frage, toast, eingabe, datenGeaendert } from '../ui.js';
import { empfaengerListe, aehnlicheGruppen, umbenennen, EMPFAENGER_FELDER } from '../empfaenger.js';

let suche = ''; // solange die App offen ist
const SAMMLUNGEN = [...new Set(EMPFAENGER_FELDER.map(([s]) => s))];

async function ladeDaten() {
  const werte = await Promise.all(SAMMLUNGEN.map((s) => db.alle(s)));
  return Object.fromEntries(SAMMLUNGEN.map((s, i) => [s, werte[i]]));
}

/** Änderungen speichern und melden */
async function speichere(aenderungen) {
  let anzahl = 0;
  for (const [sammlung, liste] of Object.entries(aenderungen)) {
    await db.speichere(sammlung, liste);
    anzahl += liste.length;
  }
  return anzahl;
}

const mal = (n) => (n === 1 ? '1-mal' : `${n}-mal`);

export async function empfaengerBereich(neu) {
  const daten = await ladeDaten();
  const liste = empfaengerListe(daten);
  const gruppen = aehnlicheGruppen(liste);

  const zusammenfassen = async (gruppe, ziel) => {
    const ok = await frage({
      titel: 'Empfänger zusammenfassen?',
      text: [`Aus ${gruppe.map((e) => `„${e.name}“`).join(', ')} wird überall „${ziel}“.`,
        'Geändert werden Buchungen, wiederkehrende und geplante Buchungen, relevante Ausgaben und Verträge. Archivierte Jahre bleiben, wie sie sind.'],
      jaText: 'Zusammenfassen',
    });
    if (!ok) return;
    const n = await speichere(umbenennen(await ladeDaten(), gruppe.map((e) => e.schluessel), ziel));
    toast(`${n} Einträge auf „${ziel}“ geändert`);
    datenGeaendert();
    neu();
  };

  const umbenennenDialog = (e) => {
    const name = eingabe({ label: 'Neuer Name', value: e.name, maxlength: 80, autofocus: true,
      hilfe: 'Heißt ein anderer Empfänger schon so, werden beide zusammengefasst.' });
    dialog({
      titel: `Empfänger umbenennen`,
      inhalt: [h('p', { class: 'hinweis' }, `„${e.name}“ kommt ${mal(e.anzahl)} vor` +
        (e.schreibweisen.length > 1 ? ` (Schreibweisen: ${e.schreibweisen.join(', ')})` : '') + '.'), name.feld],
      onSpeichern: async () => {
        const n = await speichere(umbenennen(await ladeDaten(), [e.schluessel], name.input.value));
        toast(n ? `${n} Einträge geändert` : 'Nichts geändert');
        datenGeaendert();
        neu();
      },
    });
  };

  // Vorschläge: je Gruppe Auswahl des Zielnamens (Standard: der häufigste)
  const vorschlagKarte = (gruppe) => {
    const id = `ziel-${gruppe[0].schluessel.replace(/[^a-z0-9]/g, '')}-${gruppe.length}`;
    const optionen = gruppe.map((e, i) => h('label', { class: 'empf-option' },
      h('input', { type: 'radio', name: id, value: e.name, checked: i === 0 }),
      h('span', {}, e.name), h('span', { class: 'klein gedaempft' }, ` · ${mal(e.anzahl)}`)));
    return h('div', { class: 'empf-gruppe' },
      h('div', { class: 'empf-optionen' }, optionen),
      h('button', {
        type: 'button', class: 'knopf knopf-klein',
        onclick: (ev) => {
          const ziel = ev.currentTarget.closest('.empf-gruppe').querySelector('input:checked')?.value ?? gruppe[0].name;
          zusammenfassen(gruppe, ziel);
        },
      }, 'Zusammenfassen'));
  };

  const listeEl = h('ul', { class: 'liste empf-liste' });
  const such = h('input', { type: 'search', class: 'such-eingabe', placeholder: 'Empfänger suchen …', 'aria-label': 'Empfänger suchen', value: suche });
  const zeichne = () => {
    suche = such.value;
    const w = suche.trim().toLocaleLowerCase('de');
    const treffer = w ? liste.filter((e) => e.schreibweisen.some((n) => n.toLocaleLowerCase('de').includes(w))) : liste;
    listeEl.replaceChildren(...(treffer.length ? treffer.map((e) => h('li', {},
      h('button', { type: 'button', class: 'buchung einzeilig', onclick: () => umbenennenDialog(e) },
        h('span', { class: 'buchung-text' }, h('span', { class: 'buchung-titel' }, e.name,
          e.schreibweisen.length > 1 && h('span', { class: 'klein gedaempft' }, ` (+${e.schreibweisen.length - 1} Schreibweise${e.schreibweisen.length > 2 ? 'n' : ''})`))),
        h('span', { class: 'klein gedaempft' }, mal(e.anzahl)))))
      : [h('li', { class: 'leer' }, liste.length ? 'Kein Empfänger passt zur Suche.' : 'Noch keine Empfänger.')]));
  };
  such.addEventListener('input', zeichne);
  zeichne();

  return h('section', { class: 'bereich', 'aria-labelledby': 'titel-empfaenger' },
    h('div', { class: 'bereich-kopf' }, h('h2', { id: 'titel-empfaenger' }, 'Empfänger')),
    h('p', { class: 'hinweis erklaerung' },
      'Alle Empfänger und Absender aus Buchungen, Annahmen, relevanten Ausgaben und Verträgen. Einheitliche Namen machen ' +
      'Analyse, Erkennung und die Markierung „↑ hoch“ genauer. Antippen zum Umbenennen; ähnliche Schreibweisen stehen oben als Vorschlag.'),
    gruppen.length > 0 && h('div', { class: 'empf-vorschlaege' },
      h('div', { class: 'tag-kopf' }, h('span', {}, `Ähnliche Schreibweisen (${gruppen.length})`)),
      gruppen.map(vorschlagKarte)),
    h('div', { class: 'tag-kopf' }, h('span', {}, `Alle Empfänger (${liste.length})`)),
    liste.length > 8 && such,
    listeEl);
}
