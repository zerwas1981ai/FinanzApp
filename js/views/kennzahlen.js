// Übersicht (Etappe 4):
// - oben: kompakte Kennzahlen, Mindestsaldo-Warnung, Budgethinweise
// - je Konto: "Noch erwartet bis Monatsende" mit offenen wiederkehrenden Terminen und
//   den Budgets, die dieses Konto belasten – genau das, was die Prognose ausmacht.

import { h } from '../dom.js';
import * as db from '../db.js';
import { formatEuro, formatDatum, formatMonat, formatProzent, formatTag, heuteIso, istGueltigesDatum } from '../format.js';
import { dialog, eingabe, toast, datenGeaendert, auswahl } from '../ui.js';
import { plusMonate, plusTage, summenJeHauptkategorie, kennzahlKategorien } from '../prognose.js';
import { budgetMitVorschlag, haeufigstesKonto, merkeHinweis } from '../annahmen.js';
import { oeffneBuchungsdialog } from './buchung-dialog.js';
import { speichereAusnahme, aendereGeplant } from './annahmen.js';

const monatText = (m) => formatMonat(Number(m.slice(0, 4)), Number(m.slice(5, 7)));
const kurzMonat = (m) => new Intl.DateTimeFormat('de-DE', { month: 'short' }).format(new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1)).replace('.', '');
const mitVorzeichen = (cent) => (cent > 0 ? '+' : '') + formatEuro(cent);

/* =========================== Kennzahlen oben =========================== */

export function kennzahlenBereich(p, daten, heute, warnungen = p.warnungen) {
  const monat = monatText(p.monat);
  const summen = summenJeHauptkategorie(daten.buchungen, daten.kategorien, p.monat);
  const gewaehlt = kennzahlKategorien(daten.einstellungen, daten.kategorien, summen);
  // Die angezeigte Wahl immer speichern (auch die automatisch vorgeschlagene), damit beim
  // nächsten Öffnen dieselben drei Kategorien erscheinen und nichts mit den Ausgaben "wandert".
  // Ohne Neuzeichnen – es ändert sich ja nichts Sichtbares.
  const gespeichert = daten.einstellungen.find((e) => e.id === 'uebersicht')?.kategorien ?? [];
  if (gewaehlt.some((id, i) => id && id !== gespeichert[i])) {
    db.speichere('einstellungen', { id: 'uebersicht', kategorien: gewaehlt }).catch((err) => console.warn(err));
  }

  return h('section', { class: 'kennzahlen', 'aria-label': 'Kennzahlen' },
    warnungen.length > 0 && h('div', { class: 'warnkarte', role: 'status' },
      h('strong', {}, '⚠ Mindestsaldo'),
      warnungen.map((w) => h('p', {}, {
        heute: () => `${w.konto.name} liegt heute unter dem Mindestsaldo: ${formatEuro(w.standCent)} (Mindestsaldo ${formatEuro(w.konto.mindestsaldoCent)}).`,
        monatsende: () => `${w.konto.name} fällt voraussichtlich zum Monatsende (${monat}) unter den Mindestsaldo: ` +
          `Prognose ${formatEuro(w.standCent)}, Mindestsaldo ${formatEuro(w.konto.mindestsaldoCent)}.`,
        zukunft: () => `${w.konto.name} fällt voraussichtlich erstmals im ${monatText(w.monat)} unter den Mindestsaldo: ` +
          `Prognose ${formatEuro(w.standCent)}, Mindestsaldo ${formatEuro(w.konto.mindestsaldoCent)}.`,
      }[w.wann]()))),

    h('div', { class: 'bereich kz-leiste' },
      h('div', { class: 'kz' },
        h('div', { class: 'klein' }, 'Alle Konten heute'),
        h('div', { class: 'kz-wert' + (p.gesamtHeute < 0 ? ' negativ' : '') }, formatEuro(p.gesamtHeute))),
      h('div', { class: 'kz' },
        h('div', { class: 'klein' }, 'Prognose Monatsende'),
        h('div', { class: 'kz-wert annahme' + (p.gesamtPrognose < 0 ? ' negativ' : '') }, formatEuro(p.gesamtPrognose))),
      h('div', { class: 'kz' },
        h('div', { class: 'klein' }, `Einnahmen ${kurzMonat(p.monat)}`),
        h('div', { class: 'kz-wert plus' }, mitVorzeichen(p.einnahmen))),
      h('div', { class: 'kz' },
        h('div', { class: 'klein' }, `Ausgaben ${kurzMonat(p.monat)}`),
        h('div', { class: 'kz-wert' }, formatEuro(-p.ausgaben))),
      h('div', { class: 'kz-fuss' }, gewaehlt.map((id, platz) => kategorieKachel(id, platz, gewaehlt, summen, p, daten, heute)))),
  );
}

