# Technische Entscheidungen

Hier steht jede wichtige technische Entscheidung mit Begründung, damit spätere
Etappen darauf aufbauen und nichts neu erfunden wird. Neue Einträge unten anhängen.
Wird eine Entscheidung geändert, den alten Eintrag nicht löschen, sondern als
„ersetzt durch Dxx“ markieren.

---

## D01 – Reines HTML/CSS/JavaScript, kein Framework, kein Build-Schritt
*Etappe 1*

- Die App besteht aus normalen Dateien, die der Browser direkt ausführt
  (JavaScript-Module mit `import`/`export`).
- **Warum:** Der Nutzer hat wenig Programmiererfahrung. Ohne Build-Schritt gibt es
  keine Übersetzung, die kaputtgehen kann, und keine Paketabhängigkeiten, die veralten.
  Was im Ordner liegt, ist genau das, was läuft. Für eine Einzelperson-App mit
  vier Tabs reicht das.
- **Folge:** Keine npm-Pakete für die App selbst. Falls später doch eine Bibliothek
  nötig ist (z. B. für Excel-Export), wird sie als einzelne Datei in `js/lib/`
  abgelegt und hier dokumentiert.

## D02 – Node.js nur als Werkzeug (lokaler Server, Tests, Icons)
*Etappe 1*

- `npm start` startet `server.js`, einen kleinen Webserver ohne Zusatzpakete,
  erreichbar nur auf diesem PC (`127.0.0.1:8080`).
- `npm test` führt die automatischen Tests aus (eingebauter Node-Testrunner).
- `npm run icons` erzeugt die PNG-App-Symbole neu.
- **Warum:** Eine PWA (Service Worker, IndexedDB) läuft nur über `http://localhost`
  oder `https://`, nicht per Doppelklick auf die Datei. Der Nutzer hat sich für
  Node.js entschieden.

## D03 – Geldbeträge in Cent als ganze Zahl
*Etappe 1*

- Intern: `123456` = 1.234,56 €. Felder heißen `…Cent` (z. B. `anfangssaldoCent`).
- **Warum:** Kommazahlen rechnen im Computer ungenau (0,1 + 0,2 ≠ 0,3).
  Ganze Cent-Beträge sind exakt.
- Umrechnung nur an der Oberfläche: `parseEuro()` (Eingabe → Cent) und
  `formatEuro()` (Cent → „1.234,56 €“) in `js/format.js`.
- `parseEuro` versteht „1.234,56“, „1234,56“, „-50“, „12,5“, „1234.56“, „1.234“ (= 1234 €).
  Ein Punkt gefolgt von genau drei Ziffern gilt als Tausenderpunkt.

## D04 – Datum intern als Text „JJJJ-MM-TT“
*Etappe 1*

- Gespeichert wird z. B. `"2026-03-01"`, angezeigt wird „01.03.2026“.
- **Warum:** Ohne Uhrzeit und Zeitzone gibt es keine Verschiebungen um einen Tag.
  Texte in diesem Format lassen sich direkt sortieren und vergleichen.
- Eingabe über `<input type="date">`, das der Browser in deutscher Schreibweise zeigt.
- Zeitstempel (`erstelltAm`, `geaendertAm`) sind ISO-Zeitpunkte mit Uhrzeit (UTC).
  Sie dienen später dem Sync.

## D05 – IDs sind zufällige UUIDs
*Etappe 1*

- `crypto.randomUUID()`, z. B. `"3f2a…"`.
- **Warum:** Zwei Geräte können offline Datensätze anlegen, ohne dass IDs kollidieren.
  Das ist wichtig für den späteren Drive-Sync.

## D06 – Zwei Versionsnummern: DB-Struktur und Datenmodell
*Etappe 1*

- `DB_STRUKTUR_VERSION` (`js/db.js`) legt fest, welche IndexedDB-„Schubladen“
  (Object Stores) es gibt. Sie wird erhöht, wenn eine neue Schublade dazukommt, z. B. `buchungen`
  in Etappe 2. `onupgradeneeded` legt fehlende Schubladen an und löscht nie etwas.
- `DATENMODELL_VERSION` (`js/migrationen.js`) legt fest, wie die Datensätze aufgebaut sind.
  Sie wird im Store `meta` unter `datenVersion` gespeichert und später auch in der Drive-JSON-Datei.
- **Warum getrennt:** Die Drive-Datei kennt keine IndexedDB-Schubladen, braucht aber eine
  Datenversion.

## D07 – Migrationen als reine Funktionen auf einem Datenstand-Objekt
*Etappe 1*

- Ein Datenstand ist ein einfaches Objekt: `{ version, konten: [...], kategorien: [...] }`.
- Jede Migration ist ein Schritt `{ nach: N, beschreibung, migriere(daten) }`.
  `migriereDaten()` führt alle fehlenden Schritte der Reihe nach aus (1→2→3 …).
