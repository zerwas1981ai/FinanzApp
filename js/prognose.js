// Monatsprognose, Budgethinweise und Zeitleiste bis 2050.
// Reine Funktionen ohne Datenbank – mit `npm test` geprüft. Siehe DECISIONS.md D33–D40.
// D258: Termine/Datums-Helfer stehen in termine.js, Budgets in budgets.js.

import { istAktiv, kontostand, buchungenVonKonto, wirkungCent, zaehltCent } from './rechnen.js';
import { istJaehrlich } from './jahresbudget.js';
import { nurWirksam, annahmeTitel, monatsende, plusMonate, plusTage, termine, terminWirkung, offeneTermine } from './termine.js';
import { budgetFuerMonat, budgetHauptVon, budgetSchluessel, budgetPaare, jahresbudgetPlan } from './budgets.js';

// Weitergabe, damit bestehende Importe aus prognose.js unverändert funktionieren (D258)
export * from './termine.js';
export * from './budgets.js';

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
    summe.set(s, (summe.get(s) ?? 0) + zaehltCent(b)); // D214: offene Auslagen verbrauchen kein Budget
  }
  return summe;
}

/**
 * Prognose für den laufenden Monat (Regeln aus CLAUDE.md, Entscheidungen D35, D85):
 * - Je Konto und Hauptkategorie mit Budget: Prognose = das Höhere aus Budget und
 *   (Ist + offene wiederkehrende Ausgaben – beides nur auf diesem Konto). Ohne Budget: Ist + offene.
 *   Also: echte Buchungen + offener Budgetrest, mindestens aber die echten Buchungen.
 * - Je Konto: Stand am Monatsende aus echten Buchungen
 *   + Wirkung offener wiederkehrender Termine (inkl. überfälliger aus dem Vormonat)
 *   − offener Budgetrest der Budgets, die dieses Konto belasten.
 * - Je Konto (D247, ersetzt D110/D111): niedrigster erwarteter Stand = niedrigster Tagesstand von heute bis
 *   Monatsende, Tag für Tag fortgeschrieben (`niedrigsterVerlauf`): alle noch erwarteten Bewegungen samt Einnahmen
 *   an ihrem Datum (überfällige Termine heute), der offene Budgetrest gleichmäßig auf die verbleibenden Tage verteilt.
 */

/**
 * D247: Niedrigster Tagesstand eines Zeitraums. Ab `start` (Stand vor dem ersten Tag) werden Tag für Tag die
 * Bewegungen dieses Tages ([{ datum, wirkung }], frühere Daten zählen am ersten Tag) und ein gleicher Anteil von
 * `budgetCent` (Budgetrest, wird abgezogen; Cent-Rest auf die ersten Tage) gebucht. Ergebnis: niedrigster Stand
 * am Ende eines Tages von `von` bis `bis`.
 */
export function niedrigsterVerlauf(start, bewegungen, budgetCent, von, bis) {
  return tagesVerlauf(start, bewegungen, budgetCent, von, bis).niedrigster;
}

/**
 * D247/D248: wie niedrigsterVerlauf, dazu der erste Tag, an dem der Stand unter `mindestCent` fällt.
 * D250: Alle Bewegungen eines Tages zählen zusammen (Stand am Tagesende) – Eingänge am selben Tag gleichen
 * Belastungen sofort aus (z. B. Verrechnungskonto: Eingang und Weiterleitung am selben Tag; ersetzt D249).
 * Ergebnis: { niedrigster, unterAb: "JJJJ-MM-TT" | null, tage: [{ datum, stand }] } (tage: Stand am Ende jedes Tages, D251)
 */
export function tagesVerlauf(start, bewegungen, budgetCent, von, bis, mindestCent = null) {
  const jeTag = new Map();
  for (const x of bewegungen) {
    const tag = x.datum < von ? von : x.datum;
    if (tag > bis) continue;
    jeTag.set(tag, (jeTag.get(tag) ?? 0) + x.wirkung);
  }
  const tage = [];
  for (let t = von; t <= bis; t = plusTage(t, 1)) tage.push(t);
  const anteil = Math.floor(budgetCent / tage.length);
  let uebrig = budgetCent - anteil * tage.length;
  let stand = start;
  let niedrigster = Infinity;
  let unterAb = null;
  const staende = [];
  for (const t of tage) {
    stand += (jeTag.get(t) ?? 0) - anteil - (uebrig > 0 ? 1 : 0);
    if (uebrig > 0) uebrig -= 1;
    niedrigster = Math.min(niedrigster, stand);
    if (unterAb === null && mindestCent != null && stand < mindestCent) unterAb = t;
    staende.push({ datum: t, stand });
  }
  return { niedrigster: tage.length ? niedrigster : start, unterAb, tage: staende };
}

