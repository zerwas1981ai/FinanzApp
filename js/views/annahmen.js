// Tab "Annahmen": Budgets und wiederkehrende Buchungen (Etappe 4), geplante
// Einmalbuchungen (Etappe 5). Jede Annahme hat einen Ein/Aus-Schalter.
// Geplante Einmalbuchungen können einem Projekt zugeordnet werden (Tab "Projekte").

import { h } from '../dom.js';
import { sortiereKonten } from '../konten.js';
import * as db from '../db.js';
import { formatEuro, formatDatum, formatMonat, centZuEingabe, parseEuro, heuteIso } from '../format.js';
import { dialog, frage, toast, eingabe, auswahl, datenGeaendert } from '../ui.js';
import { baueBudget, baueWiederkehrend, baueGeplant, geplantErledigt, haeufigstesKonto, mitAusnahme } from '../annahmen.js';
import { budgetFuerMonat, betragAm, terminBetrag, naechsterTermin, plusMonate, monatsende, annahmeTitel } from '../prognose.js';
import { artWahl, fuelleKategorien, projektFeld, oeffneBuchungsdialog, partnerFeld, budgetZuordnungFeld } from './buchung-dialog.js';
import { VERTEILUNGEN, istJaehrlich, trancheImMonat } from '../jahresbudget.js';

