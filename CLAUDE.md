# Finanzapp: Briefing für Claude Code

## Ziel
Private Finanz-App für eine einzige Person. Einnahmen und Ausgaben werden
manuell erfasst (keine Bankanbindung). Funktionen: mehrere Konten, Budgets,
Prognose bis 2050. Läuft als PWA auf Windows-PC und Android-Handy.
Oberfläche auf Deutsch, Währung Euro, deutsches Datums- und Zahlenformat.

## Arbeitsweise (wichtig)
- Arbeite IMMER nur an der aktuell genannten Etappe. Baue nichts aus späteren
  Etappen vor.
- Der Nutzer hat wenig Programmiererfahrung. Erkläre Entscheidungen kurz in
  einfachen Worten und sage, wie man das Ergebnis testet.
- Verwende ausschließlich erfundene Testdaten. Keine echten Kontodaten, keine
  Zugangsdaten im Code oder im Repository.
- Nach jeder Etappe: kurze Zusammenfassung, was funktioniert, was nicht.
- Bei Unklarheit nachfragen, nicht raten.

## Technik-Rahmen
- PWA, installierbar auf Android, läuft auch im Browser unter Windows
- Statisches Hosting (GitHub Pages oder Cloudflare Pages): nur Programmcode,
  keine Finanzdaten
- Daten: eine JSON-Datendatei im Google Drive des Nutzers (privates Konto);
  Belege als Dateien in einem Drive-Ordner
- Die App arbeitet lokal (IndexedDB) und gleicht beim Start und beim Speichern
  mit Drive ab. Bei Konflikten (beide Geräte geändert) MUSS sie nachfragen
  und darf nie still überschreiben.
- Das Datenmodell hat eine Versionsnummer. Ältere Datenstände werden beim
  Laden automatisch migriert.
- Optional: Daten pro Jahr getrennt speicherbar (Archivierung alter Jahre)

## Datenmodell
- Konto: Name, Anfangssaldo, Stichtag, Mindestsaldo
- Kategorie: Hauptkategorie mit Unterkategorien (Startsatz vorbelegt, in den
  Stammdaten anpassbar)
- Buchung: Datum, Betrag, Art (Einnahme/Ausgabe), Konto, Empfänger/Absender
  (optional), Unterkategorie, Notiz, Projekt (optional), Belege (mehrere
  möglich, PDF/JPG), Status
- Umbuchung: zwei verknüpfte Buchungen (Abgang Konto A, Zugang Konto B).
  Zählt in Auswertungen NICHT als Einnahme oder Ausgabe.
- Budget: pro Hauptkategorie, wiederkehrend oder einmalig
- Wiederkehrende Buchung: Intervall (monatlich/vierteljährlich/jährlich),
  Start, optional Ende, Wertänderungen ab Datum, einzelne Monate
  überspringen oder verschieben
- Geplante Einmalbuchung: bekannt, aber nicht wiederkehrend. Wird bei
  Eingang der echten Buchung als erledigt markiert und nicht doppelt gezählt
  (Soll/Ist-Abgleich).
- Gelöschte Buchungen kommen zuerst in einen Papierkorb.

## Oberfläche (5 Tabs)
1. Übersicht
   - Oben: Gesamtkontostand heute und prognostiziert zum Monatsende (alle
     Konten), Einnahmen/Ausgaben des Monats, Budgetauslastung der wichtigsten
     Kategorien, Warnung bei Unterschreiten des Mindestsaldos (mit erstem
     betroffenen Monat), größte Ausgabenkategorie, max. 2 Budget-Hinweise
   - Konten nebeneinander oder umschaltbar, je Konto Monatsansicht mit
     Zwischensummen
   - Unter dem aktuellen Monat die Zukunftsmonate: Rest des laufenden Jahres
     immer sichtbar (komprimiert, aufklappbar), Folgejahre bis 2050 einzeln
     ein- und ausblendbar. Zukunftswerte optisch klar als Annahme
     gekennzeichnet (z. B. kursiv oder schraffiert).
2. Alle Buchungen: über alle Konten filtern, sortieren, analysieren; Filter
   "ohne Beleg"
3. Projekte: Einmalausgaben (echte und geplante Buchungen) einem Projekt
   zuordnen, z. B. Umbau oder Urlaub; Gesamtkosten mit optionalem Rahmen.
   Projektausgaben zählen nicht gegen das Monatsbudget. (Ersetzt die
   früher geplanten Szenarien „Was wäre wenn“, siehe DECISIONS.md D51.)
4. Annahmen: wiederkehrende Buchungen, Budgets für die Zukunft, geplante
   Einmalbuchungen. Nur absolute Werte, KEINE Prozentsteigerungen oder
   Inflation. Ein/Aus-Schalter je Posten, um ihn für die Prognose
   auszuschalten, ohne etwas zu löschen.
5. Stammdaten: Konten, Kategorien, Schwellen für Hinweise

## Rechenlogik
- Zukunftsmonate werden bei jedem Öffnen berechnet, nicht gespeichert.
- Budget: Es gilt pro Hauptkategorie. Buchungen auf Unterkategorien
  verbrauchen es. Nicht verbrauchter Rest verfällt am Monatsende.
- Zukunft: Das Budget wirkt wie eine wiederkehrende Ausgabe in der vom
  Nutzer vorgegebenen Höhe.
- Laufender Monat: Prognose = echte Buchungen bisher + noch offener
  Budgetrest, mindestens aber die echten Buchungen.
- Budgethinweis: Wenn eine Hauptkategorie 3 Monate in Folge über oder unter
  dem Budget liegt (Durchschnittsabweichung mehr als 10 %, beides einstellbar),
  erscheint eine ruhige Hinweiskarte (kein Pop-up) mit Zahlen und einem
  Vorschlag zur Anpassung. Nutzer wählt: übernehmen (ab welchem Monat),
  ablehnen, später erinnern. Die App ändert nie selbst etwas.
- Kontoabstimmung: Der Nutzer gibt den echten Bankstand ein, die App zeigt
  die Differenz zum berechneten Stand.

## Komfort und Sicherheit
- Schnellerfassung: Betrag, Kategorie, fertig. Datum Standard heute, Konto
  zuletzt benutzt. Vorlagen für häufige Buchungen.
- Kamera-Button für Belegfoto, Bilder beim Hochladen verkleinern
- Automatisches Backup bei jedem Speichern (letzte 30 Stände), Export als
  CSV/Excel
- App-Sperre (PIN oder Geräteentsperrung)
- Dark- und Hell-Modus umschaltbar; schlichtes, modernes Design

## Nicht im Umfang (nicht von selbst einbauen)
Mehrbenutzer, andere Währungen, Bankimport, KI-Funktionen,
Inflation/Prozentsteigerungen.

## Etappen
1. Grundgerüst, Design, Dark/Hell, Stammdaten (Konten, Kategorien)
2. Buchungen erfassen, Monatsansicht pro Konto, Umbuchungen,
   Anfangssalden und Kontoabstimmung
3. Tab "Alle Buchungen" mit Filtern und Analyse
4. Budgets, wiederkehrende Buchungen, Kennzahlen oben, Budgethinweise
   (zuletzt, mit Testdaten prüfen)
5. Annahmen-Tab und Zeitleiste bis 2050, Projekte (statt Szenario-Schalter)
6. Google Drive: Datensync mit Konfliktabfrage, Belege, Backup, Export