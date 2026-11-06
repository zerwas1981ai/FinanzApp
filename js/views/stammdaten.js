// Tab "Stammdaten": Konten und Kategorien verwalten, Testdaten laden/löschen.

import { h } from '../dom.js';
import * as db from '../db.js';
import { formatEuro, formatDatum, parseEuro, centZuEingabe, heuteIso, istGueltigesDatum } from '../format.js';
import { dialog, frage, toast, eingabe, auswahl, optionsGruppe, knopf, schalter } from '../ui.js';
import { hatTestdaten, ladeTestdaten, loescheTestdaten } from '../testdaten.js';
import { neueKategorie } from '../startdaten.js';
import { DATENMODELL_VERSION } from '../migrationen.js';

// Merkt sich Ansichts-Einstellungen, solange die Seite offen ist
const ansicht = { kontenArchiv: false, kategorienArchiv: false, offen: new Set() };

const nachName = (a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' });
const gleicherName = (a, b) => a.trim().toLocaleLowerCase('de') === b.trim().toLocaleLowerCase('de');
const jetzt = () => new Date().toISOString();
const ART_TEXT = { einnahme: 'Einnahme', ausgabe: 'Ausgabe' };

export async function zeigeStammdaten(container) {
  const [konten, kategorien] = await Promise.all([db.alle('konten'), db.alle('kategorien')]);
  const neu = () => zeigeStammdaten(container);
  container.replaceChildren(
    h('h1', { class: 'seitentitel' }, 'Stammdaten'),
    kontenBereich(konten, neu),
    kategorienBereich(kategorien, neu),
    testdatenBereich(konten, kategorien, neu),
    infoBereich(),
  );
}

async function setzeArchiv(sammlung, datensatz, archiviert, neu) {
  await db.speichere(sammlung, { ...datensatz, archiviert, geaendertAm: jetzt() });
  toast(`„${datensatz.name}“ ${archiviert ? 'archiviert' : 'wiederhergestellt'}`);
  neu();
}

/* =========================== Konten =========================== */

function kontenBereich(konten, neu) {
  const anzahlArchiv = konten.filter((k) => k.archiviert).length;
  const sichtbar = konten.filter((k) => ansicht.kontenArchiv || !k.archiviert).sort(nachName);

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
      knopf('Bearbeiten', () => kontoDialog(k, konten, neu)),
      k.archiviert
        ? knopf('Wiederherstellen', () => setzeArchiv('konten', k, false, neu))
        : knopf('Archivieren', () => setzeArchiv('konten', k, true, neu)),
      knopf('Löschen', () => kontoLoeschen(k, neu), 'knopf-gefahr'),
    ),
  );
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
      const mindestsaldoCent = parseEuro(mindest.input.value, 'Mindestsaldo');

      const zeit = jetzt();
      const basis = konto ?? { id: crypto.randomUUID(), archiviert: false, erstelltAm: zeit };
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

/* ========================= Testdaten ========================= */

function testdatenBereich(konten, kategorien, neu) {
  const vorhanden = hatTestdaten(konten, kategorien);
  return h('section', { class: 'bereich', 'aria-labelledby': 'titel-testdaten' },
    h('h2', { id: 'titel-testdaten' }, 'Testdaten'),
    h('p', { class: 'hinweis' },
      'Erfundene Beispielkonten und -kategorien zum Ausprobieren. Sie sind mit „(Test)“ markiert. ' +
      '„Testdaten löschen“ entfernt nur diese – deine eigenen Einträge bleiben erhalten.'),
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
          const ok = await frage({ titel: 'Testdaten löschen?', text: 'Alle mit „(Test)“ markierten Konten und Kategorien werden entfernt.', jaText: 'Löschen', gefahr: true });
          if (!ok) return;
          const anzahl = await loescheTestdaten();
          toast(`Testdaten gelöscht (${anzahl.konten} Konten, ${anzahl.kategorien} Kategorien)`);
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
      'Deine Daten liegen im Moment nur in diesem Browser auf diesem Gerät. ' +
      'Der Abgleich mit Google Drive folgt in einer späteren Etappe.'),
    h('p', { class: 'hinweis' }, `Datenmodell-Version: ${DATENMODELL_VERSION}`),
  );
}
