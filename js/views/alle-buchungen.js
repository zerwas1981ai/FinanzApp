// Tab "Alle Buchungen" (Etappe 3): über alle Konten filtern, sortieren, auswerten.

import { h } from '../dom.js';
import * as db from '../db.js';
import { formatEuro, formatEuroRund, formatProzent, formatDatum, formatMonat, heuteIso, parseEuro } from '../format.js';
import { schalter, herunterladen } from '../ui.js';
import { buchungenAlsCsv, exportName } from '../export.js';
import {
  STANDARD_FILTER, STANDARD_SORTIERUNG, filtere, sortiere, summen, zeitraumFuer,
  monateDerAuswertung, ersterErfassterTag, abgeschlosseneMonate, verlaufJeMonat, summenJeKategorie, schoeneObergrenze,
  OHNE_PARTNER, partnerListe, partnerSchluessel, summenJePartner,
} from '../auswertung.js';
import { oeffneBuchungsdialog } from './buchung-dialog.js';

const nachName = (a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' });
const SEITE = 200; // so viele Zeilen werden auf einmal gezeigt

// Zustand bleibt erhalten, solange die App offen ist (beim Neuladen: Standard)
const zustand = {
  filter: { ...STANDARD_FILTER },
  sortierung: { ...STANDARD_SORTIERUNG },
  modus: 'liste', // liste | analyse
  analyseArt: 'ausgabe',
  analyseGruppe: 'kategorie', // kategorie | partner
  alsTabelle: false,
  sichtbar: SEITE,
  offen: new Set(), // aufgeklappte Kategorien in der Analyse
};

const ZEITRAEUME = [
  ['monat', 'Dieser Monat'],
  ['vormonat', 'Vormonat'],
  ['jahr', 'Dieses Jahr'],
  ['vorjahr', 'Vorjahr'],
  ['alles', 'Alles'],
  ['eigen', 'Eigener Zeitraum'],
];

export async function zeigeBuchungen(container) {
  const [konten, kategorien, buchungen, projekte] = await Promise.all(['konten', 'kategorien', 'buchungen', 'projekte'].map((s) => db.alle(s)));
  const daten = { konten, kategorien, buchungen, projekte };
  const ergebnis = h('div', { class: 'ergebnis' });
  const neuZeichnen = () => zeigeBuchungen(container);
  const aktualisiere = () => {
    zustand.sichtbar = SEITE;
    zeigeErgebnis(ergebnis, daten);
  };

  container.replaceChildren(
    h('h1', { class: 'seitentitel' }, 'Alle Buchungen'),
    filterBereich(daten, aktualisiere, neuZeichnen),
    ergebnis,
  );
  zeigeErgebnis(ergebnis, daten);
}

/* =========================== Filter =========================== */

function filterGeaendert() {
  return Object.keys(STANDARD_FILTER).some((k) => zustand.filter[k] !== STANDARD_FILTER[k]);
}

function filterBereich({ konten, kategorien, buchungen }, aktualisiere, neuZeichnen) {
  const f = zustand.filter;
  const setze = (schluessel, wert, ganzNeu = false) => {
    f[schluessel] = wert;
    if (ganzNeu) neuZeichnen();
    else {
      resetKnopf.hidden = !filterGeaendert();
      aktualisiere();
    }
  };

  // Zeitraum-Schnellwahl
  const zeitraum = h('div', { class: 'chips', role: 'group', 'aria-label': 'Zeitraum' },
    ZEITRAEUME.map(([wert, text]) => h('button', {
      type: 'button',
      class: 'chip',
      'aria-pressed': String(f.zeitraum === wert),
      onclick: () => setze('zeitraum', wert, true),
    }, text)));

  const eigenerZeitraum = f.zeitraum === 'eigen' && h('div', { class: 'filter-reihe' },
    feld('Von', h('input', { type: 'date', value: f.von, onchange: (e) => setze('von', e.target.value) })),
    feld('Bis', h('input', { type: 'date', value: f.bis, onchange: (e) => setze('bis', e.target.value) })),
  );

  // Auswahllisten
  const kontoAuswahl = auswahlListe(
    [{ wert: '', text: 'Alle Konten' }, ...[...konten].sort(nachName).map((k) => ({ wert: k.id, text: k.name + (k.archiviert ? ' (archiviert)' : '') }))],
    f.kontoId, (w) => setze('kontoId', w));
  const artAuswahl = auswahlListe(
    [{ wert: '', text: 'Alle Arten' }, { wert: 'ausgabe', text: 'Ausgaben' }, { wert: 'einnahme', text: 'Einnahmen' }, { wert: 'umbuchung', text: 'Umbuchungen' }],
    f.art, (w) => setze('art', w));
  const statusAuswahl = auswahlListe(
    [{ wert: '', text: 'Jeder Status' }, { wert: 'gebucht', text: 'Gebucht' }, { wert: 'vorgemerkt', text: 'Vorgemerkt' }],
    f.status, (w) => setze('status', w));

  const kategorieAuswahl = h('select', { onchange: (e) => setze('kategorieId', e.target.value) },
    h('option', { value: '' }, 'Alle Kategorien'),
    ['einnahme', 'ausgabe'].map((art) => kategorien
      .filter((k) => !k.elternId && k.art === art)
      .sort(nachName)
      .map((hk) => h('optgroup', { label: `${hk.name} (${art === 'einnahme' ? 'Einnahme' : 'Ausgabe'})` },
        h('option', { value: hk.id }, `${hk.name} – alle`),
        kategorien.filter((u) => u.elternId === hk.id).sort(nachName)
          .map((u) => h('option', { value: u.id }, u.name + (u.archiviert ? ' (archiviert)' : '')))))));
  kategorieAuswahl.value = f.kategorieId;

  // Empfänger/Absender: alle bisher verwendeten Namen, häufigste zuerst
  const partner = partnerListe(buchungen);
  const partnerAuswahl = auswahlListe(
    [
      { wert: '', text: 'Alle' },
      { wert: OHNE_PARTNER, text: 'Ohne Angabe' },
      ...partner.map((p) => ({ wert: p.name, text: `${p.name} (${p.anzahl})` })),
    ],
    f.partner === OHNE_PARTNER ? OHNE_PARTNER : (partner.find((p) => partnerSchluessel(p.name) === partnerSchluessel(f.partner))?.name ?? ''),
    (w) => setze('partner', w));

  // Suche: bei jeder Eingabe, leicht verzögert
  let timer;
  const suche = h('input', {
    type: 'search',
    placeholder: 'Suchen in An/Von, Notiz, Kategorie, Konto …',
    value: f.suche,
    'aria-label': 'Suchen',
    oninput: (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => setze('suche', e.target.value), 200);
    },
  });

  // Betrag von/bis
  const betragFeld = (schluessel, label) => {
    const fehler = h('small', { class: 'feld-fehler' });
    const input = h('input', {
      type: 'text',
      inputmode: 'decimal',
      placeholder: label === 'Betrag ab' ? 'z. B. 50' : 'z. B. 500',
      value: f[schluessel] == null ? '' : String(f[schluessel] / 100).replace('.', ','),
      onchange: (e) => {
        try {
          const cent = parseEuro(e.target.value, label);
          fehler.textContent = '';
          setze(schluessel, cent === null ? null : Math.abs(cent));
        } catch (err) {
          fehler.textContent = err.message;
        }
      },
    });
    return feld(label + ' (€)', input, fehler);
  };

  const resetKnopf = h('button', {
    type: 'button',
    class: 'knopf knopf-klein',
    hidden: !filterGeaendert(),
    onclick: () => {
      zustand.filter = { ...STANDARD_FILTER };
      neuZeichnen();
    },
  }, 'Filter zurücksetzen');

  const weitereOffen = f.betragMin != null || f.betragMax != null || f.ohneBeleg || f.status !== '';
  return h('section', { class: 'bereich filter' },
    zeitraum,
    eigenerZeitraum,
    h('div', { class: 'filter-raster' },
      feld('Konto', kontoAuswahl),
      feld('Art', artAuswahl),
      feld('Kategorie', kategorieAuswahl),
      feld('Empfänger/Absender', partnerAuswahl),
      feld('Suche', suche),
    ),
    h('details', { class: 'weitere-filter', open: weitereOffen },
      h('summary', {}, 'Weitere Filter'),
      h('div', { class: 'filter-raster' },
        feld('Status', statusAuswahl),
        betragFeld('betragMin', 'Betrag ab'),
        betragFeld('betragMax', 'Betrag bis'),
      ),
      schalter('Nur Buchungen ohne Beleg', f.ohneBeleg, (an) => setze('ohneBeleg', an)),
      h('p', { class: 'hinweis' }, 'Belege hängst du im Buchungsdialog an (Foto oder PDF).'),
    ),
    h('div', { class: 'filter-fuss' }, resetKnopf),
  );
}

