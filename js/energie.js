// D233: Abschlagsrechner für Strom und Gas (Bereich „Energie“ unter Annahmen).
// Reine Funktionen ohne Datenbank – mit `npm test` geprüft.
//
// Datensatz in der Sammlung "zaehler" (Datenversion 26):
// { id, name, art: 'strom'|'gas', einheit: 'kwh'|'m3' (Strom immer kWh), zaehlernummer,
//   vertragId (null | Vertrag, über den die echten Abschläge gefunden werden),
//   abrechnungsEnde "MM-TT" (letzter Tag des Abrechnungsjahres, z. B. "03-31"),
//   preise: [{ ab "JJJJ-MM-TT", arbeitCt (ct je kWh, Kommazahl), grundCent (€ je Monat in Cent) }],
//   brennwert, zustandszahl (nur Gas in m³: kWh = m³ × Brennwert × Zustandszahl),
//   vorjahrKwh (null | Verbrauch laut letzter Abrechnung – Ersatz, solange Ablesungen fehlen),
//   gezahltManuell (null | { bis "JJJJ-MM-TT", cent } – Abschläge vor dem Start der App im laufenden Zeitraum),
//   geplantId (null | geplante Einmalbuchung für Nachzahlung/Guthaben), ablesungen: [{ datum, stand }],
//   aktiv, notiz, erstelltAm, geaendertAm, testdaten? }
//
// Rechenweg: Aus zwei Zählerständen ergibt sich der Verbrauch. Er wird auf das ganze Abrechnungsjahr
// hochgerechnet – Strom gleichmäßig je Tag, Gas nach der Gradtagszahlen-Verteilung (VDI 2067 / 3807),
// weil im Winter viel mehr geheizt wird. Kosten = kWh × Arbeitspreis + Grundpreis; Preise gelten ab Datum.

import { plusTage, tageBis } from './vertraege.js';
import { vertragsBuchungen } from './vertraege.js';
import { termine, erledigteTermine, tageImMonat } from './prognose.js';

/** Anteil am Jahresverbrauch je Monat in Promille (Januar … Dezember), Summe 1000 */
export const GAS_PROMILLE = [170, 150, 130, 80, 40, 40 / 3, 40 / 3, 40 / 3, 30, 80, 120, 160];
export const ART_TEXT = { strom: 'Strom', gas: 'Gas' };
/** Bis wie viele Tage nach dem Monatsletzten der Hinweis „Zählerstände erfassen“ erscheint */
export const HINWEIS_TAGE_DANACH = 5;

const pad = (n) => String(n).padStart(2, '0');
const jahrVon = (iso) => Number(iso.slice(0, 4));

/** Deutsche Kommazahl lesen („12.345,6“, „0,9563“, „32.45“); leer = null */
export function parseZahl(text, feldname) {
  const roh = String(text ?? '').trim().replace(/\s/g, '');
  if (!roh) return null;
  const norm = roh.includes(',') ? roh.replace(/\./g, '').replace(',', '.') : roh;
  if (!/^\d+(\.\d+)?$/.test(norm)) throw new Error(`${feldname}: bitte eine Zahl eingeben, z. B. 12345,6.`);
  return Number(norm);
}

/** Kommazahl deutsch anzeigen */
export const zahlText = (x, stellen = 0) => (x == null ? '' : x.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: stellen }));

/* ---------- Verteilung über das Jahr ---------- */

/** Gewicht eines Tages (Promille des Jahresverbrauchs) */
export function tagesGewicht(art, iso) {
  const j = jahrVon(iso);
  const m = Number(iso.slice(5, 7));
  if (art === 'gas') return GAS_PROMILLE[m - 1] / tageImMonat(j, m);
  return 1000 / 365;
}

/** Summe der Tagesgewichte von (von, bis] – also ohne den Tag „von“, mit dem Tag „bis“ */
export function gewicht(art, von, bis) {
  let summe = 0;
  for (let d = plusTage(von, 1); d <= bis; d = plusTage(d, 1)) summe += tagesGewicht(art, d);
  return summe;
}