- Beim Start: Ist die gespeicherte Version älter, wird der ganze Datenstand gelesen, migriert
  und in **einer** Transaktion zurückgeschrieben (alles oder nichts).
- Ist die gespeicherte Version **neuer** als die App, bricht die App mit einer Meldung ab
  und verändert nichts.
- **Warum:** Dieselbe Funktion kann später auch die JSON-Datei aus Google Drive migrieren.
  Reine Funktionen lassen sich mit `npm test` prüfen.
- **Anleitung für neue Etappen:** `DATENMODELL_VERSION` um 1 erhöhen, einen Schritt in
  `MIGRATIONEN` ergänzen, in `tests/daten.test.js` einen Test dazu schreiben. Neue
  Sammlungen zusätzlich in `SAMMLUNGEN` (db.js) eintragen und `DB_STRUKTUR_VERSION` erhöhen.

## D08 – Datenmodell Konto (Datenversion 1)
*Etappe 1*

```js
{
  id, name,
  anfangssaldoCent,      // Pflicht, darf negativ sein (z. B. Kreditkarte, Dispo)
  stichtag,              // "JJJJ-MM-TT", Anfangssaldo gilt an diesem Tag
  mindestsaldoCent,      // optional (null = keine Warnung), darf negativ sein
  archiviert,            // true = ausgeblendet, wiederherstellbar
  erstelltAm, geaendertAm,
  testdaten?             // nur bei Testdaten: true
}
```
- Kontonamen sind eindeutig, Groß-/Kleinschreibung zählt dabei nicht.

## D09 – Datenmodell Kategorie (Datenversion 1)
*Etappe 1*

```js
{
  id, name,
  elternId,      // null = Hauptkategorie, sonst ID der Hauptkategorie
  art,           // nur Hauptkategorie: 'einnahme' | 'ausgabe'; Unterkategorie: null
  archiviert, erstelltAm, geaendertAm, testdaten?
}
```
- Haupt- und Unterkategorien liegen zusammen in **einer** Sammlung, verknüpft über `elternId`.
  Es gibt genau zwei Ebenen.
- **Art nur an der Hauptkategorie** (Entscheidung des Nutzers). Unterkategorien erben sie,
  so kann es keine widersprüchlichen Angaben geben.
- Eine Unterkategorie kann in eine andere Hauptkategorie verschoben werden (Bearbeiten-Dialog).
- Namen: Hauptkategorien sind untereinander eindeutig, Unterkategorien innerhalb ihrer
  Hauptkategorie.
- Gebucht wird (ab Etappe 2) immer auf eine Unterkategorie, Budgets gelten je
  Hauptkategorie (siehe CLAUDE.md). Hat eine Hauptkategorie keine Unterkategorie, zeigt die
  App einen Hinweis.
- Der Startsatz steht in `js/startdaten.js` und wird nur beim allerersten Start angelegt.

## D10 – Archivieren und Löschen
*Etappe 1*

- **Archivieren** blendet aus und lässt sich rückgängig machen. Das ist der empfohlene Weg.
- **Löschen** entfernt endgültig, aber nur nach einer Rückfrage. Beim Löschen einer
  Hauptkategorie werden ihre Unterkategorien mitgelöscht.
- **In Etappe 2 umgesetzt (D22):** Löschen eines Kontos oder einer Kategorie sperren, sobald
  Buchungen daran hängen (dann nur Archivieren). Entscheidung des Nutzers.
- Der Papierkorb aus CLAUDE.md gilt für **Buchungen** (Etappe 2), nicht für Stammdaten.

## D11 – Testdaten über eine Markierung
*Etappe 1*

- Testdatensätze tragen `testdaten: true` und „(Test)“ im Namen.
- „Testdaten löschen“ entfernt genau diese Datensätze sowie Unterkategorien unter einer
  Test-Hauptkategorie. Eigene Einträge bleiben erhalten.
- Alle Testwerte sind frei erfunden.

## D12 – Hell/Dunkel-Modus
*Etappe 1*

- Alle Farben sind CSS-Variablen in `css/style.css`. `data-theme="hell" | "dunkel"`
  am `<html>`-Element schaltet um.
- Die Wahl wird in `localStorage` (`finanzapp-theme`) gespeichert, nicht in IndexedDB.
  **Warum:** Das ist eine Geräte-Einstellung und keine Finanzdaten. Sie muss *vor* dem
  Zeichnen der Seite synchron lesbar sein (`js/theme.js` im `<head>`), sonst blitzt
  kurz das falsche Design auf. Sie wird bewusst nicht mit Drive synchronisiert.
- Ohne gespeicherte Wahl gilt die Systemeinstellung.

