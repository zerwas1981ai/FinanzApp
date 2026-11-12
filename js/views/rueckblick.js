// D156: Dialog „Rückblick“ (aus „Alle Buchungen“): Monat mit den beiden Vormonaten oder Jahr mit Vorjahr.
// Druckbar über „Drucken / PDF“ (gleiche Druckansicht wie bei den relevanten Ausgaben, D144).

import { h } from '../dom.js';
import { formatEuro, formatDatum, formatProzent, heuteIso } from '../format.js';
import { dialog, katPunkt } from '../ui.js';
import { monatsRueckblick, jahresRueckblick, waehlbareZeitraeume, plusMonat, monatLang, monatKurz } from '../rueckblick.js';
import { farbenZuordnung } from '../farben.js';
import * as db from '../db.js';
import { notizKnopf, notizListe } from './monatsnotiz.js';

const zustand = { art: 'monat', monat: null, jahr: null }; // solange die App offen ist

const mitVorzeichen = (cent) => (cent > 0 ? '+' : '') + formatEuro(cent);
const quoteText = (q) => (q == null ? '–' : formatProzent(q));

/** Tabelle: Kopfzeile + Zeilen; Zahlenspalten rechtsbündig */
function tabelle(kopf, zeilen, { klasse = '' } = {}) {
  return h('div', { class: 'rb-tabelle-rahmen' },
    h('table', { class: `rb-tabelle ${klasse}`.trim() },
      h('thead', {}, h('tr', {}, kopf.map((t, i) => h('th', { class: i ? 'zahl' : null }, t)))),
      h('tbody', {}, zeilen.map((z) => h('tr', { class: z.klasse ?? null }, z.zellen.map((c, i) => h('td', { class: i ? 'zahl' : null }, c)))))));
}

/** Inhalt des Rückblicks (wird im Dialog und in der Druckansicht verwendet) */
export function rueckblickInhalt(rb, daten, notizen = []) {
  const farben = farbenZuordnung(daten.kategorien);
  const kat = new Map(daten.kategorien.map((k) => [k.id, k]));
  const p = rb.perioden;
  const vergleich = rb.art === 'monat' ? 'zum Vormonat' : 'zum Vorjahr';
  const diffKopf = rb.art === 'monat' ? 'Δ Vormonat' : 'Δ Vorjahr';
  const [vorher, jetzt] = p.slice(-2);

  // Ausgaben: mehr ist schlechter → Plus in Warnfarbe; Einnahmen/Saldo: Plus grün
  const diff = (wert, gutWennPlus) => h('span', { class: wert === 0 ? 'gedaempft' : (wert > 0) === gutWennPlus ? 'plus' : 'warn-text' }, mitVorzeichen(wert));
  const quoteDiff = jetzt.sparquote != null && vorher.sparquote != null
    ? h('span', { class: jetzt.sparquote >= vorher.sparquote ? 'plus' : 'warn-text' },
      `${jetzt.sparquote >= vorher.sparquote ? '+' : '-'}${Math.abs(Math.round((jetzt.sparquote - vorher.sparquote) * 100))} Pkt.`)
    : '–';

  const kennzahlen = tabelle(['', ...rb.spalten, diffKopf], [
    { zellen: ['Einnahmen', ...p.map((x) => formatEuro(x.einnahmen)), diff(jetzt.einnahmen - vorher.einnahmen, true)] },
    { zellen: ['Ausgaben', ...p.map((x) => formatEuro(x.ausgaben)), diff(jetzt.ausgaben - vorher.ausgaben, false)] },
    { klasse: 'rb-summe', zellen: ['Saldo', ...p.map((x) => h('span', { class: x.saldo < 0 ? 'negativ' : null }, mitVorzeichen(x.saldo))), diff(jetzt.saldo - vorher.saldo, true)] },
    { zellen: ['Sparquote', ...p.map((x) => quoteText(x.sparquote)), quoteDiff] },
  ]);

  const katTabelle = rb.kategorien.length
    ? tabelle(['Kategorie', ...rb.spalten, diffKopf], rb.kategorien.map((k) => ({
      zellen: [h('span', {}, katPunkt(farben.get(k.id)?.hex), k.name), ...k.werte.map((w) => (w ? formatEuro(w) : '–')), diff(k.differenz, false)],
    })))
    : h('p', { class: 'leer' }, 'Keine Ausgaben.');

  const monatsTabelle = rb.monate && tabelle(['Monat', 'Einnahmen', 'Ausgaben', 'Saldo'], rb.monate.map((m) => ({
    zellen: [monatKurz(m.schluessel), formatEuro(m.einnahmen), formatEuro(m.ausgaben), h('span', { class: m.saldo < 0 ? 'negativ' : null }, mitVorzeichen(m.saldo))],
  })));

  const groesste = rb.groesste.length
    ? h('ul', { class: 'rb-groesste' }, rb.groesste.map((b) => {
      const unter = kat.get(b.kategorieId);
      return h('li', {},
        h('span', { class: 'rb-datum' }, formatDatum(b.datum)),
        h('span', { class: 'rb-text' }, katPunkt(farben.get(unter?.elternId ?? unter?.id)?.hex), [b.partner, unter?.name, b.notiz].filter(Boolean).join(' · ') || 'Ausgabe'),
        h('span', { class: 'betrag' }, formatEuro(-b.betragCent)));
    }))
    : h('p', { class: 'leer' }, 'Keine Ausgaben.');

  const hinweis = rb.laufend
    ? (rb.art === 'monat' ? 'Der Monat läuft noch – gezählt wird bis heute.' : `Das Jahr läuft noch – gezählt wird bis heute, das Vorjahr bis zum ${formatDatum(rb.vorjahrBis)}.`)
    : null;

  // D165: Notizen der gezeigten Monate
  const notizMonate = rb.art === 'monat' ? rb.perioden.map((x) => x.schluessel) : (rb.monate ?? []).map((m) => m.schluessel);
  return [
    hinweis && h('p', { class: 'hinweis' }, hinweis),
    notizListe(notizMonate, notizen),
    h('h3', { class: 'rb-titel' }, 'Einnahmen und Ausgaben'),
    kennzahlen,
    h('p', { class: 'klein gedaempft' }, `Δ = Veränderung ${vergleich}. Umbuchungen zählen nicht mit.`),
    h('h3', { class: 'rb-titel' }, 'Ausgaben je Kategorie'),
    katTabelle,
    monatsTabelle && h('h3', { class: 'rb-titel' }, 'Monate'),
    monatsTabelle,
    h('h3', { class: 'rb-titel' }, rb.art === 'monat' ? 'Größte Ausgaben des Monats' : 'Größte Ausgaben des Jahres'),
    groesste,
  ].filter(Boolean);
}

