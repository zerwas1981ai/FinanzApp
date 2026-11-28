// Tab „Auswertungen“, Ansicht „Analyse“: Verlauf, Kategorien, Empfänger/Absender, größte Ausgaben.
// Bis D258 Teil von alle-buchungen.js.

import { h } from '../dom.js';
import { formatEuro, formatEuroRund, formatProzent, formatDatum, formatMonat } from '../format.js';
import { toast } from '../ui.js';
import { notizListe } from './monatsnotiz.js';
import { STANDARD_FILTER, filtere, monateDerAuswertung, ersterErfassterTag, abgeschlosseneMonate, summenJeKategorie, schoeneObergrenze, vorjahrJeMonat, vorperiode, budgetSchnitt, groessteBuchungen, veraenderungProzent, ausgabenVerlauf, OHNE_PARTNER, summenJePartner } from '../auswertung.js';
import { oeffneBuchungsdialog } from './buchung-dialog.js';
import { zeitleiste, nurWirksam, plusMonate, monatsende } from '../prognose.js';
import { SEITE, zustand } from './auswertung-zustand.js';

/* --------------------------- Analyse --------------------------- */

export function analyse(eintraege, daten, heute, neu) {
  const erster = ersterErfassterTag(daten.buchungen, zustand.filter);
  const monate = monateDerAuswertung(eintraege, zustand.filter, heute, erster);
  if (eintraege.length === 0 || monate.length === 0) {
    return h('section', { class: 'bereich' }, h('p', { class: 'leer' }, 'Keine Buchungen für eine Auswertung.'));
  }
  // D126: Ausgaben der letzten 12 und nächsten 12 Monate – immer Ausgaben, egal welche Art gefiltert ist
  const nurAusgaben = filtere(daten.buchungen, { ...zustand.filter, zeitraum: 'alles', arten: ['ausgabe'] }, { ...daten, heute });
  const zl = zeitleiste(nurWirksam({ ...daten, buchungen: daten.hauptBuchungen }), heute, plusMonate(heute.slice(0, 7), 6));
  const verlauf = ausgabenVerlauf({
    istEintraege: nurAusgaben, zl, buchungen: daten.hauptBuchungen, kategorien: daten.kategorien, filter: zustand.filter, heute, erster,
  });
  const vorjahr = vorjahrJeMonat(nurAusgaben, verlauf.map((z) => [z.jahr, z.monat]), erster);
  // D130: Ist bei „Art“ nur Einnahmen oder Umbuchungen gewählt, entfällt das Ausgaben-Diagramm
  const mitAusgaben = !zustand.filter.arten.length || zustand.filter.arten.includes('ausgabe');
  return h('div', {},
    mitAusgaben && verlaufBereich(verlauf, neu, vorjahr),
    // D165: Monatsnotizen der gezeigten Monate
    mitAusgaben && notizListe(verlauf.map((z) => `${z.jahr}-${String(z.monat).padStart(2, '0')}`), daten.monatsnotizen),
    zustand.analyseGruppe === 'partner'
      ? partnerBereich(eintraege, monate, heute, neu)
      : kategorieBereich(kategorieEintraege(eintraege, daten, heute), daten, monate, heute, neu, erster),
    // D132/D133: die Top-10-Liste nur in der Ansicht „Nach Kategorien“ und ohne Empfänger-Filter
    zustand.analyseGruppe === 'kategorie' && zustand.filter.partner.length === 0 && groessteBereich(eintraege, daten, neu),
  );
}

/**
 * D129: Ist auf Unterkategorien gefiltert, zeigt die Kategorientabelle deren Hauptkategorie vollständig
 * (Gesamtsumme der Hauptkategorie, alle Unterkategorien mit Anteil daran). Die gewählte Unterkategorie
 * wird hervorgehoben. Liste, Summen und Diagramm bleiben auf die Unterkategorie gefiltert.
 */
