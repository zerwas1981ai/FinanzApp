// D148: Verträge – eine „Klammer“ um mehrere Zahlungen (Handy, Internet, Strom, Versicherungen, Abos …).
// Reine Funktionen – mit `npm test` geprüft.
//
// Datensatz Vertrag (Datenversion 18), Sammlung "vertraege":
// { id, name, anbieter (= Empfänger wie bei Buchungen, Pflicht ab D150), vertragsnummer, beginn "JJJJ-MM-TT"|null,
//   mindestlaufzeitMonate (Zahl|null; null/0 = keine Mindestlaufzeit, jederzeit kündbar),
//   verlaengerungMonate (Zahl|null; 0/null = verlängert sich nicht, endet nach der Mindestlaufzeit),
//   fristAnzahl (Zahl|null), fristEinheit: 'tage'|'wochen'|'monate',
//   erinnerungTage (Vorlauf der Erinnerung, Standard 28),
//   gekuendigtZum "JJJJ-MM-TT"|null, erinnerungAusBis "JJJJ-MM-TT"|null („Behalten“ bis zu diesem Kündigungstag),
//   notiz, belege (Vertragsunterlagen, wie Belege), erstelltAm, geaendertAm, testdaten? }
//
// Zuordnung: Buchungen und wiederkehrende Buchungen haben ein optionales Feld vertragId.
// Eine Buchung aus einer wiederkehrenden Buchung gehört automatisch zu deren Vertrag (rückwirkend),
// außer sie ist selbst einem anderen Vertrag zugeordnet.

export const STANDARD_ERINNERUNG_TAGE = 28;
export const FRIST_EINHEITEN = { tage: 'Tage', wochen: 'Wochen', monate: 'Monate' };
const INTERVALL_JE_JAHR = { monatlich: 12, vierteljaehrlich: 4, jaehrlich: 1 };

/* ---------- Datumsrechnung (ISO "JJJJ-MM-TT", ohne Zeitzonen) ---------- */

const zuUtc = (iso) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const ausUtc = (ms) => new Date(ms).toISOString().slice(0, 10);

export const plusTage = (iso, n) => ausUtc(zuUtc(iso) + n * 86400000);
export const tageBis = (von, bis) => Math.round((zuUtc(bis) - zuUtc(von)) / 86400000);

/** Monate addieren; zu große Tage werden auf den Monatsletzten gekürzt (31.01. + 1 Monat = 28./29.02.) */
export function plusMonate(iso, n) {
  const j = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7)) - 1 + n;
  const zielJahr = j + Math.floor(m / 12);
  const zielMonat = ((m % 12) + 12) % 12;
  const letzter = new Date(Date.UTC(zielJahr, zielMonat + 1, 0)).getUTCDate();
  const tag = Math.min(Number(iso.slice(8, 10)), letzter);
  return `${zielJahr}-${String(zielMonat + 1).padStart(2, '0')}-${String(tag).padStart(2, '0')}`;
}

/** Letzter Vertragstag nach `monate` Monaten ab Beginn (Beginn 01.03.2025, 24 Monate → 28.02.2027) */
export const laufzeitEnde = (beginn, monate) => plusTage(plusMonate(beginn, monate), -1);

/** Letzter Tag, an dem die Kündigung beim Empfänger (Vertragspartner) sein muss */
export function kuendigungsTag(ende, anzahl, einheit) {
  if (!anzahl) return ende;
  if (einheit === 'monate') return plusMonate(ende, -anzahl);
  return plusTage(ende, -(einheit === 'wochen' ? 7 * anzahl : anzahl));
}

const EINZAHL = { tage: 'Tag', wochen: 'Woche', monate: 'Monat' };
export const fristText = (v) => (v.fristAnzahl
  ? `${v.fristAnzahl} ${v.fristAnzahl === 1 ? EINZAHL[v.fristEinheit] : FRIST_EINHEITEN[v.fristEinheit]}`
  : 'ohne Frist');