export async function oeffneRueckblick(daten) {
  let notizen = await db.alle('monatsnotizen'); // D165
  const heute = heuteIso();
  const { monate, jahre } = waehlbareZeitraeume(daten.buchungen, heute);
  const vormonat = plusMonat(heute.slice(0, 7), -1);
  zustand.monat ??= monate.includes(vormonat) ? vormonat : monate[0];
  zustand.jahr ??= jahre.includes(Number(heute.slice(0, 4)) - 1) ? Number(heute.slice(0, 4)) - 1 : jahre[0];

  const inhalt = h('div', { class: 'rb-inhalt' });
  const wahlFeld = h('select', { 'aria-label': 'Zeitraum' });
  const notizPlatz = h('span', { class: 'rb-notiz' });
  const berechne = () => (zustand.art === 'monat'
    ? monatsRueckblick(daten.buchungen, daten.kategorien, zustand.monat, heute)
    : jahresRueckblick(daten.buchungen, daten.kategorien, zustand.jahr, heute));

  const artKnoepfe = h('div', { class: 'segmente', role: 'group', 'aria-label': 'Rückblick' },
    [['monat', 'Monat'], ['jahr', 'Jahr']].map(([wert, text]) => h('button', {
      type: 'button', class: 'segment', 'aria-pressed': String(zustand.art === wert),
      onclick: (e) => {
        zustand.art = wert;
        artKnoepfe.querySelectorAll('.segment').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
        zeichne();
      },
    }, text)));

  function zeichne() {
    const liste = zustand.art === 'monat'
      ? monate.map((m) => ({ wert: m, text: monatLang(m) }))
      : jahre.map((j) => ({ wert: String(j), text: String(j) }));
    wahlFeld.replaceChildren(...liste.map((o) => h('option', { value: o.wert }, o.text)));
    wahlFeld.value = String(zustand.art === 'monat' ? zustand.monat : zustand.jahr);
    // D165: ✎ für die Notiz des gewählten Monats
    notizPlatz.replaceChildren(zustand.art === 'monat'
      ? notizKnopf(zustand.monat, notizen, async () => { notizen = await db.alle('monatsnotizen'); zeichne(); })
      : '');
    inhalt.replaceChildren(...rueckblickInhalt(berechne(), daten, notizen));
  }
  wahlFeld.addEventListener('change', () => {
    if (zustand.art === 'monat') zustand.monat = wahlFeld.value;
    else zustand.jahr = Number(wahlFeld.value);
    zeichne();
  });
  zeichne();

  const dlg = dialog({
    titel: 'Rückblick',
    inhalt: [h('div', { class: 'rb-wahl' }, artKnoepfe, wahlFeld, notizPlatz), inhalt],
    speichernText: 'Drucken / PDF',
    abbrechenText: 'Schließen',
    onSpeichern: () => {
      const rb = berechne();
      setTimeout(() => druckeRueckblick(rb, daten, notizen), 50); // erst nach dem Schließen drucken
    },
  });
  dlg.classList.add('rb-dialog');
}

function druckeRueckblick(rb, daten, notizen) {
  const bereich = h('div', { id: 'druckbereich', class: 'druck-rueckblick' },
    h('h1', {}, rb.titel),
    h('p', {}, `Stand ${formatDatum(heuteIso())}`),
    ...rueckblickInhalt(rb, daten, notizen));
  document.getElementById('druckbereich')?.remove();
  document.body.append(bereich);
  const weg = () => { bereich.remove(); window.removeEventListener('afterprint', weg); };
  window.addEventListener('afterprint', weg);
  window.print();
}
