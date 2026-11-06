// Erfundene Testdaten zum Ausprobieren. Alle Testdatensätze tragen das Feld
// testdaten: true und "(Test)" im Namen. "Testdaten löschen" entfernt genau diese
// Datensätze – eigene Einträge bleiben unberührt.

import * as db from './db.js';
import { neueKategorie } from './startdaten.js';

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

export function hatTestdaten(konten, kategorien) {
  return konten.some((k) => k.testdaten) || kategorien.some((k) => k.testdaten);
}

export async function ladeTestdaten() {
  const [konten, kategorien] = await Promise.all([db.alle('konten'), db.alle('kategorien')]);
  if (hatTestdaten(konten, kategorien)) return false;

  await db.speichere('konten', [
    konto('Girokonto (Test)', 245000, '2026-01-01', 50000),
    konto('Tagesgeld (Test)', 800000, '2026-01-01', null),
    konto('Kreditkarte (Test)', -32050, '2026-01-01', -150000),
    konto('Altes Sparbuch (Test)', 15000, '2020-01-01', null, true),
  ]);

  const extra = { testdaten: true };
  const haustier = neueKategorie({ name: 'Haustier (Test)', art: 'ausgabe', extra });
  const neueKats = [
    haustier,
    neueKategorie({ name: 'Futter', elternId: haustier.id, extra }),
    neueKategorie({ name: 'Tierarzt', elternId: haustier.id, extra }),
  ];
  const einkommen = kategorien.find((k) => !k.elternId && k.name === 'Einkommen');
  if (einkommen) neueKats.push(neueKategorie({ name: 'Flohmarkt (Test)', elternId: einkommen.id, extra }));
  await db.speichere('kategorien', neueKats);
  return true;
}

export async function loescheTestdaten() {
  const [konten, kategorien] = await Promise.all([db.alle('konten'), db.alle('kategorien')]);
  const kontoIds = konten.filter((k) => k.testdaten).map((k) => k.id);
  const katIds = new Set(kategorien.filter((k) => k.testdaten).map((k) => k.id));
  // Auch selbst angelegte Unterkategorien unter einer Test-Hauptkategorie entfernen,
  // sonst blieben sie ohne Hauptkategorie zurück.
  for (const k of kategorien) if (k.elternId && katIds.has(k.elternId)) katIds.add(k.id);

  await db.loesche('konten', kontoIds);
  await db.loesche('kategorien', [...katIds]);
  return { konten: kontoIds.length, kategorien: katIds.size };
}
