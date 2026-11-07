// Block "Relevante Ausgaben" unten im Tab "Projekte" (D74).
// Eigene Einträge (auch weit zurück) plus echte Ausgaben mit Häkchen "Relevante Ausgabe".
// Eigene Einträge zählen nirgends mit (kein Konto, kein Budget, keine Prognose).

import { h } from '../dom.js';
import * as db from '../db.js';
import { formatEuro, formatDatum, parseEuro, centZuEingabe, heuteIso } from '../format.js';
import { dialog, toast, eingabe, auswahl, datenGeaendert } from '../ui.js';
import {
  baueRelevant, relevanteZeilen, gruppenListe, filtereGruppe, nachJahren, OHNE_GRUPPE,
} from '../relevant.js';
import { belegeFeld } from './belege.js';
import { oeffneBuchungsdialog, partnerFeld, fuelleKategorien, gruppeFeld } from './buchung-dialog.js';
import { ladeArchive } from './alle-buchungen.js';

// Ansicht merken, solange die App offen ist
const ansicht = { gruppe: '', offen: null }; // offen: Set der aufgeklappten Jahre (null = neuestes Jahr)

/**
 * Der Block für die Projekte-Seite.
 * daten: braucht konten, kategorien, buchungen, relevant, archive
 */
export async function relevantBereich(daten) {
  const { geladen, fehlend } = await ladeArchive(daten.archive ?? [], false);
  const archivBuchungen = geladen.flatMap(({ eintrag, inhalt }) => inhalt.buchungen.map((b) => ({ ...b, archivJahr: eintrag.jahr })));
  const alleZeilen = relevanteZeilen({ relevant: daten.relevant, buchungen: daten.buchungen, archivBuchungen });
  const gruppen = gruppenListe(alleZeilen);
  if (ansicht.gruppe && ansicht.gruppe !== OHNE_GRUPPE && !gruppen.some((g) => g.toLocaleLowerCase('de') === ansicht.gruppe.toLocaleLowerCase('de'))) ansicht.gruppe = '';
  const zeilen = filtereGruppe(alleZeilen, ansicht.gruppe);
  const jahre = nachJahren(zeilen);
  const gesamt = zeilen.reduce((s, z) => s + z.betragCent, 0);

  const bereich = h('section', { class: 'bereich relevant', 'aria-labelledby': 'titel-relevant' });
  const neu = async () => bereich.replaceWith(await relevantBereich(daten));

  const chip = (wert, text) => h('button', {
    type: 'button',
    class: 'chip',
    'aria-pressed': String(ansicht.gruppe === wert),
    onclick: () => { ansicht.gruppe = wert; neu(); },
  }, text);
  const gruppenWahl = gruppen.length > 0 && h('div', { class: 'chips', role: 'group', 'aria-label': 'Gruppe' },
    chip('', 'Alle'), gruppen.map((g) => chip(g, g)), alleZeilen.some((z) => !z.gruppe) && chip(OHNE_GRUPPE, 'Ohne Gruppe'));

  const offen = ansicht.offen ?? new Set(jahre.slice(0, 1).map((j) => j.jahr));
  const jahrBlock = (j) => {
    const d = h('details', { class: 'relevant-jahr', open: offen.has(j.jahr) },
      h('summary', {},
        h('span', { class: 'relevant-jahr-name' }, String(j.jahr)),
        h('span', { class: 'klein' }, j.zeilen.length === 1 ? '1 Ausgabe' : `${j.zeilen.length} Ausgaben`),
        h('span', { class: 'betrag' }, formatEuro(-j.summeCent))),
      tabelle(j.zeilen, daten));
    d.addEventListener('toggle', () => {
      ansicht.offen ??= new Set(offen);
      if (d.open) ansicht.offen.add(j.jahr);
      else ansicht.offen.delete(j.jahr);
    });
    return d;
  };

  bereich.append(...[
    h('div', { class: 'bereich-kopf' },
      h('h2', { id: 'titel-relevant' }, 'Relevante Ausgaben'),
      h('button', { type: 'button', class: 'knopf knopf-klein', onclick: () => relevantDialog(null, daten) }, '+ Ausgabe')),
    h('p', { class: 'hinweis' },
      'Sammle hier Ausgaben, die dir wichtig sind – auch aus früheren Jahren. Eigene Einträge zählen in keinem Konto, ' +
      'Budget und nicht in der Prognose. Echte Buchungen erscheinen hier, wenn du im Buchungsdialog „Relevante Ausgabe“ ' +
      'anhakst. Belege liegen in Google Drive zusätzlich im Ordner „Relevante Ausgaben“.'),
    fehlend.length > 0 && h('p', { class: 'hinweis warn-text' },
      `Archivierte Jahre ${fehlend.join(', ')} sind auf diesem Gerät noch nicht geladen – markierte Buchungen daraus fehlen. ` +
      'Unter „Alle Buchungen“ lassen sie sich aus Google Drive laden.'),
    gruppenWahl,
    alleZeilen.length === 0
      ? h('p', { class: 'leer' }, 'Noch keine relevanten Ausgaben.')
      : h('div', { class: 'relevant-gesamt' },
        h('span', { class: 'klein' }, `${zeilen.length === 1 ? '1 Ausgabe' : `${zeilen.length} Ausgaben`}${ansicht.gruppe ? ' in dieser Gruppe' : ''}`),
        h('span', { class: 'betrag stark' }, `Gesamt ${formatEuro(-gesamt)}`)),
    ...jahre.map(jahrBlock),
  ].filter(Boolean));
  return bereich;
}

