// D182/D185: ruhige Hinweise oben in der Übersicht – erkannte wiederkehrende Zahlungen und Archiv-Erinnerung.
// Die App schlägt nur vor; angelegt oder archiviert wird erst nach einem Klick.

import { h } from '../dom.js';
import * as db from '../db.js';
import { formatEuro, formatDatum, heuteIso } from '../format.js';
import { klappBereich, toast, datenGeaendert, geraet, frage } from '../ui.js';
import { wiederkehrendDialog } from './annahmen.js';
import { plusTage } from '../vertraege.js';
import { mitWertAenderung } from '../erkennung.js';
import { annahmeTitel } from '../prognose.js';
import { formatMonat } from '../format.js';

let erkanntOffen = false;
let archivOffen = false;
let preisOffen = false;
let abschlussOffen = false;

/** D203: abgelehnte Preisänderungen („id|betrag“) */
export const abgelehntePreise = (einstellungen = []) => einstellungen.find((e) => e.id === 'erkennung')?.preisAbgelehnt ?? [];

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

/** D203: „Preisänderung erkannt“ – Betrag einer wiederkehrenden Buchung ab dem nächsten Termin anpassen? */
export function preisBereich(vorschlaege, daten) {
  if (!vorschlaege.length) return null;
  const titelVon = (w) => annahmeTitel(w, daten.kategorien ?? []);
  return klappBereich({
    klasse: 'hinweise-klapp',
    titel: `${vorschlaege.length === 1 ? 'Preisänderung erkannt' : `${vorschlaege.length} Preisänderungen erkannt`} · ${vorschlaege.map((v) => titelVon(v.w)).join(', ')}`,
    offen: preisOffen,
    beiWechsel: (o) => { preisOffen = o; },
  }, h('div', { class: 'hinweiskarten' }, vorschlaege.map((v) => {
    const uebernehmen = async () => {
      const w = (await db.hole('wiederkehrend', v.w.id)) ?? v.w;
      await db.speichere('wiederkehrend', { ...mitWertAenderung(w, v.ab, v.neuCent), geaendertAm: new Date().toISOString() });
      toast(`${titelVon(w)}: ab ${formatDatum(v.ab)} ${formatEuro(v.neuCent)}`);
      datenGeaendert();
    };
    const ablehnen = async () => {
      const alt = (await db.hole('einstellungen', 'erkennung')) ?? { id: 'erkennung', abgelehnt: [] };
      await db.speichere('einstellungen', { ...alt, preisAbgelehnt: [...new Set([...(alt.preisAbgelehnt ?? []), v.schluessel])], geaendertAm: new Date().toISOString() });
      toast('Betrag bleibt wie geplant');
      datenGeaendert();
    };
    return h('section', { class: 'bereich hinweiskarte', 'aria-label': `Preisänderung ${titelVon(v.w)}` },
      h('h2', {}, h('span', { class: 'klein' }, 'Preisänderung · '), titelVon(v.w)),
      h('p', {}, `Die letzten zwei Zahlungen waren ${formatEuro(v.neuCent)} statt geplant ${formatEuro(v.altCent)}. ` +
        `Ab dem nächsten Termin (${formatDatum(v.ab)}) mit ${formatEuro(v.neuCent)} rechnen? Frühere Termine bleiben unverändert.`),
      h('div', { class: 'hinweis-aktionen' },
        h('button', { type: 'button', class: 'knopf knopf-primaer', onclick: uebernehmen }, 'Übernehmen'),
        h('button', { type: 'button', class: 'knopf', onclick: ablehnen }, 'Nicht ändern')));
  })));
}

/** D206: erledigt markierte Monatsabschlüsse ('JJJJ-MM'), über Drive abgeglichen (einstellungen, id 'abschluss') */
export const erledigteAbschluesse = (einstellungen = []) => einstellungen.find((e) => e.id === 'abschluss')?.erledigt ?? [];

/** D206: „Monatsabschluss Oktober · 2 von 4 erledigt“ – erscheint vom 1. bis 10., solange etwas offen ist */
export function abschlussBereich(monat, punkte) {
  if (!monat || punkte.every((p) => p.ok)) return null;
  const name = formatMonat(Number(monat.slice(0, 4)), Number(monat.slice(5, 7)));
  const fertig = punkte.filter((p) => p.ok).length;
  const erledigt = async () => {
    const alt = (await db.hole('einstellungen', 'abschluss')) ?? { id: 'abschluss', erledigt: [] };
    await db.speichere('einstellungen', { ...alt, erledigt: [...new Set([...(alt.erledigt ?? []), monat])].sort().slice(-24), geaendertAm: new Date().toISOString() });
    toast(`Monatsabschluss ${name} erledigt`);
    datenGeaendert();
  };
  return klappBereich({
    klasse: 'hinweise-klapp',
    titel: `Monatsabschluss ${name} · ${fertig} von ${punkte.length} erledigt`,
    offen: abschlussOffen,
    beiWechsel: (o) => { abschlussOffen = o; },
  }, h('section', { class: 'bereich hinweiskarte', 'aria-label': `Monatsabschluss ${name}` },
    h('ul', { class: 'abschluss-liste' }, punkte.map((p) => h('li', { class: p.ok ? 'ok' : 'offen' },
      h('span', { class: 'abschluss-haken', 'aria-hidden': 'true' }, p.ok ? '✓' : '○'),
      h('span', {}, h('strong', {}, p.titel), p.text && h('span', { class: 'klein gedaempft' }, ` – ${p.text}`))))),
    h('div', { class: 'hinweis-aktionen' },
      h('button', { type: 'button', class: 'knopf', onclick: erledigt }, 'Als erledigt markieren'))));
}
