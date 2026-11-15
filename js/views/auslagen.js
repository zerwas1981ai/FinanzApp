// D214: Block „Auslagen“ im Tab Projekte – Geld, das ich für andere ausgelegt habe und zurückbekomme.
// Offene Auslagen oben, erledigte eingeklappt darunter. Die App ändert nichts von selbst:
// Rückzahlungen werden im Buchungsdialog der Einnahme zugeordnet, der Rest wird per Klick abgeschlossen.

import { h } from '../dom.js';
import * as db from '../db.js';
import { formatEuro, formatDatum } from '../format.js';
import { frage, toast, datenGeaendert } from '../ui.js';
import { auslagenUebersicht, auslageTitel, auslageAbschliessen, auslageWiederOeffnen } from '../auslagen.js';
import { oeffneBuchungsdialog } from './buchung-dialog.js';

/** daten: braucht buchungen, konten */
export function auslagenBereich(daten) {
  const liste = auslagenUebersicht(daten.buchungen);
  const offen = liste.filter((a) => a.status === 'offen');
  const erledigt = liste.filter((a) => a.status !== 'offen');
  const summeOffen = offen.reduce((s, a) => s + a.offenCent, 0);
  const kontoName = new Map(daten.konten.map((k) => [k.id, k.name]));

  const abschliessen = async (a) => {
    const rest = a.buchung.betragCent - a.zurueckCent;
    const ok = await frage({
      titel: 'Auslage abschließen?',
      text: [`„${auslageTitel(a.buchung)}“: ${formatEuro(a.zurueckCent)} von ${formatEuro(a.buchung.betragCent)} sind zurück.`,
        `Die fehlenden ${formatEuro(rest)} zählen danach als normale Ausgabe (in Auswertungen und gegen das Budget ihrer Kategorie).`],
      jaText: 'Abschließen',
    });
    if (!ok) return;
    await db.speichere('buchungen', auslageAbschliessen(a));
    toast(`Abgeschlossen – ${formatEuro(rest)} zählen als Ausgabe`);
    datenGeaendert();
  };
  const wiederOeffnen = async (a) => {
    await db.speichere('buchungen', auslageWiederOeffnen(a.buchung));
    toast('Auslage wieder offen');
    datenGeaendert();
  };

  const zeile = (a) => {
    const b = a.buchung;
    const stand = a.status === 'offen'
      ? (a.zurueckCent ? `${formatEuro(a.zurueckCent)} von ${formatEuro(b.betragCent)} zurück` : `${formatEuro(b.betragCent)} ausgelegt`)
      : a.status === 'zurueck' ? `vollständig zurück (${a.rueckzahlungen.length === 1 ? '1 Zahlung' : `${a.rueckzahlungen.length} Zahlungen`})`
        : `abgeschlossen · ${formatEuro(b.auslage.restCent ?? 0)} zählen als Ausgabe`;
    return h('li', { class: 'auslage-zeile' },
      h('button', { type: 'button', class: 'buchung', onclick: () => oeffneBuchungsdialog(b) },
        h('span', { class: 'buchung-text' },
          h('span', { class: 'buchung-titel' }, h('span', { class: 'datum-klein' }, formatDatum(b.datum)), auslageTitel(b)),
          h('span', { class: 'buchung-unter' },
            [kontoName.get(b.kontoId) ?? '?', b.auslage.fuer && b.partner, b.notiz, stand].filter(Boolean).join(' · '))),
        h('span', { class: 'betrag' + (a.status === 'offen' ? ' stark' : ' gedaempft') },
          a.status === 'offen' ? formatEuro(a.offenCent) : formatEuro(b.betragCent))),
      a.status === 'offen' && h('button', {
        type: 'button', class: 'knopf knopf-klein', title: 'Kommt nichts mehr zurück? Dann zählt der Rest als normale Ausgabe.',
        onclick: () => abschliessen(a),
      }, a.zurueckCent ? 'Rest als Ausgabe' : 'Kommt nicht zurück'),
      a.status === 'abgeschlossen' && h('button', { type: 'button', class: 'knopf knopf-klein', onclick: () => wiederOeffnen(a) }, 'Wieder öffnen'));
  };

  return h('section', { class: 'bereich auslagen', 'aria-labelledby': 'titel-auslagen' },
    h('div', { class: 'bereich-kopf' }, h('h2', { id: 'titel-auslagen' }, 'Auslagen')),
    h('p', { class: 'hinweis erklaerung' },
      'Geld, das du für jemand anderen bezahlt hast und zurückbekommst – z. B. eine Arztrechnung für die Krankenkasse. '
      + 'Markiere die Ausgabe im Buchungsdialog unter „Weitere Angaben“ als Auslage und ordne die Rückzahlung bei der Einnahme zu. '
      + 'Beides zählt im Kontostand, aber nicht als Ausgabe oder Einnahme und nicht gegen das Budget.'),
    liste.length === 0
      ? h('p', { class: 'leer' }, 'Noch keine Auslagen.')
      : h('div', { class: 'vertrag-summe' },
        h('span', { class: 'klein' }, offen.length === 0 ? 'Keine offenen Auslagen' : offen.length === 1 ? '1 offene Auslage' : `${offen.length} offene Auslagen`),
        h('span', { class: 'betrag stark' }, `Offen ${formatEuro(summeOffen)}`)),
    offen.length > 0 && h('ul', { class: 'liste auslagen-liste' }, offen.map(zeile)),
    erledigt.length > 0 && h('details', { class: 'erledigt-liste' },
      h('summary', {}, `Erledigte Auslagen (${erledigt.length})`),
      h('ul', { class: 'liste auslagen-liste' }, erledigt.map(zeile))));
}