## D13 – Navigation per Adress-Anker (#)
*Etappe 1*

- Die Tabs sind `#uebersicht`, `#buchungen`, `#annahmen`, `#stammdaten`.
- **Warum:** Das funktioniert ohne Server-Konfiguration auf GitHub/Cloudflare Pages.
  Die Zurück-Taste des Browsers und Lesezeichen funktionieren ebenfalls.
- Handy (< 768 px Breite): Tab-Leiste unten. PC: Tabs oben in der Kopfzeile.
- Achtung: `backdrop-filter` an der Kopfzeile ist auf dem Handy abgeschaltet, weil die
  feste Tab-Leiste sonst an der Kopfzeile statt am Bildschirmrand klebt.

## D14 – Service Worker „Netz zuerst“
*Etappe 1*

- `sw.js` holt jede Programmdatei zuerst aus dem Netz und nur ohne Netz aus dem Cache.
- **Warum:** Neue Programmversionen kommen sofort an, ohne Cache-Ärger beim Entwickeln.
  Offline läuft die App trotzdem.
- Der Cache enthält **nur Programmdateien, nie Finanzdaten**.
- **Pflege:** Neue JS/CSS-Dateien in `APP_DATEIEN` (sw.js) eintragen. Bei größeren Updates
  `CACHE` umbenennen (z. B. `finanzapp-v2`), dann werden alte Caches gelöscht.

## D15 – Oberfläche ohne innerHTML
*Etappe 1*

- Elemente werden mit dem Helfer `h()` (`js/dom.js`) gebaut. Texte werden immer als Text
  eingefügt.
- **Warum:** Ein Kontoname wie `<script>` kann so keinen Schaden anrichten.

## D16 – Installierbarkeit
*Etappe 1*

- `manifest.webmanifest` mit PNG-Icons 192/512 und einem „maskable“-Icon für Android.
  Die Icons erzeugt `tools/icons-erzeugen.js`.
- Auf Android installierbar ist die App erst, wenn sie über **https** im Netz liegt
  (GitHub/Cloudflare Pages). Am PC unter `localhost` ist sie schon jetzt installierbar.

---

# Etappe 2

## D17 – Datenmodell Version 2: Buchungen und Abstimmungen
*Etappe 2*

- Neue Sammlungen `buchungen` und `abstimmungen`. Dafür `DB_STRUKTUR_VERSION` = 2 und
  `DATENMODELL_VERSION` = 2. Die Migration 1 → 2 ergänzt nur leere Listen.
  Sie wurde im Browser mit einem echten Datenstand aus Etappe 1 geprüft.
- Datensatz Buchung (Details in `js/buchungen.js`):
  ```js
  { id, datum, betragCent /* immer > 0 */, art /* 'einnahme'|'ausgabe'|'umbuchung' */,
    kontoId, kategorieId /* Unterkategorie, bei Umbuchung null */,
    notiz, status /* 'gebucht'|'vorgemerkt' */, belege: [],
    umbuchungId, richtung /* 'ab'|'zu' */, gegenkontoId,   // nur Umbuchung
    geloeschtAm /* null = aktiv */, erstelltAm, geaendertAm, testdaten? }
  ```
- **Betrag immer positiv, die Art bestimmt die Richtung.** Ein Minus wird bei der Eingabe
  abgelehnt. Das verhindert doppelte Vorzeichen-Verwirrung.
- Die Art steht an der Buchung selbst, nicht nur an der Kategorie. Wird eine Kategorie später
  umgestellt, bleiben alte Buchungen dadurch richtig.
- `belege` ist ein leeres Feld als Vorbereitung. Anhängen ist erst mit Drive möglich
  (Etappe 6, Entscheidung des Nutzers).

## D18 – Status: „gebucht“ / „vorgemerkt“
*Etappe 2 – Entscheidung des Nutzers*

- Das ist wie bei der Bank: „vorgemerkt“ heißt noch nicht abgebucht (z. B. Kartenzahlung).
  Standard ist „gebucht“.
- Vorgemerkte Buchungen **zählen** zum Kontostand. In der Übersicht und bei der
  Abstimmung wird ihre Summe extra ausgewiesen.

## D19 – Stichtag-Regel
*Etappe 2 – Entscheidung des Nutzers*

- Der Anfangssaldo ist der Stand **zu Beginn** des Stichtags. Buchungen ab dem Stichtag
  (einschließlich) verändern ihn.
- Buchungen vor dem Stichtag werden mit einer Meldung abgelehnt. Bei Umbuchungen gilt das
  für beide Konten.
- Den Stichtag eines Kontos kann man nicht hinter die früheste Buchung verschieben.

## D20 – Umbuchung = zwei verknüpfte Datensätze
*Etappe 2*

