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

export const zeigeUebersicht = platzhalter({
  titel: 'Übersicht',
  text: 'Hier entsteht dein Finanz-Cockpit. Dieser Bereich ist noch ein Platzhalter.',
  kommt: [
    'Monatsansicht je Konto mit Zwischensummen',
    'Kennzahlen: Kontostand heute und zum Monatsende, Budgetauslastung, Warnungen',
    'Zukunftsmonate bis 2050 als klar gekennzeichnete Annahme',
  ],
  etappe: 'Kommt ab Etappe 2',
});

export const zeigeBuchungen = platzhalter({
  titel: 'Alle Buchungen',
  text: 'Hier siehst du später alle Buchungen über alle Konten. Dieser Bereich ist noch ein Platzhalter.',
  kommt: ['Filtern und Sortieren', 'Auswertungen', 'Filter „ohne Beleg“'],
  etappe: 'Kommt in Etappe 3',
});

export const zeigeAnnahmen = platzhalter({
  titel: 'Annahmen',
  text: 'Hier pflegst du später alles, was die Zukunftsprognose bestimmt. Dieser Bereich ist noch ein Platzhalter.',
  kommt: ['Wiederkehrende Buchungen', 'Budgets für die Zukunft', 'Geplante Einmalbuchungen', 'Szenario-Schalter „Was wäre wenn“'],
  etappe: 'Kommt in Etappe 5',
});