function feld(label, steuerelement, zusatz = null) {
  return h('label', { class: 'feld' }, h('span', { class: 'feld-label' }, label), steuerelement, zusatz);
}

function auswahlListe(optionen, wert, beiAenderung) {
  const s = h('select', { onchange: (e) => beiAenderung(e.target.value) },
    optionen.map((o) => h('option', { value: o.wert }, o.text)));
  s.value = wert;
  return s;
}

/* =========================== Ergebnis =========================== */

function zeigeErgebnis(ziel, daten) {
  const heute = heuteIso();
  const eintraege = filtere(daten.buchungen, zustand.filter, { ...daten, heute });
  const s = summen(eintraege);
  const { von, bis } = zeitraumFuer(zustand.filter, heute);

  const modusWahl = h('div', { class: 'segmente', role: 'group', 'aria-label': 'Ansicht' },
    [['liste', 'Liste'], ['analyse', 'Analyse']].map(([wert, text]) => h('button', {
      type: 'button',
      class: 'segment',
      'aria-pressed': String(zustand.modus === wert),
      onclick: () => { zustand.modus = wert; zeigeErgebnis(ziel, daten); },
    }, text)));

  ziel.replaceChildren(
    summenKarte(s, von, bis),
    modusWahl,
    zustand.modus === 'liste'
      ? liste(eintraege, daten, () => zeigeErgebnis(ziel, daten))
      : analyse(eintraege, daten, heute, () => zeigeErgebnis(ziel, daten)),
  );
}

