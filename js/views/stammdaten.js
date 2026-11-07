// Tab "Stammdaten": Konten und Kategorien verwalten, Testdaten laden/löschen.

import { h } from '../dom.js';
import * as db from '../db.js';
import { formatEuro, formatDatum, parseEuro, centZuEingabe, heuteIso, istGueltigesDatum } from '../format.js';
import { dialog, frage, toast, eingabe, auswahl, optionsGruppe, knopf, schalter } from '../ui.js';
import { hatTestdaten, ladeTestdaten, loescheTestdaten } from '../testdaten.js';
import { neueKategorie } from '../startdaten.js';
import { DATENMODELL_VERSION } from '../migrationen.js';
import { anzahlFuerKonto, anzahlFuerKategorien, gruppeVon, wiederherstellen, endgueltigLoeschen } from '../buchungen.js';
import { wirkungCent } from '../rechnen.js';
import { leseEinstellungen, speichereEinstellungen } from '../annahmen.js';
import { belegeEntfernen } from './belege.js';
import { driveBereich, exportBereich, neuBeginnenBereich, archivBereich } from './drive-bereich.js';
import { sperreBereich } from './sperre-ui.js';
import { sortiereKonten, verschiebeKonto, naechsteReihenfolge } from '../konten.js';

// Alle Buchungen (auch im Papierkorb) – für die Löschsperre. Wird bei jedem Zeichnen neu geladen.
let buchungen = [];
// Eigene relevante Ausgaben (D74) – für den Papierkorb
let relevantListe = [];
// [Budgets, wiederkehrende Buchungen] – für die Löschsperre und um Testdaten zu erkennen
let testAnnahmen = [[], [], [], []]; // budgets, wiederkehrend, geplant, projekte

/** Budgets und wiederkehrende Buchungen, die an Konto bzw. Kategorien hängen */
function annahmenFuer({ kontoId = null, kategorieIds = [] }) {
  const ids = new Set(kategorieIds);
  const [budgets, wiederkehrend, geplant = []] = testAnnahmen;
  const haengt = (x) => x.kontoId === kontoId || x.gegenkontoId === kontoId || ids.has(x.kategorieId);
  return budgets.filter((b) => b.kontoId === kontoId || ids.has(b.kategorieId)).length
    + wiederkehrend.filter(haengt).length
    + geplant.filter(haengt).length;
}

/** Wird gelöscht, obwohl etwas daran hängt? Dann stattdessen Archivieren anbieten. */
async function loeschenGesperrt(anzahl, datensatz, sammlung, neu, anzahlAnnahmen = 0) {
  if (anzahl === 0 && anzahlAnnahmen === 0) return false;
  const teile = [];
  if (anzahl) teile.push(anzahl === 1 ? '1 Buchung (Papierkorb mitgezählt)' : `${anzahl} Buchungen (Papierkorb mitgezählt)`);
  if (anzahlAnnahmen) teile.push(anzahlAnnahmen === 1 ? '1 Annahme (Budget, wiederkehrende oder geplante Buchung)' : `${anzahlAnnahmen} Annahmen (Budgets, wiederkehrende oder geplante Buchungen)`);
  const ok = await frage({
    titel: 'Löschen nicht möglich',
    text: [
      `An „${datensatz.name}“ hängen: ${teile.join(' und ')}.`,
      'Damit nichts sein Konto oder seine Kategorie verliert, kannst du nur archivieren.',
    ],
    jaText: datensatz.archiviert ? 'OK' : 'Stattdessen archivieren',
  });
  if (ok && !datensatz.archiviert) await setzeArchiv(sammlung, datensatz, true, neu);
  return true;
}

// Merkt sich Ansichts-Einstellungen, solange die Seite offen ist
const ansicht = { kontenArchiv: false, kategorienArchiv: false, offen: new Set() };

