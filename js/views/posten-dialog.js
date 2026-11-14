// Einen Posten der Zukunft direkt ändern (Folgemonat in der Monatsansicht und Zeitleiste).
// - Termin einer wiederkehrenden Buchung: Betrag/Datum NUR für diesen Termin, überspringen,
//   zurücksetzen. Die Serie selbst bleibt unverändert.
// - Geplante Einmalbuchung: der normale Dialog (sie ist ja nur ein einzelner Posten).
// - Budget: Monatsbetrag NUR für diesen Monat – auch im laufenden Monat (D99, „Noch erwartet“).
// Siehe DECISIONS.md D58.

import { h } from '../dom.js';
import * as db from '../db.js';
import { formatEuro, formatDatum, formatMonat, centZuEingabe, parseEuro, istGueltigesDatum } from '../format.js';
import { dialog, toast, eingabe, datenGeaendert } from '../ui.js';
import { mitAusnahme, budgetMitMonatsAusnahme } from '../annahmen.js';
import { betragAm, terminBetrag, regelBetrag as budgetRegelBetrag } from '../prognose.js';
import { geplantDialog } from './annahmen.js';
import { oeffneBuchungsdialog } from './buchung-dialog.js';

const monatText = (m) => formatMonat(Number(m.slice(0, 4)), Number(m.slice(5, 7)));

/** posten: aus zeitleiste(); daten: braucht konten, kategorien, buchungen, projekte, budgets */
export async function oeffnePostenDialog(posten, daten) {
  const { ref } = posten;
  if (ref?.geplant) return geplantDialog(ref.geplant, daten);
  if (ref?.wiederkehrend) return terminAendern(posten);
  if (ref?.budget) return budgetAendern(ref.budget, daten);
  return null;
}

/* ---------- Termin einer wiederkehrenden Buchung ---------- */

function terminAendern(posten) {
  const { wiederkehrend: w, termin } = posten.ref;
  const ausnahme = (w.ausnahmen ?? []).find((a) => a.termin === termin);
  const regelBetrag = terminBetrag(w, termin); // inkl. Kalendermonat-Abweichung (D94)
  const betrag = eingabe({ label: 'Betrag in €', inputmode: 'decimal', value: centZuEingabe(Math.abs(posten.wirkung)), class: 'eingabe-betrag', autofocus: true });
  const datum = eingabe({ label: 'Datum', type: 'date', value: posten.datum });

  const speichere = async (aktion, ...werte) => {
    await db.speichere('wiederkehrend', mitAusnahme(w, termin, aktion, ...werte));
    datenGeaendert();
  };

  const dlg = dialog({
    titel: `${posten.text} am ${formatDatum(termin)}`,
    inhalt: [
      h('p', { class: 'hinweis' },
        `Änderungen gelten nur für diesen einen Termin. Regulär: ${formatEuro(regelBetrag)} am ${formatDatum(termin)}. ` +
        'Die ganze Serie (z. B. ab einem Monat mehr) änderst du unter „Annahmen“.'),
      betrag.feld,
      datum.feld,
      h('div', { class: 'knopfreihe' },
        h('button', {
          type: 'button',
          class: 'knopf',
          onclick: async () => {
            await speichere('ueberspringen');
            dlg.close();
            toast(`${posten.text} am ${formatDatum(termin)} übersprungen`);
          },
        }, 'Überspringen'),
        ausnahme && h('button', {
          type: 'button',
          class: 'knopf',
          onclick: async () => {
            await speichere(null);
            dlg.close();
            toast('Zurückgesetzt auf den regulären Termin');
          },
        }, 'Zurücksetzen')),
    ],
    onSpeichern: async () => {
      const cent = parseEuro(betrag.input.value, 'Betrag');
      if (!istGueltigesDatum(datum.input.value)) throw new Error('Bitte ein gültiges Datum wählen.');
      await speichere('aendern', datum.input.value, cent);
      toast(`Nur für diesen Termin: ${formatEuro(cent)} am ${formatDatum(datum.input.value)}`);
    },
  });
  return dlg;
}