function kategorieEintraege(eintraege, daten, heute) {
  const ids = zustand.filter.kategorieIds;
  if (!ids.length) return eintraege;
  const kat = new Map(daten.kategorien.map((k) => [k.id, k]));
  if (!ids.some((id) => kat.get(id)?.elternId)) return eintraege;
  const haupt = [...new Set(ids.map((id) => kat.get(id)?.elternId ?? id))];
  return filtere(daten.buchungen, { ...zustand.filter, kategorieIds: haupt }, { ...daten, heute });
}

/** Umschalter: Analyse nach Kategorien oder nach Empfänger/Absender */
function gruppeWahl(neu) {
  return h('div', { class: 'segmente', role: 'group', 'aria-label': 'Gruppieren nach' },
    [['kategorie', 'Nach Kategorien'], ['partner', 'Nach Empfänger/Absender']].map(([wert, text]) => h('button', {
      type: 'button',
      class: 'segment',
      'aria-pressed': String(zustand.analyseGruppe === wert),
      onclick: () => { zustand.analyseGruppe = wert; neu(); },
    }, text)));
}

/** Genau eine Art (Ausgabe oder Einnahme) im Filter? Dann richtet sich die Analyse danach. */
function eineGefilterteArt() {
  const arten = zustand.filter.arten.filter((x) => x !== 'umbuchung');
  return arten.length === 1 ? arten[0] : null;
}

/** Ausgaben/Einnahmen-Umschalter der Analyse */
function artWahlAnalyse(neu) {
  // D126: Ist im Filter genau eine Art gewählt (Standard: Ausgaben), gibt es nichts umzuschalten
  if (eineGefilterteArt()) return null;
  return h('div', { class: 'segmente', role: 'group', 'aria-label': 'Art' },
    [['ausgabe', 'Ausgaben'], ['einnahme', 'Einnahmen']].map(([wert, text]) => h('button', {
      type: 'button',
      class: 'segment',
      'aria-pressed': String(zustand.analyseArt === wert),
      onclick: () => { zustand.analyseArt = wert; neu(); },
    }, text)));
}

const MAX_PARTNER = 25; // so viele Empfänger/Absender einzeln, der Rest als "Weitere"