/** Eine der drei frei wählbaren Kategorien: Auswahlliste + Betrag dieses Monats (+ Budget) */
function kategorieKachel(id, platz, gewaehlt, summen, p, daten) {
  const haupt = daten.kategorien.filter((k) => !k.elternId && !k.archiviert)
    .sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }));
  const select = h('select', {
    'aria-label': `Kategorie ${platz + 1} für die Übersicht`,
    onchange: async (e) => {
      const neu = [...gewaehlt];
      neu[platz] = e.target.value;
      await db.speichere('einstellungen', { id: 'uebersicht', kategorien: neu });
      datenGeaendert();
    },
  },
  [['ausgabe', 'Ausgaben'], ['einnahme', 'Einnahmen']].map(([art, label]) => h('optgroup', { label },
    haupt.filter((k) => k.art === art).map((k) => h('option', { value: k.id }, k.name)))));
  select.value = id ?? '';

  const hk = daten.kategorien.find((k) => k.id === id);
  const betrag = summen.get(id) ?? 0;
  const budget = p.kategorien.find((z) => z.id === id)?.budget ?? null;
  const istEinnahme = hk?.art === 'einnahme';
  return h('div', { class: 'kz kz-kategorie' },
    select,
    h('div', { class: 'kz-wert' + (istEinnahme ? ' plus' : '') }, istEinnahme ? mitVorzeichen(betrag) : formatEuro(-betrag)),
    budget !== null && h('div', { class: 'klein' + (betrag > budget ? ' warn-text' : '') },
      `von ${formatEuro(budget)} Budget` + (betrag > budget ? ' – überschritten' : '')));
}

/* ================= Je Konto: noch erwartet bis Monatsende ================= */

/**
 * kd = prognose.jeKonto.get(konto.id). Zeigt offene Termine (mit Aktionen) und die
 * Budgets, die dieses Konto belasten, jeweils mit ihrer Wirkung auf die Prognose.
 */
export function erwartetBereich(kd, daten) {
  if (!kd || (kd.termine.length === 0 && kd.budgets.length === 0)) return null;
  const heute = heuteIso();
  const kat = new Map(daten.kategorien.map((k) => [k.id, k]));
  const kontoName = new Map(daten.konten.map((k) => [k.id, k.name]));

  const terminZeilen = kd.termine.map((t) => {
    const w = t.wiederkehrend;
    const zuordnung = w.art === 'umbuchung'
      ? (t.wirkung < 0 ? `Umbuchung → ${kontoName.get(w.gegenkontoId) ?? '?'}` : `Umbuchung ← ${kontoName.get(w.kontoId) ?? '?'}`)
      : (w.partner ? `${w.partner} · ` : '') + `${kat.get(kat.get(w.kategorieId)?.elternId)?.name ?? '?'} › ${kat.get(w.kategorieId)?.name ?? '?'}`;
    const status = t.datum === heute ? 'heute fällig' : t.ueberfaellig ? 'überfällig' : null;
    return h('li', {},
      h('button', { type: 'button', class: 'buchung geplant', onclick: () => terminDialog(t) },
        h('span', { class: 'buchung-text' },
          h('span', { class: 'buchung-titel' },
            h('span', { class: 'datum-klein' }, formatTag(t.datum)), w.bezeichnung,
            t.quelle === 'geplant' && h('span', { class: 'marke' }, 'einmalig'),
            status && h('span', { class: 'marke' + (t.ueberfaellig ? ' marke-warn' : '') }, status)),
          h('span', { class: 'buchung-unter' }, zuordnung + (t.verschoben ? ` · verschoben vom ${formatDatum(t.termin)}` : ''))),
        h('span', { class: 'betrag annahme' + (t.wirkung > 0 ? ' plus' : '') }, mitVorzeichen(t.wirkung))));
  });

  const budgetZeilen = kd.budgets.map((b) => {
    const ueber = b.ist > b.budget;
    const anteil = b.budget > 0 ? Math.min(1, b.ist / b.budget) : 0;
    return h('li', { class: 'budget-eintrag' },
      h('div', { class: 'budget-kopf' },
        h('span', { class: 'buchung-titel' }, `Budget ${b.name}`),
        h('span', { class: 'betrag annahme' }, b.rest > 0 ? formatEuro(-b.rest) : formatEuro(0))),
      h('div', {
        class: 'meter' + (ueber ? ' ueber' : ''),
        role: 'meter',
        'aria-valuemin': '0',
        'aria-valuemax': String(b.budget),
        'aria-valuenow': String(Math.min(b.ist, b.budget)),
        'aria-label': `${b.name}: ${formatProzent(b.ist / b.budget)} des Budgets verbraucht`,
      }, h('span', { style: `width:${anteil * 100}%` })),
      h('div', { class: 'buchung-unter' + (ueber ? ' warn-text' : '') },
        ueber
          ? `${formatEuro(b.ist)} von ${formatEuro(b.budget)} – überschritten um ${formatEuro(b.ist - b.budget)}`
          : `${formatEuro(b.ist)} von ${formatEuro(b.budget)} verbraucht` +
            (b.offen > 0 ? ` · ${formatEuro(b.offen)} wiederkehrend eingeplant` : '') +
            ` · Rest ${formatEuro(b.rest)} in der Prognose`));
  });

  return h('section', { class: 'bereich erwartet', 'aria-labelledby': 'titel-erwartet' },
    h('div', { class: 'bereich-kopf' },
      h('h2', { id: 'titel-erwartet' }, 'Noch erwartet bis Monatsende'),
      h('span', { class: 'marke annahme-marke' }, 'Annahme')),
    terminZeilen.length > 0 && h('div', {},
      h('div', { class: 'tag-kopf' }, h('span', {}, 'Wiederkehrende und geplante Buchungen'), h('span', { class: 'tag-stand annahme' }, mitVorzeichen(kd.offenWirkung))),
      h('ul', { class: 'liste' }, terminZeilen)),
    budgetZeilen.length > 0 && h('div', {},
      h('div', { class: 'tag-kopf' }, h('span', {}, 'Budgets (belasten dieses Konto)'), h('span', { class: 'tag-stand annahme' }, formatEuro(-kd.rest))),
      h('ul', { class: 'liste' }, budgetZeilen)),
  );
}

