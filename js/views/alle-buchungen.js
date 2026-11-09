// Tab "Alle Buchungen" (Etappe 3): über alle Konten filtern, sortieren, auswerten.

import { h } from '../dom.js';
import * as db from '../db.js';
import { formatEuro, formatEuroRund, formatProzent, formatDatum, formatMonat, heuteIso, parseEuro } from '../format.js';
import { herunterladen, toast } from '../ui.js';
import { archivInhalt } from '../sync/abgleich.js';
import { buchungenAlsCsv, exportName } from '../export.js';
import {
  STANDARD_FILTER, STANDARD_SORTIERUNG, filtere, sortiere, summen, zeitraumFuer,
  monateDerAuswertung, ersterErfassterTag, abgeschlosseneMonate, summenJeKategorie, schoeneObergrenze,
  vorjahrJeMonat,
  vorperiode, monatsSummenJeKategorie, letzteZwoelfMonate, budgetSchnitt, groessteBuchungen, veraenderungProzent,
  ausgabenVerlauf,
  OHNE_PARTNER, partnerListe, partnerSchluessel, summenJePartner, sortiereNach,
} from '../auswertung.js';
import { oeffneBuchungsdialog } from './buchung-dialog.js';
import { zeitleiste, nurWirksam, plusMonate } from '../prognose.js';
import { umbuchungKnopf } from './kennzahlen.js';
import { sortiereKonten } from '../konten.js';