/** Summen je Empfänger/Absender mit Anteil und Ø pro Monat. Antippen filtert die Liste. */
function partnerBereich(eintraege, monate, heute, neu) {
  const schnittMonate = abgeschlosseneMonate(monate, heute);
  const anzahlMonate = schnittMonate.length;
  const art = eineGefilterteArt() ?? zustand.analyseArt;
  const alle = summenJePartner(eintraege, art, schnittMonate);
  const gesamt = alle.reduce((s, g) => s + g.summe, 0);
  const max = Math.max(...alle.map((g) => g.summe), 1);
  const mitSchnitt = anzahlMonate > 0 && monate.length > 1;
  const gezeigt = alle.slice(0, MAX_PARTNER);
  const rest = alle.slice(MAX_PARTNER);
  const schnittVon = (liste) => (anzahlMonate ? Math.round(liste.reduce((s, g) => s + g.schnittSumme, 0) / anzahlMonate) : null);

  const zeile = (x, klickbar) => {
    const inhalt = [
      h('span', { class: 'kat-zeile-name' }, x.name, h('span', { class: 'klein' }, ` (${x.anzahl})`)),
      h('span', { class: 'kat-balken-spur', 'aria-hidden': 'true' },
        h('span', { class: `kat-balken ${art}`, style: `width:${(x.summe / max) * 100}%` })),
      h('span', { class: 'betrag' }, formatEuro(x.summe)),
      h('span', { class: 'kat-anteil' }, formatProzent(x.anteil)),
      mitSchnitt && h('span', { class: 'kat-schnitt' }, x.schnitt == null ? '' : `Ø ${formatEuro(x.schnitt)}`),
    ];
    return klickbar
      ? h('button', {
        type: 'button',
        class: 'kat-zeile ebene-1 kat-zeile-knopf' + (zustand.filter.partner.length === 1
          && zustand.filter.partner[0] === (x.id === OHNE_PARTNER ? OHNE_PARTNER : x.name) ? ' gewaehlt' : ''),
        title: 'Nach diesem Empfänger/Absender filtern (erneut antippen hebt auf)',
        onclick: () => {
          // D129: in der Analyse bleiben; die Liste ist trotzdem mitgefiltert. Erneut antippen hebt auf.
          const wert = x.id === OHNE_PARTNER ? OHNE_PARTNER : x.name;
          const schon = zustand.filter.partner.length === 1 && zustand.filter.partner[0] === wert;
          zustand.filter.partner = schon ? [] : [wert];
          zustand.sichtbar = SEITE;
          window.dispatchEvent(new Event('daten-geaendert'));
        },
      }, inhalt)
      : h('div', { class: 'kat-zeile ebene-1' }, inhalt);
  };

  const restSumme = rest.reduce((s, g) => s + g.summe, 0);
  return h('section', { class: 'bereich' },
    h('div', { class: 'bereich-kopf' }, h('h2', {}, 'Nach Empfänger/Absender')),
    gruppeWahl(neu),
    artWahlAnalyse(neu),
    alle.length === 0
      ? h('p', { class: 'leer' }, art === 'ausgabe' ? 'Keine Ausgaben in der Auswahl.' : 'Keine Einnahmen in der Auswahl.')
      : h('div', { class: 'kat-tabelle' + (mitSchnitt ? ' mit-schnitt' : '') },
        gezeigt.map((g) => zeile(g, true)),
        rest.length > 0 && zeile({
          name: `Weitere ${rest.length}`,
          anzahl: rest.reduce((s, g) => s + g.anzahl, 0),
          summe: restSumme,
          anteil: gesamt ? restSumme / gesamt : 0,
          schnitt: schnittVon(rest),
        }, false),
        h('div', { class: 'kat-zeile summe-zeile' },
          h('span', { class: 'kat-zeile-name' }, 'Gesamt'),
          h('span', {}),
          h('span', { class: 'betrag' }, formatEuro(gesamt)),
          h('span', { class: 'kat-anteil' }, '100 %'),
          mitSchnitt && h('span', { class: 'kat-schnitt' }, `Ø ${formatEuro(schnittVon(alle))}`))),
    h('p', { class: 'hinweis' }, 'Eine Zeile antippen, um die Liste nach diesem Empfänger/Absender zu filtern. ' +
      'Groß-/Kleinschreibung spielt keine Rolle. Der Ø zählt wie bei den Kategorien nur abgeschlossene Monate.'),
  );
}

/**
 * D126: Ausgaben-Verlauf – die letzten 12 und die nächsten 12 Monate, unabhängig vom gewählten Zeitraum.
 * Gebuchte Ausgaben kräftig; im laufenden Monat darauf heller die noch erwarteten (vorgemerkt, offen, Budgetrest),
 * in den Folgemonaten nur die erwarteten Auszahlungen (hell). Optional das Vorjahr als blasse Balken daneben.
 */