function summenKarte(s, von, bis) {
  let zeitraumText = 'Gesamter Zeitraum';
  if (von && bis) zeitraumText = `${formatDatum(von)} – ${formatDatum(bis)}`;
  else if (von) zeitraumText = `ab ${formatDatum(von)}`;
  else if (bis) zeitraumText = `bis ${formatDatum(bis)}`;

  const kachel = (label, cent, klasse = '', vorzeichen = false) => h('div', { class: 'kachel' },
    h('div', { class: 'klein' }, label),
    h('div', { class: `betrag ${klasse}` + (cent < 0 ? ' negativ' : '') }, (vorzeichen && cent > 0 ? '+' : '') + formatEuro(cent)));

  return h('section', { class: 'bereich summen-kopf' },
    h('div', { class: 'klein' }, `${zeitraumText} · ${s.anzahl === 1 ? '1 Buchung' : `${s.anzahl} Buchungen`}`),
    h('div', { class: 'kacheln' },
      kachel('Einnahmen', s.einnahmen, 'plus', true),
      kachel('Ausgaben', -s.ausgaben),
      kachel('Saldo', s.saldo, '', true),
      zustand.filter.kontoId && s.umbuchungen !== 0 && kachel('Umbuchungen', s.umbuchungen, 'gedaempft', true),
    ),
  );
}

