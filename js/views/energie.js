// D233: Bereich „Energie“ unter Annahmen – Abschlagsrechner für Strom und Gas.
// Je Zähler: Tarif, Zählerstände, Hochrechnung aufs Abrechnungsjahr, voraussichtliche Nachzahlung bzw.
// Guthaben und ein Vorschlag für den Abschlag. Geändert wird nur nach einem Klick (Abschlag übernehmen,
// Nachzahlung/Guthaben in die Prognose). Dazu der Hinweis „Zählerstände erfassen“ am Monatsletzten.

import { h } from '../dom.js';
import * as db from '../db.js';
import { formatEuro, formatDatum, heuteIso, parseEuro, centZuEingabe } from '../format.js';
import { dialog, frage, toast, eingabe, auswahl, datenGeaendert, klappBereich, geraet, verbinde } from '../ui.js';
import { plusTage } from '../vertraege.js';
import { naechsterTermin } from '../prognose.js';
import { geplantErledigt } from '../annahmen.js';
import {
  ART_TEXT, parseZahl, zahlText, zeitraum, abschlagsRechnung, baueZaehler, mitAblesung, ohneAblesung, ablesungsVerlauf,
  mitNeuemAbschlag, faktor,
} from '../energie.js';
import { geplantDialog } from './annahmen.js';