/**
 * Kleiner Dialog für einen offenen Posten: Buchen, Verschieben oder Überspringen.
 * t.quelle: 'wiederkehrend' (Termin einer wiederkehrenden Buchung) oder 'geplant' (Einmalbuchung).
 */
function terminDialog(t) {
  const w = t.wiederkehrend;
  const istGeplant = t.quelle === 'geplant';
  const betrag = w.art === 'umbuchung' ? formatEuro(t.betragCent) : mitVorzeichen(w.art === 'einnahme' ? t.betragCent : -t.betragCent);
  let dlg;
  const verschieben = h('button', { type: 'button', class: 'knopf', onclick: () => { dlg.close(); verschiebenDialog(t); } }, 'Verschieben');
  const ueberspringen = h('button', {
    type: 'button',
    class: 'knopf',
    onclick: async () => {
      if (istGeplant) {
        await aendereGeplant(w, { erledigtAm: new Date().toISOString() });
        toast(`${w.bezeichnung} als schon gebucht markiert (rückgängig unter Annahmen)`);
      } else {
        await speichereAusnahme(w, t.termin, 'ueberspringen');
        toast(`${w.bezeichnung} am ${formatDatum(t.termin)} übersprungen (rückgängig unter Annahmen)`);
      }
      dlg.close();
      datenGeaendert();
    },
  }, istGeplant ? 'Schon gebucht' : 'Überspringen');

  dlg = dialog({
    titel: w.bezeichnung,
    inhalt: [
      h('p', {}, `${betrag} · fällig ${t.datum === t.termin ? 'am' : 'verschoben auf'} ${formatDatum(t.datum)}`),
      h('p', { class: 'hinweis' }, istGeplant
        ? 'Geplante Einmalbuchung. „Buchen“ öffnet den vorausgefüllten Buchungsdialog – den Betrag kannst du dort anpassen. ' +
          '„Schon gebucht“ wählst du, wenn du sie bereits von Hand erfasst hast' +
          (w.projektId ? ' (ordne diese Buchung dann bitte selbst dem Projekt zu).' : '.')
        : '„Buchen“ öffnet den vorausgefüllten Buchungsdialog. „Überspringen“ passt auch, wenn du die Buchung schon von Hand erfasst hast.'),
      h('div', { class: 'knopfreihe' }, verschieben, ueberspringen),
    ],
    speichernText: 'Buchen',
    onSpeichern: () => {
      setTimeout(() => oeffneBuchungsdialog(null, {
        titel: `Buchen: ${w.bezeichnung}`,
        art: w.art,
        betragCent: t.betragCent,
        kontoId: w.kontoId,
        gegenkontoId: w.gegenkontoId,
        kategorieId: w.kategorieId,
        datum: t.datum,
        notiz: w.bezeichnung,
        partner: w.partner ?? '',
        ...(istGeplant ? { geplantId: w.id, projektId: w.projektId ?? null } : { wiederkehrendId: w.id, faelligAm: t.termin }),
      }), 0);
    },
  });
}

