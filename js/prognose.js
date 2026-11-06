// Etappe 4: Budgets, Termine wiederkehrender Buchungen, Monatsprognose, Budgethinweise.
// Reine Funktionen ohne Datenbank – mit `npm test` geprüft. Siehe DECISIONS.md D33–D40.

import { istAktiv, kontostand } from './rechnen.js';

const pad = (n) => String(n).padStart(2, '0');

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

/* ======================= Budgets ======================= */

/**
 * Budget einer Hauptkategorie für einen Monat ("JJJJ-MM").
 * Wiederkehrendes Budget (mit Stufen) + alle einmaligen Budgets dieses Monats.
 * kontoId: belastetes Konto – das des wiederkehrenden Budgets, sonst des einmaligen.
 */
export function budgetFuerMonat(budgets, kategorieId, monat) {
  let betragCent = 0;
  let kontoId = null;
  let vorhanden = false;
  for (const b of budgets) {
    if (b.kategorieId !== kategorieId) continue;
    if (b.typ === 'einmalig') {
      if (b.monat !== monat) continue;
      betragCent += b.betragCent;
      kontoId ??= b.kontoId;
      vorhanden = true;
    } else if (b.startMonat <= monat && (!b.endMonat || monat <= b.endMonat)) {
      betragCent += betragAm(b.stufen, monat);
      kontoId = b.kontoId;
      vorhanden = true;
    }
  }
  return { betragCent, kontoId, vorhanden };
}

/* ======================= Wiederkehrende Buchungen ======================= */

const SCHRITT = { monatlich: 1, vierteljaehrlich: 3, jaehrlich: 12 };

/**
 * Alle Termine einer wiederkehrenden Buchung, deren (ggf. verschobenes) Datum
 * zwischen von und bis liegt (einschließlich).
 * Ergebnis: [{ termin, datum, betragCent, verschoben }]
 *   termin = regulärer Termin (dient als Kennung), datum = tatsächliches Datum
 * Fällt der Starttag (z. B. 31.) in einem Monat weg, gilt der letzte Tag des Monats.
 * Mit w.monatsletzter = true ist JEDER Termin der letzte Tag seines Monats
 * (z. B. 30.11., 31.12., 28.02.) – Standard für neue wiederkehrende Buchungen.
 */
export function termine(w, von, bis) {
  const [sj, sm, st] = w.start.split('-').map(Number);
  const schritt = SCHRITT[w.intervall] ?? 1;
  const ausnahmen = new Map((w.ausnahmen ?? []).map((a) => [a.termin, a]));
  // Verschobene Termine dürfen auch von außerhalb in den Zeitraum fallen
  const spaetesterVerschobener = (w.ausnahmen ?? []).filter((a) => a.aktion === 'verschieben').map((a) => a.termin).sort().at(-1) ?? '';
  const grenze = spaetesterVerschobener > bis ? spaetesterVerschobener : bis;

  const ergebnis = [];
  for (let k = 0; k < 5000; k++) {
    const index = (sm - 1) + k * schritt;
    const j = sj + Math.floor(index / 12);
    const m = (index % 12) + 1;
    const tag = w.monatsletzter ? tageImMonat(j, m) : Math.min(st, tageImMonat(j, m));
    const termin = `${j}-${pad(m)}-${pad(tag)}`;
    if (w.ende && termin > w.ende) break;
    if (termin > grenze) break;

    const ausnahme = ausnahmen.get(termin);
    if (ausnahme?.aktion === 'ueberspringen') continue;
    const datum = ausnahme?.aktion === 'verschieben' ? ausnahme.neuesDatum : termin;
    if (datum < von || datum > bis) continue;
    ergebnis.push({ termin, datum, betragCent: betragAm(w.stufen, termin), verschoben: datum !== termin });
  }
  return ergebnis.sort((a, b) => a.datum.localeCompare(b.datum));
}

/** Nächster Termin ab einem Datum (oder null) */
export function naechsterTermin(w, ab) {
  return termine(w, ab, plusTage(ab, 800))[0] ?? null;
}