function verlaufBereich(zeilen, neu, vorjahr = []) {
  const mitVorjahr = zustand.vorjahr && vorjahr.some(Boolean);
  const ohneErwartung = zeilen.some((z) => (z.aktuell || z.zukunft) && z.erwartet === null);
  const kurz = (z) => new Intl.DateTimeFormat('de-DE', { month: 'short' }).format(new Date(z.jahr, z.monat - 1, 1)).replace('.', '')
    + ` ${String(z.jahr).slice(2)}`;

  const vorjahrKnopf = vorjahr.some(Boolean) && h('button', {
    type: 'button',
    class: 'knopf knopf-klein',
    'aria-pressed': String(zustand.vorjahr),
    onclick: () => { zustand.vorjahr = !zustand.vorjahr; neu(); },
  }, zustand.vorjahr ? 'Vorjahr ausblenden' : 'Vorjahr zeigen');
  const kopf = h('div', { class: 'bereich-kopf' }, h('h2', {}, 'Ausgaben je Monat'),
    vorjahrKnopf && h('div', { class: 'knopfreihe' }, vorjahrKnopf)); // D131: nur noch das Diagramm
  const legende = h('div', { class: 'legende' },
    h('span', {}, h('span', { class: 'legende-punkt ausgabe' }), 'gebucht'),
    !ohneErwartung && h('span', {}, h('span', { class: 'legende-punkt ausgabe offen-teil' }), 'erwartet (vorgemerkt, offen, Budget)'),
    mitVorjahr && h('span', {}, h('span', { class: 'legende-punkt ausgabe vorjahr' }), 'Vorjahr'),
    h('span', { class: 'klein' }, 'letzte 6 und nächste 6 Monate · unabhängig vom Zeitraum'));
  const hinweis = ohneErwartung && h('p', { class: 'hinweis' },
    'Erwartete Ausgaben lassen sich nur mit Konto- und Kategoriefilter zuordnen – bei Filtern auf Empfänger, Suche oder Betrag fehlen sie.');

  const max = schoeneObergrenze(Math.max(...zeilen.map((z) => z.ist + (z.erwartet ?? 0)),
    ...(mitVorjahr ? vorjahr.filter(Boolean).map((z) => z.ausgaben) : []), 1));
  const ticks = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1]; // D129: doppelt so viele Linien
  const tooltip = h('div', { class: 'tooltip', role: 'status', hidden: true });
  const zeigeTooltip = (spalte, z, v) => {
    tooltip.replaceChildren(
      h('strong', {}, formatMonat(z.jahr, z.monat) + (z.zukunft ? ' (Prognose)' : z.aktuell ? ' (laufend)' : '')),
      !z.zukunft && h('div', {}, h('span', { class: 'legende-punkt ausgabe' }), `Gebucht ${formatEuro(z.ist)}`),
      z.erwartet != null && h('div', {}, h('span', { class: 'legende-punkt ausgabe offen-teil' }), `Erwartet ${formatEuro(z.erwartet)}`),
      (z.aktuell && z.erwartet != null) && h('div', { class: 'tooltip-saldo' }, `Zusammen ${formatEuro(z.ist + z.erwartet)}`),
      mitVorjahr && h('div', { class: 'klein' }, v ? `Vorjahr ${formatEuro(v.ausgaben)}${veraenderung(z.ist + (z.erwartet ?? 0), v.ausgaben)}` : 'Vorjahr: noch nicht erfasst'),
    );
    tooltip.hidden = false;
    const flaeche = spalte.closest('.diagramm-flaeche').getBoundingClientRect();
    const r = spalte.getBoundingClientRect();
    tooltip.style.left = `${Math.min(Math.max(r.left + r.width / 2 - flaeche.left, 80), flaeche.width - 80)}px`;
  };
  const hoehe = (cent) => `height:${(cent / max) * 100}%`;
  const spalten = zeilen.map((z, i) => {
    const v = vorjahr[i];
    // D128: Monate mit gebuchten Ausgaben lassen sich antippen – dann zeigt alles darunter nur diesen Monat
    const klickbar = !z.zukunft && z.ist > 0;
    const gewaehlt = monatGewaehlt(z.jahr, z.monat);
    const spalte = h('div', {
      class: 'spalte' + (z.aktuell ? ' aktuell' : '') + (z.zukunft ? ' zukunft' : '') + (klickbar ? ' klickbar' : '') + (gewaehlt ? ' gewaehlt' : ''),
      tabindex: '0',
      role: klickbar ? 'button' : null,
      'aria-pressed': klickbar ? String(gewaehlt) : null,
      title: klickbar ? (gewaehlt ? 'Monatsauswahl aufheben' : 'Nur diesen Monat auswerten') : null,
      'aria-label': `${formatMonat(z.jahr, z.monat)}: gebucht ${formatEuro(z.ist)}` + (z.erwartet != null ? `, erwartet ${formatEuro(z.erwartet)}` : ''),
      onclick: klickbar ? () => waehleMonat(z.jahr, z.monat) : null,
      onkeydown: klickbar ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); waehleMonat(z.jahr, z.monat); } } : null,
    },
    h('div', { class: 'balken-paar' + (mitVorjahr ? ' mit-vorjahr' : '') },
      // D127: Vorjahresbalken nur, wo es im Vorjahr Werte gibt
      mitVorjahr && v?.ausgaben > 0 && h('div', { class: 'balken ausgabe vorjahr', style: hoehe(v.ausgaben) }),
      // gestapelt: unten gebucht, oben (heller) erwartet
      h('div', { class: 'balken-stapel', style: hoehe(z.ist + (z.erwartet ?? 0)) },
        z.erwartet > 0 && h('div', { class: 'balken ausgabe offen-teil', style: `flex:${z.erwartet}` }),
        z.ist > 0 && h('div', { class: 'balken ausgabe', style: `flex:${z.ist}` }))),
    h('div', { class: 'spalte-label' }, kurz(z)));
    spalte.addEventListener('mouseenter', () => zeigeTooltip(spalte, z, v));
    spalte.addEventListener('focus', () => zeigeTooltip(spalte, z, v));
    spalte.addEventListener('mouseleave', () => { tooltip.hidden = true; });
    spalte.addEventListener('blur', () => { tooltip.hidden = true; });
    return spalte;
  });

  // Am Handy ist das Diagramm breiter als der Bildschirm: zuerst den laufenden Monat zeigen
  // D128: Gitter innerhalb der Spalten – so reicht es über die volle (auch gescrollte) Breite
  const flaeche = h('div', { class: 'diagramm-flaeche' },
    h('div', { class: 'spalten', style: `min-width:${zeilen.length * (mitVorjahr ? 46 : 40)}px` },
      h('div', { class: 'gitter' }, ticks.map((t) => h('span', { style: `bottom:${t * 100}%` }))),
      spalten),
    tooltip);
  requestAnimationFrame(() => {
    const aktuell = flaeche.querySelector('.spalte.aktuell');
    if (aktuell && flaeche.scrollWidth > flaeche.clientWidth) flaeche.scrollLeft = aktuell.offsetLeft - flaeche.clientWidth / 2;
  });

  return h('section', { class: 'bereich' }, kopf, legende, hinweis,
    h('div', { class: 'diagramm' },
      h('div', { class: 'achse' }, [...ticks].reverse().map((t) => h('span', {}, formatEuroRund(max * t)))),
      flaeche));
}

