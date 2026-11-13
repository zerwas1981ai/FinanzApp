// Dialog zum Erfassen und Bearbeiten einer Buchung oder Umbuchung.

import { h } from '../dom.js';
import * as db from '../db.js';
import { parseEuro, centZuEingabe, heuteIso, rechneBetrag, formatEuro } from '../format.js';
import { dialog, toast, eingabe, auswahl, optionsGruppe, datenGeaendert, geraet } from '../ui.js';
import { speichereBuchung, gruppeVon, inPapierkorb, wiederherstellen } from '../buchungen.js';
import { partnerListe, partnerSchluessel, haeufigeKategorien } from '../auswertung.js';
import { belegeFeld } from './belege.js';
import { sortiereKonten } from '../konten.js';
import { wiederkehrendDialog } from './annahmen.js';
import { monatsende, tageImMonat } from '../prognose.js';
import { relevanteZeilen, gruppenListe, MAX_GRUPPE, benenneBelege } from '../relevant.js';
import { istAktiv } from '../vertraege.js';
import { ungewoehnlichHoch, vorherigeBetraege, kategorieAusNotiz } from '../erkennung.js';

const nachName = (a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' });

/**
 * buchung: beim Bearbeiten eine bestehende Buchung (bei Umbuchung eine der beiden Hälften)
 * vorgaben (nur neue Buchungen): { kontoId, art, betragCent, kategorieId, gegenkontoId, datum, notiz, partner, projektId, relevant, relevantGruppe,
 *   titel, wiederkehrendId, faelligAm } – z. B. beim Buchen eines fälligen Termins
 *   dateien: Belegdateien, die gleich angehängt werden ("Teilen an Finanzen", D106)
 *   belegZuerst: Belegfeld direkt unter dem Betrag (Kurzbefehl "Belegfoto", D105)
 */
export async function oeffneBuchungsdialog(buchung = null, vorgaben = {}) {
  const [konten, kategorien, alle, projekte, relevantListe, vertraege, wiederkehrendListe] = await Promise.all(
    ['konten', 'kategorien', 'buchungen', 'projekte', 'relevant', 'vertraege', 'wiederkehrend'].map((s) => db.alle(s)),
  );
  // Immer die aktuelle Fassung aus der Datenbank nehmen – der Abgleich kann sie im Hintergrund
  // geändert haben (z. B. Drive-Kennung eines hochgeladenen Belegs)
  if (buchung) buchung = alle.find((b) => b.id === buchung.id) ?? buchung;
  const gruppe = buchung ? gruppeVon(buchung, alle) : [];
  // Bei Umbuchungen ist die "ab"-Hälfte maßgeblich (Von-Konto)
  const ref = gruppe.find((b) => b.richtung === 'ab') ?? buchung;

  const waehlbareKonten = sortiereKonten(konten
    .filter((k) => !k.archiviert || gruppe.some((b) => b.kontoId === k.id)));
  if (!buchung && waehlbareKonten.length === 0) {
    toast('Bitte zuerst unter Stammdaten ein Konto anlegen.');
    location.hash = '#stammdaten';
    return;
  }

  let art = ref?.art ?? vorgaben.art ?? 'ausgabe';
  const startBetrag = ref?.betragCent ?? vorgaben.betragCent ?? null;
  const startKategorie = ref?.kategorieId ?? vorgaben.kategorieId;

  // ---------- Felder ----------
  const artKnoepfe = artWahl(ref, art, (neueArt) => {
    art = neueArt;
    aktualisiere();
  });

  const betrag = eingabe({
    label: 'Betrag in €',
    inputmode: 'decimal',
    placeholder: '0,00',
    value: startBetrag != null ? centZuEingabe(startBetrag) : '',
    autofocus: true,
    class: 'eingabe-betrag',
  });

  // D175: Rechnen im Betragsfeld („12,50+3,20“) – beim Verlassen des Feldes steht das Ergebnis da
  const liesBetrag = () => rechneBetrag(betrag.input.value, 'Betrag') ?? parseEuro(betrag.input.value, 'Betrag');
  betrag.input.addEventListener('change', () => {
    try {
      const cent = rechneBetrag(betrag.input.value, 'Betrag');
      if (cent != null && cent > 0) betrag.input.value = centZuEingabe(cent);
    } catch { /* unverständlich: beim Speichern kommt die Meldung */ }
  });
  betrag.input.title = 'Rechnen möglich, z. B. 12,50+3,20 oder 3*2,49';

  // D183: Hinweis unter dem Betrag, wenn er für diesen Empfänger ungewöhnlich hoch ist (z. B. Tippfehler)
  const ungewoehnlichHinweis = h('small', { class: 'feld-hilfe warn-text', hidden: true, 'aria-live': 'polite' });
  betrag.feld.append(ungewoehnlichHinweis);
  const pruefeHoehe = () => {
    let cent = null;
    try { cent = liesBetrag(); } catch { /* egal */ }
    // D186: bestätigter Betrag → kein Hinweis
    const schnitt = art === 'ausgabe' && cent && ref?.hochOkCent !== cent ? ungewoehnlichHoch(cent, vorherigeBetraege(alle, partner.input.value, { ohneId: ref?.id })) : null;
    ungewoehnlichHinweis.hidden = schnitt == null;
    ungewoehnlichHinweis.textContent = schnitt == null ? '' : `Ungewöhnlich hoch für ${partner.input.value.trim()} – sonst Ø ${formatEuro(schnitt)}. Betrag prüfen?`;
  };

  const kategorie = auswahl({ label: 'Kategorie', optionen: [] });
  // Bekannter Empfänger/Absender bei neuer Buchung: Kategorie der letzten Buchung vorschlagen
  const partner = partnerFeld(alle, ref?.partner ?? vorgaben.partner ?? '', art, (name) => {
    if (buchung || kategorie.select.value) return;
    const vorschlag = letzteKategorieVon(alle, name, art);
    if (vorschlag && [...kategorie.select.options].some((o) => o.value === vorschlag)) kategorie.select.value = vorschlag;
  });

  const zuletzt = geraet.lies('letztes-konto');
  const kontoOptionen = waehlbareKonten.map((k) => ({ wert: k.id, text: k.name + (k.archiviert ? ' (archiviert)' : '') }));
  const startKonto = ref?.kontoId
    ?? vorgaben.kontoId
    ?? (waehlbareKonten.some((k) => k.id === zuletzt && !k.archiviert) ? zuletzt : waehlbareKonten.find((k) => !k.archiviert)?.id);
  const konto = auswahl({ label: 'Konto', optionen: kontoOptionen, wert: startKonto });
  const gegenkonto = auswahl({
    label: 'Auf Konto',
    optionen: kontoOptionen,
    wert: ref?.gegenkontoId ?? vorgaben.gegenkontoId ?? waehlbareKonten.find((k) => k.id !== startKonto && !k.archiviert)?.id,
  });

  // D98: Umbuchung optional einem Budget auf dem abgebenden Konto zuordnen
  const budgetFeld = budgetZuordnungFeld(kategorien, ref?.budgetKategorieId ?? vorgaben.budgetKategorieId ?? null);

  const datum = eingabe({ label: 'Datum', type: 'date', value: ref?.datum ?? vorgaben.datum ?? heuteIso() });
  const status = optionsGruppe({
    label: 'Status',
    optionen: [{ wert: 'gebucht', text: 'Gebucht' }, { wert: 'vorgemerkt', text: 'Vorgemerkt' }],
    wert: ref?.status ?? 'gebucht',
  });
  const notiz = eingabe({ label: 'Notiz (optional)', maxlength: 200, value: ref?.notiz ?? vorgaben.notiz ?? '', placeholder: 'z. B. Wocheneinkauf' });
  // D184: Kategorie aus der Notiz vorschlagen – nur bei neuen Buchungen und noch leerer Kategorie
  notiz.input.addEventListener('change', () => {
    if (buchung || art === 'umbuchung' || kategorie.select.value) return;
    const vorschlag = kategorieAusNotiz(notiz.input.value, alle, art);
    if (vorschlag && [...kategorie.select.options].some((o) => o.value === vorschlag)) {
      kategorie.select.value = vorschlag;
      toast(`Kategorie vorgeschlagen: ${kategorie.select.selectedOptions[0]?.textContent ?? ''}`);
    }
  });
  const projekt = projektFeld(projekte, ref?.projektId ?? vorgaben.projektId ?? null);
  // D148: Vertrag – vorbelegt mit dem eigenen oder dem der wiederkehrenden Buchung (rückwirkend)
  const ausWiederkehrend = wiederkehrendListe.find((w) => w.id === (ref?.wiederkehrendId ?? vorgaben.wiederkehrendId))?.vertragId ?? null;
  const vertrag = vertragFeld(vertraege, ref?.vertragId ?? vorgaben.vertragId ?? ausWiederkehrend);
  // Relevante Ausgabe (D74): Häkchen + optionale Gruppe, nur bei Ausgaben
  const relevantHaken = h('input', { type: 'checkbox', checked: Boolean(ref?.relevant ?? vorgaben.relevant) });
  const relevantGruppe = gruppeFeld(
    gruppenListe(relevanteZeilen({ relevant: relevantListe, buchungen: alle })),
    ref?.relevantGruppe ?? vorgaben.relevantGruppe ?? '',
  );
  // D142: bei relevanter Ausgabe ist die Notiz Pflicht – die Beschriftung zeigt das an
  const zeigeGruppe = () => {
    relevantGruppe.feld.hidden = !relevantHaken.checked;
    const pflicht = relevantHaken.checked && art === 'ausgabe';
    notiz.feld.querySelector('label').textContent = pflicht ? 'Notiz (Pflicht – benennt den Beleg)' : 'Notiz (optional)';
  };
  relevantHaken.addEventListener('change', zeigeGruppe);
  zeigeGruppe();
  const relevantFeld = h('div', { class: 'relevant-feld' },
    h('label', { class: 'schalter feld-schalter' }, relevantHaken, 'Relevante Ausgabe (erscheint unter Projekte → Relevante Ausgaben, Belege zusätzlich im Drive-Ordner)'),
    relevantGruppe.feld);

  // D152: seltene Felder unter „Weitere Angaben“ – offen, sobald eines davon ausgefüllt ist
  const weitereText = h('span', { class: 'weitere-angaben-text' });
  const weitere = h('details', {
    class: 'weitere-angaben',
    open: Boolean((projekt && projekt.select.value) || (vertrag && vertrag.select.value) || relevantHaken.checked),
  }, h('summary', {}, 'Weitere Angaben', weitereText), projekt?.feld, vertrag?.feld, relevantFeld);
  const zeigeWeitere = () => {
    const sichtbar = [projekt && !projekt.feld.hidden && 'Projekt', vertrag && 'Vertrag', !relevantFeld.hidden && 'Relevante Ausgabe'].filter(Boolean);
    weitere.hidden = sichtbar.length === 0;
    weitereText.textContent = ` (${sichtbar.join(', ')})`;
  };

  // Belege: Dateiname aus Datum und Empfänger/Absender bzw. Kategorie; bei relevanter Ausgabe Datum und Notiz (D142).
  // D143: Beim Speichern wird der Name nach dem dann gültigen Stand neu gesetzt (nur noch nicht hochgeladene Belege).
  const belegNamensteil = () => (relevantHaken.checked && art === 'ausgabe' && notiz.input.value.trim())
    || partner.input.value.trim() || (kategorie.select.value && kategorie.select.selectedOptions[0]?.textContent) || 'Beleg';
  const belege = belegeFeld(ref?.belege ?? [], () => [datum.input.value, belegNamensteil()].filter(Boolean).join(' '));

  function aktualisiere() {
    const istUmbuchung = art === 'umbuchung';
    kategorie.feld.hidden = istUmbuchung;
    if (projekt) projekt.feld.hidden = istUmbuchung;
    belege.feld.hidden = istUmbuchung;
    relevantFeld.hidden = art !== 'ausgabe';
    zeigeWeitere(); // D152
    zeigeGruppe(); // D142: Notiz-Beschriftung (Pflicht/optional) passend zur Art
    partner.setzeArt(art);
    gegenkonto.feld.hidden = !istUmbuchung;
    budgetFeld.feld.hidden = !istUmbuchung;
    konto.feld.querySelector('label').textContent = istUmbuchung ? 'Von Konto' : 'Konto';
    if (!istUmbuchung) fuelleKategorien(kategorie.select, kategorien, art, startKategorie, haeufigeKategorien(alle, art));
  }
  aktualisiere();
  // D183: Höhe prüfen, sobald sich Betrag, Empfänger oder Art ändern
  betrag.input.addEventListener('change', pruefeHoehe);
  partner.input.addEventListener('change', pruefeHoehe);
  artKnoepfe.addEventListener('click', () => setTimeout(pruefeHoehe, 0));
  pruefeHoehe();

  // ---------- Kopieren / als wiederkehrend übernehmen (D71) ----------
  // Beide nehmen die Werte, die gerade im Dialog stehen. Die Buchung selbst bleibt unverändert,
  // ungespeicherte Änderungen an ihr werden verworfen.
  const aktuelleWerte = () => {
    let betragCent = null;
    try { betragCent = liesBetrag(); } catch { /* leer lassen */ }
    return {
      art,
      betragCent,
      kontoId: konto.select.value,
      gegenkontoId: art === 'umbuchung' ? gegenkonto.select.value : undefined,
      budgetKategorieId: art === 'umbuchung' ? budgetFeld.select.value || null : undefined,
      kategorieId: art === 'umbuchung' ? undefined : kategorie.select.value || undefined,
      partner: partner.input.value.trim(),
      notiz: notiz.input.value.trim(),
      projektId: projekt && art !== 'umbuchung' ? projekt.select.value || null : null,
      relevant: art === 'ausgabe' && relevantHaken.checked,
      relevantGruppe: relevantGruppe.input.value,
      vertragId: vertrag ? vertrag.select.value || null : null, // D151: Vertrag mit übernehmen
    };
  };
  const kopieren = buchung && h('button', {
    type: 'button',
    class: 'knopf knopf-klein',
    onclick: () => {
      const w = aktuelleWerte();
      dlg.close();
      setTimeout(() => oeffneBuchungsdialog(null, { ...w, datum: heuteIso(), titel: 'Kopie der Buchung' }), 0);
    },
  }, '⧉ Kopieren');
  const alsWiederkehrend = buchung && h('button', {
    type: 'button',
    class: 'knopf knopf-klein',
    onclick: () => {
      const w = aktuelleWerte();
      // Erster Termin: einen Monat nach dieser Buchung (sie selbst ist schon gebucht und zählt nicht doppelt)
      const [j, m, t] = (datum.input.value || heuteIso()).split('-').map(Number);
      const istLetzter = t === tageImMonat(j, m);
      const nj = m === 12 ? j + 1 : j;
      const nm = m === 12 ? 1 : m + 1;
      const nt = istLetzter ? tageImMonat(nj, nm) : Math.min(t, tageImMonat(nj, nm));
      const start = `${nj}-${String(nm).padStart(2, '0')}-${String(nt).padStart(2, '0')}`;
      dlg.close();
      // D151: mit Verträgen, damit das Feld „Vertrag“ auch hier erscheint
      setTimeout(() => wiederkehrendDialog(null, { konten, kategorien, buchungen: alle, vertraege }, {
        ...w,
        notiz: w.notiz ?? '', // D96: Notiz statt Bezeichnung
        start: istLetzter ? monatsende(start) : start,
        monatsletzter: istLetzter,
        titel: 'Als wiederkehrende Buchung übernehmen',
      }), 0);
    },
  }, '↻ Als wiederkehrend anlegen');
  const extras = buchung && h('div', { class: 'knopfreihe dialog-extras' }, kopieren, alsWiederkehrend);

  // ---------- Dialog ----------
  // Serienerfassung nur bei wirklich neuen Buchungen – nicht beim Buchen eines fälligen Termins oder geteilten Belegs
  const serie = !buchung && !vorgaben.wiederkehrendId && !vorgaben.geplantId && !vorgaben.dateien?.length;
  const dlg = dialog({
    titel: buchung ? (ref.art === 'umbuchung' ? 'Umbuchung bearbeiten' : 'Buchung bearbeiten') : (vorgaben.titel ?? 'Neue Buchung'),
    inhalt: (vorgaben.belegZuerst || vorgaben.dateien?.length
      ? [artKnoepfe, belege.feld, betrag.feld, partner.feld, kategorie.feld, konto.feld, gegenkonto.feld, budgetFeld.feld, datum.feld, status.feld, notiz.feld, weitere]
      : [extras, artKnoepfe, betrag.feld, partner.feld, kategorie.feld, konto.feld, gegenkonto.feld, budgetFeld.feld, datum.feld, status.feld, notiz.feld, weitere, belege.feld]
    ).filter(Boolean),
    speichernText: buchung ? 'Speichern' : 'Erfassen',
    zusatz: buchung ? {
      text: 'In den Papierkorb',
      variante: 'knopf-gefahr',
      onclick: async (d) => {
        await inPapierkorb(gruppe);
        d.close();
        // D176: „Rückgängig“ direkt in der Meldung statt Umweg über Stammdaten → Papierkorb
        toast('In den Papierkorb gelegt', {
          aktion: 'Rückgängig',
          beiAktion: async () => { await wiederherstellen(gruppe); toast('Wiederhergestellt'); datenGeaendert(); },
        });
        datenGeaendert();
      },
    } : serie ? {
      // D175: Serienerfassung – speichern und gleich die nächste Buchung, Art/Konto/Datum bleiben stehen
      text: 'Erfassen & weitere',
      onclick: async (d) => {
        const werte = await speichere();
        d.close();
        setTimeout(() => oeffneBuchungsdialog(null, { art: werte.art, kontoId: werte.kontoId, datum: werte.datum, titel: 'Weitere Buchung' }), 0);
      },
    } : null, // D190: ohne Serienerfassung kein Zusatzknopf (false brachte den Dialog zum Absturz)
    onSpeichern: () => speichere(),
  });
  if (vorgaben.dateien?.length) await belege.fuegeHinzu(vorgaben.dateien);
  return dlg;

  async function speichere() {
      const werte = {
        art,
        betragCent: liesBetrag(),
        datum: datum.input.value,
        kontoId: konto.select.value,
        gegenkontoId: gegenkonto.select.value,
        budgetKategorieId: art === 'umbuchung' ? budgetFeld.select.value : undefined,
        kategorieId: kategorie.select.value || null,
        notiz: notiz.input.value,
        partner: partner.input.value,
        status: status.wert(),
        // Verknüpfung mit dem Termin einer wiederkehrenden Buchung (nur beim Neuanlegen)
        wiederkehrendId: buchung ? undefined : vorgaben.wiederkehrendId,
        faelligAm: buchung ? undefined : vorgaben.faelligAm,
        geplantId: buchung ? undefined : vorgaben.geplantId,
        projektId: projekt ? projekt.select.value : undefined,
        vertragId: vertrag ? vertrag.select.value : undefined,
        relevant: art === 'ausgabe' && relevantHaken.checked,
        relevantGruppe: relevantGruppe.input.value,
      };
      // D142/D143: Belegnamen nach dem gespeicherten Stand („JJJJ-MM-TT Notiz“ bzw. „JJJJ-MM-TT Empfänger“)
      if (art !== 'umbuchung') belege.umbenennen((l) => benenneBelege(l, werte.datum, belegNamensteil()));
      werte.belege = art === 'umbuchung' ? undefined : belege.liste();
      await speichereBuchung(werte, gruppe);
      if (art !== 'umbuchung') await belege.uebernehme(); // neue Dateien ablegen, entfernte vormerken
      geraet.schreib('letztes-konto', werte.kontoId);
      toast(buchung ? 'Buchung gespeichert' : 'Buchung erfasst');
      datenGeaendert();
      return werte;
  }
}

const PARTNER_LABEL = { ausgabe: 'An (Empfänger, optional)', einnahme: 'Von (Absender, optional)' };
let listenZaehler = 0;

/**
 * Feld "An" / "Von" (Empfänger bzw. Absender) mit Vorschlägen aus allen bisherigen Buchungen.
 * Die Beschriftung passt sich der Art an (setzeArt); bei Umbuchungen ist das Feld ausgeblendet.
 * beiWahl(name): wird aufgerufen, wenn ein bekannter Name gewählt/eingetippt wurde.
 */
export function partnerFeld(buchungen, wert, art, beiWahl = null) {
  const id = `partner-vorschlaege-${++listenZaehler}`;
  const vorschlaege = partnerListe(buchungen);
  const feld = eingabe({ label: PARTNER_LABEL[art] ?? PARTNER_LABEL.ausgabe, value: wert ?? '', maxlength: 80, list: id, placeholder: 'z. B. Supermarkt Muster' });
  feld.feld.append(h('datalist', { id }, vorschlaege.map((p) => h('option', { value: p.name }))));
  if (beiWahl) {
    feld.input.addEventListener('change', () => {
      const name = feld.input.value.trim();
      if (vorschlaege.some((p) => partnerSchluessel(p.name) === partnerSchluessel(name))) beiWahl(name);
    });
  }
  return {
    ...feld,
    setzeArt(neueArt) {
      feld.feld.hidden = neueArt === 'umbuchung';
      if (PARTNER_LABEL[neueArt]) feld.feld.querySelector('label').textContent = PARTNER_LABEL[neueArt];
    },
  };
}

/** Feld "Gruppe (optional)" für relevante Ausgaben, mit Vorschlägen aus den bisherigen Gruppen (D74) */
export function gruppeFeld(gruppen, wert) {
  const id = `gruppen-vorschlaege-${++listenZaehler}`;
  const feld = eingabe({
    label: 'Gruppe (optional)', value: wert ?? '', maxlength: MAX_GRUPPE, list: id, placeholder: 'z. B. Haus, Garantie, Steuer',
    hilfe: 'Zum Filtern der Liste „Relevante Ausgaben“.',
  });
  feld.feld.append(h('datalist', { id }, gruppen.map((g) => h('option', { value: g }))));
  return feld;
}

/** Kategorie der letzten Buchung mit diesem Empfänger/Absender (und dieser Art) – für die Schnellerfassung */
export function letzteKategorieVon(buchungen, name, art) {
  const k = partnerSchluessel(name);
  return [...buchungen]
    .filter((b) => !b.geloeschtAm && b.art === art && b.kategorieId && partnerSchluessel(b.partner) === k)
    .sort((a, b) => b.datum.localeCompare(a.datum))[0]?.kategorieId ?? null;
}

/**
 * Auswahlliste "Projekt (optional)" – auch für geplante Einmalbuchungen.
 * Abgeschlossene Projekte stehen nur zur Wahl, wenn sie schon zugeordnet sind.
 * Ohne Projekte gibt es kein Feld (null).
 */
export function projektFeld(projekte, wert) {
  const waehlbar = projekte.filter((p) => !p.abgeschlossen || p.id === wert).sort(nachName);
  if (waehlbar.length === 0) return null;
  return auswahl({
    label: 'Projekt (optional)',
    optionen: [{ wert: '', text: 'Kein Projekt' }, ...waehlbar.map((p) => ({ wert: p.id, text: p.name + (p.abgeschlossen ? ' (abgeschlossen)' : '') }))],
    wert: wert ?? '',
    hilfe: 'Projektausgaben zählen nicht gegen das Monatsbudget ihrer Kategorie.',
  });
}

/**
 * D148: Auswahl „Vertrag (optional)“ für Buchungen und wiederkehrende Buchungen.
 * Beendete Verträge nur, wenn schon gewählt. Ohne angelegte Verträge kein Feld (null).
 */
export function vertragFeld(vertraege = [], wert, heute = heuteIso()) {
  if (!vertraege.length) return null;
  const waehlbar = vertraege.filter((v) => istAktiv(v, heute) || v.id === wert)
    .sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }));
  if (!waehlbar.length) return null;
  return auswahl({
    label: 'Vertrag (optional)',
    optionen: [{ wert: '', text: 'Kein Vertrag' }, ...waehlbar.map((v) => ({
      wert: v.id, text: v.name + (v.anbieter ? ` · ${v.anbieter}` : '') + (istAktiv(v, heute) ? '' : ' (beendet)'),
    }))],
    wert: wert ?? '',
  });
}