/* ---------- Prüfen und bauen ---------- */

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const ganzeZahl = (wert, feld, { min = 0, max = 600 } = {}) => {
  if (wert === '' || wert == null) return null;
  const n = Number(String(wert).trim());
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${feld}: bitte eine ganze Zahl von ${min} bis ${max}.`);
  return n;
};
const datumOderNull = (wert, feld) => {
  if (!wert) return null;
  if (!ISO.test(wert) || Number.isNaN(zuUtc(wert))) throw new Error(`${feld}: bitte ein gültiges Datum.`);
  return wert;
};

export function baueVertrag(eingabe, { vertraege = [], alt = null, jetzt = new Date().toISOString() } = {}) {
  const name = String(eingabe.name ?? '').trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('Bitte einen Namen eingeben, z. B. „Handy“ oder „Kfz-Versicherung“.');
  if (name.length > 60) throw new Error('Der Name ist zu lang (höchstens 60 Zeichen).');
  const gleich = vertraege.find((v) => v.id !== alt?.id && v.name.toLocaleLowerCase('de') === name.toLocaleLowerCase('de'));
  if (gleich) throw new Error(`Einen Vertrag „${gleich.name}“ gibt es schon.`);
  // D150: Empfänger (an wen gezahlt wird) ist Pflicht – gleicher Begriff wie bei Buchungen
  const anbieter = String(eingabe.anbieter ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (!anbieter) throw new Error('Bitte den Empfänger eingeben, z. B. „Telefon AG“.');

  const beginn = datumOderNull(eingabe.beginn, 'Beginn');
  const mindestlaufzeitMonate = ganzeZahl(eingabe.mindestlaufzeitMonate, 'Mindestlaufzeit');
  const verlaengerungMonate = ganzeZahl(eingabe.verlaengerungMonate, 'Verlängerung');
  const fristAnzahl = ganzeZahl(eingabe.fristAnzahl, 'Kündigungsfrist', { max: 365 });
  const fristEinheit = FRIST_EINHEITEN[eingabe.fristEinheit] ? eingabe.fristEinheit : 'monate';
  const erinnerungTage = ganzeZahl(eingabe.erinnerungTage, 'Erinnerung', { max: 365 }) ?? STANDARD_ERINNERUNG_TAGE;
  const gekuendigtZum = datumOderNull(eingabe.gekuendigtZum, 'Gekündigt zum');
  if (mindestlaufzeitMonate && !beginn) throw new Error('Für die Mindestlaufzeit bitte auch den Vertragsbeginn eintragen.');
  if (gekuendigtZum && beginn && gekuendigtZum < beginn) throw new Error('„Gekündigt zum“ liegt vor dem Vertragsbeginn.');

  return {
    id: alt?.id ?? crypto.randomUUID(),
    name,
    anbieter,
    vertragsnummer: String(eingabe.vertragsnummer ?? '').trim().slice(0, 60),
    beginn,
    mindestlaufzeitMonate,
    verlaengerungMonate,
    fristAnzahl,
    fristEinheit,
    erinnerungTage,
    gekuendigtZum,
    // „Behalten“ gilt nur für den Kündigungstag, für den es gedrückt wurde
    erinnerungAusBis: eingabe.erinnerungAusBis === undefined ? alt?.erinnerungAusBis ?? null : eingabe.erinnerungAusBis,
    notiz: String(eingabe.notiz ?? '').trim().slice(0, 300),
    belege: eingabe.belege ?? alt?.belege ?? [],
    erstelltAm: alt?.erstelltAm ?? jetzt,
    geaendertAm: jetzt,
    ...(alt?.testdaten ? { testdaten: true } : {}),
  };
}

/* ---------- Laufzeit und Kündigung ---------- */

/**
 * Stand eines Vertrags an einem Tag.
 * status: 'beendet' | 'gekuendigt' | 'laeuft-aus' (endet ohne Verlängerung) | 'laufend' | 'unbefristet'
 * ende: nächstes mögliches Vertragsende (bzw. gekündigtes Ende), kuendigenBis: letzter Tag für die Kündigung,
 * erinnern: Erinnerung jetzt zeigen (innerhalb des Vorlaufs, nicht „behalten“).
 */
export function vertragsStand(v, heute) {
  if (v.gekuendigtZum) {
    return { status: v.gekuendigtZum < heute ? 'beendet' : 'gekuendigt', ende: v.gekuendigtZum, kuendigenBis: null, erinnern: false };
  }
  if (!v.beginn || !v.mindestlaufzeitMonate) {
    // Ohne Mindestlaufzeit: jederzeit mit der Frist kündbar – frühestes Ende, wenn heute gekündigt wird
    const ende = v.fristAnzahl ? (v.fristEinheit === 'monate' ? plusMonate(heute, v.fristAnzahl) : plusTage(heute, v.fristAnzahl * (v.fristEinheit === 'wochen' ? 7 : 1))) : heute;
    return { status: 'unbefristet', ende, kuendigenBis: null, erinnern: false };
  }
  let monate = v.mindestlaufzeitMonate;
  let ende = laufzeitEnde(v.beginn, monate);
  let kb = kuendigungsTag(ende, v.fristAnzahl, v.fristEinheit);
  if (!v.verlaengerungMonate) {
    // Verlängert sich nicht: endet von selbst
    return { status: ende < heute ? 'beendet' : 'laeuft-aus', ende, kuendigenBis: null, erinnern: false };
  }
  // Frist verpasst → der Vertrag hat sich verlängert; nächste Laufzeit prüfen
  for (let i = 0; kb < heute && i < 2000; i++) {
    monate += v.verlaengerungMonate;
    ende = laufzeitEnde(v.beginn, monate);
    kb = kuendigungsTag(ende, v.fristAnzahl, v.fristEinheit);
  }
  const vorlauf = v.erinnerungTage ?? STANDARD_ERINNERUNG_TAGE;
  const behalten = Boolean(v.erinnerungAusBis && v.erinnerungAusBis >= kb);
  return { status: 'laufend', ende, kuendigenBis: kb, tageBisFrist: tageBis(heute, kb), erinnern: !behalten && tageBis(heute, kb) <= vorlauf };
}

export const istAktiv = (v, heute) => vertragsStand(v, heute).status !== 'beendet';

/** Verträge, bei denen jetzt an die Kündigung erinnert werden soll – dringendste zuerst */
export function kuendigungsHinweise(vertraege, heute) {
  return vertraege
    .map((v) => ({ vertrag: v, stand: vertragsStand(v, heute) }))
    .filter((x) => x.stand.erinnern)
    .sort((a, b) => a.stand.kuendigenBis.localeCompare(b.stand.kuendigenBis));
}

/* ---------- Zuordnung und Kosten ---------- */

/** Vertrag einer Buchung: eigene Zuordnung, sonst die ihrer wiederkehrenden Buchung (rückwirkend) */
export function vertragVon(b, wiederkehrendNachId) {
  return b.vertragId || (b.wiederkehrendId && wiederkehrendNachId.get(b.wiederkehrendId)?.vertragId) || null;
}

/** Echte Buchungen eines Vertrags (ohne Papierkorb, Umbuchungen einmal), neueste zuerst */
export function vertragsBuchungen(vertragId, buchungen, wiederkehrend) {
  const wkNachId = new Map(wiederkehrend.map((w) => [w.id, w]));
  return buchungen
    .filter((b) => !b.geloeschtAm && !(b.art === 'umbuchung' && b.richtung === 'zu') && vertragVon(b, wkNachId) === vertragId)
    .sort((a, b) => b.datum.localeCompare(a.datum));
}

/** Aktueller Betrag einer wiederkehrenden Buchung: letzte Stufe, die heute schon gilt (sonst die erste) */
export function aktuellerBetrag(w, heute) {
  const stufen = [...(w.stufen ?? [])].sort((a, b) => a.ab.localeCompare(b.ab));
  return (stufen.filter((s) => s.ab <= heute).pop() ?? stufen[0])?.betragCent ?? 0;
}

/**
 * Laufende Kosten eines Vertrags aus seinen wiederkehrenden Buchungen (eingeschaltet, nicht beendet).
 * Ausgaben und Umbuchungen zählen als Kosten, Einnahmen (z. B. Erstattung) mindern sie.
 * Feste Abweichungen einzelner Kalendermonate (D94) bleiben unberücksichtigt.
 */
export function vertragsKosten(vertragId, wiederkehrend, heute) {
  const posten = wiederkehrend.filter((w) => w.vertragId === vertragId && w.aktiv !== false && !(w.ende && w.ende < heute));
  const jahrCent = posten.reduce((s, w) => {
    const betrag = aktuellerBetrag(w, heute) * (INTERVALL_JE_JAHR[w.intervall] ?? 12);
    return s + (w.art === 'einnahme' ? -betrag : betrag);
  }, 0);
  return { posten, jahrCent, monatCent: Math.round(jahrCent / 12) };
}

/** Summe aller laufenden Verträge (nicht beendet) für die Übersicht oben im Bereich */
export function vertragsUebersicht(vertraege, wiederkehrend, heute) {
  const laufend = vertraege.filter((v) => istAktiv(v, heute));
  const jahrCent = laufend.reduce((s, v) => s + vertragsKosten(v.id, wiederkehrend, heute).jahrCent, 0);
  return { anzahl: laufend.length, jahrCent, monatCent: Math.round(jahrCent / 12) };
}

/** Bei Kündigung: wiederkehrende Buchungen, die über das Vertragsende hinaus laufen würden */
export function endeVorschlag(vertragId, gekuendigtZum, wiederkehrend) {
  if (!gekuendigtZum) return [];
  return wiederkehrend.filter((w) => w.vertragId === vertragId && (!w.ende || w.ende > gekuendigtZum));
}

/** Vorschlag für „Vorhandene Buchungen zuordnen“: Buchungen ohne Vertrag, deren Text den Suchbegriff enthält */
export function zuordnungsKandidaten(vertragId, suchbegriff, buchungen, wiederkehrend) {
  const wkNachId = new Map(wiederkehrend.map((w) => [w.id, w]));
  const woerter = String(suchbegriff ?? '').toLocaleLowerCase('de').split(/\s+/).filter(Boolean);
  return buchungen
    .filter((b) => !b.geloeschtAm && !(b.art === 'umbuchung' && b.richtung === 'zu'))
    .filter((b) => vertragVon(b, wkNachId) !== vertragId)
    .filter((b) => {
      const text = [b.partner, b.notiz].join(' ').toLocaleLowerCase('de');
      return woerter.every((w) => text.includes(w));
    })
    .sort((a, b) => b.datum.localeCompare(a.datum));
}
