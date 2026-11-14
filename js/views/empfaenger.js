// D205: Stammdaten → Empfänger: ähnliche Schreibweisen zusammenfassen, einzelne Empfänger umbenennen.

import { h } from '../dom.js';
import * as db from '../db.js';
import { dialog, frage, toast, eingabe, datenGeaendert } from '../ui.js';
import { empfaengerListe, aehnlicheGruppen, umbenennen, EMPFAENGER_FELDER, offeneGruppen, getrenntMerken } from '../empfaenger.js';

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
  // D207: bewusst getrennt gelassene Gruppen ausblenden (kommen bei neuer Schreibweise wieder)
  const getrennt = (await db.hole('einstellungen', 'empfaenger'))?.getrennt ?? [];
  const gruppen = offeneGruppen(aehnlicheGruppen(liste), getrennt);

  const trennen = async (gruppe) => {
    const alt = (await db.hole('einstellungen', 'empfaenger')) ?? { id: 'empfaenger', getrennt: [] };
    await db.speichere('einstellungen', { ...alt, getrennt: getrenntMerken(alt.getrennt ?? [], gruppe.map((e) => e.schluessel)), geaendertAm: new Date().toISOString() });
    toast('Bleibt getrennt – erscheint erst wieder, wenn eine neue Schreibweise dazukommt');
    datenGeaendert();
    neu();
  };

  // D207: von Hand mehrere Empfänger auswählen und zusammenfassen
  const manuellDialog = () => {
    const gewaehlt = new Set();
    const ziel = eingabe({ label: 'Gemeinsamer Name', maxlength: 80, placeholder: 'erst Empfänger auswählen',
      hilfe: 'Vorbelegt mit dem häufigsten ausgewählten Namen – du kannst ihn ändern.' });
    const filter = h('input', { type: 'search', class: 'such-eingabe', placeholder: 'Empfänger suchen …', 'aria-label': 'Empfänger suchen' });
    const info = h('p', { class: 'klein gedaempft' });
    const auswahl = h('ul', { class: 'empf-auswahl' });
    const aktualisiere = () => {
      const liste2 = liste.filter((e) => gewaehlt.has(e.schluessel));
      info.textContent = liste2.length ? `Ausgewählt: ${liste2.map((e) => e.name).join(', ')}` : 'Noch nichts ausgewählt.';
      if (!ziel.input.dataset.geaendert) ziel.input.value = liste2[0]?.name ?? '';
    };
    ziel.input.addEventListener('input', () => { ziel.input.dataset.geaendert = '1'; });
    const zeichne = () => {
      const w = filter.value.trim().toLocaleLowerCase('de');
      const treffer = liste.filter((e) => !w || gewaehlt.has(e.schluessel) || e.schreibweisen.some((n) => n.toLocaleLowerCase('de').includes(w)));
      auswahl.replaceChildren(...treffer.slice(0, 200).map((e) => h('li', {},
        h('label', { class: 'empf-option' },
          h('input', {
            type: 'checkbox', checked: gewaehlt.has(e.schluessel),
            onchange: (ev) => { if (ev.target.checked) gewaehlt.add(e.schluessel); else gewaehlt.delete(e.schluessel); aktualisiere(); },
          }),
          h('span', {}, e.name), h('span', { class: 'klein gedaempft' }, ` · ${mal(e.anzahl)}`)))));
    };
    filter.addEventListener('input', zeichne);
    zeichne();
    aktualisiere();
    dialog({
      titel: 'Empfänger zusammenfassen',
      inhalt: [h('p', { class: 'hinweis' }, 'Wähle mindestens zwei Empfänger aus, die dasselbe sind.'), filter, auswahl, info, ziel.feld],
      speichernText: 'Zusammenfassen',
      onSpeichern: async () => {
        if (gewaehlt.size < 2) throw new Error('Bitte mindestens zwei Empfänger auswählen.');
        const n = await speichere(umbenennen(await ladeDaten(), [...gewaehlt], ziel.input.value));
        toast(`${n} Einträge auf „${ziel.input.value.trim()}“ geändert`);
        datenGeaendert();
        neu();
      },
    });
  };

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
      h('div', { class: 'empf-aktionen' },
        h('button', {
          type: 'button', class: 'knopf knopf-klein knopf-primaer',
          onclick: (ev) => {
            const ziel = ev.currentTarget.closest('.empf-gruppe').querySelector('input:checked')?.value ?? gruppe[0].name;
            zusammenfassen(gruppe, ziel);
          },
        }, 'Zusammenfassen'),
        h('button', { type: 'button', class: 'knopf knopf-klein', title: 'Diese Schreibweisen bewusst getrennt lassen', onclick: () => trennen(gruppe) }, 'Getrennt lassen')));
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
      'Analyse, Erkennung und die Markierung „↑ hoch“ genauer. Antippen zum Umbenennen; ähnliche Schreibweisen stehen oben als Vorschlag. ' +
      '„Getrennt lassen“ blendet einen Vorschlag aus, bis eine neue passende Schreibweise dazukommt. Mit „Zusammenfassen …“ wählst du Empfänger selbst aus.'),
    gruppen.length > 0 && h('div', { class: 'empf-vorschlaege' },
      h('div', { class: 'tag-kopf' }, h('span', {}, `Ähnliche Schreibweisen (${gruppen.length})`)),
      gruppen.map(vorschlagKarte)),
    h('div', { class: 'tag-kopf' }, h('span', {}, `Alle Empfänger (${liste.length})`),
      liste.length > 1 && h('button', { type: 'button', class: 'knopf knopf-klein', onclick: manuellDialog }, 'Zusammenfassen …')),
    liste.length > 8 && such,
    listeEl);
}