const nachName = (a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' });
// D124: zunächst 20 Buchungen (Umbuchungen zählen dabei nicht mit), der Rest per Knopf darunter
const SEITE = 20;

// Zustand bleibt erhalten, solange die App offen ist (beim Neuladen: Standard)
const zustand = {
  filter: { ...STANDARD_FILTER },
  sortierung: STANDARD_SORTIERUNG,
  modus: 'liste', // liste | analyse
  analyseArt: 'ausgabe',
  analyseGruppe: 'kategorie', // kategorie | partner
  alsTabelle: false,
  vorjahr: false, // Vorjahr im Verlauf zeigen (D107)
  sichtbar: SEITE,
  offen: new Set(), // aufgeklappte Kategorien in der Analyse
};

/** "Ansehen" eines archivierten Jahres (aus den Stammdaten): Filter auf dieses Jahr stellen */
function zeigeJahr(jahr) {
  zustand.sichtbar = SEITE;
  zustand.filter = { ...STANDARD_FILTER, zeitraum: 'eigen', von: `${jahr}-01-01`, bis: `${jahr}-12-31` };
}

// D122: Reihenfolge nach Wunsch des Nutzers; „Vormonat“ und „Vorjahr“ entfallen
const ZEITRAEUME = [
  ['alles', 'Alles'],
  ['jahr', 'Dieses Jahr'],
  ['monat', 'Dieser Monat'],
  ['letzte3', 'Letzte 3 Monate'],
  ['eigen', 'Eigener Zeitraum'],
];

/**
 * Archivierte Jahre (D68/D69) zählen in Liste und Analyse ganz normal mit – nur bearbeiten lassen
 * sie sich nicht. Ihre Buchungen kommen aus dem Zwischenspeicher bzw. aus Google Drive und
 * tragen zur Kennzeichnung das (nicht gespeicherte) Feld archivJahr.
 * anmelden: true nur aus einem Klick heraus (Google-Fenster)
 */
export async function ladeArchive(archive, anmelden) {
  const geladen = [];
  const fehlend = [];
  for (const eintrag of [...archive].sort((a, b) => a.jahr - b.jahr)) {
    try {
      const inhalt = await archivInhalt(eintrag, { anmelden });
      if (inhalt) geladen.push({ eintrag, inhalt });
      else fehlend.push(eintrag.jahr);
    } catch (err) {
      console.warn(err);
      fehlend.push(eintrag.jahr);
    }
  }
  return { geladen, fehlend };
}

export async function zeigeBuchungen(container, { archivAnmelden = false } = {}) {
  const [konten, kategorien, buchungen, projekte, archive, budgets, wiederkehrende, geplant] = await Promise.all(
    ['konten', 'kategorien', 'buchungen', 'projekte', 'archive', 'budgets', 'wiederkehrend', 'geplant'].map((s) => db.alle(s)),
  );
  const gewuenscht = sessionStorage.getItem('finanzapp-bestand');
  if (gewuenscht) {
    sessionStorage.removeItem('finanzapp-bestand');
    zeigeJahr(Number(gewuenscht));
  }

  const { geladen, fehlend } = await ladeArchive(archive, archivAnmelden);
  // Namen aus den Archiven, falls Konten/Kategorien/Projekte inzwischen gelöscht wurden
  const vereint = (aktuell, alt) => [...aktuell, ...alt.filter((x) => !aktuell.some((y) => y.id === x.id))];
  const daten = {
    konten: vereint(konten, geladen.flatMap((a) => a.inhalt.konten ?? [])),
    kategorien: vereint(kategorien, geladen.flatMap((a) => a.inhalt.kategorien ?? [])),
    projekte: vereint(projekte, geladen.flatMap((a) => a.inhalt.projekte ?? [])),
    buchungen: [...geladen.flatMap(({ eintrag, inhalt }) => inhalt.buchungen.map((b) => ({ ...b, archivJahr: eintrag.jahr }))), ...buchungen],
    budgets, // für „Ist vs. Budget“ in der Analyse (D125)
    // D126: für die erwarteten Ausgaben (Zeitleiste) – ohne Archiv-Buchungen, die stecken schon im Anfangssaldo
    wiederkehrende, geplant, hauptBuchungen: buchungen,
  };

  const ergebnis = h('div', { class: 'ergebnis' });
  const neuZeichnen = () => zeigeBuchungen(container);
  const aktualisiere = () => {
    zustand.sichtbar = SEITE;
    zeigeErgebnis(ergebnis, daten);
  };

  const archivInfo = fehlend.length > 0
    ? h('p', { class: 'hinweis archiv-hinweis warn-text' },
      `Archivierte Jahre ${fehlend.join(', ')} sind auf diesem Gerät noch nicht geladen und fehlen in Liste und Analyse. `,
      h('button', {
        type: 'button',
        class: 'knopf knopf-klein',
        onclick: () => zeigeBuchungen(container, { archivAnmelden: true }),
      }, 'Aus Google Drive laden'))
    : geladen.length > 0 && h('p', { class: 'hinweis archiv-hinweis' },
      `Enthält auch die archivierten Jahre ${geladen.map((a) => a.eintrag.jahr).join(', ')} (nur lesen, Kennzeichnung „Archiv“).`);

  container.replaceChildren(...[
    h('h1', { class: 'seitentitel' }, 'Alle Buchungen'),
    archivInfo,
    filterBereich(daten, aktualisiere, neuZeichnen),
    ergebnis,
  ].filter(Boolean));
  zeigeErgebnis(ergebnis, daten);
}

/* =========================== Filter =========================== */

function filterGeaendert() {
  return Object.keys(STANDARD_FILTER).some((k) => JSON.stringify(zustand.filter[k]) !== JSON.stringify(STANDARD_FILTER[k]));
}

// Offene Mehrfachauswahl schließen, wenn daneben getippt wird (einmal für die ganze App)
document.addEventListener('click', (e) => {
  for (const d of document.querySelectorAll('details.mehrfach[open]')) {
    if (!d.contains(e.target)) d.open = false;
  }
});

/**
 * Aufklappliste mit Häkchen (Mehrfachauswahl, D72). Nichts angehakt = alle.
 * optionen: [{ wert, text, kurz?, gruppe?, eltern? }] – gruppe = Hauptkategorie (umfasst ihre
 * Unterkategorien), eltern = wert der zugehörigen Hauptkategorie, kurz = Text für die Anzeige.
 */
function mehrfachAuswahl({ optionen, gewaehlt, alleText, gleich = (a, b) => a === b, beiAenderung }) {
  let auswahl = [...gewaehlt];
  let d = null; // die Aufklappliste (wird unten erzeugt)
  const istGewaehlt = (wert) => auswahl.some((w) => gleich(w, wert));
  const anzeige = h('span', { class: 'mehrfach-text' });
  const kaesten = [];

  const leeren = h('button', {
    type: 'button',
    class: 'mehrfach-leeren',
    onclick: () => {
      auswahl = [];
      aktualisiereAnzeige();
      beiAenderung(auswahl);
    },
  }, 'Auswahl aufheben');

  function aktualisiereAnzeige() {
    const namen = optionen.filter((o) => istGewaehlt(o.wert)).map((o) => o.kurz ?? o.text);
    anzeige.textContent = namen.length === 0 ? alleText
      : namen.length <= 2 ? namen.join(', ')
        : `${namen.length} ausgewählt`;
    for (const { o, input } of kaesten) {
      // Unterkategorie ist schon enthalten, wenn ihre Hauptkategorie angehakt ist
      const durchEltern = o.eltern != null && istGewaehlt(o.eltern);
      input.checked = durchEltern || istGewaehlt(o.wert);
      input.disabled = durchEltern;
    }
    leeren.hidden = auswahl.length === 0;
    // D126: ein aktiver Filter ist farbig hervorgehoben
    d?.classList.toggle('aktiv', auswahl.length > 0);
  }

  // D120: Unterkategorien zunächst eingeklappt; „+“ an der Hauptkategorie klappt sie auf.
  // Ist schon eine Unterkategorie gewählt, steht ihre Gruppe von Anfang an offen.
  const offeneGruppen = new Set(optionen.filter((o) => o.eltern != null && istGewaehlt(o.wert)).map((o) => o.eltern));
  const unterZeilen = new Map(); // Hauptkategorie → ihre Zeilen
  const zeilen = optionen.map((o) => {
    const input = h('input', {
      type: 'checkbox',
      onchange: () => {
        auswahl = input.checked
          ? [...auswahl, o.wert]
          : auswahl.filter((w) => !gleich(w, o.wert));
        // Hauptkategorie angehakt: einzeln gewählte Unterkategorien sind darin schon enthalten
        if (o.gruppe && input.checked) {
          const unter = optionen.filter((u) => u.eltern === o.wert).map((u) => u.wert);
          auswahl = auswahl.filter((w) => !unter.includes(w));
        }
        aktualisiereAnzeige();
        beiAenderung(auswahl);
      },
    });
    kaesten.push({ o, input });
    const klasse = 'mehrfach-option' + (o.gruppe ? ' gruppe' : '') + (o.eltern != null ? ' unter' : '');
    const zeile = h('label', { class: klasse, hidden: o.eltern != null && !offeneGruppen.has(o.eltern) }, input, h('span', {}, o.text));
    if (o.eltern != null) {
      if (!unterZeilen.has(o.eltern)) unterZeilen.set(o.eltern, []);
      unterZeilen.get(o.eltern).push(zeile);
    }
    if (!o.gruppe || !optionen.some((u) => u.eltern === o.wert)) return zeile;
    const knopf = h('button', {
      type: 'button',
      class: 'mehrfach-klapp',
      'aria-expanded': String(offeneGruppen.has(o.wert)),
      'aria-label': `Unterkategorien von ${o.kurz ?? o.text} anzeigen`,
      onclick: () => {
        const auf = knopf.getAttribute('aria-expanded') !== 'true';
        knopf.setAttribute('aria-expanded', String(auf));
        knopf.textContent = auf ? '−' : '+';
        for (const z of unterZeilen.get(o.wert) ?? []) z.hidden = !auf;
      },
    }, offeneGruppen.has(o.wert) ? '−' : '+');
    return h('div', { class: 'mehrfach-gruppe-zeile' }, zeile, knopf);
  });

  d = h('details', { class: 'mehrfach' },
    h('summary', { class: 'mehrfach-knopf' }, anzeige),
    h('div', { class: 'mehrfach-liste' }, leeren, zeilen));
  aktualisiereAnzeige();
  return d;
}

function filterBereich({ konten, kategorien, buchungen }, aktualisiere, neuZeichnen) {
  const f = zustand.filter;
  const setze = (schluessel, wert, ganzNeu = false) => {
    f[schluessel] = wert;
    if (ganzNeu) { zustand.sichtbar = SEITE; neuZeichnen(); }
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

  // Auswahllisten mit Häkchen (Mehrfachauswahl, D72)
  const kontoAuswahl = mehrfachAuswahl({
    optionen: sortiereKonten(konten).map((k) => ({ wert: k.id, text: k.name + (k.archiviert ? ' (archiviert)' : ''), kurz: k.name })),
    gewaehlt: f.kontoIds,
    alleText: 'Alle Konten',
    beiAenderung: (w) => setze('kontoIds', w),
  });
  const artAuswahl = mehrfachAuswahl({
    optionen: [{ wert: 'ausgabe', text: 'Ausgaben' }, { wert: 'einnahme', text: 'Einnahmen' }, { wert: 'umbuchung', text: 'Umbuchungen' }],
    gewaehlt: f.arten,
    alleText: 'Alle Arten',
    beiAenderung: (w) => setze('arten', w),
  });

  const katOptionen = ['einnahme', 'ausgabe'].flatMap((art) => kategorien
    .filter((k) => !k.elternId && k.art === art)
    .sort(nachName)
    .flatMap((hk) => [
      { wert: hk.id, text: `${hk.name} (${art === 'einnahme' ? 'Einnahme' : 'Ausgabe'})`, kurz: hk.name, gruppe: true },
      ...kategorien.filter((u) => u.elternId === hk.id).sort(nachName)
        .map((u) => ({ wert: u.id, text: u.name + (u.archiviert ? ' (archiviert)' : ''), kurz: u.name, eltern: hk.id })),
    ]));
  const kategorieAuswahl = mehrfachAuswahl({
    optionen: katOptionen,
    gewaehlt: f.kategorieIds,
    alleText: 'Alle Kategorien',
    beiAenderung: (w) => setze('kategorieIds', w),
  });

  // Empfänger/Absender: alle bisher verwendeten Namen, häufigste zuerst
  const partner = partnerListe(buchungen);
  const partnerGleich = (a, b) => (a === OHNE_PARTNER || b === OHNE_PARTNER ? a === b : partnerSchluessel(a) === partnerSchluessel(b));
  const partnerAuswahl = mehrfachAuswahl({
    optionen: [
      { wert: OHNE_PARTNER, text: 'Ohne Angabe' },
      ...partner.map((p) => ({ wert: p.name, text: `${p.name} (${p.anzahl})`, kurz: p.name })),
    ],
    gewaehlt: f.partner,
    alleText: 'Alle',
    gleich: partnerGleich,
    beiAenderung: (w) => setze('partner', w),
  });

  // Suche: bei jeder Eingabe, leicht verzögert
  let timer;
  const suche = h('input', {
    type: 'search',
    placeholder: 'Suchen in An/Von, Notiz, Kategorie, Konto …',
    value: f.suche,
    'aria-label': 'Suchen',
    class: f.suche.trim() ? 'aktiv' : null,
    oninput: (e) => {
      e.target.classList.toggle('aktiv', e.target.value.trim() !== ''); // D126: aktiver Filter farbig
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
      class: f[schluessel] != null ? 'aktiv' : null,
      onchange: (e) => {
        try {
          const cent = parseEuro(e.target.value, label);
          fehler.textContent = '';
          e.target.classList.toggle('aktiv', cent !== null);
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
      zustand.sichtbar = SEITE;
      neuZeichnen();
    },
  }, 'Filter zurücksetzen');

  // D123: Suche und Betrag ganz oben; Status („nur gebuchte“, D120) und „ohne Beleg“ entfallen
  // in der Oberfläche – damit gibt es keinen Bereich „Weitere Filter“ mehr
  return h('section', { class: 'bereich filter' },
    h('div', { class: 'filter-suche' },
      feld('Suche', suche),
      betragFeld('betragMin', 'Betrag ab'),
      betragFeld('betragMax', 'Betrag bis'),
    ),
    zeitraum,
    eigenerZeitraum,
    h('div', { class: 'filter-raster' },
      feld('Konto', kontoAuswahl),
      feld('Art', artAuswahl),
      feld('Kategorie', kategorieAuswahl),
      feld('Empfänger/Absender', partnerAuswahl),
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
    summenKarte(s, von, bis && bis < heute ? bis : heute), // D121: angezeigt wird höchstens bis heute
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
  else if (bis) zeitraumText = `Alles bis ${formatDatum(bis)}`;

  const kachel = (label, cent, klasse = '', vorzeichen = false) => h('div', { class: 'kachel' },
    h('div', { class: 'klein' }, label),
    h('div', { class: `betrag ${klasse}` + (cent < 0 ? ' negativ' : '') }, (vorzeichen && cent > 0 ? '+' : '') + formatEuro(cent)));

  // D120: Summe, Anzahl und Durchschnitt der ausgewählten Einnahmen und Ausgaben (ohne Umbuchungen)
  const textKachel = (label, text) => h('div', { class: 'kachel' }, h('div', { class: 'klein' }, label), h('div', { class: 'betrag' }, text));
  return h('section', { class: 'bereich summen-kopf' },
    h('div', { class: 'klein' }, zeitraumText,
      s.anzahlUmbuchungen > 0 && ` · ${s.anzahlUmbuchungen === 1 ? '1 Umbuchung' : `${s.anzahlUmbuchungen} Umbuchungen`} nicht mitgezählt`),
    h('div', { class: 'kacheln' },
      // D121: nur Summe, Anzahl und Ø (Einnahmen/Ausgaben einzeln entfallen)
      kachel('Summe', s.summe, '', true),
      textKachel('Anzahl', s.anzahl === 1 ? '1 Buchung' : `${s.anzahl} Buchungen`),
      s.schnitt != null ? kachel('Ø je Buchung', s.schnitt, '', true) : textKachel('Ø je Buchung', '–'),
      zustand.filter.kontoIds.length > 0 && s.umbuchungen !== 0 && kachel('Umbuchungen', s.umbuchungen, 'gedaempft', true),
    ),
  );
}

/* --------------------------- Liste --------------------------- */

// Spalten der Tabelle (D73). handy: auch am Handy als Sortierknopf sichtbar
const SPALTEN = [
  { feld: 'datum', text: 'Datum', handy: true },
  { feld: 'partner', text: 'Empfänger/Absender', kurz: 'An/Von', handy: true },
  { feld: 'kategorie', text: 'Kategorie', handy: true },
  { feld: 'konto', text: 'Konto' },
  { feld: 'notiz', text: 'Notiz' },
  { feld: 'betrag', text: 'Betrag', handy: true },
];

function tabellenKopf(neu) {
  const { feld: aktivFeld, richtung } = zustand.sortierung.stufen[0];
  return h('div', { class: 'btab-kopf', role: 'row' }, SPALTEN.map((sp) => {
    const aktiv = sp.feld === aktivFeld;
    const ab = aktiv && richtung === 'ab';
    return h('button', {
      type: 'button',
      role: 'columnheader',
      class: `btab-sort btab-${sp.feld}` + (aktiv ? ' erste' : '') + (sp.handy ? '' : ' nur-breit'),
      'aria-sort': aktiv ? (ab ? 'descending' : 'ascending') : 'none',
      title: aktiv ? 'Richtung umdrehen' : 'Nach dieser Spalte sortieren',
      onclick: () => { zustand.sortierung = sortiereNach(zustand.sortierung, sp.feld); neu(); },
    },
    h('span', { class: 'btab-sort-text' }, sp.kurz ? [h('span', { class: 'nur-breit' }, sp.text), h('span', { class: 'nur-schmal' }, sp.kurz)] : sp.text),
    aktiv && h('span', { class: 'btab-pfeil', 'aria-hidden': 'true' }, ab ? '↓' : '↑'));
  }));
}

function liste(eintraege, daten, neu) {
  const sortiert = sortiere(eintraege, zustand.sortierung, daten);
  // Wer im Filter "Art" Umbuchungen ausdrücklich wählt, sieht sie auch am Handy sofort (D77)
  const umbuchungGefiltert = zustand.filter.arten.includes('umbuchung');
  const kat = new Map(daten.kategorien.map((k) => [k.id, k]));
  const kontoName = new Map(daten.konten.map((k) => [k.id, k.name]));

  if (sortiert.length === 0) {
    return h('section', { class: 'bereich' }, h('p', { class: 'leer' }, 'Keine Buchungen passen zu diesen Filtern.'));
  }

  // D124: die ersten SEITE Einnahmen/Ausgaben zeigen; Umbuchungen dazwischen kommen mit (sie sind
  // ausblendbar und sollen die Zahl nicht verringern). Ausdrücklich gefilterte Umbuchungen zählen mit.
  let bisher = 0;
  let ende = sortiert.length;
  for (let i = 0; i < sortiert.length; i++) {
    const zaehlt = sortiert[i].buchung.art !== 'umbuchung' || umbuchungGefiltert;
    if (zaehlt && bisher >= zustand.sichtbar) { ende = i; break; }
    if (zaehlt) bisher += 1;
  }
  const zeigen = sortiert.slice(0, ende);
  const uebrig = sortiert.slice(ende).filter((e) => e.buchung.art !== 'umbuchung' || umbuchungGefiltert).length;
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

  const [stufe] = zustand.sortierung.stufen;
  const sortText = SPALTEN.find((sp) => sp.feld === stufe.feld)?.text + (stufe.richtung === 'ab' ? ' ↓' : ' ↑');
  const zuruecksetzen = (stufe.feld !== 'datum' || stufe.richtung !== 'ab') && h('button', {
    type: 'button',
    class: 'knopf knopf-klein',
    onclick: () => { zustand.sortierung = STANDARD_SORTIERUNG; neu(); },
  }, 'Sortierung zurücksetzen');

  const zeile = ({ buchung: b, wirkung }) => {
    let partnerText;
    let katText;
    if (b.art === 'umbuchung') {
      const von = b.richtung === 'ab' ? b.kontoId : b.gegenkontoId;
      const auf = b.richtung === 'ab' ? b.gegenkontoId : b.kontoId;
      partnerText = 'Umbuchung';
      katText = `${kontoName.get(von) ?? '?'} → ${kontoName.get(auf) ?? '?'}`
        + (b.budgetKategorieId ? ` · Budget ${kat.get(b.budgetKategorieId)?.name ?? '?'}` : ''); // D98
    } else {
      const unter = kat.get(b.kategorieId);
      partnerText = b.partner?.trim() ?? '';
      katText = [kat.get(unter?.elternId)?.name, unter?.name ?? 'Unbekannte Kategorie'].filter(Boolean).join(' › ');
    }
    // Umbuchung ohne Kontofilter: neutral ohne Vorzeichen
    const betragText = b.art === 'umbuchung' && wirkung === 0
      ? formatEuro(b.betragCent)
      : (wirkung > 0 ? '+' : '') + formatEuro(wirkung);
    const klasse = b.art === 'umbuchung' ? 'gedaempft' : wirkung > 0 ? 'plus' : '';
    const unterName = b.art === 'umbuchung' ? katText : kat.get(b.kategorieId)?.name ?? 'Unbekannte Kategorie';
    // Am Handy Umbuchungen standardmäßig ausgeblendet (D77) – außer sie sind ausdrücklich gefiltert
    return h('li', { role: 'row', class: b.art === 'umbuchung' && !umbuchungGefiltert ? 'ub-ausblendbar' : null },
      h('button', {
        type: 'button',
        class: 'btab-zeile' + (b.art === 'umbuchung' ? ' umbuchung' : ''),
        onclick: () => (b.archivJahr ? toast(`Archiv ${b.archivJahr}: nur lesen. Zum Ändern das Jahr in den Stammdaten zurückholen.`) : oeffneBuchungsdialog(b)),
      },
      h('span', { class: 'btab-zelle btab-partner' },
        partnerText
          ? h('span', { class: 'btab-partner-name' }, partnerText)
          // Ohne Empfänger/Absender: am Handy steht die Kategorie als Titel, am PC ein Strich
          : [h('span', { class: 'nur-breit gedaempft' }, '–'), h('span', { class: 'nur-schmal btab-partner-name' }, unterName)],
        b.status === 'vorgemerkt' && h('span', { class: 'marke marke-vorgemerkt' }, 'vorgemerkt'),
        b.archivJahr && h('span', { class: 'marke' }, 'Archiv')),
      h('span', { class: 'btab-unter' },
        h('span', { class: 'btab-zelle btab-datum' }, formatDatum(b.datum)),
        h('span', { class: 'btab-zelle btab-kategorie', title: katText }, katText),
        h('span', { class: 'btab-zelle btab-konto' }, b.art === 'umbuchung' ? '' : kontoName.get(b.kontoId) ?? ''),
        h('span', { class: 'btab-zelle btab-notiz', title: b.notiz || null }, b.notiz ?? '')),
      h('span', { class: `btab-zelle btab-betrag betrag ${klasse}` }, betragText)));
  };

  return h('section', { class: 'bereich buchungen' },
    h('div', { class: 'btab-werkzeuge' },
      h('span', { class: 'klein' }, `Sortiert nach ${sortText}`),
      !umbuchungGefiltert && umbuchungKnopf(zeigen.filter((e) => e.buchung.art === 'umbuchung').length),
      zuruecksetzen,
      exportKnopf),
    h('div', { class: 'btab', role: 'table', 'aria-label': 'Buchungen' },
      tabellenKopf(neu),
      h('ul', { class: 'btab-liste', role: 'rowgroup' }, zeigen.map(zeile))),
    h('p', { class: 'hinweis btab-hinweis' }, 'Spaltenkopf antippen zum Sortieren, erneut antippen dreht die Richtung um. ' +
      'Bei Gleichstand steht die neueste Buchung oben.'),
    uebrig > 0 && h('div', { class: 'mehr' },
      h('button', {
        type: 'button',
        class: 'knopf',
        onclick: () => { zustand.sichtbar = Infinity; neu(); },
      }, `Alle weiteren anzeigen (${uebrig === 1 ? '1 Buchung' : `${uebrig} Buchungen`})`)),
  );
}

/* --------------------------- Analyse --------------------------- */

function analyse(eintraege, daten, heute, neu) {
  const erster = ersterErfassterTag(daten.buchungen, zustand.filter);
  const monate = monateDerAuswertung(eintraege, zustand.filter, heute, erster);
  if (eintraege.length === 0 || monate.length === 0) {
    return h('section', { class: 'bereich' }, h('p', { class: 'leer' }, 'Keine Buchungen für eine Auswertung.'));
  }
  // Dieselben Filter ohne Zeitraum: für Trend (D125) und den Ausgaben-Verlauf (D126)
  const ohneZeitraum = filtere(daten.buchungen, { ...zustand.filter, zeitraum: 'alles' }, { ...daten, heute });
  // D126: Ausgaben der letzten 12 und nächsten 12 Monate – immer Ausgaben, egal welche Art gefiltert ist
  const nurAusgaben = filtere(daten.buchungen, { ...zustand.filter, zeitraum: 'alles', arten: ['ausgabe'] }, { ...daten, heute });
  const zl = zeitleiste(nurWirksam({ ...daten, buchungen: daten.hauptBuchungen }), heute, plusMonate(heute.slice(0, 7), 12));
  const verlauf = ausgabenVerlauf({
    istEintraege: nurAusgaben, zl, buchungen: daten.hauptBuchungen, kategorien: daten.kategorien, filter: zustand.filter, heute,
  });
  const vorjahr = vorjahrJeMonat(nurAusgaben, verlauf.map((z) => [z.jahr, z.monat]), erster);
  return h('div', {},
    verlaufBereich(verlauf, neu, vorjahr),
    zustand.analyseGruppe === 'partner'
      ? partnerBereich(eintraege, monate, heute, neu)
      : kategorieBereich(eintraege, daten, monate, heute, neu, ohneZeitraum, erster),
    groessteBereich(eintraege, daten, neu),
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

/** Genau eine Art (Ausgabe oder Einnahme) im Filter? Dann richtet sich die Analyse danach. */
function eineGefilterteArt() {
  const arten = zustand.filter.arten.filter((x) => x !== 'umbuchung');
  return arten.length === 1 ? arten[0] : null;
}

/** Ausgaben/Einnahmen-Umschalter der Analyse */
function artWahlAnalyse(neu) {
  // D126: Ist im Filter genau eine Art gewählt (Standard: Ausgaben), gibt es nichts umzuschalten
  if (eineGefilterteArt()) return null;
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
  const art = eineGefilterteArt() ?? zustand.analyseArt;
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
          zustand.filter.partner = [x.id === OHNE_PARTNER ? OHNE_PARTNER : x.name];
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

/**
 * D126: Ausgaben-Verlauf – die letzten 12 und die nächsten 12 Monate, unabhängig vom gewählten Zeitraum.
 * Gebuchte Ausgaben kräftig; im laufenden Monat darauf heller die noch erwarteten (vorgemerkt, offen, Budgetrest),
 * in den Folgemonaten nur die erwarteten Auszahlungen (hell). Optional das Vorjahr als blasse Balken daneben.
 */
function verlaufBereich(zeilen, neu, vorjahr = []) {
  const mitVorjahr = zustand.vorjahr && vorjahr.some(Boolean);
  const ohneErwartung = zeilen.some((z) => (z.aktuell || z.zukunft) && z.erwartet === null);
  const kurz = (z) => new Intl.DateTimeFormat('de-DE', { month: 'short' }).format(new Date(z.jahr, z.monat - 1, 1)).replace('.', '')
    + ` ${String(z.jahr).slice(2)}`;

  const umschalter = h('button', {
    type: 'button',
    class: 'knopf knopf-klein',
    onclick: () => { zustand.alsTabelle = !zustand.alsTabelle; neu(); },
  }, zustand.alsTabelle ? 'Als Diagramm' : 'Als Tabelle');
  const vorjahrKnopf = vorjahr.some(Boolean) && h('button', {
    type: 'button',
    class: 'knopf knopf-klein',
    'aria-pressed': String(zustand.vorjahr),
    onclick: () => { zustand.vorjahr = !zustand.vorjahr; neu(); },
  }, zustand.vorjahr ? 'Vorjahr ausblenden' : 'Vorjahr zeigen');
  const kopf = h('div', { class: 'bereich-kopf' }, h('h2', {}, 'Ausgaben je Monat'),
    h('div', { class: 'knopfreihe' }, vorjahrKnopf, umschalter));
  const legende = h('div', { class: 'legende' },
    h('span', {}, h('span', { class: 'legende-punkt ausgabe' }), 'gebucht'),
    !ohneErwartung && h('span', {}, h('span', { class: 'legende-punkt ausgabe offen-teil' }), 'erwartet (vorgemerkt, offen, Budget)'),
    mitVorjahr && h('span', {}, h('span', { class: 'legende-punkt ausgabe vorjahr' }), 'Vorjahr'),
    h('span', { class: 'klein' }, 'letzte 12 und nächste 12 Monate · unabhängig vom Zeitraum'));
  const hinweis = ohneErwartung && h('p', { class: 'hinweis' },
    'Erwartete Ausgaben lassen sich nur mit Konto- und Kategoriefilter zuordnen – bei Filtern auf Empfänger, Suche oder Betrag fehlen sie.');

  if (zustand.alsTabelle) {
    const vj = (i) => (vorjahr[i] ? formatEuro(vorjahr[i].ausgaben) : '–');
    return h('section', { class: 'bereich' }, kopf, hinweis,
      h('div', { class: 'tabelle-rahmen' },
        h('table', { class: 'tabelle' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Monat'), h('th', {}, 'Gebucht'), h('th', {}, 'Erwartet'), h('th', {}, 'Zusammen'),
            mitVorjahr && h('th', {}, 'Vorjahr'))),
          h('tbody', {}, zeilen.map((z, i) => h('tr', { class: z.aktuell ? 'aktuell' : z.zukunft ? 'zukunft' : null },
            h('td', {}, formatMonat(z.jahr, z.monat)),
            h('td', {}, z.zukunft ? '–' : formatEuro(z.ist)),
            h('td', { class: 'annahme' }, z.erwartet == null ? '–' : formatEuro(z.erwartet)),
            h('td', { class: (z.aktuell || z.zukunft) ? 'annahme' : '' }, formatEuro(z.ist + (z.erwartet ?? 0))),
            mitVorjahr && h('td', { class: 'gedaempft' }, vj(i))))))));
  }

  const max = schoeneObergrenze(Math.max(...zeilen.map((z) => z.ist + (z.erwartet ?? 0)),
    ...(mitVorjahr ? vorjahr.filter(Boolean).map((z) => z.ausgaben) : []), 1));
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const tooltip = h('div', { class: 'tooltip', role: 'status', hidden: true });
  const zeigeTooltip = (spalte, z, v) => {
    tooltip.replaceChildren(
      h('strong', {}, formatMonat(z.jahr, z.monat) + (z.zukunft ? ' (Prognose)' : z.aktuell ? ' (laufend)' : '')),
      !z.zukunft && h('div', {}, h('span', { class: 'legende-punkt ausgabe' }), `Gebucht ${formatEuro(z.ist)}`),
      z.erwartet != null && h('div', {}, h('span', { class: 'legende-punkt ausgabe offen-teil' }), `Erwartet ${formatEuro(z.erwartet)}`),
      (z.aktuell && z.erwartet != null) && h('div', { class: 'tooltip-saldo' }, `Zusammen ${formatEuro(z.ist + z.erwartet)}`),
      mitVorjahr && h('div', { class: 'klein' }, v ? `Vorjahr ${formatEuro(v.ausgaben)}${veraenderung(z.ist + (z.erwartet ?? 0), v.ausgaben)}` : 'Vorjahr: noch nicht erfasst'),
    );
    tooltip.hidden = false;
    const flaeche = spalte.closest('.diagramm-flaeche').getBoundingClientRect();
    const r = spalte.getBoundingClientRect();
    tooltip.style.left = `${Math.min(Math.max(r.left + r.width / 2 - flaeche.left, 80), flaeche.width - 80)}px`;
  };
  const hoehe = (cent) => `height:${(cent / max) * 100}%`;
  const spalten = zeilen.map((z, i) => {
    const v = vorjahr[i];
    const spalte = h('div', {
      class: 'spalte' + (z.aktuell ? ' aktuell' : '') + (z.zukunft ? ' zukunft' : ''),
      tabindex: '0',
      'aria-label': `${formatMonat(z.jahr, z.monat)}: gebucht ${formatEuro(z.ist)}` + (z.erwartet != null ? `, erwartet ${formatEuro(z.erwartet)}` : ''),
    },
    h('div', { class: 'balken-paar' + (mitVorjahr ? ' mit-vorjahr' : '') },
      mitVorjahr && h('div', { class: 'balken ausgabe vorjahr', style: hoehe(v?.ausgaben ?? 0) }),
      // gestapelt: unten gebucht, oben (heller) erwartet
      h('div', { class: 'balken-stapel', style: hoehe(z.ist + (z.erwartet ?? 0)) },
        z.erwartet > 0 && h('div', { class: 'balken ausgabe offen-teil', style: `flex:${z.erwartet}` }),
        z.ist > 0 && h('div', { class: 'balken ausgabe', style: `flex:${z.ist}` }))),
    h('div', { class: 'spalte-label' }, i % 2 === 0 || z.aktuell ? kurz(z) : ''));
    spalte.addEventListener('mouseenter', () => zeigeTooltip(spalte, z, v));
    spalte.addEventListener('focus', () => zeigeTooltip(spalte, z, v));
    spalte.addEventListener('mouseleave', () => { tooltip.hidden = true; });
    spalte.addEventListener('blur', () => { tooltip.hidden = true; });
    return spalte;
  });

  // Am Handy ist das Diagramm breiter als der Bildschirm: zuerst den laufenden Monat zeigen
  const flaeche = h('div', { class: 'diagramm-flaeche' },
    h('div', { class: 'gitter' }, ticks.map((t) => h('span', { style: `bottom:${t * 100}%` }))),
    h('div', { class: 'spalten', style: `min-width:${zeilen.length * (mitVorjahr ? 40 : 30)}px` }, spalten),
    tooltip);
  requestAnimationFrame(() => {
    const aktuell = flaeche.querySelector('.spalte.aktuell');
    if (aktuell && flaeche.scrollWidth > flaeche.clientWidth) flaeche.scrollLeft = aktuell.offsetLeft - flaeche.clientWidth / 2;
  });

  return h('section', { class: 'bereich' }, kopf, legende, hinweis,
    h('div', { class: 'diagramm' },
      h('div', { class: 'achse' }, [...ticks].reverse().map((t) => h('span', {}, formatEuroRund(max * t)))),
      flaeche));
}

/** Veränderung zum Vorjahr als Text, z. B. " (+12 % zum Vorjahr)" (ohne Vorjahreswert leer) */
function veraenderung(jetzt, vorher) {
  if (!vorher) return '';
  const p = Math.round(((jetzt - vorher) / vorher) * 100);
  return ` (${p > 0 ? '+' : ''}${p} %)`;
}

/** D125: Liste auf eine Kategorie (Haupt- oder Unterkategorie) filtern und zur Liste wechseln */
function zeigeKategorieInListe(id) {
  zustand.filter.kategorieIds = [id];
  zustand.modus = 'liste';
  zustand.sichtbar = SEITE;
  window.dispatchEvent(new Event('daten-geaendert'));
  window.scrollTo({ top: 0 });
}

/** Mini-Verlauf der letzten 12 Monate (D125): kleine Balken, Tooltip mit Monat und Betrag */
function trendBalken(werte, monate, art) {
  const max = Math.max(...werte, 1);
  const kurz = (j, m) => new Intl.DateTimeFormat('de-DE', { month: 'short', year: '2-digit' }).format(new Date(j, m - 1, 1));
  return h('span', { class: 'kat-trend', role: 'img', 'aria-label': 'Verlauf der letzten 12 Monate' },
    werte.map((w, i) => h('span', {
      class: `trend-balken ${art}`,
      style: `height:${Math.max(w > 0 ? 8 : 0, Math.round((w / max) * 100))}%`,
      title: `${kurz(...monate[i])}: ${formatEuro(w)}`,
    })));
}

/**
 * Summen je Haupt-/Unterkategorie mit Anteil und Durchschnitt pro Monat.
 * D125: Mini-Trend (12 Monate), Vergleich zur Vorperiode, Ist vs. Budget (nur Ausgaben),
 * Unterkategorie bzw. „Alle Buchungen anzeigen“ antippen filtert die Liste.
 */
function kategorieBereich(eintraege, daten, monate, heute, neu, ohneZeitraum, erster) {
  const { kategorien } = daten;
  // Ø nur über abgeschlossene Monate – der laufende Monat würde ihn verfälschen
  const schnittMonate = abgeschlosseneMonate(monate, heute);
  const anzahlMonate = schnittMonate.length;
  const art = eineGefilterteArt() ?? zustand.analyseArt;
  const gruppen = summenJeKategorie(eintraege, kategorien, art, schnittMonate);
  const gesamt = gruppen.reduce((s, g) => s + g.summe, 0);
  const gesamtSchnitt = anzahlMonate ? Math.round(gruppen.reduce((s, g) => s + g.schnittSumme, 0) / anzahlMonate) : null;
  const max = Math.max(...gruppen.flatMap((g) => g.unter.map((u) => u.summe)), 1);
  const mitSchnitt = anzahlMonate > 0 && monate.length > 1;

  // Trend: 12 Monate bis zum Ende des gezeigten Zeitraums (höchstens heute)
  const { bis } = zeitraumFuer(zustand.filter, heute);
  const trendMonate = letzteZwoelfMonate(bis && bis < heute ? bis : heute);
  const trend = monatsSummenJeKategorie(ohneZeitraum, kategorien, art, trendMonate);

  // Vorperiode: dieselben Filter, gleich langer Zeitraum davor – nur, wenn es dort schon erfasste Buchungen
  // gab (sonst sähe „0,00 €“ aus wie „nichts ausgegeben“)
  const vpRoh = vorperiode(zustand.filter, heute);
  const vp = vpRoh && erster && vpRoh.bis >= erster ? vpRoh : null;
  const vpSummen = new Map();
  if (vp) {
    const vpEintraege = filtere(daten.buchungen, { ...zustand.filter, zeitraum: 'eigen', von: vp.von, bis: vp.bis }, { ...daten, heute });
    for (const g of summenJeKategorie(vpEintraege, kategorien, art)) {
      vpSummen.set(g.id, g.summe);
      for (const u of g.unter) vpSummen.set(`u:${u.id}`, u.summe);
    }
  }
  const vpGesamt = [...vpSummen.entries()].filter(([k]) => !k.startsWith('u:')).reduce((s, [, v]) => s + v, 0);
  const vergleich = (jetzt, vorher) => {
    if (!vp) return null;
    const p = veraenderungProzent(jetzt, vorher ?? 0);
    const text = `${vp.text}: ${formatEuro(vorher ?? 0)}` + (p == null ? '' : ` (${p > 0 ? '+' : ''}${p} %)`);
    // Bei Ausgaben ist „mehr“ ungünstig, bei Einnahmen günstig
    const schlecht = p != null && (art === 'ausgabe' ? p > 10 : p < -10);
    return h('span', { class: 'kat-vergleich' + (schlecht ? ' warn-text' : '') }, text);
  };
  // Ist vs. Budget (nur Ausgaben, nur mit abgeschlossenen Monaten)
  const budgetText = (g) => {
    if (art !== 'ausgabe' || !mitSchnitt) return null;
    const budget = budgetSchnitt(daten.budgets ?? [], g.id, schnittMonate, zustand.filter.kontoIds);
    if (budget == null) return null;
    const p = veraenderungProzent(g.schnitt, budget);
    return h('span', { class: 'kat-budget' + (p != null && p > 0 ? ' warn-text' : '') },
      `Budget Ø ${formatEuro(budget)}/Monat` + (p == null ? '' : ` · Ist ${p > 0 ? '+' : ''}${p} %`));
  };

  const hauptZeile = (g) => {
    const info = [budgetText(g), vergleich(g.summe, vpSummen.get(g.id))].filter(Boolean);
    return h('div', { class: 'kat-zeile ebene-1' },
      h('span', { class: 'kat-zeile-name' }, g.name),
      g.id === 'unbekannt' ? h('span') : trendBalken(trend.get(g.id) ?? trendMonate.map(() => 0), trendMonate, art),
      h('span', { class: 'betrag' }, formatEuro(g.summe)),
      h('span', { class: 'kat-anteil' }, formatProzent(g.anteil)),
      mitSchnitt && h('span', { class: 'kat-schnitt' }, `Ø ${formatEuro(g.schnitt)}`),
      info.length > 0 && h('span', { class: 'kat-info' }, info));
  };
  const unterZeile = (u) => h('button', {
    type: 'button',
    class: 'kat-zeile ebene-2 kat-zeile-knopf',
    title: 'Liste auf diese Unterkategorie filtern',
    onclick: () => u.id !== 'unbekannt' && zeigeKategorieInListe(u.id),
  },
  h('span', { class: 'kat-zeile-name' }, u.name),
  h('span', { class: 'kat-balken-spur', 'aria-hidden': 'true' },
    h('span', { class: `kat-balken ${art}`, style: `width:${(u.summe / max) * 100}%` })),
  h('span', { class: 'betrag' }, formatEuro(u.summe)),
  h('span', { class: 'kat-anteil' }, formatProzent(u.anteil)),
  mitSchnitt && h('span', { class: 'kat-schnitt' }, `Ø ${formatEuro(u.schnitt)}`));

  return h('section', { class: 'bereich' },
    h('div', { class: 'bereich-kopf' }, h('h2', {}, 'Nach Kategorien')),
    gruppeWahl(neu),
    artWahlAnalyse(neu),
    gruppen.length === 0
      ? h('p', { class: 'leer' }, art === 'ausgabe' ? 'Keine Ausgaben in der Auswahl.' : 'Keine Einnahmen in der Auswahl.')
      : h('div', { class: 'kat-tabelle' + (mitSchnitt ? ' mit-schnitt' : '') },
        h('div', { class: 'kat-zeile kat-kopf', 'aria-hidden': 'true' },
          h('span', {}, 'Kategorie'), h('span', {}, '12 Monate'), h('span', {}, 'Summe'), h('span', {}, 'Anteil'),
          mitSchnitt && h('span', {}, 'Ø/Monat')),
        gruppen.map((g) => {
          const d = h('details', { open: zustand.offen.has(g.id) },
            h('summary', {}, hauptZeile(g)),
            g.unter.map(unterZeile),
            g.id !== 'unbekannt' && h('div', { class: 'kat-filter-reihe' },
              h('button', { type: 'button', class: 'knopf knopf-klein', onclick: () => zeigeKategorieInListe(g.id) },
                `Alle Buchungen „${g.name}“ anzeigen`)));
          d.addEventListener('toggle', () => (d.open ? zustand.offen.add(g.id) : zustand.offen.delete(g.id)));
          return d;
        }),
        h('div', { class: 'kat-zeile summe-zeile' },
          h('span', { class: 'kat-zeile-name' }, 'Gesamt'),
          h('span', {}),
          h('span', { class: 'betrag' }, formatEuro(gesamt)),
          h('span', { class: 'kat-anteil' }, '100 %'),
          mitSchnitt && h('span', { class: 'kat-schnitt' }, `Ø ${formatEuro(gesamtSchnitt)}`),
          vp && h('span', { class: 'kat-info' }, vergleich(gesamt, vpGesamt)))),
    h('p', { class: 'hinweis erklaerung' },
      'Kategorie antippen klappt die Unterkategorien auf; eine Unterkategorie antippen zeigt ihre Buchungen in der Liste. '
      + 'Die kleinen Balken zeigen die letzten 12 Monate. '
      + (mitSchnitt ? `Ø = Durchschnitt pro Monat über ${anzahlMonate === 1 ? '1 abgeschlossenen Monat' : `${anzahlMonate} abgeschlossene Monate`} `
        + `(${formatMonat(...schnittMonate[0])}${anzahlMonate > 1 ? ` bis ${formatMonat(...schnittMonate.at(-1))}` : ''}); der laufende Monat zählt nicht mit. ` : '')
      + (art === 'ausgabe' && mitSchnitt ? 'Budget Ø = Monatsbudgets im selben Zeitraum, Jahresbudgets mit einem Zwölftel je Monat. ' : '')
      + (vp ? `Vergleich mit ${vp.text} (${formatDatum(vp.von)} – ${formatDatum(vp.bis)}).` : '')),
  );
}

/** D125: die zehn größten Einzelbuchungen der gewählten Art im Zeitraum – antippen öffnet die Buchung */
function groessteBereich(eintraege, daten, neu) {
  const art = eineGefilterteArt() ?? zustand.analyseArt;
  const top = groessteBuchungen(eintraege, art, 10);
  if (top.length === 0) return null;
  const kat = new Map(daten.kategorien.map((k) => [k.id, k]));
  return h('section', { class: 'bereich groesste' },
    h('div', { class: 'bereich-kopf' }, h('h2', {}, art === 'ausgabe' ? 'Größte Ausgaben' : 'Größte Einnahmen')),
    h('ol', { class: 'groesste-liste' }, top.map(({ buchung: b }) => {
      const unter = kat.get(b.kategorieId);
      const titel = b.partner?.trim() || unter?.name || 'Buchung';
      const katText = [kat.get(unter?.elternId)?.name, unter?.name].filter(Boolean).join(' › ');
      return h('li', {},
        h('button', {
          type: 'button',
          class: 'groesste-zeile',
          onclick: () => (b.archivJahr ? toast(`Archiv ${b.archivJahr}: nur lesen.`) : oeffneBuchungsdialog(b)),
        },
        h('span', { class: 'groesste-text' },
          h('span', { class: 'groesste-titel' }, titel),
          h('span', { class: 'klein' }, `${formatDatum(b.datum)}${katText && katText !== titel ? ` · ${katText}` : ''}`)),
        h('span', { class: 'betrag' + (art === 'einnahme' ? ' plus' : '') }, (art === 'einnahme' ? '+' : '−') + formatEuro(b.betragCent))));
    })));
}