/** Schlüssel "wiederkehrendId|termin" aller durch Buchungen erledigten Termine */
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
export function offeneTermine({ wiederkehrende, buchungen, konten }, heute, bis) {
  const erledigt = erledigteTermine(buchungen);
  const stichtag = new Map(konten.map((k) => [k.id, k.stichtag]));
  const vormonatStart = `${plusMonate(heute.slice(0, 7), -1)}-01`;
  const ergebnis = [];
  for (const w of wiederkehrende) {
    const angelegtAb = `${(w.erstelltAm ?? '0000-01').slice(0, 7)}-01`;
    const von = angelegtAb > vormonatStart ? angelegtAb : vormonatStart;
    for (const t of termine(w, von, bis)) {
      if (erledigt.has(`${w.id}|${t.termin}`)) continue;
      if (t.datum < (stichtag.get(w.kontoId) ?? '')) continue;
      if (w.art === 'umbuchung' && t.datum < (stichtag.get(w.gegenkontoId) ?? '')) continue;
      ergebnis.push({ wiederkehrend: w, ...t, ueberfaellig: t.datum < heute });
    }
  }
  return ergebnis.sort((a, b) => a.datum.localeCompare(b.datum));
}

/** Fällig-Liste für die Übersicht: offene Termine bis 7 Tage im Voraus */
export function faelligListe(daten, heute) {
  return offeneTermine(daten, heute, plusTage(heute, 7));
}

/* ======================= Monatsprognose ======================= */

/** Ausgaben je Hauptkategorie in einem Monat ("JJJJ-MM"), nur echte Ausgaben */
export function ausgabenJeHauptkategorie(buchungen, kategorien, monat) {
  const kat = new Map(kategorien.map((k) => [k.id, k]));
  const summe = new Map();
  for (const b of buchungen) {
    if (!istAktiv(b) || b.art !== 'ausgabe' || b.datum.slice(0, 7) !== monat) continue;
    const hId = kat.get(b.kategorieId)?.elternId;
    if (!hId) continue;
    summe.set(hId, (summe.get(hId) ?? 0) + b.betragCent);
  }
  return summe;
}

/** Summe je Hauptkategorie in einem Monat – Einnahmen und Ausgaben (ohne Umbuchungen), als positive Cent */
export function summenJeHauptkategorie(buchungen, kategorien, monat) {
  const kat = new Map(kategorien.map((k) => [k.id, k]));
  const summe = new Map();
  for (const b of buchungen) {
    if (!istAktiv(b) || b.art === 'umbuchung' || b.datum.slice(0, 7) !== monat) continue;
    const hId = kat.get(b.kategorieId)?.elternId;
    if (hId) summe.set(hId, (summe.get(hId) ?? 0) + b.betragCent);
  }
  return summe;
}

/**
 * Welche drei Kategorien zeigt die Übersicht oben? Gespeicherte Wahl
 * (einstellungen, id 'uebersicht'), fehlende Plätze werden mit den größten
 * Ausgaben-Hauptkategorien des Monats aufgefüllt (dann alphabetisch).
 */
export function kennzahlKategorien(einstellungen, kategorien, summen) {
  const haupt = kategorien.filter((k) => !k.elternId && !k.archiviert);
  const gueltig = (id) => haupt.some((k) => k.id === id);
  const gewaehlt = (einstellungen.find((e) => e.id === 'uebersicht')?.kategorien ?? []).slice(0, 3);
  const vorschlaege = haupt
    .filter((k) => k.art === 'ausgabe')
    .sort((a, b) => (summen.get(b.id) ?? 0) - (summen.get(a.id) ?? 0) || a.name.localeCompare(b.name, 'de'))
    .map((k) => k.id);
  const ergebnis = [];
  for (let i = 0; i < 3; i++) {
    const id = gewaehlt[i];
    ergebnis.push(id && gueltig(id) ? id : vorschlaege.find((v) => !ergebnis.includes(v) && !gewaehlt.includes(v)) ?? null);
  }
  return ergebnis;
}

/**
 * Prognose für den laufenden Monat (Regeln aus CLAUDE.md, Entscheidungen D35):
 * - Je Hauptkategorie mit Budget: Prognose = das Höhere aus Budget und
 *   (Ist + offene wiederkehrende Ausgaben). Ohne Budget: Ist + offene.
 *   Also: echte Buchungen + offener Budgetrest, mindestens aber die echten Buchungen.
 * - Je Konto: Stand am Monatsende aus echten Buchungen
 *   + Wirkung offener wiederkehrender Termine (inkl. überfälliger aus dem Vormonat)
 *   − offener Budgetrest der Budgets, die dieses Konto belasten.
 */
