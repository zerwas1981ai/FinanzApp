// Tab "Übersicht": Kennzahlen und Budgethinweise (Etappe 4), Konto wählen, Monatsansicht mit
// Zwischensummen und Kontoabstimmung (Etappe 2), "Noch erwartet" (Etappe 4) und die
// Zeitleiste bis 2050 je Konto oder für "Alle Konten" (Etappe 5).

import { h } from '../dom.js';
import * as db from '../db.js';
import {
  formatEuro, formatDatum, formatMonat, formatTag, heuteIso, parseEuro,
  isoMonatsanfang, naechsterMonat, vorigerMonat, istGueltigesDatum,
} from '../format.js';
import { monatsuebersicht, kontostand, vorgemerktBis, wirkungCent } from '../rechnen.js';
import { dialog, eingabe, hinweis, toast, geraet, datenGeaendert, klappBereich, katPunkt, merkeScroll } from '../ui.js';
import { farbenZuordnung, farbeVon } from '../farben.js';
import { oeffneBuchungsdialog } from './buchung-dialog.js';
import { kuendigungsBereich } from './vertraege.js';
import { notizKnopf, notizZeile } from './monatsnotiz.js';
import { kuendigungsHinweise } from '../vertraege.js';
import { vorgemerkteVonKonto, alsGebuchtMarkieren } from '../buchungen.js';
import { sortiereKonten, abstimmungFaellig, tageZwischen, ABSTIMM_ERINNERUNG_TAGE } from '../konten.js';
import { faelligListe, budgetHinweise, zeitleiste, nurWirksam, mindestsaldoWarnungen, LETZTER_MONAT, prognoseJahresende } from '../prognose.js';
import { umbuchungKnopf, kennzahlenBereich, erwartetBereich, hinweisBereich } from './kennzahlen.js';
import { zeitleisteBereich, postenListe } from './zeitleiste.js';
import { oeffnePostenDialog } from './posten-dialog.js';
import { erkanntBereich, archivHinweis, abgelehnteVorschlaege } from './erkennung.js';
import { wiederkehrendVorschlaege, archivErinnerung, ungewoehnlicheBuchungen } from '../erkennung.js';
import { naechstesArchivJahr } from '../archiv.js';

const ALLE = '__alle'; // gemerkte Auswahl "Alle Konten"

