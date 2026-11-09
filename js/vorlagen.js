// Vorlagen für häufige Buchungen (D104). Reine Funktionen ohne Datenbank – mit `npm test` geprüft.
//
// Eine Vorlage füllt im Dialog "Neue Buchung" Art, Konto, Kategorie, Empfänger/Absender, Notiz und
// optional den Betrag vor. Gespeichert in der Sammlung "vorlagen" (ab Datenversion 17), mit Drive abgeglichen.
//
// Datensatz: { id, name, art, kontoId, gegenkontoId, kategorieId, partner, notiz, betragCent (oder null),
//              budgetKategorieId (nur Umbuchung), reihenfolge, erstelltAm, geaendertAm }

import { sortiereKonten, naechsteReihenfolge } from './konten.js';

export const MAX_NAME = 40;
export const ARTEN = ['ausgabe', 'einnahme', 'umbuchung'];

/** Vorlagen in der vom Nutzer festgelegten Reihenfolge (▲/▼ wie bei Konten) */
export const sortiereVorlagen = (vorlagen) => sortiereKonten(vorlagen);

/** Vorschlag für den Namen: Empfänger/Absender, sonst Unterkategorie, sonst Art */
export function namensVorschlag(werte, kategorien = []) {
  const partner = (werte.partner ?? '').trim();
  if (partner) return partner.slice(0, MAX_NAME);
  if (werte.art === 'umbuchung') return 'Umbuchung';
  return (kategorien.find((k) => k.id === werte.kategorieId)?.name ?? (werte.art === 'einnahme' ? 'Einnahme' : 'Ausgabe')).slice(0, MAX_NAME);
}

/**
 * Prüft und baut eine Vorlage. eingabe: Werte aus dem Buchungsdialog plus name und mitBetrag.
 * alt: bestehende Vorlage (beim Bearbeiten), vorhandene: alle Vorlagen (für Name doppelt / Reihenfolge).
 */
export function baueVorlage(eingabe, { konten = [], kategorien = [], vorhandene = [], alt = null, jetzt = new Date().toISOString() } = {}) {
  const name = String(eingabe.name ?? '').trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('Bitte einen Namen für die Vorlage eingeben.');
  if (name.length > MAX_NAME) throw new Error(`Der Name darf höchstens ${MAX_NAME} Zeichen haben.`);
  const gleich = (a, b) => a.toLocaleLowerCase('de') === b.toLocaleLowerCase('de');
  if (vorhandene.some((v) => v.id !== alt?.id && gleich(v.name, name))) throw new Error(`Es gibt schon eine Vorlage „${name}“.`);

  const art = eingabe.art;
  if (!ARTEN.includes(art)) throw new Error('Unbekannte Art.');
  const konto = konten.find((k) => k.id === eingabe.kontoId);
  if (!konto) throw new Error('Bitte ein Konto wählen.');

  let kategorieId = null;
  let gegenkontoId = null;
  let budgetKategorieId = null;
  if (art === 'umbuchung') {
    if (!konten.some((k) => k.id === eingabe.gegenkontoId)) throw new Error('Bitte das Zielkonto wählen.');
    if (eingabe.gegenkontoId === eingabe.kontoId) throw new Error('Von- und Auf-Konto müssen verschieden sein.');
    gegenkontoId = eingabe.gegenkontoId;
    budgetKategorieId = eingabe.budgetKategorieId || null;
  } else if (eingabe.kategorieId) {
    // Kategorie ist bei Vorlagen optional – ist sie gesetzt, muss sie zur Art passen
    const unter = kategorien.find((k) => k.id === eingabe.kategorieId);
    const haupt = kategorien.find((k) => k.id === unter?.elternId);
    if (!unter || !haupt || haupt.art !== art) throw new Error('Die Kategorie passt nicht zur Art.');
    kategorieId = unter.id;
  }

  let betragCent = null;
  if (eingabe.mitBetrag) {
    if (!Number.isInteger(eingabe.betragCent) || eingabe.betragCent <= 0) throw new Error('Für „Betrag mitspeichern“ bitte einen Betrag eingeben.');
    betragCent = eingabe.betragCent;
  }

  return {
    id: alt?.id ?? crypto.randomUUID(),
    name,
    art,
    kontoId: konto.id,
    gegenkontoId,
    kategorieId,
    budgetKategorieId,
    partner: art === 'umbuchung' ? '' : String(eingabe.partner ?? '').trim(),
    notiz: String(eingabe.notiz ?? '').trim(),
    betragCent,
    reihenfolge: alt?.reihenfolge ?? naechsteReihenfolge(vorhandene),
    erstelltAm: alt?.erstelltAm ?? jetzt,
    geaendertAm: jetzt,
  };
}

/**
 * Werte zum Vorbelegen des Buchungsdialogs. Archivierte oder gelöschte Konten/Kategorien
 * werden weggelassen (dann greift der normale Vorschlag), damit nichts Ungültiges gebucht wird.
 */
export function vorlageZuWerten(v, { konten = [], kategorien = [] } = {}) {
  const kontoOk = (id) => konten.some((k) => k.id === id && !k.archiviert);
  const unter = kategorien.find((k) => k.id === v.kategorieId);
  const haupt = kategorien.find((k) => k.id === unter?.elternId);
  const kategorieOk = unter && haupt && !unter.archiviert && !haupt.archiviert && haupt.art === v.art;
  return {
    art: v.art,
    kontoId: kontoOk(v.kontoId) ? v.kontoId : null,
    gegenkontoId: v.art === 'umbuchung' && kontoOk(v.gegenkontoId) ? v.gegenkontoId : null,
    kategorieId: v.art !== 'umbuchung' && kategorieOk ? v.kategorieId : null,
    budgetKategorieId: v.art === 'umbuchung' ? v.budgetKategorieId ?? null : null,
    partner: v.partner ?? '',
    notiz: v.notiz ?? '',
    betragCent: v.betragCent ?? null,
  };
}
