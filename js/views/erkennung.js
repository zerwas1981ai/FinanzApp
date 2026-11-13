// D182/D185: ruhige Hinweise oben in der Übersicht – erkannte wiederkehrende Zahlungen und Archiv-Erinnerung.
// Die App schlägt nur vor; angelegt oder archiviert wird erst nach einem Klick.

import { h } from '../dom.js';
import * as db from '../db.js';
import { formatEuro, formatDatum, heuteIso } from '../format.js';
import { klappBereich, toast, datenGeaendert, geraet, frage } from '../ui.js';
import { wiederkehrendDialog } from './annahmen.js';
import { plusTage } from '../vertraege.js';

let erkanntOffen = false;
let archivOffen = false;

/** Abgelehnte Vorschläge (Schlüssel „art|empfänger“), über Drive abgeglichen (einstellungen, id 'erkennung') */
export const abgelehnteVorschlaege = (einstellungen = []) => einstellungen.find((e) => e.id === 'erkennung')?.abgelehnt ?? [];

/** Erster Termin: der nächste Monat nach der letzten Buchung, gleicher Tag (am Monatsende gekürzt) */
function naechsterTermin(letzte, tag) {
  const j = Number(letzte.slice(0, 4));
  const m = Number(letzte.slice(5, 7));
  const nj = m === 12 ? j + 1 : j;
  const nm = m === 12 ? 1 : m + 1;
  const letzter = new Date(Date.UTC(nj, nm, 0)).getUTCDate();
  return `${nj}-${String(nm).padStart(2, '0')}-${String(Math.min(tag, letzter)).padStart(2, '0')}`;
}

/** D182: „Wiederkehrende Zahlung erkannt“ – daten braucht konten, kategorien, buchungen, vertraege, einstellungen */
export function erkanntBereich(vorschlaege, daten) {
  if (!vorschlaege.length) return null;
  const namen = vorschlaege.map((v) => v.partner).join(', ');
  return klappBereich({
    klasse: 'hinweise-klapp',
    titel: `${vorschlaege.length === 1 ? 'Wiederkehrende Zahlung erkannt' : `${vorschlaege.length} wiederkehrende Zahlungen erkannt`} · ${namen}`,
    offen: erkanntOffen,
    beiWechsel: (o) => { erkanntOffen = o; },
  }, h('div', { class: 'hinweiskarten' }, vorschlaege.map((v) => {
    const artText = v.art === 'einnahme' ? 'Einnahme' : 'Ausgabe';
    const ablehnen = async () => {
      const alt = (await db.hole('einstellungen', 'erkennung')) ?? { id: 'erkennung', abgelehnt: [] };
      await db.speichere('einstellungen', { ...alt, abgelehnt: [...new Set([...(alt.abgelehnt ?? []), v.schluessel])], geaendertAm: new Date().toISOString() });
      toast(`${v.partner}: kein Vorschlag mehr`);
      datenGeaendert();
    };
    return h('section', { class: 'bereich hinweiskarte', 'aria-label': `Erkannt: ${v.partner}` },
      h('h2', {}, h('span', { class: 'klein' }, 'Erkannt · '), v.partner),
      h('p', {}, `Seit ${v.monate} Monaten jeden Monat etwa ${formatEuro(v.betragCent)} (zuletzt am ${formatDatum(v.letzte)}). ` +
        `Als wiederkehrende ${artText} anlegen? Dann rechnet die Prognose damit.`),
      h('div', { class: 'hinweis-aktionen' },
        h('button', {
          type: 'button', class: 'knopf knopf-primaer',
          onclick: () => wiederkehrendDialog(null, daten, {
            art: v.art, kontoId: v.kontoId, kategorieId: v.kategorieId, partner: v.partner, betragCent: v.betragCent,
            intervall: 'monatlich', start: naechsterTermin(v.letzte, v.tag), monatsletzter: false,
            titel: 'Als wiederkehrende Buchung anlegen',
          }),
        }, 'Anlegen …'),
        h('button', { type: 'button', class: 'knopf', onclick: ablehnen }, 'Nicht wiederkehrend')));
  })));
}

/**
 * D183/D186: Marke „↑ hoch“ an einer ungewöhnlich hohen Ausgabe. Antippen fragt „Betrag stimmt?“ und merkt sich
 * den bestätigten Betrag an der Buchung (hochOkCent) – ändert sich der Betrag später, erscheint die Marke wieder.
 */
export function hochMarke(b, schnitt) {
  if (schnitt == null) return null;
  const bestaetigen = async (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (b.archivJahr) { toast(`Archiv ${b.archivJahr}: nur lesen.`); return; }
    const ok = await frage({
      titel: 'Betrag bestätigen',
      text: [`${formatEuro(b.betragCent)} am ${formatDatum(b.datum)}${b.partner ? ` an ${b.partner.trim()}` : ''} ist höher als sonst (Ø ${formatEuro(schnitt)}).`,
        'Stimmt der Betrag? Dann verschwindet die Markierung „↑ hoch“.'],
      jaText: 'Betrag stimmt',
    });
    if (!ok) return;
    const aktuell = (await db.hole('buchungen', b.id)) ?? b;
    await db.speichere('buchungen', { ...aktuell, hochOkCent: aktuell.betragCent, geaendertAm: new Date().toISOString() });
    toast('Betrag bestätigt');
    datenGeaendert();
  };
  return h('span', {
    class: 'marke marke-warn marke-ungewoehnlich', role: 'button', tabindex: '0',
    title: `Ungewöhnlich hoch – sonst Ø ${formatEuro(schnitt)}. Antippen zum Bestätigen.`,
    onclick: bestaetigen,
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') bestaetigen(e); },
  }, '↑ hoch');
}

/** D185: „Jahr X ist abgeschlossen – archivieren?“ mit „Zum Archiv“ und „In 30 Tagen erinnern“ */
export function archivHinweis(erinnerung) {
  if (!erinnerung) return null;
  return klappBereich({
    klasse: 'hinweise-klapp',
    titel: `Archiv · ${erinnerung.jahr} ist abgeschlossen`,
    offen: archivOffen,
    beiWechsel: (o) => { archivOffen = o; },
  }, h('section', { class: 'bereich hinweiskarte', 'aria-label': `Archiv ${erinnerung.jahr}` },
    h('p', {}, `Das Jahr ${erinnerung.jahr} ist vorbei (${erinnerung.anzahl === 1 ? '1 Buchung' : `${erinnerung.anzahl} Buchungen`}). Archivieren hält die App auf Dauer schnell; ` +
      'die Buchungen bleiben in Google Drive gesichert und lassen sich jederzeit lesen oder zurückholen.'),
    erinnerung.hindernis && h('p', { class: 'warn-text klein' }, erinnerung.hindernis),
    h('div', { class: 'hinweis-aktionen' },
      h('button', {
        type: 'button', class: 'knopf knopf-primaer',
        onclick: () => { geraet.schreib('ansicht-stammdaten', 'daten'); location.hash = '#stammdaten'; },
      }, 'Zum Archiv'),
      h('button', {
        type: 'button', class: 'knopf',
        onclick: () => {
          geraet.schreib('archiv-spaeter', plusTage(heuteIso(), 30));
          toast('Erinnerung in 30 Tagen');
          datenGeaendert();
        },
      }, 'In 30 Tagen erinnern'))));
}
