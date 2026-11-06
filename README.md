# Finanzen – private Finanz-App (PWA)

Stand: **Etappe 2** (Buchungen erfassen, Monatsansicht pro Konto, Umbuchungen,
Papierkorb, Kontoabstimmung). Davor Etappe 1: Grundgerüst, Design, Hell/Dunkel, Stammdaten.
Ziele und Etappen: siehe `CLAUDE.md`. Technische Entscheidungen: siehe `DECISIONS.md`.

## App starten (Windows)

1. Ein Terminal öffnen (PowerShell) und in den Projektordner wechseln:
   ```
   cd C:\Users\steph\Projekte\FinanzApp
   ```
2. Server starten:
   ```
   npm start
   ```
3. Im Browser (Chrome oder Edge) öffnen: **http://localhost:8080**
4. Beenden: im Terminal **Strg + C** drücken.

> Falls `npm` nicht gefunden wird: Terminal einmal schließen und neu öffnen
> (Node.js ist installiert, das Terminal kennt es nur noch nicht).

## Weitere Befehle

| Befehl | Was er tut |
|---|---|
| `npm test` | automatische Tests (Beträge, Datum, Migrationen) |
| `npm run icons` | App-Symbole neu erzeugen |

## Ordner

```
index.html, manifest.webmanifest, sw.js   App-Rahmen und PWA-Dateien
server.js                                  lokaler Testserver
css/style.css                              Design (Hell/Dunkel)
js/app.js                                  Start und Tab-Navigation
js/db.js, js/migrationen.js                Datenbank, Versionen, Migrationen
js/format.js                               Euro- und Datumsformat
js/buchungen.js, js/rechnen.js             Buchungsregeln, Kontostände, Monatssummen
js/startdaten.js, js/testdaten.js          Kategorie-Startsatz, Testdaten
js/ui.js, js/dom.js                        Bausteine der Oberfläche
js/views/                                  die Tabs
tests/                                     automatische Tests
tools/                                     Hilfsskripte
```

## Wo liegen die Daten?

Im Moment nur im Browser auf diesem Gerät (IndexedDB). Wer die Browserdaten für
`localhost` löscht, löscht auch die App-Daten. Sync mit Google Drive und Backups
folgen in Etappe 6.
