// Erfundene Testdaten zum Ausprobieren. Alle Testdatensätze tragen das Feld
// testdaten: true; Konten und Kategorien zusätzlich "(Test)" im Namen.
// "Testdaten löschen" entfernt genau diese Datensätze (plus Buchungen auf Testkonten),
// eigene Einträge bleiben unberührt.

import * as db from './db.js';
import { neueKategorie } from './startdaten.js';
import { baueBuchungen } from './buchungen.js';
import { heuteIso, isoMonatsanfang, vorigerMonat } from './format.js';

function konto(name, anfangssaldoCent, stichtag, mindestsaldoCent, archiviert = false) {
  const jetzt = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name,
    anfangssaldoCent,
    stichtag,
    mindestsaldoCent,
    archiviert,
    erstelltAm: jetzt,
    geaendertAm: jetzt,
    testdaten: true,
  };
}

export function hatTestdaten(konten, kategorien, buchungen = []) {
  return [konten, kategorien, buchungen].some((liste) => liste.some((x) => x.testdaten));
}

export async function ladeTestdaten() {
  const [konten, kategorien, buchungen] = await Promise.all([db.alle('konten'), db.alle('kategorien'), db.alle('buchungen')]);
  if (hatTestdaten(konten, kategorien, buchungen)) return false;

  // Zeitraum: die letzten drei Monate bis heute (Stichtag = Anfang des vorletzten Monats)
  const heute = heuteIso();
  const aktuell = [Number(heute.slice(0, 4)), Number(heute.slice(5, 7))];
  const monate = [vorigerMonat(...vorigerMonat(...aktuell)), vorigerMonat(...aktuell), aktuell];
  const stichtag = isoMonatsanfang(...monate[0]);

  const giro = konto('Girokonto (Test)', 245000, stichtag, 50000);
  const tagesgeld = konto('Tagesgeld (Test)', 800000, stichtag, null);
  const kredit = konto('Kreditkarte (Test)', -32050, stichtag, -150000);
  const neueKonten = [giro, tagesgeld, kredit, konto('Altes Sparbuch (Test)', 15000, '2020-01-01', null, true)];
  await db.speichere('konten', neueKonten);

  const extra = { testdaten: true };
  const haustier = neueKategorie({ name: 'Haustier (Test)', art: 'ausgabe', extra });
  const futter = neueKategorie({ name: 'Futter', elternId: haustier.id, extra });
  const neueKats = [haustier, futter, neueKategorie({ name: 'Tierarzt', elternId: haustier.id, extra })];
  const einkommen = kategorien.find((k) => !k.elternId && k.name === 'Einkommen');
  if (einkommen) neueKats.push(neueKategorie({ name: 'Flohmarkt (Test)', elternId: einkommen.id, extra }));
  await db.speichere('kategorien', neueKats);

  // Unterkategorie aus dem Startsatz suchen (fehlt sie, wird die Buchung übersprungen)
  const alleKats = [...kategorien, ...neueKats];
  const kat = (haupt, unter) => {
    const hk = alleKats.find((k) => !k.elternId && k.name === haupt);
    return hk && alleKats.find((k) => k.elternId === hk.id && k.name === unter)?.id;
  };

  const vorlagen = [
    // [Tag, Art, Konto, Betrag in Cent, Hauptkategorie, Unterkategorie, Notiz]
    [1, 'einnahme', giro, 320000, 'Einkommen', 'Gehalt', 'Muster GmbH'],
    [2, 'umbuchung', giro, 20000, null, tagesgeld, 'Sparrate'],
    [3, 'ausgabe', giro, 95000, 'Wohnen', 'Miete', ''],
    [3, 'ausgabe', giro, 8500, 'Wohnen', 'Strom', 'Abschlag'],
    [6, 'ausgabe', giro, 6240, 'Lebensmittel', 'Supermarkt', ''],
    [8, 'ausgabe', kredit, 4580, 'Freizeit', 'Restaurant & Café', 'Pizzeria Beispiel'],
    [10, 'ausgabe', giro, 5800, 'Mobilität', 'Kraftstoff & Laden', ''],
    [12, 'ausgabe', giro, 2390, 'Haustier (Test)', 'Futter', ''],
    [13, 'ausgabe', giro, 4815, 'Lebensmittel', 'Supermarkt', ''],
    [14, 'ausgabe', kredit, 1299, 'Freizeit', 'Abos & Streaming', ''],
    [15, 'umbuchung', giro, 25000, null, kredit, 'Ausgleich Kreditkarte'],
    [18, 'ausgabe', giro, 2450, 'Freizeit', 'Lieferdienste (Pizza & Co.)', ''],
    [20, 'ausgabe', giro, 7190, 'Lebensmittel', 'Supermarkt', ''],
    [27, 'ausgabe', giro, 3999, 'Lebensmittel', 'Supermarkt', ''],
  ];

  const pad = (n) => String(n).padStart(2, '0');
  const datensaetze = [];
  for (const [j, m] of monate) {
    for (const [tag, art, k, betragCent, haupt, unter, notiz] of vorlagen) {
      const datum = `${j}-${pad(m)}-${pad(tag)}`;
      if (datum > heute) continue;
      const eingabe = { art, betragCent, datum, kontoId: k.id, notiz, status: 'gebucht' };
      if (art === 'umbuchung') eingabe.gegenkontoId = unter.id;
      else {
        eingabe.kategorieId = kat(haupt, unter);
        if (!eingabe.kategorieId) continue;
      }
      datensaetze.push(...baueBuchungen(eingabe, { konten: neueKonten }));
    }
  }
  // Eine vorgemerkte Kartenzahlung von heute
  const baecker = kat('Lebensmittel', 'Bäcker & Markt');
  if (baecker) {
    datensaetze.push(...baueBuchungen(
      { art: 'ausgabe', betragCent: 3320, datum: heute, kontoId: giro.id, kategorieId: baecker, notiz: 'Kartenzahlung', status: 'vorgemerkt' },
      { konten: neueKonten },
    ));
  }

  await db.speichere('buchungen', datensaetze.map((b) => ({ ...b, testdaten: true })));
  return true;
}

export async function loescheTestdaten() {
  const [konten, kategorien, buchungen] = await Promise.all([db.alle('konten'), db.alle('kategorien'), db.alle('buchungen')]);
  const kontoIds = new Set(konten.filter((k) => k.testdaten).map((k) => k.id));
  const katIds = new Set(kategorien.filter((k) => k.testdaten).map((k) => k.id));
  // Auch selbst angelegte Unterkategorien unter einer Test-Hauptkategorie entfernen,
  // sonst blieben sie ohne Hauptkategorie zurück.
  for (const k of kategorien) if (k.elternId && katIds.has(k.elternId)) katIds.add(k.id);

  // Buchungen: Testbuchungen und alles, was an Testkonten/-kategorien hängt (inkl. Umbuchungs-Partner)
  const weg = buchungen.filter((b) => b.testdaten || kontoIds.has(b.kontoId) || kontoIds.has(b.gegenkontoId) || katIds.has(b.kategorieId));
  const umbuchungIds = new Set(weg.map((b) => b.umbuchungId).filter(Boolean));
  const buchungIds = new Set(weg.map((b) => b.id));
  for (const b of buchungen) if (b.umbuchungId && umbuchungIds.has(b.umbuchungId)) buchungIds.add(b.id);

  await db.loesche('buchungen', [...buchungIds]);
  await db.loesche('konten', [...kontoIds]);
  await db.loesche('kategorien', [...katIds]);
  return { konten: kontoIds.size, kategorien: katIds.size, buchungen: buchungIds.size };
}
