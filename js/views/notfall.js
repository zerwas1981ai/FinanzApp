// D168: Stammdaten → „Notfall-Mappe“: eigene Hinweise für Angehörige und ein druckbares PDF mit Konten,
// Verträgen und laufenden Zahlungen. Keine Zugangsdaten. Die Hinweise liegen in „einstellungen“ (id 'notfall').

import { h } from '../dom.js';
import * as db from '../db.js';
import { formatEuro, formatDatum, heuteIso } from '../format.js';
import { toast } from '../ui.js';
import { notfallDaten } from '../notfall.js';

const datum = (iso) => (iso ? formatDatum(iso) : '–');
const isoText = (text) => text.replace(/\d{4}-\d{2}-\d{2}/g, (iso) => formatDatum(iso)); // „nächstes Ende 2026-12-31“ → 31.12.2026

export async function notfallBereich() {
  const gespeichert = await db.hole('einstellungen', 'notfall');
  const feld = h('textarea', {
    id: 'notfall-hinweise', rows: 7, maxlength: 4000, class: 'notfall-text',
    placeholder: 'z. B. Ordner „Finanzen“ im Arbeitszimmer · Steuerberater: … · Ansprechpartner Bank: … · Testament liegt bei …',
  });
  feld.value = gespeichert?.text ?? '';

  const speichern = async () => {
    await db.speichere('einstellungen', { id: 'notfall', text: feld.value.trim(), geaendertAm: new Date().toISOString() });
    toast('Hinweise gespeichert');
  };

  return h('section', { class: 'bereich', 'aria-labelledby': 'titel-notfall' },
    h('div', { class: 'bereich-kopf' },
      h('h2', { id: 'titel-notfall' }, 'Notfall-Mappe'),
      h('button', { type: 'button', class: 'knopf knopf-primaer', onclick: async () => { await speichern(); await drucke(feld.value.trim()); } }, 'Drucken / PDF')),
    h('p', { class: 'hinweis erklaerung' },
      'Eine Übersicht für Angehörige, falls dir etwas passiert: alle Konten mit aktuellem Stand, Verträge und Versicherungen ' +
      '(mit Vertragsnummer und Kündigungsfrist), laufende Zahlungen und deine eigenen Hinweise. Bewusst ohne Zugangsdaten, ' +
      'Passwörter oder PINs. Am besten ausdrucken oder als PDF an einem sicheren Ort ablegen und ab und zu erneuern.'),
    h('div', { class: 'feld' },
      h('label', { for: 'notfall-hinweise' }, 'Eigene Hinweise (erscheinen oben in der Mappe)'),
      feld,
      h('small', { class: 'feld-hilfe' }, 'Bitte keine Passwörter, PINs oder Zugangsdaten eintragen.')),
    h('div', { class: 'knopfreihe' }, h('button', { type: 'button', class: 'knopf', onclick: speichern }, 'Hinweise speichern')));
}

async function drucke(hinweise) {
  const namen = ['konten', 'buchungen', 'abstimmungen', 'vertraege', 'wiederkehrend', 'kategorien'];
  const werte = await Promise.all(namen.map((n) => db.alle(n)));
  const heute = heuteIso();
  const d = notfallDaten({ ...Object.fromEntries(namen.map((n, i) => [n, werte[i]])), heute });
  const tabelle = (kopf, zeilen) => h('table', {},
    h('thead', {}, h('tr', {}, kopf.map(([t, zahl]) => h('th', { class: zahl ? 'zahl' : null }, t)))),
    h('tbody', {}, zeilen.map((z) => h('tr', {}, z.map((c, i) => h('td', { class: kopf[i][1] ? 'zahl' : null }, c))))));

  const bereich = h('div', { id: 'druckbereich', class: 'druck-rueckblick druck-notfall' },
    h('h1', {}, 'Notfall-Mappe Finanzen'),
    h('p', {}, `Stand ${formatDatum(heute)} · Diese Mappe enthält bewusst keine Zugangsdaten, Passwörter oder PINs.`),
    hinweise && h('h3', {}, 'Hinweise'),
    hinweise && h('div', { class: 'notfall-hinweise' }, hinweise.split(/\n/).map((z) => h('p', {}, z))),
    h('h3', {}, 'Konten'),
    tabelle([['Konto'], ['Stand heute', true], ['Zuletzt abgestimmt']],
      d.konten.map((k) => [k.name, formatEuro(k.standCent), datum(k.abgestimmtAm)])),
    h('h3', {}, 'Verträge und Versicherungen'),
    d.vertraege.length
      ? tabelle([['Vertrag'], ['Empfänger'], ['Vertragsnr.'], ['Kosten/Monat', true], ['Kündigungsfrist'], ['Laufzeit']],
        d.vertraege.map((v) => [v.name + (v.notiz ? ` (${v.notiz})` : ''), v.empfaenger, v.vertragsnummer || '–',
          v.monatCent != null ? formatEuro(v.monatCent) : '–', v.frist, isoText(v.ende)]))
      : h('p', {}, 'Keine Verträge erfasst.'),
    h('h3', {}, 'Laufende Zahlungen'),
    d.zahlungen.length
      ? tabelle([['Zahlung'], ['Kategorie'], ['Konto'], ['Intervall'], ['Betrag', true]],
        d.zahlungen.map((z) => [z.text, z.kategorie, z.konto, z.intervall,
          (z.art === 'einnahme' ? '+' : z.art === 'ausgabe' ? '−' : '') + formatEuro(z.betragCent)]))
      : h('p', {}, 'Keine laufenden Zahlungen erfasst.'),
    h('h3', {}, 'Wo liegen die Daten?'),
    h('p', {}, 'Die Finanz-App speichert ihre Daten im Google Drive des Kontoinhabers im Ordner „Finanzapp“ ' +
      '(Unterordner „Belege“, „Relevante Ausgaben“, „Verträge“ und „Backups“).'));
  document.getElementById('druckbereich')?.remove();
  document.body.append(bereich);
  const weg = () => { bereich.remove(); window.removeEventListener('afterprint', weg); };
  window.addEventListener('afterprint', weg);
  window.print();
}