/* ---------- Abrechnungszeitraum ---------- */

function endeImJahr(mmtt, jahr) {
  const m = Number(mmtt.slice(0, 2));
  const t = Math.min(Number(mmtt.slice(3, 5)), tageImMonat(jahr, m));
  return `${jahr}-${pad(m)}-${pad(t)}`;
}

/** Laufender Abrechnungszeitraum { start, ende } (beide einschließlich), in dem „heute“ liegt */
export function zeitraum(z, heute) {
  let ende = endeImJahr(z.abrechnungsEnde, jahrVon(heute));
  if (ende < heute) ende = endeImJahr(z.abrechnungsEnde, jahrVon(heute) + 1);
  return { start: plusTage(endeImJahr(z.abrechnungsEnde, jahrVon(ende) - 1), 1), ende };
}

/** Der Zeitraum danach (für den Abschlag im neuen Abrechnungsjahr) */
export function folgeZeitraum(zr) {
  return { start: plusTage(zr.ende, 1), ende: endeImJahr(zr.ende.slice(5), jahrVon(zr.ende) + 1) };
}

/* ---------- Verbrauch ---------- */

/** Umrechnung Zählereinheit → kWh */
export const faktor = (z) => (z.art === 'gas' && z.einheit === 'm3' ? (z.brennwert || 0) * (z.zustandszahl || 0) : 1);

const sortiert = (ablesungen) => [...(ablesungen ?? [])].sort((a, b) => a.datum.localeCompare(b.datum));

/**
 * Verbrauchsrate in kWh je Promille Jahresgewicht – Grundlage der Hochrechnung.
 * Aus Ablesungen: von der letzten Ablesung am/vor Beginn des Zeitraums (sonst der ersten danach) bis zur neuesten.
 * Ersatz: Vorjahresverbrauch. Ergebnis null, wenn beides fehlt.
 * { rate, quelle: 'ablesung'|'vorjahr', von, bis, kwh, tage, ungenau }
 */
export function verbrauch(z, zr, heute) {
  const liste = sortiert(z.ablesungen).filter((a) => a.datum <= heute);
  const vorher = liste.filter((a) => a.datum <= zr.start).at(-1);
  const r0 = vorher ?? liste.find((a) => a.datum > zr.start);
  const rN = liste.at(-1);
  const f = faktor(z);
  if (r0 && rN && rN.datum > r0.datum && rN.stand >= r0.stand && f > 0) {
    const kwh = (rN.stand - r0.stand) * f;
    const g = gewicht(z.art, r0.datum, rN.datum);
    const tage = tageBis(r0.datum, rN.datum);
    return { rate: kwh / g, quelle: 'ablesung', von: r0.datum, bis: rN.datum, kwh, tage, ungenau: tage < 60 };
  }
  if (z.vorjahrKwh > 0) return { rate: z.vorjahrKwh / 1000, quelle: 'vorjahr', kwh: z.vorjahrKwh, ungenau: false };
  return null;
}

/** Preis, der an einem Tag gilt (vor dem ersten „ab“: der erste) */
export function preisAm(preise, iso) {
  const liste = [...(preise ?? [])].sort((a, b) => a.ab.localeCompare(b.ab));
  let p = liste[0] ?? null;
  for (const x of liste) if (x.ab <= iso) p = x;
  return p;
}

/** Verbrauch und Kosten für (von, bis] bei einer Rate – Tag für Tag mit dem jeweils gültigen Preis */
export function kosten(z, rate, von, bis) {
  let kwh = 0;
  let cent = 0;
  for (let d = plusTage(von, 1); d <= bis; d = plusTage(d, 1)) {
    const p = preisAm(z.preise, d);
    const k = rate * tagesGewicht(z.art, d);
    kwh += k;
    if (p) cent += k * p.arbeitCt + p.grundCent / tageImMonat(jahrVon(d), Number(d.slice(5, 7)));
  }
  return { kwh, cent: Math.round(cent) };
}

