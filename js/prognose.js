// Etappe 4: Budgets, Termine wiederkehrender Buchungen, Monatsprognose, Budgethinweise.
// Reine Funktionen ohne Datenbank – mit `npm test` geprüft. Siehe DECISIONS.md D33–D40.

import { istAktiv, kontostand, buchungenVonKonto, wirkungCent } from './rechnen.js';
import { istJaehrlich, jahresbudgetJahr } from './jahresbudget.js';

const pad = (n) => String(n).padStart(2, '0');

/* ======================= Ein/Aus-Schalter (Etappe 5) ======================= */

/** Zählt eine Annahme (Budget, wiederkehrende oder geplante Buchung) in der Prognose mit? */
export function wirksam(eintrag) {
  return eintrag.aktiv !== false;
}

/** Kopie der Daten, in der nur die eingeschalteten Annahmen enthalten sind */
export function nurWirksam(daten) {
  const filter = (liste) => (liste ?? []).filter(wirksam);
  return {
    ...daten,
    budgets: filter(daten.budgets),
    wiederkehrende: filter(daten.wiederkehrende ?? daten.wiederkehrend),
    geplant: filter(daten.geplant),
  };
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

/* ======================= Budgets ======================= */

/**
 * Budget einer Hauptkategorie für einen Monat ("JJJJ-MM").
 * Wiederkehrendes Budget (mit Stufen) + alle einmaligen Budgets dieses Monats.
 * Mit nurKonto: nur die Budgets dieses Kontos (D85: Budgets gelten je Konto).
 * Ohne nurKonto: alle Konten zusammen (nur für Summen in der Anzeige).
 * kontoId im Ergebnis: das des wiederkehrenden Budgets, sonst des einmaligen.
 */
export function budgetFuerMonat(budgets, kategorieId, monat, nurKonto) {
  let betragCent = 0;
  let kontoId = null;
  let vorhanden = false;
  for (const b of budgets) {
    if (b.kategorieId !== kategorieId || istJaehrlich(b)) continue; // Jahresbudgets: jahresbudgetPlan (D90)
    if (nurKonto !== undefined && b.kontoId !== nurKonto) continue;
    if (b.typ === 'einmalig') {
      if (b.monat !== monat) continue;
      betragCent += b.betragCent;
      kontoId ??= b.kontoId;
      vorhanden = true;
    } else if (b.startMonat <= monat && (!b.endMonat || monat <= b.endMonat)) {
      // Ausnahme nur für diesen Monat (Datenversion 7), sonst der Regelbetrag
      const ausnahme = (b.ausnahmen ?? []).find((a) => a.monat === monat);
      betragCent += ausnahme ? ausnahme.betragCent : regelBetrag(b, monat);
      kontoId = b.kontoId;
      vorhanden = true;
    }
  }
  return { betragCent, kontoId, vorhanden };
}

/**
 * Regulärer Betrag eines monatlichen Budgets in einem Monat ("JJJJ-MM"), ohne Einzel-Ausnahme:
 * feste Abweichung für diesen Kalendermonat (jedes Jahr, D92) – sonst die geltende Stufe.
 */
export function regelBetrag(b, monat) {
  const kalender = (b.kalenderMonate ?? []).find((k) => k.monat === Number(monat.slice(5, 7)));
  return kalender ? kalender.betragCent : betragAm(b.stufen, monat);
}

/**
 * Hauptkategorie, deren Budget eine Bewegung verbraucht – oder null (D98).
 * Ausgaben ohne Projekt über ihre Unterkategorie; Umbuchungen (nur die abgebende Seite)
 * über die optional zugeordnete Budget-Kategorie, z. B. Urlaub per PayPal bezahlt.
 * Für Buchungen, Termine wiederkehrender und geplante Buchungen gleichermaßen.
 */
export function budgetHauptVon(x, hauptVon) {
  if (x.art === 'umbuchung') return x.richtung === 'zu' ? null : (x.budgetKategorieId ?? null);
  if (x.art !== 'ausgabe' || x.projektId) return null;
  return hauptVon(x.kategorieId) ?? null;
}

/** Schlüssel für „Hauptkategorie auf einem Konto“ (D85) */
export const budgetSchluessel = (kontoId, kategorieId) => `${kontoId}|${kategorieId}`;

/** Alle Paare aus Konto und Hauptkategorie, für die es ein Budget gibt (D85) */
export function budgetPaare(budgets) {
  const paare = new Map();
  for (const b of budgets) {
    if (!istJaehrlich(b)) paare.set(budgetSchluessel(b.kontoId, b.kategorieId), { kontoId: b.kontoId, kategorieId: b.kategorieId });
  }
  return [...paare.values()];
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
export function offeneTermine({ wiederkehrende, buchungen, konten, geplant = [] }, heute, bis) {
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
    const angelegtAb = `${(w.erstelltAm ?? '0000-01').slice(0, 7)}-01`;
    const von = angelegtAb > vormonatStart ? angelegtAb : vormonatStart;
    for (const t of termine(w, von, bis)) {
      if (erledigt.has(`${w.id}|${t.termin}`)) continue;
      if (t.datum < (stichtag.get(w.kontoId) ?? '')) continue;
      if (w.art === 'umbuchung' && t.datum < (stichtag.get(w.gegenkontoId) ?? '')) continue;
      ergebnis.push({ wiederkehrend: w, quelle: 'wiederkehrend', ...t, ueberfaellig: t.datum < heute });
    }
  }
  return ergebnis.sort((a, b) => a.datum.localeCompare(b.datum));
}

/** Fällig-Liste für die Übersicht: offene Termine bis 7 Tage im Voraus */
export function faelligListe(daten, heute) {
  return offeneTermine(daten, heute, plusTage(heute, 7));
}

/* ======================= Monatsprognose ======================= */

/**
 * Ausgaben je Konto und Hauptkategorie in einem Monat ("JJJJ-MM"), nur echte Ausgaben –
 * das ist der Budgetverbrauch. Schlüssel: budgetSchluessel(kontoId, hauptId), denn ein
 * Budget wird nur von Ausgaben auf seinem eigenen Konto verbraucht (D85).
 * Projektbuchungen zählen NICHT gegen das Monatsbudget (D52), im Kontostand natürlich schon.
 */
export function ausgabenJeKontoUndKategorie(buchungen, kategorien, monat) {
  const kat = new Map(kategorien.map((k) => [k.id, k]));
  const summe = new Map();
  for (const b of buchungen) {
    if (!istAktiv(b) || b.datum.slice(0, 7) !== monat) continue;
    const hId = budgetHauptVon(b, (id) => kat.get(id)?.elternId); // inkl. Umbuchungen mit Budget (D98)
    if (!hId) continue;
    const s = budgetSchluessel(b.kontoId, hId);
    summe.set(s, (summe.get(s) ?? 0) + b.betragCent);
  }
  return summe;
}

/**
 * Summe je Hauptkategorie in einem Monat – Einnahmen und Ausgaben (ohne Umbuchungen), als positive Cent.
 * Ohne Projektbuchungen, damit der Vergleich mit dem Budget stimmt (D52).
 */
export function summenJeHauptkategorie(buchungen, kategorien, monat) {
  const kat = new Map(kategorien.map((k) => [k.id, k]));
  const summe = new Map();
  for (const b of buchungen) {
    if (!istAktiv(b) || b.art === 'umbuchung' || b.projektId || b.datum.slice(0, 7) !== monat) continue;
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
 * Prognose für den laufenden Monat (Regeln aus CLAUDE.md, Entscheidungen D35, D85):
 * - Je Konto und Hauptkategorie mit Budget: Prognose = das Höhere aus Budget und
 *   (Ist + offene wiederkehrende Ausgaben – beides nur auf diesem Konto). Ohne Budget: Ist + offene.
 *   Also: echte Buchungen + offener Budgetrest, mindestens aber die echten Buchungen.
 * - Je Konto: Stand am Monatsende aus echten Buchungen
 *   + Wirkung offener wiederkehrender Termine (inkl. überfälliger aus dem Vormonat)
 *   − offener Budgetrest der Budgets, die dieses Konto belasten.
 * - Je Konto (D110/D111): niedrigster erwarteter Stand = Stand heute + alle bis Monatsende noch
 *   erwarteten Bewegungen AUSSER Einnahmen (schon erfasste mit späterem Datum, offene Termine,
 *   Umbuchungen in beide Richtungen) − offener Budgetrest. Noch ausstehende echte Einnahmen
 *   zählen NICHT – so sieht man den ungünstigsten Fall, falls Geld später kommt als die Abbuchungen.
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

  const istJe = ausgabenJeKontoUndKategorie(buchungen, kategorien, monat);
  const offen = offeneTermine(daten, heute, ende);
  const offenJe = new Map();
  for (const t of offen) {
    if (t.datum < erster) continue;
    const hId = budgetHauptVon(t.wiederkehrend, (id) => kat.get(id)?.elternId); // inkl. Umbuchungen mit Budget (D98)
    if (!hId) continue;
    const s = budgetSchluessel(t.wiederkehrend.kontoId, hId);
    offenJe.set(s, (offenJe.get(s) ?? 0) + t.betragCent);
  }

  // Zeilen je Konto und Ausgaben-Hauptkategorie mit Ist, Offenem oder Budget (D85)
  const schluessel = new Set([...istJe.keys(), ...offenJe.keys(), ...budgets.map((b) => budgetSchluessel(b.kontoId, b.kategorieId))]);
  const kategorieZeilen = [];
  for (const s of schluessel) {
    const [kontoId, id] = s.split('|');
    const hk = kat.get(id);
    if (!hk) continue;
    const budget = budgetFuerMonat(budgets, id, monat, kontoId);
    const ist = istJe.get(s) ?? 0;
    const offenCent = offenJe.get(s) ?? 0;
    if (!budget.vorhanden && ist === 0 && offenCent === 0) continue;
    const prognose = budget.vorhanden ? Math.max(budget.betragCent, ist + offenCent) : ist + offenCent;
    const rest = budget.vorhanden ? Math.max(0, budget.betragCent - ist - offenCent) : 0;
    kategorieZeilen.push({
      id, kontoId, name: hk.name, ist, offen: offenCent, prognose, rest,
      budget: budget.vorhanden ? budget.betragCent : null,
      auslastung: budget.vorhanden && budget.betragCent > 0 ? ist / budget.betragCent : null,
    });
  }

  // Jahresbudgets (D90): Tranche oder Restbudget, das in diesem Monat fällig ist
  for (const p of jahresbudgetPlan(daten, heute, `${monat.slice(0, 4)}-12`).get(monat) ?? []) {
    const hk = kat.get(p.kategorieId);
    if (!hk) continue;
    let z = kategorieZeilen.find((x) => x.id === p.kategorieId && x.kontoId === p.kontoId);
    if (!z) {
      z = { id: p.kategorieId, kontoId: p.kontoId, ist: 0, offen: 0 };
      kategorieZeilen.push(z);
    }
    const offenCent = offenJe.get(budgetSchluessel(p.kontoId, p.kategorieId)) ?? 0;
    Object.assign(z, {
      name: `${hk.name} (${p.art === 'rest' ? 'Restbudget Jahr' : 'Jahresbudget'})`,
      jaehrlich: true,
      ist: p.verbrauchtCent - offenCent, // echte Ausgaben im Abschnitt
      offen: offenCent,
      budget: p.betragCent,
      rest: p.restCent,
      prognose: Math.max(p.betragCent, p.verbrauchtCent),
      auslastung: p.betragCent > 0 ? (p.verbrauchtCent - offenCent) / p.betragCent : null,
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
    // D110: getrennt nach Eingängen (+) und Belastungen (−)
    const offenEinnahmen = termineKonto.reduce((s, t) => s + Math.max(0, t.wirkung), 0);
    const offenAusgaben = termineKonto.reduce((s, t) => s + Math.min(0, t.wirkung), 0);
    const budgetsKonto = kategorieZeilen.filter((z) => z.budget !== null && z.kontoId === k.id);
    const rest = budgetsKonto.reduce((s, z) => s + z.rest, 0);
    zugeordneterRest += rest;
    // D111: alles bis Monatsende außer echten Einnahmen – Umbuchungen zählen in beide Richtungen
    const spaetereOhneEinnahmen = buchungenVonKonto(k, buchungen)
      .filter((b) => b.datum > heute && b.datum <= ende && b.art !== 'einnahme')
      .reduce((s, b) => s + wirkungCent(b), 0);
    const offenOhneEinnahmen = termineKonto
      .filter((t) => t.wiederkehrend.art !== 'einnahme')
      .reduce((s, t) => s + t.wirkung, 0);
    jeKonto.set(k.id, {
      konto: k,
      heute: standHeute,
      endeEcht, // Stand Monatsende nur aus echten Buchungen
      offenWirkung, // Summe offener wiederkehrender Termine (+/−)
      offenEinnahmen, // davon Eingänge (≥ 0)
      offenAusgaben, // davon Belastungen (≤ 0)
      rest, // offener Budgetrest, der dieses Konto belastet
      niedrigster: standHeute + spaetereOhneEinnahmen + offenOhneEinnahmen - rest, // D110/D111
      prognose: endeEcht + offenWirkung - rest,
      termine: termineKonto, // offene Termine dieses Kontos
      budgets: budgetsKonto, // Budgets, die dieses Konto belasten
    });
  }
  const gesamtRest = kategorieZeilen.reduce((s, z) => s + z.rest, 0);
  const gesamtHeute = [...jeKonto.values()].reduce((s, x) => s + x.heute, 0);
  // Budgetrest ohne (aktives) Konto mindert trotzdem die Gesamtprognose
  const gesamtPrognose = [...jeKonto.values()].reduce((s, x) => s + x.prognose, 0) - (gesamtRest - zugeordneterRest);

  // Mindestsaldo-Warnungen: heute, sonst bis Monatsende nach dem niedrigsten erwarteten Stand (D110)
  const warnungen = [];
  for (const { konto, heute: h, niedrigster } of jeKonto.values()) {
    if (konto.mindestsaldoCent == null) continue;
    if (h < konto.mindestsaldoCent) warnungen.push({ konto, wann: 'heute', standCent: h });
    else if (niedrigster < konto.mindestsaldoCent) warnungen.push({ konto, wann: 'monatsende', standCent: niedrigster });
  }

  const groesste = kategorieZeilen.filter((z) => z.ist > 0).sort((a, b) => b.ist - a.ist)[0] ?? null;

  return {
    monat, einnahmen, ausgaben, gesamtHeute, gesamtPrognose, jeKonto, warnungen, groesste, offen,
    kategorien: kategorieZeilen.sort((a, b) => (b.budget ?? 0) - (a.budget ?? 0) || b.ist - a.ist),
  };
}

/* ======================= Budgethinweise ======================= */

/**
 * Budgethinweise (CLAUDE.md "Budgethinweis", Entscheidungen D38, D85) – je Konto:
 * Liegt eine Hauptkategorie auf einem Konto in den letzten N abgeschlossenen Monaten JEDES Mal über
 * (bzw. jedes Mal unter) dem Budget und weicht sie im Schnitt um mehr als P % ab,
 * entsteht ein Hinweis mit Vorschlag (Ø der Ist-Werte, auf 10 € gerundet).
 * Unterdrückt wird ein Hinweis, wenn
 *  - "später erinnern" gewählt wurde und das Datum noch nicht erreicht ist, oder
 *  - "übernommen"/"abgelehnt" für ein Zeitfenster gewählt wurde, das sich mit dem
 *    aktuellen überschneidet (es braucht also N neue Monate für einen neuen Hinweis).
 * Ergebnis absteigend nach Stärke der Abweichung sortiert.
 */
export function budgetHinweise(daten, heute) {
  const { kategorien, buchungen, budgets, konten = [], hinweise = [], einstellungen = [] } = daten;
  const e = einstellungen.find((x) => x.id === 'hinweise') ?? {};
  const n = Math.max(1, Number(e.monate) || 3);
  const schwelle = (Number(e.prozent) || 10) / 100;

  const aktuell = heute.slice(0, 7);
  const fenster = [];
  for (let i = n; i >= 1; i--) fenster.push(plusMonate(aktuell, -i));

  // Erst auswerten, wenn für das ganze Fenster Buchungen erfasst sind
  const erste = buchungen.filter(istAktiv).map((b) => b.datum).sort()[0];
  if (!erste || fenster[0] < erste.slice(0, 7)) return [];

  const istJeMonat = new Map(fenster.map((m) => [m, ausgabenJeKontoUndKategorie(buchungen, kategorien, m)]));
  const kat = new Map(kategorien.map((k) => [k.id, k]));
  const kontoMap = new Map(konten.map((k) => [k.id, k]));
  const ergebnis = [];
  for (const { kontoId, kategorieId } of budgetPaare(budgets)) {
    const hk = kat.get(kategorieId);
    const konto = kontoMap.get(kontoId) ?? null;
    if (!hk || hk.elternId || hk.art !== 'ausgabe' || konto?.archiviert) continue;
    const zeilen = fenster.map((m) => {
      const b = budgetFuerMonat(budgets, hk.id, m, kontoId);
      return { monat: m, budget: b.vorhanden ? b.betragCent : 0, ist: istJeMonat.get(m).get(budgetSchluessel(kontoId, hk.id)) ?? 0 };
    });
    if (zeilen.some((z) => z.budget <= 0)) continue;

    const abweichungen = zeilen.map((z) => (z.ist - z.budget) / z.budget);
    const ueber = abweichungen.every((a) => a > 0);
    const unter = abweichungen.every((a) => a < 0);
    const schnitt = abweichungen.reduce((s, a) => s + a, 0) / abweichungen.length;
    if (!(ueber || unter) || Math.abs(schnitt) <= schwelle) continue;

    const bisMonat = fenster.at(-1);
    // Alte Entscheidungen ohne Konto (vor D85) gelten für alle Konten der Kategorie
    const unterdrueckt = hinweise.some((x) => x.kategorieId === hk.id && (!x.kontoId || x.kontoId === kontoId) && (
      (x.status === 'spaeter' && heute < x.erinnernAb)
      || ((x.status === 'uebernommen' || x.status === 'abgelehnt') && fenster[0] <= x.bisMonat)));
    if (unterdrueckt) continue;

    const istSchnitt = zeilen.reduce((s, z) => s + z.ist, 0) / zeilen.length;
    ergebnis.push({
      kategorie: hk,
      konto,
      kontoId,
      richtung: ueber ? 'ueber' : 'unter',
      zeilen,
      abweichung: schnitt,
      istSchnittCent: Math.round(istSchnitt),
      vorschlagCent: Math.max(1000, Math.round(istSchnitt / 1000) * 1000),
      aktuellesBudgetCent: budgetFuerMonat(budgets, hk.id, aktuell, kontoId).betragCent,
      bisMonat,
    });
  }
  return ergebnis.sort((a, b) => Math.abs(b.abweichung) - Math.abs(a.abweichung));
}

/* ======================= Zeitleiste bis 2050 (Etappe 5) ======================= */

export const LETZTER_MONAT = '2050-12';

/**
 * Prognose für jeden Monat NACH dem laufenden bis Dezember 2050.
 * daten: bereits auf wirksame Annahmen gefiltert (nurWirksam), mit `wiederkehrende` und `geplant`.
 * Startwert je Konto ist die Prognose zum Ende des laufenden Monats (monatsprognose).
 * Je Monat zählen: echte Buchungen mit Zukunftsdatum, Termine wiederkehrender Buchungen,
 * offene geplante Einmalbuchungen und – je Konto und Hauptkategorie mit Budget – der Rest bis
 * zur Budgethöhe (verbraucht nur von Ausgaben auf diesem Konto, D85; belastet dieses Konto).
 *
 * Ergebnis: { monate, jeKonto: Map(kontoId → [zeile]), gesamt: [zeile], start }
 * zeile = { monat, einnahmen, ausgaben, umbuchungen, stand, posten: [{ datum, text, wirkung, quelle, ref }] }
 * ref (zum Ändern): { wiederkehrend, termin, … } | { geplant } | { budget: { kategorieId, monat, … } } | undefined
 */
export function zeitleiste(daten, heute, bisMonat = LETZTER_MONAT) {
  const { konten, kategorien, buchungen, budgets = [], wiederkehrende = [], geplant = [] } = daten;
  const start = monatsprognose(daten, heute);
  const ersterMonat = plusMonate(heute.slice(0, 7), 1);
  if (ersterMonat > bisMonat) return { monate: [], jeKonto: new Map(), gesamt: [], start };

  const monate = [];
  for (let m = ersterMonat; m <= bisMonat; m = plusMonate(m, 1)) monate.push(m);
  const von = `${ersterMonat}-01`;
  const bis = monatsende(`${bisMonat}-01`);
  const kat = new Map(kategorien.map((k) => [k.id, k]));
  const hauptVon = (unterId) => kat.get(unterId)?.elternId ?? null;
  const aktiveKonten = konten.filter((k) => !k.archiviert);
  const kontoIds = new Set(aktiveKonten.map((k) => k.id));
  const stichtag = new Map(konten.map((k) => [k.id, k.stichtag]));
  const kontoName = new Map(konten.map((k) => [k.id, k.name]));

  // 1. Alle künftigen Bewegungen einsammeln und nach Monat sortieren
  const bewegungen = new Map(monate.map((m) => [m, []]));
  const merke = (x) => bewegungen.get(x.datum.slice(0, 7))?.push(x);
  for (const b of buchungen) {
    if (!istAktiv(b) || b.datum < von || b.datum > bis) continue;
    if (b.art === 'umbuchung' && b.richtung !== 'ab') continue; // Umbuchung nur einmal
    merke({
      art: b.art, kontoId: b.kontoId, gegenkontoId: b.gegenkontoId, betragCent: b.betragCent, datum: b.datum,
      hauptId: hauptVon(b.kategorieId), text: [b.partner, b.notiz || kat.get(b.kategorieId)?.name || 'Umbuchung'].filter(Boolean).join(' · '), quelle: 'gebucht',
      projektId: b.projektId ?? null, budgetKategorieId: b.budgetKategorieId ?? null,
    });
  }
  for (const w of wiederkehrende) {
    for (const t of termine(w, von, bis)) {
      if (t.datum < (stichtag.get(w.kontoId) ?? '')) continue;
      merke({
        art: w.art, kontoId: w.kontoId, gegenkontoId: w.gegenkontoId, betragCent: t.betragCent, datum: t.datum,
        hauptId: hauptVon(w.kategorieId), text: annahmeTitel(w, kategorien), quelle: 'wiederkehrend', budgetKategorieId: w.budgetKategorieId ?? null,
        ref: { wiederkehrend: w, termin: t.termin, einzelBetrag: t.einzelBetrag, verschoben: t.verschoben },
      });
    }
  }
  const gebucht = new Set(buchungen.filter((b) => istAktiv(b) && b.geplantId).map((b) => b.geplantId));
  for (const g of geplant) {
    if (g.erledigtAm || gebucht.has(g.id) || g.datum < von || g.datum > bis) continue;
    merke({
      art: g.art, kontoId: g.kontoId, gegenkontoId: g.gegenkontoId, betragCent: g.betragCent, datum: g.datum,
      hauptId: hauptVon(g.kategorieId), text: g.bezeichnung, quelle: 'geplant', budgetKategorieId: g.budgetKategorieId ?? null,
      projektId: g.projektId ?? null, ref: { geplant: g },
    });
  }
  const paare = budgetPaare(budgets);
  const jahresPlan = jahresbudgetPlan(daten, heute, bisMonat); // D90
  // Kategorien mit Budgets auf mehreren Konten: Konto im Text nennen (Gesamtsicht)
  const zaehler = new Map();
  for (const p of paare) zaehler.set(p.kategorieId, (zaehler.get(p.kategorieId) ?? 0) + 1);
  // Jahresbudgets zählen hier mit: >0 heißt dann „gibt es auch auf einem anderen Konto“
  const jahrKonten = new Map();
  for (const b of budgets.filter(istJaehrlich)) {
    if (!jahrKonten.has(b.kategorieId)) jahrKonten.set(b.kategorieId, new Set());
    jahrKonten.get(b.kategorieId).add(b.kontoId);
  }

  // 2. Monat für Monat fortschreiben
  const stand = new Map(aktiveKonten.map((k) => [k.id, start.jeKonto.get(k.id)?.prognose ?? 0]));
  let gesamtStand = start.gesamtPrognose;
  const jeKonto = new Map(aktiveKonten.map((k) => [k.id, []]));
  const gesamt = [];

  for (const m of monate) {
    const leer = () => ({ monat: m, einnahmen: 0, ausgaben: 0, umbuchungen: 0, stand: 0, posten: [] });
    const zeilen = new Map(aktiveKonten.map((k) => [k.id, leer()]));
    const g = leer();
    const istJe = new Map();

    for (const x of bewegungen.get(m).sort((a, b) => a.datum.localeCompare(b.datum))) {
      if (x.art === 'umbuchung') {
        for (const [kid, wirkung] of [[x.kontoId, -x.betragCent], [x.gegenkontoId, x.betragCent]]) {
          const z = zeilen.get(kid);
          if (!z) continue;
          z.umbuchungen += wirkung;
          z.posten.push({ datum: x.datum, text: x.text, wirkung, quelle: x.quelle, umbuchung: true, ref: x.ref });
        }
        // In der Gesamtsicht heben sich Umbuchungen zwischen aktiven Konten auf
        g.umbuchungen += (kontoIds.has(x.kontoId) ? -x.betragCent : 0) + (kontoIds.has(x.gegenkontoId) ? x.betragCent : 0);
        // D98: Umbuchung mit Budget-Zuordnung verbraucht das Budget auf dem abgebenden Konto
        if (x.budgetKategorieId) {
          const s = budgetSchluessel(x.kontoId, x.budgetKategorieId);
          istJe.set(s, (istJe.get(s) ?? 0) + x.betragCent);
        }
        continue;
      }
      const wirkung = x.art === 'einnahme' ? x.betragCent : -x.betragCent;
      const posten = { datum: x.datum, text: x.text, wirkung, quelle: x.quelle, ref: x.ref };
      for (const z of [zeilen.get(x.kontoId), kontoIds.has(x.kontoId) ? g : null]) {
        if (!z) continue;
        if (wirkung > 0) z.einnahmen += wirkung;
        else z.ausgaben -= wirkung;
        z.posten.push(posten);
      }
      // Budgetverbrauch – Projektausgaben laufen am Monatsbudget vorbei (D52)
      // und nur auf dem eigenen Konto (D85)
      if (x.art === 'ausgabe' && x.hauptId && !x.projektId) {
        const s = budgetSchluessel(x.kontoId, x.hauptId);
        istJe.set(s, (istJe.get(s) ?? 0) + x.betragCent);
      }
    }

    for (const { kontoId, kategorieId: id } of paare) {
      const b = budgetFuerMonat(budgets, id, m, kontoId);
      if (!b.vorhanden) continue;
      const verbraucht = istJe.get(budgetSchluessel(kontoId, id)) ?? 0;
      const rest = Math.max(0, b.betragCent - verbraucht);
      if (rest === 0) continue;
      const text = `Budget ${kat.get(id)?.name ?? '?'}` + (zaehler.get(id) > 1 ? ` (${kontoName.get(kontoId) ?? '?'})` : '');
      // ref: für "nur diesen Monat ändern" (Budget, Ist/Verplantes und Rest dieses Monats)
      const posten = {
        datum: monatsende(`${m}-01`), text, wirkung: -rest, quelle: 'budget',
        ref: { budget: {
          kategorieId: id, kontoId, monat: m, betragCent: b.betragCent, verbrauchtCent: verbraucht,
          einzelBetrag: budgets.some((x) => x.kategorieId === id && x.kontoId === kontoId && (x.ausnahmen ?? []).some((a) => a.monat === m)),
        } },
      };
      const z = zeilen.get(kontoId);
      if (z) {
        z.ausgaben += rest;
        z.posten.push(posten);
      }
      g.ausgaben += rest;
      g.posten.push(posten);
    }

    // Jahresbudgets (D90): Tranche bzw. Restbudget zum 31.12. – nicht einzeln änderbar (kein ref)
    for (const p of jahresPlan.get(m) ?? []) {
      const name = kat.get(p.kategorieId)?.name ?? '?';
      const posten = {
        datum: monatsende(`${m}-01`),
        text: `${p.art === 'rest' ? 'Restbudget' : 'Budget'} ${name} (Jahr)` + ((zaehler.get(p.kategorieId) ?? 0) + (jahrKonten.get(p.kategorieId)?.size ?? 0) > 1 ? ` (${kontoName.get(p.kontoId) ?? '?'})` : ''),
        wirkung: -p.restCent, quelle: 'budget',
      };
      const z = zeilen.get(p.kontoId);
      if (z) {
        z.ausgaben += p.restCent;
        z.posten.push(posten);
      }
      g.ausgaben += p.restCent;
      g.posten.push(posten);
    }

    for (const k of aktiveKonten) {
      const z = zeilen.get(k.id);
      z.stand = stand.get(k.id) + z.einnahmen - z.ausgaben + z.umbuchungen;
      stand.set(k.id, z.stand);
      jeKonto.get(k.id).push(z);
    }
    gesamtStand += g.einnahmen - g.ausgaben + g.umbuchungen;
    g.stand = gesamtStand;
    gesamt.push(g);
  }
  return { monate, jeKonto, gesamt, start };
}

/** Monatszeilen zu Jahren zusammenfassen: [{ jahr, einnahmen, ausgaben, umbuchungen, stand, monate }] */
export function jahresZeilen(zeilen) {
  const jahre = new Map();
  for (const z of zeilen) {
    const jahr = Number(z.monat.slice(0, 4));
    if (!jahre.has(jahr)) jahre.set(jahr, { jahr, einnahmen: 0, ausgaben: 0, umbuchungen: 0, stand: 0, monate: [] });
    const j = jahre.get(jahr);
    j.einnahmen += z.einnahmen;
    j.ausgaben += z.ausgaben;
    j.umbuchungen += z.umbuchungen;
    j.stand = z.stand;
    j.monate.push(z);
  }
  return [...jahre.values()];
}

/**
 * Mindestsaldo-Warnungen mit erstem betroffenem Monat.
 * Für Konten, die heute oder zum Monatsende schon darunter liegen, gilt die Warnung aus
 * monatsprognose; sonst wird der erste Zukunftsmonat gesucht, dessen Endstand darunter liegt.
 */
export function mindestsaldoWarnungen(zl) {
  const warnungen = [...zl.start.warnungen];
  const schon = new Set(warnungen.map((w) => w.konto.id));
  for (const [kontoId, zeilen] of zl.jeKonto) {
    if (schon.has(kontoId)) continue;
    const konto = zl.start.jeKonto.get(kontoId)?.konto;
    if (!konto || konto.mindestsaldoCent == null) continue;
    const erste = zeilen.find((z) => z.stand < konto.mindestsaldoCent);
    if (erste) warnungen.push({ konto, wann: 'zukunft', monat: erste.monat, standCent: erste.stand });
  }
  return warnungen;
}

/* ======================= Jahresbudgets (D90) ======================= */

/**
 * Erwartete Ausgaben je Konto, Hauptkategorie und Monat – Grundlage für Jahresbudgets.
 * Schlüssel: "kontoId|hauptId|JJJJ-MM". Ohne Projektausgaben (D52).
 * - alle echten Ausgaben (auch mit Zukunftsdatum)
 * - laufender Monat: offene wiederkehrende und geplante Ausgaben
 * - spätere Monate bis bisMonat: Termine wiederkehrender und offene geplante Ausgaben
 */
export function erwarteteAusgaben(daten, heute, bisMonat) {
  const { kategorien, buchungen, konten, geplant = [] } = daten;
  const wiederkehrende = daten.wiederkehrende ?? daten.wiederkehrend ?? [];
  const hauptVon = new Map(kategorien.map((k) => [k.id, k.elternId]));
  const stichtag = new Map(konten.map((k) => [k.id, k.stichtag]));
  const ergebnis = new Map();
  // x: Buchung, wiederkehrende oder geplante Buchung – inkl. Umbuchungen mit Budget (D98)
  const dazu = (x, datum, cent) => {
    const hId = budgetHauptVon(x, (id) => hauptVon.get(id));
    if (!hId) return;
    const kontoId = x.kontoId;
    const s = `${kontoId}|${hId}|${datum.slice(0, 7)}`;
    ergebnis.set(s, (ergebnis.get(s) ?? 0) + cent);
  };
  const monat = heute.slice(0, 7);
  const ende = monatsende(heute);
  const bis = monatsende(`${bisMonat}-01`);

  for (const b of buchungen) {
    if (istAktiv(b) && b.datum <= bis) dazu(b, b.datum, b.betragCent);
  }
  for (const t of offeneTermine({ ...daten, wiederkehrende, geplant }, heute, ende)) {
    if (t.datum < `${monat}-01`) continue;
    dazu(t.wiederkehrend, t.datum, t.betragCent);
  }
  const von = `${plusMonate(monat, 1)}-01`;
  if (von > bis) return ergebnis;
  for (const w of wiederkehrende) {
    if (!budgetHauptVon(w, (id) => hauptVon.get(id))) continue;
    for (const t of termine(w, von, bis)) {
      if (t.datum >= (stichtag.get(w.kontoId) ?? '')) dazu(w, t.datum, t.betragCent);
    }
  }
  const gebucht = new Set(buchungen.filter((b) => istAktiv(b) && b.geplantId).map((b) => b.geplantId));
  for (const g of geplant) {
    if (g.erledigtAm || gebucht.has(g.id) || g.datum < von || g.datum > bis) continue;
    dazu(g, g.datum, g.betragCent);
  }
  return ergebnis;
}

/**
 * Wirkung aller Jahresbudgets vom laufenden Monat bis bisMonat.
 * Ergebnis: Map("JJJJ-MM" → [{ kontoId, kategorieId, budget, monat, art, betragCent, verbrauchtCent, restCent, uebertragCent }])
 */
export function jahresbudgetPlan(daten, heute, bisMonat) {
  const plan = new Map();
  const jahresBudgets = (daten.budgets ?? []).filter(istJaehrlich);
  if (!jahresBudgets.length) return plan;
  const ausgaben = erwarteteAusgaben(daten, heute, bisMonat);
  const aktJahr = Number(heute.slice(0, 4));
  const aktMonat = Number(heute.slice(5, 7));
  const bisJahr = Number(bisMonat.slice(0, 4));
  for (const b of jahresBudgets) {
    const letztes = Math.min(bisJahr, b.endJahr ?? bisJahr);
    for (let jahr = Math.max(aktJahr, b.startJahr); jahr <= letztes; jahr++) {
      const ausgabe = (m) => ausgaben.get(`${b.kontoId}|${b.kategorieId}|${jahr}-${pad(m)}`) ?? 0;
      for (const p of jahresbudgetJahr(b, jahr, ausgabe, jahr === aktJahr ? aktMonat : 1)) {
        const monat = `${jahr}-${pad(p.monat)}`;
        if (monat > bisMonat) continue;
        if (!plan.has(monat)) plan.set(monat, []);
        plan.get(monat).push({ ...p, monat, budget: b, kontoId: b.kontoId, kategorieId: b.kategorieId });
      }
    }
  }
  return plan;
}