/** D128: Ist dieser Monat gerade als Zeitraum gewählt (über einen Balken im Diagramm)? */
function monatGewaehlt(jahr, monat) {
  const f = zustand.filter;
  const von = `${jahr}-${String(monat).padStart(2, '0')}-01`;
  return f.zeitraum === 'eigen' && f.von === von && f.bis === monatsende(von);
}

/** D128: Balken antippen – nur diesen Monat auswerten; erneut antippen stellt den vorigen Zeitraum wieder her */
function waehleMonat(jahr, monat) {
  const f = zustand.filter;
  if (monatGewaehlt(jahr, monat)) {
    const vorher = zustand.vorMonatswahl ?? { zeitraum: STANDARD_FILTER.zeitraum, von: '', bis: '' };
    Object.assign(f, vorher);
    zustand.vorMonatswahl = null;
  } else {
    if (!zustand.vorMonatswahl) zustand.vorMonatswahl = { zeitraum: f.zeitraum, von: f.von, bis: f.bis };
    const von = `${jahr}-${String(monat).padStart(2, '0')}-01`;
    Object.assign(f, { zeitraum: 'eigen', von, bis: monatsende(von) });
  }
  zustand.sichtbar = SEITE;
  window.dispatchEvent(new Event('daten-geaendert')); // alles neu zeichnen (auch die Zeitraum-Kacheln)
}

/** Veränderung zum Vorjahr als Text, z. B. " (+12 % zum Vorjahr)" (ohne Vorjahreswert leer) */
function veraenderung(jetzt, vorher) {
  if (!vorher) return '';
  const p = Math.round(((jetzt - vorher) / vorher) * 100);
  return ` (${p > 0 ? '+' : ''}${p} %)`;
}

/**
 * D125/D129: auf eine Kategorie (Haupt- oder Unterkategorie) filtern. Man bleibt in der Analyse –
 * Diagramm, Summen und die Liste („Liste“) folgen dem Filter. Erneut antippen hebt den Filter auf.
 */
