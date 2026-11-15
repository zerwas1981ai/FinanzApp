# Notizen zum Stand (15.11.2026)

## Was funktioniert
- Online auf GitHub Pages, Cache finanzapp-v116, letzte Entscheidung D213, 181 Tests grün (`npm test`).
- 5 Tabs: Übersicht, Alle Buchungen (Liste/Analyse/Belege), Projekte, Annahmen (inkl. Verträge), Stammdaten.
- Buchungen, Umbuchungen, Budgets (Monat/Jahr/einmalig), wiederkehrende und geplante Buchungen, Prognose bis 2050.
- Google-Drive-Abgleich mit Konfliktabfrage, Belege, Backups, Archiv alter Jahre, Login mit Passwort/Passkey.
- Hinweise ohne KI: Erkennung, „↑ hoch“, Preisänderung, Abstimmhilfe, Monatsabschluss (1.–10.).
- Runde 8 (D208–D213): Wischen in Listen, Budget-Vorschlag, Unterkategorien zusammenführen,
  Monatsvergleich, Sicherungsdatei mit Passwort, Zwischenspeicher in db.js.

## Offene Bugs
- Keine bekannten.

## Ungeprüft (nur am PC nachgestellt)
- Wischen in Buchungslisten (D211) und Monatswechsel per Wischen (D200) am echten Android-Handy.
- Zurück-Taste schließt Dialoge (D176) am echten Android-Handy.
- Tempo am Handy mit vielen Daten (PC: Übersicht 130 ms bei 11.000 Buchungen).

## Angefangene Arbeiten
- Keine im Code.
- Offene Entscheidung: Empfänger-Logos – Variante (Initialen-Kreis / eigenes Bild) noch nicht gewählt.

## Nächste Schritte
1. D211, D200 und D176 am Handy testen, Rückmeldung einarbeiten.
2. Tempo am Handy prüfen; bei Bedarf alte Jahre archivieren oder weiter optimieren.
3. Entscheidung zu Empfänger-Logos einholen.
4. Nicht gewählte Vorschläge bei Bedarf erneut anbieten: automatische Sperre, Notiz-Vorschläge,
   Vorgemerkte nachfassen.
