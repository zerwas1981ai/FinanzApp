// Tab "Projekte": Einmalausgaben zu einem Vorhaben bündeln (z. B. Umbau, Urlaub) und sehen,
// was es insgesamt kostet – echte Buchungen (Ist) plus noch geplante Einmalbuchungen.
// Projektausgaben zählen nicht gegen die Monatsbudgets (D52). Siehe DECISIONS.md D51–D54.

import { h } from '../dom.js';
import * as db from '../db.js';
import { formatEuro, formatDatum, centZuEingabe, parseEuro, heuteIso } from '../format.js';
import { dialog, frage, toast, eingabe, datenGeaendert, bereichsWahl, kurzLang } from '../ui.js';
import { kuendigungsHinweise } from '../vertraege.js';
import { baueProjekt, projektZahlen } from '../annahmen.js';
import { oeffneBuchungsdialog } from './buchung-dialog.js';
import { geplantDialog } from './annahmen.js';
import { relevantBereich } from './relevant.js';
import { vertraegeBereich } from './vertraege.js';

const nachName = (a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' });
export const ANSICHT_SCHLUESSEL = 'ansicht-projekte';
const ANSICHTEN = [['projekte', 'Projekte'], ['vertraege', 'Verträge'], ['relevant', 'Relevante Ausgaben']];

export async function zeigeProjekte(container) {
  const namen = ['konten', 'kategorien', 'buchungen', 'geplant', 'projekte', 'archive', 'relevant', 'vertraege', 'wiederkehrend', 'budgets'];
  const werte = await Promise.all(namen.map((n) => db.alle(n)));
  const daten = Object.fromEntries(namen.map((n, i) => [n, werte[i]]));
  const heute = heuteIso();

  const laufend = daten.projekte.filter((p) => !p.abgeschlossen).sort(nachName);
  const abgeschlossen = daten.projekte.filter((p) => p.abgeschlossen).sort(nachName);

  // D153/D160: Umschalter Projekte · Verträge · Relevante Ausgaben (ohne sichtbare Seitenüberschrift)
  const fristen = kuendigungsHinweise(daten.vertraege, heute).length;
  const wahl = bereichsWahl(ANSICHT_SCHLUESSEL, ANSICHTEN.map(([k, text]) => [k, k === 'relevant' ? kurzLang(text, 'Relevante') : text, k === 'vertraege' ? fristen : 0]), 'projekte');
  const ansicht = wahl.aktuell;
  const titel = h('h1', { class: 'seitentitel unsichtbar' }, 'Projekte');
  const neu = () => zeigeProjekte(container);

  // D161: alle drei Bereiche gleich aufgebaut – ein Block mit Überschrift, „+“-Knopf und aufklappbaren Zeilen
  container.replaceChildren(
    titel,
    wahl.leiste(neu),
    ansicht === 'vertraege' ? vertraegeBereich(daten)
      : ansicht === 'relevant' ? await relevantBereich(daten)
        : projekteBereich(daten, laufend, abgeschlossen, heute),
  );
}

/** D161: Block „Projekte“ wie „Verträge“: Summe oben, je Projekt eine aufklappbare Zeile */
function projekteBereich(daten, laufend, abgeschlossen, heute) {
  const gesamt = laufend.reduce((s, p) => s + projektZahlen(p, daten, heute).gesamtCent, 0);
  return h('section', { class: 'bereich projekte', 'aria-labelledby': 'titel-projekte' }, ...[
    h('div', { class: 'bereich-kopf' },
      h('h2', { id: 'titel-projekte' }, 'Projekte'),
      h('button', { type: 'button', class: 'knopf knopf-primaer', onclick: () => projektDialog(null, daten) }, '+ Projekt')),
    h('p', { class: 'hinweis erklaerung' },
      'Fasse Einmalausgaben zu einem Projekt zusammen, z. B. „Umbau Bad“ oder „Urlaub 2027“. Zugeordnet werden echte ' +
      'Buchungen und geplante Einmalbuchungen (Feld „Projekt“ im Buchungsdialog bzw. unter Annahmen). Projektausgaben ' +
      'zählen im Kontostand und in der Prognose, aber nicht gegen das Monatsbudget ihrer Kategorie.'),
    daten.projekte.length === 0
      ? h('p', { class: 'leer' }, 'Noch keine Projekte.')
      : h('div', { class: 'vertrag-summe' },
        h('span', { class: 'klein' }, laufend.length === 1 ? '1 laufendes Projekt' : `${laufend.length} laufende Projekte`),
        h('span', { class: 'betrag stark' }, `Gesamt ${formatEuro(-gesamt)}`)),
    laufend.length > 0 && h('ul', { class: 'vertrag-liste' }, laufend.map((p) => h('li', {}, projektKarte(p, daten, heute)))),
    abgeschlossen.length > 0 && h('details', { class: 'erledigt-liste' },
      h('summary', {}, `Abgeschlossene Projekte (${abgeschlossen.length})`),
      h('ul', { class: 'vertrag-liste' }, abgeschlossen.map((p) => h('li', {}, projektKarte(p, daten, heute))))),
  ].filter(Boolean));
}

const offeneProjekte = new Set(); // aufgeklappte Projekte, solange die App offen ist

/* =========================== Projektkarte =========================== */

function projektKarte(p, daten, heute) {
  const z = projektZahlen(p, daten, heute);
  const kat = new Map(daten.kategorien.map((k) => [k.id, k]));
  const kontoName = new Map(daten.konten.map((k) => [k.id, k.name]));
  const katText = (id) => `${kat.get(kat.get(id)?.elternId)?.name ?? '?'} › ${kat.get(id)?.name ?? '?'}`;
  // Kosten als Betrag: Ausgabe −, Einnahme (z. B. Zuschuss) +
  const betragText = (kosten) => (kosten < 0 ? '+' : '') + formatEuro(-kosten);

  const kommende = z.offen.filter((x) => !x.vergangen);
  const vergangen = z.offen.filter((x) => x.vergangen);

  const geplantZeile = ({ geplant: g, kostenCent, vergangen: alt }) => h('li', {},
    h('button', { type: 'button', class: 'buchung geplant', onclick: () => geplantDialog(g, daten) },
      h('span', { class: 'buchung-text' },
        h('span', { class: 'buchung-titel' },
          h('span', { class: 'datum-klein' }, formatDatum(g.datum)), g.bezeichnung,
          alt && h('span', { class: 'marke marke-warn' }, 'überfällig')),
        h('span', { class: 'buchung-unter' }, [kontoName.get(g.kontoId) ?? '?', g.partner, katText(g.kategorieId)].filter(Boolean).join(' · '))),
      h('span', { class: 'betrag annahme' + (kostenCent < 0 ? ' plus' : '') }, betragText(kostenCent))));

  const istZeile = ({ buchung: b, kostenCent, planCent }) => {
    const abweichung = planCent != null && planCent !== b.betragCent;
    return h('li', {},
      h('button', { type: 'button', class: 'buchung', onclick: () => oeffneBuchungsdialog(b) },
        h('span', { class: 'buchung-text' },
          h('span', { class: 'buchung-titel' },
            h('span', { class: 'datum-klein' }, formatDatum(b.datum)), b.notiz || kat.get(b.kategorieId)?.name || '?',
            b.status === 'vorgemerkt' && h('span', { class: 'marke marke-vorgemerkt' }, 'vorgemerkt')),
          h('span', { class: 'buchung-unter' },
            [kontoName.get(b.kontoId) ?? '?', b.partner, katText(b.kategorieId)].filter(Boolean).join(' · ') +
            (planCent != null ? (abweichung ? ` · geplant waren ${formatEuro(planCent)}` : ' · wie geplant') : ''))),
        h('span', { class: 'betrag' + (kostenCent < 0 ? ' plus' : '') }, betragText(kostenCent))));
  };

  const ueber = z.restCent != null && z.restCent < 0;
  const anteil = p.rahmenCent ? Math.min(1, Math.max(0, z.gesamtCent / p.rahmenCent)) : 0;

  // D161: aufklappbare Zeile wie bei den Verträgen – Name, Stand (Rahmen), Gesamtkosten
  const stand = p.rahmenCent != null
    ? (ueber ? `${formatEuro(-z.restCent)} über Rahmen` : `Rest ${formatEuro(z.restCent)} von ${formatEuro(p.rahmenCent)}`)
    : (p.abgeschlossen ? 'abgeschlossen' : `${z.ist.length} gebucht · ${z.offen.length} geplant`);
  const d = h('details', { class: 'vertrag projekt', open: offeneProjekte.has(p.id) },
    h('summary', { class: 'vertrag-kopf' },
      h('span', { class: 'vertrag-name' }, h('strong', {}, p.name), p.abgeschlossen && h('span', { class: 'marke' }, 'abgeschlossen')),
      h('span', { class: 'vertrag-stand klein' + (ueber ? ' warn-text' : ' gedaempft') }, stand),
      h('span', { class: 'betrag vertrag-kosten' }, formatEuro(-z.gesamtCent))),
    h('div', { class: 'vertrag-inhalt' }, ...[
    p.notiz && h('p', { class: 'hinweis' }, p.notiz),

    h('div', { class: 'projekt-zahlen' },
      kachel('Gebucht (Ist)', formatEuro(z.istCent), '', z.archivCent ? `davon ${formatEuro(z.archivCent)} archiviert` : null),
      kachel('Noch geplant', formatEuro(z.offenCent), 'annahme',
        vergangen.length > 0 && `davon ${formatEuro(vergangen.reduce((s, x) => s + x.kostenCent, 0))} überfällig`),
      kachel('Gesamt', formatEuro(z.gesamtCent), 'stark'),
      p.rahmenCent != null && kachel(ueber ? 'Über Rahmen' : 'Rest vom Rahmen', formatEuro(Math.abs(z.restCent)), ueber ? 'negativ' : '')),
    p.rahmenCent != null && h('div', {},
      h('div', {
        class: 'meter' + (ueber ? ' ueber' : ''),
        role: 'meter',
        'aria-valuemin': '0',
        'aria-valuemax': String(p.rahmenCent),
        'aria-valuenow': String(Math.min(Math.max(z.gesamtCent, 0), p.rahmenCent)),
        'aria-label': `${p.name}: Gesamt ${formatEuro(z.gesamtCent)} von ${formatEuro(p.rahmenCent)} Rahmen`,
      }, h('span', { style: `width:${anteil * 100}%` })),
      h('div', { class: 'klein' + (ueber ? ' warn-text' : '') }, `Rahmen ${formatEuro(p.rahmenCent)}`)),

    h('div', { class: 'tag-kopf' }, h('span', {}, 'Noch geplant'), h('span', { class: 'tag-stand annahme' }, formatEuro(-kommende.reduce((s, x) => s + x.kostenCent, 0)))),
    kommende.length
      ? h('ul', { class: 'liste' }, kommende.map(geplantZeile))
      : h('p', { class: 'leer' }, 'Keine anstehenden geplanten Buchungen.'),
    vergangen.length > 0 && h('details', { class: 'erledigt-liste' },
      h('summary', {}, `Vergangene, noch nicht gebuchte anzeigen (${vergangen.length})`),
      h('p', { class: 'hinweis' }, 'Sie zählen weiter mit, bis du sie beim Konto unter „Noch erwartet“ buchst oder als schon gebucht markierst.'),
      h('ul', { class: 'liste' }, vergangen.map(geplantZeile))),

    h('div', { class: 'tag-kopf' }, h('span', {}, 'Gebucht'), h('span', { class: 'tag-stand' }, formatEuro(-z.istCent))),
    z.ist.length
      ? h('ul', { class: 'liste' }, z.ist.map(istZeile))
      : h('p', { class: 'leer' }, 'Noch keine Buchungen.'),

    h('div', { class: 'knopfreihe' },
      h('button', { type: 'button', class: 'knopf knopf-klein', onclick: () => projektDialog(p, daten) }, 'Bearbeiten'),
      !p.abgeschlossen && h('button', { type: 'button', class: 'knopf knopf-klein', onclick: () => oeffneBuchungsdialog(null, { projektId: p.id, titel: `Buchung für ${p.name}` }) }, '+ Buchung'),
      !p.abgeschlossen && h('button', { type: 'button', class: 'knopf knopf-klein', onclick: () => geplantDialog(null, daten, { projektId: p.id }) }, '+ Geplant')),
    ].filter(Boolean)));
  d.addEventListener('toggle', () => { if (d.open) offeneProjekte.add(p.id); else offeneProjekte.delete(p.id); });
  return d;
}

function kachel(titel, wert, klasse = '', zusatz = null) {
  return h('div', { class: 'kz' },
    h('div', { class: 'klein' }, titel),
    h('div', { class: `kz-wert ${klasse}`.trim() }, wert),
    zusatz && h('div', { class: 'klein' + (klasse === 'annahme' ? ' warn-text' : '') }, zusatz));
}

/* =========================== Dialog =========================== */

export function projektDialog(p, daten) {
  const name = eingabe({ label: 'Name', value: p?.name ?? '', maxlength: 60, placeholder: 'z. B. Umbau Bad', autofocus: true });
  const rahmen = eingabe({
    label: 'Rahmen in € (optional)',
    inputmode: 'decimal',
    placeholder: 'z. B. 20.000,00',
    value: p?.rahmenCent != null ? centZuEingabe(p.rahmenCent) : '',
    hilfe: 'Wie viel das Projekt höchstens kosten soll. Die App zeigt dann, was noch übrig ist.',
  });
  const notiz = eingabe({ label: 'Notiz (optional)', maxlength: 200, value: p?.notiz ?? '' });
  const fertig = h('input', { type: 'checkbox', checked: Boolean(p?.abgeschlossen) });
  const fertigFeld = p && h('label', { class: 'schalter feld-schalter' }, fertig, 'Abgeschlossen (wird unten eingeklappt und ist bei neuen Buchungen nicht mehr wählbar)');

  dialog({
    titel: p ? 'Projekt bearbeiten' : 'Neues Projekt',
    inhalt: [name.feld, rahmen.feld, notiz.feld, fertigFeld].filter(Boolean),
    zusatz: p && {
      text: 'Löschen',
      variante: 'knopf-gefahr',
      onclick: async (d) => {
        const buchungen = daten.buchungen.filter((b) => b.projektId === p.id);
        const geplant = daten.geplant.filter((g) => g.projektId === p.id);
        const ok = await frage({
          titel: 'Projekt löschen?',
          text: [
            `Das Projekt „${p.name}“ wird gelöscht.`,
            `Seine ${buchungen.length} Buchung(en) und ${geplant.length} geplante(n) Einmalbuchung(en) bleiben erhalten – ` +
            'sie gehören dann zu keinem Projekt mehr und zählen wieder gegen das Monatsbudget.',
          ],
          jaText: 'Löschen',
          gefahr: true,
        });
        if (!ok) return;
        const jetzt = new Date().toISOString();
        if (buchungen.length) await db.speichere('buchungen', buchungen.map((b) => ({ ...b, projektId: null, geaendertAm: jetzt })));
        if (geplant.length) await db.speichere('geplant', geplant.map((g) => ({ ...g, projektId: null, geaendertAm: jetzt })));
        await db.loesche('projekte', p.id);
        d.close();
        toast('Projekt gelöscht');
        datenGeaendert();
      },
    },
    onSpeichern: async () => {
      const rahmenText = rahmen.input.value.trim();
      await db.speichere('projekte', baueProjekt({
        name: name.input.value,
        rahmenCent: rahmenText ? parseEuro(rahmenText, 'Rahmen') : null,
        notiz: notiz.input.value,
        abgeschlossen: fertig.checked,
      }, { projekte: daten.projekte, alt: p }));
      toast(p ? 'Projekt gespeichert' : 'Projekt angelegt');
      datenGeaendert();
    },
  });
}
