// D167: Dialog „Steuer“ (aus „Alle Buchungen“): steuerlich relevante Ausgaben eines Jahres je Thema,
// als Druckansicht/PDF, CSV und alle zugehörigen Belege als ZIP-Datei.

import { h } from '../dom.js';
import { formatEuro, formatDatum, heuteIso } from '../format.js';
import { dialog, toast, herunterladen, katPunkt } from '../ui.js';
import { steuerJahr, steuerJahre, steuerCsv, zipNamen } from '../steuer.js';
import { erzeugeZip } from '../zip.js';
import { farbenZuordnung, farbeVon } from '../farben.js';
import { belegDatei } from '../sync/abgleich.js';
import { oeffneBuchungsdialog } from './buchung-dialog.js';

let gewaehltesJahr = null; // solange die App offen ist

function inhalt(erg, daten, { druck = false } = {}) {
  const kat = new Map(daten.kategorien.map((k) => [k.id, k]));
  const farben = farbenZuordnung(daten.kategorien);
  if (!erg.anzahl) {
    return [h('p', { class: 'leer' }, `Keine steuerlich relevanten Ausgaben in ${erg.jahr}.`),
      h('p', { class: 'hinweis' }, 'Markieren: Stammdaten → Kategorien → Unterkategorie bearbeiten → „Steuerthema“. ' +
        'Einzelne Buchungen lassen sich im Buchungsdialog unter „Weitere Angaben“ abweichend einstellen.')];
  }
  return [
    h('table', { class: 'rb-tabelle' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Steuerthema'), h('th', { class: 'zahl' }, 'Anzahl'), h('th', { class: 'zahl' }, 'Summe'))),
      h('tbody', {},
        erg.themen.map((t) => h('tr', {}, h('td', {}, t.name), h('td', { class: 'zahl' }, String(t.buchungen.length)), h('td', { class: 'zahl' }, formatEuro(t.summeCent)))),
        h('tr', { class: 'rb-summe' }, h('td', {}, `Gesamt ${erg.jahr}`), h('td', { class: 'zahl' }, String(erg.anzahl)), h('td', { class: 'zahl' }, formatEuro(erg.gesamtCent))))),
    ...erg.themen.map((t) => {
      const zeilen = t.buchungen.map((b) => {
        const unter = kat.get(b.kategorieId);
        const text = [b.partner, unter?.name, b.notiz].filter(Boolean).join(' · ') || 'Ausgabe';
        const belege = (b.belege ?? []).length;
        return druck
          ? h('tr', {}, h('td', {}, formatDatum(b.datum)), h('td', {}, text), h('td', {}, (b.belege ?? []).map((x) => x.name).join(', ')), h('td', { class: 'zahl' }, formatEuro(b.betragCent)))
          : h('li', {}, h('button', { type: 'button', class: 'steuer-zeile', onclick: () => oeffneBuchungsdialog(b) },
            h('span', { class: 'rb-datum' }, formatDatum(b.datum)),
            h('span', { class: 'rb-text' }, katPunkt(farbeVon(b.kategorieId, kat, farben)), text),
            h('span', { class: 'klein gedaempft', title: belege ? `${belege} Beleg(e)` : 'ohne Beleg' }, belege ? `📎${belege > 1 ? belege : ''}` : '–'),
            h('span', { class: 'betrag' }, formatEuro(b.betragCent))));
      });
      return [
        h('h3', { class: 'rb-titel' }, `${t.name} · ${formatEuro(t.summeCent)}`),
        druck
          ? h('table', {}, h('thead', {}, h('tr', {}, ['Datum', 'Ausgabe', 'Belege', 'Betrag'].map((x, i) => h('th', { class: i === 3 ? 'zahl' : null }, x)))), h('tbody', {}, zeilen))
          : h('ul', { class: 'rb-groesste steuer-liste' }, zeilen),
      ];
    }).flat(),
  ];
}

export function oeffneSteuer(daten) {
  const heute = heuteIso();
  const jahre = steuerJahre(daten.buchungen, daten.kategorien, heute);
  const aktuell = Number(heute.slice(0, 4));
  if (!jahre.includes(aktuell)) jahre.unshift(aktuell);
  gewaehltesJahr ??= jahre.includes(aktuell - 1) ? aktuell - 1 : jahre[0];
  const wahl = h('select', { 'aria-label': 'Steuerjahr' }, jahre.map((j) => h('option', { value: String(j) }, String(j))));
  wahl.value = String(gewaehltesJahr);
  const bereich = h('div', { class: 'rb-inhalt' });
  const rechne = () => steuerJahr(daten.buchungen, daten.kategorien, gewaehltesJahr, heute);
  const zeichne = () => bereich.replaceChildren(...inhalt(rechne(), daten));
  wahl.addEventListener('change', () => { gewaehltesJahr = Number(wahl.value); zeichne(); });
  zeichne();

  const csvKnopf = h('button', {
    type: 'button', class: 'knopf knopf-klein',
    onclick: () => herunterladen(steuerCsv(rechne(), daten), `finanzen-steuer-${gewaehltesJahr}-${heute}.csv`, 'text/csv;charset=utf-8'),
  }, 'CSV');
  const zipKnopf = h('button', { type: 'button', class: 'knopf knopf-klein', onclick: () => belegeAlsZip(rechne(), zipKnopf) }, 'Belege als ZIP');

  const dlg = dialog({
    titel: 'Steuer',
    inhalt: [
      h('div', { class: 'rb-wahl' }, h('span', { class: 'klein' }, 'Steuerjahr'), wahl, csvKnopf, zipKnopf),
      h('p', { class: 'klein gedaempft' }, 'Ausgaben auf Unterkategorien mit Steuerthema (Stammdaten → Kategorien); einzelne Buchungen können abweichen. Keine Steuerberatung.'),
      bereich,
    ],
    speichernText: 'Drucken / PDF',
    abbrechenText: 'Schließen',
    onSpeichern: () => {
      const erg = rechne();
      setTimeout(() => drucke(erg, daten), 50);
    },
  });
  dlg.classList.add('rb-dialog');
}

/** Alle Belege der steuerlich relevanten Ausgaben in eine ZIP-Datei (je Thema ein Ordner) */
async function belegeAlsZip(erg, knopf) {
  const eintraege = erg.themen.flatMap((t) => t.buchungen.flatMap((b) => (b.belege ?? []).map((beleg) => ({ thema: t.schluessel, beleg, buchung: b }))));
  if (!eintraege.length) { toast('Keine Belege vorhanden.'); return; }
  const text = knopf.textContent;
  knopf.disabled = true;
  const namen = zipNamen(eintraege);
  const dateien = [];
  const fehlend = [];
  for (let i = 0; i < eintraege.length; i++) {
    knopf.textContent = `Belege … ${i + 1}/${eintraege.length}`;
    try {
      const blob = await belegDatei(eintraege[i].beleg);
      dateien.push({ name: namen[i], daten: new Uint8Array(await blob.arrayBuffer()) });
    } catch (err) {
      fehlend.push(`${formatDatum(eintraege[i].buchung.datum)} ${eintraege[i].beleg.name}: ${err.message ?? err}`);
    }
  }
  if (fehlend.length) dateien.push({ name: 'Fehlende Belege.txt', daten: new TextEncoder().encode(fehlend.join('\r\n')) });
  herunterladen(new Blob([erzeugeZip(dateien)], { type: 'application/zip' }), `finanzen-steuer-${erg.jahr}-belege.zip`, 'application/zip');
  knopf.textContent = text;
  knopf.disabled = false;
  toast(fehlend.length ? `ZIP erstellt – ${fehlend.length} Beleg(e) fehlen (Liste in der ZIP-Datei)` : `ZIP mit ${dateien.length} Beleg(en) erstellt`);
}

function drucke(erg, daten) {
  const bereich = h('div', { id: 'druckbereich', class: 'druck-rueckblick' },
    h('h1', {}, `Steuerlich relevante Ausgaben ${erg.jahr}`),
    h('p', {}, `Stand ${formatDatum(heuteIso())} · keine Steuerberatung`),
    ...inhalt(erg, daten, { druck: true }));
  document.getElementById('druckbereich')?.remove();
  document.body.append(bereich);
  const weg = () => { bereich.remove(); window.removeEventListener('afterprint', weg); };
  window.addEventListener('afterprint', weg);
  window.print();
}
