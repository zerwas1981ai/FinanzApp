// Dialog zum Erfassen und Bearbeiten einer Buchung oder Umbuchung.

import { h } from '../dom.js';
import * as db from '../db.js';
import { parseEuro, centZuEingabe, heuteIso } from '../format.js';
import { dialog, toast, eingabe, auswahl, optionsGruppe, datenGeaendert, geraet } from '../ui.js';
import { speichereBuchung, gruppeVon, inPapierkorb } from '../buchungen.js';
import { partnerListe, partnerSchluessel } from '../auswertung.js';

const nachName = (a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' });

/**
 * buchung: beim Bearbeiten eine bestehende Buchung (bei Umbuchung eine der beiden Hälften)
 * vorgaben (nur neue Buchungen): { kontoId, art, betragCent, kategorieId, gegenkontoId, datum, notiz, partner,
 *   titel, wiederkehrendId, faelligAm } – z. B. beim Buchen eines fälligen Termins
 */
export async function oeffneBuchungsdialog(buchung = null, vorgaben = {}) {
  const [konten, kategorien, alle, projekte] = await Promise.all(
    ['konten', 'kategorien', 'buchungen', 'projekte'].map((s) => db.alle(s)),
  );
  const gruppe = buchung ? gruppeVon(buchung, alle) : [];
  // Bei Umbuchungen ist die "ab"-Hälfte maßgeblich (Von-Konto)
  const ref = gruppe.find((b) => b.richtung === 'ab') ?? buchung;

  const waehlbareKonten = konten
    .filter((k) => !k.archiviert || gruppe.some((b) => b.kontoId === k.id))
    .sort(nachName);
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

  const datum = eingabe({ label: 'Datum', type: 'date', value: ref?.datum ?? vorgaben.datum ?? heuteIso() });
  const status = optionsGruppe({
    label: 'Status',
    optionen: [{ wert: 'gebucht', text: 'Gebucht' }, { wert: 'vorgemerkt', text: 'Vorgemerkt' }],
    wert: ref?.status ?? 'gebucht',
  });
  const notiz = eingabe({ label: 'Notiz (optional)', maxlength: 200, value: ref?.notiz ?? vorgaben.notiz ?? '', placeholder: 'z. B. Wocheneinkauf' });
  const projekt = projektFeld(projekte, ref?.projektId ?? vorgaben.projektId ?? null);

  function aktualisiere() {
    const istUmbuchung = art === 'umbuchung';
    kategorie.feld.hidden = istUmbuchung;
    if (projekt) projekt.feld.hidden = istUmbuchung;
    partner.setzeArt(art);
    gegenkonto.feld.hidden = !istUmbuchung;
    konto.feld.querySelector('label').textContent = istUmbuchung ? 'Von Konto' : 'Konto';
    if (!istUmbuchung) fuelleKategorien(kategorie.select, kategorien, art, startKategorie);
  }
  aktualisiere();

  // ---------- Dialog ----------
  const dlg = dialog({
    titel: buchung ? (ref.art === 'umbuchung' ? 'Umbuchung bearbeiten' : 'Buchung bearbeiten') : (vorgaben.titel ?? 'Neue Buchung'),
    inhalt: [artKnoepfe, betrag.feld, partner.feld, kategorie.feld, konto.feld, gegenkonto.feld, datum.feld, status.feld, notiz.feld, projekt?.feld].filter(Boolean),
    speichernText: buchung ? 'Speichern' : 'Erfassen',
    zusatz: buchung && {
      text: 'In den Papierkorb',
      variante: 'knopf-gefahr',
      onclick: async (d) => {
        await inPapierkorb(gruppe);
        d.close();
        toast('In den Papierkorb gelegt (Stammdaten → Papierkorb)');
        datenGeaendert();
      },
    },
    onSpeichern: async () => {
      const werte = {
        art,
        betragCent: parseEuro(betrag.input.value, 'Betrag'),
        datum: datum.input.value,
        kontoId: konto.select.value,
        gegenkontoId: gegenkonto.select.value,
        kategorieId: kategorie.select.value || null,
        notiz: notiz.input.value,
        partner: partner.input.value,
        status: status.wert(),
        // Verknüpfung mit dem Termin einer wiederkehrenden Buchung (nur beim Neuanlegen)
        wiederkehrendId: buchung ? undefined : vorgaben.wiederkehrendId,
        faelligAm: buchung ? undefined : vorgaben.faelligAm,
        geplantId: buchung ? undefined : vorgaben.geplantId,
        projektId: projekt ? projekt.select.value : undefined,
      };
      await speichereBuchung(werte, gruppe);
      geraet.schreib('letztes-konto', werte.kontoId);
      toast(buchung ? 'Buchung gespeichert' : 'Buchung erfasst');
      datenGeaendert();
    },
  });
  return dlg;
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
export function fuelleKategorien(select, kategorien, art, aktuelleId) {
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
  select.replaceChildren(h('option', { value: '' }, gruppen.length ? 'Bitte wählen …' : 'Keine passende Kategorie vorhanden'), ...gruppen);
  select.value = [...select.options].some((o) => o.value === vorher) ? vorher : '';
}