/** Tabelle eines Jahres – aufgebaut wie "Alle Buchungen" (am Handy zweizeilig) */
function tabelle(zeilen, daten) {
  const kat = new Map(daten.kategorien.map((k) => [k.id, k]));
  const kontoName = new Map(daten.konten.map((k) => [k.id, k.name]));
  const kopf = h('div', { class: 'btab-kopf', role: 'row', 'aria-hidden': 'true' },
    [['datum', 'Datum'], ['partner', 'Empfänger'], ['kategorie', 'Kategorie'], ['konto', 'Gruppe'], ['notiz', 'Notiz'], ['betrag', 'Betrag']]
      .map(([feld, text]) => h('span', { class: `btab-sort btab-fest btab-${feld}` }, text)));

  const zeile = (z) => {
    const unter = kat.get(z.kategorieId);
    const katText = unter ? [kat.get(unter.elternId)?.name, unter.name].filter(Boolean).join(' › ') : '';
    const anzahlBelege = z.belege.length;
    return h('li', { role: 'row' },
      h('button', {
        type: 'button',
        class: 'btab-zeile',
        onclick: () => {
          if (z.archivJahr) toast(`Archiv ${z.archivJahr}: nur lesen. Zum Ändern das Jahr in den Stammdaten zurückholen.`);
          else if (z.quelle === 'buchung') oeffneBuchungsdialog(z.ref);
          else relevantDialog(z.ref, daten);
        },
      },
      h('span', { class: 'btab-zelle btab-partner' },
        z.partner
          ? h('span', { class: 'btab-partner-name' }, z.partner)
          : [h('span', { class: 'nur-breit gedaempft' }, '–'), h('span', { class: 'nur-schmal btab-partner-name' }, unter?.name ?? z.notiz ?? 'Ausgabe')],
        z.quelle === 'buchung' && h('span', { class: 'marke marke-projekt', title: 'Echte Buchung von diesem Konto' }, kontoName.get(z.kontoId) ?? 'Buchung'),
        z.archivJahr && h('span', { class: 'marke' }, 'Archiv'),
        anzahlBelege > 0 && h('span', { class: 'beleg-zahl', title: `${anzahlBelege} Beleg(e)` }, `📎${anzahlBelege > 1 ? anzahlBelege : ''}`)),
      h('span', { class: 'btab-unter' },
        h('span', { class: 'btab-zelle btab-datum' }, formatDatum(z.datum)),
        h('span', { class: 'btab-zelle btab-kategorie', title: katText || null }, katText),
        h('span', { class: 'btab-zelle btab-konto' }, z.gruppe),
        h('span', { class: 'btab-zelle btab-notiz', title: z.notiz || null }, z.notiz)),
      h('span', { class: 'btab-zelle btab-betrag betrag' }, formatEuro(-z.betragCent))));
  };

  return h('div', { class: 'btab', role: 'table', 'aria-label': 'Relevante Ausgaben' },
    kopf,
    h('ul', { class: 'btab-liste', role: 'rowgroup' }, zeilen.map(zeile)));
}