/* ---------- Budget eines Monats ---------- */

/** Monatsbudget nur für einen Monat ändern – Zukunftsmonate und laufender Monat (D99) */
export function budgetMonatAendern(info, daten) {
  return budgetAendern(info, daten);
}

/**
 * D199: Liste der Buchungen, die ein Budget verbrauchen, plus noch eingeplante Termine.
 * liste: { buchungen, termine, zeitraum }. Antippen einer Buchung schließt den Dialog und öffnet die Buchung.
 */
function budgetListe(liste, daten, schliessen) {
  if (!liste) return null;
  const kat = new Map(daten.kategorien.map((k) => [k.id, k]));
  const summe = liste.buchungen.reduce((s, b) => s + b.betragCent, 0);
  const text = (b) => [b.partner, b.art === 'umbuchung' ? 'Umbuchung' : kat.get(b.kategorieId)?.name, b.notiz].filter(Boolean).join(' · ');
  const tag = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
  const zeitraumText = liste.zeitraum.von.slice(0, 7) === liste.zeitraum.bis.slice(0, 7)
    ? 'in diesem Monat'
    : `${formatDatum(liste.zeitraum.von)} – ${formatDatum(liste.zeitraum.bis)}`;
  return h('div', { class: 'budget-liste' },
    h('div', { class: 'tag-kopf' },
      h('span', {}, `Gebucht ${zeitraumText} (${liste.buchungen.length})`),
      h('span', { class: 'tag-stand' }, formatEuro(-summe))),
    liste.buchungen.length
      ? h('ul', { class: 'liste' }, liste.buchungen.map((b) => h('li', {},
        h('button', {
          type: 'button', class: 'buchung einzeilig',
          onclick: () => { schliessen(); setTimeout(() => oeffneBuchungsdialog(b), 0); },
        },
        h('span', { class: 'buchung-text' }, h('span', { class: 'buchung-titel' },
          h('span', { class: 'datum-klein' }, tag(b.datum)), h('span', { class: 'budget-liste-text' }, text(b) || 'Buchung'))),
        h('span', { class: 'betrag' }, formatEuro(-b.betragCent))))))
      : h('p', { class: 'leer' }, 'Noch keine Buchungen.'),
    liste.termine.length > 0 && h('div', { class: 'tag-kopf' },
      h('span', {}, `Noch eingeplant (${liste.termine.length})`),
      h('span', { class: 'tag-stand' }, formatEuro(-liste.termine.reduce((s, t) => s + t.betragCent, 0)))),
    liste.termine.length > 0 && h('ul', { class: 'liste' }, liste.termine.map((t) => h('li', {},
      h('div', { class: 'buchung einzeilig geplant' },
        h('span', { class: 'buchung-text' }, h('span', { class: 'buchung-titel' },
          h('span', { class: 'datum-klein' }, tag(t.datum)),
          h('span', { class: 'budget-liste-text' }, [t.wiederkehrend.partner, t.wiederkehrend.notiz || t.wiederkehrend.bezeichnung].filter(Boolean).join(' · ') || 'Wiederkehrend'))),
        h('span', { class: 'betrag annahme' }, formatEuro(-t.betragCent)))))));
}

/** D199: Nur die Liste (z. B. bei Jahresbudgets, die man hier nicht ändert) */
export function budgetBuchungenDialog(info, daten) {
  let dlg;
  dlg = dialog({
    titel: `Budget ${info.name}`,
    inhalt: [budgetListe(info, daten, () => dlg.close())],
    speichernText: 'Schließen',
    abbrechenText: null,
    onSpeichern: () => {},
  });
  return dlg;
}

