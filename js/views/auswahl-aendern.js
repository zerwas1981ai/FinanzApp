// D260: Mehrere Buchungen auf einmal ändern (Tab „Auswertungen“ → Liste → „Auswählen“).
// Kategorie oder Konto für alle angehakten Buchungen setzen oder alle in den Papierkorb legen.
// Die Regeln stecken in mehrereAendern() (buchungen.js, mit `npm test` geprüft).

import { h } from '../dom.js';
import * as db from '../db.js';
import { dialog, toast, frage, auswahl, datenGeaendert } from '../ui.js';
import { mehrereAendern, gruppeVon, inPapierkorb, wiederherstellen } from '../buchungen.js';
import { fuelleKategorien } from './buchung-dialog.js';
import { sortiereKonten } from '../konten.js';

const anzahlText = (n) => (n === 1 ? '1 Buchung' : `${n} Buchungen`);

/** „3 übersprungen (2 Umbuchungen, 1 schon so)“ – kurz für die Meldung */
function uebersprungenText(liste) {
  if (!liste.length) return '';
  const gruende = new Map();
  for (const { grund } of liste) gruende.set(grund, (gruende.get(grund) ?? 0) + 1);
  const teile = [...gruende].map(([grund, n]) => {
    if (grund === 'Umbuchung') return n === 1 ? '1 Umbuchung' : `${n} Umbuchungen`;
    if (grund === 'Einnahme') return n === 1 ? '1 Einnahme' : `${n} Einnahmen`;
    if (grund === 'Ausgabe') return n === 1 ? '1 Ausgabe' : `${n} Ausgaben`;
    if (grund === 'schon so') return `${n} schon so`;
    if (grund === 'archiviert') return `${n} im Archiv`;
    if (grund === 'im Papierkorb') return `${n} im Papierkorb`;
    return `${n}: ${grund}`;
  });
  return ` – ${liste.length} übersprungen (${teile.join(', ')})`;
}

async function grundlagen() {
  const [alle, konten, kategorien, aufrunden, ausgleich] = await Promise.all([
    db.alle('buchungen'), db.alle('konten'), db.alle('kategorien'),
    db.hole('einstellungen', 'aufrunden'), db.hole('einstellungen', 'ausgleich'),
  ]);
  return { alle, konten, kategorien, aufrunden, ausgleich };
}

/** Speichern, Meldung mit „Rückgängig“ (alte Fassungen zurückschreiben), Auswahl beenden */
async function uebernehmen(ergebnis, was, fertig) {
  if (!ergebnis.anzahl) {
    throw new Error(`Keine der ausgewählten Buchungen lässt sich so ändern${uebersprungenText(ergebnis.uebersprungen)}.`);
  }
  await db.speichere('buchungen', ergebnis.geaendert);
  const vorher = ergebnis.vorher;
  toast(`${was}: ${anzahlText(ergebnis.anzahl)} geändert${uebersprungenText(ergebnis.uebersprungen)}`, {
    aktion: 'Rückgängig',
    beiAktion: async () => { await db.speichere('buchungen', vorher); toast('Rückgängig gemacht'); datenGeaendert(); },
  });
  fertig();
  datenGeaendert();
}

