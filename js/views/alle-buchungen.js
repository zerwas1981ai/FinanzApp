// Tab "Auswertungen" (bis D240 "Alle Buchungen", Etappe 3): über alle Konten filtern, sortieren, auswerten.
// D258: Zustand, Filter und Analyse stehen in auswertung-zustand.js, auswertung-filter.js, auswertung-analyse.js.

import { h } from '../dom.js';
import * as db from '../db.js';
import { formatEuro, formatDatum, heuteIso } from '../format.js';
import { herunterladen, toast, katPunkt, kontoEtikett, auslageMarke } from '../ui.js';
import { farbenZuordnung, farbeVon } from '../farben.js';
import { rueckblickBereich } from './rueckblick.js';
import { ungewoehnlicheBuchungen } from '../erkennung.js';
import { hochMarke } from './erkennung.js';
import { belegeBereich } from './belege.js';
import { relevantDialog } from './relevant.js';
import { vertragDialog } from './vertraege.js';
import { buchungenWischbar } from './wisch-buchung.js';
import { archivInhalt } from '../sync/abgleich.js';
import { buchungenAlsCsv, exportName } from '../export.js';
import { STANDARD_SORTIERUNG, filtere, sortiere, summen, zeitraumFuer, sortiereNach } from '../auswertung.js';
import { oeffneBuchungsdialog } from './buchung-dialog.js';
import { umbuchungKnopf } from './kennzahlen.js';
import { SEITE, zustand, zeigeJahr } from './auswertung-zustand.js';
import { filterBereich } from './auswertung-filter.js';
import { analyse } from './auswertung-analyse.js';
import { kategorieAendern, kontoAendern, inDenPapierkorb } from './auswahl-aendern.js';

let wischDaten = null; // D211: aktuelle Buchungen (inkl. geladener Archivjahre) für das Wischen

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
  const [konten, kategorien, buchungen, projekte, archive, budgets, wiederkehrende, geplant, monatsnotizen, relevant, vertraege] = await Promise.all(
    ['konten', 'kategorien', 'buchungen', 'projekte', 'archive', 'budgets', 'wiederkehrend', 'geplant', 'monatsnotizen', 'relevant', 'vertraege'].map((s) => db.alle(s)),
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
    monatsnotizen, // D165
    relevant, vertraege, // D191: für die Belege-Ansicht
  };

  wischDaten = daten.buchungen;
  const ergebnis = h('div', { class: 'ergebnis' });
  buchungenWischbar(ergebnis, () => wischDaten); // D211
  const neuZeichnen = () => zeigeBuchungen(container);
  const aktualisiere = () => {
    zustand.sichtbar = SEITE;
    zustand.auswahl?.clear(); // D260: nach neuem Filter nichts Unsichtbares angehakt lassen
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
    h('h1', { class: 'seitentitel unsichtbar' }, 'Auswertungen'), // D160: nur für Bildschirmleser; D240: Tab heißt Auswertungen
    archivInfo,
    filterBereich(daten, aktualisiere, neuZeichnen),
    ergebnis,
  ].filter(Boolean));
  zeigeErgebnis(ergebnis, daten);
}

/* =========================== Ergebnis =========================== */

