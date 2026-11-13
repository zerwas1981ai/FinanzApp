// Deutsche Formate für Geld und Datum.
// Geld wird intern IMMER in Cent als ganze Zahl gespeichert (1.234,56 € = 123456),
// damit keine Rundungsfehler entstehen. Datum intern als "JJJJ-MM-TT".

const euroFormat = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const zahlFormat = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const MAX_CENT = 99_999_999_999; // 999.999.999,99 €

/** 123456 → "1.234,56 €" */
export function formatEuro(cent) {
  return euroFormat.format((cent || 0) / 100); // "|| 0" verhindert "-0,00 €"
}

const euroRundFormat = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

/** 123456 → "1.235 €" (für Diagrammachsen) */
export function formatEuroRund(cent) {
  return euroRundFormat.format(cent / 100);
}

/** 0.2345 → "23 %" */
export function formatProzent(anteil) {
  return `${Math.round(anteil * 100)} %`;
}

/** 123456 → "1.234,56" (für Eingabefelder) */
export function centZuEingabe(cent) {
  return zahlFormat.format(cent / 100);
}

/**
 * Liest einen Betrag, wie man ihn in Deutschland tippt, und gibt Cent zurück.
 * Leeres Feld → null. Ungültig → Fehler mit verständlicher Meldung.
 * Erlaubt: "1234,56"  "1.234,56"  "-50"  "12,5"  "1234.56"  "1.234"  "100 €"
 */
export function parseEuro(eingabe, feldname = 'Betrag') {
  let s = String(eingabe ?? '').replace(/[\s  €]/g, '');
  if (s === '') return null;

  let negativ = false;
  if (s.startsWith('-') || s.startsWith('−')) { negativ = true; s = s.slice(1); }
  else if (s.startsWith('+')) { s = s.slice(1); }

  let euro;
  let cent = '';
  if (s.includes(',')) {
    // Komma = Dezimaltrenner, Punkte = Tausender
    const m = /^(\d{1,3}(?:\.\d{3})+|\d+),(\d{0,2})$/.exec(s);
    if (!m) throw fehler(feldname);
    euro = m[1].replace(/\./g, '');
    cent = m[2];
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(s)) {
    // "1.234" oder "1.234.567" = Tausenderpunkte
    euro = s.replace(/\./g, '');
  } else {
    // "1234" oder "12.5" / "12.50" (Punkt als Dezimaltrenner)
    const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
    if (!m) throw fehler(feldname);
    euro = m[1];
    cent = m[2] ?? '';
  }

  const wert = Number(euro) * 100 + Number(cent.padEnd(2, '0'));
  if (!Number.isSafeInteger(wert) || wert > MAX_CENT) throw fehler(feldname);
  return negativ && wert !== 0 ? -wert : wert;
}

function fehler(feldname) {
  return new Error(`${feldname}: Bitte einen gültigen Betrag eingeben, z. B. 1.234,56`);
}

/** "2026-03-01" → "01.03.2026" */
export function formatDatum(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '–';
}

/** Heutiges Datum (lokale Zeit) als "JJJJ-MM-TT" */
export function heuteIso(jetzt = new Date()) {
  const j = jetzt.getFullYear();
  const m = String(jetzt.getMonth() + 1).padStart(2, '0');
  const t = String(jetzt.getDate()).padStart(2, '0');
  return `${j}-${m}-${t}`;
}

const pad = (n) => String(n).padStart(2, '0');

/** (2026, 3) → "2026-03-01" */
export function isoMonatsanfang(jahr, monat) {
  return `${jahr}-${pad(monat)}-01`;
}

/** (2026, 12) → [2027, 1] */
export function naechsterMonat(jahr, monat) {
  return monat === 12 ? [jahr + 1, 1] : [jahr, monat + 1];
}

/** (2026, 1) → [2025, 12] */
export function vorigerMonat(jahr, monat) {
  return monat === 1 ? [jahr - 1, 12] : [jahr, monat - 1];
}

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const WOCHENTAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/** (2026, 11) → "November 2026" */
export function formatMonat(jahr, monat) {
  return `${MONATE[monat - 1]} ${jahr}`;
}

/** "2026-11-05" → "Do, 05.11." */
export function formatTag(iso) {
  const [j, m, t] = iso.split('-').map(Number);
  return `${WOCHENTAGE[new Date(j, m - 1, t).getDay()]}, ${pad(t)}.${pad(m)}.`;
}

/** Prüft, ob ein "JJJJ-MM-TT"-Text ein echtes Datum ist */
export function istGueltigesDatum(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
}

/**
 * D175: Rechnen im Betragsfeld – „12,50+3,20“, „89,90-10“, „3*2,49“. Punkt vor Strich, keine Klammern.
 * Liefert das Ergebnis in Cent oder null, wenn der Text keine Rechnung ist (dann gilt parseEuro wie bisher).
 * Wirft bei einer unverständlichen Rechnung denselben Fehler wie parseEuro.
 */
export function rechneBetrag(eingabe, feldname = 'Betrag') {
  const text = String(eingabe ?? '').replace(/[\s\u00a0\u202f€]/g, '').replace(/−/g, '-').replace(/[x×]/gi, '*');
  if (!/[+\-*]/.test(text.slice(1))) return null; // kein Rechenzeichen (ein Vorzeichen ganz vorn zählt nicht)
  // Summanden an + und − trennen (Vorzeichen bleibt am Summanden)
  const summanden = text.match(/[+-]?[^+-]+/g);
  if (!summanden || summanden.join('') !== text) throw new Error(`${feldname}: Die Rechnung „${eingabe}“ ist nicht zu verstehen.`);
  let summe = 0;
  for (const teil of summanden) {
    const negativ = teil.startsWith('-');
    const faktoren = teil.replace(/^[+-]/, '').split('*');
    if (faktoren.some((f) => f === '')) throw new Error(`${feldname}: Die Rechnung „${eingabe}“ ist nicht zu verstehen.`);
    // erster Faktor in Cent, weitere Faktoren als Zahl (z. B. 3 × 2,49)
    let cent = parseEuro(faktoren[0], feldname);
    for (const f of faktoren.slice(1)) cent = Math.round(cent * (parseEuro(f, feldname) / 100));
    summe += negativ ? -cent : cent;
  }
  return summe;
}