/* --------------------------- Liste --------------------------- */

function liste(eintraege, daten, neu) {
  const sortiert = sortiere(eintraege, zustand.sortierung, daten);
  const kat = new Map(daten.kategorien.map((k) => [k.id, k]));
  const kontoName = new Map(daten.konten.map((k) => [k.id, k.name]));

  const sortFeld = auswahlListe(
    [{ wert: 'datum', text: 'Datum' }, { wert: 'betrag', text: 'Betrag' }, { wert: 'partner', text: 'Empfänger/Absender' }, { wert: 'kategorie', text: 'Kategorie' }, { wert: 'konto', text: 'Konto' }],
    zustand.sortierung.feld,
    (w) => { zustand.sortierung.feld = w; neu(); });
  const absteigend = zustand.sortierung.richtung === 'ab';
  const richtung = h('button', {
    type: 'button',
    class: 'knopf knopf-klein',
    'aria-label': absteigend ? 'Absteigend sortiert – umschalten' : 'Aufsteigend sortiert – umschalten',
    onclick: () => { zustand.sortierung.richtung = absteigend ? 'auf' : 'ab'; neu(); },
  }, absteigend ? '↓ absteigend' : '↑ aufsteigend');

  if (sortiert.length === 0) {
    return h('section', { class: 'bereich' }, h('p', { class: 'leer' }, 'Keine Buchungen passen zu diesen Filtern.'));
  }

  const zeigen = sortiert.slice(0, zustand.sichtbar);
  // Export der gefilterten Liste (Etappe 6). Bei Umbuchungen kommen beide Hälften mit, damit die CSV vollständig ist.
  const exportKnopf = h('button', {
    type: 'button',
    class: 'knopf knopf-klein',
    onclick: () => {
      const ids = new Set(sortiert.map((e) => e.buchung.umbuchungId ?? e.buchung.id));
      const auswahl = daten.buchungen.filter((b) => ids.has(b.umbuchungId ?? b.id));
      herunterladen(buchungenAlsCsv(auswahl, daten), exportName('auswahl', heuteIso()), 'text/csv;charset=utf-8');
    },
  }, 'Als CSV (Excel)');
  return h('section', { class: 'bereich buchungen' },
    h('div', { class: 'sortierung' }, h('span', { class: 'klein' }, 'Sortieren nach'), sortFeld, richtung, exportKnopf),
    h('ul', { class: 'liste' }, zeigen.map(({ buchung: b, wirkung }) => {
      let titel;
      let teile;
      if (b.art === 'umbuchung') {
        const von = b.richtung === 'ab' ? b.kontoId : b.gegenkontoId;
        const auf = b.richtung === 'ab' ? b.gegenkontoId : b.kontoId;
        titel = `Umbuchung ${kontoName.get(von) ?? '?'} → ${kontoName.get(auf) ?? '?'}`;
        teile = [formatDatum(b.datum), b.notiz];
      } else {
        const unter = kat.get(b.kategorieId);
        // Empfänger/Absender steht immer vor der Kategorie
        titel = [b.partner, unter?.name ?? 'Unbekannte Kategorie'].filter(Boolean).join(' · ');
        teile = [formatDatum(b.datum), kontoName.get(b.kontoId), kat.get(unter?.elternId)?.name, b.notiz];
      }
      // Umbuchung ohne Kontofilter: neutral ohne Vorzeichen
      const betragText = b.art === 'umbuchung' && wirkung === 0
        ? formatEuro(b.betragCent)
        : (wirkung > 0 ? '+' : '') + formatEuro(wirkung);
      const klasse = b.art === 'umbuchung' ? 'gedaempft' : wirkung > 0 ? 'plus' : '';
      return h('li', {},
        h('button', { type: 'button', class: 'buchung', onclick: () => oeffneBuchungsdialog(b) },
          h('span', { class: 'buchung-text' },
            h('span', { class: 'buchung-titel' }, titel, b.status === 'vorgemerkt' && h('span', { class: 'marke' }, 'vorgemerkt')),
            h('span', { class: 'buchung-unter' }, teile.filter(Boolean).join(' · '))),
          h('span', { class: `betrag ${klasse}` }, betragText)));
    })),
    sortiert.length > zeigen.length && h('div', { class: 'mehr' },
      h('button', {
        type: 'button',
        class: 'knopf',
        onclick: () => { zustand.sichtbar += SEITE; neu(); },
      }, `Weitere anzeigen (${sortiert.length - zeigen.length} übrig)`)),
  );
}