const offen = new Set(); // aufgeklappte Zähler, solange die App offen ist
let hinweisOffen = false;
const einheitText = (z) => (z.einheit === 'm3' ? 'm³' : 'kWh');
const kwhText = (x) => `${zahlText(Math.round(x))} kWh`;
const ctText = (x) => `${zahlText(x, 4)} ct`;
const nachName = (a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' });
/** Vorschlag weicht kaum vom aktuellen Abschlag ab? (bis 2 €) */
const kaumAnders = (a, b) => Math.abs(a - b) <= 200;

/** Ergebnis als Text: „≈ 36 € Nachzahlung“ / „≈ 4 € Guthaben“ */
function saldoText(cent) {
  if (cent == null) return null;
  if (Math.abs(cent) < 100) return 'passt genau';
  return cent > 0 ? `≈ ${formatEuro(cent)} Nachzahlung` : `≈ ${formatEuro(-cent)} Guthaben`;
}

/**
 * Der Bereich unter Annahmen.
 * daten: braucht zaehler, vertraege, wiederkehrend, buchungen, geplant, konten, kategorien
 */
export function energieBereich(daten) {
  const heute = heuteIso();
  const zaehler = [...(daten.zaehler ?? [])].sort((a, b) => (a.aktiv === false) - (b.aktiv === false) || nachName(a, b));
  return h('section', { class: 'bereich vertraege energie', 'aria-labelledby': 'titel-energie' }, ...[
    h('div', { class: 'bereich-kopf' },
      h('h2', { id: 'titel-energie' }, 'Energie'),
      h('div', { class: 'knopfreihe' },
        zaehler.some((z) => z.aktiv !== false) && h('button', { type: 'button', class: 'knopf', onclick: () => ablesungDialog(daten) }, 'Zählerstände'),
        h('button', { type: 'button', class: 'knopf knopf-primaer', onclick: () => zaehlerDialog(null, daten) }, '+ Zähler'))),
    h('p', { class: 'hinweis erklaerung' },
      'Abschlagsrechner für Strom und Gas. Aus deinen Zählerständen rechnet die App den Verbrauch aufs ganze Abrechnungsjahr hoch – ' +
      'Strom gleichmäßig, Gas nach der üblichen Gradtagszahlen-Verteilung (im Winter viel, im Sommer wenig). Mit Arbeits- und Grundpreis ' +
      'ergeben sich die erwarteten Kosten. Die gezahlten Abschläge kommen aus den Buchungen des verknüpften Vertrags. Daraus folgen die ' +
      'voraussichtliche Nachzahlung bzw. das Guthaben und ein Vorschlag für den Abschlag. Geändert wird nur, wenn du auf „Übernehmen“ tippst. ' +
      'Am Monatsletzten erinnert die Übersicht ans Ablesen.'),
    zaehler.length === 0
      ? h('p', { class: 'leer' }, 'Noch keine Zähler. Lege mit „+ Zähler“ deinen Strom- bzw. Gaszähler an.')
      : h('ul', { class: 'vertrag-liste' }, zaehler.map((z) => h('li', {}, zaehlerZeile(z, daten, heute)))),
  ].filter(Boolean));
}

/** Eine aufklappbare Zeile je Zähler */
function zaehlerZeile(z, daten, heute) {
  const r = abschlagsRechnung(z, daten, heute);
  const vertrag = (daten.vertraege ?? []).find((v) => v.id === z.vertragId);
  const aktuellCent = r.abschlag ? (r.offen[0]?.betragCent ?? null) : null;
  const geplant = z.geplantId && (daten.geplant ?? []).find((g) => g.id === z.geplantId);
  const geplantOffen = geplant && !geplantErledigt(geplant, daten.buchungen ?? []) ? geplant : null;

  const angabe = (titel, ...wert) => h('div', { class: 'vertrag-angabe' }, h('span', { class: 'klein gedaempft' }, titel), h('span', {}, ...wert));
  const preis = (z.preise ?? []).length ? z.preise.filter((p) => p.ab <= heute).at(-1) ?? z.preise[0] : null;

  let rechts;
  if (z.aktiv === false) rechts = h('span', { class: 'vertrag-kosten klein gedaempft' }, 'ausgeschaltet');
  else if (r.fehlt) rechts = h('span', { class: 'vertrag-kosten klein warn-text' }, r.fehlt === 'preis' ? '⚠ Preis fehlt' : '⚠ Zählerstand fehlt');
  else {
    rechts = h('span', { class: 'betrag annahme vertrag-kosten' },
      r.saldoCent != null && h('strong', { class: r.saldoCent >= 100 ? 'negativ' : r.saldoCent <= -100 ? 'plus' : '' }, saldoText(r.saldoCent)),
      r.saldoCent == null && h('strong', {}, `≈ ${formatEuro(r.jahresCent)} / Jahr`));
  }

  const inhalt = [];
  const angaben = [
    angabe('Abrechnungsjahr', `${formatDatum(r.zr.start)} – ${formatDatum(r.zr.ende)}`),
    vertrag && angabe('Vertrag', verbinde([vertrag.name, vertrag.anbieter].filter(Boolean))),
    z.zaehlernummer && angabe('Zählernummer', z.zaehlernummer),
    preis && angabe('Preis', `${ctText(preis.arbeitCt)} je kWh · Grundpreis ${formatEuro(preis.grundCent)} / Monat`
      + ((z.preise ?? []).some((p) => p.ab > heute) ? ' · Preisänderung geplant' : '')),
    z.einheit === 'm3' && angabe('Umrechnung', `1 m³ = ${zahlText(faktor(z), 4)} kWh (Brennwert ${zahlText(z.brennwert, 4)} × Zustandszahl ${zahlText(z.zustandszahl, 4)})`),
  ];
  if (r.v?.quelle === 'ablesung') {
    angaben.push(angabe('Gemessen', `${kwhText(r.v.kwh)} vom ${formatDatum(r.v.von)} bis ${formatDatum(r.v.bis)} (${r.v.tage} Tage)`,
      r.v.ungenau ? h('span', { class: 'warn-text' }, ' · noch ungenau, wird mit jeder Ablesung besser') : ''));
  } else if (r.v?.quelle === 'vorjahr') {
    angaben.push(angabe('Grundlage', `Vorjahresverbrauch ${kwhText(r.v.kwh)} – genauer wird es mit zwei Zählerständen`));
  }
  if (!r.fehlt) {
    angaben.push(
      angabe('Hochrechnung', `≈ ${kwhText(r.jahresKwh)} · Kosten ≈ ${formatEuro(r.jahresCent)} im Abrechnungsjahr`),
      angabe('Bisher gezahlt', `${formatEuro(r.gezahltCent)}`
        + (r.gezahlt.length ? ` (${r.gezahlt.length} ${r.gezahlt.length === 1 ? 'Buchung' : 'Buchungen'}` + (r.manuell ? ` + ${formatEuro(r.manuell.cent)} bis ${formatDatum(r.manuell.bis)} von Hand)` : ')') : r.manuell ? ` (von Hand bis ${formatDatum(r.manuell.bis)})` : '')),
      r.abschlag
        ? angabe('Noch erwartet', r.offen.length
          ? `${r.offen.length} ${r.offen.length === 1 ? 'Abschlag' : 'Abschläge'} · ${formatEuro(r.offenCent)}` + (aktuellCent != null ? ` (je ${formatEuro(aktuellCent)})` : '')
          : 'keine Abschläge mehr bis zur Abrechnung')
        : angabe('Abschlag', h('span', { class: 'warn-text' }, z.vertragId
          ? 'Der Vertrag hat keine wiederkehrende Ausgabe – lege dort den Abschlag als wiederkehrende Buchung an.'
          : 'Verknüpfe einen Vertrag mit dem Abschlag als wiederkehrender Buchung, dann rechnet die App mit den echten Zahlungen.')),
      r.saldoCent != null && angabe('Ergebnis', h('strong', {}, saldoText(r.saldoCent)), ` zur Abrechnung am ${formatDatum(r.zr.ende)}`),
      r.vorschlagCent != null && (r.abschlag || r.manuell) && angabe('Vorschlag', h('strong', {}, `${formatEuro(r.vorschlagCent)} / Monat`), ' bis zur Abrechnung',
        aktuellCent != null ? (kaumAnders(r.vorschlagCent, aktuellCent) ? ' – dein Abschlag passt' : ` (jetzt ${formatEuro(aktuellCent)})`) : ''),
      angabe('Neues Abrechnungsjahr', `ab ${formatDatum(r.folge.zr.start)}: ≈ ${formatEuro(r.folge.cent)} → `, h('strong', {}, `${formatEuro(r.folge.vorschlagCent)} / Monat`)),
      geplantOffen && angabe('In der Prognose', `${geplantOffen.art === 'einnahme' ? 'Guthaben' : 'Nachzahlung'} ${formatEuro(geplantOffen.betragCent)} am ${formatDatum(geplantOffen.datum)}`,
        r.saldoCent != null && Math.abs(Math.abs(r.saldoCent) - geplantOffen.betragCent) > 500 ? h('span', { class: 'warn-text' }, ' · weicht vom Ergebnis ab') : ''),
    );
  }
  angaben.push(z.notiz && angabe('Notiz', z.notiz));
  inhalt.push(h('div', { class: 'vertrag-angaben' }, ...angaben.filter(Boolean)));

  // Zählerstände mit Verbrauch dazwischen
  const verlauf = new Map(ablesungsVerlauf(z).map((x) => [x.bis, x]));
  const ablesungen = [...(z.ablesungen ?? [])].sort((a, b) => b.datum.localeCompare(a.datum));
  inhalt.push(h('div', { class: 'tag-kopf' }, h('span', {}, `Zählerstände (${ablesungen.length})`)));
  inhalt.push(ablesungen.length
    ? h('div', { class: 'tabelle-rahmen' }, h('table', { class: 'tabelle' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Datum'), h('th', {}, `Stand (${einheitText(z)})`), h('th', {}, 'Verbrauch'), h('th', {}, 'je Tag'), h('th', {}, ''))),
      h('tbody', {}, ablesungen.slice(0, 13).map((a) => {
        const x = verlauf.get(a.datum);
        return h('tr', {},
          h('td', {}, formatDatum(a.datum)),
          h('td', {}, zahlText(a.stand, 3)),
          h('td', {}, x ? kwhText(x.kwh) : '–'),
          h('td', {}, x?.kwhJeTag != null ? `${zahlText(x.kwhJeTag, 1)} kWh` : '–'),
          h('td', {}, h('button', {
            type: 'button', class: 'knopf knopf-klein', 'aria-label': `Zählerstand vom ${formatDatum(a.datum)} löschen`,
            onclick: async () => {
              const ok = await frage({ titel: 'Zählerstand löschen?', text: `Stand ${zahlText(a.stand, 3)} ${einheitText(z)} vom ${formatDatum(a.datum)}.`, jaText: 'Löschen', gefahr: true });
              if (!ok) return;
              await db.speichere('zaehler', ohneAblesung(z, a.datum));
              datenGeaendert();
            },
          }, '✕')));
      }))))
    : h('p', { class: 'leer' }, 'Noch keine Zählerstände.'));

  inhalt.push(h('div', { class: 'knopfreihe' }, ...[
    h('button', { type: 'button', class: 'knopf knopf-klein knopf-primaer', onclick: () => ablesungDialog(daten, z) }, 'Zählerstand …'),
    !r.fehlt && r.abschlag && h('button', { type: 'button', class: 'knopf knopf-klein', onclick: () => abschlagDialog(z, r, daten) }, 'Abschlag übernehmen …'),
    !r.fehlt && r.saldoCent != null && (Math.abs(r.saldoCent) >= 100 || geplantOffen) && h('button', {
      type: 'button', class: 'knopf knopf-klein', onclick: () => prognoseDialog(z, r, daten, geplantOffen),
    }, geplantOffen ? 'Prognose aktualisieren …' : 'In die Prognose …'),
    h('button', { type: 'button', class: 'knopf knopf-klein', onclick: () => zaehlerDialog(z, daten) }, 'Bearbeiten'),
  ].filter(Boolean)));

  const d = h('details', { class: 'vertrag', open: offen.has(z.id) },
    h('summary', { class: 'vertrag-kopf' },
      h('span', { class: 'vertrag-name' }, h('strong', {}, z.name), h('span', { class: 'klein gedaempft' }, ` · ${ART_TEXT[z.art]}`)),
      h('span', { class: 'vertrag-stand klein gedaempft' }, h('span', { class: 'nur-breit' }, `Abrechnung ${formatDatum(r.zr.ende)}`)),
      rechts),
    h('div', { class: 'vertrag-inhalt' }, ...inhalt));
  d.addEventListener('toggle', () => { if (d.open) offen.add(z.id); else offen.delete(z.id); });
  return d;
}

/* =========================== Dialoge =========================== */

/** Zählerstände erfassen – alle eingeschalteten Zähler auf einmal (oder nur einer) */
export function ablesungDialog(daten, nur = null) {
  const liste = nur ? [nur] : (daten.zaehler ?? []).filter((z) => z.aktiv !== false).sort(nachName);
  const datum = eingabe({ label: 'Datum', type: 'date', value: heuteIso() });
  const felder = liste.map((z) => {
    const letzte = [...(z.ablesungen ?? [])].sort((a, b) => a.datum.localeCompare(b.datum)).at(-1);
    return {
      z,
      ...eingabe({
        label: `${z.name} (${einheitText(z)})`, inputmode: 'decimal', placeholder: letzte ? zahlText(letzte.stand, 3) : 'z. B. 12345,6',
        hilfe: letzte ? `Zuletzt ${zahlText(letzte.stand, 3)} am ${formatDatum(letzte.datum)}` : null,
        autofocus: liste.length === 1 || undefined,
      }),
    };
  });
  dialog({
    titel: nur ? `Zählerstand · ${nur.name}` : 'Zählerstände erfassen',
    inhalt: [datum.feld, ...felder.map((f) => f.feld),
      liste.length > 1 && h('p', { class: 'feld-hilfe' }, 'Leer gelassene Zähler werden übersprungen.')],
    onSpeichern: async () => {
      const neu = [];
      for (const f of felder) {
        const stand = parseZahl(f.input.value, f.z.name);
        if (stand == null) continue;
        neu.push(mitAblesung(f.z, { datum: datum.input.value, stand }));
      }
      if (!neu.length) throw new Error('Bitte mindestens einen Zählerstand eingeben.');
      await db.speichere('zaehler', neu);
      toast(neu.length === 1 ? 'Zählerstand gespeichert' : `${neu.length} Zählerstände gespeichert`);
      datenGeaendert();
    },
  });
}

/** Abschlag in die wiederkehrende Buchung übernehmen (ab einem Termin, als neue Betragsstufe) */
function abschlagDialog(z, r, daten) {
  const w = r.abschlag;
  const heute = heuteIso();
  const folgeTermin = naechsterTermin(w, r.folge.zr.start);
  const optionen = [];
  if (r.vorschlagCent != null && r.offen.length) {
    optionen.push({ wert: 'jetzt', text: `Bis zur Abrechnung: ${formatEuro(r.vorschlagCent)}`, ab: r.offen[0].termin, cent: r.vorschlagCent });
  }
  if (folgeTermin) optionen.push({ wert: 'folge', text: `Neues Abrechnungsjahr: ${formatEuro(r.folge.vorschlagCent)}`, ab: folgeTermin.termin, cent: r.folge.vorschlagCent });
  if (!optionen.length) { toast('Kein offener Termin der Abschlag-Buchung gefunden.'); return; }
  const wahl = auswahl({ label: 'Vorschlag', optionen: optionen.map(({ wert, text }) => ({ wert, text })), wert: optionen[0].wert });
  const betrag = eingabe({ label: 'Neuer Abschlag in €', inputmode: 'decimal', class: 'eingabe-betrag' });
  const ab = eingabe({ label: 'Gilt ab Termin', type: 'date', hilfe: 'Ab diesem Termin rechnet die wiederkehrende Buchung (und damit die Prognose) mit dem neuen Betrag.' });
  const setze = () => {
    const o = optionen.find((x) => x.wert === wahl.select.value);
    betrag.input.value = centZuEingabe(o.cent);
    ab.input.value = o.ab;
  };
  wahl.select.addEventListener('change', setze);
  setze();
  dialog({
    titel: `Abschlag · ${z.name}`,
    inhalt: [
      h('p', {}, `Aktuell: ${formatEuro(r.offen[0]?.betragCent ?? 0)}. Ändere den Abschlag auch bei deinem Anbieter – die App ändert nur ihre Planung.`),
      wahl.feld, h('div', { class: 'feld-paar' }, betrag.feld, ab.feld),
    ],
    speichernText: 'Übernehmen',
    onSpeichern: async () => {
      const cent = parseEuro(betrag.input.value, 'Abschlag');
      if (!ab.input.value || ab.input.value < heute.slice(0, 8) + '01') throw new Error('Bitte einen Termin ab diesem Monat wählen.');
      await db.speichere('wiederkehrend', mitNeuemAbschlag(w, ab.input.value, cent));
      toast(`Abschlag ${formatEuro(cent)} ab ${formatDatum(ab.input.value)} übernommen`);
      datenGeaendert();
    },
  });
}

/** Nachzahlung bzw. Guthaben als geplante Einmalbuchung (Dialog vorbefüllt, gespeichert erst nach Klick) */
function prognoseDialog(z, r, daten, geplantOffen) {
  const nachzahlung = r.saldoCent > 0;
  const art = nachzahlung ? 'ausgabe' : 'einnahme';
  const betragCent = Math.max(100, Math.round(Math.abs(r.saldoCent) / 100) * 100);
  const vertrag = (daten.vertraege ?? []).find((v) => v.id === z.vertragId);
  const bezeichnung = `${ART_TEXT[z.art]}-${nachzahlung ? 'Nachzahlung' : 'Guthaben'} ${r.zr.ende.slice(0, 4)}`;
  const datum = plusTage(r.zr.ende, 45); // Abrechnung kommt meist einige Wochen nach dem Ende des Abrechnungsjahres
  const nachSpeichern = async (g) => {
    const aktuell = (await db.alle('zaehler')).find((x) => x.id === z.id) ?? z;
    if (aktuell.geplantId !== g.id) await db.speichere('zaehler', { ...aktuell, geplantId: g.id, geaendertAm: new Date().toISOString() });
  };
  if (geplantOffen) {
    // Vorhandene Planung mit dem neuen Ergebnis vorbefüllen; die Kategorie passt nur bei gleicher Art
    const g = { ...geplantOffen, art, betragCent, bezeichnung, kategorieId: geplantOffen.art === art ? geplantOffen.kategorieId : (art === 'ausgabe' ? r.abschlag.kategorieId : null) };
    geplantDialog(g, daten, { nachSpeichern });
    return;
  }
  geplantDialog(null, daten, {
    art, betragCent, bezeichnung, datum,
    kontoId: r.abschlag.kontoId,
    kategorieId: art === 'ausgabe' ? r.abschlag.kategorieId : undefined,
    partner: vertrag?.anbieter ?? r.abschlag.partner ?? '',
    nachSpeichern,
  });
}

/** Zähler anlegen/bearbeiten */
export function zaehlerDialog(z, daten) {
  const heute = heuteIso();
  const name = eingabe({ label: 'Name', value: z?.name ?? '', maxlength: 60, placeholder: 'z. B. Strom Haus', autofocus: !z });
  const art = auswahl({ label: 'Art', optionen: [{ wert: 'strom', text: 'Strom' }, { wert: 'gas', text: 'Gas' }], wert: z?.art ?? 'strom' });
  const einheit = auswahl({
    label: 'Zähler zeigt', optionen: [{ wert: 'm3', text: 'Kubikmeter (m³)' }, { wert: 'kwh', text: 'Kilowattstunden (kWh)' }], wert: z?.einheit ?? 'm3',
  });
  const brennwert = eingabe({ label: 'Brennwert', inputmode: 'decimal', value: zahlText(z?.brennwert, 4), placeholder: 'z. B. 11,2', hilfe: 'Steht auf der Gasrechnung (kWh je m³).' });
  const zustand = eingabe({ label: 'Zustandszahl', inputmode: 'decimal', value: zahlText(z?.zustandszahl, 4), placeholder: 'z. B. 0,9563', hilfe: 'Steht ebenfalls auf der Gasrechnung.' });
  const nummer = eingabe({ label: 'Zählernummer (optional)', value: z?.zaehlernummer ?? '', maxlength: 40 });
  const vertraege = [...(daten.vertraege ?? [])].sort(nachName);
  const vertrag = auswahl({
    label: 'Vertrag',
    optionen: [{ wert: '', text: 'Kein Vertrag' }, ...vertraege.map((v) => ({ wert: v.id, text: v.anbieter ? `${v.name} · ${v.anbieter}` : v.name }))],
    wert: z?.vertragId ?? '',
    hilfe: 'Über den Vertrag findet die App den Abschlag (wiederkehrende Buchung) und die gezahlten Abschläge.',
  });
  // Ende des Abrechnungsjahres: als Datum gewählt, gespeichert wird nur Tag und Monat
  const endeVorgabe = z ? zeitraum(z, heute).ende : '';
  const ende = eingabe({ label: 'Ende des Abrechnungsjahres', type: 'date', value: endeVorgabe, hilfe: 'Z. B. 31.03. – steht auf der letzten Jahresabrechnung. Das Jahr ist egal, es zählen Tag und Monat.' });

  // Preise mit „gilt ab“
  const preisZeilen = [];
  const preisListe = h('div', { class: 'stufen' });
  const neuePreisZeile = (p) => {
    const ab = h('input', { type: 'date', value: p?.ab ?? '', 'aria-label': 'Gilt ab' });
    const arbeit = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'ct/kWh', value: zahlText(p?.arbeitCt, 4), 'aria-label': 'Arbeitspreis in ct je kWh' });
    const grund = h('input', { type: 'text', inputmode: 'decimal', placeholder: '€/Monat', value: p ? centZuEingabe(p.grundCent) : '', 'aria-label': 'Grundpreis in € je Monat' });
    const eintrag = { ab, arbeit, grund };
    const zeile = h('div', { class: 'stufe stufe-preis' }, ab, arbeit, grund, h('button', {
      type: 'button', class: 'knopf knopf-klein', 'aria-label': 'Preis entfernen',
      onclick: () => { zeile.remove(); preisZeilen.splice(preisZeilen.indexOf(eintrag), 1); },
    }, '✕'));
    preisZeilen.push(eintrag);
    preisListe.append(zeile);
  };
  for (const p of z?.preise ?? []) neuePreisZeile(p);
  if (!preisZeilen.length) neuePreisZeile(null);
  const preisFeld = h('div', { class: 'feld' },
    h('span', { class: 'feld-label' }, 'Preise (brutto): gilt ab · Arbeitspreis ct/kWh · Grundpreis €/Monat'),
    preisListe,
    h('button', { type: 'button', class: 'knopf knopf-klein', onclick: () => neuePreisZeile(null) }, '+ Preisänderung ab …'),
    h('small', { class: 'feld-hilfe' }, 'Kommt ein neuer Preis, eine Zeile mit Datum hinzufügen. Grundpreis je Jahr? Dann durch 12 teilen.'));

  const vorjahr = eingabe({ label: 'Vorjahresverbrauch in kWh (optional)', inputmode: 'decimal', value: zahlText(z?.vorjahrKwh), hilfe: 'Laut letzter Abrechnung – wird genutzt, solange noch keine zwei Zählerstände da sind.' });
  const gezahlt = eingabe({ label: 'Bisher gezahlt in € (optional)', inputmode: 'decimal', value: z?.gezahltManuell ? centZuEingabe(z.gezahltManuell.cent) : '', class: 'eingabe-betrag' });
  const gezahltBis = eingabe({ label: 'bis einschließlich', type: 'date', value: z?.gezahltManuell?.bis ?? '' });
  const gezahltHilfe = h('p', { class: 'feld-hilfe' }, 'Summe der Abschläge im laufenden Abrechnungsjahr, die nicht als Buchung in der App stehen (z. B. vor dem Start der App). ' +
    'Buchungen bis zu diesem Tag zählt die App dann nicht noch einmal.');
  // Nur beim Anlegen: Anfangsstand (Ablesung der letzten Abrechnung) und heutiger Stand
  const startStand = !z && eingabe({ label: 'Zählerstand zu Beginn (optional)', inputmode: 'decimal', hilfe: 'Laut letzter Jahresabrechnung („Ablesung neu“).' });
  const startDatum = !z && eingabe({ label: 'abgelesen am', type: 'date' });
  const heuteStand = !z && eingabe({ label: 'Zählerstand heute (optional)', inputmode: 'decimal' });
  const notiz = eingabe({ label: 'Notiz (optional)', value: z?.notiz ?? '', maxlength: 300 });
  const aktiv = h('input', { type: 'checkbox', checked: z?.aktiv !== false });

  const aktualisiere = () => {
    const gas = art.select.value === 'gas';
    einheit.feld.hidden = !gas;
    const m3 = gas && einheit.select.value === 'm3';
    brennwert.feld.hidden = !m3;
    zustand.feld.hidden = !m3;
    for (const f of [startStand, heuteStand]) if (f) f.input.placeholder = m3 ? 'm³' : 'kWh';
  };
  art.select.addEventListener('change', aktualisiere);
  einheit.select.addEventListener('change', aktualisiere);
  // Anfangsdatum = Ende des vorigen Abrechnungsjahres
  ende.input.addEventListener('change', () => {
    if (startDatum && ende.input.value && !startDatum.input.value) startDatum.input.value = plusTage(zeitraum({ abrechnungsEnde: ende.input.value.slice(5) }, heute).start, -1);
  });
  aktualisiere();

  dialog({
    titel: z ? 'Zähler bearbeiten' : 'Neuer Zähler',
    inhalt: [
      name.feld, h('div', { class: 'feld-paar' }, art.feld, einheit.feld),
      h('div', { class: 'feld-paar' }, brennwert.feld, zustand.feld),
      vertrag.feld, ende.feld, preisFeld,
      !z && h('div', { class: 'feld-paar' }, startStand.feld, startDatum.feld),
      !z && heuteStand.feld,
      vorjahr.feld,
      h('div', { class: 'feld-paar' }, gezahlt.feld, gezahltBis.feld), gezahltHilfe,
      nummer.feld, notiz.feld,
      z && h('label', { class: 'schalter feld-schalter' }, aktiv, 'Eingeschaltet (aus = kein Hinweis zum Ablesen)'),
    ],
    zusatz: z && {
      text: 'Löschen',
      variante: 'knopf-gefahr',
      onclick: async (dlg) => {
        const ok = await frage({
          titel: 'Zähler löschen?',
          text: [`Der Zähler „${z.name}“ mit ${(z.ablesungen ?? []).length} Zählerständen wird gelöscht.`,
            'Vertrag, Buchungen und geplante Buchungen bleiben erhalten.'],
          jaText: 'Löschen', gefahr: true,
        });
        if (!ok) return;
        await db.loesche('zaehler', z.id);
        dlg.close();
        toast('Zähler gelöscht');
        datenGeaendert();
      },
    },
    onSpeichern: async () => {
      const m3 = art.select.value === 'gas' && einheit.select.value === 'm3';
      if (!ende.input.value) throw new Error('Bitte das Ende des Abrechnungsjahres wählen.');
      // ohne „gilt ab“: ab Beginn des laufenden Abrechnungsjahres
      const beginn = zeitraum({ abrechnungsEnde: ende.input.value.slice(5) }, heute).start;
      const preise = preisZeilen.filter((p) => p.ab.value || p.arbeit.value.trim() || p.grund.value.trim()).map((p) => ({
        ab: p.ab.value || beginn,
        arbeitCt: parseZahl(p.arbeit.value, 'Arbeitspreis'),
        grundCent: parseEuro(p.grund.value || '0', 'Grundpreis'),
      }));
      const gezahltCent = parseEuro(gezahlt.input.value || '0', 'Bisher gezahlt');
      if (gezahltCent > 0 && !gezahltBis.input.value) throw new Error('Bitte bei „Bisher gezahlt“ das Datum angeben.');
      let neu = baueZaehler({
        name: name.input.value,
        art: art.select.value,
        einheit: einheit.select.value,
        zaehlernummer: nummer.input.value,
        vertragId: vertrag.select.value,
        abrechnungsEnde: ende.input.value.slice(5),
        preise,
        brennwert: m3 ? parseZahl(brennwert.input.value, 'Brennwert') : null,
        zustandszahl: m3 ? parseZahl(zustand.input.value, 'Zustandszahl') : null,
        vorjahrKwh: parseZahl(vorjahr.input.value, 'Vorjahresverbrauch'),
        gezahltManuell: gezahltCent > 0 ? { bis: gezahltBis.input.value, cent: gezahltCent } : null,
        notiz: notiz.input.value,
        aktiv: z ? aktiv.checked : true,
      }, { zaehler: daten.zaehler ?? [], alt: z });
      if (!z) {
        const s0 = parseZahl(startStand.input.value, 'Zählerstand zu Beginn');
        if (s0 != null) {
          if (!startDatum.input.value) throw new Error('Bitte angeben, wann der Anfangsstand abgelesen wurde.');
          neu = mitAblesung(neu, { datum: startDatum.input.value, stand: s0 });
        }
        const s1 = parseZahl(heuteStand.input.value, 'Zählerstand heute');
        if (s1 != null) neu = mitAblesung(neu, { datum: heute, stand: s1 });
      }
      await db.speichere('zaehler', neu);
      offen.add(neu.id);
      toast(z ? 'Gespeichert' : 'Zähler angelegt');
      datenGeaendert();
    },
  });
}