/** Kategorie für die ausgewählten Buchungen. ids: Set der Buchungs-IDs */
export async function kategorieAendern(ids, fertig) {
  const g = await grundlagen();
  const gewaehlt = g.alle.filter((b) => ids.has(b.id) && b.art !== 'umbuchung' && !b.geloeschtAm);
  const arten = ['ausgabe', 'einnahme'].filter((a) => gewaehlt.some((b) => b.art === a));
  if (!arten.length) return toast('Umbuchungen haben keine Kategorie – bitte Einnahmen oder Ausgaben auswählen.');
  let art = arten[0];
  const select = h('select', { id: 'mehrere-kategorie' });
  const hinweis = h('p', { class: 'hinweis' });
  const zeigeHinweis = () => {
    const n = gewaehlt.filter((b) => b.art === art).length;
    const andere = ids.size - n;
    hinweis.textContent = `Gilt für ${anzahlText(n)} (${art === 'ausgabe' ? 'Ausgaben' : 'Einnahmen'}).`
      + (andere > 0 ? ` ${andere === 1 ? 'Eine weitere ausgewählte Buchung bleibt' : `${andere} weitere ausgewählte Buchungen bleiben`} unverändert.` : '');
  };
  fuelleKategorien(select, g.kategorien, art, null);
  zeigeHinweis();
  // Sind Einnahmen UND Ausgaben ausgewählt, wählt man, für welche die Kategorie gilt
  const artWahl = arten.length > 1 && h('div', { class: 'segmente', role: 'group', 'aria-label': 'Für welche Buchungen' },
    arten.map((a) => h('button', {
      type: 'button',
      class: 'segment',
      'aria-pressed': String(a === art),
      onclick: (e) => {
        art = a;
        for (const k of e.currentTarget.parentElement.children) k.setAttribute('aria-pressed', String(k === e.currentTarget));
        fuelleKategorien(select, g.kategorien, art, null);
        zeigeHinweis();
      },
    }, a === 'ausgabe' ? 'Ausgaben' : 'Einnahmen')));
  dialog({
    titel: 'Kategorie ändern',
    inhalt: [artWahl, h('div', { class: 'feld' }, h('label', { for: 'mehrere-kategorie' }, 'Neue Kategorie'), select), hinweis].filter(Boolean),
    speichernText: 'Ändern',
    onSpeichern: async () => {
      if (!select.value) throw new Error('Bitte eine Kategorie wählen.');
      const r = mehrereAendern([...ids], { kategorieId: select.value }, g);
      await uebernehmen(r, 'Kategorie', fertig);
    },
  });
}

/** Konto für die ausgewählten Buchungen */
export async function kontoAendern(ids, fertig) {
  const g = await grundlagen();
  const n = g.alle.filter((b) => ids.has(b.id) && b.art !== 'umbuchung' && !b.geloeschtAm).length;
  if (!n) return toast('Umbuchungen lassen sich hier nicht verschieben – bitte im Buchungsdialog ändern.');
  const konten = sortiereKonten(g.konten.filter((k) => !k.archiviert));
  const feld = auswahl({
    label: 'Neues Konto',
    optionen: [{ wert: '', text: 'Bitte wählen …' }, ...konten.map((k) => ({ wert: k.id, text: k.name }))],
    wert: '',
    hilfe: 'Aufrundungen und Ausgleiche folgen wie beim Bearbeiten einer einzelnen Buchung.',
  });
  dialog({
    titel: 'Konto ändern',
    inhalt: [feld.feld, h('p', { class: 'hinweis' }, `Gilt für ${anzahlText(n)}.`
      + (ids.size > n ? ' Ausgewählte Umbuchungen bleiben unverändert.' : ''))],
    speichernText: 'Ändern',
    onSpeichern: async () => {
      if (!feld.select.value) throw new Error('Bitte ein Konto wählen.');
      const r = mehrereAendern([...ids], { kontoId: feld.select.value }, g);
      await uebernehmen(r, 'Konto', fertig);
    },
  });
}

/** Alle ausgewählten Buchungen in den Papierkorb (Umbuchungen mit beiden Hälften) */
export async function inDenPapierkorb(ids, fertig) {
  const alle = await db.alle('buchungen');
  const gruppe = new Map();
  for (const b of alle) {
    if (!ids.has(b.id) || b.geloeschtAm) continue;
    for (const teil of gruppeVon(b, alle)) gruppe.set(teil.id, teil);
  }
  const anzahl = alle.filter((b) => ids.has(b.id) && !b.geloeschtAm).length;
  if (!anzahl) return;
  const ok = await frage({
    titel: 'In den Papierkorb',
    text: `${anzahlText(anzahl)} in den Papierkorb legen? Sie lassen sich dort (oder gleich mit „Rückgängig“) wiederherstellen.`,
    jaText: 'In den Papierkorb',
    gefahr: true,
  });
  if (!ok) return;
  const liste = [...gruppe.values()];
  await inPapierkorb(liste);
  toast(`${anzahlText(anzahl)} im Papierkorb`, {
    aktion: 'Rückgängig',
    beiAktion: async () => { await wiederherstellen(liste); toast('Wiederhergestellt'); datenGeaendert(); },
  });
  fertig();
  datenGeaendert();
}