/* --------------------------- Analyse --------------------------- */

function analyse(eintraege, daten, heute, neu) {
  const erster = ersterErfassterTag(daten.buchungen, zustand.filter);
  const monate = monateDerAuswertung(eintraege, zustand.filter, heute, erster);
  if (eintraege.length === 0 || monate.length === 0) {
    return h('section', { class: 'bereich' }, h('p', { class: 'leer' }, 'Keine Buchungen für eine Auswertung.'));
  }
  return h('div', {},
    verlaufBereich(verlaufJeMonat(eintraege, monate), neu),
    zustand.analyseGruppe === 'partner'
      ? partnerBereich(eintraege, monate, heute, neu)
      : kategorieBereich(eintraege, daten.kategorien, monate, heute, neu),
  );
}

/** Umschalter: Analyse nach Kategorien oder nach Empfänger/Absender */
function gruppeWahl(neu) {
  return h('div', { class: 'segmente', role: 'group', 'aria-label': 'Gruppieren nach' },
    [['kategorie', 'Nach Kategorien'], ['partner', 'Nach Empfänger/Absender']].map(([wert, text]) => h('button', {
      type: 'button',
      class: 'segment',
      'aria-pressed': String(zustand.analyseGruppe === wert),
      onclick: () => { zustand.analyseGruppe = wert; neu(); },
    }, text)));
}

/** Ausgaben/Einnahmen-Umschalter der Analyse */
function artWahlAnalyse(neu) {
  return h('div', { class: 'segmente', role: 'group', 'aria-label': 'Art' },
    [['ausgabe', 'Ausgaben'], ['einnahme', 'Einnahmen']].map(([wert, text]) => h('button', {
      type: 'button',
      class: 'segment',
      'aria-pressed': String(zustand.analyseArt === wert),
      onclick: () => { zustand.analyseArt = wert; neu(); },
    }, text)));
}

const MAX_PARTNER = 25; // so viele Empfänger/Absender einzeln, der Rest als "Weitere"