const nachName = (a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' });
// alleAnzeigen: "kontoId|JJJJ-MM-01", wenn für dieses Konto/diesen Monat alle Buchungen gezeigt werden
// summenOffen (D112): Monatsblock aufgeklappt? Standard zu, bleibt so, solange die App offen ist
const ansicht = { jahr: null, monat: null, alleAnzeigen: null, summenOffen: false };
const MAX_BUCHUNGEN = 10; // so viele Buchungen zeigt die Monatsansicht standardmäßig

const monatVon = (iso) => [Number(iso.slice(0, 4)), Number(iso.slice(5, 7))];

// D183: ungewöhnlich hohe Ausgaben (Map Buchung → Durchschnitt), bei jedem Zeichnen neu berechnet
let ungewoehnlich = new Map();

export async function zeigeUebersicht(container) {
  const namen = ['konten', 'kategorien', 'buchungen', 'abstimmungen', 'budgets', 'wiederkehrend', 'hinweise', 'einstellungen', 'geplant', 'projekte', 'vertraege', 'monatsnotizen'];
  const werte = await Promise.all(namen.map((s) => db.alle(s)));
  const alleDaten = Object.fromEntries(namen.map((n, i) => [n, werte[i]]));
  // Nur eingeschaltete Annahmen (Ein/Aus-Häkchen) zählen in Prognose und Zeitleiste
  const daten = nurWirksam(alleDaten);
  ungewoehnlich = ungewoehnlicheBuchungen(alleDaten.buchungen); // D183
  const { konten, kategorien, buchungen, abstimmungen } = daten;
  const neu = () => zeigeUebersicht(container);
  const aktive = sortiereKonten(konten.filter((k) => !k.archiviert)); // eigene Reihenfolge (D84)

  if (aktive.length === 0) {
    container.replaceChildren(
      h('h1', { class: 'seitentitel' }, 'Übersicht'),
      h('section', { class: 'bereich' },
        h('p', {}, konten.length ? 'Alle Konten sind archiviert.' : 'Noch keine Konten vorhanden.'),
        h('p', { class: 'hinweis' }, 'Lege unter Stammdaten ein Konto an oder lade dort die Testdaten.'),
        h('a', { class: 'knopf knopf-primaer', href: '#stammdaten' }, 'Zu den Stammdaten')),
    );
    return;
  }

  const heute = heuteIso();
  // Posten der Zukunft (Zeitleiste, Folgemonate) antippen → nur diesen Termin/Monat ändern
  const aendern = (posten) => oeffnePostenDialog(posten, alleDaten);

  // Etappe 4/5: Prognose laufender Monat + Zeitleiste bis 2050, Warnungen, Hinweise
  const zl = zeitleiste(daten, heute);
  const prognose = zl.start;
  const warnungen = mindestsaldoWarnungen(zl);
  const hinweise = budgetHinweise(daten, heute);
  // Fällige Posten (bis 7 Tage im Voraus) je Konto zählen – als Zahl an den Kontoknöpfen
  const faelligJeKonto = new Map();
  for (const t of faelligListe(daten, heute)) {
    faelligJeKonto.set(t.wiederkehrend.kontoId, (faelligJeKonto.get(t.wiederkehrend.kontoId) ?? 0) + 1);
  }
  const oben = [
    h('h1', { class: 'seitentitel unsichtbar' }, 'Übersicht'), // D164: sichtbar steht „Übersicht“ im Kasten
    kennzahlenBereich(prognose, alleDaten, heute, warnungen, prognoseJahresende(zl, heute)),
    hinweisBereich(hinweise, daten),
    kuendigungsBereich(kuendigungsHinweise(alleDaten.vertraege, heute), alleDaten), // D148
    // D182: erkannte wiederkehrende Zahlungen; D185: Archiv-Erinnerung
    erkanntBereich(wiederkehrendVorschlaege(alleDaten.buchungen, alleDaten.wiederkehrend, abgelehnteVorschlaege(alleDaten.einstellungen), heute), alleDaten),
    archivHinweis(archivErinnerung(naechstesArchivJahr({ buchungen: alleDaten.buchungen }, heute), heute, geraet.lies('archiv-spaeter'))),
    // D164: Überschrift „Konten“ entfällt, der Abstand bleibt gleich
    h('div', { class: 'konten-abstand', 'aria-hidden': 'true' }),
  ];

  const gemerkt = geraet.lies('ansicht-konto');
  const waehle = (id) => { geraet.schreib('ansicht-konto', id); neu(); };

  // "Alle Konten": Gesamtstand und Zeitleiste über alle aktiven Konten
  if (gemerkt === ALLE) {
    container.replaceChildren(...[
      ...oben,
      kontoAuswahl(aktive, null, faelligJeKonto, waehle),
      kontenAufstellung(aktive, zl, heute, waehle),
      zeitleisteBereich(zl.gesamt, ALLE, aendern),
    ].filter(Boolean));
    return;
  }
  const konto = aktive.find((k) => k.id === gemerkt) ?? aktive[0];

  // Monat festlegen und auf den sinnvollen Bereich begrenzen
  if (ansicht.jahr === null) [ansicht.jahr, ansicht.monat] = monatVon(heute);
  // Vorwärts geht es bis Dezember 2050: Zukunftsmonate zeigen die Prognose (Annahmen)
  const minMonat = monatVon(konto.stichtag);
  const maxMonat = monatVon(`${LETZTER_MONAT}-01`);
  const schluessel = ([j, m]) => j * 12 + m;
  if (schluessel([ansicht.jahr, ansicht.monat]) < schluessel(minMonat)) [ansicht.jahr, ansicht.monat] = minMonat;
  if (schluessel([ansicht.jahr, ansicht.monat]) > schluessel(maxMonat)) [ansicht.jahr, ansicht.monat] = maxMonat;

  const m = monatsuebersicht(konto, buchungen, ansicht.jahr, ansicht.monat);
  const istAktuellerMonat = isoMonatsanfang(ansicht.jahr, ansicht.monat) === isoMonatsanfang(...monatVon(heute));
  const istZukunft = schluessel([ansicht.jahr, ansicht.monat]) > schluessel(monatVon(heute));

  const kd = prognose.jeKonto.get(konto.id);
  const zlKonto = zl.jeKonto.get(konto.id) ?? [];

  // filter(Boolean): leere Bereiche (null/false) weglassen – sonst stünde "null" als Text da
  container.replaceChildren(...[
    ...oben,
    kontoAuswahl(aktive, konto, faelligJeKonto, waehle),
    kontoKopf(konto, buchungen, abstimmungen, kd?.prognose, kd?.niedrigster),
    ...monatsNavigation({
      zurueck: schluessel([ansicht.jahr, ansicht.monat]) > schluessel(minMonat),
      vor: schluessel([ansicht.jahr, ansicht.monat]) < schluessel(maxMonat),
      istAktuellerMonat,
      notizen: alleDaten.monatsnotizen,
      wechsel: (richtung) => {
        if (richtung === 'heute') [ansicht.jahr, ansicht.monat] = monatVon(heute);
        else [ansicht.jahr, ansicht.monat] = (richtung < 0 ? vorigerMonat : naechsterMonat)(ansicht.jahr, ansicht.monat);
        neu();
      },
    }),
    ...(istZukunft
      ? zukunftsMonat(zlKonto, isoMonatsanfang(ansicht.jahr, ansicht.monat).slice(0, 7), kd?.prognose ?? 0, m, konto, konten, kategorien, aendern)
      : [
        summenKarte(konto, m, istAktuellerMonat ? kd : null),
        buchungsliste(m, konto, konten, kategorien),
        istAktuellerMonat && erwartetBereich(kd, daten),
      ]),
    // D88: "Zukunft bis 2050" steht unter jedem Monat, auch beim Blättern
    zeitleisteBereich(zlKonto, konto.id, aendern),
  ].filter(Boolean));
}

/* ---------- Zukunftsmonat: Prognose statt echter Monatsabschluss ---------- */

/**
 * Ein Monat nach dem laufenden. Zahlen und Posten kommen aus der Zeitleiste
 * (wiederkehrende, geplante, Budgets und schon erfasste Buchungen mit Zukunftsdatum).
 * Alles ist Annahme – kursiv auf getöntem Hintergrund.
 */
function zukunftsMonat(zeilen, monat, startStand, m, konto, konten, kategorien, aendern) {
  const i = zeilen.findIndex((z) => z.monat === monat);
  const z = zeilen[i];
  if (!z) return [h('p', { class: 'leer' }, 'Für diesen Monat gibt es keine Prognose.')];
  const anfang = i > 0 ? zeilen[i - 1].stand : startStand;
  const zeile = (label, cent, klasse = '', vorzeichen = false) => h('div', { class: `summe ${klasse}` },
    h('span', {}, label),
    h('span', { class: 'betrag annahme' + (cent < 0 ? ' negativ' : '') }, (vorzeichen && cent > 0 ? '+' : '') + formatEuro(cent)));
  const unterMindest = konto.mindestsaldoCent != null && z.stand < konto.mindestsaldoCent;
  const annahmen = z.posten.filter((p) => p.quelle !== 'gebucht');
  const budgets = annahmen.filter((p) => p.quelle === 'budget');
  const termine = annahmen.filter((p) => p.quelle !== 'budget');
  const summe = (liste) => liste.reduce((s, p) => s + p.wirkung, 0);
  const mitVorzeichen = (cent) => (cent > 0 ? '+' : '') + formatEuro(cent);

  return [
    klappBereich({
      klasse: 'summen zukunft',
      titel: 'Prognose',
      zusatz: h('span', { class: 'marke annahme-marke' }, 'Annahme'),
      rechts: h('span', { class: 'annahme' + (z.stand < 0 ? ' negativ' : '') },
        h('span', { class: 'klapp-wert-text' }, 'Monatsende '), formatEuro(z.stand)),
      offen: ansicht.summenOffen,
      beiWechsel: (offen) => { ansicht.summenOffen = offen; },
    },
      zeile('Erwarteter Stand am Monatsanfang', anfang),
      zeile('Einnahmen', z.einnahmen, 'plus', true),
      zeile('Ausgaben', -z.ausgaben, '', true),
      z.umbuchungen !== 0 && zeile('Umbuchungen (saldiert)', z.umbuchungen, 'gedaempft', true),
      zeile('Erwarteter Stand Monatsende', z.stand, 'ergebnis'),
      unterMindest && h('p', { class: 'warn-text klein' }, `Unter dem Mindestsaldo von ${formatEuro(konto.mindestsaldoCent)}.`)),
    h('section', { class: 'bereich zukunft' },
      // Schon erfasste Buchungen stehen darunter in der normalen Liste – hier nur die Annahmen,
      // getrennt in wiederkehrende/geplante Buchungen und Budgets (D95)
      h('div', { class: 'tag-kopf liste-kopf' }, h('span', {}, `${annahmen.length} erwartete Posten`)),
      termine.length > 0 && h('div', { class: 'erwartet-block' },
        h('div', { class: 'tag-kopf' }, h('span', {}, 'Wiederkehrende und geplante Buchungen'), h('span', { class: 'tag-stand annahme' }, mitVorzeichen(summe(termine)))),
        postenListe(termine, aendern)),
      budgets.length > 0 && h('div', { class: 'erwartet-block' },
        h('div', { class: 'tag-kopf' }, h('span', {}, 'Budgets'), h('span', { class: 'tag-stand annahme' }, mitVorzeichen(summe(budgets)))),
        postenListe(budgets, aendern)),
      annahmen.length === 0 && h('p', { class: 'leer' }, 'Keine Posten in diesem Monat.'),
      h('p', { class: 'hinweis' }, 'Posten antippen, um sie nur für diesen Monat zu ändern. Ganze Serien änderst du unter „Annahmen“.')),
    // Schon erfasste Buchungen mit Datum in diesem Monat bleiben anklickbar
    m.anzahl > 0 && buchungsliste(m, konto, konten, kategorien),
  ];
}

/* ---------- „Alle Konten“: Aufstellung je Konto (D118) ---------- */

/**
 * Wie setzen sich die Summen oben zusammen? Je Konto Stand heute, Prognose Monats- und Jahresende,
 * darunter die Summe (dieselben Werte wie oben). Eine Zeile antippen öffnet das Konto.
 */
function kontenAufstellung(konten, zl, heute, waehle) {
  const p = zl.start;
  const jahr = heute.slice(0, 4);
  const wert = (cent, annahme = false, mindest = null) => h('span', {
    class: 'betrag' + (annahme ? ' annahme' : '') + (cent != null && cent < 0 ? ' negativ' : '')
      + (mindest != null && cent != null && cent < mindest ? ' warn-text' : ''),
    title: mindest != null && cent != null && cent < mindest ? `Unter dem Mindestsaldo von ${formatEuro(mindest)}` : null,
  }, cent == null ? '–' : formatEuro(cent));
  const kopf = h('div', { class: 'ka-zeile ka-kopf', 'aria-hidden': 'true' },
    h('span', { class: 'ka-name' }, 'Konto'), h('span', {}, 'Heute'), h('span', {}, 'Monatsende'), h('span', {}, `Jahresende ${jahr}`));
  const zeilen = konten.map((k) => {
    const kd = p.jeKonto.get(k.id);
    const min = k.mindestsaldoCent;
    return h('button', { type: 'button', class: 'ka-zeile', title: `${k.name} öffnen`, onclick: () => waehle(k.id) },
      h('span', { class: 'ka-name' }, k.name),
      wert(kd?.heute ?? null, false, min),
      wert(kd?.prognose ?? null, true, min),
      wert(prognoseJahresende(zl, heute, k.id), true, min));
  });
  const summe = h('div', { class: 'ka-zeile ka-summe' },
    h('span', { class: 'ka-name' }, 'Alle Konten'),
    wert(p.gesamtHeute), wert(p.gesamtPrognose, true), wert(prognoseJahresende(zl, heute), true));
  return h('section', { class: 'bereich konten-aufstellung', 'aria-label': 'Aufstellung je Konto' },
    kopf, ...zeilen, summe,
    h('p', { class: 'hinweis' }, 'Konto antippen, um es zu öffnen. Umbuchungen zwischen deinen Konten heben sich in der Summe auf.'));
}

/* ---------- Kontoauswahl ---------- */

function kontoAuswahl(konten, aktiv, faelligJeKonto, beiWahl) {
  return merkeScroll(h('div', { class: 'chips', role: 'group', 'aria-label': 'Konto wählen' },
    h('button', {
      type: 'button',
      class: 'chip',
      'aria-pressed': String(!aktiv),
      onclick: () => beiWahl(ALLE),
    }, 'Alle Konten'),
    konten.map((k) => {
      const anzahl = faelligJeKonto.get(k.id) ?? 0;
      return h('button', {
        type: 'button',
        class: 'chip',
        'aria-pressed': String(k.id === aktiv?.id),
        'aria-label': anzahl ? `${k.name}, ${anzahl} fällige Buchung${anzahl === 1 ? '' : 'en'}` : k.name,
        title: anzahl ? `${anzahl} fällige wiederkehrende Buchung${anzahl === 1 ? '' : 'en'}` : null,
        onclick: () => beiWahl(k.id),
      }, k.name, anzahl > 0 && h('span', { class: 'chip-zahl', 'aria-hidden': 'true' }, String(anzahl)));
    })), 'konto-wahl'); // D171: Scrollposition bleiben lassen
}

/* ---------- Kopf: Stand heute, Abstimmung ---------- */

function kontoKopf(konto, buchungen, abstimmungen, prognoseCent, niedrigsterCent) {
  const heute = heuteIso();
  const stand = kontostand(konto, buchungen, heute);
  const vorgemerkt = vorgemerktBis(konto, buchungen, heute);
  const letzte = abstimmungen
    .filter((a) => a.kontoId === konto.id)
    .sort((a, b) => b.erstelltAm.localeCompare(a.erstelltAm))[0];

  // D149: Zeile grau wie „Niedrigster erwarteter Stand“; farbig nur der Differenzbetrag
  // und die Erinnerung „vor N Tagen“ bzw. „Noch nicht abgestimmt“ (D145)
  const faellig = abstimmungFaellig(letzte?.datum, heute);
  let abstimmText = [h('span', { class: 'warn-text' }, 'Noch nicht abgestimmt.')];
  if (letzte) {
    // Differenz immer neu berechnen – so sieht man, ob nachgetragene Buchungen sie beheben
    const differenz = letzte.bankstandCent - kontostand(konto, buchungen, letzte.datum);
    abstimmText = [
      `Zuletzt abgestimmt für ${formatDatum(letzte.datum)}: `,
      differenz === 0 ? 'stimmt ✓' : ['Differenz ', h('span', { class: 'warn-text' }, formatEuro(differenz))],
      faellig && h('span', { class: 'warn-text' }, ` · vor ${tageZwischen(letzte.datum, heute)} Tagen`),
    ];
  }

  // D113: Raster – oben links die Stände, oben rechts „Abstimmen“; die letzte Zeile geht über die volle Breite
  // (links niedrigster erwarteter Stand, ganz rechts der Stand der Kontoabstimmung)
  return h('section', { class: 'bereich konto-kopf konto-kopf-raster' },
    h('div', { class: 'kopf-staende' },
      h('div', { class: 'klein' }, `Kontostand heute (${formatDatum(heute)})`),
      h('div', { class: 'gross' + (stand < 0 ? ' negativ' : '') }, formatEuro(stand)),
      vorgemerkt !== 0 && h('div', { class: 'klein' }, `davon vorgemerkt: ${formatEuro(vorgemerkt)}`),
      // D147: mehrere vorgemerkte Buchungen auf einmal auf „gebucht“ setzen
      vorgemerkteVonKonto(konto.id, buchungen).length > 0 && h('button', {
        type: 'button', class: 'link-knopf klein vorgemerkt-buchen', onclick: () => vorgemerktDialog(konto, buchungen),
      }, `Vorgemerkte buchen (${vorgemerkteVonKonto(konto.id, buchungen).length}) …`),
      prognoseCent !== undefined && h('div', { class: 'klein' }, 'Prognose Monatsende: ',
        h('span', { class: 'annahme' + (prognoseCent < 0 ? ' negativ' : '') }, formatEuro(prognoseCent)),
        konto.mindestsaldoCent != null && prognoseCent < konto.mindestsaldoCent && h('span', { class: 'warn-text' }, ' – unter Mindestsaldo')),
    ),
    h('button', { type: 'button', class: 'knopf kopf-abstimmen', onclick: () => abstimmungsDialog(konto, buchungen) }, 'Abstimmen'),
    // D110: ungünstigster Fall bis Monatsende – heute minus alle erwarteten Belastungen, ohne offene Eingänge
    h('div', { class: 'kopf-zeile' },
      niedrigsterCent !== undefined ? h('div', {
        class: 'klein niedrigster',
        title: 'Stand heute mit allen bis Monatsende noch erwarteten Ausgaben, Umbuchungen und Budgetresten – '
          + 'noch ausstehende Einnahmen zählen nicht mit.',
      }, 'Niedrigster erwarteter Stand: ',
      h('span', { class: 'annahme' + (niedrigsterCent < 0 ? ' negativ' : '') }, formatEuro(niedrigsterCent)),
      konto.mindestsaldoCent != null && niedrigsterCent < konto.mindestsaldoCent && h('span', { class: 'warn-text' }, ' – unter Mindestsaldo'))
        : h('span'),
      h('div', {
        class: 'klein abstimm-info',
        title: faellig ? `Länger als ${ABSTIMM_ERINNERUNG_TAGE} Tage nicht abgestimmt – mit „Abstimmen“ den Bankstand eintragen.` : null,
      }, abstimmText)),
  );
}

/** D147: Liste der vorgemerkten Buchungen eines Kontos mit Häkchen → „Als gebucht markieren“ */
function vorgemerktDialog(konto, buchungen) {
  const liste = vorgemerkteVonKonto(konto.id, buchungen);
  const haken = new Map();
  const knopfText = () => `${[...haken.values()].filter((x) => x.checked).length} von ${liste.length} ausgewählt`;
  const zaehler = h('p', { class: 'klein gedaempft' });
  const alle = h('input', { type: 'checkbox', checked: true });
  const zeile = (b) => {
    const cb = h('input', { type: 'checkbox', checked: true });
    haken.set(b.id, cb);
    cb.addEventListener('change', () => { alle.checked = [...haken.values()].every((x) => x.checked); zaehler.textContent = knopfText(); });
    const titel = b.partner || (b.art === 'umbuchung' ? 'Umbuchung' : b.notiz) || 'Buchung';
    return h('li', {},
      h('label', { class: 'vormerk-zeile' }, cb,
        h('span', { class: 'vormerk-datum' }, formatDatum(b.datum)),
        h('span', { class: 'vormerk-titel', title: titel }, titel),
        h('span', { class: 'betrag' + (wirkungCent(b) > 0 ? ' plus' : '') }, formatEuro(wirkungCent(b)))));
  };
  const ul = h('ul', { class: 'vormerk-liste' }, liste.map(zeile));
  alle.addEventListener('change', () => { haken.forEach((x) => { x.checked = alle.checked; }); zaehler.textContent = knopfText(); });
  zaehler.textContent = knopfText();
  dialog({
    titel: `Vorgemerkte Buchungen – ${konto.name}`,
    inhalt: [
      h('p', { class: 'hinweis' }, 'Angehakte Buchungen werden auf „gebucht“ gesetzt, z. B. wenn sie auf dem Kontoauszug erscheinen.'),
      h('label', { class: 'schalter' }, alle, 'Alle auswählen'),
      ul,
      zaehler,
    ],
    speichernText: 'Als gebucht markieren',
    onSpeichern: async () => {
      const ids = [...haken.entries()].filter(([, x]) => x.checked).map(([id]) => id);
      if (ids.length === 0) throw new Error('Bitte mindestens eine Buchung anhaken.');
      const geaendert = alsGebuchtMarkieren(ids, buchungen);
      await db.speichere('buchungen', geaendert);
      toast(ids.length === 1 ? '1 Buchung gebucht' : `${ids.length} Buchungen gebucht`);
      datenGeaendert();
    },
  });
}

/** D183: kleine Marke an ungewöhnlich hohen Ausgaben (mit dem üblichen Betrag als Tooltip) */
function ungewoehnlichMarke(b) {
  const schnitt = ungewoehnlich.get(b.id);
  return schnitt != null && h('span', { class: 'marke marke-warn marke-ungewoehnlich', title: `Ungewöhnlich hoch – sonst Ø ${formatEuro(schnitt)}` }, '↑ hoch');
}

/* ---------- Monatsnavigation ---------- */

function monatsNavigation({ zurueck, vor, istAktuellerMonat, wechsel, notizen = [] }) {
  const monat = `${ansicht.jahr}-${String(ansicht.monat).padStart(2, '0')}`;
  return [
    h('div', { class: 'monat-nav' },
      h('button', { type: 'button', class: 'icon-knopf', 'aria-label': 'Voriger Monat', disabled: !zurueck, onclick: () => wechsel(-1) }, '‹'),
      h('h2', { class: 'monat-titel' }, formatMonat(ansicht.jahr, ansicht.monat)),
      h('button', { type: 'button', class: 'icon-knopf', 'aria-label': 'Nächster Monat', disabled: !vor, onclick: () => wechsel(1) }, '›'),
      notizKnopf(monat, notizen), // D165
      !istAktuellerMonat && h('button', { type: 'button', class: 'knopf knopf-klein', onclick: () => wechsel('heute') }, 'Heute'),
    ),
    notizZeile(monat, notizen),
  ].filter(Boolean);
}

/* ---------- Zwischensummen ---------- */

/** kd: nur im laufenden Monat – Aufschlüsselung der Prognose für dieses Konto */
function summenKarte(konto, m, kd) {
  const zeile = (label, cent, klasse = '', vorzeichen = false) => h('div', { class: `summe ${klasse}` },
    h('span', {}, label),
    h('span', { class: 'betrag' + (cent < 0 ? ' negativ' : '') }, (vorzeichen && cent > 0 ? '+' : '') + formatEuro(cent)));
  // D112: standardmäßig eingeklappt; im Kopf steht das Ergebnis des Monats
  const ergebnis = kd ? kd.prognose : m.ende;

  return klappBereich({
    klasse: 'summen',
    titel: 'Monatsübersicht',
    // am Handy kürzer ("Prognose 5.663,44 €"), damit der Kopf einzeilig bleibt
    rechts: h('span', { class: (kd ? 'annahme' : '') + (ergebnis < 0 ? ' negativ' : '') },
      h('span', { class: 'klapp-wert-text' },
        h('span', { class: 'nur-breit' }, kd ? 'Prognose Monatsende ' : 'Stand Monatsende '),
        h('span', { class: 'nur-schmal' }, kd ? 'Prognose ' : 'Monatsende ')),
      formatEuro(ergebnis)),
    offen: ansicht.summenOffen,
    beiWechsel: (offen) => { ansicht.summenOffen = offen; },
  },
    zeile(m.stichtagImMonat ? `Anfangssaldo am ${formatDatum(konto.stichtag)}` : `Stand am ${formatDatum(m.erster)}`, m.anfang),
    zeile('Einnahmen', m.einnahmen, 'plus', true),
    zeile('Ausgaben', -m.ausgaben, '', true),
    m.umbuchungen !== 0 && zeile('Umbuchungen (saldiert)', m.umbuchungen, 'gedaempft', true),
    zeile(kd ? 'Stand nach erfassten Buchungen' : 'Stand Monatsende', m.ende, 'ergebnis'),
    // D110: offene wiederkehrende und geplante Buchungen getrennt nach Eingängen und Belastungen
    kd && kd.offenEinnahmen !== 0 && zeile('Noch offene Einnahmen', kd.offenEinnahmen, 'annahme plus', true),
    kd && kd.offenAusgaben !== 0 && zeile('Noch offene Ausgaben', kd.offenAusgaben, 'annahme', true),
    kd && kd.rest !== 0 && zeile('Noch offener Budgetrest', -kd.rest, 'annahme', true),
    kd && zeile('Prognose Monatsende', kd.prognose, 'ergebnis annahme'),
  );
}

/* ---------- Buchungsliste nach Tagen ---------- */

function buchungsliste(m, konto, konten, kategorien) {
  if (m.anzahl === 0) {
    return h('section', { class: 'bereich' },
      h('p', { class: 'leer' }, 'Keine Buchungen in diesem Monat.'),
      h('p', { class: 'hinweis' }, 'Mit dem runden „+“-Knopf unten rechts erfasst du eine Buchung.'));
  }
  const katName = new Map(kategorien.map((k) => [k.id, k]));
  const kontoName = new Map(konten.map((k) => [k.id, k.name]));
  const istUmbuchung = (b) => b.art === 'umbuchung';

  // Neueste zuerst: Tage absteigend, innerhalb eines Tages die zuletzt erfasste oben.
  // Der "Stand" je Tag bleibt der Kontostand am Ende dieses Tages.
  // Standardmäßig nur die letzten 10 Buchungen – Umbuchungen zählen dabei nicht mit (D79);
  // "Alle anzeigen" zeigt den ganzen Monat.
  const anzahl = m.tage.reduce((s, t) => s + t.buchungen.filter((b) => !istUmbuchung(b)).length, 0);
  const schluessel = `${konto.id}|${m.erster}`;
  const alle = ansicht.alleAnzeigen === schluessel;
  let rest = alle ? Infinity : MAX_BUCHUNGEN;
  const auswahl = []; // [{ tag, zeilen: [{ buchung, stand }] }] – stand = Kontostand nach dieser Buchung
  for (const tag of [...m.tage].reverse()) {
    if (rest <= 0) break;
    let stand = tag.standAbend;
    const zeilen = [];
    // D137: innerhalb eines Tages stehen Umbuchungen immer am Ende (der Tagesstand je Zeile folgt dieser Reihenfolge)
    const absteigend = [...tag.buchungen].reverse();
    const reihenfolge = [...absteigend.filter((b) => !istUmbuchung(b)), ...absteigend.filter(istUmbuchung)];
    for (const b of reihenfolge) {
      if (rest <= 0 && !istUmbuchung(b)) break;
      zeilen.push({ buchung: b, stand });
      stand -= wirkungCent(b);
      if (!istUmbuchung(b)) rest -= 1;
    }
    // Tag nur mit Umbuchungen: samt Tageszeile ausblendbar (D76)
    auswahl.push({ tag, zeilen, nurUmbuchungen: zeilen.every((z) => istUmbuchung(z.buchung)) });
  }
  const umbuchungen = auswahl.reduce((s, t) => s + t.zeilen.filter((z) => istUmbuchung(z.buchung)).length, 0);

  const tagesKopf = (tag) => h('div', { class: 'tag-kopf' },
    h('span', {}, formatTag(tag.datum)),
    h('span', { class: 'tag-stand' + (tag.standAbend < 0 ? ' negativ' : '') }, `Stand ${formatEuro(tag.standAbend)}`));

  // Am Handy: Tageszeilen mit einzeiligen Buchungen (D75/D76)
  const tage = auswahl.map(({ tag, zeilen, nurUmbuchungen }) => h('div', { class: 'tag' + (nurUmbuchungen ? ' ub-ausblendbar' : '') },
    tagesKopf(tag),
    h('ul', { class: 'liste' }, zeilen.map((z) => buchungsZeile(z.buchung, katName, kontoName)))));

  const umschalten = anzahl > MAX_BUCHUNGEN && h('div', { class: 'mehr' },
    h('button', {
      type: 'button',
      class: 'knopf knopf-klein',
      onclick: () => {
        ansicht.alleAnzeigen = alle ? null : schluessel;
        datenGeaendert(); // neu zeichnen, Scrollposition bleibt
      },
    }, alle
      ? `Nur die letzten ${MAX_BUCHUNGEN} anzeigen`
      : `Alle ${anzahl} Buchungen von ${formatMonat(...monatVon(m.erster))} anzeigen`));

  return h('section', { class: 'bereich buchungen' },
    h('div', { class: 'tag-kopf liste-kopf' },
      h('span', {}, alle || anzahl <= MAX_BUCHUNGEN
        ? (anzahl === 1 ? '1 Buchung' : `${anzahl} Buchungen`)
        : `Letzte ${MAX_BUCHUNGEN} von ${anzahl} Buchungen`),
      umbuchungKnopf(umbuchungen)),
    anzahl === 0 && h('p', { class: 'hinweis' }, 'In diesem Monat gibt es nur Umbuchungen.'),
    h('div', { class: 'nur-handy' }, tage),
    // Am PC: Tabelle wie "Alle Buchungen" mit Tageszeilen (D78/D79)
    kontoTabelle(auswahl, tagesKopf, katName, kontoName),
    umschalten,
  );
}

/** Tabelle der Buchungen eines Kontos am PC (D78–D80): neueste oben, Tageszeilen mit Tagesstand (in der Spalte Betrag) */
function kontoTabelle(auswahl, tagesKopf, katName, kontoName) {
  const farben = farbenZuordnung([...katName.values()]); // D155
  // D141: schmale Spalte „v“ (vorgemerkt) zwischen Datum und Empfänger
  const spalten = [['datum', 'Datum'], ['status', ''], ['partner', 'Empfänger/Absender'], ['kategorie', 'Kategorie'], ['notiz', 'Notiz'], ['betrag', 'Betrag']];
  const zeile = ({ buchung: b }) => {
    const wirkung = wirkungCent(b);
    let partner;
    let katText;
    if (b.art === 'umbuchung') {
      partner = 'Umbuchung';
      katText = `${b.richtung === 'ab' ? '→' : '←'} ${kontoName.get(b.gegenkontoId) ?? '?'}`
        + (b.richtung === 'ab' && b.budgetKategorieId ? ` · Budget ${katName.get(b.budgetKategorieId)?.name ?? '?'}` : ''); // D98
    } else {
      const unter = katName.get(b.kategorieId);
      partner = b.partner ?? '';
      katText = [katName.get(unter?.elternId)?.name, unter?.name ?? 'Unbekannte Kategorie'].filter(Boolean).join(' › ');
    }
    return h('li', { role: 'row', class: b.art === 'umbuchung' ? 'ub-ausblendbar' : null },
      h('button', { type: 'button', class: 'btab-zeile' + (b.art === 'umbuchung' ? ' umbuchung' : ''), onclick: () => oeffneBuchungsdialog(b) },
        h('span', { class: 'btab-zelle btab-status', title: b.status === 'vorgemerkt' ? 'vorgemerkt' : null }, b.status === 'vorgemerkt' ? 'v' : ''),
        h('span', { class: 'btab-zelle btab-partner', title: partner || null },
          partner ? h('span', { class: 'btab-partner-name' }, partner) : h('span', { class: 'gedaempft' }, '–'),
          ungewoehnlichMarke(b)),
        h('span', { class: 'btab-unter' },
          h('span', { class: 'btab-zelle btab-datum' }, formatDatum(b.datum)),
          h('span', { class: 'btab-zelle btab-kategorie', title: katText }, b.art !== 'umbuchung' && katPunkt(farbeVon(b.kategorieId, katName, farben)), katText),
          h('span', { class: 'btab-zelle btab-notiz', title: b.notiz || null }, b.notiz ?? '')),
        h('span', { class: 'btab-zelle btab-betrag betrag ' + (b.art === 'umbuchung' ? 'gedaempft' : wirkung > 0 ? 'plus' : '') },
          (wirkung > 0 ? '+' : '') + formatEuro(wirkung))));
  };
  return h('div', { class: 'btab btab-konto nur-pc', role: 'table', 'aria-label': 'Buchungen dieses Monats' },
    h('div', { class: 'btab-kopf', role: 'row' },
      spalten.map(([feld, text]) => h('span', { class: `btab-sort btab-fest btab-${feld}`, role: 'columnheader' }, text))),
    h('ul', { class: 'btab-liste', role: 'rowgroup' }, auswahl.flatMap(({ tag, zeilen, nurUmbuchungen }) => [
      h('li', { class: 'btab-tag' + (nurUmbuchungen ? ' ub-ausblendbar' : ''), role: 'row' }, tagesKopf(tag)),
      ...zeilen.map(zeile),
    ])));
}

function buchungsZeile(b, katName, kontoName, farben = farbenZuordnung([...katName.values()])) {
  let titel;
  let unterzeile;
  // Am Handy eine Zeile ohne Kategorie (D75/D76): Empfänger/Absender, sonst Notiz, sonst die Art
  let titelHandy;
  if (b.art === 'umbuchung') {
    titel = b.richtung === 'ab' ? `Umbuchung → ${kontoName.get(b.gegenkontoId) ?? '?'}` : `Umbuchung ← ${kontoName.get(b.gegenkontoId) ?? '?'}`;
    unterzeile = [b.richtung === 'ab' && b.budgetKategorieId && `Budget ${katName.get(b.budgetKategorieId)?.name ?? '?'}`, b.notiz].filter(Boolean).join(' · '); // D98
    titelHandy = titel;
  } else {
    const unter = katName.get(b.kategorieId);
    const haupt = unter && katName.get(unter.elternId);
    // Empfänger/Absender steht immer vor der Kategorie
    titel = [b.partner, unter?.name ?? 'Unbekannte Kategorie'].filter(Boolean).join(' · ');
    unterzeile = [haupt?.name, b.notiz].filter(Boolean).join(' · ');
    titelHandy = b.partner || b.notiz || (b.art === 'einnahme' ? 'Einnahme' : 'Ausgabe');
  }
  const wirkung = b.art === 'einnahme' || b.richtung === 'zu' ? b.betragCent : -b.betragCent;

  return h('li', { class: b.art === 'umbuchung' ? 'ub-ausblendbar' : null },
    h('button', { type: 'button', class: 'buchung einzeilig', onclick: () => oeffneBuchungsdialog(b) },
      h('span', { class: 'buchung-text' },
        h('span', { class: 'buchung-titel' },
          b.art !== 'umbuchung' && katPunkt(farbeVon(b.kategorieId, katName, farben), katName.get(katName.get(b.kategorieId)?.elternId)?.name), // D155
          h('span', { class: 'nur-breit' }, titel), h('span', { class: 'nur-schmal', title: titelHandy }, titelHandy),
          b.status === 'vorgemerkt' && h('span', { class: 'marke marke-vorgemerkt' }, 'vorgemerkt'),
          ungewoehnlichMarke(b)),
        unterzeile && h('span', { class: 'buchung-unter nur-breit' }, unterzeile)),
      h('span', { class: 'betrag ' + (b.art === 'umbuchung' ? 'gedaempft' : wirkung > 0 ? 'plus' : '') },
        (wirkung > 0 ? '+' : '') + formatEuro(wirkung)),
    ));
}

/* ---------- Kontoabstimmung ---------- */

function abstimmungsDialog(konto, buchungen) {
  const datum = eingabe({ label: 'Datum des Bankstands', type: 'date', value: heuteIso() });
  const bank = eingabe({ label: 'Kontostand laut Bank in €', inputmode: 'decimal', placeholder: 'z. B. 1.234,56', autofocus: true });

  dialog({
    titel: `Abstimmen: ${konto.name}`,
    inhalt: [
      h('p', { class: 'hinweis' }, 'Trag den Kontostand aus deiner Banking-App ein. Die App vergleicht ihn mit ihrem berechneten Stand am Ende dieses Tages.'),
      bank.feld,
      datum.feld,
    ],
    speichernText: 'Vergleichen',
    onSpeichern: async () => {
      const d = datum.input.value;
      if (!istGueltigesDatum(d)) throw new Error('Bitte ein gültiges Datum wählen.');
      if (d < konto.stichtag) throw new Error(`Das Datum liegt vor dem Stichtag (${formatDatum(konto.stichtag)}).`);
      const bankstandCent = parseEuro(bank.input.value, 'Kontostand');
      if (bankstandCent === null) throw new Error('Bitte den Kontostand laut Bank eingeben.');

      const berechnet = kontostand(konto, buchungen, d);
      const vorgemerkt = vorgemerktBis(konto, buchungen, d);
      await db.speichere('abstimmungen', {
        id: crypto.randomUUID(),
        kontoId: konto.id,
        datum: d,
        bankstandCent,
        berechnetCent: berechnet,
        erstelltAm: new Date().toISOString(),
      });
      // Ergebnis zeigen, sobald dieser Dialog zu ist
      setTimeout(() => zeigeErgebnis(d, bankstandCent, berechnet, vorgemerkt), 0);
      datenGeaendert();
    },
  });
}

function zeigeErgebnis(datum, bank, app, vorgemerkt) {
  const differenz = bank - app;
  const zeile = (label, wert, klasse = '') => h('div', { class: `summe ${klasse}` },
    h('span', {}, label), h('span', { class: 'betrag' + (wert < 0 ? ' negativ' : '') }, formatEuro(wert)));

  const text = [
    h('div', { class: 'summen' },
      zeile('Laut Bank', bank),
      zeile('Laut App', app),
      zeile('Differenz', differenz, 'ergebnis')),
  ];
  if (differenz === 0) {
    text.push(h('p', { class: 'erfolg-text' }, '✓ Alles stimmt überein.'));
  } else {
    text.push(h('p', {}, differenz > 0
      ? `Bei der Bank sind ${formatEuro(differenz)} mehr als in der App.`
      : `In der App sind ${formatEuro(-differenz)} mehr als bei der Bank.`));
    text.push(h('p', { class: 'hinweis' }, 'Mögliche Ursachen: fehlende oder doppelte Buchung, falscher Betrag oder falsches Datum.'));
    if (vorgemerkt !== 0) {
      text.push(h('p', { class: 'hinweis' },
        `Im App-Stand stecken vorgemerkte Buchungen (zusammen ${formatEuro(vorgemerkt)}). ` +
        `Zählt deine Bank diese noch nicht mit, wäre die Differenz ohne sie ${formatEuro(bank - (app - vorgemerkt))}.`));
    }
  }
  hinweis({ titel: `Ergebnis für ${formatDatum(datum)}`, text });
  toast('Abstimmung gespeichert');
}