function filtereKategorie(id) {
  const schon = zustand.filter.kategorieIds.length === 1 && zustand.filter.kategorieIds[0] === id;
  zustand.filter.kategorieIds = schon ? [] : [id];
  zustand.sichtbar = SEITE;
  window.dispatchEvent(new Event('daten-geaendert'));
}

/**
 * Summen je Haupt-/Unterkategorie mit Anteil und Durchschnitt pro Monat.
 * D125: Vergleich zur Vorperiode, Ist vs. Budget (nur Ausgaben).
 * D128: Haupt- oder Unterkategorie antippen filtert die Liste; „+“ klappt die Unterkategorien auf.
 */
function kategorieBereich(eintraege, daten, monate, heute, neu, erster) {
  const { kategorien } = daten;
  // Ø nur über abgeschlossene Monate – der laufende Monat würde ihn verfälschen
  const schnittMonate = abgeschlosseneMonate(monate, heute);
  const anzahlMonate = schnittMonate.length;
  const art = eineGefilterteArt() ?? zustand.analyseArt;
  const gruppen = summenJeKategorie(eintraege, kategorien, art, schnittMonate);
  const gesamt = gruppen.reduce((s, g) => s + g.summe, 0);
  const gesamtSchnitt = anzahlMonate ? Math.round(gruppen.reduce((s, g) => s + g.schnittSumme, 0) / anzahlMonate) : null;
  // D128: Anteilsbalken wieder für Haupt- und Unterkategorien (der Verlauf steht im Diagramm darüber)
  const max = Math.max(...gruppen.map((g) => g.summe), 1);
  const mitSchnitt = anzahlMonate > 0 && monate.length > 1;
  const balken = (summe) => h('span', { class: 'kat-balken-spur', 'aria-hidden': 'true' },
    h('span', { class: `kat-balken ${art}`, style: `width:${(summe / max) * 100}%` }));

  // Vorperiode: dieselben Filter, gleich langer Zeitraum davor – nur, wenn es dort schon erfasste Buchungen
  // gab (sonst sähe „0,00 €“ aus wie „nichts ausgegeben“)
  const vpRoh = vorperiode(zustand.filter, heute);
  const vp = vpRoh && erster && vpRoh.bis >= erster ? vpRoh : null;
  const vpSummen = new Map();
  if (vp) {
    const vpEintraege = filtere(daten.buchungen, { ...zustand.filter, zeitraum: 'eigen', von: vp.von, bis: vp.bis }, { ...daten, heute });
    for (const g of summenJeKategorie(vpEintraege, kategorien, art)) {
      vpSummen.set(g.id, g.summe);
      for (const u of g.unter) vpSummen.set(`u:${u.id}`, u.summe);
    }
  }
  const vpGesamt = [...vpSummen.entries()].filter(([k]) => !k.startsWith('u:')).reduce((s, [, v]) => s + v, 0);
  const vergleich = (jetzt, vorher) => {
    if (!vp) return null;
    const p = veraenderungProzent(jetzt, vorher ?? 0);
    const text = `${vp.text}: ${formatEuro(vorher ?? 0)}` + (p == null ? '' : ` (${p > 0 ? '+' : ''}${p} %)`);
    // Bei Ausgaben ist „mehr“ ungünstig, bei Einnahmen günstig
    const schlecht = p != null && (art === 'ausgabe' ? p > 10 : p < -10);
    return h('span', { class: 'kat-vergleich' + (schlecht ? ' warn-text' : '') }, text);
  };
  // Ist vs. Budget (nur Ausgaben, nur mit abgeschlossenen Monaten); D217: als „+12 %“ hinter dem Ø in derselben
  // Zeile, ohne Warnfarbe – der Budgetbetrag steht im Tooltip
  const budgetAbw = new Map();
  if (art === 'ausgabe' && mitSchnitt) {
    for (const g of gruppen) {
      const budget = budgetSchnitt(daten.budgets ?? [], g.id, schnittMonate, zustand.filter.kontoIds);
      const p = budget == null ? null : veraenderungProzent(g.schnitt, budget);
      if (p != null) budgetAbw.set(g.id, { budget, p });
    }
  }
  const budgetText = (g) => {
    const x = budgetAbw.get(g.id);
    if (!x) return null;
    return h('span', { class: 'kat-budget', title: `Budget Ø ${formatEuro(x.budget)}/Monat` },
      ` · ${x.p > 0 ? '+' : x.p < 0 ? '−' : ''}${Math.abs(x.p)} %`);
  };

  // D128: Zeile antippen = Liste auf diese Hauptkategorie filtern (Diagramm folgt dem Filter);
  // „+“ links klappt die Unterkategorien auf
  const hauptZeile = (g, klapp) => {
    const info = [vergleich(g.summe, vpSummen.get(g.id))].filter(Boolean);
    const filtern = () => g.id !== 'unbekannt' && filtereKategorie(g.id);
    return h('div', {
      class: 'kat-zeile ebene-1 kat-zeile-knopf' + (gewaehlt.has(g.id) ? ' gewaehlt' : ''),
      role: 'button',
      tabindex: '0',
      'aria-pressed': String(gewaehlt.has(g.id)),
      title: gewaehlt.has(g.id) ? 'Filter aufheben' : 'Auf diese Kategorie filtern',
      onclick: filtern,
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); filtern(); } },
    },
    h('span', { class: 'kat-zeile-name' }, klapp, g.name),
    balken(g.summe),
    h('span', { class: 'betrag' }, formatEuro(g.summe)),
    h('span', { class: 'kat-anteil' }, formatProzent(g.anteil)),
    mitSchnitt && h('span', { class: 'kat-schnitt' }, `Ø ${formatEuro(g.schnitt)}`, budgetText(g)),
    info.length > 0 && h('span', { class: 'kat-info' }, info));
  };
  const gewaehlt = new Set(zustand.filter.kategorieIds);
  const unterZeile = (u) => h('button', {
    type: 'button',
    class: 'kat-zeile ebene-2 kat-zeile-knopf' + (gewaehlt.has(u.id) ? ' gewaehlt' : ''),
    'aria-pressed': String(gewaehlt.has(u.id)),
    title: gewaehlt.has(u.id) ? 'Filter aufheben' : 'Auf diese Unterkategorie filtern',
    onclick: () => u.id !== 'unbekannt' && filtereKategorie(u.id),
  },
  h('span', { class: 'kat-zeile-name' }, u.name),
  balken(u.summe),
  h('span', { class: 'betrag' }, formatEuro(u.summe)),
  h('span', { class: 'kat-anteil' }, formatProzent(u.anteil)),
  mitSchnitt && h('span', { class: 'kat-schnitt' }, `Ø ${formatEuro(u.schnitt)}`));

  return h('section', { class: 'bereich' },
    h('div', { class: 'bereich-kopf' }, h('h2', {}, 'Nach Kategorien')),
    gruppeWahl(neu),
    artWahlAnalyse(neu),
    gruppen.length === 0
      ? h('p', { class: 'leer' }, art === 'ausgabe' ? 'Keine Ausgaben in der Auswahl.' : 'Keine Einnahmen in der Auswahl.')
      : h('div', { class: 'kat-tabelle' + (mitSchnitt ? ' mit-schnitt' : '') + (budgetAbw.size > 0 ? ' mit-budget' : '') },
        h('div', { class: 'kat-zeile kat-kopf', 'aria-hidden': 'true' },
          h('span', {}, 'Kategorie'), h('span', {}), h('span', {}, 'Summe'), h('span', {}, 'Anteil'),
          mitSchnitt && h('span', {}, budgetAbw.size > 0 ? 'Ø/Monat · Budget' : 'Ø/Monat')),
        gruppen.map((g) => {
          const offen = zustand.offen.has(g.id) || g.unter.some((u) => gewaehlt.has(u.id));
          const unter = h('div', { class: 'kat-unter', hidden: !offen }, g.unter.map(unterZeile));
          const klapp = h('button', {
            type: 'button',
            class: 'kat-klapp',
            'aria-expanded': String(offen),
            'aria-label': `Unterkategorien von ${g.name} ${offen ? 'zuklappen' : 'aufklappen'}`,
            onclick: (e) => {
              e.stopPropagation(); // nicht gleichzeitig filtern
              const auf = unter.hidden;
              unter.hidden = !auf;
              klapp.textContent = auf ? '−' : '+';
              klapp.setAttribute('aria-expanded', String(auf));
              if (auf) zustand.offen.add(g.id); else zustand.offen.delete(g.id);
            },
          }, offen ? '−' : '+');
          return h('div', { class: 'kat-gruppe' }, hauptZeile(g, klapp), unter);
        }),
        h('div', { class: 'kat-zeile summe-zeile' },
          h('span', { class: 'kat-zeile-name' }, 'Gesamt'),
          h('span', {}),
          h('span', { class: 'betrag' }, formatEuro(gesamt)),
          h('span', { class: 'kat-anteil' }, '100 %'),
          mitSchnitt && h('span', { class: 'kat-schnitt' }, `Ø ${formatEuro(gesamtSchnitt)}`),
          vp && h('span', { class: 'kat-info' }, vergleich(gesamt, vpGesamt)))),
    h('p', { class: 'hinweis erklaerung' },
      'Eine Kategorie antippen filtert darauf – Diagramm, Summen und die Liste folgen; erneut antippen hebt den Filter auf. '
      + '„+“ klappt die Unterkategorien auf; ihr Anteil bezieht sich auf die Hauptkategorie. '
      + (mitSchnitt ? `Ø = Durchschnitt pro Monat über ${anzahlMonate === 1 ? '1 abgeschlossenen Monat' : `${anzahlMonate} abgeschlossene Monate`} `
        + `(${formatMonat(...schnittMonate[0])}${anzahlMonate > 1 ? ` bis ${formatMonat(...schnittMonate.at(-1))}` : ''}); der laufende Monat zählt nicht mit. ` : '')
      + (budgetAbw.size > 0 ? '„+12 %“ hinter dem Ø = so weit liegt der Ø über (bzw. bei „−“ unter) dem Budget; Budget = Monatsbudgets im selben Zeitraum, '
        + 'Jahresbudgets mit einem Zwölftel je Monat (Betrag beim Draufzeigen). ' : '')
      + (vp ? `Vergleichszeitraum „${vp.text}“: ${formatDatum(vp.von)} – ${formatDatum(vp.bis)}, mit denselben Filtern.` : '')),
  );
}