/** Summen je Empfänger/Absender mit Anteil und Ø pro Monat. Antippen filtert die Liste. */
function partnerBereich(eintraege, monate, heute, neu) {
  const schnittMonate = abgeschlosseneMonate(monate, heute);
  const anzahlMonate = schnittMonate.length;
  const art = zustand.analyseArt;
  const alle = summenJePartner(eintraege, art, schnittMonate);
  const gesamt = alle.reduce((s, g) => s + g.summe, 0);
  const max = Math.max(...alle.map((g) => g.summe), 1);
  const mitSchnitt = anzahlMonate > 0 && monate.length > 1;
  const gezeigt = alle.slice(0, MAX_PARTNER);
  const rest = alle.slice(MAX_PARTNER);
  const schnittVon = (liste) => (anzahlMonate ? Math.round(liste.reduce((s, g) => s + g.schnittSumme, 0) / anzahlMonate) : null);

  const zeile = (x, klickbar) => {
    const inhalt = [
      h('span', { class: 'kat-zeile-name' }, x.name, h('span', { class: 'klein' }, ` (${x.anzahl})`)),
      h('span', { class: 'kat-balken-spur', 'aria-hidden': 'true' },
        h('span', { class: `kat-balken ${art}`, style: `width:${(x.summe / max) * 100}%` })),
      h('span', { class: 'betrag' }, formatEuro(x.summe)),
      h('span', { class: 'kat-anteil' }, formatProzent(x.anteil)),
      mitSchnitt && h('span', { class: 'kat-schnitt' }, x.schnitt == null ? '' : `Ø ${formatEuro(x.schnitt)}`),
    ];
    return klickbar
      ? h('button', {
        type: 'button',
        class: 'kat-zeile ebene-1 kat-zeile-knopf',
        title: 'Liste nach diesem Empfänger/Absender filtern',
        onclick: () => {
          zustand.filter.partner = x.id === OHNE_PARTNER ? OHNE_PARTNER : x.name;
          zustand.modus = 'liste';
          window.dispatchEvent(new Event('daten-geaendert'));
        },
      }, inhalt)
      : h('div', { class: 'kat-zeile ebene-1' }, inhalt);
  };

  const restSumme = rest.reduce((s, g) => s + g.summe, 0);
  return h('section', { class: 'bereich' },
    h('div', { class: 'bereich-kopf' }, h('h2', {}, 'Nach Empfänger/Absender')),
    gruppeWahl(neu),
    artWahlAnalyse(neu),
    alle.length === 0
      ? h('p', { class: 'leer' }, art === 'ausgabe' ? 'Keine Ausgaben in der Auswahl.' : 'Keine Einnahmen in der Auswahl.')
      : h('div', { class: 'kat-tabelle' + (mitSchnitt ? ' mit-schnitt' : '') },
        gezeigt.map((g) => zeile(g, true)),
        rest.length > 0 && zeile({
          name: `Weitere ${rest.length}`,
          anzahl: rest.reduce((s, g) => s + g.anzahl, 0),
          summe: restSumme,
          anteil: gesamt ? restSumme / gesamt : 0,
          schnitt: schnittVon(rest),
        }, false),
        h('div', { class: 'kat-zeile summe-zeile' },
          h('span', { class: 'kat-zeile-name' }, 'Gesamt'),
          h('span', {}),
          h('span', { class: 'betrag' }, formatEuro(gesamt)),
          h('span', { class: 'kat-anteil' }, '100 %'),
          mitSchnitt && h('span', { class: 'kat-schnitt' }, `Ø ${formatEuro(schnittVon(alle))}`))),
    h('p', { class: 'hinweis' }, 'Eine Zeile antippen, um die Liste nach diesem Empfänger/Absender zu filtern. ' +
      'Groß-/Kleinschreibung spielt keine Rolle. Der Ø zählt wie bei den Kategorien nur abgeschlossene Monate.'),
  );
}

