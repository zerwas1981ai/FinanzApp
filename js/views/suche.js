// D146: Suchdialog hinter der Lupe oben in der Kopfzeile. Tippen sucht sofort;
// ein Treffer öffnet den passenden Dialog (Buchung, relevante Ausgabe, Projekt, Annahme).

import { h } from '../dom.js';
import * as db from '../db.js';
import { formatEuro } from '../format.js';
import { dialog } from '../ui.js';
import { suche, BEREICHE } from '../suche.js';
import { oeffneBuchungsdialog } from './buchung-dialog.js';
import { relevantDialog } from './relevant.js';
import { projektDialog } from './projekte.js';
import { wiederkehrendDialog, geplantDialog } from './annahmen.js';
import { vertragDialog } from './vertraege.js';

const MAX_JE_BEREICH = 30;
let letzterBegriff = ''; // solange die App offen ist

export async function oeffneSuche() {
  const namen = ['konten', 'kategorien', 'buchungen', 'budgets', 'wiederkehrend', 'geplant', 'projekte', 'relevant', 'archive', 'vertraege'];
  const werte = await Promise.all(namen.map((n) => db.alle(n)));
  const daten = Object.fromEntries(namen.map((n, i) => [n, werte[i]]));

  const input = h('input', {
    type: 'search', class: 'such-eingabe', placeholder: 'z. B. Stadtwerke, Garantie, 85,00', autocomplete: 'off',
    'aria-label': 'Suchbegriff', enterkeyhint: 'search', autofocus: true, value: letzterBegriff,
  });
  const liste = h('div', { class: 'such-ergebnis', 'aria-live': 'polite' });

  let dlg = null;
  const oeffne = (t) => {
    dlg?.close();
    if (t.bereich === 'buchung') oeffneBuchungsdialog(t.ref);
    else if (t.bereich === 'relevant') relevantDialog(t.ref, daten);
    else if (t.bereich === 'projekt') projektDialog(t.ref, daten);
    else if (t.bereich === 'vertrag') vertragDialog(t.ref, daten);
    else if (t.bereich === 'wiederkehrend') wiederkehrendDialog(t.ref, daten);
    else if (t.bereich === 'geplant') geplantDialog(t.ref, daten);
  };

  const zeichne = () => {
    letzterBegriff = input.value;
    const ergebnis = suche(input.value, daten);
    const anzahl = BEREICHE.reduce((s, b) => s + ergebnis[b.schluessel].length, 0);
    if (!input.value.trim()) {
      liste.replaceChildren(h('p', { class: 'klein gedaempft' },
        'Sucht in Empfänger, Notiz, Kategorie, Konto, Betrag, Datum und Belegnamen – in Buchungen, relevanten Ausgaben, Projekten, Verträgen und Annahmen.'));
      return;
    }
    if (anzahl === 0) {
      liste.replaceChildren(h('p', { class: 'leer' }, 'Nichts gefunden.'));
      return;
    }
    liste.replaceChildren(...BEREICHE.filter((b) => ergebnis[b.schluessel].length > 0).map((b) => {
      const treffer = ergebnis[b.schluessel];
      return h('section', { class: 'such-bereich' },
        h('h3', {}, `${b.titel} (${treffer.length})`),
        h('ul', { class: 'such-liste' }, treffer.slice(0, MAX_JE_BEREICH).map((t) => h('li', {},
          h('button', { type: 'button', class: 'such-treffer', onclick: () => oeffne(t) },
            h('span', { class: 'such-text' },
              h('span', { class: 'such-titel' }, t.titel),
              h('span', { class: 'such-details klein' }, t.details)),
            t.betragCent != null && h('span', {
              class: 'betrag' + (t.art === 'einnahme' ? ' plus' : '') + (t.bereich === 'buchung' ? '' : ' annahme'),
            }, formatEuro(t.art === 'einnahme' || t.bereich === 'projekt' ? t.betragCent : -t.betragCent)))))),
        treffer.length > MAX_JE_BEREICH && h('p', { class: 'klein gedaempft' },
          `… und ${treffer.length - MAX_JE_BEREICH} weitere – Suchbegriff genauer fassen.`));
    }));
  };

  let warte = null;
  input.addEventListener('input', () => { clearTimeout(warte); warte = setTimeout(zeichne, 120); });
  // Enter soll nicht den Dialog schließen
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });

  dlg = dialog({
    titel: 'Suche',
    inhalt: [input, liste],
    speichernText: 'Schließen',
    abbrechenText: null,
  });
  dlg.classList.add('such-dialog');
  zeichne();
  input.select();
}
