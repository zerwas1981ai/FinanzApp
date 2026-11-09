// Datenmodell-Version und Migrationen.
//
// So funktioniert es:
// - Jeder gespeicherte Datenstand trägt eine Versionsnummer ("version").
// - Ändert sich in einer späteren Etappe das Datenmodell, wird DATENMODELL_VERSION
//   um 1 erhöht und unten ein Migrationsschritt ergänzt, z. B.:
//
//     {
//       nach: 2,
//       beschreibung: 'Konten bekommen ein Feld "farbe"',
//       migriere(daten) {
//         for (const k of daten.konten) k.farbe ??= null;
//         return daten;
//       },
//     },
//
// - Beim Start (und später beim Laden aus Google Drive) werden alle fehlenden
//   Schritte automatisch nacheinander ausgeführt: 1 → 2 → 3 …
// - Migrationen arbeiten auf einem einfachen Daten-Objekt
//   { version, konten: [...], kategorien: [...] } – unabhängig von IndexedDB.
//   So lassen sie sich mit derselben Funktion auf die Drive-JSON-Datei anwenden.

import { neueKategorie, INVESTITIONEN_UNTER, BARGELD_UNTER } from './startdaten.js';
import { startReihenfolge } from './konten.js';

export const DATENMODELL_VERSION = 17;

/** Standard-Schwellen für Budgethinweise (in den Stammdaten änderbar) */
export const STANDARD_EINSTELLUNGEN = Object.freeze({ id: 'hinweise', monate: 3, prozent: 10 });

