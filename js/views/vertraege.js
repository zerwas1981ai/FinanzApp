// D148: Bereich „Verträge“ im Tab Projekte (zwischen den Projekten und den relevanten Ausgaben).
// Ein Vertrag ist eine Klammer um mehrere Zahlungen: wiederkehrende und normale Buchungen werden
// ihm über das Feld „Vertrag“ zugeordnet. Dazu Laufzeit, Kündigungsfrist, Erinnerung und Unterlagen.

import { h } from '../dom.js';
import * as db from '../db.js';
import { formatEuro, formatDatum, heuteIso } from '../format.js';
import { dialog, frage, toast, eingabe, auswahl, datenGeaendert, klappBereich, geraet } from '../ui.js';
import {
  baueVertrag, vertragsStand, vertragsKosten, vertragsUebersicht, vertragsBuchungen, endeVorschlag,
  zuordnungsKandidaten, fristText, FRIST_EINHEITEN, STANDARD_ERINNERUNG_TAGE, vertragVon, aktuellerBetrag, plusMonate, plusTage,
} from '../vertraege.js';
import { benenneBelege } from '../relevant.js';
import { gruppeVon } from '../buchungen.js';
import { wirkungCent } from '../rechnen.js';
import { belegeFeld, zeigeBeleg, belegeEntfernen } from './belege.js';
import { oeffneBuchungsdialog, partnerFeld } from './buchung-dialog.js';
import { wiederkehrendDialog } from './annahmen.js';

