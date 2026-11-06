// Tab "Übersicht" (Etappe 2): Konto wählen, Monatsansicht mit Zwischensummen,
// Kontoabstimmung. Kennzahlen (Etappe 4) und Zukunftsmonate (Etappe 5) folgen später.

import { h } from '../dom.js';
import * as db from '../db.js';
import {
  formatEuro, formatDatum, formatMonat, formatTag, heuteIso, parseEuro,
  isoMonatsanfang, naechsterMonat, vorigerMonat, istGueltigesDatum,
} from '../format.js';
import { monatsuebersicht, kontostand, vorgemerktBis } from '../rechnen.js';
import { dialog, eingabe, hinweis, toast, geraet, datenGeaendert } from '../ui.js';
import { oeffneBuchungsdialog } from './buchung-dialog.js';
import { monatsprognose, faelligListe, budgetHinweise } from '../prognose.js';
import { kennzahlenBereich, erwartetBereich, hinweisBereich } from './kennzahlen.js';

const nachName = (a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' });
// alleAnzeigen: "kontoId|JJJJ-MM-01", wenn für dieses Konto/diesen Monat alle Buchungen gezeigt werden
const ansicht = { jahr: null, monat: null, alleAnzeigen: null };
const MAX_BUCHUNGEN = 10; // so viele Buchungen zeigt die Monatsansicht standardmäßig

const monatVon = (iso) => [Number(iso.slice(0, 4)), Number(iso.slice(5, 7))];

export async function zeigeUebersicht(container) {
  const namen = ['konten', 'kategorien', 'buchungen', 'abstimmungen', 'budgets', 'wiederkehrend', 'hinweise', 'einstellungen'];
  const werte = await Promise.all(namen.map((s) => db.alle(s)));
  const daten = Object.fromEntries(namen.map((n, i) => [n, werte[i]]));
  daten.wiederkehrende = daten.wiederkehrend; // Name, den prognose.js erwartet
  const { konten, kategorien, buchungen, abstimmungen } = daten;
  const neu = () => zeigeUebersicht(container);
  const aktive = konten.filter((k) => !k.archiviert).sort(nachName);

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

  const gemerkt = geraet.lies('ansicht-konto');
  const konto = aktive.find((k) => k.id === gemerkt) ?? aktive[0];

  // Monat festlegen und auf den sinnvollen Bereich begrenzen
  const heute = heuteIso();
  if (ansicht.jahr === null) [ansicht.jahr, ansicht.monat] = monatVon(heute);
  const kontoBuchungen = buchungen.filter((b) => !b.geloeschtAm && b.kontoId === konto.id);
  const letztesDatum = kontoBuchungen.reduce((max, b) => (b.datum > max ? b.datum : max), heute);
  const minMonat = monatVon(konto.stichtag);
  const maxMonat = monatVon(letztesDatum);
  const schluessel = ([j, m]) => j * 12 + m;
  if (schluessel([ansicht.jahr, ansicht.monat]) < schluessel(minMonat)) [ansicht.jahr, ansicht.monat] = minMonat;
  if (schluessel([ansicht.jahr, ansicht.monat]) > schluessel(maxMonat)) [ansicht.jahr, ansicht.monat] = maxMonat;

  const m = monatsuebersicht(konto, buchungen, ansicht.jahr, ansicht.monat);
  const istAktuellerMonat = isoMonatsanfang(ansicht.jahr, ansicht.monat) === isoMonatsanfang(...monatVon(heute));

  // Etappe 4: Kennzahlen, Budgethinweise; je Konto: offene Termine und Budgets
  const prognose = monatsprognose(daten, heute);
  const hinweise = budgetHinweise(daten, heute);
  const kd = prognose.jeKonto.get(konto.id);
  // Fällige Termine (bis 7 Tage im Voraus) je Konto zählen – als Zahl an den Kontoknöpfen
  const faelligJeKonto = new Map();
  for (const t of faelligListe(daten, heute)) {
    faelligJeKonto.set(t.wiederkehrend.kontoId, (faelligJeKonto.get(t.wiederkehrend.kontoId) ?? 0) + 1);
  }

  // filter(Boolean): leere Bereiche (null/false) weglassen – sonst stünde "null" als Text da
  container.replaceChildren(...[
    h('h1', { class: 'seitentitel' }, 'Übersicht'),
    kennzahlenBereich(prognose, daten, heute),
    hinweisBereich(hinweise, daten),
    h('h2', { class: 'zwischentitel' }, 'Konten'),
    kontoAuswahl(aktive, konto, faelligJeKonto, (id) => { geraet.schreib('ansicht-konto', id); neu(); }),
    kontoKopf(konto, buchungen, abstimmungen, kd?.prognose),
    monatsNavigation({
      zurueck: schluessel([ansicht.jahr, ansicht.monat]) > schluessel(minMonat),
      vor: schluessel([ansicht.jahr, ansicht.monat]) < schluessel(maxMonat),
      istAktuellerMonat,
      wechsel: (richtung) => {
        if (richtung === 'heute') [ansicht.jahr, ansicht.monat] = monatVon(heute);
        else [ansicht.jahr, ansicht.monat] = (richtung < 0 ? vorigerMonat : naechsterMonat)(ansicht.jahr, ansicht.monat);
        neu();
      },
    }),
    summenKarte(konto, m, istAktuellerMonat ? kd : null),
    buchungsliste(m, konto, konten, kategorien),
    istAktuellerMonat && erwartetBereich(kd, daten),
    h('p', { class: 'hinweis zentriert' }, 'Zukunftsmonate bis 2050 folgen in Etappe 5.'),
  ].filter(Boolean));
}

/* ---------- Kontoauswahl ---------- */

function kontoAuswahl(konten, aktiv, faelligJeKonto, beiWahl) {
  return h('div', { class: 'chips', role: 'group', 'aria-label': 'Konto wählen' },
    konten.map((k) => {
      const anzahl = faelligJeKonto.get(k.id) ?? 0;
      return h('button', {
        type: 'button',
        class: 'chip',
        'aria-pressed': String(k.id === aktiv.id),
        'aria-label': anzahl ? `${k.name}, ${anzahl} fällige Buchung${anzahl === 1 ? '' : 'en'}` : k.name,
        title: anzahl ? `${anzahl} fällige wiederkehrende Buchung${anzahl === 1 ? '' : 'en'}` : null,
        onclick: () => beiWahl(k.id),
      }, k.name, anzahl > 0 && h('span', { class: 'chip-zahl', 'aria-hidden': 'true' }, String(anzahl)));
    }));
}

/* ---------- Kopf: Stand heute, Abstimmung ---------- */

function kontoKopf(konto, buchungen, abstimmungen, prognoseCent) {
  const heute = heuteIso();
  const stand = kontostand(konto, buchungen, heute);
  const vorgemerkt = vorgemerktBis(konto, buchungen, heute);
  const letzte = abstimmungen
    .filter((a) => a.kontoId === konto.id)
    .sort((a, b) => b.erstelltAm.localeCompare(a.erstelltAm))[0];

  let abstimmText = 'Noch nicht abgestimmt.';
  if (letzte) {
    // Differenz immer neu berechnen – so sieht man, ob nachgetragene Buchungen sie beheben
    const differenz = letzte.bankstandCent - kontostand(konto, buchungen, letzte.datum);
    abstimmText = `Zuletzt abgestimmt für ${formatDatum(letzte.datum)}: ` +
      (differenz === 0 ? 'stimmt ✓' : `Differenz ${formatEuro(differenz)}`);
  }

  return h('section', { class: 'bereich konto-kopf' },
    h('div', {},
      h('div', { class: 'klein' }, `Kontostand heute (${formatDatum(heute)})`),
      h('div', { class: 'gross' + (stand < 0 ? ' negativ' : '') }, formatEuro(stand)),
      vorgemerkt !== 0 && h('div', { class: 'klein' }, `davon vorgemerkt: ${formatEuro(vorgemerkt)}`),
      prognoseCent !== undefined && h('div', { class: 'klein' }, 'Prognose Monatsende: ',
        h('span', { class: 'annahme' + (prognoseCent < 0 ? ' negativ' : '') }, formatEuro(prognoseCent)),
        konto.mindestsaldoCent != null && prognoseCent < konto.mindestsaldoCent && h('span', { class: 'warn-text' }, ' – unter Mindestsaldo')),
      h('div', { class: 'klein abstimm-info' + (letzte && letzte.bankstandCent !== kontostand(konto, buchungen, letzte.datum) ? ' warn-text' : '') }, abstimmText),
    ),
    h('button', { type: 'button', class: 'knopf', onclick: () => abstimmungsDialog(konto, buchungen) }, 'Abstimmen'),
  );
}

/* ---------- Monatsnavigation ---------- */

function monatsNavigation({ zurueck, vor, istAktuellerMonat, wechsel }) {
  return h('div', { class: 'monat-nav' },
    h('button', { type: 'button', class: 'icon-knopf', 'aria-label': 'Voriger Monat', disabled: !zurueck, onclick: () => wechsel(-1) }, '‹'),
    h('h2', { class: 'monat-titel' }, formatMonat(ansicht.jahr, ansicht.monat)),
    h('button', { type: 'button', class: 'icon-knopf', 'aria-label': 'Nächster Monat', disabled: !vor, onclick: () => wechsel(1) }, '›'),
    !istAktuellerMonat && h('button', { type: 'button', class: 'knopf knopf-klein', onclick: () => wechsel('heute') }, 'Heute'),
  );
}

/* ---------- Zwischensummen ---------- */

/** kd: nur im laufenden Monat – Aufschlüsselung der Prognose für dieses Konto */
function summenKarte(konto, m, kd) {
  const zeile = (label, cent, klasse = '', vorzeichen = false) => h('div', { class: `summe ${klasse}` },
    h('span', {}, label),
    h('span', { class: 'betrag' + (cent < 0 ? ' negativ' : '') }, (vorzeichen && cent > 0 ? '+' : '') + formatEuro(cent)));

  return h('section', { class: 'bereich summen' },
    zeile(m.stichtagImMonat ? `Anfangssaldo am ${formatDatum(konto.stichtag)}` : `Stand am ${formatDatum(m.erster)}`, m.anfang),
    zeile('Einnahmen', m.einnahmen, 'plus', true),
    zeile('Ausgaben', -m.ausgaben, '', true),
    m.umbuchungen !== 0 && zeile('Umbuchungen (saldiert)', m.umbuchungen, 'gedaempft', true),
    zeile(kd ? 'Stand nach erfassten Buchungen' : 'Stand Monatsende', m.ende, 'ergebnis'),
    kd && kd.offenWirkung !== 0 && zeile('Noch offene wiederkehrende Buchungen', kd.offenWirkung, 'annahme', true),
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

  // Neueste zuerst: Tage absteigend, innerhalb eines Tages die zuletzt erfasste oben.
  // Der "Stand" je Tag bleibt der Kontostand am Ende dieses Tages.
  // Standardmäßig nur die letzten 10 Buchungen; "Alle anzeigen" zeigt den ganzen Monat.
  const schluessel = `${konto.id}|${m.erster}`;
  const alle = ansicht.alleAnzeigen === schluessel;
  let rest = alle ? Infinity : MAX_BUCHUNGEN;
  const tage = [];
  for (const tag of [...m.tage].reverse()) {
    if (rest <= 0) break;
    const zeilen = [...tag.buchungen].reverse().slice(0, rest);
    rest -= zeilen.length;
    tage.push(h('div', { class: 'tag' },
      h('div', { class: 'tag-kopf' },
        h('span', {}, formatTag(tag.datum)),
        h('span', { class: 'tag-stand' + (tag.standAbend < 0 ? ' negativ' : '') }, `Stand ${formatEuro(tag.standAbend)}`)),
      h('ul', { class: 'liste' }, zeilen.map((b) => buchungsZeile(b, katName, kontoName)))));
  }

  const umschalten = m.anzahl > MAX_BUCHUNGEN && h('div', { class: 'mehr' },
    h('button', {
      type: 'button',
      class: 'knopf knopf-klein',
      onclick: () => {
        ansicht.alleAnzeigen = alle ? null : schluessel;
        datenGeaendert(); // neu zeichnen, Scrollposition bleibt
      },
    }, alle
      ? `Nur die letzten ${MAX_BUCHUNGEN} anzeigen`
      : `Alle ${m.anzahl} Buchungen von ${formatMonat(...monatVon(m.erster))} anzeigen`));

  return h('section', { class: 'bereich buchungen' },
    h('div', { class: 'tag-kopf liste-kopf' },
      h('span', {}, alle || m.anzahl <= MAX_BUCHUNGEN ? `${m.anzahl} Buchungen` : `Letzte ${MAX_BUCHUNGEN} von ${m.anzahl} Buchungen`)),
    tage,
    umschalten,
  );
}

function buchungsZeile(b, katName, kontoName) {
  let titel;
  let unterzeile;
  if (b.art === 'umbuchung') {
    titel = b.richtung === 'ab' ? `Umbuchung → ${kontoName.get(b.gegenkontoId) ?? '?'}` : `Umbuchung ← ${kontoName.get(b.gegenkontoId) ?? '?'}`;
    unterzeile = b.notiz;
  } else {
    const unter = katName.get(b.kategorieId);
    const haupt = unter && katName.get(unter.elternId);
    titel = unter?.name ?? 'Unbekannte Kategorie';
    unterzeile = [haupt?.name, b.notiz].filter(Boolean).join(' · ');
  }
  const wirkung = b.art === 'einnahme' || b.richtung === 'zu' ? b.betragCent : -b.betragCent;

  return h('li', {},
    h('button', { type: 'button', class: 'buchung', onclick: () => oeffneBuchungsdialog(b) },
      h('span', { class: 'buchung-text' },
        h('span', { class: 'buchung-titel' }, titel, b.status === 'vorgemerkt' && h('span', { class: 'marke' }, 'vorgemerkt')),
        unterzeile && h('span', { class: 'buchung-unter' }, unterzeile)),
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