/* =========================== Hinweis in der Übersicht =========================== */

/** Am Monatsletzten (bis 5 Tage danach): „Zählerstände erfassen“ – hinweis aus ablesungsHinweis() */
export function ablesungsHinweisBereich(hinweis, daten) {
  if (!hinweis) return null;
  const monat = new Date(`${hinweis.stichtag}T12:00:00`).toLocaleDateString('de-DE', { month: 'long' });
  const namen = hinweis.zaehler.map((z) => z.name).join(', ');
  return klappBereich({
    klasse: 'hinweise-klapp',
    titel: `Zählerstände · Ende ${monat} ablesen`,
    offen: hinweisOffen,
    beiWechsel: (o) => { hinweisOffen = o; },
  }, h('section', { class: 'bereich hinweiskarte', 'aria-label': 'Zählerstände erfassen' },
    h('p', {}, `Monatsende – Zeit, die Zähler abzulesen: ${namen}. Je mehr Zählerstände, desto genauer der Abschlagsvorschlag unter Annahmen → Energie.`),
    h('div', { class: 'hinweis-aktionen' },
      h('button', { type: 'button', class: 'knopf knopf-primaer', onclick: () => ablesungDialog({ ...daten, zaehler: hinweis.zaehler }) }, 'Erfassen …'),
      h('button', {
        type: 'button', class: 'knopf',
        onclick: () => {
          geraet.schreib('zaehler-hinweis-weg', hinweis.stichtag);
          toast('Erinnerung wieder zum nächsten Monatsende');
          datenGeaendert();
        },
      }, 'Diesen Monat nicht'))));
}
