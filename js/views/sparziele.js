// D157: Bereich „Sparziele“ im Tab Projekte (vierter Umschalter). Ein Sparziel misst den Kontostand
// eines Kontos; die Prognose (Zeitleiste) zeigt, wann es voraussichtlich erreicht wird.

import { h } from '../dom.js';
import * as db from '../db.js';
import { formatEuro, formatDatum, formatProzent, centZuEingabe, parseEuro, heuteIso } from '../format.js';
import { dialog, frage, toast, eingabe, auswahl, datenGeaendert } from '../ui.js';
import { sortiereKonten } from '../konten.js';
import { kontostand } from '../rechnen.js';
import { zeitleiste, nurWirksam } from '../prognose.js';
import { baueSparziel, sparzielStand } from '../sparziele.js';
import { monatLang } from '../rueckblick.js';

const nachName = (a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' });

/** daten: braucht sparziele, konten, kategorien, buchungen, budgets, wiederkehrend, geplant */
export function sparzieleBereich(daten) {
  const heute = heuteIso();
  const offen = daten.sparziele.filter((z) => !z.abgeschlossen).sort(nachName);
  const fertig = daten.sparziele.filter((z) => z.abgeschlossen).sort(nachName);
  // Prognose nur, wenn es Sparziele gibt (die Zeitleiste bis 2050 kostet etwas Rechenzeit)
  const zl = offen.length ? zeitleiste(nurWirksam(daten), heute) : null;

  return h('section', { class: 'bereich sparziele', 'aria-labelledby': 'titel-sparziele' }, ...[
    h('div', { class: 'bereich-kopf' },
      h('h2', { id: 'titel-sparziele' }, 'Sparziele'),
      h('button', { type: 'button', class: 'knopf knopf-klein', onclick: () => sparzielDialog(null, daten) }, '+ Sparziel')),
    h('p', { class: 'hinweis erklaerung' },
      'Ein Sparziel misst den Stand eines Kontos, z. B. „Tagesgeld 10.000 € bis Ende 2027“. Wann es erreicht wird, ' +
      'berechnet die App aus der Prognose (wiederkehrende Buchungen, Budgets, geplante Buchungen).'),
    daten.sparziele.length === 0 && h('p', { class: 'leer' }, 'Noch keine Sparziele.'),
    ...offen.map((z) => sparzielKarte(z, daten, zl, heute)),
    fertig.length > 0 && h('details', { class: 'erledigt-liste' },
      h('summary', {}, `Abgeschlossene Sparziele (${fertig.length})`),
      ...fertig.map((z) => sparzielKarte(z, daten, null, heute))),
  ].filter(Boolean));
}

function sparzielKarte(z, daten, zl, heute) {
  const konto = daten.konten.find((k) => k.id === z.kontoId);
  const stand = konto ? kontostand(konto, daten.buchungen, heute) : 0;
  const s = sparzielStand(z, {
    standHeute: stand,
    prognoseMonatsende: zl?.start.jeKonto.get(z.kontoId)?.prognose ?? stand,
    zeilen: zl?.jeKonto.get(z.kontoId) ?? [],
    heute,
  });

  let prognoseText = null;
  let prognoseKlasse = '';
  if (!z.abgeschlossen && zl) {
    if (s.erreicht) { prognoseText = 'Ziel erreicht ✓'; prognoseKlasse = 'plus'; }
    else if (!s.erreichtMonat) { prognoseText = 'Mit der jetzigen Planung bis 2050 nicht erreicht.'; prognoseKlasse = 'warn-text'; }
    else {
      prognoseText = `Voraussichtlich erreicht: ${monatLang(s.erreichtMonat)}`;
      if (s.rechtzeitig === true) { prognoseText += ' – rechtzeitig ✓'; prognoseKlasse = 'plus'; }
    }
    if (s.rechtzeitig === false && s.fehlbetragCent > 0) {
      prognoseText += ` · Zum ${formatDatum(z.zielDatum)} fehlen voraussichtlich ${formatEuro(s.fehlbetragCent)} – ` +
        `dafür zusätzlich etwa ${formatEuro(s.noetigProMonatCent)} im Monat zurücklegen.`;
      prognoseKlasse = 'warn-text';
    }
  }

  return h('section', { class: 'bereich sparziel', 'aria-label': `Sparziel ${z.name}` },
    h('div', { class: 'bereich-kopf' },
      h('h3', { class: 'sparziel-name' }, z.name, h('span', { class: 'klein gedaempft' }, ` · ${konto?.name ?? 'Konto gelöscht'}`),
        z.abgeschlossen && h('span', { class: 'marke' }, 'abgeschlossen')),
      h('button', { type: 'button', class: 'knopf knopf-klein', onclick: () => sparzielDialog(z, daten) }, 'Bearbeiten')),
    h('div', {
      class: 'meter' + (s.erreicht ? ' erreicht' : ''),
      role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': String(z.zielCent), 'aria-valuenow': String(Math.max(0, Math.min(stand, z.zielCent))),
      'aria-label': `${z.name}: ${formatEuro(stand)} von ${formatEuro(z.zielCent)}`,
    }, h('span', { style: `width:${s.anteil * 100}%` })),
    h('div', { class: 'sparziel-zahlen' },
      h('span', {}, h('strong', {}, formatEuro(stand)), ` von ${formatEuro(z.zielCent)}`),
      h('span', { class: 'klein gedaempft' }, `${formatProzent(s.anteil)}${z.zielDatum ? ` · Ziel bis ${formatDatum(z.zielDatum)}` : ''}`)),
    prognoseText && h('p', { class: `klein sparziel-prognose ${prognoseKlasse}`.trim() }, prognoseText),
    z.notiz && h('p', { class: 'klein gedaempft' }, z.notiz));
}

export function sparzielDialog(z, daten) {
  const konten = sortiereKonten(daten.konten.filter((k) => !k.archiviert || k.id === z?.kontoId));
  if (!konten.length) { toast('Bitte zuerst unter Stammdaten ein Konto anlegen.'); return; }
  const name = eingabe({ label: 'Name', value: z?.name ?? '', maxlength: 60, placeholder: 'z. B. Notgroschen, Neues Auto', autofocus: !z });
  const konto = auswahl({
    label: 'Konto', optionen: konten.map((k) => ({ wert: k.id, text: k.name })),
    wert: z?.kontoId ?? (konten.find((k) => /tagesgeld|spar/i.test(k.name)) ?? konten[0]).id,
    hilfe: 'Gemessen wird der Stand dieses Kontos.',
  });
  const ziel = eingabe({ label: 'Zielbetrag in €', inputmode: 'decimal', placeholder: 'z. B. 10.000,00', value: z ? centZuEingabe(z.zielCent) : '' });
  const datum = eingabe({ label: 'Erreichen bis (optional)', type: 'date', value: z?.zielDatum ?? '' });
  const notiz = eingabe({ label: 'Notiz (optional)', maxlength: 200, value: z?.notiz ?? '' });
  const fertig = h('input', { type: 'checkbox', checked: Boolean(z?.abgeschlossen) });
  const fertigFeld = z && h('label', { class: 'schalter feld-schalter' }, fertig, 'Abgeschlossen (wird unten eingeklappt)');

  dialog({
    titel: z ? 'Sparziel bearbeiten' : 'Neues Sparziel',
    inhalt: [name.feld, konto.feld, h('div', { class: 'feld-paar' }, ziel.feld, datum.feld), notiz.feld, fertigFeld].filter(Boolean),
    zusatz: z && {
      text: 'Löschen',
      variante: 'knopf-gefahr',
      onclick: async (d) => {
        if (!await frage({ titel: 'Sparziel löschen?', text: [`„${z.name}“ wird gelöscht. Konto und Buchungen bleiben unverändert.`], jaText: 'Löschen', gefahr: true })) return;
        await db.loesche('sparziele', z.id);
        d.close();
        toast('Sparziel gelöscht');
        datenGeaendert();
      },
    },
    onSpeichern: async () => {
      await db.speichere('sparziele', baueSparziel({
        name: name.input.value,
        kontoId: konto.select.value,
        zielCent: parseEuro(ziel.input.value, 'Zielbetrag'),
        zielDatum: datum.input.value,
        notiz: notiz.input.value,
        abgeschlossen: fertig.checked,
      }, { sparziele: daten.sparziele, konten: daten.konten, alt: z }));
      toast(z ? 'Sparziel gespeichert' : 'Sparziel angelegt');
      datenGeaendert();
    },
  });
}