/** Auf volle Euro aufrunden (Cent) */
const aufEuro = (cent) => Math.max(0, Math.ceil(cent / 100) * 100);

/** Die wiederkehrende Abschlag-Buchung des Zählers (über den Vertrag): erste eingeschaltete Ausgabe */
export function abschlagBuchung(z, wiederkehrend = []) {
  if (!z.vertragId) return null;
  return wiederkehrend.find((w) => w.vertragId === z.vertragId && w.art === 'ausgabe' && w.aktiv !== false) ?? null;
}

/**
 * Alles für die Anzeige eines Zählers im laufenden Abrechnungsjahr.
 * daten: { wiederkehrend, buchungen }. Ergebnis u. a.:
 * zr, v (Verbrauch), fehlt ('ablesung'|'preis'|null), jahresKwh, jahresCent, gezahltCent, gezahlt (Buchungen),
 * abschlag (wiederkehrende Buchung), offen (noch erwartete Termine), offenCent,
 * saldoCent (> 0 Nachzahlung, < 0 Guthaben, null ohne Abschlag-Buchung), vorschlagCent (bis zur Abrechnung),
 * folge { zr, kwh, cent, vorschlagCent } (neues Abrechnungsjahr, gleiche Rate, dann gültige Preise)
 */
export function abschlagsRechnung(z, daten, heute) {
  const zr = zeitraum(z, heute);
  const v = verbrauch(z, zr, heute);
  const abschlag = abschlagBuchung(z, daten.wiederkehrend);

  // Gezahlt: Ausgaben des Vertrags im Zeitraum (ohne Papierkorb, ohne Nachzahlung aus einer geplanten Buchung)
  const manuell = z.gezahltManuell && z.gezahltManuell.bis >= zr.start && z.gezahltManuell.bis <= zr.ende ? z.gezahltManuell : null;
  const gezahlt = z.vertragId
    ? vertragsBuchungen(z.vertragId, daten.buchungen ?? [], daten.wiederkehrend ?? [])
      .filter((b) => b.art === 'ausgabe' && !b.geplantId && b.datum >= zr.start && b.datum <= heute && !(manuell && b.datum <= manuell.bis))
    : [];
  const gezahltCent = gezahlt.reduce((s, b) => s + b.betragCent, 0) + (manuell?.cent ?? 0);

  // Noch erwartet: offene Termine der Abschlag-Buchung bis zum Ende des Zeitraums, nach der letzten Zahlung
  let offen = [];
  if (abschlag) {
    const erledigt = erledigteTermine(daten.buchungen ?? []);
    const letzte = [manuell?.bis, ...gezahlt.map((b) => b.datum)].filter(Boolean).sort().at(-1) ?? '';
    offen = termine(abschlag, zr.start, zr.ende).filter((t) => !erledigt.has(`${abschlag.id}|${t.termin}`) && t.datum > letzte);
  }
  const offenCent = offen.reduce((s, t) => s + t.betragCent, 0);

  const fehlt = !v ? 'ablesung' : !(z.preise ?? []).length ? 'preis' : null;
  const basis = { zr, v, abschlag, gezahlt, gezahltCent, offen, offenCent, fehlt, manuell };
  if (fehlt) return basis;

  const jahr = kosten(z, v.rate, plusTage(zr.start, -1), zr.ende);
  const fz = folgeZeitraum(zr);
  const folge = kosten(z, v.rate, plusTage(fz.start, -1), fz.ende);
  // Ohne Abschlag-Buchung: restliche Monate bis zum Ende zählen
  const restMonate = abschlag ? offen.length : Math.max(0, (jahrVon(zr.ende) - jahrVon(heute)) * 12 + Number(zr.ende.slice(5, 7)) - Number(heute.slice(5, 7)));
  return {
    ...basis,
    jahresKwh: jahr.kwh,
    jahresCent: jahr.cent,
    saldoCent: abschlag ? jahr.cent - gezahltCent - offenCent : null,
    restMonate,
    vorschlagCent: restMonate > 0 ? aufEuro((jahr.cent - gezahltCent) / restMonate) : null,
    folge: { zr: fz, kwh: folge.kwh, cent: folge.cent, vorschlagCent: aufEuro(folge.cent / 12) },
  };
}