function budgetAendern(info, daten) {
  const { kategorieId, monat } = info;
  const name = daten.kategorien.find((k) => k.id === kategorieId)?.name ?? '?';
  // Nur Budgets dieses Kontos (D85)
  const passend = (daten.budgets ?? []).filter((b) => b.kategorieId === kategorieId && (!info.kontoId || b.kontoId === info.kontoId));
  const wiederkehrend = passend.find((b) => b.typ === 'wiederkehrend' && b.startMonat <= monat && (!b.endMonat || monat <= b.endMonat));
  const einmalig = passend.filter((b) => b.typ === 'einmalig' && b.monat === monat);
  const einmaligSumme = einmalig.reduce((s, b) => s + b.betragCent, 0);

  // Nur einmalige Budgets in diesem Monat: das (erste) einmalige direkt ändern
  if (!wiederkehrend) {
    const b = einmalig[0];
    if (!b) return null;
    const betrag = eingabe({ label: 'Betrag in €', inputmode: 'decimal', value: centZuEingabe(b.betragCent), class: 'eingabe-betrag', autofocus: true });
    let einDlg;
    einDlg = dialog({
      titel: `Budget ${name} – ${monatText(monat)}`,
      inhalt: [h('p', { class: 'hinweis' }, 'Einmaliges Budget für diesen Monat.' + (b.notiz ? ` (${b.notiz})` : '')), betrag.feld,
        budgetListe(info.liste, daten, () => einDlg.close())], // D199
      onSpeichern: async () => {
        const cent = parseEuro(betrag.input.value, 'Betrag');
        if (!cent || cent <= 0) throw new Error('Bitte einen Betrag größer 0 eingeben.');
        await db.speichere('budgets', { ...b, betragCent: cent, geaendertAm: new Date().toISOString() });
        toast(`Budget ${name} ${monatText(monat)}: ${formatEuro(cent)}`);
        datenGeaendert();
      },
    });
    return einDlg;
  }

  const regel = budgetRegelBetrag(wiederkehrend, monat); // inkl. fester Kalendermonat-Abweichung (D92)
  const ausnahme = (wiederkehrend.ausnahmen ?? []).find((a) => a.monat === monat);
  const betrag = eingabe({
    label: 'Monatsbudget in €',
    inputmode: 'decimal',
    value: centZuEingabe(ausnahme ? ausnahme.betragCent : regel),
    class: 'eingabe-betrag',
    autofocus: true,
    hilfe: '0 = in diesem Monat kein Budget.',
  });

  const dlg = dialog({
    titel: `Budget ${name} – ${monatText(monat)}`,
    inhalt: [
      h('p', { class: 'hinweis' },
        `Gilt nur für ${monatText(monat)}. Regulär: ${formatEuro(regel)} pro Monat. ` +
        (einmaligSumme ? `Dazu kommt ein einmaliges Budget von ${formatEuro(einmaligSumme)}. ` : '') +
        `${info.laufend ? 'Schon verbraucht und noch eingeplant' : 'Schon verplant (wiederkehrend/geplant)'}: ${formatEuro(info.verbrauchtCent)} – in der Prognose zählt nur der Rest bis zum Budget.`),
      betrag.feld,
      budgetListe(info.liste, daten, () => dlg.close()), // D199
      ausnahme && h('div', { class: 'knopfreihe' },
        h('button', {
          type: 'button',
          class: 'knopf',
          onclick: async () => {
            await db.speichere('budgets', budgetMitMonatsAusnahme(wiederkehrend, monat, null));
            dlg.close();
            toast('Zurückgesetzt auf das reguläre Budget');
            datenGeaendert();
          },
        }, 'Zurücksetzen')),
    ],
    onSpeichern: async () => {
      const cent = parseEuro(betrag.input.value, 'Betrag') ?? 0;
      await db.speichere('budgets', budgetMitMonatsAusnahme(wiederkehrend, monat, cent));
      toast(`Budget ${name} nur für ${monatText(monat)}: ${formatEuro(cent)}`);
      datenGeaendert();
    },
  });
  return dlg;
}