/**
 * D198: Wie viel des Budget-Zeitraums ist heute schon vorbei? Zählt den heutigen Tag mit
 * (15.11. von 30 Tagen = 0,5). von/bis: "JJJJ-MM-TT". Ergebnis 0..1.
 */
export function zeitAnteil(von, bis, heute) {
  const tag = (iso) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86400000;
  const gesamt = tag(bis) - tag(von) + 1;
  if (gesamt <= 0) return 1;
  return Math.min(1, Math.max(0, (tag(heute) - tag(von) + 1) / gesamt));
}

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
    if (b.art === 'einnahme') einnahmen += zaehltCent(b); // D214
    else if (b.art === 'ausgabe') ausgaben += zaehltCent(b);
  }

  const istJe = ausgabenJeKontoUndKategorie(buchungen, kategorien, monat);
  const offen = offeneTermine(daten, heute, ende, { mitGekoppelten: true }); // D227
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
      zeit: zeitAnteil(`${monat}-01`, monatsende(monat), heute), // D198
      zeitraum: { von: `${monat}-01`, bis: monatsende(monat) }, // D199: für die Buchungsliste
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
      // D198: Zeitstrich über den ganzen Abschnitt der Tranche (z. B. Jan.–Jun. bei hälftig)
      zeit: zeitAnteil(`${monat.slice(0, 4)}-${String(p.vonMonat ?? Number(monat.slice(5, 7))).padStart(2, '0')}-01`, monatsende(monat), heute),
      zeitraum: { von: `${monat.slice(0, 4)}-${String(p.vonMonat ?? Number(monat.slice(5, 7))).padStart(2, '0')}-01`, bis: monatsende(monat) }, // D199
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
    // D247: Tag für Tag bis Monatsende – erfasste spätere Buchungen und offene Termine (mit Einnahmen) an ihrem Datum,
    // überfällige Termine heute, Budgetrest gleichmäßig auf die verbleibenden Tage (heute eingeschlossen)
    const spaetere = buchungenVonKonto(k, buchungen)
      .filter((b) => b.datum > heute && b.datum <= ende)
      .map((b) => ({ datum: b.datum, wirkung: wirkungCent(b) }));
    jeKonto.set(k.id, {
      konto: k,
      heute: standHeute,
      endeEcht, // Stand Monatsende nur aus echten Buchungen
      offenWirkung, // Summe offener wiederkehrender Termine (+/−)
      offenEinnahmen, // davon Eingänge (≥ 0)
      offenAusgaben, // davon Belastungen (≤ 0)
      rest, // offener Budgetrest, der dieses Konto belastet
      ...tagesVerlauf(standHeute, [...spaetere, ...termineKonto], rest, heute, ende, k.mindestsaldoCent), // D247: niedrigster, unterAb (D248)
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
  for (const { konto, heute: h, niedrigster, unterAb } of jeKonto.values()) {
    if (konto.mindestsaldoCent == null) continue;
    if (h < konto.mindestsaldoCent) warnungen.push({ konto, wann: 'heute', standCent: h });
    else if (niedrigster < konto.mindestsaldoCent) warnungen.push({ konto, wann: 'monatsende', standCent: niedrigster, unterAb }); // D248
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
      hauptId: hauptVon(b.kategorieId), unterId: b.kategorieId ?? null, text: [b.partner, b.notiz || kat.get(b.kategorieId)?.name || 'Umbuchung'].filter(Boolean).join(' · '), quelle: 'gebucht',
      projektId: b.projektId ?? null, budgetKategorieId: b.budgetKategorieId ?? null,
      budgetCent: zaehltCent(b), // D214: offene Auslage verbraucht kein Budget
    });
  }
  for (const w of wiederkehrende) {
    for (const t of termine(w, von, bis)) {
      if (t.datum < (stichtag.get(w.kontoId) ?? '')) continue;
      merke({
        art: w.art, kontoId: w.kontoId, gegenkontoId: w.gegenkontoId, betragCent: t.betragCent, datum: t.datum,
        hauptId: hauptVon(w.kategorieId), unterId: w.kategorieId ?? null, text: annahmeTitel(w, kategorien), quelle: 'wiederkehrend', budgetKategorieId: w.budgetKategorieId ?? null,
        // D227: gekoppelte Umbuchung → Änderungen gelten für ihre Ausgabe
        ref: { wiederkehrend: w.gekoppelt ?? w, termin: t.termin, einzelBetrag: t.einzelBetrag, verschoben: t.verschoben },
      });
    }
  }
  const gebucht = new Set(buchungen.filter((b) => istAktiv(b) && b.geplantId).map((b) => b.geplantId));
  for (const g of geplant) {
    if (g.erledigtAm || gebucht.has(g.id) || g.datum < von || g.datum > bis) continue;
    merke({
      art: g.art, kontoId: g.kontoId, gegenkontoId: g.gegenkontoId, betragCent: g.betragCent, datum: g.datum,
      hauptId: hauptVon(g.kategorieId), unterId: g.kategorieId ?? null, text: g.bezeichnung, quelle: 'geplant', budgetKategorieId: g.budgetKategorieId ?? null,
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
      const posten = { datum: x.datum, text: x.text, wirkung, quelle: x.quelle, ref: x.ref, hauptId: x.hauptId, unterId: x.unterId };
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
        istJe.set(s, (istJe.get(s) ?? 0) + (x.budgetCent ?? x.betragCent));
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
        datum: monatsende(`${m}-01`), text, wirkung: -rest, quelle: 'budget', hauptId: id,
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
        wirkung: -p.restCent, quelle: 'budget', hauptId: p.kategorieId,
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

/**
 * D247: Tagesverlauf eines Zukunftsmonats (Zeile i der Zeitleiste eines Kontos). Start = Stand am Ende des Vormonats
 * (für den ersten Zukunftsmonat die Prognose zum Ende des laufenden Monats); Budgetposten werden auf alle Tage verteilt.
 */
export function zukunftsVerlauf(zlKonto, i, startStand, mindestCent = null) {
  const z = zlKonto[i];
  const anfang = i > 0 ? zlKonto[i - 1].stand : startStand;
  const budget = z.posten.filter((p) => p.quelle === 'budget').reduce((s, p) => s - p.wirkung, 0);
  const bewegungen = z.posten.filter((p) => p.quelle !== 'budget');
  return tagesVerlauf(anfang, bewegungen, budget, `${z.monat}-01`, monatsende(`${z.monat}-01`), mindestCent);
}

/**
 * D253: Verlauf mehrerer Konten zusammengezählt (Übersicht „Alle Konten“). Alle Verläufe stammen aus kopfWerte für
 * denselben Monat und haben dieselben Tage; prognose gilt ab dem ersten Tag, an dem ein Konto erwartete Werte hat.
 */
export function gesamtVerlauf(verlaeufe) {
  const liste = verlaeufe.filter((v) => v?.length);
  if (!liste.length) return [];
  return liste[0].map((x, i) => ({
    datum: x.datum,
    stand: liste.reduce((s, v) => s + (v[i]?.stand ?? 0), 0),
    prognose: liste.some((v) => v[i]?.prognose),
  }));
}

/**
 * D246: Werte im Kontokopf für den gewählten Monat ("JJJJ-MM").
 * - laufender Monat: Prognose Monatsende und niedrigster erwarteter Stand aus der Monatsprognose (D110/D111)
 * - Zukunftsmonat: Stand Monatsende aus der Zeitleiste; niedrigster erwarteter Stand Tag für Tag ab dem Stand am
 *   Monatsanfang: alle Posten an ihrem Datum, Budgetreste gleichmäßig auf alle Tage des Monats verteilt (D247)
 * - vergangener Monat: echter Stand am Monatsende und niedrigster echter Tagesstand im Monat
 * Ergebnis: { art: 'aktuell'|'zukunft'|'vergangen', prognose, niedrigster, unterAb, verlauf } (Cent; undefined = nichts
 *   anzeigen; unterAb = erster Tag mit Stand unter dem Mindestsaldo oder null, D248;
 *   verlauf (D251) = [{ datum, stand, prognose }] – Stand am Ende des Vortags des Monatsersten, dann je Tag; prognose =
 *   erwarteter statt echter Stand – für die Verlaufsgrafik im Kontokopf)
 */
export function kopfWerte({ konto, buchungen, kd, zlKonto = [] }, monat, heute) {
  const aktuell = heute.slice(0, 7);
  const erster = `${monat}-01`;
  const echt = (datum) => ({ datum, stand: kontostand(konto, buchungen, datum), prognose: false });
  if (monat === aktuell) {
    // bis gestern echte Tagesstände, ab heute der erwartete Verlauf (D247)
    const verlauf = [];
    for (let t = plusTage(erster, -1); t < heute; t = plusTage(t, 1)) verlauf.push(echt(t));
    for (const x of kd?.tage ?? []) verlauf.push({ ...x, prognose: true });
    return { art: 'aktuell', prognose: kd?.prognose, niedrigster: kd?.niedrigster, unterAb: kd?.unterAb ?? null, verlauf };
  }
  if (monat > aktuell) {
    const i = zlKonto.findIndex((z) => z.monat === monat);
    if (i < 0) return { art: 'zukunft', prognose: undefined, niedrigster: undefined, unterAb: null, verlauf: [] };
    const anfang = i > 0 ? zlKonto[i - 1].stand : (kd?.prognose ?? 0);
    const { tage, ...v } = zukunftsVerlauf(zlKonto, i, kd?.prognose ?? 0, konto.mindestsaldoCent);
    const verlauf = [{ datum: plusTage(erster, -1), stand: anfang, prognose: true }, ...tage.map((x) => ({ ...x, prognose: true }))];
    return { art: 'zukunft', prognose: zlKonto[i].stand, ...v, verlauf };
  }
  const ende = monatsende(`${monat}-01`);
  const tage = new Set([plusTage(`${monat}-01`, -1)]);
  for (const b of buchungenVonKonto(konto, buchungen)) if (b.datum.slice(0, 7) === monat) tage.add(b.datum);
  // Tagesstand am Monatsanfang (= Ende des Vortags) und nach jedem Buchungstag
  const staende = [...tage].sort().map((t) => [t, kontostand(konto, buchungen, t)]);
  const niedrigster = Math.min(...staende.map(([, s]) => s));
  // D248: erster Tag im Monat mit Stand unter dem Mindestsaldo (schon am Monatsanfang darunter → der 1.)
  const unter = konto.mindestsaldoCent == null ? null : staende.find(([, s]) => s < konto.mindestsaldoCent)?.[0] ?? null;
  const verlauf = [];
  for (let t = plusTage(erster, -1); t <= ende; t = plusTage(t, 1)) verlauf.push(echt(t));
  return { art: 'vergangen', prognose: kontostand(konto, buchungen, ende), niedrigster, unterAb: unter && unter < `${monat}-01` ? `${monat}-01` : unter, verlauf };
}

/**
 * Prognose zum Jahresende über alle Konten (D116): Stand Ende Dezember des laufenden Jahres aus der
 * Zeitleiste. Im Dezember selbst ist das die Prognose zum Monatsende.
 */
export function prognoseJahresende(zl, heute, kontoId = null) {
  // kontoId (D118): nur dieses Konto, sonst alle Konten
  if (heute.slice(5, 7) === '12') return kontoId ? zl.start.jeKonto.get(kontoId)?.prognose ?? null : zl.start.gesamtPrognose;
  const zeilen = kontoId ? zl.jeKonto.get(kontoId) ?? [] : zl.gesamt;
  return zeilen.find((g) => g.monat === `${heute.slice(0, 4)}-12`)?.stand ?? null;
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
 * Mindestsaldo-Warnungen mit erstem betroffenem Tag.
 * Für Konten, die heute oder bis Monatsende schon darunter liegen, gilt die Warnung aus
 * monatsprognose; sonst wird der erste Zukunftsmonat gesucht, in dem der Tagesverlauf (D247) darunter fällt –
 * mit diesem Tag (unterAb, D249) und dem niedrigsten erwarteten Stand des Monats.
 */
export function mindestsaldoWarnungen(zl) {
  const warnungen = [...zl.start.warnungen];
  const schon = new Set(warnungen.map((w) => w.konto.id));
  for (const [kontoId, zeilen] of zl.jeKonto) {
    if (schon.has(kontoId)) continue;
    const konto = zl.start.jeKonto.get(kontoId)?.konto;
    if (!konto || konto.mindestsaldoCent == null) continue;
    const startStand = zl.start.jeKonto.get(kontoId)?.prognose ?? 0;
    for (let i = 0; i < zeilen.length; i++) {
      const v = zukunftsVerlauf(zeilen, i, startStand, konto.mindestsaldoCent);
      if (!v.unterAb) continue;
      warnungen.push({ konto, wann: 'zukunft', monat: zeilen[i].monat, unterAb: v.unterAb, standCent: v.niedrigster });
      break;
    }
  }
  return warnungen;
}