const nachName = (a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' });
const INTERVALL_TEXT = { monatlich: 'monatlich', vierteljaehrlich: 'vierteljährlich', jaehrlich: 'jährlich' };
const INTERVALL_UEBERSCHRIFT = { monatlich: 'Monatlich', vierteljaehrlich: 'Vierteljährlich', jaehrlich: 'Jährlich' };
const monatText = (m) => formatMonat(Number(m.slice(0, 4)), Number(m.slice(5, 7)));
const MONATSNAMEN = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const TYP_TEXT = { wiederkehrend: 'Jeden Monat', jaehrlich: 'Jährlich', einmalig: 'Einmalig' };
const TYP_RANG = { wiederkehrend: 0, jaehrlich: 1, einmalig: 2 };
const ART_UEBERSCHRIFT = { wiederkehrend: 'Monatlich', jaehrlich: 'Jährlich', einmalig: 'Einmalig' };
const QUARTALSENDE = ['31.03.', '30.06.', '30.09.', '31.12.'];

export async function zeigeAnnahmen(container) {
  const namen = ['konten', 'kategorien', 'buchungen', 'budgets', 'wiederkehrend', 'geplant', 'projekte'];
  const werte = await Promise.all(namen.map((n) => db.alle(n)));
  const daten = Object.fromEntries(namen.map((n, i) => [n, werte[i]]));

  container.replaceChildren(
    h('h1', { class: 'seitentitel' }, 'Annahmen'),
    h('p', { class: 'hinweis erklaerung' },
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
  // D86/D91: nach Konten gruppiert (eigene Konten-Reihenfolge), darin nach Art, dann alphabetisch nach Kategorie
  const nachKategorie = (a, b) =>
    (kat.get(a.kategorieId)?.name ?? '').localeCompare(kat.get(b.kategorieId)?.name ?? '', 'de')
    || (TYP_RANG[a.typ] ?? 0) - (TYP_RANG[b.typ] ?? 0)
    || (a.monat ?? '').localeCompare(b.monat ?? '');
  const kontoIds = new Set(budgets.map((b) => b.kontoId));
  const gruppen = sortiereKonten(konten.filter((k) => kontoIds.has(k.id))).map((k) => ({ id: k.id, name: k.name }));
  if (budgets.some((b) => !kontoName.has(b.kontoId))) gruppen.push({ id: null, name: 'Unbekanntes Konto' });
  const imKonto = (g) => budgets.filter((b) => (g.id === null ? !kontoName.has(b.kontoId) : b.kontoId === g.id));
  // Summen immer für den Folgemonat (D87): wiederkehrend + einmalig + Tranchen von Jahresbudgets (D90)
  const folgemonat = plusMonate(monat, 1);
  const summeKonto = (liste) => [...new Set(liste.map((b) => b.kategorieId))]
    .reduce((s, id) => s + budgetFuerMonat(liste, id, folgemonat).betragCent, 0)
    + liste.filter(istJaehrlich).reduce((s, b) => s + trancheImMonat(b, folgemonat), 0);

  const summeMonat = summeKonto(budgets);

  const zeile = (b) => {
    const name = kat.get(b.kategorieId)?.name ?? 'Unbekannte Kategorie';
    let info;
    let betrag;
    let zusatz = null;
    let beendet = false;
    if (b.typ === 'einmalig') {
      info = `Einmalig · ${monatText(b.monat)}`;
      betrag = formatEuro(b.betragCent);
      beendet = b.monat < monat;
    } else if (istJaehrlich(b)) {
      const wann = b.verteilung === 'zeitpunkt' ? `zum Ende ${MONATSNAMEN[b.zeitpunktMonat - 1]}`
        : b.verteilung === 'halbjahr' ? 'hälftig 30.06./31.12.' : 'je Quartalsende';
      info = `Jährlich · ${wann} · ab ${b.startJahr}${b.endJahr ? ` bis ${b.endJahr}` : ''}`;
      betrag = `${formatEuro(b.betragCent)} / Jahr`;
      if (b.verteilung === 'quartal') zusatz = b.quartaleCent.map((c, i) => `Q${i + 1} ${formatEuro(c)}`).join(' · ');
      beendet = b.endJahr != null && b.endJahr < Number(monat.slice(0, 4));
    } else {
      const bis = b.endMonat ? ` bis ${monatText(b.endMonat)}` : '';
      info = `Jeden Monat · ab ${monatText(b.startMonat)}${bis}`;
      betrag = `${formatEuro(betragAm(b.stufen, b.startMonat > monat ? b.startMonat : monat))} / Monat`;
      const kuenftig = b.stufen.filter((s) => s.ab > monat);
      const teile = kuenftig.map((s) => `ab ${monatText(s.ab)}: ${formatEuro(s.betragCent)}`);
      // D92: feste Abweichungen je Kalendermonat
      for (const k of b.kalenderMonate ?? []) teile.push(`jeden ${MONATSNAMEN[k.monat - 1]}: ${formatEuro(k.betragCent)}`);
      if (teile.length) zusatz = teile.join(' · ');
      beendet = Boolean(b.endMonat && b.endMonat < monat);
    }
    // D138: eine Zeile – am PC Kategorie · Rhythmus · Abweichungen (notfalls „…“), am Handy nur die Kategorie
    const details = [info, zusatz].filter(Boolean).join(' · ');
    return zeileMitSchalter(b, 'budgets',
      h('button', {
        type: 'button', class: 'buchung zeile-1' + (beendet ? ' archiviert' : ''), title: `${name} · ${details}`, onclick: () => budgetDialog(b, daten),
      },
      h('span', { class: 'buchung-text' },
        h('span', { class: 'buchung-titel' }, name, beendet && h('span', { class: 'marke' }, 'abgelaufen')),
        h('span', { class: 'zeile-info nur-breit' }, details)),
      h('span', { class: 'betrag' }, betrag)));
  };

  return h('section', { class: 'bereich', 'aria-labelledby': 'titel-budgets' },
    h('div', { class: 'bereich-kopf' },
      h('h2', { id: 'titel-budgets' }, 'Budgets'),
      h('button', { type: 'button', class: 'knopf knopf-primaer', onclick: () => budgetDialog(null, daten) }, '+ Budget')),
    h('p', { class: 'hinweis erklaerung' },
      'Ein Budget gilt je Hauptkategorie, Konto und Monat. Nur Ausgaben der Unterkategorien auf diesem Konto ' +
      'verbrauchen es, ein Rest verfällt am Monatsende. Einmalige Budgets kommen im jeweiligen Monat dazu. ' +
      'Jahresbudgets wirken in Tranchen; ein Rest wandert ins Restbudget zum 31.12. und verfällt am Jahresende.'),
    budgets.length === 0
      ? h('p', { class: 'leer' }, 'Noch keine Budgets.')
      : gruppen.map((g) => {
        const liste = imKonto(g);
        return h('div', { class: 'budget-gruppe' },
          h('div', { class: 'tag-kopf' }, h('span', {}, g.name)),
          // D91: innerhalb des Kontos nach Art – monatlich, jährlich, einmalig
          Object.keys(TYP_RANG).map((art) => {
            const teil = liste.filter((b) => (b.typ ?? 'wiederkehrend') === art);
            return teil.length > 0 && h('div', { class: 'budget-art' },
              h('div', { class: 'budget-art-kopf' }, ART_UEBERSCHRIFT[art]),
              h('ul', { class: 'liste' }, [...teil].sort(nachKategorie).map(zeile)));
          }).filter(Boolean),
          h('div', { class: 'summe zwischensumme' },
            h('span', {}, `Zwischensumme ${g.name} · ${monatText(folgemonat)}`),
            h('span', { class: 'betrag' }, formatEuro(summeKonto(liste)))));
      }),
    budgets.length > 0 && h('div', { class: 'summe ergebnis' },
      h('span', {}, `Budgets ${monatText(folgemonat)} zusammen`), h('span', { class: 'betrag' }, formatEuro(summeMonat))),
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
    budget ? [[budget.typ, TYP_TEXT[budget.typ]]] : Object.entries(TYP_TEXT),
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
  const kalender = kalenderMonateEditor(budget?.typ === 'wiederkehrend' ? (budget.kalenderMonate ?? []) : []);
  // Einmalig
  const monat = eingabe({ label: 'Monat', type: 'month', value: budget?.monat ?? plusMonate(heute.slice(0, 7), 1) });
  const betrag = eingabe({ label: 'Betrag in €', inputmode: 'decimal', placeholder: '0,00', value: budget?.typ === 'einmalig' ? centZuEingabe(budget.betragCent) : '' });

  // Jährlich (D90)
  const jb = istJaehrlich(budget) ? budget : null;
  const startJahr = eingabe({ label: 'Ab Jahr', type: 'number', inputmode: 'numeric', min: '2000', max: '2100', value: String(jb?.startJahr ?? Number(heute.slice(0, 4))) });
  const endJahr = eingabe({ label: 'Bis Jahr (optional)', type: 'number', inputmode: 'numeric', min: '2000', max: '2100', value: jb?.endJahr ? String(jb.endJahr) : '' });
  const verteilung = auswahl({
    label: 'Wann wirkt das Budget?',
    optionen: Object.entries(VERTEILUNGEN).map(([wert, text]) => ({ wert, text })),
    wert: jb?.verteilung ?? 'halbjahr',
  });
  const zeitpunkt = auswahl({
    label: 'Zum Ende von',
    optionen: MONATSNAMEN.map((text, i) => ({ wert: String(i + 1), text })),
    wert: String(jb?.zeitpunktMonat ?? 12),
  });
  const jahrBetrag = eingabe({
    label: 'Betrag pro Jahr in €', inputmode: 'decimal', placeholder: '0,00',
    value: jb && jb.verteilung !== 'quartal' ? centZuEingabe(jb.betragCent) : '',
  });
  const quartale = QUARTALSENDE.map((tag, i) => eingabe({
    label: `Q${i + 1} (zum ${tag}) in €`, inputmode: 'decimal', placeholder: '0,00',
    value: jb?.verteilung === 'quartal' ? centZuEingabe(jb.quartaleCent[i]) : '',
  }));
  const quartalSumme = h('p', { class: 'hinweis' });
  const zeigeQuartalSumme = () => {
    let summe = 0;
    for (const q of quartale) {
      try { summe += parseEuro(q.input.value, 'Betrag') ?? 0; } catch { /* Tippfehler: beim Speichern gemeldet */ }
    }
    quartalSumme.textContent = `Jahresbudget zusammen: ${formatEuro(summe)}`;
  };
  quartale.forEach((q) => q.input.addEventListener('input', zeigeQuartalSumme));
  zeigeQuartalSumme();
  const quartalFelder = h('div', {},
    h('div', { class: 'feld-paar' }, quartale[0].feld, quartale[1].feld),
    h('div', { class: 'feld-paar' }, quartale[2].feld, quartale[3].feld),
    quartalSumme);
  const jaehrlichFelder = h('div', {},
    h('div', { class: 'feld-paar' }, startJahr.feld, endJahr.feld),
    verteilung.feld, zeitpunkt.feld, jahrBetrag.feld, quartalFelder,
    h('p', { class: 'hinweis' },
      'Jede Tranche wird von den Ausgaben seit der vorigen Tranche verbraucht. Was nach Ablauf übrig ist, ' +
      'kommt ins Restbudget zum 31.12.; eine Überziehung verringert es. Am Jahresende verfällt der Rest – kein Übertrag ins neue Jahr.'));
  verteilung.select.addEventListener('change', () => aktualisiere());

  const wiederkehrendFelder = h('div', {}, h('div', { class: 'feld-paar' }, start.feld, ende.feld), stufen.feld, kalender.feld);
  const einmaligFelder = h('div', {}, h('div', { class: 'feld-paar' }, monat.feld, betrag.feld));
  function aktualisiere() {
    wiederkehrendFelder.hidden = typ !== 'wiederkehrend';
    einmaligFelder.hidden = typ !== 'einmalig';
    jaehrlichFelder.hidden = typ !== 'jaehrlich';
    const v = verteilung.select.value;
    zeitpunkt.feld.hidden = v !== 'zeitpunkt';
    jahrBetrag.feld.hidden = v === 'quartal';
    quartalFelder.hidden = v !== 'quartal';
  }
  aktualisiere();

  dialog({
    titel: budget ? 'Budget bearbeiten' : 'Neues Budget',
    inhalt: [typWahl, kat.feld, wiederkehrendFelder, jaehrlichFelder, einmaligFelder, konto.feld],
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
      let werte;
      if (typ === 'einmalig') werte = { ...basis, monat: monat.input.value, betragCent: parseEuro(betrag.input.value, 'Betrag') };
      else if (typ === 'jaehrlich') {
        const v = verteilung.select.value;
        werte = {
          ...basis, startJahr: startJahr.input.value, endJahr: endJahr.input.value, verteilung: v,
          zeitpunktMonat: zeitpunkt.select.value,
          betragCent: v === 'quartal' ? null : parseEuro(jahrBetrag.input.value, 'Betrag pro Jahr'),
          quartaleCent: v === 'quartal' ? quartale.map((q, i) => parseEuro(q.input.value, `Q${i + 1}`) ?? 0) : null,
        };
      } else werte = { ...basis, startMonat: start.input.value, endMonat: ende.input.value, stufen: stufen.werte(), kalenderMonate: kalender.werte() };
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
    || annahmeTitel(a, kategorien).localeCompare(annahmeTitel(b, kategorien), 'de', { sensitivity: 'base' }));
  const kontoIds = new Set(wiederkehrend.map((w) => w.kontoId));
  const gruppen = sortiereKonten(konten.filter((k) => kontoIds.has(k.id))).map((k) => ({ id: k.id, name: k.name }));
  if (wiederkehrend.some((w) => !kontoName.has(w.kontoId))) gruppen.push({ id: null, name: 'Unbekanntes Konto' });
  const zeile = (w) => wiederkehrendZeile(w, daten, heute, kat, kontoName);

  return h('section', { class: 'bereich', 'aria-labelledby': 'titel-wiederkehrend' },
    h('div', { class: 'bereich-kopf' },
      h('h2', { id: 'titel-wiederkehrend' }, 'Wiederkehrende Buchungen'),
      h('button', { type: 'button', class: 'knopf knopf-primaer', onclick: () => wiederkehrendDialog(null, daten) }, '+ Wiederkehrend')),
    h('p', { class: 'hinweis erklaerung' },
      'Fällige Termine erscheinen in der Übersicht. Erst wenn du dort auf „Buchen“ tippst, entsteht eine echte Buchung.'),
    sortiert.length === 0
      ? h('p', { class: 'leer' }, 'Noch keine wiederkehrenden Buchungen.')
      // D97: nach Konto (eigene Reihenfolge), darin nach Zeithorizont – wie die Budgets (D86/D91)
      : gruppen.map((g) => {
        const liste = sortiert.filter((w) => (g.id === null ? !kontoName.has(w.kontoId) : w.kontoId === g.id));
        return h('div', { class: 'budget-gruppe' },
          h('div', { class: 'tag-kopf' }, h('span', {}, g.name)),
          Object.keys(INTERVALL_UEBERSCHRIFT).map((iv) => {
            const teil = liste.filter((w) => (INTERVALL_UEBERSCHRIFT[w.intervall] ? w.intervall : 'monatlich') === iv);
            return teil.length > 0 && h('div', { class: 'budget-art' },
              h('div', { class: 'budget-art-kopf' }, INTERVALL_UEBERSCHRIFT[iv]),
              h('ul', { class: 'liste' }, teil.map(zeile)));
          }).filter(Boolean));
      }),
  );
}

/** Zeile einer wiederkehrenden Buchung im Annahmen-Tab */
function wiederkehrendZeile(w, daten, heute, kat, kontoName) {
  const { kategorien } = daten;
  const naechster = naechsterTermin(w, heute);
  const beendet = !naechster;
  const titel = annahmeTitel(w, kategorien); // D96: Empfänger/Absender · Notiz
  let zuordnung;
  // Konto steht in der Gruppenüberschrift (D97)
  if (w.art === 'umbuchung') zuordnung = `→ ${kontoName.get(w.gegenkontoId) ?? '?'}`;
  else {
    const unter = kat.get(w.kategorieId);
    // Empfänger/Absender steht schon im Titel
    zuordnung = `${kat.get(unter?.elternId)?.name ?? '?'} › ${unter?.name ?? '?'}`;
  }
  // Das Intervall steht in der Zwischenüberschrift (D97)
  const info = [
    w.monatsletzter && 'zum Monatsletzten',
    naechster ? `nächster Termin ${formatDatum(naechster.datum)}` : 'keine weiteren Termine',
    zuordnung,
  ].filter(Boolean).join(' · ');
  const cent = naechster?.betragCent ?? terminBetrag(w, heute);
  // D94: feste Abweichungen je Kalendermonat
  const abweichend = (w.kalenderMonate ?? []).map((k) => `jeden ${MONATSNAMEN[k.monat - 1]}: ${formatEuro(k.betragCent)}`).join(' · ');
  const text = w.art === 'umbuchung' ? formatEuro(cent) : (w.art === 'einnahme' ? '+' : '') + formatEuro(w.art === 'ausgabe' ? -cent : cent);
  // D138: eine Zeile – am PC Titel · nächster Termin · Kategorie · Abweichungen, am Handy der Empfänger/Absender
  const details = [info, abweichend].filter(Boolean).join(' · ');
  const handyTitel = w.art === 'umbuchung' ? zuordnung : (w.partner?.trim() || titel);
  return zeileMitSchalter(w, 'wiederkehrend',
    h('button', {
      type: 'button', class: 'buchung zeile-1' + (beendet ? ' archiviert' : ''), title: `${titel} · ${details}`, onclick: () => wiederkehrendDialog(w, daten),
    },
    h('span', { class: 'buchung-text' },
      h('span', { class: 'buchung-titel' },
        h('span', { class: 'nur-breit' }, titel), h('span', { class: 'nur-schmal' }, handyTitel),
        beendet && h('span', { class: 'marke' }, 'beendet')),
      h('span', { class: 'zeile-info nur-breit' }, details)),
    h('span', { class: 'betrag ' + (w.art === 'einnahme' ? 'plus' : w.art === 'umbuchung' ? 'gedaempft' : '') }, text)));
}

/**
 * Dialog für eine wiederkehrende Buchung. daten braucht konten, kategorien, buchungen.
 * vorgaben (nur neu, D71): z. B. aus einer echten Buchung übernommen –
 *   { art, notiz, partner, betragCent, kontoId, gegenkontoId, kategorieId, start, monatsletzter, titel }
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

  // D96: optionale Notiz statt Pflicht-Bezeichnung (ältere Daten: Bezeichnung wurde zur Notiz)
  const notiz = eingabe({ label: 'Notiz (optional)', value: v.notiz ?? v.bezeichnung ?? '', maxlength: 120 });
  const partner = partnerFeld(daten.buchungen ?? [], v.partner ?? '', art);
  const artKnoepfe = artWahl(null, art, (neu) => { art = neu; aktualisiere(); });
  const stufen = stufenEditor({
    typ: 'date',
    stufen: w?.stufen ?? (vorgaben.betragCent ? [{ ab: '', betragCent: vorgaben.betragCent }] : []),
    label: 'Betrag',
  });
  const kalender = kalenderMonateEditor(w?.kalenderMonate ?? [],
    'Z. B. November 1.800 € (Weihnachtsgeld) – gilt jedes Jahr für den Termin in diesem Monat, als fester Betrag.');
  const kategorie = auswahl({ label: 'Kategorie', optionen: [] });
  const kontoOptionen = waehlbar.map((k) => ({ wert: k.id, text: k.name }));
  const konto = auswahl({ label: 'Konto', optionen: kontoOptionen, wert: v.kontoId ?? waehlbar[0].id });
  const gegenkonto = auswahl({ label: 'Auf Konto', optionen: kontoOptionen, wert: v.gegenkontoId ?? waehlbar.find((k) => k.id !== konto.select.value)?.id });
  const budgetFeld = budgetZuordnungFeld(kategorien, v.budgetKategorieId ?? null); // D98
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
    budgetFeld.feld.hidden = !istUmbuchung;
    konto.feld.querySelector('label').textContent = istUmbuchung ? 'Von Konto' : 'Konto';
    if (!istUmbuchung) fuelleKategorien(kategorie.select, kategorien, art, v.kategorieId);
  }
  aktualisiere();

  dialog({
    titel: w ? 'Wiederkehrende Buchung bearbeiten' : (vorgaben.titel ?? 'Neue wiederkehrende Buchung'),
    inhalt: [
      artKnoepfe, stufen.feld, kalender.feld, partner.feld, kategorie.feld, konto.feld, gegenkonto.feld, budgetFeld.feld,
      intervall.feld, monatsletzterFeld, h('div', { class: 'feld-paar' }, start.feld, ende.feld), notiz.feld, ausnahmenListe,
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
        notiz: notiz.input.value,
        budgetKategorieId: budgetFeld.select.value,
        art,
        kontoId: konto.select.value,
        gegenkontoId: gegenkonto.select.value,
        kategorieId: kategorie.select.value,
        intervall: intervall.select.value,
        start: start.input.value,
        monatsletzter: monatsletzter.checked,
        ende: ende.input.value,
        stufen: stufen.werte(),
        kalenderMonate: kalender.werte(),
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
      // D138: am Handy nur eine Zeile (Bezeichnung und Betrag), am PC wie bisher mit Datum und Zuordnung
      h('button', {
        type: 'button', class: 'buchung zeile-1-handy' + (e ? ' archiviert' : ''), title: `${g.bezeichnung} · ${formatDatum(g.datum)} · ${zuordnung}`,
        onclick: () => geplantDialog(g, daten),
      },
        h('span', { class: 'buchung-text' },
          h('span', { class: 'buchung-titel' }, g.bezeichnung, status, projektMarke(g, daten.projekte)),
          h('span', { class: 'buchung-unter' }, `${formatDatum(g.datum)} · ${zuordnung}`)),
        h('span', { class: 'betrag ' + (e ? '' : 'annahme ') + (g.art === 'einnahme' ? 'plus' : g.art === 'umbuchung' ? 'gedaempft' : '') }, text)));
  };

  return h('section', { class: 'bereich', 'aria-labelledby': 'titel-geplant' },
    h('div', { class: 'bereich-kopf' },
      h('h2', { id: 'titel-geplant' }, 'Geplante Einmalbuchungen'),
      h('button', { type: 'button', class: 'knopf knopf-primaer', onclick: () => geplantDialog(null, daten) }, '+ Geplant')),
    h('p', { class: 'hinweis erklaerung' },
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
  const budgetFeld = budgetZuordnungFeld(kategorien, g?.budgetKategorieId ?? null); // D98
  const datum = eingabe({ label: 'Geplant am', type: 'date', value: g?.datum ?? plusMonate(heute.slice(0, 7), 1) + '-01' });
  const projekt = projektFeld(daten.projekte ?? [], g?.projektId ?? vorgaben.projektId ?? null);

  function aktualisiere() {
    const istUmbuchung = art === 'umbuchung';
    kategorie.feld.hidden = istUmbuchung;
    partner.setzeArt(art);
    if (projekt) projekt.feld.hidden = istUmbuchung;
    gegenkonto.feld.hidden = !istUmbuchung;
    budgetFeld.feld.hidden = !istUmbuchung;
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
          budgetKategorieId: g.budgetKategorieId ?? null,
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
    inhalt: [statusInfo, buchenKnopf, artKnoepfe, bezeichnung.feld, betrag.feld, partner.feld, kategorie.feld, konto.feld, gegenkonto.feld, budgetFeld.feld, datum.feld, projekt?.feld],
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
        budgetKategorieId: budgetFeld.select.value,
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
 * Feste Abweichungen je Kalendermonat (D92), z. B. „jeden Juli 200 €“.
 * Liefert { feld, werte() } mit werte() = [{ monat, betragCent }].
 */
function kalenderMonateEditor(vorhanden, hilfe = 'Z. B. Juli 200 € – gilt jedes Jahr als fester Betrag, auch wenn sich der Monatsbetrag ändert. 0 = kein Budget in diesem Monat.') {
  const zeilen = [];
  const liste = h('div', { class: 'stufen' });
  const neueZeile = (eintragAlt) => {
    const monat = h('select', { 'aria-label': 'Monat' },
      h('option', { value: '' }, 'Monat wählen …'),
      MONATSNAMEN.map((text, i) => h('option', { value: String(i + 1) }, text)));
    monat.value = eintragAlt ? String(eintragAlt.monat) : '';
    const betrag = h('input', {
      type: 'text', inputmode: 'decimal', placeholder: '0,00', 'aria-label': 'Betrag in diesem Monat in €',
      value: eintragAlt ? centZuEingabe(eintragAlt.betragCent) : '',
    });
    const eintrag = { monat, betrag };
    const zeile = h('div', { class: 'stufe' }, monat, betrag, h('button', {
      type: 'button',
      class: 'knopf knopf-klein',
      'aria-label': 'Abweichung entfernen',
      onclick: () => { zeile.remove(); zeilen.splice(zeilen.indexOf(eintrag), 1); },
    }, '✕'));
    zeilen.push(eintrag);
    liste.append(zeile);
  };
  for (const k of vorhanden) neueZeile(k);

  const feld = h('div', { class: 'feld' },
    h('span', { class: 'feld-label' }, 'Abweichende Monate (jedes Jahr)'),
    liste,
    h('button', { type: 'button', class: 'knopf knopf-klein', onclick: () => neueZeile(null) }, '+ Monat mit anderem Betrag'),
    h('small', { class: 'feld-hilfe' }, hilfe));
  return {
    feld,
    werte: () => zeilen.map((z) => ({ monat: z.monat.value, betragCent: parseEuro(z.betrag.value, 'Betrag') ?? null })),
  };
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
