// Tab "Annahmen": Budgets und wiederkehrende Buchungen (Etappe 4), geplante
// Einmalbuchungen (Etappe 5). Jede Annahme hat einen Ein/Aus-Schalter.
// Geplante Einmalbuchungen können einem Projekt zugeordnet werden (Tab "Projekte").

import { h } from '../dom.js';
import { sortiereKonten } from '../konten.js';
import * as db from '../db.js';
import { formatEuro, formatDatum, formatMonat, centZuEingabe, parseEuro, heuteIso } from '../format.js';
import { dialog, frage, toast, eingabe, auswahl, datenGeaendert } from '../ui.js';
import { baueBudget, baueWiederkehrend, baueGeplant, geplantErledigt, haeufigstesKonto, mitAusnahme } from '../annahmen.js';
import { budgetFuerMonat, betragAm, naechsterTermin, plusMonate, monatsende } from '../prognose.js';
import { artWahl, fuelleKategorien, projektFeld, oeffneBuchungsdialog, partnerFeld } from './buchung-dialog.js';

const nachName = (a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' });
const INTERVALL_TEXT = { monatlich: 'monatlich', vierteljaehrlich: 'vierteljährlich', jaehrlich: 'jährlich' };
const monatText = (m) => formatMonat(Number(m.slice(0, 4)), Number(m.slice(5, 7)));

export async function zeigeAnnahmen(container) {
  const namen = ['konten', 'kategorien', 'buchungen', 'budgets', 'wiederkehrend', 'geplant', 'projekte'];
  const werte = await Promise.all(namen.map((n) => db.alle(n)));
  const daten = Object.fromEntries(namen.map((n, i) => [n, werte[i]]));

  container.replaceChildren(
    h('h1', { class: 'seitentitel' }, 'Annahmen'),
    h('p', { class: 'hinweis' },
      'Hier legst du fest, womit die App für die Zukunft rechnet. Alles sind feste Beträge – ' +
      'keine Prozent-Steigerungen. Nichts davon wird automatisch gebucht. Mit dem Häkchen links ' +
      'schaltest du einen Posten für die Prognose ein oder aus, ohne ihn zu löschen.'),
    budgetBereich(daten),
    wiederkehrendBereich(daten),
    geplantBereich(daten),
  );
}

/** Listenzeile mit Ein/Aus-Häkchen links; das Häkchen speichert sofort (Feld "aktiv") */
export function zeileMitSchalter(eintrag, sammlung, knopf, beschriftung = 'In der Prognose berücksichtigen') {
  const an = eintrag.aktiv !== false;
  return h('li', { class: 'annahme-zeile' + (an ? '' : ' aus') },
    h('label', { class: 'annahme-schalter', title: beschriftung },
      h('input', {
        type: 'checkbox',
        checked: an,
        'aria-label': beschriftung,
        onchange: async (e) => {
          await db.speichere(sammlung, { ...eintrag, aktiv: e.target.checked, geaendertAm: new Date().toISOString() });
          toast(e.target.checked ? 'Eingeschaltet' : 'Ausgeschaltet – zählt nicht mehr in der Prognose');
          datenGeaendert();
        },
      })),
    knopf);
}

/** Kleine Marke mit dem Projekt-Namen */
function projektMarke(eintrag, projekte) {
  const p = eintrag.projektId && projekte.find((x) => x.id === eintrag.projektId);
  return p && h('span', { class: 'marke marke-projekt' }, `Projekt: ${p.name}`);
}

/* =========================== Budgets =========================== */

function budgetBereich(daten) {
  const { budgets, kategorien, konten } = daten;
  const monat = heuteIso().slice(0, 7);
  const kat = new Map(kategorien.map((k) => [k.id, k]));
  const kontoName = new Map(konten.map((k) => [k.id, k.name]));
  const sortiert = [...budgets].sort((a, b) =>
    (kat.get(a.kategorieId)?.name ?? '').localeCompare(kat.get(b.kategorieId)?.name ?? '', 'de')
    || (kontoName.get(a.kontoId) ?? '').localeCompare(kontoName.get(b.kontoId) ?? '', 'de')
    || (a.typ === 'einmalig') - (b.typ === 'einmalig')
    || (a.monat ?? '').localeCompare(b.monat ?? ''));

  const summeMonat = [...new Set(budgets.map((b) => b.kategorieId))]
    .reduce((s, id) => s + budgetFuerMonat(budgets, id, monat).betragCent, 0);

  return h('section', { class: 'bereich', 'aria-labelledby': 'titel-budgets' },
    h('div', { class: 'bereich-kopf' },
      h('h2', { id: 'titel-budgets' }, 'Budgets'),
      h('button', { type: 'button', class: 'knopf knopf-primaer', onclick: () => budgetDialog(null, daten) }, '+ Budget')),
    h('p', { class: 'hinweis' },
      'Ein Budget gilt je Hauptkategorie, Konto und Monat. Nur Ausgaben der Unterkategorien auf diesem Konto ' +
      'verbrauchen es, ein Rest verfällt am Monatsende. Einmalige Budgets kommen im jeweiligen Monat dazu.'),
    sortiert.length === 0
      ? h('p', { class: 'leer' }, 'Noch keine Budgets.')
      : h('ul', { class: 'liste' }, sortiert.map((b) => {
        const name = kat.get(b.kategorieId)?.name ?? 'Unbekannte Kategorie';
        let info;
        let betrag;
        let zusatz = null;
        let beendet = false;
        if (b.typ === 'einmalig') {
          info = `Einmalig · ${monatText(b.monat)} · ${kontoName.get(b.kontoId) ?? '?'}`;
          betrag = formatEuro(b.betragCent);
          beendet = b.monat < monat;
        } else {
          const bis = b.endMonat ? ` bis ${monatText(b.endMonat)}` : '';
          info = `Jeden Monat · ab ${monatText(b.startMonat)}${bis} · ${kontoName.get(b.kontoId) ?? '?'}`;
          betrag = `${formatEuro(betragAm(b.stufen, b.startMonat > monat ? b.startMonat : monat))} / Monat`;
          const kuenftig = b.stufen.filter((s) => s.ab > monat);
          if (kuenftig.length) zusatz = kuenftig.map((s) => `ab ${monatText(s.ab)}: ${formatEuro(s.betragCent)}`).join(' · ');
          beendet = Boolean(b.endMonat && b.endMonat < monat);
        }
        return zeileMitSchalter(b, 'budgets',
          h('button', { type: 'button', class: 'buchung' + (beendet ? ' archiviert' : ''), onclick: () => budgetDialog(b, daten) },
            h('span', { class: 'buchung-text' },
              h('span', { class: 'buchung-titel' }, name, beendet && h('span', { class: 'marke' }, 'abgelaufen')),
              h('span', { class: 'buchung-unter' }, info),
              zusatz && h('span', { class: 'buchung-unter annahme' }, zusatz)),
            h('span', { class: 'betrag' }, betrag)));
      })),
    budgets.length > 0 && h('div', { class: 'summe ergebnis' },
      h('span', {}, `Budgets ${monatText(monat)} zusammen`), h('span', { class: 'betrag' }, formatEuro(summeMonat))),
  );
}

function budgetDialog(budget, daten) {
  const { kategorien, konten, buchungen, budgets } = daten;
  const heute = heuteIso();
  const haupt = kategorien
    .filter((k) => !k.elternId && k.art === 'ausgabe' && (!k.archiviert || k.id === budget?.kategorieId))
    .sort(nachName);
  const aktiveKonten = sortiereKonten(konten.filter((k) => !k.archiviert || k.id === budget?.kontoId));
  if (!haupt.length || !aktiveKonten.length) {
    toast('Dafür brauchst du mindestens ein Konto und eine Ausgaben-Kategorie.');
    return;
  }

  let typ = budget?.typ ?? 'wiederkehrend';
  const typWahl = segmente(
    budget ? [[budget.typ, budget.typ === 'einmalig' ? 'Einmalig' : 'Jeden Monat']] : [['wiederkehrend', 'Jeden Monat'], ['einmalig', 'Einmalig']],
    typ, (w) => { typ = w; aktualisiere(); }, 'Art des Budgets');

  const kat = auswahl({
    label: 'Hauptkategorie',
    optionen: haupt.map((k) => ({ wert: k.id, text: k.name })),
    wert: budget?.kategorieId ?? haupt[0].id,
  });
  const konto = auswahl({
    label: 'Belastet Konto',
    optionen: aktiveKonten.map((k) => ({ wert: k.id, text: k.name })),
    wert: budget?.kontoId ?? haeufigstesKonto(kat.select.value, kategorien, buchungen, konten),
    hilfe: 'Nur Ausgaben auf diesem Konto verbrauchen das Budget. Der noch offene Rest geht in der Prognose von diesem Konto ab.',
  });
  if (!budget) {
    kat.select.addEventListener('change', () => {
      konto.select.value = haeufigstesKonto(kat.select.value, kategorien, buchungen, konten) ?? konto.select.value;
    });
  }

  // Jeden Monat
  const start = eingabe({ label: 'Ab Monat', type: 'month', value: budget?.startMonat ?? heute.slice(0, 7) });
  const ende = eingabe({ label: 'Bis Monat (optional)', type: 'month', value: budget?.endMonat ?? '' });
  const stufen = stufenEditor({ typ: 'month', stufen: budget?.typ === 'wiederkehrend' ? budget.stufen : [], label: 'Betrag pro Monat' });
  // Einmalig
  const monat = eingabe({ label: 'Monat', type: 'month', value: budget?.monat ?? plusMonate(heute.slice(0, 7), 1) });
  const betrag = eingabe({ label: 'Betrag in €', inputmode: 'decimal', placeholder: '0,00', value: budget?.typ === 'einmalig' ? centZuEingabe(budget.betragCent) : '' });

  const wiederkehrendFelder = h('div', {}, h('div', { class: 'feld-paar' }, start.feld, ende.feld), stufen.feld);
  const einmaligFelder = h('div', {}, h('div', { class: 'feld-paar' }, monat.feld, betrag.feld));
  function aktualisiere() {
    wiederkehrendFelder.hidden = typ !== 'wiederkehrend';
    einmaligFelder.hidden = typ !== 'einmalig';
  }
  aktualisiere();

  dialog({
    titel: budget ? 'Budget bearbeiten' : 'Neues Budget',
    inhalt: [typWahl, kat.feld, wiederkehrendFelder, einmaligFelder, konto.feld],
    zusatz: budget && {
      text: 'Löschen',
      variante: 'knopf-gefahr',
      onclick: async (d) => {
        const ok = await frage({ titel: 'Budget löschen?', text: 'Das Budget wird endgültig gelöscht. Buchungen bleiben unverändert.', jaText: 'Löschen', gefahr: true });
        if (!ok) return;
        await db.loesche('budgets', budget.id);
        d.close();
        toast('Budget gelöscht');
        datenGeaendert();
      },
    },
    onSpeichern: async () => {
      const basis = { typ, kategorieId: kat.select.value, kontoId: konto.select.value };
      const werte = typ === 'einmalig'
        ? { ...basis, monat: monat.input.value, betragCent: parseEuro(betrag.input.value, 'Betrag') }
        : { ...basis, startMonat: start.input.value, endMonat: ende.input.value, stufen: stufen.werte() };
      await db.speichere('budgets', baueBudget(werte, { kategorien, budgets, alt: budget }));
      toast(budget ? 'Budget gespeichert' : 'Budget angelegt');
      datenGeaendert();
    },
  });
}

/* ===================== Wiederkehrende Buchungen ===================== */

function wiederkehrendBereich(daten) {
  const { wiederkehrend, kategorien, konten } = daten;
  const heute = heuteIso();
  const kat = new Map(kategorien.map((k) => [k.id, k]));
  const kontoName = new Map(konten.map((k) => [k.id, k.name]));
  const reihenfolge = { einnahme: 0, ausgabe: 1, umbuchung: 2 };
  const sortiert = [...wiederkehrend].sort((a, b) => reihenfolge[a.art] - reihenfolge[b.art]
    || a.bezeichnung.localeCompare(b.bezeichnung, 'de', { sensitivity: 'base' }));

  return h('section', { class: 'bereich', 'aria-labelledby': 'titel-wiederkehrend' },
    h('div', { class: 'bereich-kopf' },
      h('h2', { id: 'titel-wiederkehrend' }, 'Wiederkehrende Buchungen'),
      h('button', { type: 'button', class: 'knopf knopf-primaer', onclick: () => wiederkehrendDialog(null, daten) }, '+ Wiederkehrend')),
    h('p', { class: 'hinweis' },
      'Fällige Termine erscheinen in der Übersicht. Erst wenn du dort auf „Buchen“ tippst, entsteht eine echte Buchung.'),
    sortiert.length === 0
      ? h('p', { class: 'leer' }, 'Noch keine wiederkehrenden Buchungen.')
      : h('ul', { class: 'liste' }, sortiert.map((w) => {
        const naechster = naechsterTermin(w, heute);
        const beendet = !naechster;
        let zuordnung;
        if (w.art === 'umbuchung') zuordnung = `${kontoName.get(w.kontoId) ?? '?'} → ${kontoName.get(w.gegenkontoId) ?? '?'}`;
        else {
          const unter = kat.get(w.kategorieId);
          zuordnung = [kontoName.get(w.kontoId) ?? '?', w.partner, `${kat.get(unter?.elternId)?.name ?? '?'} › ${unter?.name ?? '?'}`].filter(Boolean).join(' · ');
        }
        const info = [
          INTERVALL_TEXT[w.intervall] + (w.monatsletzter ? ' zum Monatsletzten' : ''),
          naechster ? `nächster Termin ${formatDatum(naechster.datum)}` : 'keine weiteren Termine',
          zuordnung,
        ].join(' · ');
        const cent = naechster?.betragCent ?? betragAm(w.stufen, heute);
        const text = w.art === 'umbuchung' ? formatEuro(cent) : (w.art === 'einnahme' ? '+' : '') + formatEuro(w.art === 'ausgabe' ? -cent : cent);
        return zeileMitSchalter(w, 'wiederkehrend',
          h('button', { type: 'button', class: 'buchung' + (beendet ? ' archiviert' : ''), onclick: () => wiederkehrendDialog(w, daten) },
            h('span', { class: 'buchung-text' },
              h('span', { class: 'buchung-titel' }, w.bezeichnung, beendet && h('span', { class: 'marke' }, 'beendet')),
              h('span', { class: 'buchung-unter' }, info)),
            h('span', { class: 'betrag ' + (w.art === 'einnahme' ? 'plus' : w.art === 'umbuchung' ? 'gedaempft' : '') }, text)));
      })),
  );
}

/**
 * Dialog für eine wiederkehrende Buchung. daten braucht konten, kategorien, buchungen.
 * vorgaben (nur neu, D71): z. B. aus einer echten Buchung übernommen –
 *   { art, bezeichnung, partner, betragCent, kontoId, gegenkontoId, kategorieId, start, monatsletzter, titel }
 */
export function wiederkehrendDialog(w, daten, vorgaben = {}) {
  const { konten, kategorien } = daten;
  const heute = heuteIso();
  const v = w ?? vorgaben;
  const waehlbar = sortiereKonten(konten.filter((k) => !k.archiviert || k.id === v.kontoId || k.id === v.gegenkontoId));
  if (!waehlbar.length) {
    toast('Bitte zuerst unter Stammdaten ein Konto anlegen.');
    return;
  }
  let art = v.art ?? 'ausgabe';
  let ausnahmen = [...(w?.ausnahmen ?? [])];

  const bezeichnung = eingabe({ label: 'Bezeichnung', value: v.bezeichnung ?? '', maxlength: 60, placeholder: 'z. B. Miete', autofocus: true });
  const partner = partnerFeld(daten.buchungen ?? [], v.partner ?? '', art);
  const artKnoepfe = artWahl(null, art, (neu) => { art = neu; aktualisiere(); });
  const stufen = stufenEditor({
    typ: 'date',
    stufen: w?.stufen ?? (vorgaben.betragCent ? [{ ab: '', betragCent: vorgaben.betragCent }] : []),
    label: 'Betrag',
  });
  const kategorie = auswahl({ label: 'Kategorie', optionen: [] });
  const kontoOptionen = waehlbar.map((k) => ({ wert: k.id, text: k.name }));
  const konto = auswahl({ label: 'Konto', optionen: kontoOptionen, wert: v.kontoId ?? waehlbar[0].id });
  const gegenkonto = auswahl({ label: 'Auf Konto', optionen: kontoOptionen, wert: v.gegenkontoId ?? waehlbar.find((k) => k.id !== konto.select.value)?.id });
  const intervall = auswahl({
    label: 'Intervall',
    optionen: Object.entries(INTERVALL_TEXT).map(([wert, text]) => ({ wert, text: text[0].toUpperCase() + text.slice(1) })),
    wert: v.intervall ?? 'monatlich',
  });
  // Standard für neue Einträge: immer am Monatsletzten (Wunsch des Nutzers) – außer die Vorgabe sagt anderes
  const istMonatsletzter = w ? Boolean(w.monatsletzter) : (vorgaben.monatsletzter ?? true);
  const start = eingabe({
    label: 'Erster Termin',
    type: 'date',
    value: v.start ?? monatsende(heute),
    hilfe: 'Ohne Häkchen gilt der Tag dieses Datums für alle Termine (31. → Monatsletzter).',
  });
  const ende = eingabe({ label: 'Letzter Termin (optional)', type: 'date', value: w?.ende ?? '' });
  const monatsletzter = h('input', {
    type: 'checkbox',
    checked: istMonatsletzter,
    onchange: () => {
      if (monatsletzter.checked && start.input.value) start.input.value = monatsende(start.input.value);
    },
  });
  // Wer bewusst einen anderen Tag wählt, schaltet "Monatsletzter" damit ab
  start.input.addEventListener('change', () => {
    if (start.input.value && start.input.value !== monatsende(start.input.value)) monatsletzter.checked = false;
  });
  const monatsletzterFeld = h('label', { class: 'schalter feld-schalter' }, monatsletzter, 'Immer am Monatsletzten');

  const ausnahmenListe = h('div', { class: 'feld' });
  function zeigeAusnahmen() {
    ausnahmenListe.hidden = ausnahmen.length === 0;
    ausnahmenListe.replaceChildren(
      h('span', { class: 'feld-label' }, 'Einzeln geänderte Termine'),
      h('ul', { class: 'liste' }, ausnahmen.map((a) => h('li', { class: 'ausnahme' },
        h('span', {}, {
          ueberspringen: () => `${formatDatum(a.termin)} übersprungen`,
          verschieben: () => `${formatDatum(a.termin)} → ${formatDatum(a.neuesDatum)} verschoben`,
          aendern: () => `${formatDatum(a.termin)}: ${formatEuro(a.betragCent)}` +
            (a.neuesDatum && a.neuesDatum !== a.termin ? ` am ${formatDatum(a.neuesDatum)}` : ''),
        }[a.aktion]?.() ?? formatDatum(a.termin)),
        h('button', {
          type: 'button',
          class: 'knopf knopf-klein',
          onclick: () => { ausnahmen = ausnahmen.filter((x) => x !== a); zeigeAusnahmen(); },
        }, 'Zurücknehmen')))));
  }
  zeigeAusnahmen();

  function aktualisiere() {
    const istUmbuchung = art === 'umbuchung';
    kategorie.feld.hidden = istUmbuchung;
    partner.setzeArt(art);
    gegenkonto.feld.hidden = !istUmbuchung;
    konto.feld.querySelector('label').textContent = istUmbuchung ? 'Von Konto' : 'Konto';
    if (!istUmbuchung) fuelleKategorien(kategorie.select, kategorien, art, v.kategorieId);
  }
  aktualisiere();

  dialog({
    titel: w ? 'Wiederkehrende Buchung bearbeiten' : (vorgaben.titel ?? 'Neue wiederkehrende Buchung'),
    inhalt: [
      artKnoepfe, bezeichnung.feld, stufen.feld, partner.feld, kategorie.feld, konto.feld, gegenkonto.feld,
      intervall.feld, monatsletzterFeld, h('div', { class: 'feld-paar' }, start.feld, ende.feld), ausnahmenListe,
    ],
    zusatz: w && {
      text: 'Löschen',
      variante: 'knopf-gefahr',
      onclick: async (d) => {
        const ok = await frage({
          titel: 'Wiederkehrende Buchung löschen?',
          text: ['Künftige Termine entfallen. Bereits gebuchte Buchungen bleiben erhalten.', 'Tipp: Mit „Letzter Termin“ lässt sie sich auch einfach beenden.'],
          jaText: 'Löschen',
          gefahr: true,
        });
        if (!ok) return;
        await db.loesche('wiederkehrend', w.id);
        d.close();
        toast('Wiederkehrende Buchung gelöscht');
        datenGeaendert();
      },
    },
    onSpeichern: async () => {
      const datensatz = baueWiederkehrend({
        bezeichnung: bezeichnung.input.value,
        art,
        kontoId: konto.select.value,
        gegenkontoId: gegenkonto.select.value,
        kategorieId: kategorie.select.value,
        intervall: intervall.select.value,
        start: start.input.value,
        monatsletzter: monatsletzter.checked,
        ende: ende.input.value,
        stufen: stufen.werte(),
        partner: partner.input.value,
      }, { konten, kategorien, alt: w });
      await db.speichere('wiederkehrend', { ...datensatz, ausnahmen });
      toast(w ? 'Gespeichert' : 'Wiederkehrende Buchung angelegt');
      datenGeaendert();
    },
  });
}

/* ===================== Geplante Einmalbuchungen ===================== */

function geplantBereich(daten) {
  const { geplant, kategorien, konten, buchungen } = daten;
  const heute = heuteIso();
  const kat = new Map(kategorien.map((k) => [k.id, k]));
  const kontoName = new Map(konten.map((k) => [k.id, k.name]));
  const mitStatus = geplant.map((g) => ({ g, erledigt: geplantErledigt(g, buchungen) }));
  // Sichtbar: offene ab heute. Erledigte und alles mit Datum vor heute ist eingeklappt (D53) –
  // noch nicht gebuchte vergangene stehen weiter beim Konto unter „Noch erwartet“.
  const offen = mitStatus.filter((x) => !x.erledigt && x.g.datum >= heute).sort((a, b) => a.g.datum.localeCompare(b.g.datum));
  const erledigt = mitStatus.filter((x) => x.erledigt || x.g.datum < heute).sort((a, b) => b.g.datum.localeCompare(a.g.datum));

  const zeile = ({ g, erledigt: e }) => {
    const zuordnung = g.art === 'umbuchung'
      ? `${kontoName.get(g.kontoId) ?? '?'} → ${kontoName.get(g.gegenkontoId) ?? '?'}`
      : [kontoName.get(g.kontoId) ?? '?', g.partner, `${kat.get(kat.get(g.kategorieId)?.elternId)?.name ?? '?'} › ${kat.get(g.kategorieId)?.name ?? '?'}`].filter(Boolean).join(' · ');
    let status = null;
    if (e && e !== true) status = h('span', { class: 'marke' }, `erledigt: gebucht am ${formatDatum(e.datum)}`);
    else if (e) status = h('span', { class: 'marke' }, 'erledigt');
    else if (g.datum < heute) status = h('span', { class: 'marke marke-warn' }, 'überfällig');
    const text = g.art === 'umbuchung' ? formatEuro(g.betragCent) : (g.art === 'einnahme' ? '+' : '') + formatEuro(g.art === 'ausgabe' ? -g.betragCent : g.betragCent);
    return zeileMitSchalter(g, 'geplant',
      h('button', { type: 'button', class: 'buchung' + (e ? ' archiviert' : ''), onclick: () => geplantDialog(g, daten) },
        h('span', { class: 'buchung-text' },
          h('span', { class: 'buchung-titel' }, g.bezeichnung, status, projektMarke(g, daten.projekte)),
          h('span', { class: 'buchung-unter' }, `${formatDatum(g.datum)} · ${zuordnung}`)),
        h('span', { class: 'betrag ' + (e ? '' : 'annahme ') + (g.art === 'einnahme' ? 'plus' : g.art === 'umbuchung' ? 'gedaempft' : '') }, text)));
  };

  return h('section', { class: 'bereich', 'aria-labelledby': 'titel-geplant' },
    h('div', { class: 'bereich-kopf' },
      h('h2', { id: 'titel-geplant' }, 'Geplante Einmalbuchungen'),
      h('button', { type: 'button', class: 'knopf knopf-primaer', onclick: () => geplantDialog(null, daten) }, '+ Geplant')),
    h('p', { class: 'hinweis' },
      'Bekannte, einmalige Zahlungen (z. B. Autoreparatur, Steuererstattung). Wird sie fällig, erscheint sie beim Konto unter ' +
      '„Noch erwartet“ – dort buchst du sie oder markierst sie als schon gebucht. So zählt sie nie doppelt.'),
    offen.length === 0
      ? h('p', { class: 'leer' }, erledigt.length ? 'Keine anstehenden geplanten Einmalbuchungen.' : 'Noch keine geplanten Einmalbuchungen.')
      : h('ul', { class: 'liste' }, offen.map(zeile)),
    erledigt.length > 0 && h('details', { class: 'erledigt-liste' },
      h('summary', {}, `Vergangene und erledigte anzeigen (${erledigt.length})`),
      h('ul', { class: 'liste' }, erledigt.map(zeile))),
  );
}

/**
 * Dialog für eine geplante Einmalbuchung. daten braucht konten, kategorien, buchungen, projekte.
 * vorgaben (nur neu): { projektId } – z. B. aus dem Tab "Projekte"
 */
export function geplantDialog(g, daten, vorgaben = {}) {
  const { konten, kategorien, buchungen } = daten;
  const heute = heuteIso();
  const waehlbar = sortiereKonten(konten.filter((k) => !k.archiviert || k.id === g?.kontoId || k.id === g?.gegenkontoId));
  if (!waehlbar.length) {
    toast('Bitte zuerst unter Stammdaten ein Konto anlegen.');
    return;
  }
  let art = g?.art ?? 'ausgabe';
  const erledigt = g ? geplantErledigt(g, buchungen) : false;

  const artKnoepfe = artWahl(null, art, (neu) => { art = neu; aktualisiere(); });
  const bezeichnung = eingabe({ label: 'Bezeichnung', value: g?.bezeichnung ?? '', maxlength: 60, placeholder: 'z. B. Autoreparatur', autofocus: true });
  const partner = partnerFeld(buchungen, g?.partner ?? '', art);
  const betrag = eingabe({ label: 'Betrag in €', inputmode: 'decimal', placeholder: '0,00', value: g ? centZuEingabe(g.betragCent) : '', class: 'eingabe-betrag' });
  const kategorie = auswahl({ label: 'Kategorie', optionen: [] });
  const kontoOptionen = waehlbar.map((k) => ({ wert: k.id, text: k.name }));
  const konto = auswahl({ label: 'Konto', optionen: kontoOptionen, wert: g?.kontoId ?? waehlbar[0].id });
  const gegenkonto = auswahl({ label: 'Auf Konto', optionen: kontoOptionen, wert: g?.gegenkontoId ?? waehlbar.find((k) => k.id !== konto.select.value)?.id });
  const datum = eingabe({ label: 'Geplant am', type: 'date', value: g?.datum ?? plusMonate(heute.slice(0, 7), 1) + '-01' });
  const projekt = projektFeld(daten.projekte ?? [], g?.projektId ?? vorgaben.projektId ?? null);

  function aktualisiere() {
    const istUmbuchung = art === 'umbuchung';
    kategorie.feld.hidden = istUmbuchung;
    partner.setzeArt(art);
    if (projekt) projekt.feld.hidden = istUmbuchung;
    gegenkonto.feld.hidden = !istUmbuchung;
    konto.feld.querySelector('label').textContent = istUmbuchung ? 'Von Konto' : 'Konto';
    if (!istUmbuchung) fuelleKategorien(kategorie.select, kategorien, art, g?.kategorieId);
  }
  aktualisiere();

  // Status-Hinweis und "wieder offen" für per Hand als erledigt markierte
  const statusInfo = erledigt && h('div', { class: 'feld' },
    h('p', { class: 'hinweis' }, erledigt === true
      ? 'Als „schon gebucht“ markiert – zählt nicht mehr in der Prognose.'
      : `Erledigt durch die Buchung vom ${formatDatum(erledigt.datum)} (${formatEuro(erledigt.betragCent)}). Wird diese gelöscht, ist die Planung wieder offen.`),
    erledigt === true && h('button', {
      type: 'button',
      class: 'knopf knopf-klein',
      onclick: async (e) => {
        await db.speichere('geplant', { ...g, erledigtAm: null, geaendertAm: new Date().toISOString() });
        e.target.closest('dialog').close();
        toast('Wieder offen');
        datenGeaendert();
      },
    }, 'Wieder als offen markieren'));

  // Offene Planung direkt in eine echte Buchung umwandeln – Betrag und Datum im Buchungsdialog anpassbar
  const buchenKnopf = g && !erledigt && h('div', { class: 'feld' },
    h('button', {
      type: 'button',
      class: 'knopf knopf-klein',
      onclick: (e) => {
        e.target.closest('dialog').close();
        setTimeout(() => oeffneBuchungsdialog(null, {
          titel: `Buchen: ${g.bezeichnung}`,
          art: g.art,
          betragCent: g.betragCent,
          kontoId: g.kontoId,
          gegenkontoId: g.gegenkontoId,
          kategorieId: g.kategorieId,
          datum: g.datum <= heute ? g.datum : heute,
          notiz: g.bezeichnung,
          partner: g.partner ?? '',
          geplantId: g.id,
          projektId: g.projektId ?? null,
        }), 0);
      },
    }, 'Jetzt buchen …'),
    h('small', { class: 'feld-hilfe' }, 'Macht daraus eine echte Buchung. Betrag und Datum kannst du dabei anpassen.'));

  dialog({
    titel: g ? 'Geplante Einmalbuchung bearbeiten' : 'Neue geplante Einmalbuchung',
    inhalt: [statusInfo, buchenKnopf, artKnoepfe, bezeichnung.feld, betrag.feld, partner.feld, kategorie.feld, konto.feld, gegenkonto.feld, datum.feld, projekt?.feld],
    zusatz: g && {
      text: 'Löschen',
      variante: 'knopf-gefahr',
      onclick: async (d) => {
        const ok = await frage({ titel: 'Geplante Einmalbuchung löschen?', text: 'Sie wird endgültig gelöscht. Eine bereits gebuchte Buchung bleibt erhalten.', jaText: 'Löschen', gefahr: true });
        if (!ok) return;
        await db.loesche('geplant', g.id);
        d.close();
        toast('Geplante Einmalbuchung gelöscht');
        datenGeaendert();
      },
    },
    onSpeichern: async () => {
      const datensatz = baueGeplant({
        bezeichnung: bezeichnung.input.value,
        art,
        kontoId: konto.select.value,
        gegenkontoId: gegenkonto.select.value,
        kategorieId: kategorie.select.value,
        datum: datum.input.value,
        betragCent: parseEuro(betrag.input.value, 'Betrag'),
        projektId: projekt ? projekt.select.value : undefined,
        partner: partner.input.value,
      }, { konten, kategorien, alt: g });
      await db.speichere('geplant', datensatz);
      toast(g ? 'Gespeichert' : 'Geplante Einmalbuchung angelegt');
      datenGeaendert();
    },
  });
}

/* =========================== Bausteine =========================== */

function segmente(optionen, aktuell, beiWahl, label) {
  const knoepfe = optionen.map(([wert, text]) => h('button', {
    type: 'button',
    class: 'segment',
    'data-wert': wert,
    'aria-pressed': String(wert === aktuell),
    onclick: () => {
      knoepfe.forEach((k) => k.setAttribute('aria-pressed', String(k.dataset.wert === wert)));
      beiWahl(wert);
    },
  }, text));
  return h('div', { class: 'segmente', role: 'group', 'aria-label': label }, knoepfe);
}

/**
 * Betrag mit Wertänderungen: erste Zeile gilt ab Start, weitere Zeilen "ab Monat/Datum".
 * typ: 'month' (Budgets) oder 'date' (wiederkehrende Buchungen)
 */
function stufenEditor({ typ, stufen, label }) {
  const zeilen = [];
  const liste = h('div', { class: 'stufen' });

  const neueZeile = (stufe, erste) => {
    const ab = h('input', { type: typ, value: erste ? '' : (stufe?.ab ?? ''), 'aria-label': 'Gilt ab' });
    const betrag = h('input', {
      type: 'text', inputmode: 'decimal', placeholder: '0,00', 'aria-label': `${label} in €`,
      value: stufe ? centZuEingabe(stufe.betragCent) : '',
    });
    const eintrag = { ab, betrag, erste };
    const zeile = h('div', { class: 'stufe' },
      erste ? h('span', { class: 'stufe-ab' }, 'ab Start') : ab,
      betrag,
      erste ? h('span') : h('button', {
        type: 'button',
        class: 'knopf knopf-klein',
        'aria-label': 'Betragsänderung entfernen',
        onclick: () => { zeile.remove(); zeilen.splice(zeilen.indexOf(eintrag), 1); },
      }, '✕'));
    zeilen.push(eintrag);
    liste.append(zeile);
  };

  const sortiert = [...stufen].sort((a, b) => a.ab.localeCompare(b.ab));
  neueZeile(sortiert[0], true);
  for (const s of sortiert.slice(1)) neueZeile(s, false);

  const feld = h('div', { class: 'feld' },
    h('span', { class: 'feld-label' }, `${label} in €`),
    liste,
    h('button', { type: 'button', class: 'knopf knopf-klein', onclick: () => neueZeile(null, false) }, '+ Betrag ändern ab …'),
    h('small', { class: 'feld-hilfe' }, typ === 'month'
      ? 'Für spätere Änderungen eine Zeile mit Monat und neuem Betrag hinzufügen.'
      : 'Für spätere Änderungen (z. B. Mieterhöhung) eine Zeile mit Datum und neuem Betrag hinzufügen.'));

  return {
    feld,
    werte: () => zeilen.map((z) => ({
      ab: z.erste ? '' : z.ab.value,
      betragCent: parseEuro(z.betrag.value, label) ?? null,
    })),
  };
}

/** Für die Übersicht: Termin überspringen bzw. verschieben und speichern */
export async function speichereAusnahme(w, termin, aktion, neuesDatum = null) {
  await db.speichere('wiederkehrend', mitAusnahme(w, termin, aktion, neuesDatum));
}

/** Für die Übersicht: geplante Einmalbuchung verschieben oder als "schon gebucht" markieren */
export async function aendereGeplant(g, aenderung) {
  await db.speichere('geplant', { ...g, ...aenderung, geaendertAm: new Date().toISOString() });
}
