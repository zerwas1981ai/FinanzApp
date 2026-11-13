// Etappe 6: Belege (Fotos und PDFs) an einer Buchung. Siehe DECISIONS.md D62.
// - Bilder werden vor dem Speichern verkleinert (längste Seite 1600 px, JPEG).
// - Neue Belege liegen erst nur auf diesem Gerät (Schublade "belegDateien") und werden
//   beim nächsten Abgleich in den Drive-Ordner "Belege" hochgeladen.
// Datensatz an der Buchung: belege: [{ id, name, mime, groesse, driveId (null = noch nicht hochgeladen), hinzugefuegtAm }]

import { h } from '../dom.js';
import * as db from '../db.js';
import { dialog, toast } from '../ui.js';
import { belegDatei, belegSpaeterLoeschen } from '../sync/abgleich.js';
import { belegListe, filtereBelege } from '../belegliste.js';

const MAX_SEITE = 1600;
const MAX_BYTES = 15 * 1024 * 1024;

const groesseText = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** Bild verkleinern (JPEG). PDFs und andere Dateien bleiben, wie sie sind. */
export async function verkleinere(datei) {
  if (!datei.type.startsWith('image/')) return datei;
  const bild = await createImageBitmap(datei).catch(() => null);
  if (!bild) return datei; // z. B. HEIC, das der Browser nicht lesen kann
  const faktor = Math.min(1, MAX_SEITE / Math.max(bild.width, bild.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bild.width * faktor);
  canvas.height = Math.round(bild.height * faktor);
  canvas.getContext('2d').drawImage(bild, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
  return blob && blob.size < datei.size ? blob : datei;
}

/**
 * Belege-Bereich für den Buchungsdialog.
 * bestehende: belege der Buchung. namensVorschlag(): z. B. "2026-11-06 Supermarkt Muster".
 * speichere(): neue Dateien lokal ablegen, entfernte zum Löschen vormerken → neue belege-Liste.
 */
export function belegeFeld(bestehende = [], namensVorschlag = () => 'Beleg', { label = 'Belege (optional)' } = {}) {
  let liste = [...bestehende];
  const neu = new Map(); // id → Blob (noch nicht gespeichert)
  const entfernt = [];
  const ul = h('ul', { class: 'belege-liste' });

  const zeichne = () => {
    ul.replaceChildren(...liste.map((b) => h('li', {},
      h('span', { class: 'beleg-name', title: b.name }, b.mime === 'application/pdf' ? '📄 ' : '🖼 ', b.name),
      h('small', { class: 'klein' }, groesseText(b.groesse) + (b.driveId ? '' : ' · noch nicht in Drive')),
      h('button', { type: 'button', class: 'knopf knopf-klein', onclick: () => zeigeBeleg(b, neu.get(b.id)) }, 'Ansehen'),
      h('button', {
        type: 'button',
        class: 'knopf knopf-klein',
        'aria-label': `Beleg ${b.name} entfernen`,
        onclick: () => {
          liste = liste.filter((x) => x !== b);
          if (neu.has(b.id)) neu.delete(b.id);
          else entfernt.push(b);
          zeichne();
        },
      }, '✕'))));
    ul.hidden = liste.length === 0;
  };

  const hinzufuegen = async (dateien) => {
    for (const datei of dateien) {
      if (!datei.type.startsWith('image/') && datei.type !== 'application/pdf') {
        toast('Bitte nur Fotos (JPG, PNG) oder PDF anhängen.');
        continue;
      }
      const blob = await verkleinere(datei);
      if (blob.size > MAX_BYTES) {
        toast(`${datei.name} ist zu groß (höchstens 15 MB).`);
        continue;
      }
      const istPdf = blob.type === 'application/pdf';
      const nr = liste.length + 1;
      const id = crypto.randomUUID();
      liste.push({
        id,
        name: `${namensVorschlag()}${nr > 1 ? ` (${nr})` : ''}.${istPdf ? 'pdf' : blob.type === 'image/png' ? 'png' : 'jpg'}`.replace(/[\\/:*?"<>|]/g, '-'),
        mime: blob.type || datei.type,
        groesse: blob.size,
        driveId: null,
        hinzugefuegtAm: new Date().toISOString(),
      });
      neu.set(id, blob);
    }
    zeichne();
  };

  const auswahl = (attribute, text) => {
    const input = h('input', { type: 'file', hidden: true, ...attribute, onchange: (e) => { hinzufuegen([...e.target.files]); e.target.value = ''; } });
    return [input, h('button', { type: 'button', class: 'knopf knopf-klein', onclick: () => input.click() }, text)];
  };

  zeichne();
  const feld = h('div', { class: 'feld' },
    h('span', { class: 'feld-label' }, label),
    ul,
    h('div', { class: 'knopfreihe' },
      ...auswahl({ accept: 'image/*', capture: 'environment' }, '📷 Foto aufnehmen'),
      ...auswahl({ accept: 'image/*,application/pdf', multiple: true }, '+ Datei wählen')),
    h('small', { class: 'feld-hilfe' }, 'Fotos werden verkleinert. Belege werden beim nächsten Abgleich in Google Drive gespeichert.'));

  return {
    feld,
    /** Die neue belege-Liste für die Buchung (ohne etwas zu speichern) */
    liste: () => [...liste],
    /** D142: Namen neu setzen (z. B. „JJJJ-MM-TT Notiz“ bei relevanten Ausgaben) – fn(liste) → neue Liste */
    umbenennen(fn) {
      liste = fn(liste);
      zeichne();
    },
    /** Dateien von außen hinzufügen (z. B. über "Teilen an Finanzen", D106) – wie "Datei wählen" */
    fuegeHinzu: (dateien) => hinzufuegen(dateien),
    /** Erst NACH dem erfolgreichen Speichern der Buchung aufrufen: Dateien ablegen, Entferntes vormerken */
    async uebernehme() {
      for (const b of liste) {
        const blob = neu.get(b.id);
        if (blob) await db.speichere('belegDateien', { id: b.id, blob, name: b.name, mime: b.mime });
      }
      for (const b of entfernt) {
        await db.loesche('belegDateien', b.id);
        await belegSpaeterLoeschen(b.driveId);
        await belegSpaeterLoeschen(b.relevantDriveId); // Kopie unter "Relevante Ausgaben" (D74)
      }
      return liste;
    },
  };
}

/** Beleg ansehen: Bild im Dialog, PDF in einem neuen Fenster */
export async function zeigeBeleg(beleg, blob = null) {
  try {
    const datei = blob ?? await belegDatei(beleg);
    const url = URL.createObjectURL(datei);
    if (beleg.mime === 'application/pdf') {
      const fenster = window.open(url, '_blank');
      if (!fenster) {
        // Pop-up blockiert: als Download anbieten
        h('a', { href: url, download: beleg.name }).click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return;
    }
    const dlg = dialog({
      titel: beleg.name,
      inhalt: [h('img', { class: 'beleg-vorschau', src: url, alt: `Beleg ${beleg.name}` })],
      speichernText: 'Schließen',
      abbrechenText: null,
    });
    dlg.addEventListener('close', () => URL.revokeObjectURL(url));
  } catch (err) {
    toast(err.message ?? String(err));
  }
}

/** Belege von endgültig gelöschten Buchungen (oder relevanten Ausgaben) auch in Drive entfernen (Papierkorb) */
export async function belegeEntfernen(buchungen) {
  for (const b of buchungen) {
    for (const x of b.belege ?? []) {
      await db.loesche('belegDateien', x.id);
      await belegSpaeterLoeschen(x.driveId);
      await belegSpaeterLoeschen(x.relevantDriveId);
    }
  }
}

/* =========================== D179: Belege-Übersicht (Tab Projekte) =========================== */

const QUELLE_TEXT = { buchung: 'Buchung', relevant: 'Relevante Ausgabe', vertrag: 'Vertrag' };
let belegSuche = ''; // solange die App offen ist

/**
 * Alle Belege an einem Ort, mit Suche. Antippen öffnet den Beleg; „Zur Buchung“ öffnet den Eintrag.
 * daten: braucht buchungen, relevant, vertraege, kategorien. oeffne(eintrag): öffnet den zugehörigen Dialog.
 */
export function belegeBereich(daten, oeffne) {
  const MAX = 100;
  const alle = belegListe(daten);
  const such = h('input', { type: 'search', class: 'such-eingabe', placeholder: 'Suchen nach Name, Empfänger, Datum …', 'aria-label': 'Belege durchsuchen', value: belegSuche });
  const liste = h('ul', { class: 'beleg-uebersicht' });
  const info = h('p', { class: 'klein gedaempft' });

  const zeichne = () => {
    belegSuche = such.value;
    const treffer = filtereBelege(alle, such.value);
    info.textContent = (treffer.length === alle.length ? `${alle.length} Beleg${alle.length === 1 ? '' : 'e'}` : `${treffer.length} von ${alle.length} Belegen`)
      + (treffer.length > MAX ? ` – die neuesten ${MAX} angezeigt` : '');
    liste.replaceChildren(...treffer.slice(0, MAX).map((x) => h('li', {},
      h('button', { type: 'button', class: 'beleg-zeile', title: 'Beleg ansehen', onclick: () => zeigeBeleg(x.beleg) },
        h('span', { class: 'beleg-symbol', 'aria-hidden': 'true' }, x.beleg.mime === 'application/pdf' ? '📄' : '🖼'),
        h('span', { class: 'beleg-text' },
          h('span', { class: 'beleg-titel' }, x.name),
          h('span', { class: 'klein gedaempft' }, [x.datum && `${x.datum.slice(8, 10)}.${x.datum.slice(5, 7)}.${x.datum.slice(0, 4)}`, x.titel,
            !x.beleg.driveId && 'noch nicht in Drive'].filter(Boolean).join(' · ')))),
      h('button', { type: 'button', class: 'knopf knopf-klein', title: `${QUELLE_TEXT[x.quelle]} öffnen`, onclick: () => oeffne(x) },
        x.quelle === 'vertrag' ? 'Vertrag' : 'Buchung'))));
    if (!treffer.length) liste.replaceChildren(h('li', { class: 'leer' }, alle.length ? 'Kein Beleg passt zur Suche.' : 'Noch keine Belege.'));
  };
  let warte = null;
  such.addEventListener('input', () => { clearTimeout(warte); warte = setTimeout(zeichne, 150); });
  zeichne();

  return h('section', { class: 'bereich belege-bereich', 'aria-labelledby': 'titel-belege' },
    h('div', { class: 'bereich-kopf' }, h('h2', { id: 'titel-belege' }, 'Belege')),
    h('p', { class: 'hinweis erklaerung' },
      'Alle Belege aus Buchungen, relevanten Ausgaben und Verträgen, neueste zuerst. Einen Beleg antippen öffnet ihn; ' +
      'der Knopf rechts öffnet den zugehörigen Eintrag. Neue Belege hängst du wie gewohnt an der Buchung an.'),
    alle.length > 0 && such,
    info,
    liste);
}