/**
 * Auswahl „Zählt gegen Budget (optional)“ für Umbuchungen (D98) – auch für wiederkehrende und
 * geplante Umbuchungen. Ausgaben-Hauptkategorien; archivierte nur, wenn schon gewählt.
 */
export function budgetZuordnungFeld(kategorien, wert) {
  const haupt = kategorien.filter((k) => !k.elternId && k.art === 'ausgabe' && (!k.archiviert || k.id === wert)).sort(nachName);
  return auswahl({
    label: 'Zählt gegen Budget (optional)',
    optionen: [{ wert: '', text: 'Kein Budget' }, ...haupt.map((k) => ({ wert: k.id, text: k.name }))],
    wert: wert ?? '',
    hilfe: 'Verbraucht das Budget dieser Kategorie auf dem abgebenden Konto – z. B. wenn das Urlaubsbudget auf dem Girokonto liegt, '
      + 'du aber per PayPal bezahlst. Es bleibt eine Umbuchung, keine Ausgabe.',
  });
}

/** Umschalter Ausgabe / Einnahme / Umbuchung */
export function artWahl(ref, aktuell, beiWahl) {
  let optionen = [
    { wert: 'ausgabe', text: 'Ausgabe' },
    { wert: 'einnahme', text: 'Einnahme' },
    { wert: 'umbuchung', text: 'Umbuchung' },
  ];
  // Beim Bearbeiten: Umbuchung bleibt Umbuchung, normale Buchung bleibt normal
  if (ref?.art === 'umbuchung') optionen = optionen.filter((o) => o.wert === 'umbuchung');
  else if (ref) optionen = optionen.filter((o) => o.wert !== 'umbuchung');

  const knoepfe = optionen.map((o) => h('button', {
    type: 'button',
    class: 'segment',
    'data-wert': o.wert,
    'aria-pressed': String(o.wert === aktuell),
    onclick: () => {
      knoepfe.forEach((k) => k.setAttribute('aria-pressed', String(k.dataset.wert === o.wert)));
      beiWahl(o.wert);
    },
  }, o.text));
  return h('div', { class: 'segmente', role: 'group', 'aria-label': 'Art der Buchung' }, knoepfe);
}