function verschiebenDialog(t) {
  const w = t.wiederkehrend;
  const datum = eingabe({ label: 'Neues Datum', type: 'date', value: plusTage(t.datum, 1) });
  dialog({
    titel: `${w.bezeichnung} verschieben`,
    inhalt: [h('p', { class: 'hinweis' }, t.quelle === 'geplant'
      ? `Bisher geplant am ${formatDatum(t.datum)}.`
      : `Regulärer Termin: ${formatDatum(t.termin)}. Nur dieser eine Termin wird verschoben.`), datum.feld],
    speichernText: 'Verschieben',
    onSpeichern: async () => {
      if (!istGueltigesDatum(datum.input.value)) throw new Error('Bitte ein gültiges Datum wählen.');
      if (t.quelle === 'geplant') await aendereGeplant(w, { datum: datum.input.value });
      else await speichereAusnahme(w, t.termin, 'verschieben', datum.input.value);
      toast(`Verschoben auf ${formatDatum(datum.input.value)}`);
      datenGeaendert();
    },
  });
}

/* =========================== Budgethinweise =========================== */

export function hinweisBereich(hinweise, daten) {
  if (hinweise.length === 0) return null;
  const heute = heuteIso();
  const aktuell = heute.slice(0, 7);

  return h('div', { class: 'hinweiskarten' }, hinweise.slice(0, 2).map((x) => {
    const n = x.zeilen.length;
    const prozent = formatProzent(Math.abs(x.abweichung));
    const ab = auswahl({
      label: 'Übernehmen ab',
      optionen: [
        { wert: plusMonate(aktuell, 1), text: `ab ${monatText(plusMonate(aktuell, 1))}` },
        { wert: aktuell, text: `ab ${monatText(aktuell)} (dieser Monat)` },
        { wert: plusMonate(aktuell, 2), text: `ab ${monatText(plusMonate(aktuell, 2))}` },
      ],
      wert: plusMonate(aktuell, 1),
    });
    ab.select.setAttribute('aria-label', 'Übernehmen ab Monat');

    const gleichesBudget = x.zeilen.every((z) => z.budget === x.zeilen[0].budget);
    const verlauf = x.zeilen.map((z) => `${kurzMonat(z.monat)} ${formatEuro(z.ist)}` + (gleichesBudget ? '' : ` (Budget ${formatEuro(z.budget)})`)).join(' · ');

    return h('section', { class: 'bereich hinweiskarte', 'aria-label': `Budgethinweis ${x.kategorie.name}` },
      h('h2', {}, h('span', { class: 'klein' }, 'Budgethinweis · '), x.kategorie.name),
      h('p', {},
        `${n} Monate in Folge ${x.richtung === 'ueber' ? 'über' : 'unter'} Budget, im Schnitt um ${prozent}: ${verlauf}` +
        (gleichesBudget ? ` bei ${formatEuro(x.zeilen[0].budget)} Budget.` : '.')),
      h('p', {}, h('strong', {}, 'Vorschlag: '),
        `${formatEuro(x.aktuellesBudgetCent || x.zeilen.at(-1).budget)} → ${formatEuro(x.vorschlagCent)} `,
        h('span', { class: 'klein' }, '(Ø der Ausgaben, auf 10 € gerundet)')),
      h('div', { class: 'hinweis-aktionen' },
        ab.select,
        h('button', {
          type: 'button',
          class: 'knopf knopf-primaer',
          onclick: async () => {
            const budgets = await db.alle('budgets');
            const kontoId = budgets.find((b) => b.typ === 'wiederkehrend' && b.kategorieId === x.kategorie.id)?.kontoId
              ?? haeufigstesKonto(x.kategorie.id, daten.kategorien, daten.buchungen, daten.konten);
            await db.speichere('budgets', budgetMitVorschlag(budgets, {
              kategorieId: x.kategorie.id, abMonat: ab.select.value, betragCent: x.vorschlagCent, kontoId,
            }));
            await merkeHinweis(x, 'uebernommen');
            toast(`Budget ${x.kategorie.name} ab ${monatText(ab.select.value)}: ${formatEuro(x.vorschlagCent)}`);
            datenGeaendert();
          },
        }, 'Übernehmen'),
        h('button', {
          type: 'button',
          class: 'knopf',
          onclick: async () => {
            await merkeHinweis(x, 'abgelehnt');
            toast('Hinweis abgelehnt');
            datenGeaendert();
          },
        }, 'Ablehnen'),
        h('button', {
          type: 'button',
          class: 'knopf',
          onclick: async () => {
            await merkeHinweis(x, 'spaeter', plusTage(heute, 7));
            toast('Ich erinnere dich in einer Woche.');
            datenGeaendert();
          },
        }, 'Später')));
  }));
}