export function monatsprognose(daten, heute) {
  const { konten, kategorien, buchungen, budgets } = daten;
  const monat = heute.slice(0, 7);
  const erster = `${monat}-01`;
  const ende = monatsende(heute);
  const kat = new Map(kategorien.map((k) => [k.id, k]));
  const aktiveKonten = konten.filter((k) => !k.archiviert);

  // Einnahmen/Ausgaben des Monats (alle Konten, ohne Umbuchungen)
  let einnahmen = 0;
  let ausgaben = 0;
  for (const b of buchungen) {
    if (!istAktiv(b) || b.datum < erster || b.datum > ende) continue;
    if (b.art === 'einnahme') einnahmen += b.betragCent;
    else if (b.art === 'ausgabe') ausgaben += b.betragCent;
  }

  const istJe = ausgabenJeHauptkategorie(buchungen, kategorien, monat);
  const offen = offeneTermine(daten, heute, ende);
  const offenJe = new Map();
  for (const t of offen) {
    if (t.wiederkehrend.art !== 'ausgabe' || t.datum < erster) continue;
    const hId = kat.get(t.wiederkehrend.kategorieId)?.elternId;
    if (hId) offenJe.set(hId, (offenJe.get(hId) ?? 0) + t.betragCent);
  }

  // Kategorien: alle Ausgaben-Hauptkategorien mit Ist, Offenem oder Budget
  const ids = new Set([...istJe.keys(), ...offenJe.keys(), ...budgets.map((b) => b.kategorieId)]);
  const kategorieZeilen = [];
  for (const id of ids) {
    const hk = kat.get(id);
    if (!hk) continue;
    const budget = budgetFuerMonat(budgets, id, monat);
    const ist = istJe.get(id) ?? 0;
    const offenCent = offenJe.get(id) ?? 0;
    if (!budget.vorhanden && ist === 0 && offenCent === 0) continue;
    const prognose = budget.vorhanden ? Math.max(budget.betragCent, ist + offenCent) : ist + offenCent;
    const rest = budget.vorhanden ? Math.max(0, budget.betragCent - ist - offenCent) : 0;
    kategorieZeilen.push({
      id, name: hk.name, ist, offen: offenCent, prognose, rest,
      budget: budget.vorhanden ? budget.betragCent : null,
      budgetKontoId: budget.kontoId,
      auslastung: budget.vorhanden && budget.betragCent > 0 ? ist / budget.betragCent : null,
    });
  }

  // Konten – mit Aufschlüsselung, damit die Übersicht je Konto zeigen kann,
  // woraus sich die Prognose zusammensetzt
  const jeKonto = new Map();
  let zugeordneterRest = 0;
  for (const k of aktiveKonten) {
    const standHeute = kontostand(k, buchungen, heute);
    const endeEcht = kontostand(k, buchungen, ende);
    const termineKonto = offen
      .map((t) => ({ ...t, wirkung: terminWirkung(t.wiederkehrend, t.betragCent, k.id) }))
      .filter((t) => t.wirkung !== 0);
    const offenWirkung = termineKonto.reduce((s, t) => s + t.wirkung, 0);
    const budgetsKonto = kategorieZeilen.filter((z) => z.budget !== null && z.budgetKontoId === k.id);
    const rest = budgetsKonto.reduce((s, z) => s + z.rest, 0);
    zugeordneterRest += rest;
    jeKonto.set(k.id, {
      konto: k,
      heute: standHeute,
      endeEcht, // Stand Monatsende nur aus echten Buchungen
      offenWirkung, // Summe offener wiederkehrender Termine (+/−)
      rest, // offener Budgetrest, der dieses Konto belastet
      prognose: endeEcht + offenWirkung - rest,
      termine: termineKonto, // offene Termine dieses Kontos
      budgets: budgetsKonto, // Budgets, die dieses Konto belasten
    });
  }
  const gesamtRest = kategorieZeilen.reduce((s, z) => s + z.rest, 0);
  const gesamtHeute = [...jeKonto.values()].reduce((s, x) => s + x.heute, 0);
  // Budgetrest ohne (aktives) Konto mindert trotzdem die Gesamtprognose
  const gesamtPrognose = [...jeKonto.values()].reduce((s, x) => s + x.prognose, 0) - (gesamtRest - zugeordneterRest);

  // Mindestsaldo-Warnungen
  const warnungen = [];
  for (const { konto, heute: h, prognose } of jeKonto.values()) {
    if (konto.mindestsaldoCent == null) continue;
    if (h < konto.mindestsaldoCent) warnungen.push({ konto, wann: 'heute', standCent: h });
    else if (prognose < konto.mindestsaldoCent) warnungen.push({ konto, wann: 'monatsende', standCent: prognose });
  }

  const groesste = kategorieZeilen.filter((z) => z.ist > 0).sort((a, b) => b.ist - a.ist)[0] ?? null;

  return {
    monat, einnahmen, ausgaben, gesamtHeute, gesamtPrognose, jeKonto, warnungen, groesste, offen,
    kategorien: kategorieZeilen.sort((a, b) => (b.budget ?? 0) - (a.budget ?? 0) || b.ist - a.ist),
  };
}