/** Füllt die Kategorieauswahl mit den Unterkategorien passend zur Art, gruppiert nach Hauptkategorie */
export function fuelleKategorien(select, kategorien, art, aktuelleId, haeufig = []) {
  const vorher = select.value || aktuelleId || '';
  const haupt = kategorien
    .filter((k) => !k.elternId && k.art === art)
    .sort(nachName);
  const gruppen = [];
  for (const hk of haupt) {
    const unter = kategorien
      .filter((u) => u.elternId === hk.id && (!u.archiviert && !hk.archiviert || u.id === aktuelleId))
      .sort(nachName);
    if (unter.length) gruppen.push(h('optgroup', { label: hk.name }, unter.map((u) => h('option', { value: u.id }, u.name))));
  }
  // D175: die häufigsten Kategorien stehen zusätzlich ganz oben (mit Hauptkategorie dahinter)
  const nachId = new Map(kategorien.map((k) => [k.id, k]));
  const oben = haeufig.map((id) => nachId.get(id))
    .filter((u) => u && !u.archiviert && nachId.get(u.elternId)?.art === art && !nachId.get(u.elternId)?.archiviert);
  if (oben.length) gruppen.unshift(h('optgroup', { label: 'Häufig' }, oben.map((u) => h('option', { value: u.id }, `${u.name} (${nachId.get(u.elternId).name})`))));
  select.replaceChildren(h('option', { value: '' }, gruppen.length ? 'Bitte wählen …' : 'Keine passende Kategorie vorhanden'), ...gruppen);
  select.value = [...select.options].some((o) => o.value === vorher) ? vorher : '';
}