/* ---------- Hinweis am Monatsletzten ---------- */

/**
 * Am Monatsletzten und bis HINWEIS_TAGE_DANACH Tage danach: Zähler ohne Ablesung seit 3 Tagen vor dem Monatsletzten.
 * weg: Monatsletzter, für den der Hinweis weggeklickt wurde. Ergebnis { stichtag, zaehler } oder null.
 */
export function ablesungsHinweis(zaehler, heute, weg = null) {
  const tag = Number(heute.slice(8, 10));
  const letzter = tageImMonat(jahrVon(heute), Number(heute.slice(5, 7)));
  let stichtag = null;
  if (tag === letzter) stichtag = heute;
  else if (tag <= HINWEIS_TAGE_DANACH) stichtag = plusTage(`${heute.slice(0, 8)}01`, -1);
  if (!stichtag || stichtag === weg) return null;
  const ab = plusTage(stichtag, -3);
  const offen = (zaehler ?? []).filter((z) => z.aktiv !== false && !(z.ablesungen ?? []).some((a) => a.datum >= ab));
  return offen.length ? { stichtag, zaehler: offen } : null;
}

/* ---------- Bauen und Ändern ---------- */

const MMTT = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * Zähler aus den Eingaben bauen (prüft alles). Zahlen kommen schon als Number (parseZahl) bzw. Cent.
 * eingabe: { name, art, einheit, zaehlernummer, vertragId, abrechnungsEnde, preise, brennwert, zustandszahl,
 *   vorjahrKwh, gezahltManuell, notiz, aktiv }
 */
export function baueZaehler(eingabe, { zaehler = [], alt = null, jetzt = new Date().toISOString() } = {}) {
  const name = (eingabe.name ?? '').trim();
  if (!name) throw new Error('Bitte einen Namen eingeben, z. B. „Strom Haus“.');
  if (zaehler.some((x) => x.id !== alt?.id && x.name.toLowerCase() === name.toLowerCase())) throw new Error(`Einen Zähler „${name}“ gibt es schon.`);
  if (!['strom', 'gas'].includes(eingabe.art)) throw new Error('Bitte Strom oder Gas wählen.');
  const einheit = eingabe.art === 'gas' && eingabe.einheit === 'm3' ? 'm3' : 'kwh';
  if (!MMTT.test(eingabe.abrechnungsEnde ?? '')) throw new Error('Bitte das Ende des Abrechnungsjahres wählen.');
  if (einheit === 'm3' && !(eingabe.brennwert > 0 && eingabe.zustandszahl > 0)) {
    throw new Error('Für Gas in m³ bitte Brennwert und Zustandszahl von der letzten Rechnung eintragen.');
  }
  const preise = [...(eingabe.preise ?? [])].sort((a, b) => a.ab.localeCompare(b.ab));
  for (const p of preise) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.ab ?? '')) throw new Error('Jeder Preis braucht ein „gilt ab“-Datum.');
    if (!(p.arbeitCt > 0)) throw new Error('Bitte den Arbeitspreis in ct je kWh eingeben, z. B. 32,5.');
    if (!(p.grundCent >= 0)) throw new Error('Bitte den Grundpreis je Monat eingeben (0 ist erlaubt).');
  }
  if (new Set(preise.map((p) => p.ab)).size !== preise.length) throw new Error('Zwei Preise haben dasselbe „gilt ab“-Datum.');
  const m = eingabe.gezahltManuell;
  if (m && (!/^\d{4}-\d{2}-\d{2}$/.test(m.bis ?? '') || !(m.cent >= 0))) throw new Error('Bitte bei „bisher gezahlt“ Betrag und Datum angeben.');
  return {
    id: alt?.id ?? crypto.randomUUID(),
    name,
    art: eingabe.art,
    einheit,
    zaehlernummer: (eingabe.zaehlernummer ?? '').trim(),
    vertragId: eingabe.vertragId || null,
    abrechnungsEnde: eingabe.abrechnungsEnde,
    preise,
    brennwert: einheit === 'm3' ? eingabe.brennwert : null,
    zustandszahl: einheit === 'm3' ? eingabe.zustandszahl : null,
    vorjahrKwh: eingabe.vorjahrKwh > 0 ? eingabe.vorjahrKwh : null,
    gezahltManuell: m && m.cent > 0 ? { bis: m.bis, cent: m.cent } : null,
    geplantId: alt?.geplantId ?? null,
    ablesungen: alt?.ablesungen ?? [],
    aktiv: eingabe.aktiv ?? alt?.aktiv ?? true,
    notiz: (eingabe.notiz ?? '').trim(),
    erstelltAm: alt?.erstelltAm ?? jetzt,
    geaendertAm: jetzt,
    ...(alt?.testdaten ? { testdaten: true } : {}),
  };
}