function zeigeErgebnis(ziel, daten) {
  const heute = heuteIso();
  const eintraege = filtere(daten.buchungen, zustand.filter, { ...daten, heute });
  const s = summen(eintraege);
  const { von, bis } = zeitraumFuer(zustand.filter, heute);

  // D257: gestaltet wie die Untertabs anderer Seiten (Kästchen, Auswahl blau) und immer direkt unter dem Filter
  const modusWahl = h('div', { class: 'chips', role: 'group', 'aria-label': 'Ansicht' },
    // D191: Belege; D240: Rückblick wieder da, zwischen Analyse und Belege
    [['liste', 'Liste'], ['analyse', 'Analyse'], ['rueckblick', 'Rückblick'], ['belege', 'Belege']].map(([wert, text]) => h('button', {
      type: 'button',
      class: 'chip',
      'aria-pressed': String(zustand.modus === wert),
      onclick: () => { zustand.modus = wert; zeigeErgebnis(ziel, daten); },
    }, text)));

  // D240: Rückblick – eigener Monat/Jahr-Wähler; die Filter oben gelten hier nicht
  if (zustand.modus === 'rueckblick') {
    const kopf = h('div', { class: 'modus-zeile' }, modusWahl);
    ziel.replaceChildren(kopf);
    rueckblickBereich(daten).then((bereich) => {
      if (zustand.modus !== 'rueckblick' || !kopf.isConnected) return; // inzwischen umgeschaltet
      ziel.append(bereich, h('p', { class: 'hinweis' }, 'Die Filter oben gelten für Liste und Analyse, nicht für den Rückblick.'));
    });
    return;
  }

  // D191: Belege – alle Belege mit eigener Suche (die Filter oben gelten hier nicht)
  if (zustand.modus === 'belege') {
    const belegDaten = { ...daten, wiederkehrend: daten.wiederkehrende };
    ziel.replaceChildren(
      h('div', { class: 'modus-zeile' }, modusWahl),
      belegeBereich(belegDaten, (x) => {
        if (x.quelle === 'buchung') {
          if (x.ref.archivJahr) toast(`Archiv ${x.ref.archivJahr}: nur lesen.`);
          else oeffneBuchungsdialog(x.ref);
        } else if (x.quelle === 'relevant') relevantDialog(x.ref, belegDaten);
        else vertragDialog(x.ref, belegDaten);
      }, { hinweis: 'Die Filter oben gelten für Liste und Analyse, nicht für die Belege.' }));
    return;
  }
  const karte = summenKarte(s, von, bis && bis < heute ? bis : heute); // D121: angezeigt wird höchstens bis heute
  const inhalt = zustand.modus === 'liste'
    ? liste(eintraege, daten, () => zeigeErgebnis(ziel, daten))
    : analyse(eintraege, daten, heute, () => zeigeErgebnis(ziel, daten));
  ziel.replaceChildren(
    // D237: „Drucken / PDF“ rechts neben den Umschaltern, solange die Analyse gewählt ist
    // D257: Umschalter vor der Summenkarte, damit er beim Wechseln nicht springt
    h('div', { class: 'modus-zeile' }, modusWahl,
      zustand.modus === 'analyse' && h('button', {
        type: 'button', class: 'knopf knopf-klein', onclick: () => druckeAnalyse(karte, inhalt),
      }, 'Drucken / PDF')),
    karte,
    inhalt,
  );
}

/** D237: Druckansicht der Analyse (gleiche Druckregeln wie bei den relevanten Ausgaben, D144) */
function druckeAnalyse(karte, inhalt) {
  const bereich = h('div', { id: 'druckbereich', class: 'druck-rueckblick druck-analyse' },
    h('h1', {}, 'Analyse'),
    h('p', {}, `Stand ${formatDatum(heuteIso())}`),
    karte.cloneNode(true),
    inhalt.cloneNode(true));
  document.getElementById('druckbereich')?.remove();
  document.body.append(bereich);
  const weg = () => { bereich.remove(); window.removeEventListener('afterprint', weg); };
  window.addEventListener('afterprint', weg);
  window.print();
}

