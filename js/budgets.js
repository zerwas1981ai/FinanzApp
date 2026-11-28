// Budgets je Hauptkategorie und Konto, Jahresbudgets (D90) und Budget-Vorschlag (D208).
// Bis D258 Teil von prognose.js; prognose.js gibt alles von hier weiter (alte Importe gelten).
// Reine Funktionen ohne Datenbank – mit `npm test` geprüft.

import { istAktiv, zaehltCent } from './rechnen.js';
import { istJaehrlich, jahresbudgetJahr } from './jahresbudget.js';
import { pad, monatsende, plusMonate, betragAm, termine, offeneTermine } from './termine.js';

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

/**
 * D199: Echte Buchungen, die ein Budget verbrauchen (Konto + Hauptkategorie, Zeitraum von–bis), neueste zuerst.
 * Gleiche Regel wie beim Verbrauch: Ausgaben ohne Projekt auf Unterkategorien dieser Hauptkategorie,
 * abgehende Umbuchungen mit Budget-Zuordnung (D98); Papierkorb zählt nicht.
 */
export function budgetBuchungen(buchungen, kategorien, kontoId, hauptId, von, bis) {
  const kat = new Map(kategorien.map((k) => [k.id, k]));
  return buchungen
    .filter((b) => istAktiv(b) && b.kontoId === kontoId && b.datum >= von && b.datum <= bis && zaehltCent(b) > 0 // D214
      && budgetHauptVon(b, (id) => kat.get(id)?.elternId) === hauptId)
    .sort((a, b) => b.datum.localeCompare(a.datum) || (b.erstelltAm ?? '').localeCompare(a.erstelltAm ?? ''));
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
    if (istAktiv(b) && b.datum <= bis) dazu(b, b.datum, zaehltCent(b)); // D214
  }
  for (const t of offeneTermine({ ...daten, wiederkehrende, geplant }, heute, ende, { mitGekoppelten: true })) { // D227
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

/**
 * D208: Budget-Vorschlag beim Anlegen – Durchschnitt der Ausgaben dieser Hauptkategorie auf diesem Konto
 * in den letzten 3 bzw. 6 abgeschlossenen Monaten (gleiche Regel wie der Budgetverbrauch, ohne Projekte).
 * Monate vor der ersten Buchung dieser Kategorie zählen nicht mit. Ergebnis: { schnitt3, schnitt6, monate } (Cent) oder null.
 */
export function budgetVorschlag(buchungen, kategorien, kontoId, hauptId, heute) {
  const aktuell = heute.slice(0, 7);
  const kat = new Map(kategorien.map((k) => [k.id, k]));
  const relevant = buchungen.filter((b) => istAktiv(b) && b.kontoId === kontoId && budgetHauptVon(b, (id) => kat.get(id)?.elternId) === hauptId);
  if (!relevant.length) return null;
  const erster = relevant.map((b) => b.datum.slice(0, 7)).sort()[0];
  const summe = (monat) => relevant.filter((b) => b.datum.slice(0, 7) === monat).reduce((s, b) => s + zaehltCent(b), 0); // D214
  const schnitt = (n) => {
    const monate = [];
    for (let i = 1; i <= n; i++) {
      const m = plusMonate(aktuell, -i);
      if (m >= erster) monate.push(summe(m));
    }
    return monate.length ? { cent: Math.round(monate.reduce((s, x) => s + x, 0) / monate.length), anzahl: monate.length } : null;
  };
  const s3 = schnitt(3);
  const s6 = schnitt(6);
  if (!s3) return null;
  return { schnitt3: s3.cent, schnitt6: s6.cent, monate: s6.anzahl };
}
