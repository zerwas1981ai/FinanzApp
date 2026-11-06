// Der Startsatz an Kategorien, der beim allerersten Öffnen angelegt wird.
// Alles lässt sich danach unter "Stammdaten" ändern, archivieren oder löschen.
// Gebucht wird später immer auf eine Unterkategorie, Budgets gelten je Hauptkategorie.

export const STANDARD_KATEGORIEN = [
  { name: 'Einkommen', art: 'einnahme', unter: ['Gehalt', 'Nebeneinkünfte', 'Kindergeld', 'Erstattungen', 'Sonstige Einnahmen'] },

  { name: 'Wohnen', art: 'ausgabe', unter: ['Miete', 'Rate Finanzierung', 'Bausparvertrag', 'Nebenkosten', 'Strom', 'Internet & Telefon', 'Rundfunkbeitrag', 'Einrichtung & Reparaturen'] },
  { name: 'Mobilität', art: 'ausgabe', unter: ['Kraftstoff & Laden', 'ÖPNV & Bahn', 'Kfz-Steuer', 'Werkstatt & Wartung', 'Parken'] },
  { name: 'Lebensmittel', art: 'ausgabe', unter: ['Supermarkt', 'Bäcker & Markt', 'Getränke'] },
  { name: 'Versicherungen', art: 'ausgabe', unter: ['Haftpflicht', 'Hausrat', 'Kfz-Versicherung', 'Kranken-Zusatz', 'Berufsunfähigkeit'] },
  { name: 'Freizeit', art: 'ausgabe', unter: ['Restaurant & Café', 'Lieferdienste (Pizza & Co.)', 'Hobbys', 'Sport', 'Urlaub', 'Abos & Streaming'] },
  { name: 'Gesundheit & Pflege', art: 'ausgabe', unter: ['Apotheke', 'Arzt & Zuzahlungen', 'Drogerie'] },
  { name: 'Kleidung', art: 'ausgabe', unter: ['Kleidung', 'Schuhe'] },
  { name: 'Kinder & Bildung', art: 'ausgabe', unter: ['Kita & Schule', 'Kurse & Bücher', 'Taschengeld'] },
  { name: 'Sonstiges', art: 'ausgabe', unter: ['Geschenke', 'Spenden', 'Bankgebühren', 'Sonstige Ausgaben'] },
];

/** Wandelt den Startsatz in einzelne Kategorie-Datensätze um. */
export function erzeugeStartKategorien(jetzt = new Date().toISOString()) {
  const ergebnis = [];
  for (const haupt of STANDARD_KATEGORIEN) {
    const hauptId = crypto.randomUUID();
    ergebnis.push(neueKategorie({ id: hauptId, name: haupt.name, art: haupt.art, jetzt }));
    for (const name of haupt.unter) {
      ergebnis.push(neueKategorie({ name, elternId: hauptId, jetzt }));
    }
  }
  return ergebnis;
}

/**
 * Ein Kategorie-Datensatz.
 * Hauptkategorie: elternId = null, art = 'einnahme' | 'ausgabe'
 * Unterkategorie: elternId = ID der Hauptkategorie, art = null (wird von der Hauptkategorie übernommen)
 */
export function neueKategorie({ id = crypto.randomUUID(), name, art = null, elternId = null, jetzt = new Date().toISOString(), extra = {} }) {
  return {
    id,
    name,
    elternId,
    art: elternId ? null : art,
    archiviert: false,
    erstelltAm: jetzt,
    geaendertAm: jetzt,
    ...extra,
  };
}
