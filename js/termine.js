// Datums-Helfer, Ein/Aus-Schalter der Annahmen, Stufen und Termine wiederkehrender Buchungen.
// Bis D258 Teil von prognose.js; prognose.js gibt alles von hier weiter (alte Importe gelten).
// Reine Funktionen ohne Datenbank – mit `npm test` geprüft. Siehe DECISIONS.md D33–D40, D245.

import { istAktiv } from './rechnen.js';

export const pad = (n) => String(n).padStart(2, '0');

/* ======================= Ein/Aus-Schalter (Etappe 5) ======================= */

/** Zählt eine Annahme (Budget, wiederkehrende oder geplante Buchung) in der Prognose mit? */
export function wirksam(eintrag) {
  return eintrag.aktiv !== false;
}

/**
 * Kopie der Daten, in der nur die eingeschalteten Annahmen enthalten sind –
 * plus die gekoppelten Umbuchungen (D227) als eigene wiederkehrende Umbuchungen für die Prognose.
 */
export function nurWirksam(daten) {
  const filter = (liste) => (liste ?? []).filter(wirksam);
  const wiederkehrende = filter(daten.wiederkehrende ?? daten.wiederkehrend);
  return {
    ...daten,
    budgets: filter(daten.budgets),
    wiederkehrende: [...wiederkehrende, ...gekoppelteUmbuchungen(wiederkehrende, daten.kategorien)],
    geplant: filter(daten.geplant),
  };
}

/**
 * D227: Zu jeder wiederkehrenden Ausgabe mit „Umbuchung von Konto“ eine abgeleitete wiederkehrende Umbuchung
 * (Von-Konto → Konto der Ausgabe) mit denselben Terminen und Beträgen (Stufen, Ausnahmen, Kalendermonate).
 * Sie wird nie gespeichert; `gekoppelt` zeigt auf die Ausgabe. Wie beim Ausgleich (D216) trägt sie die
 * Hauptkategorie als Budget-Zuordnung, die Ausgabe zählt also gegen das Budget auf dem Von-Konto.
 */
export function gekoppelteUmbuchungen(wiederkehrende, kategorien = []) {
  const hauptVon = new Map((kategorien ?? []).map((k) => [k.id, k.elternId ?? null]));
  return (wiederkehrende ?? [])
    .filter((w) => w.art === 'ausgabe' && w.umbuchungVonKontoId && w.umbuchungVonKontoId !== w.kontoId && !w.gekoppelt)
    .map((w) => ({
      ...w,
      id: `${w.id}#umbuchung`,
      art: 'umbuchung',
      kontoId: w.umbuchungVonKontoId,
      gegenkontoId: w.kontoId,
      kategorieId: null,
      budgetKategorieId: hauptVon.get(w.kategorieId) ?? null,
      umbuchungVonKontoId: null,
      partner: '',
      notiz: `Umbuchung für ${annahmeTitel(w, kategorien)}`,
      vertragId: null,
      gekoppelt: w,
    }));
}

/**
 * Anzeigename einer wiederkehrenden oder geplanten Buchung (D96).
 * Geplante Einmalbuchungen haben weiter eine Bezeichnung. Wiederkehrende haben keine mehr:
 * „Empfänger/Absender · Notiz“, sonst die Unterkategorie bzw. „Umbuchung“.
 */
export function annahmeTitel(x, kategorien = []) {
  if (x.bezeichnung) return x.bezeichnung;
  const teile = [x.partner, x.notiz].filter(Boolean);
  if (teile.length) return teile.join(' · ');
  if (x.art === 'umbuchung') return 'Umbuchung';
  return kategorien.find((k) => k.id === x.kategorieId)?.name ?? 'Wiederkehrende Buchung';
}

/* ======================= Datums-Helfer ======================= */

export const tageImMonat = (jahr, monat) => new Date(jahr, monat, 0).getDate();

/** "2026-11-06" → "2026-11-30" */
export function monatsende(iso) {
  const j = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return `${j}-${pad(m)}-${pad(tageImMonat(j, m))}`;
}

