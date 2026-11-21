// D156: Rückblick – Monat mit den beiden Vormonaten oder Jahr mit Vorjahr. Druckbar über „Drucken / PDF“
// (gleiche Druckansicht wie bei den relevanten Ausgaben, D144).
// D240: kein Dialog mehr, sondern eigener Umschalter zwischen Analyse und Belege im Tab Auswertungen.

import { h } from '../dom.js';
import { formatEuro, formatDatum, formatProzent, heuteIso, monatKurz, monatLang } from '../format.js';
import { katPunkt, dialog, toast, herunterladen } from '../ui.js';
import { buchungenAlsCsv, exportName, dateiTeil } from '../export.js';
import { monatsRueckblick, jahresRueckblick, waehlbareZeitraeume, plusMonat, trendPfeil, kategorieBuchungen } from '../rueckblick.js';
import { oeffneBuchungsdialog } from './buchung-dialog.js';
import { farbenZuordnung } from '../farben.js';
import { zaehltCent } from '../rechnen.js';
import * as db from '../db.js';
import { notizKnopf, notizListe } from './monatsnotiz.js';

const zustand = { art: 'monat', monat: null, jahr: null }; // solange die App offen ist

const mitVorzeichen = (cent) => (cent > 0 ? '+' : '') + formatEuro(cent);
const quoteText = (q) => (q == null ? '–' : formatProzent(q));

/**
 * Tabelle: Kopfzeile + Zeilen; Zahlenspalten rechtsbündig. D241: feste Spaltenbreiten (Namensspalte fest, Zahlenspalten
 * gleich breit), damit die Werte in „Einnahmen und Ausgaben“ und „Ausgaben je Kategorie“ genau untereinander stehen.
 * Die Mindestbreite richtet sich nach der Spaltenzahl; am Handy lässt sich die Tabelle dann seitlich wischen.
 */
function tabelle(kopf, zeilen, { klasse = '' } = {}) {
  return h('div', { class: 'rb-tabelle-rahmen' },
    h('table', { class: `rb-tabelle ${klasse}`.trim(), style: `min-width:${9 + (kopf.length - 1) * 6.5}rem` },
      h('thead', {}, h('tr', {}, kopf.map((t, i) => h('th', { class: i ? 'zahl' : null }, t)))),
      h('tbody', {}, zeilen.map((z) => h('tr', { class: z.klasse ?? null }, z.zellen.map((c, i) => h('td', { class: i ? 'zahl' : null }, c)))))));
}

/**
 * Inhalt des Rückblicks (Bildschirm und Druckansicht). beiKlick (D242, nur am Bildschirm): (kategorie, zeitraeume, titel)
 * – Kategorie oder ein Monatswert antippen zeigt die zugehörigen Buchungen.
 */
