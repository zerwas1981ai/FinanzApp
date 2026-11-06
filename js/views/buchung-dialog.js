// Dialog zum Erfassen und Bearbeiten einer Buchung oder Umbuchung.

import { h } from '../dom.js';
import * as db from '../db.js';
import { parseEuro, centZuEingabe, heuteIso } from '../format.js';
import { dialog, toast, eingabe, auswahl, optionsGruppe, datenGeaendert, geraet } from '../ui.js';
import { speichereBuchung, gruppeVon, inPapierkorb } from '../buchungen.js';

const nachName = (a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' });

/**
 * buchung: beim Bearbeiten eine bestehende Buchung (bei Umbuchung eine der beiden Hälften)
 * vorgaben (nur neue Buchungen): { kontoId, art, betragCent, kategorieId, gegenkontoId, datum, notiz,
 *   titel, wiederkehrendId, faelligAm } – z. B. beim Buchen eines fälligen Termins
 */
export async function oeffneBuchungsdialog(buchung = null, vorgaben = {}) {
  const [konten, kategorien, alle] = await Promise.all([db.alle('konten'), db.alle('kategorien'), db.alle('buchungen')]);
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

  function aktualisiere() {
    const istUmbuchung = art === 'umbuchung';
    kategorie.feld.hidden = istUmbuchung;
    gegenkonto.feld.hidden = !istUmbuchung;
    konto.feld.querySelector('label').textContent = istUmbuchung ? 'Von Konto' : 'Konto';
    if (!istUmbuchung) fuelleKategorien(kategorie.select, kategorien, art, startKategorie);
  }
  aktualisiere();

  // ---------- Dialog ----------
  const dlg = dialog({
    titel: buchung ? (ref.art === 'umbuchung' ? 'Umbuchung bearbeiten' : 'Buchung bearbeiten') : (vorgaben.titel ?? 'Neue Buchung'),
    inhalt: [artKnoepfe, betrag.feld, kategorie.feld, konto.feld, gegenkonto.feld, datum.feld, status.feld, notiz.feld],
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
        status: status.wert(),
        // Verknüpfung mit dem Termin einer wiederkehrenden Buchung (nur beim Neuanlegen)
        wiederkehrendId: buchung ? undefined : vorgaben.wiederkehrendId,
        faelligAm: buchung ? undefined : vorgaben.faelligAm,
      };
      await speichereBuchung(werte, gruppe);
      geraet.schreib('letztes-konto', werte.kontoId);
      toast(buchung ? 'Buchung gespeichert' : 'Buchung erfasst');
      datenGeaendert();
    },
  });
  return dlg;
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