/* =========================== Dialog =========================== */

/** Eigene relevante Ausgabe erfassen oder bearbeiten – aufgebaut wie der Buchungsdialog */
export function relevantDialog(e, daten) {
  const betrag = eingabe({
    label: 'Betrag in €',
    inputmode: 'decimal',
    placeholder: '0,00',
    value: e ? centZuEingabe(e.betragCent) : '',
    autofocus: true,
    class: 'eingabe-betrag',
  });
  const partner = partnerFeld([...daten.buchungen, ...daten.relevant], e?.partner ?? '', 'ausgabe');
  const kategorie = auswahl({ label: 'Kategorie (optional)', optionen: [] });
  fuelleKategorien(kategorie.select, daten.kategorien, 'ausgabe', e?.kategorieId ?? '');
  if (kategorie.select.options[0]) kategorie.select.options[0].textContent = 'Ohne Kategorie';
  const datum = eingabe({ label: 'Datum', type: 'date', value: e?.datum ?? heuteIso(), min: '1990-01-01' });
  const gruppen = gruppenListe(relevanteZeilen({ relevant: daten.relevant, buchungen: daten.buchungen }));
  const gruppe = gruppeFeld(gruppen, e?.gruppe ?? '');
  const notiz = eingabe({ label: 'Notiz (optional)', maxlength: 200, value: e?.notiz ?? '', placeholder: 'z. B. Einbauküche, Garantie bis 2030' });
  const belege = belegeFeld(e?.belege ?? [], () => [
    datum.input.value,
    partner.input.value.trim() || notiz.input.value.trim() || 'Relevante Ausgabe',
  ].filter(Boolean).join(' '));

  dialog({
    titel: e ? 'Relevante Ausgabe bearbeiten' : 'Neue relevante Ausgabe',
    inhalt: [
      h('p', { class: 'hinweis' }, 'Zählt in keinem Konto, Budget und nicht in der Prognose.'),
      betrag.feld, partner.feld, kategorie.feld, datum.feld, gruppe.feld, notiz.feld, belege.feld,
    ],
    speichernText: e ? 'Speichern' : 'Erfassen',
    zusatz: e && {
      text: 'In den Papierkorb',
      variante: 'knopf-gefahr',
      onclick: async (d) => {
        const zeit = new Date().toISOString();
        await db.speichere('relevant', { ...e, geloeschtAm: zeit, geaendertAm: zeit });
        d.close();
        toast('In den Papierkorb gelegt (Stammdaten → Papierkorb)');
        datenGeaendert();
      },
    },
    onSpeichern: async () => {
      const eintrag = baueRelevant({
        betragCent: parseEuro(betrag.input.value, 'Betrag'),
        datum: datum.input.value,
        partner: partner.input.value,
        kategorieId: kategorie.select.value,
        notiz: notiz.input.value,
        gruppe: gruppe.input.value,
        belege: belege.liste(),
      }, { alt: e });
      await db.speichere('relevant', eintrag);
      await belege.uebernehme(); // neue Dateien ablegen, entfernte vormerken
      toast(e ? 'Gespeichert' : 'Relevante Ausgabe erfasst');
      datenGeaendert();
    },
  });
}
