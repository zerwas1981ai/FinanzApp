// Platzhalter für Tabs, die erst in späteren Etappen gebaut werden.

import { h } from '../dom.js';

export function platzhalter({ titel, text, kommt, etappe }) {
  return async (container) => {
    container.replaceChildren(
      h('h1', { class: 'seitentitel' }, titel),
      h('section', { class: 'bereich platzhalter' },
        h('p', {}, text),
        h('ul', {}, kommt.map((punkt) => h('li', {}, punkt))),
        h('p', { class: 'marke-etappe' }, etappe),
      ),
    );
  };
}

export const zeigeAnnahmen = platzhalter({
  titel: 'Annahmen',
  text: 'Hier pflegst du später alles, was die Zukunftsprognose bestimmt. Dieser Bereich ist noch ein Platzhalter.',
  kommt: ['Wiederkehrende Buchungen', 'Budgets für die Zukunft', 'Geplante Einmalbuchungen', 'Szenario-Schalter „Was wäre wenn“'],
  etappe: 'Kommt in Etappe 5',
});