- Eine Hälfte „ab“ (Von-Konto) und eine Hälfte „zu“ (Auf-Konto) mit gemeinsamer `umbuchungId`.
  Jede Hälfte zeigt über `gegenkontoId` auf das andere Konto.
- Bearbeiten, Papierkorb, Wiederherstellen und endgültiges Löschen betreffen **immer beide
  Hälften** (`gruppeVon()`).
- In Monatssummen erscheinen Umbuchungen in einer eigenen Zeile „Umbuchungen (saldiert)“,
  nie bei Einnahmen oder Ausgaben.
- Beim Bearbeiten lässt sich eine Umbuchung nicht in eine normale Buchung umwandeln und
  umgekehrt auch nicht. Dafür löscht man sie und legt sie neu an. Das hält die Logik einfach.

## D21 – Papierkorb über das Feld `geloeschtAm`
*Etappe 2*

- „Löschen“ setzt nur `geloeschtAm` (Zeitpunkt). Die Buchung zählt dann nirgends mehr mit.
- Wiederherstellen und endgültig löschen gehen unter **Stammdaten → Papierkorb**.
  Der Papierkorb leert sich nie automatisch.
- **Warum ein Feld statt einer eigenen Sammlung:** Das Verschieben zwischen zwei Sammlungen
  wäre fehleranfälliger. Für den späteren Sync ist eine Änderung an einem Feld ebenfalls einfacher.

## D22 – Löschsperre für Konten und Kategorien
*Etappe 2 (siehe D10)*

- Hängt mindestens eine Buchung daran, ist Löschen gesperrt. Gezählt werden auch Buchungen
  im Papierkorb, sonst gäbe es beim Wiederherstellen Buchungen ohne Konto.
- Die App erklärt das und bietet direkt „Stattdessen archivieren“ an.

## D23 – Monatsansicht
*Etappe 2 – Entscheidung des Nutzers: Konten umschaltbar*

- Oben stehen Kontoknöpfe. Das gewählte Konto merkt sich das Gerät (`localStorage`, wie D12).
- Man blättert monatsweise mit ‹ ›. Der früheste Monat ist der Monat des Stichtags, der
  späteste der aktuelle Monat oder der Monat der spätesten erfassten Buchung.
  Zukunftsprognosen kommen in Etappe 5.
- Zwischensummen: Stand am Monatsanfang (oder Anfangssaldo am Stichtag), Einnahmen,
  Ausgaben, Umbuchungen, Stand am Monatsende.
- Buchungen nach Tagen, **neueste zuerst** (Tage absteigend, innerhalb eines Tages die zuletzt
  erfasste oben; Wunsch des Nutzers). Je Tag steht der Kontostand am Ende dieses Tages.
  Ein Klick auf eine Buchung öffnet sie zum Bearbeiten.
- Die Rechenlogik steht in `js/rechnen.js` (reine Funktionen, getestet).
- Archivierte Konten erscheinen nicht in der Übersicht.

## D24 – Erfassen
*Etappe 2*

- Ein runder „+“-Knopf ist auf jedem Tab sichtbar.
- Reihenfolge im Dialog: Art, **Betrag**, **Kategorie**, Konto, Datum, Status, Notiz.
  Datum ist standardmäßig heute. Als Konto wird das zuletzt benutzte vorgeschlagen
  (`localStorage`, nur Komfort).
- Die Kategorieauswahl zeigt nur Unterkategorien passend zur Art, gruppiert nach
  Hauptkategorie. Archivierte Kategorien erscheinen nicht, außer beim Bearbeiten
  die bisher gewählte.
- Vorlagen für häufige Buchungen gibt es noch nicht (siehe CLAUDE.md „Komfort“, noch keiner
  Etappe zugeordnet).

## D25 – Kontoabstimmung
*Etappe 2*

- Man gibt den Bankstand und das Datum ein. Die App vergleicht ihn mit ihrem Stand am Ende
  dieses Tages und zeigt die Differenz. Gibt es vorgemerkte Buchungen, zeigt sie zusätzlich
  die Differenz ohne diese.
- Jede Abstimmung wird gespeichert (`abstimmungen`: kontoId, datum, bankstandCent,
  berechnetCent, erstelltAm).
- Die Differenz der letzten Abstimmung wird in der Übersicht **immer neu berechnet**. Trägt man
  die fehlende Buchung nach, springt sie auf „stimmt ✓“.
- Die App legt **keine** automatische Korrekturbuchung an, denn sie ändert nie selbst etwas.

## D26 – Daten-Änderungs-Signal
*Etappe 2*

- Nach jedem Speichern ruft man `datenGeaendert()` (ui.js) auf. `app.js` zeichnet dann den
  aktuellen Tab neu, ohne nach oben zu springen. So bleiben Ansichten aktuell, egal wo der
  Dialog geöffnet wurde.