function summenKarte(s, von, bis) {
  let zeitraumText = 'Gesamter Zeitraum';
  if (von && bis) zeitraumText = `${formatDatum(von)} – ${formatDatum(bis)}`;
  else if (von) zeitraumText = `ab ${formatDatum(von)}`;
  else if (bis) zeitraumText = `Alles bis ${formatDatum(bis)}`;

  // D130: positive Werte (Einnahmen überwiegen) grün, negative wie gewohnt rot
  const kachel = (label, cent, klasse = '', vorzeichen = false) => h('div', { class: 'kachel' },
    h('div', { class: 'klein' }, label),
    h('div', { class: `betrag ${klasse}` + (cent < 0 ? ' negativ' : cent > 0 ? ' plus' : '') }, (vorzeichen && cent > 0 ? '+' : '') + formatEuro(cent)));

  // D120: Summe, Anzahl und Durchschnitt der ausgewählten Einnahmen und Ausgaben (ohne Umbuchungen)
  const textKachel = (label, text) => h('div', { class: 'kachel' }, h('div', { class: 'klein' }, label), h('div', { class: 'betrag' }, text));
  return h('section', { class: 'bereich summen-kopf' },
    h('div', { class: 'klein' }, zeitraumText,
      s.anzahlUmbuchungen > 0 && ` · ${s.anzahlUmbuchungen === 1 ? '1 Umbuchung' : `${s.anzahlUmbuchungen} Umbuchungen`} nicht mitgezählt`,
      s.anzahlAuslagen > 0 && ` · ${s.anzahlAuslagen === 1 ? '1 Auslage/Rückzahlung' : `${s.anzahlAuslagen} Auslagen/Rückzahlungen`} nicht mitgezählt`), // D214
    h('div', { class: 'kacheln' },
      // D121: nur Summe, Anzahl und Ø (Einnahmen/Ausgaben einzeln entfallen)
      kachel('Summe', s.summe, '', true),
      // D135: am Handy nur die Zahl, am PC mit „Buchungen“
      textKachel('Anzahl', [String(s.anzahl), h('span', { class: 'nur-breit' }, s.anzahl === 1 ? ' Buchung' : ' Buchungen')]),
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
  const kontoNach = new Map(daten.konten.map((k) => [k.id, k]));

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

  // D260: mehrere Buchungen per Häkchen auswählen und gemeinsam ändern
  const auswahl = zustand.auswahl;
  const waehlbar = zeigen.map((e) => e.buchung).filter((b) => !b.archivJahr);
  const haken = new Map(); // Buchungs-ID → Kästchen
  const zaehler = h('span', { class: 'klein auswahl-zahl', 'aria-live': 'polite' });
  const alleKasten = h('input', { type: 'checkbox', 'aria-label': 'Alle angezeigten auswählen' });
  const aktionen = [];
  const zeigeZahl = () => {
    if (!auswahl) return;
    zaehler.textContent = `${auswahl.size} ausgewählt`;
    alleKasten.checked = waehlbar.length > 0 && waehlbar.every((b) => auswahl.has(b.id));
    for (const k of aktionen) k.disabled = auswahl.size === 0;
  };
  const umschalten = (b, an = !auswahl.has(b.id)) => {
    if (an) auswahl.add(b.id); else auswahl.delete(b.id);
    const k = haken.get(b.id);
    if (k) { k.checked = an; k.closest('li').classList.toggle('gewaehlt', an); }
    zeigeZahl();
  };
  alleKasten.addEventListener('change', () => { for (const b of waehlbar) umschalten(b, alleKasten.checked); });
  const beenden = () => { zustand.auswahl = null; };
  const aktion = (text, wirkung, variante = '') => {
    const k = h('button', { type: 'button', class: `knopf knopf-klein ${variante}`.trim(), onclick: () => wirkung(new Set(auswahl), beenden) }, text);
    aktionen.push(k);
    return k;
  };
  const auswahlLeiste = auswahl && h('div', { class: 'auswahl-leiste', role: 'toolbar', 'aria-label': 'Ausgewählte Buchungen' },
    h('label', { class: 'auswahl-alle' }, alleKasten, h('span', { class: 'nur-breit' }, 'Alle'), zaehler),
    aktion('Kategorie …', kategorieAendern),
    aktion('Konto …', kontoAendern),
    aktion('Papierkorb', inDenPapierkorb, 'knopf-gefahr'),
    h('button', { type: 'button', class: 'knopf knopf-klein auswahl-fertig', onclick: () => { beenden(); neu(); } }, 'Fertig'));
  const auswaehlenKnopf = !auswahl && waehlbar.length > 0 && h('button', {
    type: 'button',
    class: 'knopf knopf-klein',
    title: 'Mehrere Buchungen anhaken und gemeinsam ändern',
    onclick: () => { zustand.auswahl = new Set(); neu(); },
  }, 'Auswählen');

  const farben = farbenZuordnung([...kat.values()]); // D155
  const ungewoehnlich = ungewoehnlicheBuchungen(daten.buchungen); // D183
  const zeile = (eintrag) => {
    const li = zeileOhneHaken(eintrag);
    const b = eintrag.buchung;
    if (!auswahl) return li;
    const an = auswahl.has(b.id);
    const kasten = h('input', { type: 'checkbox', checked: an, disabled: Boolean(b.archivJahr), tabindex: -1, 'aria-hidden': 'true' });
    haken.set(b.id, kasten);
    li.classList.toggle('gewaehlt', an);
    li.prepend(h('span', { class: 'btab-haken' }, kasten));
    const knopf = li.querySelector('.btab-zeile');
    knopf.setAttribute('aria-pressed', String(an));
    knopf.addEventListener('click', () => {
      if (b.archivJahr) return toast(`Archiv ${b.archivJahr}: nur lesen.`);
      umschalten(b);
      knopf.setAttribute('aria-pressed', String(auswahl.has(b.id)));
    });
    return li;
  };
  const zeileOhneHaken = ({ buchung: b, wirkung }) => {
    let partnerText;
    let katText;
    if (b.art === 'umbuchung') {
      const von = b.richtung === 'ab' ? b.kontoId : b.gegenkontoId;
      const auf = b.richtung === 'ab' ? b.gegenkontoId : b.kontoId;
      partnerText = 'Umbuchung';
      // D228: Konten als Etikett – als Funktion, weil derselbe Inhalt an zwei Stellen steht (PC-Spalte, Handy-Titel)
      katText = () => [kontoEtikett(kontoNach.get(von)), ' → ', kontoEtikett(kontoNach.get(auf)),
        b.budgetKategorieId && ` · Budget ${kat.get(b.budgetKategorieId)?.name ?? '?'}`]; // D98
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
    const unterName = b.art === 'umbuchung' ? katText() : kat.get(b.kategorieId)?.name ?? 'Unbekannte Kategorie';
    // Am Handy Umbuchungen standardmäßig ausgeblendet (D77) – außer sie sind ausdrücklich gefiltert
    return h('li', { role: 'row', class: b.art === 'umbuchung' && !umbuchungGefiltert ? 'ub-ausblendbar' : null, 'data-bid': b.id }, // D211
      h('button', {
        type: 'button',
        class: 'btab-zeile' + (b.art === 'umbuchung' ? ' umbuchung' : ''),
        onclick: () => auswahl || (b.archivJahr ? toast(`Archiv ${b.archivJahr}: nur lesen. Zum Ändern das Jahr in den Stammdaten zurückholen.`) : oeffneBuchungsdialog(b)),
      },
      h('span', { class: 'btab-zelle btab-partner' },
        partnerText
          ? h('span', { class: 'btab-partner-name' }, partnerText)
          // Ohne Empfänger/Absender: am Handy steht die Kategorie als Titel, am PC ein Strich
          : [h('span', { class: 'nur-breit gedaempft' }, '–'), h('span', { class: 'nur-schmal btab-partner-name' }, unterName)],
        // D141: keine v-Spalte hier – „Alle Buchungen“ zeigt nur gebuchte Buchungen (D120)
        b.status === 'vorgemerkt' && h('span', { class: 'marke marke-vorgemerkt' }, 'vorgemerkt'),
        auslageMarke(b), // D214
        hochMarke(b, ungewoehnlich.get(b.id)), // D186: antippen = bestätigen
        b.archivJahr && h('span', { class: 'marke' }, 'Archiv')),
      h('span', { class: 'btab-unter' },
        h('span', { class: 'btab-zelle btab-datum' }, formatDatum(b.datum)),
        h('span', { class: 'btab-zelle btab-kategorie', title: typeof katText === 'string' ? katText : null },
          b.art !== 'umbuchung' && katPunkt(farbeVon(b.kategorieId, kat, farben)), typeof katText === 'function' ? katText() : katText),
        h('span', { class: 'btab-zelle btab-konto' }, b.art === 'umbuchung' ? '' : kontoNach.has(b.kontoId) && kontoEtikett(kontoNach.get(b.kontoId))),
        h('span', { class: 'btab-zelle btab-notiz', title: b.notiz || null }, b.notiz ?? '')),
      h('span', { class: `btab-zelle btab-betrag betrag ${klasse}` }, betragText)));
  };

  zeigeZahl();
  return h('section', { class: 'bereich buchungen' },
    h('div', { class: 'btab-werkzeuge' },
      h('span', { class: 'klein' }, `Sortiert nach ${sortText}`),
      !umbuchungGefiltert && umbuchungKnopf(zeigen.filter((e) => e.buchung.art === 'umbuchung').length),
      zuruecksetzen,
      auswaehlenKnopf,
      exportKnopf),
    auswahlLeiste,
    h('div', { class: 'btab' + (auswahl ? ' mit-auswahl' : ''), role: 'table', 'aria-label': 'Buchungen' },
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