export function rueckblickInhalt(rb, daten, notizen = [], beiKlick = null) {
  const farben = farbenZuordnung(daten.kategorien);
  const kat = new Map(daten.kategorien.map((k) => [k.id, k]));
  const p = rb.perioden;
  const monatsweise = rb.art !== 'jahr'; // 'monat' oder 'sechs' (D241)
  const vergleich = monatsweise ? 'zum Vormonat' : 'zum Vorjahr';
  const diffKopf = monatsweise ? 'Δ Vormonat' : 'Δ Vorjahr';
  const [vorher, jetzt] = p.slice(-2);

  // Ausgaben: mehr ist schlechter → Plus in Warnfarbe; Einnahmen/Saldo: Plus grün
  const diff = (wert, gutWennPlus) => h('span', { class: wert === 0 ? 'gedaempft' : (wert > 0) === gutWennPlus ? 'plus' : 'warn-text' }, mitVorzeichen(wert));
  // D241: erst runden, dann Vorzeichen und Farbe – sonst stand bei kleinen Änderungen „-0 Pkt.“ in Orange
  const punkte = jetzt.sparquote != null && vorher.sparquote != null ? Math.round((jetzt.sparquote - vorher.sparquote) * 100) : null;
  const quoteDiff = punkte == null ? '–'
    : h('span', { class: punkte === 0 ? 'gedaempft' : punkte > 0 ? 'plus' : 'warn-text' }, `${punkte > 0 ? '+' : punkte < 0 ? '-' : ''}${Math.abs(punkte)} Pkt.`);

  // D242: Ø der 6 Monate vor dem gewählten Monat (nur Monat / 6 Monate) und Pfeil am rechten Monat bei den Ausgaben
  const sn = monatsweise ? rb.schnitt : null;
  // als Funktion: jede Tabelle braucht ein eigenes Element (ein DOM-Knoten kann nur an einer Stelle stehen)
  const schnittKopf = () => sn && h('span', { title: `Durchschnitt je Monat der ${sn.monate === 1 ? 'Vormonat' : `${sn.monate} Monate`} vor ${rb.spalten.at(-1)}` }, `Ø ${sn.monate} Mon.`);
  const mitPfeil = (inhalt, wert, schnitt) => {
    const pfeil = sn ? trendPfeil(wert, schnitt ?? 0) : null;
    if (!pfeil) return inhalt;
    const text = { '▲': 'über dem Ø', '▼': 'unter dem Ø', '→': 'etwa beim Ø' }[pfeil];
    return h('span', {}, inhalt, ' ', h('span', {
      class: `rb-pfeil ${pfeil === '▲' ? 'warn-text' : pfeil === '▼' ? 'plus' : 'gedaempft'}`,
      title: `${text} (${formatEuro(schnitt ?? 0)})`, 'aria-label': text,
    }, pfeil));
  };
  const mitSchnitt = (zellen, schnittZelle, diffZelle) => (sn ? [...zellen, schnittZelle, diffZelle] : [...zellen, diffZelle]);

  const kennzahlen = tabelle(mitSchnitt(['', ...rb.spalten], schnittKopf(), diffKopf), [
    { zellen: mitSchnitt(['Einnahmen', ...p.map((x) => formatEuro(x.einnahmen))], sn && formatEuro(sn.einnahmen), diff(jetzt.einnahmen - vorher.einnahmen, true)) },
    { zellen: mitSchnitt(['Ausgaben', ...p.map((x, i) => (i === p.length - 1 ? mitPfeil(formatEuro(x.ausgaben), x.ausgaben, sn?.ausgaben) : formatEuro(x.ausgaben)))],
      sn && formatEuro(sn.ausgaben), diff(jetzt.ausgaben - vorher.ausgaben, false)) },
    { klasse: 'rb-summe', zellen: mitSchnitt(['Saldo', ...p.map((x) => h('span', { class: x.saldo < 0 ? 'negativ' : null }, mitVorzeichen(x.saldo)))],
      sn && mitVorzeichen(sn.saldo), diff(jetzt.saldo - vorher.saldo, true)) },
    { zellen: mitSchnitt(['Sparquote', ...p.map((x) => quoteText(x.sparquote))], sn && quoteText(sn.sparquote), quoteDiff) },
  ]);

  // D242: Kategorie antippen = Buchungen aller gezeigten Zeiträume; Monatswert antippen = Buchungen dieses Zeitraums
  const zeitraum = (x) => [x.von, x.bis];
  const klickbar = (inhalt, k, zeitraeume, titel) => (beiKlick
    ? h('button', { type: 'button', class: 'rb-klick', title: 'Buchungen anzeigen', onclick: () => beiKlick(k, zeitraeume, titel) }, inhalt)
    : inhalt);
  const katTabelle = rb.kategorien.length
    ? tabelle(mitSchnitt(['Kategorie', ...rb.spalten], schnittKopf(), diffKopf), rb.kategorien.map((k) => ({
      zellen: mitSchnitt([
        klickbar(h('span', {}, katPunkt(farben.get(k.id)?.hex), k.name), k, p.map(zeitraum), `${k.name} · ${rb.spalten[0]} – ${rb.spalten.at(-1)}`),
        ...k.werte.map((w, i) => {
          const wert = w ? klickbar(formatEuro(w), k, [zeitraum(p[i])], `${k.name} · ${rb.spalten[i]}`) : '–';
          return i === k.werte.length - 1 ? mitPfeil(wert, w, sn?.jeHaupt.get(k.id)) : wert;
        })],
      sn && formatEuro(sn.jeHaupt.get(k.id) ?? 0), diff(k.differenz, false)),
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
    ? (monatsweise ? 'Der Monat läuft noch – gezählt wird bis heute.' : `Das Jahr läuft noch – gezählt wird bis heute, das Vorjahr bis zum ${formatDatum(rb.vorjahrBis)}.`)
    : null;

  // D165: Notizen der gezeigten Monate
  const notizMonate = monatsweise ? rb.perioden.map((x) => x.schluessel) : (rb.monate ?? []).map((m) => m.schluessel);
  return [
    hinweis && h('p', { class: 'hinweis' }, hinweis),
    notizListe(notizMonate, notizen),
    h('h3', { class: 'rb-titel' }, 'Einnahmen und Ausgaben'),
    kennzahlen,
    h('p', { class: 'klein gedaempft' }, `Δ = Veränderung ${vergleich}. `,
      sn ? `Ø = Durchschnitt je Monat der ${sn.monate} Monate vor ${rb.spalten.at(-1)}; ▲ über, ▼ unter, → etwa beim Ø. ` : '',
      'Umbuchungen zählen nicht mit.'),
    h('h3', { class: 'rb-titel' }, 'Ausgaben je Kategorie'),
    katTabelle,
    beiKlick && rb.kategorien.length > 0 && h('p', { class: 'klein gedaempft' }, 'Kategorie oder Betrag antippen zeigt die Buchungen.'),
    monatsTabelle && h('h3', { class: 'rb-titel' }, 'Monate'),
    monatsTabelle,
    h('h3', { class: 'rb-titel' }, { monat: 'Größte Ausgaben des Monats', sechs: 'Größte Ausgaben der 6 Monate', jahr: 'Größte Ausgaben des Jahres' }[rb.art]),
    groesste,
  ].filter(Boolean);
}

/** D240: Rückblick als Bereich im Tab Auswertungen; daten wie in „Alle Buchungen“ (inkl. Archiv) */
export async function rueckblickBereich(daten) {
  let notizen = await db.alle('monatsnotizen'); // D165
  const heute = heuteIso();
  const { monate, jahre } = waehlbareZeitraeume(daten.buchungen, heute);
  if (!monate.length) return h('section', { class: 'bereich' }, h('p', { class: 'leer' }, 'Noch keine Buchungen für einen Rückblick.'));
  const vormonat = plusMonat(heute.slice(0, 7), -1);
  if (!monate.includes(zustand.monat)) zustand.monat = monate.includes(vormonat) ? vormonat : monate[0];
  if (!jahre.includes(zustand.jahr)) zustand.jahr = jahre.includes(Number(heute.slice(0, 4)) - 1) ? Number(heute.slice(0, 4)) - 1 : jahre[0];

  const inhalt = h('div', { class: 'rb-inhalt' });
  const wahlFeld = h('select', { 'aria-label': 'Zeitraum' });
  const notizPlatz = h('span', { class: 'rb-notiz' });
  const berechne = () => (zustand.art !== 'jahr'
    ? monatsRueckblick(daten.buchungen, daten.kategorien, zustand.monat, heute, zustand.art === 'sechs' ? 6 : 3)
    : jahresRueckblick(daten.buchungen, daten.kategorien, zustand.jahr, heute));

  const artKnoepfe = h('div', { class: 'segmente', role: 'group', 'aria-label': 'Rückblick' },
    [['monat', 'Monat'], ['sechs', '6 Monate'], ['jahr', 'Jahr']].map(([wert, text]) => h('button', { // D241: 6 Monate
      type: 'button', class: 'segment', 'aria-pressed': String(zustand.art === wert),
      onclick: (e) => {
        zustand.art = wert;
        artKnoepfe.querySelectorAll('.segment').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
        zeichne();
      },
    }, text)));

  function zeichne() {
    const liste = zustand.art !== 'jahr'
      ? monate.map((m) => ({ wert: m, text: (zustand.art === 'sechs' ? 'bis ' : '') + monatLang(m) }))
      : jahre.map((j) => ({ wert: String(j), text: String(j) }));
    wahlFeld.replaceChildren(...liste.map((o) => h('option', { value: o.wert }, o.text)));
    wahlFeld.value = String(zustand.art !== 'jahr' ? zustand.monat : zustand.jahr);
    // D165: ✎ für die Notiz des gewählten Monats
    notizPlatz.replaceChildren(zustand.art === 'monat'
      ? notizKnopf(zustand.monat, notizen, async () => { notizen = await db.alle('monatsnotizen'); zeichne(); })
      : '');
    inhalt.replaceChildren(...rueckblickInhalt(berechne(), daten, notizen, (k, zeitraeume, titel) => buchungenDialog(daten, k, zeitraeume, titel)));
  }
  wahlFeld.addEventListener('change', () => {
    if (zustand.art !== 'jahr') zustand.monat = wahlFeld.value;
    else zustand.jahr = Number(wahlFeld.value);
    zeichne();
  });
  zeichne();

  return h('section', { class: 'bereich rb-bereich' },
    h('div', { class: 'rb-wahl' }, artKnoepfe, wahlFeld, notizPlatz,
      h('button', { type: 'button', class: 'knopf knopf-klein rb-drucken', onclick: () => druckeRueckblick(berechne(), daten, notizen) }, 'Drucken / PDF')),
    inhalt);
}

/** D242: Buchungen einer Hauptkategorie in den gewählten Zeiträumen; antippen öffnet die Buchung */
function buchungenDialog(daten, k, zeitraeume, titel) {
  const liste = kategorieBuchungen(daten.buchungen, daten.kategorien, k.id, zeitraeume, heuteIso());
  const kat = new Map(daten.kategorien.map((x) => [x.id, x]));
  const summe = liste.reduce((s, b) => s + zaehltCent(b), 0);
  let dlg = null;
  const oeffne = (b) => {
    if (b.archivJahr) { toast(`Archiv ${b.archivJahr}: nur lesen.`); return; }
    dlg.close();
    oeffneBuchungsdialog(b);
  };
  const anzahlText = `${liste.length === 1 ? '1 Buchung' : `${liste.length} Buchungen`} · Summe ${formatEuro(summe)}`;
  // D243: die angezeigten Buchungen drucken (PDF über „Drucken“) oder als CSV für Excel speichern
  const werkzeuge = liste.length > 0 && h('div', { class: 'rb-werkzeuge' },
    h('button', { type: 'button', class: 'knopf knopf-klein', onclick: () => druckeBuchungen(liste, daten, titel, anzahlText) }, 'Drucken / PDF'),
    h('button', {
      type: 'button', class: 'knopf knopf-klein',
      onclick: () => herunterladen(buchungenAlsCsv(liste, daten), exportName(dateiTeil(titel), heuteIso()), 'text/csv;charset=utf-8'),
    }, 'Als CSV (Excel)'));
  dlg = dialog({
    titel,
    inhalt: [
      h('p', { class: 'klein gedaempft' }, anzahlText),
      werkzeuge,
      liste.length
        ? h('ul', { class: 'rb-groesste rb-buchungen' }, liste.map((b) => h('li', {},
          h('button', { type: 'button', class: 'rb-buchung', onclick: () => oeffne(b) },
            h('span', { class: 'rb-datum' }, formatDatum(b.datum)),
            h('span', { class: 'rb-text' }, [b.partner, kat.get(b.kategorieId)?.name, b.notiz].filter(Boolean).join(' · ') || 'Ausgabe'),
            h('span', { class: 'betrag' }, formatEuro(-zaehltCent(b)))))))
        : h('p', { class: 'leer' }, 'Keine Buchungen.'),
    ],
    speichernText: 'Schließen',
    abbrechenText: null,
  });
  dlg.classList.add('rb-dialog');
}

/** D243: Druckansicht der Buchungen aus dem Rückblick (älteste zuerst, mit Summe) */
function druckeBuchungen(liste, daten, titel, anzahlText) {
  const kat = new Map(daten.kategorien.map((k) => [k.id, k]));
  const konto = new Map((daten.konten ?? []).map((k) => [k.id, k.name]));
  const summe = liste.reduce((s, b) => s + zaehltCent(b), 0);
  const zeilen = [...liste].sort((a, b) => a.datum.localeCompare(b.datum));
  const bereich = h('div', { id: 'druckbereich', class: 'druck-rueckblick druck-buchungen' },
    h('h1', {}, titel),
    h('p', {}, `Stand ${formatDatum(heuteIso())} · ${anzahlText}`),
    h('table', {},
      h('thead', {}, h('tr', {}, ['Datum', 'Empfänger', 'Unterkategorie', 'Konto', 'Notiz'].map((t) => h('th', {}, t)), h('th', { class: 'zahl' }, 'Betrag'))),
      h('tbody', {}, zeilen.map((b) => h('tr', {},
        h('td', {}, formatDatum(b.datum)), h('td', {}, b.partner ?? ''), h('td', {}, kat.get(b.kategorieId)?.name ?? ''),
        h('td', {}, konto.get(b.kontoId) ?? ''), h('td', {}, b.notiz ?? ''), h('td', { class: 'zahl' }, formatEuro(-zaehltCent(b)))))),
      h('tfoot', {}, h('tr', {}, h('td', { colspan: 5 }, 'Summe'), h('td', { class: 'zahl' }, formatEuro(-summe))))));
  document.getElementById('druckbereich')?.remove();
  document.body.append(bereich);
  const weg = () => { bereich.remove(); window.removeEventListener('afterprint', weg); };
  window.addEventListener('afterprint', weg);
  window.print();
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
