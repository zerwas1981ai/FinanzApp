// D165: Monatsnotiz – ein Satz je Monat für alle Konten, z. B. „Autoreparatur, deshalb hoch“.
// Schreiben in der Übersicht (✎ beim Monatsnamen) und im Rückblick; Anzeige auch in der Analyse.
// Datensatz (Sammlung "monatsnotizen", Datenversion 21): { id: 'JJJJ-MM', text, erstelltAm, geaendertAm }

import { h } from '../dom.js';
import * as db from '../db.js';
import { dialog, eingabe, toast, datenGeaendert } from '../ui.js';
import { baueMonatsnotiz } from '../monatsnotizen.js';
import { monatLang, monatKurz } from '../rueckblick.js';

/** Notizen als Map 'JJJJ-MM' → Text */
export const notizMap = (notizen = []) => new Map(notizen.filter((n) => n.text).map((n) => [n.id, n.text]));

/** Kleiner ✎-Knopf zum Schreiben/Ändern der Notiz eines Monats */
export function notizKnopf(monat, notizen, nachher = datenGeaendert) {
  const alt = notizen.find((n) => n.id === monat) ?? null;
  return h('button', {
    type: 'button',
    class: 'icon-knopf notiz-knopf' + (alt?.text ? ' hat-notiz' : ''),
    title: alt?.text ? `Monatsnotiz ändern: ${alt.text}` : 'Monatsnotiz schreiben',
    'aria-label': alt?.text ? 'Monatsnotiz ändern' : 'Monatsnotiz schreiben',
    onclick: () => notizDialog(monat, alt, nachher),
  }, '✎');
}

/** Die Notiz eines Monats als ruhige Zeile (oder nichts) */
export function notizZeile(monat, notizen) {
  const text = notizMap(notizen).get(monat);
  return text ? h('p', { class: 'monatsnotiz' }, '✎ ', text) : null;
}

/** Notizen mehrerer Monate als kurze Liste („Okt 26: …“), z. B. in Rückblick und Analyse */
export function notizListe(monate, notizen, titel = 'Monatsnotizen') {
  const map = notizMap(notizen);
  const mit = monate.filter((m) => map.has(m));
  if (!mit.length) return null;
  return h('div', { class: 'notiz-liste' },
    h('span', { class: 'klein gedaempft' }, titel),
    h('ul', {}, mit.map((m) => h('li', {}, h('strong', {}, `${monatKurz(m)}: `), map.get(m)))));
}

function notizDialog(monat, alt, nachher) {
  const text = eingabe({
    label: `Notiz für ${monatLang(monat)}`, value: alt?.text ?? '', maxlength: 200, autofocus: true,
    placeholder: 'z. B. Autoreparatur, deshalb hoch',
    hilfe: 'Ein kurzer Satz für alle Konten. Erscheint in der Übersicht, im Rückblick und in der Analyse. Leer = löschen.',
  });
  dialog({
    titel: 'Monatsnotiz',
    inhalt: [text.feld],
    onSpeichern: async () => {
      const neu = baueMonatsnotiz(monat, text.input.value, { alt });
      if (neu) await db.speichere('monatsnotizen', neu);
      else if (alt) await db.loesche('monatsnotizen', monat);
      toast(neu ? 'Notiz gespeichert' : 'Notiz gelöscht');
      nachher();
    },
  });
}