/* ======================= Budgethinweise ======================= */

/**
 * Budgethinweise (CLAUDE.md "Budgethinweis", Entscheidung D38):
 * Liegt eine Hauptkategorie in den letzten N abgeschlossenen Monaten JEDES Mal über
 * (bzw. jedes Mal unter) dem Budget und weicht sie im Schnitt um mehr als P % ab,
 * entsteht ein Hinweis mit Vorschlag (Ø der Ist-Werte, auf 10 € gerundet).
 * Unterdrückt wird ein Hinweis, wenn
 *  - "später erinnern" gewählt wurde und das Datum noch nicht erreicht ist, oder
 *  - "übernommen"/"abgelehnt" für ein Zeitfenster gewählt wurde, das sich mit dem
 *    aktuellen überschneidet (es braucht also N neue Monate für einen neuen Hinweis).
 * Ergebnis absteigend nach Stärke der Abweichung sortiert.
 */
export function budgetHinweise(daten, heute) {
  const { kategorien, buchungen, budgets, hinweise = [], einstellungen = [] } = daten;
  const e = einstellungen.find((x) => x.id === 'hinweise') ?? {};
  const n = Math.max(1, Number(e.monate) || 3);
  const schwelle = (Number(e.prozent) || 10) / 100;

  const aktuell = heute.slice(0, 7);
  const fenster = [];
  for (let i = n; i >= 1; i--) fenster.push(plusMonate(aktuell, -i));

  // Erst auswerten, wenn für das ganze Fenster Buchungen erfasst sind
  const erste = buchungen.filter(istAktiv).map((b) => b.datum).sort()[0];
  if (!erste || fenster[0] < erste.slice(0, 7)) return [];

  const istJeMonat = new Map(fenster.map((m) => [m, ausgabenJeHauptkategorie(buchungen, kategorien, m)]));
  const ergebnis = [];
  for (const hk of kategorien) {
    if (hk.elternId || hk.art !== 'ausgabe') continue;
    const zeilen = fenster.map((m) => {
      const b = budgetFuerMonat(budgets, hk.id, m);
      return { monat: m, budget: b.vorhanden ? b.betragCent : 0, ist: istJeMonat.get(m).get(hk.id) ?? 0 };
    });
    if (zeilen.some((z) => z.budget <= 0)) continue;

    const abweichungen = zeilen.map((z) => (z.ist - z.budget) / z.budget);
    const ueber = abweichungen.every((a) => a > 0);
    const unter = abweichungen.every((a) => a < 0);
    const schnitt = abweichungen.reduce((s, a) => s + a, 0) / abweichungen.length;
    if (!(ueber || unter) || Math.abs(schnitt) <= schwelle) continue;

    const bisMonat = fenster.at(-1);
    const unterdrueckt = hinweise.some((x) => x.kategorieId === hk.id && (
      (x.status === 'spaeter' && heute < x.erinnernAb)
      || ((x.status === 'uebernommen' || x.status === 'abgelehnt') && fenster[0] <= x.bisMonat)));
    if (unterdrueckt) continue;

    const istSchnitt = zeilen.reduce((s, z) => s + z.ist, 0) / zeilen.length;
    ergebnis.push({
      kategorie: hk,
      richtung: ueber ? 'ueber' : 'unter',
      zeilen,
      abweichung: schnitt,
      istSchnittCent: Math.round(istSchnitt),
      vorschlagCent: Math.max(1000, Math.round(istSchnitt / 1000) * 1000),
      aktuellesBudgetCent: budgetFuerMonat(budgets, hk.id, aktuell).betragCent,
      bisMonat,
    });
  }
  return ergebnis.sort((a, b) => Math.abs(b.abweichung) - Math.abs(a.abweichung));
}