export const MIGRATIONEN = [
  {
    nach: 2,
    beschreibung: 'Etappe 2: Sammlungen "buchungen" und "abstimmungen" kommen dazu',
    migriere(daten) {
      daten.buchungen ??= [];
      daten.abstimmungen ??= [];
      return daten;
    },
  },
  {
    nach: 3,
    beschreibung: 'Etappe 4: Budgets, wiederkehrende Buchungen, Hinweis-Status, Einstellungen; ' +
      'Buchungen bekommen die Verknüpfung zur wiederkehrenden Buchung',
    migriere(daten) {
      daten.budgets ??= [];
      daten.wiederkehrend ??= [];
      daten.hinweise ??= [];
      daten.einstellungen ??= [];
      if (!daten.einstellungen.some((e) => e.id === 'hinweise')) daten.einstellungen.push({ ...STANDARD_EINSTELLUNGEN });
      for (const b of daten.buchungen ?? []) {
        b.wiederkehrendId ??= null;
        b.faelligAm ??= null;
      }
      return daten;
    },
  },
  {
    nach: 4,
    beschreibung: 'Etappe 5: geplante Einmalbuchungen, Szenarien; Annahmen bekommen Ein/Aus-Schalter ' +
      'und Szenario-Zuordnung; Buchungen die Verknüpfung zur geplanten Einmalbuchung',
    migriere(daten) {
      daten.geplant ??= [];
      daten.szenarien ??= [];
      for (const x of [...(daten.budgets ?? []), ...(daten.wiederkehrend ?? [])]) {
        x.aktiv ??= true;
        x.szenarioId ??= null;
      }
      for (const w of daten.wiederkehrend ?? []) w.monatsletzter ??= false;
      for (const b of daten.buchungen ?? []) b.geplantId ??= null;
      return daten;
    },
  },
  {
    nach: 5,
    beschreibung: 'Projekte statt Szenarien: Sammlung "projekte" kommt dazu, Buchungen und geplante ' +
      'Einmalbuchungen bekommen projektId. Szenarien entfallen – Posten eines ausgeschalteten ' +
      'Szenarios werden selbst ausgeschaltet, damit sich an der Prognose nichts ändert.',
    migriere(daten) {
      daten.projekte ??= [];
      const an = new Set((daten.szenarien ?? []).filter((s) => s.aktiv).map((s) => s.id));
      for (const x of [...(daten.budgets ?? []), ...(daten.wiederkehrend ?? []), ...(daten.geplant ?? [])]) {
        if (x.szenarioId && !an.has(x.szenarioId)) x.aktiv = false;
        delete x.szenarioId;
      }
      for (const g of daten.geplant ?? []) g.projektId ??= null;
      for (const b of daten.buchungen ?? []) b.projektId ??= null;
      delete daten.szenarien;
      return daten;
    },
  },
  {
    nach: 6,
    beschreibung: 'Neue Hauptkategorien "Investitionen" und "Bargeldabhebung" (Wunsch des Nutzers). ' +
      'Die bisherige Unterkategorie "Sonstiges › Bargeldabhebung" wandert samt Buchungen nach ' +
      '"Bargeldabhebung › Geldautomat". Gibt es eine Hauptkategorie mit dem Namen schon, bleibt alles, wie es ist.',
    migriere(daten) {
      daten.kategorien ??= [];
      const jetzt = new Date().toISOString();
      const gleich = (a, b) => (a ?? '').trim().toLocaleLowerCase('de') === b.toLocaleLowerCase('de');
      const haupt = () => daten.kategorien.filter((k) => !k.elternId);
      const neueHaupt = (name, unterNamen) => {
        const hk = neueKategorie({ name, art: 'ausgabe', jetzt });
        daten.kategorien.push(hk, ...unterNamen.map((n) => neueKategorie({ name: n, elternId: hk.id, jetzt })));
        return hk;
      };

      if (!haupt().some((k) => gleich(k.name, 'Investitionen'))) neueHaupt('Investitionen', INVESTITIONEN_UNTER);

      if (!haupt().some((k) => gleich(k.name, 'Bargeldabhebung') || gleich(k.name, 'Bargeld'))) {
        const sonstiges = haupt().find((k) => gleich(k.name, 'Sonstiges'));
        const alt = sonstiges && daten.kategorien.find((k) => k.elternId === sonstiges.id && gleich(k.name, 'Bargeldabhebung'));
        if (alt) {
          // Unterkategorie umhängen – ihre ID bleibt, also wandern alle Buchungen mit
          const hk = neueKategorie({ name: 'Bargeldabhebung', art: 'ausgabe', jetzt });
          daten.kategorien.push(hk);
          Object.assign(alt, { elternId: hk.id, name: 'Geldautomat', geaendertAm: jetzt });
        } else {
          neueHaupt('Bargeldabhebung', BARGELD_UNTER);
        }
      }
      return daten;
    },
  },
  {
    nach: 7,
    beschreibung: 'Wiederkehrende Budgets bekommen "ausnahmen" (einzelne Monate mit anderem Betrag). ' +
      'Wiederkehrende Buchungen kennen zusätzlich die Ausnahme "aendern" (Betrag/Datum nur für einen Termin) – ' +
      'dafür ist keine Umwandlung nötig.',
    migriere(daten) {
      for (const b of daten.budgets ?? []) if (b.typ === 'wiederkehrend') b.ausnahmen ??= [];
      return daten;
    },
  },
  {
    nach: 8,
    beschreibung: 'Buchungen, wiederkehrende und geplante Buchungen bekommen "partner" ' +
      '(Empfänger bei Ausgaben, Absender bei Einnahmen; leer = keine Angabe).',
    migriere(daten) {
      for (const x of [...(daten.buchungen ?? []), ...(daten.wiederkehrend ?? []), ...(daten.geplant ?? [])]) x.partner ??= '';
      return daten;
    },
  },
  {
    nach: 9,
    beschreibung: 'Archivierung alter Jahre: Sammlung "archive" (welche Jahre archiviert sind, D68)',
    migriere(daten) {
      daten.archive ??= [];
      return daten;
    },
  },
  {
    nach: 10,
    beschreibung: 'Relevante Ausgaben (D74): Sammlung "relevant" für eigene Einträge; Buchungen bekommen ' +
      '"relevant" (Häkchen) und "relevantGruppe".',
    migriere(daten) {
      daten.relevant ??= [];
      for (const b of daten.buchungen ?? []) {
        b.relevant ??= false;
        b.relevantGruppe ??= '';
      }
      return daten;
    },
  },
  {
    nach: 11,
    beschreibung: 'Konten bekommen "reihenfolge" (D84). Start wie bisher: alphabetisch, archivierte zuletzt.',
    migriere(daten) {
      const start = startReihenfolge(daten.konten ?? []);
      for (const k of daten.konten ?? []) k.reihenfolge ??= start.get(k.id);
      return daten;
    },
  },
  {
    nach: 12,
    beschreibung: 'Budgets können jährlich sein (typ "jaehrlich", D90). Vorhandene Daten bleiben unverändert; ' +
      'die neue Version sorgt dafür, dass ältere App-Versionen zum Aktualisieren auffordern.',
    migriere(daten) {
      return daten;
    },
  },
  {
    nach: 13,
    beschreibung: 'Monatliche Budgets bekommen "kalenderMonate" (feste Abweichung je Kalendermonat, jedes Jahr; D92).',
    migriere(daten) {
      for (const b of daten.budgets ?? []) if (b.typ === 'wiederkehrend') b.kalenderMonate ??= [];
      return daten;
    },
  },
  {
    nach: 14,
    beschreibung: 'Wiederkehrende Buchungen bekommen "kalenderMonate" (feste Abweichung je Kalendermonat, jedes Jahr; D94).',
    migriere(daten) {
      for (const w of daten.wiederkehrend ?? []) w.kalenderMonate ??= [];
      return daten;
    },
  },
  {
    nach: 15,
    beschreibung: 'Wiederkehrende Buchungen: Pflicht-Bezeichnung entfällt, stattdessen optionale Notiz (D96). ' +
      'Die bisherige Bezeichnung wird zur Notiz, damit nichts verloren geht.',
    migriere(daten) {
      for (const w of daten.wiederkehrend ?? []) {
        if (w.notiz == null) w.notiz = w.bezeichnung ?? '';
        delete w.bezeichnung;
      }
      return daten;
    },
  },
  {
    nach: 16,
    beschreibung: 'Umbuchungen können optional einem Budget zugeordnet werden ("budgetKategorieId", D98) – ' +
      'echte, wiederkehrende und geplante.',
    migriere(daten) {
      for (const x of [...(daten.buchungen ?? []), ...(daten.wiederkehrend ?? []), ...(daten.geplant ?? [])]) x.budgetKategorieId ??= null;
      return daten;
    },
  },
  {
    nach: 17,
    beschreibung: 'Vorlagen für häufige Buchungen: neue Sammlung "vorlagen" (D104).',
    migriere(daten) {
      daten.vorlagen ??= [];
      return daten;
    },
  },
];

/**
 * Bringt einen Datenstand auf die Zielversion.
 * Gibt { daten, angewendet } zurück; das Original bleibt unverändert.
 */
export function migriereDaten(daten, migrationen = MIGRATIONEN, zielVersion = DATENMODELL_VERSION) {
  if (!daten || !Number.isInteger(daten.version)) {
    throw new Error('Datenstand ohne gültige Versionsnummer.');
  }
  if (daten.version > zielVersion) {
    throw new Error(
      `Die Daten stammen aus einer neueren App-Version (Datenversion ${daten.version}, ` +
      `diese App kennt bis ${zielVersion}). Bitte die App aktualisieren.`,
    );
  }

  let d = structuredClone(daten);
  const angewendet = [];
  const schritte = [...migrationen].sort((a, b) => a.nach - b.nach);

  while (d.version < zielVersion) {
    const schritt = schritte.find((m) => m.nach === d.version + 1);
    if (!schritt) throw new Error(`Migration auf Version ${d.version + 1} fehlt.`);
    d = schritt.migriere(d) ?? d;
    d.version = schritt.nach;
    angewendet.push(schritt.nach);
  }
  return { daten: d, angewendet };
}