const nachName = (a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' });
const gleicherName = (a, b) => a.trim().toLocaleLowerCase('de') === b.trim().toLocaleLowerCase('de');
const jetzt = () => new Date().toISOString();
const ART_TEXT = { einnahme: 'Einnahme', ausgabe: 'Ausgabe' };
const IST_ENTWICKLUNG = ['localhost', '127.0.0.1'].includes(location.hostname);

export async function zeigeStammdaten(container) {
  const [konten, kategorien, alleBuchungen, budgets, wiederkehrend, geplant, projekte, relevant] = await Promise.all(
    ['konten', 'kategorien', 'buchungen', 'budgets', 'wiederkehrend', 'geplant', 'projekte', 'relevant'].map((s) => db.alle(s)),
  );
  buchungen = alleBuchungen;
  relevantListe = relevant;
  testAnnahmen = [budgets, wiederkehrend, geplant, projekte];
  const neu = () => zeigeStammdaten(container);
  // filter(Boolean): ausgeblendete Bereiche (false) weglassen – sonst stünde "false" als Text da
  container.replaceChildren(...[
    h('h1', { class: 'seitentitel' }, 'Stammdaten'),
    kontenBereich(konten, neu),
    kategorienBereich(kategorien, neu),
    schwellenBereich(await leseEinstellungen()),
    driveBereich(neu),
    await sperreBereich(neu),
    exportBereich(),
    papierkorbBereich(konten, kategorien, neu),
    await archivBereich(neu),
    // Testdaten nur beim Entwickeln am PC (localhost), nicht in der veröffentlichten App (D66)
    IST_ENTWICKLUNG && testdatenBereich(konten, kategorien, neu),
    neuBeginnenBereich(),
    infoBereich(),
  ].filter(Boolean));
}

async function setzeArchiv(sammlung, datensatz, archiviert, neu) {
  await db.speichere(sammlung, { ...datensatz, archiviert, geaendertAm: jetzt() });
  toast(`„${datensatz.name}“ ${archiviert ? 'archiviert' : 'wiederhergestellt'}`);
  neu();
}

/* =========================== Konten =========================== */

function kontenBereich(konten, neu) {
  const anzahlArchiv = konten.filter((k) => k.archiviert).length;
  // Eigene Reihenfolge (D84), archivierte zuletzt
  const sichtbar = sortiereKonten(konten.filter((k) => ansicht.kontenArchiv || !k.archiviert));

  return h('section', { class: 'bereich', 'aria-labelledby': 'titel-konten' },
    h('div', { class: 'bereich-kopf' },
      h('h2', { id: 'titel-konten' }, 'Konten'),
      h('button', { type: 'button', class: 'knopf knopf-primaer', onclick: () => kontoDialog(null, konten, neu) }, '+ Konto'),
    ),
    sichtbar.length === 0
      ? h('p', { class: 'leer' }, konten.length
        ? 'Alle Konten sind archiviert.'
        : 'Noch keine Konten. Lege dein erstes Konto an oder lade unten die Testdaten.')
      : h('ul', { class: 'liste' }, sichtbar.map((k) => kontoZeile(k, konten, neu))),
    anzahlArchiv > 0 && schalter(`Archivierte Konten anzeigen (${anzahlArchiv})`, ansicht.kontenArchiv, (an) => {
      ansicht.kontenArchiv = an;
      neu();
    }),
  );
}

function kontoZeile(k, konten, neu) {
  const mindest = k.mindestsaldoCent == null ? 'keiner' : formatEuro(k.mindestsaldoCent);
  return h('li', { class: 'zeile' + (k.archiviert ? ' archiviert' : '') },
    h('div', {},
      h('div', { class: 'zeile-titel' }, k.name, k.archiviert && h('span', { class: 'marke' }, 'archiviert')),
      h('div', { class: 'zeile-info' }, `Stichtag ${formatDatum(k.stichtag)} · Mindestsaldo ${mindest}`),
    ),
    h('div', { class: 'zeile-betrag' + (k.anfangssaldoCent < 0 ? ' negativ' : '') },
      h('small', {}, 'Anfangssaldo'),
      formatEuro(k.anfangssaldoCent),
    ),
    h('div', { class: 'zeile-aktionen' },
      !k.archiviert && reihenfolgeKnoepfe(k, konten, neu),
      knopf('Bearbeiten', () => kontoDialog(k, konten, neu)),
      k.archiviert
        ? knopf('Wiederherstellen', () => setzeArchiv('konten', k, false, neu))
        : knopf('Archivieren', () => setzeArchiv('konten', k, true, neu)),
      knopf('Löschen', () => kontoLoeschen(k, neu), 'knopf-gefahr'),
    ),
  );
}

/** ▲/▼: Konto eine Stelle nach oben bzw. unten (D84) – gilt nach dem Abgleich auf allen Geräten */
function reihenfolgeKnoepfe(k, konten, neu) {
  const aktiv = sortiereKonten(konten.filter((x) => !x.archiviert));
  const platz = aktiv.findIndex((x) => x.id === k.id);
  const schiebe = async (richtung) => {
    const geaendert = verschiebeKonto(konten, k.id, richtung);
    if (!geaendert.length) return;
    await db.speichere('konten', geaendert);
    neu();
  };
  return h('span', { class: 'reihenfolge-knoepfe' },
    h('button', {
      type: 'button', class: 'knopf knopf-klein', disabled: platz <= 0,
      'aria-label': `${k.name} nach oben`, title: 'Nach oben', onclick: () => schiebe(-1),
    }, '▲'),
    h('button', {
      type: 'button', class: 'knopf knopf-klein', disabled: platz >= aktiv.length - 1,
      'aria-label': `${k.name} nach unten`, title: 'Nach unten', onclick: () => schiebe(1),
    }, '▼'));
}

function kontoDialog(konto, konten, neu) {
  const name = eingabe({ label: 'Name', value: konto?.name ?? '', maxlength: 60, placeholder: 'z. B. Girokonto' });
  const saldo = eingabe({
    label: 'Anfangssaldo in €',
    value: konto ? centZuEingabe(konto.anfangssaldoCent) : '0,00',
    inputmode: 'decimal',
    hilfe: 'Kontostand laut Bank am Stichtag. Bei Schulden mit Minus, z. B. -250,00',
  });
  const stichtag = eingabe({
    label: 'Stichtag',
    type: 'date',
    value: konto?.stichtag ?? heuteIso(),
    hilfe: 'Ab diesem Tag rechnet die App mit diesem Konto.',
  });
  const mindest = eingabe({
    label: 'Mindestsaldo in € (optional)',
    value: konto?.mindestsaldoCent == null ? '' : centZuEingabe(konto.mindestsaldoCent),
    inputmode: 'decimal',
    hilfe: 'Später warnt die App, wenn der Stand darunter fällt. Leer lassen = keine Warnung.',
  });

  dialog({
    titel: konto ? 'Konto bearbeiten' : 'Neues Konto',
    inhalt: [name.feld, saldo.feld, stichtag.feld, mindest.feld],
    onSpeichern: async () => {
      const n = name.input.value.trim();
      if (!n) throw new Error('Bitte einen Namen eingeben.');
      if (konten.some((k) => k.id !== konto?.id && gleicherName(k.name, n))) {
        throw new Error(`Ein Konto „${n}“ gibt es schon (eventuell archiviert).`);
      }
      const anfangssaldoCent = parseEuro(saldo.input.value, 'Anfangssaldo') ?? 0;
      if (!istGueltigesDatum(stichtag.input.value)) throw new Error('Bitte einen gültigen Stichtag wählen.');
      if (konto) {
        const frueheste = buchungen
          .filter((b) => b.kontoId === konto.id && !b.geloeschtAm)
          .reduce((min, b) => (min === null || b.datum < min ? b.datum : min), null);
        if (frueheste && stichtag.input.value > frueheste) {
          throw new Error(`Es gibt Buchungen ab ${formatDatum(frueheste)}. Der Stichtag darf nicht danach liegen.`);
        }
      }
      const mindestsaldoCent = parseEuro(mindest.input.value, 'Mindestsaldo');

      const zeit = jetzt();
      // Neues Konto kommt ans Ende der Reihenfolge (D84)
      const basis = konto ?? { id: crypto.randomUUID(), archiviert: false, erstelltAm: zeit, reihenfolge: naechsteReihenfolge(konten) };
      await db.speichere('konten', {
        ...basis,
        name: n,
        anfangssaldoCent,
        stichtag: stichtag.input.value,
        mindestsaldoCent,
        geaendertAm: zeit,
      });
      toast(konto ? 'Konto gespeichert' : `Konto „${n}“ angelegt`);
      neu();
    },
  });
}

async function kontoLoeschen(k, neu) {
  if (await loeschenGesperrt(anzahlFuerKonto(k.id, buchungen), k, 'konten', neu, annahmenFuer({ kontoId: k.id }))) return;
  const ok = await frage({
    titel: 'Konto löschen?',
    text: [`„${k.name}“ wird endgültig gelöscht.`, 'Tipp: „Archivieren“ blendet das Konto nur aus und lässt sich rückgängig machen.'],
    jaText: 'Endgültig löschen',
    gefahr: true,
  });
  if (!ok) return;
  await db.loesche('konten', k.id);
  toast(`„${k.name}“ gelöscht`);
  neu();
}

/* ========================= Kategorien ========================= */

function kategorienBereich(kategorien, neu) {
  const haupt = kategorien.filter((k) => !k.elternId);
  const anzahlArchiv = kategorien.filter((k) => k.archiviert).length;

  const gruppe = (art, titel) => {
    const liste = haupt.filter((k) => k.art === art && (ansicht.kategorienArchiv || !k.archiviert)).sort(nachName);
    return h('div', { class: `kat-gruppe ${art}` },
      h('h3', {}, titel),
      liste.length
        ? liste.map((k) => hauptKarte(k, kategorien, neu))
        : h('p', { class: 'leer' }, 'Keine Kategorien.'),
    );
  };

  return h('section', { class: 'bereich', 'aria-labelledby': 'titel-kategorien' },
    h('div', { class: 'bereich-kopf' },
      h('h2', { id: 'titel-kategorien' }, 'Kategorien'),
      h('button', { type: 'button', class: 'knopf knopf-primaer', onclick: () => hauptDialog(null, kategorien, neu) }, '+ Hauptkategorie'),
    ),
    h('p', { class: 'hinweis' }, 'Gebucht wird später immer auf eine Unterkategorie. Budgets gelten für die ganze Hauptkategorie. Zum Aufklappen auf eine Kategorie tippen.'),
    gruppe('einnahme', 'Einnahmen'),
    gruppe('ausgabe', 'Ausgaben'),
    anzahlArchiv > 0 && schalter(`Archivierte Kategorien anzeigen (${anzahlArchiv})`, ansicht.kategorienArchiv, (an) => {
      ansicht.kategorienArchiv = an;
      neu();
    }),
  );
}

function hauptKarte(k, kategorien, neu) {
  const unter = kategorien.filter((u) => u.elternId === k.id);
  const aktiv = unter.filter((u) => !u.archiviert).length;
  const sichtbar = unter.filter((u) => ansicht.kategorienArchiv || !u.archiviert).sort(nachName);

  const karte = h('details', { class: 'kat' + (k.archiviert ? ' archiviert' : ''), open: ansicht.offen.has(k.id) },
    h('summary', {},
      h('span', { class: 'kat-name' }, k.name),
      k.archiviert && h('span', { class: 'marke' }, 'archiviert'),
      h('span', { class: 'kat-anzahl' }, aktiv === 1 ? '1 Unterkategorie' : `${aktiv} Unterkategorien`),
    ),
    h('div', { class: 'kat-inhalt' },
      aktiv === 0 && !k.archiviert && h('p', { class: 'warnhinweis' }, 'Noch keine Unterkategorie – auf diese Kategorie kann später nicht gebucht werden.'),
      sichtbar.length > 0 && h('ul', { class: 'liste liste-unter' }, sichtbar.map((u) => unterZeile(u, k, kategorien, neu))),
      h('div', { class: 'knopfreihe' },
        knopf('+ Unterkategorie', () => unterDialog(null, k, kategorien, neu)),
        knopf('Bearbeiten', () => hauptDialog(k, kategorien, neu)),
        k.archiviert
          ? knopf('Wiederherstellen', () => setzeArchiv('kategorien', k, false, neu))
          : knopf('Archivieren', () => setzeArchiv('kategorien', k, true, neu)),
        knopf('Löschen', () => hauptLoeschen(k, unter, neu), 'knopf-gefahr'),
      ),
    ),
  );
  karte.addEventListener('toggle', () => (karte.open ? ansicht.offen.add(k.id) : ansicht.offen.delete(k.id)));
  return karte;
}

function unterZeile(u, haupt, kategorien, neu) {
  return h('li', { class: 'zeile' + (u.archiviert ? ' archiviert' : '') },
    h('div', { class: 'zeile-titel' }, u.name, u.archiviert && h('span', { class: 'marke' }, 'archiviert')),
    h('div', { class: 'zeile-aktionen' },
      knopf('Bearbeiten', () => unterDialog(u, haupt, kategorien, neu)),
      u.archiviert
        ? knopf('Wiederherstellen', () => setzeArchiv('kategorien', u, false, neu))
        : knopf('Archivieren', () => setzeArchiv('kategorien', u, true, neu)),
      knopf('Löschen', () => unterLoeschen(u, neu), 'knopf-gefahr'),
    ),
  );
}

function hauptDialog(kat, kategorien, neu) {
  const name = eingabe({ label: 'Name der Hauptkategorie', value: kat?.name ?? '', maxlength: 60, placeholder: 'z. B. Wohnen' });
  const art = optionsGruppe({
    label: 'Art',
    optionen: [{ wert: 'ausgabe', text: 'Ausgabe' }, { wert: 'einnahme', text: 'Einnahme' }],
    wert: kat?.art ?? 'ausgabe',
  });

  dialog({
    titel: kat ? 'Hauptkategorie bearbeiten' : 'Neue Hauptkategorie',
    inhalt: [name.feld, art.feld, h('p', { class: 'hinweis' }, 'Unterkategorien übernehmen automatisch die Art der Hauptkategorie.')],
    onSpeichern: async () => {
      const n = name.input.value.trim();
      if (!n) throw new Error('Bitte einen Namen eingeben.');
      if (kategorien.some((k) => !k.elternId && k.id !== kat?.id && gleicherName(k.name, n))) {
        throw new Error(`Eine Hauptkategorie „${n}“ gibt es schon (eventuell archiviert).`);
      }
      if (kat) {
        await db.speichere('kategorien', { ...kat, name: n, art: art.wert(), geaendertAm: jetzt() });
        toast('Kategorie gespeichert');
      } else {
        const neueKat = neueKategorie({ name: n, art: art.wert() });
        await db.speichere('kategorien', neueKat);
        ansicht.offen.add(neueKat.id); // gleich aufgeklappt zeigen
        toast(`„${n}“ angelegt – jetzt Unterkategorien hinzufügen`);
      }
      neu();
    },
  });
}

function unterDialog(unterKat, haupt, kategorien, neu) {
  const hauptListe = kategorien
    .filter((k) => !k.elternId && (!k.archiviert || k.id === haupt.id))
    .sort(nachName);
  const name = eingabe({ label: 'Name der Unterkategorie', value: unterKat?.name ?? '', maxlength: 60, placeholder: 'z. B. Miete' });
  const eltern = auswahl({
    label: 'Gehört zu Hauptkategorie',
    optionen: hauptListe.map((k) => ({ wert: k.id, text: `${k.name} (${ART_TEXT[k.art]})` })),
    wert: haupt.id,
  });

  dialog({
    titel: unterKat ? 'Unterkategorie bearbeiten' : `Neue Unterkategorie in „${haupt.name}“`,
    inhalt: [name.feld, eltern.feld],
    onSpeichern: async () => {
      const n = name.input.value.trim();
      const elternId = eltern.select.value;
      if (!n) throw new Error('Bitte einen Namen eingeben.');
      if (kategorien.some((k) => k.elternId === elternId && k.id !== unterKat?.id && gleicherName(k.name, n))) {
        throw new Error(`In dieser Hauptkategorie gibt es „${n}“ schon (eventuell archiviert).`);
      }
      if (unterKat) {
        await db.speichere('kategorien', { ...unterKat, name: n, elternId, geaendertAm: jetzt() });
        toast('Unterkategorie gespeichert');
      } else {
        await db.speichere('kategorien', neueKategorie({ name: n, elternId }));
        toast(`„${n}“ angelegt`);
      }
      ansicht.offen.add(elternId);
      neu();
    },
  });
}

async function hauptLoeschen(k, unter, neu) {
  const ids = [k.id, ...unter.map((u) => u.id)];
  if (await loeschenGesperrt(anzahlFuerKategorien(ids, buchungen), k, 'kategorien', neu, annahmenFuer({ kategorieIds: ids }))) return;
  const text = [`„${k.name}“ wird endgültig gelöscht.`];
  if (unter.length) text[0] = `„${k.name}“ und ${unter.length === 1 ? 'ihre Unterkategorie' : `ihre ${unter.length} Unterkategorien`} werden endgültig gelöscht.`;
  text.push('Tipp: „Archivieren“ blendet die Kategorie nur aus und lässt sich rückgängig machen.');
  const ok = await frage({ titel: 'Kategorie löschen?', text, jaText: 'Endgültig löschen', gefahr: true });
  if (!ok) return;
  await db.loesche('kategorien', [k.id, ...unter.map((u) => u.id)]);
  ansicht.offen.delete(k.id);
  toast(`„${k.name}“ gelöscht`);
  neu();
}

async function unterLoeschen(u, neu) {
  if (await loeschenGesperrt(anzahlFuerKategorien([u.id], buchungen), u, 'kategorien', neu, annahmenFuer({ kategorieIds: [u.id] }))) return;
  const ok = await frage({
    titel: 'Unterkategorie löschen?',
    text: [`„${u.name}“ wird endgültig gelöscht.`, 'Tipp: „Archivieren“ blendet sie nur aus.'],
    jaText: 'Endgültig löschen',
    gefahr: true,
  });
  if (!ok) return;
  await db.loesche('kategorien', u.id);
  toast(`„${u.name}“ gelöscht`);
  neu();
}

/* =================== Schwellen für Budgethinweise =================== */

function schwellenBereich(einstellungen) {
  const monate = eingabe({ label: 'Monate in Folge', type: 'number', min: 2, max: 12, step: 1, inputmode: 'numeric', value: einstellungen.monate });
  const prozent = eingabe({ label: 'Mindestabweichung in %', type: 'number', min: 1, max: 100, step: 1, inputmode: 'numeric', value: einstellungen.prozent });
  const fehler = h('p', { class: 'dialog-fehler', role: 'alert' });
  return h('section', { class: 'bereich', 'aria-labelledby': 'titel-schwellen' },
    h('h2', { id: 'titel-schwellen' }, 'Schwellen für Budgethinweise'),
    h('p', { class: 'hinweis' },
      'Ein Hinweis erscheint, wenn eine Kategorie so viele abgeschlossene Monate in Folge über (oder in Folge unter) ' +
      'ihrem Budget liegt und dabei im Schnitt um mehr als diesen Prozentsatz abweicht.'),
    h('div', { class: 'feld-paar' }, monate.feld, prozent.feld),
    fehler,
    h('div', { class: 'knopfreihe' }, h('button', {
      type: 'button',
      class: 'knopf',
      onclick: async () => {
        try {
          await speichereEinstellungen({ monate: Number(monate.input.value), prozent: Number(prozent.input.value) });
          fehler.textContent = '';
          toast('Schwellen gespeichert');
        } catch (err) {
          fehler.textContent = err.message;
        }
      },
    }, 'Speichern')),
  );
}

/* ========================= Papierkorb ========================= */

function papierkorbBereich(konten, kategorien, neu) {
  // Umbuchungen nur einmal zeigen (die "ab"-Hälfte)
  const geloescht = buchungen
    .filter((b) => b.geloeschtAm && b.richtung !== 'zu')
    .sort((a, b) => b.geloeschtAm.localeCompare(a.geloeschtAm));
  const kontoName = new Map(konten.map((k) => [k.id, k.name]));
  const kat = new Map(kategorien.map((k) => [k.id, k]));

  const relevantWeg = relevantListe
    .filter((x) => x.geloeschtAm)
    .sort((a, b) => b.geloeschtAm.localeCompare(a.geloeschtAm));
  const anzahl = geloescht.length + relevantWeg.length;

  const beschreibung = (b) => {
    if (b.art === 'umbuchung') return `Umbuchung ${kontoName.get(b.kontoId) ?? '?'} → ${kontoName.get(b.gegenkontoId) ?? '?'}`;
    const unter = kat.get(b.kategorieId);
    return `${unter?.name ?? 'Unbekannte Kategorie'} · ${kontoName.get(b.kontoId) ?? '?'}`;
  };

  return h('section', { class: 'bereich', 'aria-labelledby': 'titel-papierkorb' },
    h('div', { class: 'bereich-kopf' },
      h('h2', { id: 'titel-papierkorb' }, `Papierkorb (${anzahl})`),
      anzahl > 0 && h('button', {
        type: 'button',
        class: 'knopf knopf-gefahr',
        onclick: async () => {
          const ok = await frage({
            titel: 'Papierkorb leeren?',
            text: `${anzahl === 1 ? '1 Eintrag wird' : `${anzahl} Einträge werden`} endgültig gelöscht.`,
            jaText: 'Endgültig löschen',
            gefahr: true,
          });
          if (!ok) return;
          await belegeEntfernen(buchungen.filter((b) => b.geloeschtAm));
          await endgueltigLoeschen(buchungen.filter((b) => b.geloeschtAm));
          await belegeEntfernen(relevantWeg);
          await db.loesche('relevant', relevantWeg.map((x) => x.id));
          toast('Papierkorb geleert');
          neu();
        },
      }, 'Leeren'),
    ),
    anzahl === 0 && h('p', { class: 'leer' }, 'Der Papierkorb ist leer. Gelöschte Buchungen landen zuerst hier.'),
    geloescht.length > 0 && h('ul', { class: 'liste' }, geloescht.map((b) => {
        const wirkung = b.art === 'umbuchung' ? b.betragCent : wirkungCent(b);
        return h('li', { class: 'zeile' },
          h('div', {},
            h('div', { class: 'zeile-titel' }, beschreibung(b)),
            h('div', { class: 'zeile-info' }, `${formatDatum(b.datum)}${b.notiz ? ` · ${b.notiz}` : ''}`)),
          h('div', { class: 'zeile-betrag' + (wirkung < 0 ? ' negativ' : '') }, formatEuro(wirkung)),
          h('div', { class: 'zeile-aktionen' },
            knopf('Wiederherstellen', async () => {
              await wiederherstellen(gruppeVon(b, buchungen));
              toast('Buchung wiederhergestellt');
              neu();
            }),
            knopf('Endgültig löschen', async () => {
              const ok = await frage({ titel: 'Endgültig löschen?', text: 'Die Buchung kann danach nicht wiederhergestellt werden.', jaText: 'Endgültig löschen', gefahr: true });
              if (!ok) return;
              await belegeEntfernen(gruppeVon(b, buchungen));
              await endgueltigLoeschen(gruppeVon(b, buchungen));
              toast('Buchung endgültig gelöscht');
              neu();
            }, 'knopf-gefahr')));
      })),
    relevantWeg.length > 0 && h('div', { class: 'tag-kopf' }, h('span', {}, 'Relevante Ausgaben')),
    relevantWeg.length > 0 && h('ul', { class: 'liste' }, relevantWeg.map((x) => h('li', { class: 'zeile' },
      h('div', {},
        h('div', { class: 'zeile-titel' }, x.partner || x.notiz || 'Relevante Ausgabe'),
        h('div', { class: 'zeile-info' }, [formatDatum(x.datum), x.gruppe, x.partner && x.notiz].filter(Boolean).join(' · '))),
      h('div', { class: 'zeile-betrag negativ' }, formatEuro(-x.betragCent)),
      h('div', { class: 'zeile-aktionen' },
        knopf('Wiederherstellen', async () => {
          await db.speichere('relevant', { ...x, geloeschtAm: null, geaendertAm: jetzt() });
          toast('Wiederhergestellt');
          neu();
        }),
        knopf('Endgültig löschen', async () => {
          const ok = await frage({ titel: 'Endgültig löschen?', text: 'Der Eintrag kann danach nicht wiederhergestellt werden.', jaText: 'Endgültig löschen', gefahr: true });
          if (!ok) return;
          await belegeEntfernen([x]);
          await db.loesche('relevant', x.id);
          toast('Endgültig gelöscht');
          neu();
        }, 'knopf-gefahr'))))),
  );
}

/* ========================= Testdaten ========================= */

function testdatenBereich(konten, kategorien, neu) {
  const vorhanden = hatTestdaten(konten, kategorien, buchungen, ...testAnnahmen);
  return h('section', { class: 'bereich', 'aria-labelledby': 'titel-testdaten' },
    h('h2', { id: 'titel-testdaten' }, 'Testdaten'),
    h('p', { class: 'hinweis' },
      'Erfundene Beispielkonten, -kategorien, Buchungen der letzten drei Monate, Budgets und ' +
      'wiederkehrende Buchungen zum Ausprobieren. ' +
      'Konten und Kategorien sind mit „(Test)“ markiert. „Testdaten löschen“ entfernt nur diese ' +
      '(und Buchungen, die an Testkonten hängen) – deine eigenen Einträge bleiben erhalten.'),
    h('div', { class: 'knopfreihe' },
      h('button', {
        type: 'button',
        class: 'knopf',
        disabled: vorhanden,
        onclick: async () => {
          const geladen = await ladeTestdaten();
          toast(geladen ? 'Testdaten geladen' : 'Testdaten sind schon geladen');
          neu();
        },
      }, 'Testdaten laden'),
      h('button', {
        type: 'button',
        class: 'knopf knopf-gefahr',
        disabled: !vorhanden,
        onclick: async () => {
          const ok = await frage({ titel: 'Testdaten löschen?', text: 'Alle mit „(Test)“ markierten Konten und Kategorien und alle Buchungen darauf werden endgültig entfernt.', jaText: 'Löschen', gefahr: true });
          if (!ok) return;
          const anzahl = await loescheTestdaten();
          toast(`Testdaten gelöscht (${anzahl.konten} Konten, ${anzahl.kategorien} Kategorien, ${anzahl.buchungen} Buchungen, ` +
            `${anzahl.budgets} Budgets, ${anzahl.wiederkehrend} wiederkehrende/geplante)`);
          neu();
        },
      }, 'Testdaten löschen'),
    ),
  );
}

function infoBereich() {
  return h('section', { class: 'bereich', 'aria-labelledby': 'titel-info' },
    h('h2', { id: 'titel-info' }, 'Über die Daten'),
    h('p', { class: 'hinweis' },
      'Deine Daten liegen in diesem Browser auf diesem Gerät und – wenn verbunden – in deinem Google Drive. ' +
      'Der Programmcode enthält keine Finanzdaten und keine Zugangsdaten.'),
    h('p', { class: 'hinweis' }, `Datenmodell-Version: ${DATENMODELL_VERSION}`),
  );
}
