# Finanzapp: Briefing für Claude Code

## Ziel
Private Finanz-App für eine einzige Person. Einnahmen und Ausgaben werden
manuell erfasst (keine Bankanbindung). Funktionen: mehrere Konten, Budgets,
Prognose bis 2050. Läuft als PWA auf Windows-PC und Android-Handy.
Oberfläche auf Deutsch, Währung Euro, deutsches Datums- und Zahlenformat.

## Aktueller Stand
- Alle Grundfunktionen sind fertig und online (GitHub Pages); seitdem Verbesserungsrunden auf Wunsch.
- Letzte Entscheidung: D255, Cache-Version in sw.js: finanzapp-v152, Datenmodell-Version 28.
- Tests mit `npm test`, alle grün. `tests/wegweiser.test.js` prüft, ob diese Zeile, der Wegweiser in DECISIONS.md und sw.js zum Code passen.

## Arbeitsweise (wichtig)
- Nur umsetzen, was der Nutzer verlangt; nichts ungefragt vorbauen.
- Der Nutzer hat wenig Programmiererfahrung. Erkläre Entscheidungen kurz in
  einfachen Worten und sage, wie man das Ergebnis testet.
- Verwende ausschließlich erfundene Testdaten. Keine echten Kontodaten, keine
  Zugangsdaten im Code oder im Repository.
- Nach jeder Änderung: kurze Zusammenfassung, was funktioniert, was nicht.
- Bei Unklarheit nachfragen, nicht raten.
- Details zu Datenmodell, Oberfläche und Rechenlogik stehen in SPEC.md – nur bei Bedarf lesen.
- DECISIONS.md nur lesen, wenn eine konkrete D-Nummer gebraucht wird (gezielt suchen, nicht ganz lesen).
- Bei jeder neuen D-Nummer: Eintrag in DECISIONS.md, dort „Was gilt aktuell“ (Stand-Zeile, ggf. Liste) und die Zeile oben mitpflegen.

## Technik-Rahmen
- PWA, installierbar auf Android, läuft auch im Browser unter Windows
- Statisches Hosting (GitHub Pages): nur Programmcode, keine Finanzdaten
- Daten: eine JSON-Datendatei im Google Drive des Nutzers; Belege als Dateien in einem Drive-Ordner
- Die App arbeitet lokal (IndexedDB) und gleicht beim Start und beim Speichern mit Drive ab.
- Das Datenmodell hat eine Versionsnummer; ältere Stände werden beim Laden automatisch migriert.

## Unverletzliche Regeln
- Bei Konflikten (beide Geräte geändert) MUSS die App nachfragen und darf nie still überschreiben.
- Die App schlägt nur vor (Budgethinweise, Erkennung, Preisänderung …); geändert wird erst nach einem Klick.
- Umbuchungen zählen in Auswertungen NIE als Einnahme oder Ausgabe; offene Auslagen und Rückzahlungen auch nicht (D214, `zaehltCent`).
- Nur absolute Werte: keine Prozentsteigerungen, keine Inflation.
- Zukunftsmonate werden bei jedem Öffnen berechnet, nie gespeichert.
- Geplante Einmalbuchungen werden bei Eingang der echten Buchung erledigt, nie doppelt gezählt.
- Gelöschte Buchungen kommen zuerst in den Papierkorb.
- Budgets gelten je Hauptkategorie und Konto; Projektausgaben zählen nicht gegen Budgets.

## Wo liegt was
- `index.html`, `css/style.css` – Gerüst und gesamtes Design (Dark/Hell)
- `sw.js` – Offline-Cache: bei jeder Änderung CACHE hochzählen, neue Dateien eintragen
- `js/app.js` – Start, Tab-Umschaltung; `js/sperre.js`, `js/login.js` – App-Login/Passkey
- `js/db.js` – IndexedDB mit Zwischenspeicher; `js/migrationen.js` – Datenmodell-Version, Migrationen
- `js/prognose.js` – Prognose, Zeitleiste bis 2050, Budgets, Termine wiederkehrender Buchungen
- `js/rechnen.js` – Kontostände, Monatsübersicht; `js/buchungen.js` – Buchungen, Umbuchungen, Papierkorb
- `js/annahmen.js`, `js/jahresbudget.js` – Budgets, wiederkehrende und geplante Buchungen bauen
- `js/sync/` – Google-Drive-Abgleich mit Konfliktabfrage
- `js/erkennung.js`, `js/abstimmhilfe.js`, `js/abschluss.js` – Hinweise ohne KI
- `js/energie.js` – Abschlagsrechner Strom/Gas (D233), Ansicht `js/views/energie.js`
- `js/auslagen.js` – Auslagen und Rückzahlungen (D214); Aufrunden und Ausgleich stecken in `js/buchungen.js` (D215/D216)
- `js/ui.js`, `js/dom.js` – Dialoge, Umschalter, Meldungen, `h()`-Helfer
- `js/views/*.js` – Ansicht je Tab/Bereich (uebersicht, alle-buchungen, annahmen, stammdaten …); `verlauf-grafik.js` – Monatsverlauf im Kontokopf (D251)
- `js/testdaten.js` – erfundene Testdaten (nur auf localhost); `tests/` – Tests der reinen Funktionen
- `SPEC.md` – fachliche Details; `DECISIONS.md` – alle Entscheidungen (D-Nummern)

## Komfort und Sicherheit
- Schnellerfassung: Betrag, Kategorie, fertig. Datum Standard heute, Konto zuletzt benutzt.
- Hinweise aus eigenen Buchungen, ohne KI (Erkennung, Ausreißer, Abstimmhilfe, Monatsabschluss, Jahreswechsel)
- Belege per Kamera oder „Teilen“, Bilder beim Hochladen verkleinern
- Backup bei jedem Speichern (letzte 30 Stände), Export CSV, Sicherungsdatei wahlweise mit Passwort
- App-Login: Pflicht-Passwort für alle Geräte (über Drive abgeglichen), je Gerät Passkey möglich
- Dark- und Hell-Modus, Schriftgröße je Gerät; schlichtes, modernes Design

## Nicht im Umfang (nicht von selbst einbauen)
Mehrbenutzer, andere Währungen, Bankimport, KI-Funktionen,
Inflation/Prozentsteigerungen.