/** Balkendiagramm Einnahmen/Ausgaben je Monat, mit Tooltip und Tabellenansicht */
function verlaufBereich(zeilen, neu) {
  const mehrereJahre = new Set(zeilen.map((z) => z.jahr)).size > 1;
  const kurz = (z) => new Intl.DateTimeFormat('de-DE', { month: 'short' }).format(new Date(z.jahr, z.monat - 1, 1)).replace('.', '')
    + (mehrereJahre ? ` ${String(z.jahr).slice(2)}` : '');

  const umschalter = h('button', {
    type: 'button',
    class: 'knopf knopf-klein',
    onclick: () => { zustand.alsTabelle = !zustand.alsTabelle; neu(); },
  }, zustand.alsTabelle ? 'Als Diagramm' : 'Als Tabelle');

  const kopf = h('div', { class: 'bereich-kopf' }, h('h2', {}, 'Verlauf je Monat'), umschalter);

  if (zustand.alsTabelle) {
    return h('section', { class: 'bereich' }, kopf,
      h('div', { class: 'tabelle-rahmen' },
        h('table', { class: 'tabelle' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Monat'), h('th', {}, 'Einnahmen'), h('th', {}, 'Ausgaben'), h('th', {}, 'Saldo'))),
          h('tbody', {}, zeilen.map((z) => h('tr', {},
            h('td', {}, formatMonat(z.jahr, z.monat)),
            h('td', {}, formatEuro(z.einnahmen)),
            h('td', {}, formatEuro(z.ausgaben)),
            h('td', { class: z.saldo < 0 ? 'negativ' : '' }, formatEuro(z.saldo))))))));
  }

  const max = schoeneObergrenze(Math.max(...zeilen.map((z) => Math.max(z.einnahmen, z.ausgaben)), 1));
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const tooltip = h('div', { class: 'tooltip', role: 'status', hidden: true });
  // Bei vielen Monaten nur jede n-te Beschriftung zeigen
  const jedeNte = Math.ceil(zeilen.length / 12);

  const zeigeTooltip = (spalte, z) => {
    tooltip.replaceChildren(
      h('strong', {}, formatMonat(z.jahr, z.monat)),
      h('div', {}, h('span', { class: 'legende-punkt einnahme' }), `Einnahmen ${formatEuro(z.einnahmen)}`),
      h('div', {}, h('span', { class: 'legende-punkt ausgabe' }), `Ausgaben ${formatEuro(z.ausgaben)}`),
      h('div', { class: 'tooltip-saldo' }, `Saldo ${formatEuro(z.saldo)}`),
    );
    tooltip.hidden = false;
    const flaeche = spalte.closest('.diagramm-flaeche').getBoundingClientRect();
    const r = spalte.getBoundingClientRect();
    const mitte = r.left + r.width / 2 - flaeche.left;
    tooltip.style.left = `${Math.min(Math.max(mitte, 80), flaeche.width - 80)}px`;
  };

  const spalten = zeilen.map((z, i) => {
    const spalte = h('div', {
      class: 'spalte',
      tabindex: '0',
      'aria-label': `${formatMonat(z.jahr, z.monat)}: Einnahmen ${formatEuro(z.einnahmen)}, Ausgaben ${formatEuro(z.ausgaben)}`,
    },
    h('div', { class: 'balken-paar' },
      h('div', { class: 'balken einnahme', style: `height:${(z.einnahmen / max) * 100}%` }),
      h('div', { class: 'balken ausgabe', style: `height:${(z.ausgaben / max) * 100}%` })),
    h('div', { class: 'spalte-label' }, i % jedeNte === 0 ? kurz(z) : ''));
    spalte.addEventListener('mouseenter', () => zeigeTooltip(spalte, z));
    spalte.addEventListener('focus', () => zeigeTooltip(spalte, z));
    spalte.addEventListener('mouseleave', () => { tooltip.hidden = true; });
    spalte.addEventListener('blur', () => { tooltip.hidden = true; });
    return spalte;
  });

  return h('section', { class: 'bereich' }, kopf,
    h('div', { class: 'legende' },
      h('span', {}, h('span', { class: 'legende-punkt einnahme' }), 'Einnahmen'),
      h('span', {}, h('span', { class: 'legende-punkt ausgabe' }), 'Ausgaben'),
      h('span', { class: 'klein' }, 'Umbuchungen zählen nicht mit')),
    h('div', { class: 'diagramm' },
      h('div', { class: 'achse' }, [...ticks].reverse().map((t) => h('span', {}, formatEuroRund(max * t)))),
      h('div', { class: 'diagramm-flaeche' },
        h('div', { class: 'gitter' }, ticks.map((t) => h('span', { style: `bottom:${t * 100}%` }))),
        h('div', { class: 'spalten', style: `min-width:${zeilen.length * 34}px` }, spalten),
        tooltip)),
  );
}

/** Summen je Haupt-/Unterkategorie mit Anteil und Durchschnitt pro Monat */
function kategorieBereich(eintraege, kategorien, monate, heute, neu) {
  // Ø nur über abgeschlossene Monate – der laufende Monat würde ihn verfälschen
  const schnittMonate = abgeschlosseneMonate(monate, heute);
  const anzahlMonate = schnittMonate.length;
  const art = zustand.analyseArt;
  const gruppen = summenJeKategorie(eintraege, kategorien, art, schnittMonate);
  const gesamt = gruppen.reduce((s, g) => s + g.summe, 0);
  const gesamtSchnitt = anzahlMonate ? Math.round(gruppen.reduce((s, g) => s + g.schnittSumme, 0) / anzahlMonate) : null;
  const max = Math.max(...gruppen.map((g) => g.summe), 1);
  const mitSchnitt = anzahlMonate > 0 && monate.length > 1;
  const laufenderAusgelassen = schnittMonate.length < monate.length;

  const artWahl = artWahlAnalyse(neu);

  const zeile = (x, ebene) => h('div', { class: `kat-zeile ebene-${ebene}` },
    h('span', { class: 'kat-zeile-name' }, x.name),
    h('span', { class: 'kat-balken-spur', 'aria-hidden': 'true' },
      h('span', { class: `kat-balken ${art}`, style: `width:${(x.summe / max) * 100}%` })),
    h('span', { class: 'betrag' }, formatEuro(x.summe)),
    h('span', { class: 'kat-anteil' }, formatProzent(x.anteil)),
    mitSchnitt && h('span', { class: 'kat-schnitt' }, `Ø ${formatEuro(x.schnitt)}`));

  return h('section', { class: 'bereich' },
    h('div', { class: 'bereich-kopf' }, h('h2', {}, 'Nach Kategorien')),
    gruppeWahl(neu),
    artWahl,
    gruppen.length === 0
      ? h('p', { class: 'leer' }, art === 'ausgabe' ? 'Keine Ausgaben in der Auswahl.' : 'Keine Einnahmen in der Auswahl.')
      : h('div', { class: 'kat-tabelle' + (mitSchnitt ? ' mit-schnitt' : '') },
        gruppen.map((g) => {
          const d = h('details', { open: zustand.offen.has(g.id) },
            h('summary', {}, zeile(g, 1)),
            g.unter.map((u) => zeile(u, 2)));
          d.addEventListener('toggle', () => (d.open ? zustand.offen.add(g.id) : zustand.offen.delete(g.id)));
          return d;
        }),
        h('div', { class: 'kat-zeile summe-zeile' },
          h('span', { class: 'kat-zeile-name' }, 'Gesamt'),
          h('span', {}),
          h('span', { class: 'betrag' }, formatEuro(gesamt)),
          h('span', { class: 'kat-anteil' }, '100 %'),
          mitSchnitt && h('span', { class: 'kat-schnitt' }, `Ø ${formatEuro(gesamtSchnitt)}`))),
    mitSchnitt && h('p', { class: 'hinweis' },
      `Ø = Durchschnitt pro Monat über ${anzahlMonate === 1 ? '1 abgeschlossenen Monat' : `${anzahlMonate} abgeschlossene Monate`} ` +
      (anzahlMonate === 1
        ? `(${formatMonat(...schnittMonate[0])}). `
        : `(${formatMonat(...schnittMonate[0])} bis ${formatMonat(...schnittMonate.at(-1))}). `) +
      'Gezählt wird erst ab dem ersten Monat mit erfassten Buchungen' +
      (laufenderAusgelassen ? '; der laufende Monat zählt nicht mit, weil er noch nicht vorbei ist.' : '.')),
    !mitSchnitt && monate.length > 1 && h('p', { class: 'hinweis' },
      'Der Durchschnitt pro Monat erscheint, sobald der erste Monat abgeschlossen ist.'),
  );
}