/** D125: die zehn größten Einzelbuchungen der gewählten Art im Zeitraum – antippen öffnet die Buchung */
function groessteBereich(eintraege, daten, neu) {
  const art = eineGefilterteArt() ?? zustand.analyseArt;
  const top = groessteBuchungen(eintraege, art, 10);
  if (top.length === 0) return null;
  const kat = new Map(daten.kategorien.map((k) => [k.id, k]));
  return h('section', { class: 'bereich groesste' },
    h('div', { class: 'bereich-kopf' }, h('h2', {}, art === 'ausgabe' ? 'Größte Ausgaben' : 'Größte Einnahmen')),
    h('ol', { class: 'groesste-liste' }, top.map(({ buchung: b }) => {
      const unter = kat.get(b.kategorieId);
      const titel = b.partner?.trim() || unter?.name || 'Buchung';
      const katText = [kat.get(unter?.elternId)?.name, unter?.name].filter(Boolean).join(' › ');
      return h('li', {},
        h('button', {
          type: 'button',
          class: 'groesste-zeile',
          onclick: () => (b.archivJahr ? toast(`Archiv ${b.archivJahr}: nur lesen.`) : oeffneBuchungsdialog(b)),
        },
        h('span', { class: 'groesste-text' },
          h('span', { class: 'groesste-titel' }, titel),
          h('span', { class: 'klein' }, `${formatDatum(b.datum)}${katText && katText !== titel ? ` · ${katText}` : ''}`)),
        h('span', { class: 'betrag' + (art === 'einnahme' ? ' plus' : '') }, (art === 'einnahme' ? '+' : '−') + formatEuro(b.betragCent))));
    })));
}