/** "2026-11" + n Monate → "2027-02" (n darf negativ sein) */
export function plusMonate(monat, n) {
  const index = Number(monat.slice(0, 4)) * 12 + Number(monat.slice(5, 7)) - 1 + n;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

/** "2026-11-06" + n Tage */
export function plusTage(iso, n) {
  const [j, m, t] = iso.split('-').map(Number);
  const d = new Date(j, m - 1, t + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/* ======================= Stufen (Wertänderungen) ======================= */

/**
 * Betrag, der zu einem Zeitpunkt gilt. stufen = [{ ab, betragCent }], ab als
 * "JJJJ-MM" (Budgets) oder "JJJJ-MM-TT" (wiederkehrende Buchungen).
 * Es gilt die letzte Stufe mit ab <= schluessel.
 */
export function betragAm(stufen, schluessel) {
  const sortiert = [...(stufen ?? [])].sort((a, b) => a.ab.localeCompare(b.ab));
  let wert = sortiert[0]?.betragCent ?? 0;
  for (const s of sortiert) if (s.ab <= schluessel) wert = s.betragCent;
  return wert;
}

/* ======================= Wiederkehrende Buchungen ======================= */

const SCHRITT = { monatlich: 1, vierteljaehrlich: 3, halbjaehrlich: 6, jaehrlich: 12 };
/** D245: Turnus in Tagen (wöchentlich, zweiwöchentlich) – Termine im festen Abstand ab dem Start */
export const TAGE_SCHRITT = { woechentlich: 7, zweiwoechentlich: 14 };
export const INTERVALLE = ['woechentlich', 'zweiwoechentlich', 'monatlich', 'vierteljaehrlich', 'halbjaehrlich', 'jaehrlich'];

/**
 * D245: Tag im Monat für Termine monatlicher (und längerer) Intervalle.
 * tagRegel: 'datum' (Tag des Starts, 31. → Monatsletzter) | 'anfang' (1., D246) | 'mitte' (15.)
 *   | 'vorEnde3' (3 Tage vor dem Monatsletzten) | 'letzter'
 */
export const TAG_REGELN = ['datum', 'anfang', 'mitte', 'vorEnde3', 'letzter'];
export function tagNachRegel(tagRegel, jahr, monat, starttag) {
  const letzter = tageImMonat(jahr, monat);
  if (tagRegel === 'letzter') return letzter;
  if (tagRegel === 'anfang') return 1;
  if (tagRegel === 'mitte') return 15;
  if (tagRegel === 'vorEnde3') return letzter - 3;
  return Math.min(starttag, letzter);
}

/** D245: Start einer wiederkehrenden Buchung passend zur Tag-Regel (im Monat des Startdatums) */
export function startNachRegel(start, tagRegel) {
  const j = Number(start.slice(0, 4));
  const m = Number(start.slice(5, 7));
  return `${j}-${pad(m)}-${pad(tagNachRegel(tagRegel, j, m, Number(start.slice(8, 10))))}`;
}

/** D245: Tag-Regel einer wiederkehrenden Buchung; bei wöchentlich/zweiwöchentlich immer 'datum' */
export const tagRegelVon = (w) => (TAGE_SCHRITT[w.intervall] ? 'datum' : (TAG_REGELN.includes(w.tagRegel) ? w.tagRegel : 'datum'));

/**
 * Alle Termine einer wiederkehrenden Buchung, deren (ggf. verschobenes) Datum
 * zwischen von und bis liegt (einschließlich).
 * Ergebnis: [{ termin, datum, betragCent, verschoben }]
 *   termin = regulärer Termin (dient als Kennung), datum = tatsächliches Datum
 * Fällt der Starttag (z. B. 31.) in einem Monat weg, gilt der letzte Tag des Monats.
 * Mit w.tagRegel (D245) liegt JEDER Termin am Monatsletzten, am 15. oder 3 Tage vor dem Monatsletzten.
 * Wöchentlich/zweiwöchentlich: alle 7 bzw. 14 Tage ab dem Start.
 */
/**
 * Regulärer Betrag eines Termins einer wiederkehrenden Buchung ("JJJJ-MM-TT"), ohne Einzel-Änderung:
 * feste Abweichung für den Kalendermonat des Termins (jedes Jahr, D94) – sonst die geltende Stufe.
 */
export function terminBetrag(w, termin) {
  const kalender = (w.kalenderMonate ?? []).find((k) => k.monat === Number(termin.slice(5, 7)));
  return kalender ? kalender.betragCent : betragAm(w.stufen, termin);
}

export function termine(w, von, bis) {
  const [sj, sm, st] = w.start.split('-').map(Number);
  const schritt = SCHRITT[w.intervall] ?? 1;
  const ausnahmen = new Map((w.ausnahmen ?? []).map((a) => [a.termin, a]));
  // Verschobene Termine dürfen auch von außerhalb in den Zeitraum fallen
  const spaetesterVerschobener = (w.ausnahmen ?? []).filter((a) => a.aktion !== 'ueberspringen').map((a) => a.termin).sort().at(-1) ?? '';
  const grenze = spaetesterVerschobener > bis ? spaetesterVerschobener : bis;

  const tagRegel = tagRegelVon(w);
  const tageSchritt = TAGE_SCHRITT[w.intervall];
  const startMs = Date.UTC(sj, sm - 1, st);
  const ergebnis = [];
  for (let k = 0; k < 5000; k++) {
    let termin;
    if (tageSchritt) {
      const d = new Date(startMs + k * tageSchritt * 86400000);
      termin = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    } else {
      const index = (sm - 1) + k * schritt;
      const j = sj + Math.floor(index / 12);
      const m = (index % 12) + 1;
      termin = `${j}-${pad(m)}-${pad(tagNachRegel(tagRegel, j, m, st))}`;
    }
    if (w.ende && termin > w.ende) break;
    if (termin > grenze) break;

    const ausnahme = ausnahmen.get(termin);
    if (ausnahme?.aktion === 'ueberspringen') continue;
    // 'verschieben' (nur Datum) und 'aendern' (Datum und/oder Betrag nur für diesen Termin)
    const datum = ausnahme?.neuesDatum ?? termin;
    if (datum < von || datum > bis) continue;
    const geaendert = ausnahme?.aktion === 'aendern' && ausnahme.betragCent != null;
    ergebnis.push({
      termin, datum,
      betragCent: geaendert ? ausnahme.betragCent : terminBetrag(w, termin),
      verschoben: datum !== termin,
      einzelBetrag: geaendert,
    });
  }
  return ergebnis.sort((a, b) => a.datum.localeCompare(b.datum));
}

/** Nächster Termin ab einem Datum (oder null) */
export function naechsterTermin(w, ab) {
  return termine(w, ab, plusTage(ab, 800))[0] ?? null;
}

/** Schlüssel "wiederkehrendId|termin" aller durch Buchungen erledigten Termine (gekoppelte: über ihre Ausgabe, D227) */
export function erledigteTermine(buchungen) {
  const s = new Set();
  for (const b of buchungen) {
    if (istAktiv(b) && b.wiederkehrendId && b.faelligAm) s.add(`${b.wiederkehrendId}|${b.faelligAm}`);
  }
  return s;
}

/** Wirkung eines Termins auf ein Konto in Cent */
export function terminWirkung(w, betragCent, kontoId) {
  if (w.art === 'einnahme') return w.kontoId === kontoId ? betragCent : 0;
  if (w.art === 'ausgabe') return w.kontoId === kontoId ? -betragCent : 0;
  if (kontoId === w.kontoId) return -betragCent;
  if (kontoId === w.gegenkontoId) return betragCent;
  return 0;
}

/**
 * Offene (noch nicht gebuchte) Termine im Fenster, das die App beobachtet:
 * vom Anfang des Vormonats bis `bis` – aber nie vor dem Monat, in dem die
 * wiederkehrende Buchung angelegt wurde (sonst würden beim Anlegen mit einem
 * Start in der Vergangenheit alte Termine als offen erscheinen) und nie vor dem
 * Stichtag der beteiligten Konten.
 */
export function offeneTermine({ wiederkehrende, buchungen, konten, geplant = [] }, heute, bis, { mitGekoppelten = false } = {}) {
  const erledigt = erledigteTermine(buchungen);
  const stichtag = new Map(konten.map((k) => [k.id, k.stichtag]));
  const vormonatStart = `${plusMonate(heute.slice(0, 7), -1)}-01`;
  const ergebnis = [];

  // Geplante Einmalbuchungen (Etappe 5): offen, bis sie gebucht oder als erledigt markiert sind –
  // auch wenn ihr Datum schon länger zurückliegt (sie sollen nicht still verschwinden).
  // Für die Anzeige tragen sie dieselben Felder wie wiederkehrende Termine
  // (Eigenschaft "wiederkehrend" = die Quelle, quelle = 'geplant').
  const gebuchtGeplant = new Set(buchungen.filter((b) => istAktiv(b) && b.geplantId).map((b) => b.geplantId));
  for (const g of geplant) {
    if (g.erledigtAm || gebuchtGeplant.has(g.id) || g.datum > bis) continue;
    if (g.datum < (stichtag.get(g.kontoId) ?? '')) continue;
    ergebnis.push({
      wiederkehrend: g, quelle: 'geplant', termin: g.datum, datum: g.datum, betragCent: g.betragCent,
      verschoben: false, ueberfaellig: g.datum < heute,
    });
  }

  for (const w of wiederkehrende) {
    // D227: gekoppelte Umbuchungen nur für die Prognose – gebucht werden sie mit ihrer Ausgabe
    if (w.gekoppelt && !mitGekoppelten) continue;
    const id = w.gekoppelt?.id ?? w.id;
    const angelegtAb = `${(w.erstelltAm ?? '0000-01').slice(0, 7)}-01`;
    const von = angelegtAb > vormonatStart ? angelegtAb : vormonatStart;
    for (const t of termine(w, von, bis)) {
      if (erledigt.has(`${id}|${t.termin}`)) continue;
      if (t.datum < (stichtag.get(w.kontoId) ?? '')) continue;
      if (w.art === 'umbuchung' && t.datum < (stichtag.get(w.gegenkontoId) ?? '')) continue;
      ergebnis.push({ wiederkehrend: w, quelle: 'wiederkehrend', ...t, ueberfaellig: t.datum < heute });
    }
  }
  return ergebnis.sort((a, b) => a.datum.localeCompare(b.datum));
}

/**
 * Fällig-Liste für die Zahl am Kontoknopf (D189): offene Belastungen (Ausgaben und abgehende Umbuchungen,
 * keine Einnahmen) ab dem Tag selbst (D246, vorher 3 Tage im Voraus), überfällige eingeschlossen.
 * Gezählt wird beim abgebenden Konto (kontoId).
 */
export const FAELLIG_TAGE = 0;
export function faelligListe(daten, heute) {
  return offeneTermine(daten, heute, plusTage(heute, FAELLIG_TAGE)).filter((t) => t.wiederkehrend.art !== 'einnahme');
}