/** Ablesung ergänzen oder (gleiches Datum) ersetzen; Zählerstände dürfen nicht rückwärts laufen */
export function mitAblesung(z, { datum, stand }, jetzt = new Date().toISOString()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum ?? '')) throw new Error('Bitte ein gültiges Datum wählen.');
  if (stand == null || !(stand >= 0)) throw new Error('Bitte den Zählerstand eingeben.');
  const andere = sortiert(z.ablesungen).filter((a) => a.datum !== datum);
  const davor = andere.filter((a) => a.datum < datum).at(-1);
  const danach = andere.find((a) => a.datum > datum);
  const einheit = z.einheit === 'm3' ? 'm³' : 'kWh';
  if (davor && stand < davor.stand) throw new Error(`Der Stand ist kleiner als am ${davor.datum.split('-').reverse().join('.')} (${zahlText(davor.stand, 3)} ${einheit}). Zähler laufen nur vorwärts.`);
  if (danach && stand > danach.stand) throw new Error(`Der Stand ist größer als am ${danach.datum.split('-').reverse().join('.')} (${zahlText(danach.stand, 3)} ${einheit}).`);
  return { ...z, ablesungen: sortiert([...andere, { datum, stand }]), geaendertAm: jetzt };
}

/** Ablesung entfernen */
export const ohneAblesung = (z, datum, jetzt = new Date().toISOString()) =>
  ({ ...z, ablesungen: (z.ablesungen ?? []).filter((a) => a.datum !== datum), geaendertAm: jetzt });

/** Verbrauch zwischen aufeinanderfolgenden Ablesungen (neueste zuerst): [{ von, bis, tage, kwh, kwhJeTag }] */
export function ablesungsVerlauf(z) {
  const liste = sortiert(z.ablesungen);
  const f = faktor(z);
  const ergebnis = [];
  for (let i = 1; i < liste.length; i++) {
    const tage = tageBis(liste[i - 1].datum, liste[i].datum);
    const kwh = (liste[i].stand - liste[i - 1].stand) * f;
    ergebnis.push({ von: liste[i - 1].datum, bis: liste[i].datum, tage, kwh, kwhJeTag: tage > 0 ? kwh / tage : null });
  }
  return ergebnis.reverse();
}

/** Neuer Abschlag ab einem Termin: Stufe der wiederkehrenden Buchung ergänzen bzw. ersetzen */
export function mitNeuemAbschlag(w, ab, betragCent, jetzt = new Date().toISOString()) {
  if (!(betragCent > 0)) throw new Error('Der Abschlag muss größer 0 sein.');
  if (ab < w.start) throw new Error('Das Datum liegt vor dem Start der wiederkehrenden Buchung.');
  const stufen = [...(w.stufen ?? []).filter((s) => s.ab !== ab), { ab, betragCent }].sort((a, b) => a.ab.localeCompare(b.ab));
  return { ...w, stufen, geaendertAm: jetzt };
}