const INTERVALL = { monatlich: 'monatlich', vierteljaehrlich: 'vierteljährlich', jaehrlich: 'jährlich' };
const nachName = (a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' });
const offen = new Set(); // aufgeklappte Verträge, solange die App offen ist

/** Kurzer Stand-Text und ob er hervorgehoben wird */
export function standText(stand) {
  switch (stand.status) {
    case 'beendet': return { text: `beendet ${formatDatum(stand.ende)}`, warn: false };
    case 'gekuendigt': return { text: `gekündigt zum ${formatDatum(stand.ende)}`, warn: false };
    case 'laeuft-aus': return { text: `endet ${formatDatum(stand.ende)}`, warn: false };
    case 'unbefristet': return { text: 'jederzeit kündbar', warn: false };
    default: return { text: `kündbar bis ${formatDatum(stand.kuendigenBis)}`, warn: stand.erinnern };
  }
}

/**
 * Der Block für die Projekte-Seite.
 * daten: braucht vertraege, wiederkehrend, buchungen, konten, kategorien
 */
export function vertraegeBereich(daten) {
  const heute = heuteIso();
  const mitStand = daten.vertraege.map((v) => ({ v, stand: vertragsStand(v, heute) })).sort((a, b) => nachName(a.v, b.v));
  const laufend = mitStand.filter((x) => x.stand.status !== 'beendet');
  const beendet = mitStand.filter((x) => x.stand.status === 'beendet');
  const summe = vertragsUebersicht(daten.vertraege, daten.wiederkehrend, heute);

  return h('section', { class: 'bereich vertraege', 'aria-labelledby': 'titel-vertraege' }, ...[
    h('div', { class: 'bereich-kopf' },
      h('h2', { id: 'titel-vertraege' }, 'Verträge'),
      h('button', { type: 'button', class: 'knopf knopf-primaer', onclick: () => vertragDialog(null, daten) }, '+ Vertrag')), // D161
    h('p', { class: 'hinweis erklaerung' },
      'Ein Vertrag fasst Zahlungen zusammen, z. B. Handy, Internet, Strom oder Versicherungen. Zuordnen kannst du ' +
      'wiederkehrende und normale Buchungen über das Feld „Vertrag“ – Buchungen aus einer zugeordneten wiederkehrenden ' +
      'Buchung gehören automatisch dazu, auch rückwirkend. Vor Ablauf der Kündigungsfrist erscheint oben in der Übersicht ein Hinweis.'),
    daten.vertraege.length === 0
      ? h('p', { class: 'leer' }, 'Noch keine Verträge.')
      : h('div', { class: 'vertrag-summe' },
        h('span', { class: 'klein' }, summe.anzahl === 1 ? '1 laufender Vertrag' : `${summe.anzahl} laufende Verträge`),
        h('span', { class: 'betrag' }, `${formatEuro(-summe.monatCent)} / Monat`),
        h('span', { class: 'betrag stark' }, `${formatEuro(-summe.jahrCent)} / Jahr`)),
    laufend.length > 0 && h('ul', { class: 'vertrag-liste' }, laufend.map((x) => h('li', {}, vertragZeile(x, daten, heute)))),
    beendet.length > 0 && h('details', { class: 'erledigt-liste' },
      h('summary', {}, `Beendete Verträge (${beendet.length})`),
      h('ul', { class: 'vertrag-liste' }, beendet.map((x) => h('li', {}, vertragZeile(x, daten, heute))))),
  ].filter(Boolean));
}

/** Eine Zeile je Vertrag – aufklappbar mit allen Angaben, Zahlungen und Unterlagen */
function vertragZeile({ v, stand }, daten, heute) {
  const kosten = vertragsKosten(v.id, daten.wiederkehrend, heute);
  const buchungen = vertragsBuchungen(v.id, daten.buchungen, daten.wiederkehrend);
  const st = standText(stand);
  const kontoName = new Map(daten.konten.map((k) => [k.id, k.name]));
  const kat = new Map(daten.kategorien.map((k) => [k.id, k]));

  const angabe = (titel, wert) => wert && h('div', { class: 'vertrag-angabe' }, h('span', { class: 'klein gedaempft' }, titel), h('span', {}, wert));
  const laufzeit = v.mindestlaufzeitMonate
    ? `${v.mindestlaufzeitMonate} Monate` + (v.verlaengerungMonate ? `, dann je ${v.verlaengerungMonate} ${v.verlaengerungMonate === 1 ? 'Monat' : 'Monate'} länger` : ', endet danach von selbst')
    : 'keine Mindestlaufzeit';
  const naechstes = stand.status === 'laufend'
    ? `${formatDatum(stand.ende)} – kündigen bis ${formatDatum(stand.kuendigenBis)} (${stand.tageBisFrist === 0 ? 'heute' : stand.tageBisFrist === 1 ? 'noch 1 Tag' : `noch ${stand.tageBisFrist} Tage`})`
    : stand.status === 'unbefristet' ? `bei Kündigung heute: ${formatDatum(stand.ende)}` : null;

  const wkZeile = (w) => h('li', {},
    h('button', { type: 'button', class: 'buchung zeile-1', onclick: () => wiederkehrendDialog(w, daten) },
      h('span', { class: 'buchung-text' }, h('span', { class: 'buchung-titel' },
        [w.partner || w.notiz || kat.get(w.kategorieId)?.name || 'Wiederkehrend', INTERVALL[w.intervall], kontoName.get(w.kontoId)].filter(Boolean).join(' · '))),
      h('span', { class: 'betrag annahme' + (w.art === 'einnahme' ? ' plus' : '') }, formatEuro((w.art === 'einnahme' ? 1 : -1) * aktuellerBetrag(w, heute)))));
  const buchungZeile = (b) => h('li', {},
    h('button', { type: 'button', class: 'buchung zeile-1', onclick: () => oeffneBuchungsdialog(b) },
      h('span', { class: 'buchung-text' }, h('span', { class: 'buchung-titel' },
        h('span', { class: 'datum-klein' }, formatDatum(b.datum)),
        [b.partner || kat.get(b.kategorieId)?.name || (b.art === 'umbuchung' ? 'Umbuchung' : 'Buchung'), kontoName.get(b.kontoId)].filter(Boolean).join(' · '))),
      h('span', { class: 'betrag' + (wirkungCent(b) > 0 ? ' plus' : '') }, formatEuro(wirkungCent(b)))));

  const MAX_BUCHUNGEN = 6;
  const d = h('details', { class: 'vertrag', open: offen.has(v.id) },
    h('summary', { class: 'vertrag-kopf' },
      h('span', { class: 'vertrag-name' }, h('strong', {}, v.name), v.anbieter && h('span', { class: 'klein gedaempft' }, ` · ${v.anbieter}`)),
      h('span', { class: 'vertrag-stand klein' + (st.warn ? ' warn-text' : ' gedaempft') }, st.text),
      h('span', { class: 'betrag annahme vertrag-kosten' }, kosten.posten.length ? `${formatEuro(-kosten.monatCent)} / Monat` : '')),
    h('div', { class: 'vertrag-inhalt' }, ...[
      h('div', { class: 'vertrag-angaben' }, ...[
        angabe('Vertragsnummer', v.vertragsnummer),
        angabe('Beginn', v.beginn && formatDatum(v.beginn)),
        angabe('Laufzeit', laufzeit),
        angabe('Kündigungsfrist', fristText(v)),
        angabe('Nächstes Vertragsende', naechstes),
        angabe('Kosten', kosten.posten.length ? `${formatEuro(kosten.monatCent)} im Monat · ${formatEuro(kosten.jahrCent)} im Jahr` : 'keine wiederkehrende Buchung zugeordnet'),
        angabe('Notiz', v.notiz),
      ].filter(Boolean)),
      v.belege?.length > 0 && h('div', { class: 'vertrag-unterlagen' },
        h('span', { class: 'klein gedaempft' }, 'Unterlagen'),
        ...v.belege.map((b) => h('button', { type: 'button', class: 'link-knopf', onclick: () => zeigeBeleg(b) }, (b.mime === 'application/pdf' ? '📄 ' : '🖼 ') + b.name))),
      kosten.posten.length > 0 && h('div', {},
        h('div', { class: 'tag-kopf' }, h('span', {}, 'Wiederkehrende Buchungen')),
        h('ul', { class: 'liste' }, kosten.posten.map(wkZeile))),
      h('div', { class: 'tag-kopf' }, h('span', {}, `Buchungen (${buchungen.length})`),
        buchungen.length > 0 && h('span', { class: 'tag-stand' }, formatEuro(buchungen.reduce((s, b) => s + wirkungCent(b), 0)))),
      buchungen.length
        ? h('ul', { class: 'liste' }, buchungen.slice(0, MAX_BUCHUNGEN).map(buchungZeile))
        : h('p', { class: 'leer' }, 'Noch keine Buchungen zugeordnet.'),
      buchungen.length > MAX_BUCHUNGEN && h('details', { class: 'erledigt-liste' },
        h('summary', {}, `Ältere anzeigen (${buchungen.length - MAX_BUCHUNGEN})`),
        h('ul', { class: 'liste' }, buchungen.slice(MAX_BUCHUNGEN).map(buchungZeile))),
      h('div', { class: 'knopfreihe' },
        h('button', { type: 'button', class: 'knopf knopf-klein', onclick: () => vertragDialog(v, daten) }, 'Bearbeiten'),
        h('button', { type: 'button', class: 'knopf knopf-klein', onclick: () => zuordnenDialog(v, daten) }, 'Buchungen zuordnen …')),
    ].filter(Boolean)));
  d.addEventListener('toggle', () => { if (d.open) offen.add(v.id); else offen.delete(v.id); });
  return d;
}

/* =========================== Dialog =========================== */

/** Vertrag anlegen/bearbeiten. vorgaben: z. B. { gekuendigtZum } aus der Erinnerung */
export function vertragDialog(v, daten, vorgaben = {}) {
  const w = { ...(v ?? {}), ...vorgaben };
  const name = eingabe({ label: 'Name', value: w.name ?? '', maxlength: 60, placeholder: 'z. B. Handy, Strom, Kfz-Versicherung', autofocus: !v });
  // D150: Empfänger wie in der Buchungsmaske (mit Vorschlägen aus den Buchungen), hier Pflicht
  const anbieter = partnerFeld(daten.buchungen ?? [], w.anbieter ?? '', 'ausgabe');
  anbieter.feld.querySelector('label').textContent = 'An (Empfänger)';
  anbieter.input.placeholder = 'z. B. Telefon AG';
  const nummer = eingabe({
    label: 'Vertragsnummer (optional)', value: w.vertragsnummer ?? '', maxlength: 60,
    hilfe: 'Nur zur eigenen Zuordnung – bitte keine Passwörter oder Zugangsdaten eintragen.',
  });
  const beginn = eingabe({ label: 'Vertragsbeginn', type: 'date', value: w.beginn ?? '' });
  const mindest = eingabe({ label: 'Mindestlaufzeit (Monate)', inputmode: 'numeric', value: w.mindestlaufzeitMonate ?? '', placeholder: 'z. B. 24' });
  const verl = eingabe({
    label: 'Verlängerung um (Monate)', inputmode: 'numeric', value: w.verlaengerungMonate ?? (v ? '' : '12'), placeholder: 'z. B. 12',
  });
  const fristAnzahl = eingabe({ label: 'Kündigungsfrist', inputmode: 'numeric', value: w.fristAnzahl ?? (v ? '' : '3'), placeholder: 'z. B. 3' });
  const fristEinheit = auswahl({
    label: 'Einheit', optionen: Object.entries(FRIST_EINHEITEN).map(([wert, text]) => ({ wert, text })), wert: w.fristEinheit ?? 'monate',
  });
  const erinnerung = eingabe({
    label: 'Erinnerung (Tage vorher)', inputmode: 'numeric', value: w.erinnerungTage ?? STANDARD_ERINNERUNG_TAGE,
    hilfe: 'So viele Tage vor dem letzten Kündigungstag erscheint der Hinweis oben in der Übersicht.',
  });
  const gekuendigt = eingabe({
    label: 'Gekündigt zum (optional)', type: 'date', value: w.gekuendigtZum ?? '',
    hilfe: 'Nach diesem Tag wandert der Vertrag zu „Beendete Verträge“.',
  });
  const notiz = eingabe({ label: 'Notiz (optional)', value: w.notiz ?? '', maxlength: 300 });
  const unterlagenName = () => ['Vertrag', name.input.value.trim(), anbieter.input.value.trim()].filter(Boolean).join(' ');
  const unterlagen = belegeFeld(v?.belege ?? [], unterlagenName, { label: 'Unterlagen (optional)' });

  dialog({
    titel: v ? 'Vertrag bearbeiten' : 'Neuer Vertrag',
    inhalt: [
      name.feld, anbieter.feld, nummer.feld,
      h('div', { class: 'feld-paar' }, beginn.feld, mindest.feld),
      h('p', { class: 'feld-hilfe' }, 'Handy und Internet laufen nach der Mindestlaufzeit meist monatlich weiter (Verlängerung 1, Frist 1 Monat). ' +
        'Verlängerung 0 = endet von selbst. Ohne Mindestlaufzeit ist der Vertrag jederzeit mit der Frist kündbar.'),
      h('div', { class: 'feld-paar' }, verl.feld, erinnerung.feld),
      h('div', { class: 'feld-paar' }, fristAnzahl.feld, fristEinheit.feld),
      gekuendigt.feld, notiz.feld, unterlagen.feld,
    ],
    zusatz: v && {
      text: 'Löschen',
      variante: 'knopf-gefahr',
      onclick: async (dlg) => {
        const buchungen = daten.buchungen.filter((b) => b.vertragId === v.id);
        const wk = daten.wiederkehrend.filter((x) => x.vertragId === v.id);
        const ok = await frage({
          titel: 'Vertrag löschen?',
          text: [`Der Vertrag „${v.name}“ und seine Unterlagen werden gelöscht.`,
            `${buchungen.length} Buchung(en) und ${wk.length} wiederkehrende Buchung(en) bleiben erhalten – sie gehören dann zu keinem Vertrag mehr.`],
          jaText: 'Löschen',
          gefahr: true,
        });
        if (!ok) return;
        const jetzt = new Date().toISOString();
        if (buchungen.length) await db.speichere('buchungen', buchungen.map((b) => ({ ...b, vertragId: null, geaendertAm: jetzt })));
        if (wk.length) await db.speichere('wiederkehrend', wk.map((x) => ({ ...x, vertragId: null, geaendertAm: jetzt })));
        await belegeEntfernen([v]);
        await db.loesche('vertraege', v.id);
        dlg.close();
        toast('Vertrag gelöscht');
        datenGeaendert();
      },
    },
    onSpeichern: async () => {
      unterlagen.umbenennen((l) => benenneBelege(l, 'Vertrag', [name.input.value.trim(), anbieter.input.value.trim()].filter(Boolean).join(' ')));
      const neu = baueVertrag({
        name: name.input.value,
        anbieter: anbieter.input.value,
        vertragsnummer: nummer.input.value,
        beginn: beginn.input.value,
        mindestlaufzeitMonate: mindest.input.value,
        verlaengerungMonate: verl.input.value,
        fristAnzahl: fristAnzahl.input.value,
        fristEinheit: fristEinheit.select.value,
        erinnerungTage: erinnerung.input.value,
        gekuendigtZum: gekuendigt.input.value,
        notiz: notiz.input.value,
        belege: unterlagen.liste(),
      }, { vertraege: daten.vertraege, alt: v });
      await db.speichere('vertraege', neu);
      await unterlagen.uebernehme();
      // Kündigung neu eingetragen: zugeordnete wiederkehrende Buchungen zum Vertragsende beenden? (nur mit Zustimmung)
      if (neu.gekuendigtZum && neu.gekuendigtZum !== v?.gekuendigtZum) {
        const betroffen = endeVorschlag(neu.id, neu.gekuendigtZum, daten.wiederkehrend).filter((x) => x.start <= neu.gekuendigtZum);
        if (betroffen.length) {
          const ok = await frage({
            titel: 'Wiederkehrende Buchungen beenden?',
            text: [`Der Vertrag ist zum ${formatDatum(neu.gekuendigtZum)} gekündigt. Sollen diese wiederkehrenden Buchungen dann enden?`,
              ...betroffen.map((x) => `• ${x.partner || x.notiz || 'Wiederkehrende Buchung'} (${INTERVALL[x.intervall]})`),
              'Spätere Termine fallen dann aus der Prognose.'],
            jaText: `Zum ${formatDatum(neu.gekuendigtZum)} beenden`,
          });
          if (ok) {
            const jetzt = new Date().toISOString();
            await db.speichere('wiederkehrend', betroffen.map((x) => ({ ...x, ende: neu.gekuendigtZum, geaendertAm: jetzt })));
            toast(`${betroffen.length === 1 ? '1 wiederkehrende Buchung endet' : `${betroffen.length} wiederkehrende Buchungen enden`} zum ${formatDatum(neu.gekuendigtZum)}`);
          }
        }
      }
      toast(v ? 'Vertrag gespeichert' : 'Vertrag angelegt');
      datenGeaendert();
    },
  });
}

/* =========================== Buchungen zuordnen =========================== */

/** Vorhandene Buchungen nachträglich zuordnen: Liste nach Suchbegriff (Empfänger), per Häkchen auswählen */
export function zuordnenDialog(v, daten) {
  const MAX = 100;
  const kontoName = new Map(daten.konten.map((k) => [k.id, k.name]));
  const vertragName = new Map(daten.vertraege.map((x) => [x.id, x.name]));
  const wkNachId = new Map(daten.wiederkehrend.map((w) => [w.id, w]));
  const gewaehlt = new Set();
  const such = eingabe({ label: 'Suchen in Empfänger und Notiz', value: v.anbieter || v.name, type: 'search' });
  const liste = h('ul', { class: 'vormerk-liste' });
  const zaehler = h('p', { class: 'klein gedaempft' });

  const zeichne = () => {
    const kandidaten = zuordnungsKandidaten(v.id, such.input.value, daten.buchungen, daten.wiederkehrend);
    zaehler.textContent = `${gewaehlt.size} ausgewählt · ${kandidaten.length} gefunden` + (kandidaten.length > MAX ? ` (die neuesten ${MAX} angezeigt)` : '');
    liste.replaceChildren(...kandidaten.slice(0, MAX).map((b) => {
      const anderer = vertragVon(b, wkNachId);
      const cb = h('input', { type: 'checkbox', checked: gewaehlt.has(b.id) });
      cb.addEventListener('change', () => { if (cb.checked) gewaehlt.add(b.id); else gewaehlt.delete(b.id); zeichne(); });
      const titel = [b.partner || (b.art === 'umbuchung' ? 'Umbuchung' : 'Buchung'), b.notiz, kontoName.get(b.kontoId)].filter(Boolean).join(' · ')
        + (anderer ? ` (bisher: ${vertragName.get(anderer) ?? 'anderer Vertrag'})` : '');
      return h('li', {}, h('label', { class: 'vormerk-zeile' }, cb,
        h('span', { class: 'vormerk-datum' }, formatDatum(b.datum)),
        h('span', { class: 'vormerk-titel', title: titel }, titel),
        h('span', { class: 'betrag' + (wirkungCent(b) > 0 ? ' plus' : '') }, formatEuro(wirkungCent(b)))));
    }));
    if (!kandidaten.length) liste.replaceChildren(h('li', { class: 'leer' }, 'Keine passenden Buchungen.'));
  };
  let warte = null;
  such.input.addEventListener('input', () => { clearTimeout(warte); warte = setTimeout(zeichne, 150); });
  such.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
  zeichne();

  dialog({
    titel: `Buchungen zuordnen – ${v.name}`,
    inhalt: [
      h('p', { class: 'hinweis' }, 'Angehakte Buchungen werden diesem Vertrag zugeordnet. Buchungen aus einer zugeordneten wiederkehrenden Buchung gehören schon automatisch dazu.'),
      such.feld, liste, zaehler,
    ],
    speichernText: 'Zuordnen',
    onSpeichern: async () => {
      if (gewaehlt.size === 0) throw new Error('Bitte mindestens eine Buchung anhaken.');
      const jetzt = new Date().toISOString();
      const geaendert = new Map();
      for (const b of daten.buchungen.filter((x) => gewaehlt.has(x.id))) {
        for (const teil of gruppeVon(b, daten.buchungen)) geaendert.set(teil.id, { ...teil, vertragId: v.id, geaendertAm: jetzt });
      }
      await db.speichere('buchungen', [...geaendert.values()]);
      toast(gewaehlt.size === 1 ? '1 Buchung zugeordnet' : `${gewaehlt.size} Buchungen zugeordnet`);
      datenGeaendert();
    },
  });
}

/* =========================== Erinnerung oben in der Übersicht =========================== */

let erinnerungOffen = false; // eingeklappt, solange nicht aufgeklappt (wie die Budgethinweise, D117)

/**
 * D148: Ruhiger, einklappbarer Hinweis oben in der Übersicht, wenn eine Kündigungsfrist naht.
 * „Gekündigt …“ öffnet den Vertrag mit vorbelegtem Enddatum, „Behalten“ blendet den Hinweis
 * bis zum nächsten Kündigungstermin aus. Die App ändert nie selbst etwas.
 */
export function kuendigungsBereich(hinweise, daten) {
  if (!hinweise.length) return null;
  const namen = hinweise.map((x) => x.vertrag.name).join(', ');
  const titel = hinweise.length === 1
    ? `Kündigungsfrist · ${namen} bis ${formatDatum(hinweise[0].stand.kuendigenBis)}`
    : `${hinweise.length} Kündigungsfristen · ${namen}`;
  const heute = heuteIso();
  return klappBereich({
    klasse: 'hinweise-klapp kuendigung-klapp',
    titel,
    offen: erinnerungOffen,
    beiWechsel: (o) => { erinnerungOffen = o; },
  }, h('div', { class: 'hinweiskarten' }, hinweise.map(({ vertrag: v, stand }) => {
    const kosten = vertragsKosten(v.id, daten.wiederkehrend, heute);
    const rest = stand.tageBisFrist === 0 ? 'heute' : stand.tageBisFrist === 1 ? 'noch 1 Tag' : `noch ${stand.tageBisFrist} Tage`;
    // Ende nach der nächsten Verlängerung: ein Tag nach dem jetzigen Ende plus Verlängerung, minus ein Tag
    const verlaengert = plusTage(plusMonate(plusTage(stand.ende, 1), v.verlaengerungMonate), -1);
    return h('section', { class: 'bereich hinweiskarte', 'aria-label': `Kündigungsfrist ${v.name}` },
      h('h2', {}, h('span', { class: 'klein' }, 'Kündigungsfrist · '), v.name, v.anbieter && h('span', { class: 'klein gedaempft' }, ` · ${v.anbieter}`)),
      h('p', {},
        `Kündigen bis ${formatDatum(stand.kuendigenBis)} (${rest}), dann endet der Vertrag am ${formatDatum(stand.ende)}. ` +
        `Sonst verlängert er sich um ${v.verlaengerungMonate} ${v.verlaengerungMonate === 1 ? 'Monat' : 'Monate'} bis ${formatDatum(verlaengert)}.`),
      (kosten.posten.length > 0 || v.vertragsnummer) && h('p', { class: 'klein' },
        [kosten.posten.length && `Kosten ${formatEuro(kosten.monatCent)} im Monat (${formatEuro(kosten.jahrCent)} im Jahr)`,
          v.vertragsnummer && `Vertragsnummer ${v.vertragsnummer}`].filter(Boolean).join(' · ')),
      h('div', { class: 'hinweis-aktionen' },
        h('button', {
          type: 'button', class: 'knopf knopf-primaer',
          onclick: () => vertragDialog(v, daten, { gekuendigtZum: stand.ende }),
        }, 'Gekündigt …'),
        h('button', {
          type: 'button', class: 'knopf',
          onclick: async () => {
            await db.speichere('vertraege', { ...v, erinnerungAusBis: stand.kuendigenBis, geaendertAm: new Date().toISOString() });
            toast(`${v.name} läuft weiter – Erinnerung wieder vor dem nächsten Termin`);
            datenGeaendert();
          },
        }, 'Behalten'),
        h('a', {
          class: 'knopf', href: '#projekte',
          onclick: () => geraet.schreib('ansicht-projekte', 'vertraege'), // D153: gleich die Verträge zeigen
        }, 'Zum Vertrag')));
  })));
}
