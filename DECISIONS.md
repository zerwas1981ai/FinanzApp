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

---

# Etappe 3

## D27 – Filter- und Auswertungslogik in `js/auswertung.js`
*Etappe 3*

- Reine Funktionen (`filtere`, `sortiere`, `summen`, `verlaufJeMonat`,
  `summenJeKategorie`, `zeitraumFuer` …), mit `tests/auswertung.test.js` geprüft.
- Am Datenmodell ändert sich nichts, deshalb gibt es keine Migration. Die Datenversion bleibt 2.
- Der Filterzustand gilt nur, solange die App offen ist. Nach dem Neuladen ist wieder
  „Dieser Monat“ eingestellt (Entscheidung des Nutzers).

## D28 – Filter
*Etappe 3*

- Zeitraum mit Schnellwahl: dieser Monat, Vormonat, dieses Jahr, Vorjahr, alles oder
  eigener Zeitraum (von/bis einzeln möglich).
- Weitere Filter: Konto, Art, Kategorie (eine Hauptkategorie umfasst alle ihre
  Unterkategorien), Status, Betrag von/bis (immer der positive Betrag), Suche.
- Die Suche ignoriert Groß- und Kleinschreibung. Sie durchsucht Notiz, Unter- und
  Hauptkategorie sowie die Namen von Konto und Gegenkonto.
- Der Filter „ohne Beleg“ ist eingebaut (`belege` ist leer). Bis Etappe 6 trifft er auf alle
  Buchungen zu, ein Hinweis erklärt das (Entscheidung des Nutzers).
- Buchungen im Papierkorb erscheinen nie.

## D29 – Umbuchungen in Liste und Summen
*Etappe 3 – Entscheidung des Nutzers: eine Zeile pro Umbuchung*

- Ohne Kontofilter: eine Zeile „Umbuchung A → B“ mit neutralem Betrag (ohne Vorzeichen,
  Wirkung 0).
- Mit Kontofilter: die Hälfte dieses Kontos, mit + oder − aus dessen Sicht. Die Summe der
  Umbuchungen erscheint dann als eigene Kachel.
- Umbuchungen zählen nie zu Einnahmen, Ausgaben, Saldo oder in den Analysen.
- Sortieren nach Betrag nutzt den positiven Betrag. Bei Gleichstand wird immer nach
  Datum und dann nach Erfassungszeit sortiert, in derselben Richtung.
- Die Liste zeigt 200 Zeilen auf einmal, darunter steht „Weitere anzeigen“.

## D30 – Analyse und Diagrammfarben
*Etappe 3 – Entscheidung des Nutzers: alle drei Auswertungen*

- **Verlauf je Monat:** Balkendiagramm mit Einnahmen und Ausgaben je Monat, einer Legende
  und einem Tooltip beim Überfahren oder Antippen (inkl. Saldo). Eine Tabellenansicht ist
  umschaltbar. Leere Monate werden mit 0 gezeigt. Welche Monate erscheinen, regelt
  `monateDerAuswertung` (siehe Ø unten).
- **Nach Kategorien:** Ausgaben oder Einnahmen je Hauptkategorie mit Balken, Betrag und
  Anteil, aufklappbar auf Unterkategorien.
- **Durchschnitt pro Monat (Ø):** Summe geteilt durch die Zahl der **erfassten** Monate
  im Zeitraum (Wunsch des Nutzers):
  - Der Beginn ist der Anfang des Zeitraums, aber nie vor dem ersten Monat mit erfassten
    Buchungen (`ersterErfassterTag`: früheste nicht gelöschte Buchung, bei einem Kontofilter
    nur dieses Kontos). Beispiel: „Dieses Jahr“ mit Daten ab September ergibt September bis
    heute, nicht Januar bis Dezember. Über 12 Monate wird also erst gemittelt, wenn
    12 Monate erfasst sind.
  - Das Ende ist das Ende des Zeitraums, aber nie nach dem aktuellen Monat, außer es gibt
    schon spätere Buchungen.
  - Kategorie- und Suchfilter verschieben den Beginn **nicht**. Eine seltene Kategorie wie
    Urlaub wird über alle erfassten Monate gemittelt, nicht erst ab ihrer ersten Buchung.
  - **Der laufende Monat zählt beim Ø nicht mit** (Wunsch des Nutzers), weil er noch nicht
    vorbei ist und den Schnitt nach unten ziehen würde. Spätere Monate (Buchungen mit
    Zukunftsdatum) zählen ebenfalls nicht. Summe und Anteil enthalten weiterhin alle Monate,
    der Ø nutzt nur Buchungen aus abgeschlossenen Monaten (`abgeschlosseneMonate`).
  - Der Ø wird nur gezeigt, wenn der Zeitraum mehr als einen Monat umfasst und mindestens
    ein Monat abgeschlossen ist. Der Hinweis darunter nennt Anzahl und Spanne der
    abgeschlossenen Monate. Der Monatsverlauf zeigt den laufenden Monat weiterhin an.
- **Farben:** Blau = Einnahmen, Orange = Ausgaben (hell `#2a78d6`/`#eb6834`, dunkel
  `#3987e5`/`#d95926`, CSS-Variablen `--serie-einnahme`/`--serie-ausgabe`).
  **Warum nicht Grün/Rot:** Das Paar ist für Menschen mit Rot-Grün-Sehschwäche kaum
  unterscheidbar (mit einem Prüfskript getestet: durchgefallen). Blau/Orange besteht alle
  Prüfungen im hellen und dunklen Modus. Beträge als Text bleiben wie bisher grün/rot,
  dort steht immer auch ein Vorzeichen.
- Diagramme bestehen aus reinem HTML/CSS, ohne Bibliothek (D01). Es gibt nur eine
  Y-Achse mit einer „runden“ Obergrenze (`schoeneObergrenze`).

## D31 – Kleinkorrektur Euro-Format
*Etappe 3*

- `formatEuro(-0)` zeigte „-0,00 €“. Das ist behoben, jetzt erscheint immer „0,00 €“.

## D32 – Bargeldabhebungen (geändert durch D56)
*Etappe 3 – Entscheidung des Nutzers*

- Eine Bargeldabhebung wird als **Ausgabe** gebucht, mit der Unterkategorie
  „Sonstiges › Bargeldabhebung“. Sie ist im Startsatz enthalten (`js/startdaten.js`).
- Folge: Wofür das Bargeld später ausgegeben wird, erfasst die App nicht. Die bewusst
  verworfene Alternative wäre ein Konto „Bargeld“ mit Umbuchungen. Sie ginge technisch
  weiterhin, ohne Programmänderung.
- In bereits bestehenden Datenständen wird der Startsatz nicht nachträglich ergänzt. Dort legt
  der Nutzer die Unterkategorie selbst an.

---

# Etappe 4

## D33 – Datenmodell Version 3
*Etappe 4*

- Neue Sammlungen: `budgets`, `wiederkehrend`, `hinweise` (Entscheidungen zu Budgethinweisen)
  und `einstellungen` (Schwellen, ein Datensatz `{ id: 'hinweise', monate: 3, prozent: 10 }`).
  Einstellungen sind Nutzerdaten und werden später mit Drive abgeglichen, deshalb stehen sie
  nicht in `localStorage`.
- Buchungen bekommen `wiederkehrendId` und `faelligAm`, die Verknüpfung mit einem Termin.
- `DB_STRUKTUR_VERSION` = 3, `DATENMODELL_VERSION` = 3. Die Migration 2 → 3 ergänzt leere
  Sammlungen, die Standard-Einstellungen und die neuen Buchungsfelder (`null`). Das wurde im
  Browser mit einem echten Stand der Version 2 geprüft.
- Feldbeschreibungen: `js/annahmen.js` (Budget, wiederkehrende Buchung) und `js/buchungen.js`.

## D34 – Budgets
*Etappe 4*

- Budgets gibt es nur für **Ausgaben-Hauptkategorien**. Alle Buchungen der
  Unterkategorien verbrauchen sie, ein Rest verfällt am Monatsende (CLAUDE.md).
- **Wiederkehrend:** gilt ab einem Startmonat, optional bis zu einem Endmonat. Spätere
  Betragsänderungen werden als „Stufen“ `{ ab: 'JJJJ-MM', betragCent }` gespeichert. Pro
  Hauptkategorie gibt es höchstens **ein** wiederkehrendes Budget, Änderungen laufen über
  Stufen.
- **Einmalig:** gilt für genau einen Monat und kommt zum wiederkehrenden Budget hinzu
  (Zusatzbudget, z. B. Weihnachten).
- **Belastetes Konto** (Entscheidung des Nutzers): Jedes Budget hat ein Konto. Der offene
  Budgetrest wird in der Prognose von diesem Konto abgezogen. Vorbelegt ist das Konto, auf
  dem die Kategorie am häufigsten gebucht wird. Bei mehreren Budgets im Monat zählt das Konto
  des wiederkehrenden.
- Monatsfelder nutzen `<input type="month">` (Chrome/Edge/Android). Firefox zeigt dort nur
  ein Textfeld. Laut CLAUDE.md sind Windows-Browser und Android vorgesehen.

## D35 – Prognose für den laufenden Monat
*Etappe 4 – Entscheidung des Nutzers: „Budget umfasst alles“*

- Je Ausgaben-Hauptkategorie gilt:
  `Prognose = mit Budget: max(Budget, Ist + offene wiederkehrende) · ohne Budget: Ist + offene`.
  Das erfüllt die CLAUDE.md-Regel „echte Buchungen + offener Budgetrest, mindestens die echten
  Buchungen“. Auch Fixkosten wie die Miete verbrauchen das Budget ihrer Kategorie, und es wird
  nichts doppelt gezählt.
- `Rest = max(0, Budget − Ist − offene wiederkehrende)`.
- Je Konto: `Stand Monatsende aus echten Buchungen + offene Termine (Wirkung auf dieses Konto,
  inkl. überfälliger aus dem Vormonat) − Budgetreste, die dieses Konto belasten`.
- Gesamt = Summe der aktiven (nicht archivierten) Konten.
- Prognosewerte sind **kursiv** und mit „Annahme“ markiert (CLAUDE.md: Zukunftswerte klar
  als Annahme kennzeichnen).
- Die Rechenlogik steht in `js/prognose.js` (reine Funktionen, `tests/prognose.test.js`).

## D36 – Wiederkehrende Buchungen und Fällig-Liste
*Etappe 4 – Entscheidung des Nutzers: Fällig-Liste mit Ein-Klick-Buchen*

- Arten: Einnahme, Ausgabe oder Umbuchung. Intervall monatlich, vierteljährlich oder
  jährlich. Der Tag des ersten Termins gilt für alle Termine. Gibt es den Tag in einem Monat
  nicht (z. B. den 31.), gilt der Monatsletzte.
- Wertänderungen sind Stufen `{ ab: 'JJJJ-MM-TT', betragCent }`. Ausnahmen pro Termin:
  `ueberspringen` oder `verschieben` (mit `neuesDatum`). Ein Termin wird über sein
  **reguläres** Datum erkannt (`termin`), auch wenn er verschoben wurde.
- **Es entsteht nie automatisch eine Buchung.** Offene Termine erscheinen in der Übersicht
  unter „Fällige wiederkehrende Buchungen“, bis 7 Tage im Voraus. Es gibt drei Knöpfe:
  - **Buchen** öffnet den vorausgefüllten Buchungsdialog. Die gespeicherte Buchung trägt
    `wiederkehrendId` und `faelligAm`, damit ist der Termin erledigt.
  - **Verschieben** verschiebt nur diesen Termin.
  - **Überspringen** ist auch für den Fall gedacht, dass man schon von Hand gebucht hat.
    Rückgängig machen kann man das im Bearbeiten-Dialog unter Annahmen („Zurücknehmen“).
- Beobachtet wird ab dem Anfang des Vormonats, aber nie vor dem Monat, in dem die
  wiederkehrende Buchung angelegt wurde, und nie vor dem Stichtag der Konten. Wer eine
  wiederkehrende Buchung mit Start in der Vergangenheit anlegt, bekommt also keine Flut alter
  „fälliger“ Termine.
- Wird eine verknüpfte Buchung gelöscht (Papierkorb), ist der Termin wieder offen.

## D37 – Verwaltung im Tab „Annahmen“
*Etappe 4 – Entscheidung des Nutzers*

- Budgets und wiederkehrende Buchungen werden schon jetzt im Tab „Annahmen“ verwaltet.
  Etappe 5 ergänzt dort die Zeitleiste bis 2050, geplante Einmalbuchungen und den
  Szenario-Schalter.
- Löschen ist nach einer Rückfrage endgültig. Das sind Annahmen, keine Buchungen, deshalb
  gibt es keinen Papierkorb. Bereits gebuchte Buchungen bleiben beim Löschen einer
  wiederkehrenden Buchung erhalten.
- Die Löschsperre (D22) zählt jetzt auch Budgets und wiederkehrende Buchungen, die an einem
  Konto oder einer Kategorie hängen.

## D38 – Budgethinweise
*Etappe 4*

- Betrachtet werden die letzten N **abgeschlossenen** Monate (Standard 3). Ein Hinweis
  entsteht, wenn die Kategorie in **jedem** dieser Monate ein Budget hatte und jedes Mal
  darüber (oder jedes Mal darunter) lag, und wenn die durchschnittliche relative Abweichung
  größer als P % ist (Standard 10 %). N und P sind unter Stammdaten einstellbar (2–12 Monate,
  1–100 %).
- Ausgewertet wird erst, wenn für das ganze Zeitfenster Buchungen erfasst sind.
- **Vorschlag:** Durchschnitt der Ist-Ausgaben im Fenster, auf 10 € gerundet (mindestens 10 €).
- Die Karten sind ruhig (kein Pop-up), es erscheinen höchstens 2, die mit der stärksten
  Abweichung zuerst. Sie stehen in der Übersicht unter den Kennzahlen.
- Knöpfe:
  - **Übernehmen ab** (nächster, dieser oder übernächster Monat): Beim wiederkehrenden
    Budget kommt eine Stufe dazu. Gibt es keins, entsteht eins.
  - **Ablehnen.**
  - **Später erinnern** (in 7 Tagen).
  Jede Entscheidung wird in `hinweise` gespeichert. Die App ändert nie selbst ein Budget.
- **Unterdrückung:** Nach „Übernehmen“ oder „Ablehnen“ erscheint für diese Kategorie erst
  wieder ein Hinweis, wenn das neue Fenster sich nicht mehr mit dem entschiedenen
  überschneidet (also nach N neuen Monaten). Sonst käme derselbe Hinweis jeden Monat wieder,
  weil die alten Monate weiter im Fenster liegen.

## D39 – Kennzahlen in der Übersicht
*Etappe 4*

- Ganz oben stehen folgende Kennzahlen:
  - Gesamtstand heute und die Prognose zum Monatsende über alle aktiven Konten
  - Einnahmen, Ausgaben und Saldo des Monats (ohne Umbuchungen)
  - die größte Ausgabenkategorie
  - Budgetauslastung der bis zu 4 größten Budgets, mit Balken. Ist ein Budget überschritten,
    wird das mit Warnfarbe **und** dem Text „überschritten um …“ gezeigt.
- **Mindestsaldo-Warnung** je Konto: Sie erscheint, wenn der Stand heute oder die Prognose zum
  Monatsende unter dem Mindestsaldo liegt. Den „ersten betroffenen Zukunftsmonat“ nennt sie
  erst ab Etappe 5, wenn die Zeitleiste bis 2050 kommt.
- Der Kontokopf zeigt zusätzlich die Prognose zum Monatsende für das gewählte Konto.

## D40 – Testdaten Etappe 4
*Etappe 4*

- Die Testdaten umfassen drei abgeschlossene Monate und den laufenden Monat. Der Stichtag ist
  der Anfang des drittletzten Monats.
- Neun wiederkehrende Buchungen: Gehalt, Sparrate, Miete (mit Erhöhung ab Januar), Strom,
  Internet, Streaming, Ausgleich Kreditkarte, Rundfunkbeitrag (vierteljährlich) und
  Kfz-Versicherung (jährlich). Die passenden Testbuchungen sind mit ihnen verknüpft.
  „Internet & Telefon“ ist im laufenden Monat absichtlich **nicht** gebucht und erscheint
  deshalb als fällig.
- Budgets: Lebensmittel 150 € (deutlich über), Freizeit 100 € (deutlich unter), Mobilität
  60 € und Wohnen 1.100 € (knapp, daher kein Hinweis). Dazu ein einmaliges Budget Sonstiges
  im nächsten Monat. So erscheinen genau zwei Budgethinweise.
- „Testdaten löschen“ entfernt auch Test-Budgets, wiederkehrende Testbuchungen und
  Hinweis-Entscheidungen zu deren Kategorien.

## D41 – Übersicht umgebaut: Budgets und wiederkehrende Buchungen je Konto, kompakteres Design
*Etappe 4 – Wunsch des Nutzers nach dem ersten Test (ersetzt Teile von D36 und D39)*

- **Oben** steht nur noch eine kompakte Kennzahlen-Leiste: alle Konten heute, Prognose zum
  Monatsende (Annahme), Einnahmen und Ausgaben des Monats und die größte
  Ausgabenkategorie. Darunter folgen die Mindestsaldo-Warnung und die Budgethinweise (kompakt,
  ohne Tabelle). Budgetbalken und die Fällig-Liste stehen nicht mehr oben.
- **Je Konto**, nur im laufenden Monat:
  - **Zwischensummen** mit Aufschlüsselung der Prognose: Stand nach erfassten Buchungen,
    noch offene wiederkehrende Buchungen, noch offener Budgetrest und daraus die Prognose
    zum Monatsende. Die Annahmen stehen kursiv.
  - **„Noch erwartet bis Monatsende“** listet die offenen Termine dieses Kontos (inkl.
    überfälliger). Ein Klick öffnet einen kleinen Dialog mit Buchen, Verschieben und
    Überspringen. Darunter stehen die Budgets, die dieses Konto belasten (D34), mit Balken
    und ihrem Rest in der Prognose.
- Eine Umbuchung erscheint bei beiden Konten, jeweils mit ihrer Wirkung (− bzw. +).
- Die Kontoknöpfe zeigen die Zahl der fälligen Termine (bis 7 Tage im Voraus). So geht auf
  anderen Konten nichts verloren.
- `monatsprognose().jeKonto` liefert dafür je Konto: `endeEcht`, `offenWirkung`, `rest`,
  `termine`, `budgets`.
- **Kompakteres Design:** Grundschrift 15 statt 16 px (`html { font-size: 93.75% }`, alle
  rem-Werte schrumpfen mit), dazu kleinere Abstände in Karten, Listen, Knöpfen und
  Eingabefeldern. Eingabefelder sind 40 px hoch, Knöpfe 36 px. Das ist auf dem Handy weiterhin
  gut zu treffen.

## D42 – Feinschliff Übersicht und Monatsletzter
*Etappe 4 – Wünsche des Nutzers nach dem zweiten Test (ergänzt D36, D41)*

- **Drei frei wählbare Kategorien** statt „größte Ausgabenkategorie“: In der Kennzahlen-Leiste
  stehen drei Auswahllisten (alle aktiven Hauptkategorien, Einnahmen und Ausgaben) mit dem
  Betrag des laufenden Monats und, falls vorhanden, dem Budget. Die Wahl wird in
  `einstellungen` gespeichert (`{ id: 'uebersicht', kategorien: [id, id, id] }`), damit sie
  später über Drive auf allen Geräten gleich ist. Ohne gespeicherte Wahl oder bei
  archivierten Kategorien werden die Plätze mit den größten Ausgaben-Hauptkategorien des
  Monats gefüllt (`kennzahlKategorien` in `js/prognose.js`).
- Die Marke „Annahme“ unter „Prognose Monatsende“ ist entfernt. Die Prognose bleibt kursiv.
- Der Bereich „Noch erwartet bis Monatsende“ steht jetzt **unter** den Buchungen des Kontos.
- **Fehler behoben:** Zwischen „Übersicht“ und „Konten“ stand das Wort „null“, wenn kein
  Budgethinweis vorlag. `replaceChildren` schreibt `null` als Text, deshalb werden leere
  Bereiche jetzt vorher herausgefiltert.
- **Monatsletzter als Standard:** Wiederkehrende Buchungen haben das neue Feld
  `monatsletzter` (fehlt = `false`, deshalb ist keine Migration nötig). Ist es `true`,
  liegt **jeder** Termin am letzten Tag seines Monats (30.11., 31.12., 28.02. …), und der Start
  wird auf den Monatsletzten gesetzt.
  - Im Dialog ist „Immer am Monatsletzten“ bei neuen Einträgen vorausgewählt, und der erste
    Termin steht auf dem Monatsende des aktuellen Monats.
  - Wählt man bewusst ein anderes Datum, wird das Häkchen automatisch entfernt.
  - Bestehende Einträge (auch die Testdaten mit festen Tagen wie Gehalt am 1.) bleiben
    unverändert.

## D43 – Monatsansicht zeigt standardmäßig die letzten 10 Buchungen
*Etappe 4 – Wunsch des Nutzers*

- Je Konto und Monat erscheinen zunächst nur die **letzten 10 Buchungen** (neueste zuerst,
  Tagesköpfe mit Kontostand bleiben). Darüber steht „Letzte 10 von N Buchungen“.
- Der Knopf „Alle N Buchungen von <Monat> anzeigen“ zeigt den ganzen Monat, „Nur die letzten
  10 anzeigen“ klappt wieder zu. Die Zwischensummen gelten immer für den ganzen Monat.
- Die Einstellung gilt nur für das gerade gezeigte Konto und den gezeigten Monat. Beim
  Wechsel von Konto oder Monat sind es wieder 10. Die Zahl steht als `MAX_BUCHUNGEN` in
  `js/views/uebersicht.js`.

---

# Etappe 5

## D44 – Datenmodell Version 4
*Etappe 5*

- Neue Sammlungen: `geplant` (geplante Einmalbuchungen) und `szenarien`.
- Budgets und wiederkehrende Buchungen bekommen `aktiv` (Ein/Aus-Schalter, Standard `true`)
  und `szenarioId` (oder `null`). Wiederkehrende Buchungen bekommen außerdem das Feld
  `monatsletzter` (D42) jetzt verbindlich mit `false`, falls es fehlt.
- Buchungen bekommen `geplantId`, die Verknüpfung zur erledigten geplanten Einmalbuchung.
- `DB_STRUKTUR_VERSION` = 4, `DATENMODELL_VERSION` = 4. Die Migration 3 → 4 ist im Browser
  mit einem echten Stand der Version 3 geprüft.

## D45 – Geplante Einmalbuchungen und Soll/Ist-Abgleich
*Etappe 5 – Entscheidung des Nutzers: wie bei wiederkehrenden Buchungen*

- Datensatz: `bezeichnung, art, kontoId, gegenkontoId, kategorieId, datum, betragCent,
  erledigtAm, aktiv, szenarioId` (Details in `js/annahmen.js`).
- **Erledigt** ist sie, wenn eine nicht gelöschte Buchung mit `geplantId` auf sie zeigt
  („Buchen“) oder `erledigtAm` gesetzt ist („Schon gebucht“). Erst dann zählt sie nicht mehr.
  Weicht der echte Betrag ab, ist das kein Problem, denn es zählt die echte Buchung.
  Wird die verknüpfte Buchung gelöscht, ist die Planung wieder offen.
- Offene geplante Buchungen erscheinen beim Konto unter „Noch erwartet“ (Marke „einmalig“),
  sobald sie im laufenden Monat liegen oder überfällig sind. Sie verschwinden **nie** still,
  auch nicht, wenn das Datum lange vorbei ist. Knöpfe: Buchen, Verschieben (ändert das
  Datum) und Schon gebucht. Im Annahmen-Tab lässt sich das über „Wieder als offen markieren“
  rückgängig machen.
- Sie verbrauchen das Budget ihrer Kategorie wie jede Buchung („Budget umfasst alles“).
- Im Annahmen-Tab stehen erledigte unter „Erledigte anzeigen“ (zugeklappt).

## D46 – Szenarien „Was wäre wenn“ (ersetzt durch D51)
*Etappe 5 – Entscheidung des Nutzers: benannte Gruppen + Einzelschalter. Nach dem Test wieder entfernt, siehe D51.*

- Ein Szenario ist eine benannte Gruppe `{ id, name, aktiv }`. Budgets, wiederkehrende und
  geplante Buchungen können einem Szenario zugeordnet werden (Feld „Szenario“ im Dialog).
  Neue Szenarien sind ausgeschaltet.
- **Zählt ein Posten?** (`wirksam()` in `js/prognose.js`) Ist sein eigener Schalter aus, zählt
  er nicht. Ohne Szenario zählt er immer. Mit Szenario zählt er nur, wenn das Szenario
  eingeschaltet ist.
- Die Übersicht rechnet überall (Kennzahlen, Monatsprognose, Hinweise, Zeitleiste) nur mit
  wirksamen Posten (`nurWirksam()`).
- **Vergleich:** Ist mindestens ein Szenario mit Posten eingeschaltet, rechnet die App die
  Zeitleiste zusätzlich ohne Szenarien. Sie zeigt dann den Unterschied am Ende 2050 und je
  Jahres- oder Monatszeile („Szenario −10.250 €“).
- Ein Posten mit eigenem Schalter „aus“ zählt auch in der Basis nicht. Der Schalter wirkt
  also immer, nicht nur im Szenario. So lässt sich auch „ohne Gehalt“ durchspielen.
- Beim Löschen eines Szenarios bleiben seine Posten erhalten und gelten danach ohne Szenario.

## D47 – Zeitleiste bis 2050
*Etappe 5 – Entscheidung des Nutzers: je Konto + „Alle Konten“, kursiv + getönt*

- `zeitleiste()` in `js/prognose.js` berechnet jeden Monat nach dem laufenden bis
  **Dezember 2050** (`LETZTER_MONAT`). Startwert ist die Prognose zum Monatsende des
  laufenden Monats (D35).
- Je Monat zählen:
  - echte Buchungen mit Zukunftsdatum
  - Termine der wiederkehrenden Buchungen
  - offene geplante Einmalbuchungen
  - der **Budgetrest** je Hauptkategorie: `max(0, Budget − Ausgaben der Kategorie im Monat)`,
    abgezogen vom Budgetkonto
  Es gibt keine Prozent-Steigerungen und keine Inflation (CLAUDE.md).
- Alle Termine werden einmal für den ganzen Zeitraum erzeugt und nach Monat einsortiert.
  So bleibt die Rechnung über 289 Monate schnell.
- **Darstellung** (unter dem aktuellen Monat des Kontos, nach „Noch erwartet“):
  - Der Rest des laufenden Jahres steht als einzelne Monatszeilen da, jede aufklappbar.
  - Die Folgejahre bis 2050 stehen je in einer Zeile. Aufgeklappt zeigen sie ihre 12
    Monate, und jeder Monat zeigt aufgeklappt seine Posten (Datum, Text, Herkunft, Betrag).
  - Spalten: Zeitraum, Veränderung, Stand am Ende. Einnahmen, Ausgaben und Umbuchungen
    stehen im aufgeklappten Monat.
  - Die Werte stehen kursiv auf dezent getöntem Hintergrund (`--zukunft`).
  - Was aufgeklappt ist, merkt sich die App, solange sie offen ist.
- **„Alle Konten“** ist ein eigener Knopf vor den Konten. Er zeigt den Gesamtstand heute,
  die Prognose zum Monatsende und die Zeitleiste über alle aktiven Konten. Umbuchungen
  zwischen eigenen Konten heben sich dort auf.
- Die Monatsnavigation ‹ › reicht inzwischen bis Dezember 2050 (siehe D55).

## D48 – Mindestsaldo mit erstem betroffenem Monat
*Etappe 5 (ergänzt D39)*

- `mindestsaldoWarnungen()` prüft je Konto in dieser Reihenfolge: heute, Monatsende, dann den
  **ersten Zukunftsmonat**, dessen Endstand unter dem Mindestsaldo liegt. Die Meldung lautet
  dann zum Beispiel: „fällt voraussichtlich erstmals im März 2027 unter den Mindestsaldo“.
- Geprüft wird der Stand am Monatsende, nicht ein Tiefpunkt innerhalb des Monats.
  *Für den laufenden Monat seit D110: der niedrigste erwartete Stand (ohne offene Einnahmen).*

## D49 – Ein/Aus-Schalter in der Annahmen-Liste
*Etappe 5*

- Jede Zeile im Annahmen-Tab hat links ein Häkchen. Ein Klick speichert sofort, ausgeschaltete
  Zeilen erscheinen blass. (Die Szenarien hatten bis D51 ebenfalls so einen Schalter.)
- Die Löschsperre (D22/D37) zählt jetzt auch geplante Einmalbuchungen mit.

## D50 – Testdaten Etappe 5
*Etappe 5*

- Geplant:
  - „Zahnarzt-Rechnung“ in zwei Tagen (erscheint unter „Noch erwartet“)
  - „Autoreparatur“ in zwei Monaten
  - „Steuererstattung“ in fünf Monaten
- (bis D51) Szenario **„Neues Auto (Test)“** (ausgeschaltet) mit „Anzahlung Auto“ (8.000 € in vier
  Monaten) und „Autokredit“ (48 × 250 € zum Monatsletzten). Eingeschaltet senkt es den
  Stand Ende 2050 um genau 20.000 €.
- „Testdaten löschen“ entfernt auch Test-Szenarien und geplante Testbuchungen. Eigene Posten
  eines Test-Szenarios gelten danach ohne Szenario.

## D51 – Projekte statt Szenarien (Datenmodell Version 5)
*Etappe 5 – Wunsch des Nutzers nach dem Test: statt „Was wäre wenn“ ein Tab „Projekte“*

- Die Szenarien (D46) entfallen ganz: kein Szenario-Bereich, kein Feld „Szenario“, kein
  Vergleich „ohne Szenarien“ in der Zeitleiste. **Abweichung von CLAUDE.md** (dort steht noch
  „Szenario-Schalter“) – auf ausdrücklichen Wunsch des Nutzers.
- Die **Ein/Aus-Häkchen** je Posten bleiben (Entscheidung des Nutzers). `wirksam()` prüft nur
  noch `aktiv !== false`.
- Neuer Tab **„Projekte“** zwischen „Alle Buchungen“ und „Annahmen“. Ein Projekt ist
  `{ id, name, rahmenCent (optional), notiz, abgeschlossen }` in der neuen Sammlung `projekte`.
- Zugeordnet werden **echte Buchungen** (`buchung.projektId`, Feld „Projekt“ im
  Buchungsdialog) und **geplante Einmalbuchungen** (`geplant.projektId`). Umbuchungen nie.
  Wiederkehrende Buchungen und Budgets nicht – Projekte sind für Einmalausgaben gedacht.
- **Migration 4 → 5:** Sammlung `projekte` kommt dazu, Buchungen und geplante bekommen
  `projektId: null`. Posten eines *ausgeschalteten* Szenarios werden selbst ausgeschaltet,
  damit sich an der Prognose nichts ändert. Dann werden `szenarioId` und die Szenarien
  gelöscht. Dafür liest die Migration die alte Schublade `szenarien` noch einmal und leert sie
  (`ALTE_SAMMLUNGEN` in `js/db.js`); die leere Schublade bleibt bestehen und stört nicht.
- DB-Struktur Version 5 (neue Schublade `projekte`).

## D52 – Projektausgaben zählen nicht gegen das Monatsbudget
*Entscheidung des Nutzers*

- Buchungen und geplante Einmalbuchungen mit Projekt verbrauchen **kein** Monatsbudget ihrer
  Hauptkategorie – im laufenden Monat (`ausgabenJeHauptkategorie`, Monatsprognose), in der
  Zeitleiste und bei den Budgethinweisen. Sonst würde z. B. der Urlaub das Freizeit-Budget
  sprengen und falsche Hinweise auslösen.
- Die drei frei wählbaren Kategorie-Kacheln oben zeigen die Kategorie ebenfalls **ohne**
  Projektbuchungen, damit der Vergleich mit dem Budget stimmt.
- Kontostand, „Ausgaben des Monats“, Prognose und Zeitleiste enthalten Projektausgaben
  natürlich – das Geld geht ja vom Konto ab.
- Ausnahme zu „Budget umfasst alles“ (D35/D45).

## D53 – Vergangene geplante Einmalbuchungen ausblenden
*Entscheidung des Nutzers: „nur aus den Listen“*

- Im Annahmen-Tab sind nur geplante Einmalbuchungen ab heute sichtbar. Alles mit Datum vor
  heute und alles Erledigte steht zugeklappt unter „Vergangene und erledigte anzeigen“.
- Im Projekte-Tab ebenso: vergangene, noch nicht gebuchte stehen unter „Vergangene, noch nicht
  gebuchte anzeigen“ und sind in der Kachel „Noch geplant“ als „davon … überfällig“ genannt.
- Noch nicht gebuchte vergangene zählen **weiter** in Prognose und Projektsumme und stehen beim
  Konto unter „Noch erwartet“ als überfällig. So verschwindet nichts still.

## D54 – Projekt-Zahlen und Buchen aus der Planung
- `projektZahlen()` in `js/annahmen.js`:
  - **Gebucht (Ist):** alle nicht gelöschten Buchungen des Projekts, auch vorgemerkte.
    Kosten = Ausgaben − Einnahmen (ein Zuschuss mindert die Kosten).
  - **Noch geplant:** eingeschaltete, noch nicht erledigte geplante Einmalbuchungen.
  - **Gesamt** = Ist + noch geplant. **Rest vom Rahmen** = Rahmen − Gesamt (rot, wenn darüber).
- Wird eine Planung gebucht, ersetzt die echte Buchung die Planung (Soll/Ist-Abgleich wie
  D45). Weicht der Betrag ab, steht bei der Buchung „geplant waren …“.
- Neu im Dialog einer offenen geplanten Einmalbuchung: **„Jetzt buchen …“**. Das öffnet den
  vorausgefüllten Buchungsdialog (Datum = geplantes Datum, bei Zukunftsdatum heute). Betrag und
  Datum lassen sich anpassen; das Projekt wird übernommen. So lässt sich auch eine Rechnung
  buchen, die früher kommt als geplant.
- „Schon gebucht“ (unter „Noch erwartet“) verknüpft keine Buchung. Die von Hand erfasste
  Buchung muss man dann selbst dem Projekt zuordnen; der Dialog weist darauf hin.
- Abgeschlossene Projekte stehen zugeklappt unten und sind bei neuen Buchungen nicht mehr
  wählbar. Beim Löschen eines Projekts bleiben seine Buchungen und Planungen erhalten (ohne
  Projekt, sie zählen dann wieder gegen das Budget).
- Mit 5 Tabs: auf dem Handy darf „Alle Buchungen“ zweizeilig werden, zwischen 768 und 1023 px
  Breite zeigt die Kopfzeile die Tabs ohne Symbole.
- **Testdaten:** Projekt „Umbau Bad (Test)“ (Rahmen 12.000 €; „Planung Badumbau“ geplant 800 €,
  gebucht 950 €; „Fliesen“ überfällig; „Handwerker Rechnung“ und „Dusche & Waschtisch“
  geplant) und „Sommerurlaub (Test)“ (Rahmen 3.500 €; „Flüge“ gebucht, Ferienwohnung und
  Mietwagen geplant). Das Szenario „Neues Auto“ mit Anzahlung und Autokredit entfällt.

## D55 – Monatsnavigation im Konto bis Dezember 2050
*Wunsch des Nutzers*

- Mit › kann man sich im Konto in jeden Folgemonat bis Dezember 2050 klicken (vorher nur bis
  zur letzten erfassten Buchung).
- Ein Zukunftsmonat zeigt statt des Monatsabschlusses eine **Prognose** (kursiv, getönt,
  Marke „Annahme“): erwarteter Stand am Monatsanfang, Einnahmen, Ausgaben, Umbuchungen,
  erwarteter Stand am Monatsende und ggf. den Hinweis „unter dem Mindestsaldo“. Darunter die
  erwarteten Posten (wiederkehrend, geplant, Budget) mit Datum und Betrag.
- Die Zahlen kommen aus derselben Rechnung wie die Zeitleiste (D47), Anfang = Stand Ende des
  Vormonats bzw. die Prognose zum Monatsende des laufenden Monats.
- Schon erfasste Buchungen mit Datum in diesem Monat stehen darunter in der normalen,
  anklickbaren Buchungsliste (und nicht doppelt bei den Posten).
- Geändert werden die Posten wie bisher in „Annahmen“ bzw. „Projekte“. „Heute“ springt zurück.

## D56 – Hauptkategorien „Investitionen“ und „Bargeldabhebung“ (Datenmodell Version 6)
*Wunsch des Nutzers*

- Neue Hauptkategorien, beide Art **Ausgabe** (das Geld verlässt das Konto):
  - **Investitionen:** ETF & Fonds, Aktien, Edelmetalle, Altersvorsorge, Sonstige Investitionen
  - **Bargeldabhebung:** Geldautomat
  Die Unterkategorien lassen sich unter Stammdaten anpassen.
- Startsatz (`js/startdaten.js`) ergänzt; „Sonstiges“ hat keine Unterkategorie
  „Bargeldabhebung“ mehr.
- **Migration 5 → 6** ergänzt bestehende Datenstände (anders als in D32, weil der Nutzer es
  ausdrücklich wünscht):
  - Fehlt eine Hauptkategorie „Investitionen“, wird sie mit Unterkategorien angelegt.
  - Fehlt eine Hauptkategorie „Bargeldabhebung“ (oder „Bargeld“), wird sie angelegt. Gibt es
    die alte Unterkategorie „Sonstiges › Bargeldabhebung“, wird sie umgehängt und in
    „Geldautomat“ umbenannt. Ihre ID bleibt, also wandern alle Bargeld-Buchungen mit.
  - Folge: Bargeld zählt nicht mehr gegen ein Budget „Sonstiges“.
- Namen werden ohne Groß-/Kleinschreibung verglichen. Gibt es schon eine gleichnamige
  Hauptkategorie, bleibt alles, wie es ist.

## D57 – Drei Kategorien in der Übersicht bleiben gemerkt
*Wunsch des Nutzers*

- Die Wahl wurde schon gespeichert (Einstellung `uebersicht` in der Datenbank), aber nur nach
  einer Änderung. Bis dahin füllte die App die Plätze mit den größten Ausgaben des Monats, und
  die wechseln mit jeder Buchung.
- Jetzt speichert die App die angezeigten drei Kategorien sofort, auch die automatisch
  vorgeschlagenen. Danach bleiben sie fest, bis der Nutzer sie ändert. Nur eine gelöschte oder
  archivierte Kategorie wird ersetzt.
- Gespeichert wird je Gerät und Browser. PC und Handy gleichen sich erst mit dem Drive-Sync in
  Etappe 6 ab.

## D58 – Posten der Zukunft direkt ändern (Datenmodell Version 7)
*Wunsch des Nutzers*

- In einem Folgemonat der Monatsansicht und in der Zeitleiste lassen sich die Posten antippen:
  - **Termin einer wiederkehrenden Buchung:** Betrag und Datum nur für diesen einen Termin,
    „Überspringen“ oder „Zurücksetzen“. Gespeichert als Ausnahme
    `{ termin, aktion: 'aendern', neuesDatum, betragCent }` (neben 'ueberspringen' und
    'verschieben'). Entspricht die Eingabe der Regel, wird die Ausnahme entfernt; nur ein
    anderes Datum wird als 'verschieben' gespeichert. Die Serie selbst bleibt unverändert,
    die Liste „Einzeln geänderte Termine“ im Annahmen-Dialog zeigt alle Abweichungen.
  - **Geplante Einmalbuchung:** öffnet ihren normalen Dialog.
  - **Budget:** Monatsbetrag nur für diesen Monat (0 = kein Budget). Gespeichert am
    wiederkehrenden Budget als `ausnahmen: [{ monat, betragCent }]`; `budgetFuerMonat()` nimmt
    für diesen Monat den Ausnahme-Betrag statt der Stufe. Gibt es im Monat nur ein einmaliges
    Budget, wird dessen Betrag direkt geändert.
- Geänderte Posten tragen die Marke „nur dieser Termin/Monat geändert“.
- Die Rechnung bekommt die Quelle jedes Postens als `ref` mit (siehe `zeitleiste()`).
- **Migration 6 → 7:** wiederkehrende Budgets bekommen `ausnahmen: []`. Das Bearbeiten eines
  Budgets unter „Annahmen“ behält die Ausnahmen.
- Echte Buchungen mit Zukunftsdatum stehen weiter in der normalen Buchungsliste und werden dort
  bearbeitet.

## D59 – Empfänger/Absender je Buchung (Datenmodell Version 8)
*Wunsch des Nutzers; Entscheidungen: „An“/„Von“, optional, Freitext mit Vorschlägen, auch in Annahmen*

- Neues Feld `partner` (Text, höchstens 80 Zeichen, '' = keine Angabe) bei Buchungen,
  wiederkehrenden und geplanten Buchungen. Umbuchungen haben keins (das Gegenüber ist ein
  eigenes Konto).
- **Eingabe:** Im Dialog heißt das Feld bei Ausgaben „An (Empfänger)“, bei Einnahmen
  „Von (Absender)“. Es ist optional, damit die Schnellerfassung schnell bleibt. Die App schlägt
  alle bisher verwendeten Namen vor (häufigste zuerst). Wird bei einer neuen Buchung ein
  bekannter Name gewählt und ist noch keine Kategorie gesetzt, schlägt die App die Kategorie
  der letzten Buchung mit diesem Namen vor.
- **Gleicher Name:** Groß-/Kleinschreibung und Leerzeichen am Rand spielen keine Rolle
  („REWE“ = „rewe “). Angezeigt wird die zuletzt verwendete Schreibweise. Eine Pflegeliste in
  den Stammdaten gibt es bewusst nicht (Entscheidung des Nutzers).
- **Anzeige:** Überall steht der Name **vor** der Kategorie, z. B. „Supermarkt Muster ·
  Supermarkt“ (Monatsansicht, Alle Buchungen, Projekte, Noch erwartet, Annahmen). In der
  Zeitleiste steht er bei schon erfassten Zukunftsbuchungen vor dem Text.
- **Wiederkehrende und geplante Buchungen** geben den Namen beim Buchen an die echte Buchung
  weiter („Buchen“ unter „Noch erwartet“, „Jetzt buchen …“).
- **Alle Buchungen:**
  - Filter „Empfänger/Absender“ mit allen Namen (mit Anzahl) und „Ohne Angabe“ (zum
    Nachtragen). Bei diesem Filter fallen Umbuchungen weg.
  - Die Suche findet auch den Namen; Sortieren nach Empfänger/Absender (ohne Angabe am Ende).
  - Analyse: Umschalter „Nach Kategorien“ / „Nach Empfänger/Absender“. Je Name Summe, Anzahl,
    Anteil und Ø pro Monat (nur abgeschlossene Monate, wie D30). Die 25 größten einzeln, der
    Rest als „Weitere“. Eine Zeile antippen filtert die Liste nach diesem Namen.
- **Migration 7 → 8:** alle Buchungen, wiederkehrenden und geplanten bekommen `partner: ''`.
  Vorhandene Notizen werden nicht automatisch übernommen (die App kann nicht wissen, ob eine
  Notiz ein Name ist).
- **Testdaten:** erfundene Namen wie „Supermarkt Muster“, „Discounter Beispiel“,
  „Vermietung Beispiel“, „Muster GmbH“; ein Supermarkt-Einkauf je Monat bleibt ohne Angabe.

---

# Etappe 6

## D60 – Abgleich mit Google Drive: Drei-Wege-Zusammenführung
*Entscheidung des Nutzers: zusammenführen, nur bei Widerspruch fragen*

- **Ablage:** In Drive ein Ordner `Finanzapp` mit `finanzapp-daten.json` (der komplette
  Datenstand mit Versionsnummer), `Belege/` und `Backups/`. Die App markiert ihre Dateien mit
  `appProperties` und findet sie so wieder.
- **Lokal zuerst:** Die App arbeitet immer mit IndexedDB und funktioniert offline. Abgeglichen
  wird nach der Anmeldung, 4 Sekunden nach jeder Änderung (Signal `db-geaendert` aus
  `db.speichere`/`db.loesche`), wenn das Gerät wieder online ist und wenn die App wieder in den
  Vordergrund kommt (höchstens einmal pro Minute).
- **Basis:** Nach jedem erfolgreichen Abgleich merkt sich das Gerät den abgeglichenen Stand und
  die Drive-Dateiversion (meta `syncBasis`). Ist die Drive-Datei seitdem unverändert, wird nur
  hochgeladen, falls hier etwas geändert wurde.
- **Zusammenführen** (`js/sync/zusammenfuehren.js`, reine Funktionen mit Tests): je Datensatz
  Basis/Gerät/Drive vergleichen. Nur auf einer Seite geändert (auch gelöscht) → diese Seite.
  Auf beiden Seiten verschieden geändert → **Konflikt**: Die App zeigt beide Fassungen
  (verständlich beschrieben, mit Änderungszeit) und der Nutzer wählt je Eintrag oder „überall“.
  „Später“ lässt den Abgleich offen (Wolken-Knopf zeigt „Entscheiden“). Nie wird still
  überschrieben (CLAUDE.md).
- **Kein Verlust:** Hatte das Gerät noch nicht abgeglichene Änderungen und wird sein Stand
  ersetzt oder verändert, legt die App vorher ein Backup `…-geraet.json` an. Die Drive-Fassung
  liegt ohnehin in den Backups des anderen Geräts.
- **Erstes Verbinden** eines Geräts (noch keine Basis): Ist der Gerätestand „frisch“ (nur
  unveränderter Startsatz), wird der Drive-Stand ohne Rückfrage übernommen – sonst gäbe es die
  Start-Kategorien doppelt (andere IDs). Liegen auf beiden Seiten eigene Daten, fragt die App:
  „Drive-Stand übernehmen“ (empfohlen) oder „Zusammenführen“.
- **Gleichzeitiges Hochladen:** Kurz vor dem Hochladen prüft die App die Drive-Version. Hat ein
  anderes Gerät inzwischen hochgeladen, führt sie zuerst dessen Stand zusammen. Ändert der
  Nutzer während des Abgleichs etwas, beginnt der Abgleich von vorn.
- **Versionen:** Der Drive-Stand wird beim Laden migriert. Stammt er aus einer neueren
  App-Version, bricht der Abgleich mit einer Meldung ab (nichts wird überschrieben).
- Auch die Einstellungen (Hinweis-Schwellen, die drei Übersichts-Kategorien) werden abgeglichen.
- Die Client-ID, „verbunden“ und der Zeitpunkt des letzten Abgleichs liegen nur auf dem Gerät
  (localStorage).

## D61 – Anmeldung und Berechtigung
- Google Identity Services im **Token-Verfahren** (reine Web-App, kein Server, kein
  Client-Geheimnis). Die Bibliothek wird erst geladen, wenn Drive genutzt wird.
- Berechtigung **`drive.file`**: Die App sieht nur Dateien, die sie selbst angelegt hat – nicht
  den Rest des Drives. Diese Berechtigung gilt bei Google als unkritisch.
- Das Zugangs-Token gilt ca. 1 Stunde und liegt **nur im Arbeitsspeicher**. Nach einem Neustart
  zeigt der Wolken-Knopf oben „Anmelden“; ein Antippen genügt (Browser erlauben das
  Google-Fenster nur nach einem Klick).
- Die Client-ID trägt der Nutzer in den Stammdaten ein – sie steht nicht im Code (CLAUDE.md:
  keine Zugangsdaten im Repository).
- Wolken-Knopf oben rechts: ☁ Anmelden · ⟳ läuft · ✓ abgeglichen · ⚡ offline · ? Entscheiden ·
  ! Fehler. Ohne eingerichtetes Drive ist er ausgeblendet.

## D62 – Backups
*Entscheidung des Nutzers: letzte 30 + je Tag*

- Nach jedem Hochladen entsteht in `Backups/` eine Kopie (`backup-JJJJ-MM-TTTHH-MM-SS.json`).
- Behalten werden die **30 neuesten** und **je Kalendertag der letzten 30 Tage das neueste**;
  die übrigen kommen in den Drive-Papierkorb (dort von Google nach 30 Tagen gelöscht).
- Stammdaten → Google Drive → „Backups in Drive anzeigen“ → **Wiederherstellen**: ersetzt den
  Stand auf dem Gerät und in Drive. Der bisherige Stand wird vorher als
  `…-vor-wiederherstellung.json` gesichert.

## D63 – Belege
- An Einnahmen und Ausgaben (nicht an Umbuchungen) lassen sich mehrere Fotos/PDFs hängen:
  „📷 Foto aufnehmen“ (Kamera am Handy) oder „+ Datei wählen“.
- Bilder werden vor dem Speichern verkleinert (längste Seite 1600 px, JPEG 80 %); PDFs bleiben
  unverändert. Höchstens 15 MB je Datei.
- Neue Belege liegen zuerst nur auf dem Gerät (Schublade `belegDateien`, wird nicht
  abgeglichen) und werden beim nächsten Abgleich in `Belege/` hochgeladen
  (Name: Datum + Empfänger/Absender bzw. Kategorie). An der Buchung steht
  `belege: [{ id, name, mime, groesse, driveId, hinzugefuegtAm }]`.
- Ansehen: Bilder in einem Dialog, PDFs in einem neuen Fenster. Auf einem anderen Gerät lädt die
  App die Datei bei Bedarf aus Drive und speichert sie zwischen.
- Entfernte Belege und Belege endgültig gelöschter Buchungen kommen in den **Drive-Papierkorb**
  (vorgemerkt, falls gerade offline).
- Der Filter „ohne Beleg“ (Etappe 3) wirkt jetzt.
- DB-Struktur Version 6 (Schublade `belegDateien`). Das Datenmodell bleibt Version 8 (das Feld
  `belege` gab es schon).

## D64 – Export
*Entscheidung des Nutzers: CSV für Excel*

- CSV mit Semikolon, Dezimalkomma, Datum TT.MM.JJJJ, UTF-8 mit BOM und CRLF – so öffnet Excel
  (deutsch) die Datei per Doppelklick richtig, ohne Zusatzprogramm und offline.
- Spalten: Datum, Konto, Art, Empfänger/Absender, Hauptkategorie, Unterkategorie, Betrag (€,
  Ausgaben negativ), Status, Notiz, Projekt, Gegenkonto, Belege (Anzahl). Umbuchungen einmal
  (vom Abgangskonto), Papierkorb nicht.
- Texte, die mit `=`, `+`, `-` oder `@` beginnen, bekommen ein `'` davor, damit Excel sie nicht als
  Formel ausführt.
- Stammdaten → Export: alle Buchungen als CSV und der komplette Datenstand als JSON.
  Alle Buchungen → Liste: „Als CSV (Excel)“ exportiert die gefilterte Liste.

## D65 – Veröffentlichung mit GitHub Pages
*Entscheidung des Nutzers*

- Statisches Hosting des Codes unter `https://NAME.github.io/FinanzApp/` (öffentliches
  Repository, weil GitHub Pages für kostenlose Konten nur so geht). Im Repository liegen nur
  Code, Dokumentation und erfundene Testdaten – keine Finanzdaten, keine Zugangsdaten.
- Alle Pfade sind relativ, Service Worker und Manifest funktionieren daher auch im
  Unterordner `/FinanzApp/`. `.nojekyll` sorgt dafür, dass GitHub die Dateien unverändert
  ausliefert.
- Die Pages-Adresse muss beim Google-Client als „Autorisierte JavaScript-Quelle“ eingetragen
  werden.

---

# Nach Etappe 6: sauberer Start, App-Sperre, Archiv

## D66 – Alles löschen und neu beginnen
*Wunsch des Nutzers: vor dem Start mit echten Daten wirklich alles löschen; Startsatz frisch*

- Stammdaten → „Alles löschen und neu beginnen“, mit doppelter Rückfrage (zweites Mal
  „LÖSCHEN“ eintippen).
- Auf dem Gerät: alle abgeglichenen Sammlungen werden geleert, danach gibt es nur den frischen
  Kategorie-Startsatz und die Standard-Einstellungen (`leererStand()` in `js/db.js`). Auch die
  zwischengespeicherten Belege und Archive werden gelöscht.
- In Google Drive (wenn verbunden): Belege, Backups und Archive werden **endgültig** gelöscht
  (nicht in den Papierkorb). Die Datendatei wird mit dem leeren Stand überschrieben.
- **Neustart-Kennung:** Die Datendatei bekommt eine neue `neustartId`. Jedes Gerät merkt sich
  die Kennung beim Abgleich. Ein anderes Gerät erkennt beim nächsten Abgleich die neue Kennung,
  fragt „Hier auch löschen?“ und übernimmt dann den leeren Stand – es lädt seine alten Daten
  also nicht wieder hoch. Auch ein Gerät, das zum ersten Mal verbindet, übernimmt einen bewusst
  geleerten Drive-Stand nicht stillschweigend mit seinen eigenen Daten, sondern fragt.
- Bleiben: Client-ID und Drive-Verbindung, App-Sperre.
- Die Testdaten-Knöpfe erscheinen nur noch beim Entwickeln am PC (`localhost`), nicht in der
  veröffentlichten App.

## D67 – App-Sperre
*Entscheidungen des Nutzers: PIN + Fingerabdruck; beim Öffnen und nach 5 Minuten im Hintergrund*

- PIN mit 4–8 Ziffern. Gespeichert wird nur ein Hash (PBKDF2-SHA-256, 150.000 Runden, Salz),
  nie die PIN selbst.
- Zusätzlich Fingerabdruck/Gesicht bzw. Windows Hello über WebAuthn (eingebauter
  „Plattform-Authentifikator“, Nutzerprüfung erforderlich). Ohne Server wird das Ergebnis nur
  lokal ausgewertet – das reicht für einen Sichtschutz.
- Sperrt beim Öffnen und, wenn die App mindestens die eingestellte Zeit (sofort, 1, 5, 15,
  30 Minuten; Standard 5) im Hintergrund war. Beim Sperren werden offene Dialoge geschlossen
  (ungespeicherte Eingaben gehen verloren) und der Inhalt verborgen.
- Nach 5 falschen PINs Wartezeit von 30 Sekunden, danach jeweils doppelt so lang.
- **PIN vergessen:** Die komplette Datenbank dieses Geräts wird gelöscht (auch die PIN). Die
  Daten kommen nach dem Verbinden aus Google Drive zurück; nicht abgeglichene Änderungen gehen
  verloren.
- Die Einstellungen gelten nur auf diesem Gerät (meta `sperre`, nicht abgeglichen).
- **Grenze:** Die Sperre ist ein Sichtschutz, keine Verschlüsselung. Wer technisch versiert
  ist und das entsperrte Gerät hat, kommt über die Entwicklerwerkzeuge des Browsers an die
  Daten.

## D68 – Archivierung alter Jahre (Datenmodell Version 9)
*Entscheidung des Nutzers: archivierte Jahre bleiben lesend ansehbar*

- Archiviert wird immer das **älteste** Jahr mit Buchungen, und nur Jahre vor dem laufenden.
  Liegen Buchungen dieses Jahres im Papierkorb, muss er erst geleert werden.
- Beim Archivieren (`js/archiv.js`, reine Funktionen mit Tests):
  - Buchungen (beide Hälften von Umbuchungen) und Kontoabstimmungen des Jahres kommen in die
    Drive-Datei `finanzapp-archiv-JJJJ.json` (mit Kopie der Konten, Kategorien und Projekte für
    die Namen) und werden aus dem Datenstand entfernt.
  - Jedes Konto, das vorher begann, startet am 01.01. des Folgejahres mit dem Kontostand vom
    31.12. als Anfangssaldo – alle Kontostände bleiben gleich.
  - Geplante Einmalbuchungen, die durch eine archivierte Buchung erledigt sind, werden als
    erledigt markiert.
  - Projektkosten des Jahres werden im Archiv-Eintrag gemerkt und zählen weiter in der
    Projektsumme („davon … archiviert“).
  - Ein Eintrag in der neuen, abgeglichenen Sammlung `archive` hält fest, was zum Zurückholen
    nötig ist (alte Anfangssalden/Stichtage, Markierungen).
- Archivieren und Zurückholen gehen nur mit verbundenem, abgeglichenem Google Drive.
- **Ansehen:** siehe D69 – archivierte Jahre sind in „Alle Buchungen“ immer mit enthalten.
- **Zurückholen:** nur das zuletzt archivierte Jahr. Buchungen, Abstimmungen, Anfangssalden und
  Markierungen werden wiederhergestellt, die Archivdatei kommt in den Drive-Papierkorb.
- Hinweis: Die Budgethinweise der Übersicht rechnen nur mit nicht archivierten Buchungen –
  deshalb der Tipp, erst im Frühjahr zu archivieren.
- Migration 8 → 9: `archive: []`. DB-Struktur 7 (Schubladen `archive` und lokal
  `archivDateien`).
- `tools/fake-drive.js` ersetzt beim Testen im Browser Google-Anmeldung und Drive durch eine
  Attrappe; die App selbst lädt die Datei nie.

## D69 – Archiv nur von Hand, Auswertungen über alle Jahre
*Wunsch des Nutzers*

- Archivieren und Zurückholen passieren **ausschließlich** über die Knöpfe in den Stammdaten,
  jeweils mit Rückfrage. Es gibt keine Automatik (kein Zeitplan, kein Archivieren beim Start
  oder Abgleich).
- „Alle Buchungen“ zeigt immer **alle Jahre von Beginn an**: Die Buchungen archivierter Jahre
  werden (aus dem Zwischenspeicher oder aus Drive) dazugeladen und zählen in Liste, Filtern,
  Sortierung, Analyse, Durchschnitten, Empfänger-Auswertung und CSV-Export ganz normal mit.
  Sie tragen die Marke „Archiv“ und lassen sich nicht bearbeiten (Hinweis: Jahr zurückholen).
- Das frühere Auswahlfeld „Datenbestand“ entfällt. „Ansehen“ in den Stammdaten stellt den
  Filter auf das archivierte Jahr.
- Ist ein Archiv auf einem Gerät noch nicht geladen (anderes Gerät, nicht bei Google
  angemeldet), steht oben ein Hinweis mit „Aus Google Drive laden“ – so fehlt nie still ein Jahr.
- Projektsummen enthalten archivierte Kosten weiterhin (D68).

## D70 – Hinweis auf nicht Hochgeladenes, Anmeldung automatisch erneuern
*Wunsch des Nutzers: Hinweis + automatisch erneuern*

- **Grenze:** Google gibt reinen Web-Apps ohne eigenen Server nur ein Zugangs-Token für etwa
  eine Stunde. Eine dauerhafte Anmeldung (Refresh-Token) bräuchte einen Server mit
  Client-Geheimnis – das widerspricht dem Rahmen (nur statisches Hosting).
- **Hinweis:** Die App zählt, wie viele Einträge sich seit dem letzten Abgleich geändert haben
  (`anzahlUnterschiede` gegenüber der Basis). Sind es mehr als null und ist gerade kein
  Abgleich möglich (nicht angemeldet, offline, Fehler, Rückfrage offen), zeigt der Wolken-Knopf
  gut sichtbar „⬆ N nicht hochgeladen“.
- **Automatisch erneuern:** Ist die Anmeldung abgelaufen oder läuft sie in den nächsten
  10 Minuten ab, erneuert die App sie beim nächsten Antippen irgendwo in der App und gleicht
  danach ab (auch um Änderungen der anderen Geräte zu holen). Weil die Zustimmung schon
  erteilt ist, blitzt das Google-Fenster nur kurz auf. Browser erlauben das Fenster nur direkt
  nach einem Antippen – deshalb nicht völlig im Hintergrund.
- Bricht der Nutzer das Fenster ab oder schlägt es fehl, versucht die App es erst wieder, wenn
  sie erneut in den Vordergrund kommt (kein ständiges Aufpoppen). Über dem Sperrbildschirm wird
  nie erneuert.
- Die Google-Anmeldung wird beim Start schon geladen, damit sie nach dem Antippen sofort bereit ist.

## D71 – Buchung kopieren und als wiederkehrend übernehmen
*Wunsch des Nutzers*

- Im Dialog einer bestehenden Buchung stehen oben zwei Knöpfe:
  - **„⧉ Kopieren“** öffnet eine neue Buchung mit denselben Werten (Art, Betrag,
    Empfänger/Absender, Kategorie, Konto bzw. Von/Auf, Notiz, Projekt) und dem **heutigen Datum**,
    das sich ändern lässt. Belege werden nicht mitkopiert, Status ist „gebucht“.
  - **„↻ Als wiederkehrend anlegen“** öffnet den Dialog „Neue wiederkehrende Buchung“, vorbelegt
    mit diesen Werten. Bezeichnung = Empfänger/Absender, sonst Notiz, sonst Kategorie.
    Intervall monatlich. Erster Termin = einen Monat nach dieser Buchung (am selben Tag; lag sie
    am Monatsletzten, dann „Immer am Monatsletzten“). So zählt die schon gebuchte Buchung nicht
    doppelt. Alles lässt sich vor dem Speichern anpassen.
- Beide nehmen die Werte, die gerade im Dialog stehen. Die ursprüngliche Buchung bleibt
  unverändert (ungespeicherte Änderungen an ihr werden verworfen).

## D72 – Mehrfachauswahl in den Filtern, Zukunft ohne eigene Hintergrundfarbe
*Wunsch des Nutzers*

- **Filter „Alle Buchungen“:** Konto, Art, Kategorie, Empfänger/Absender und Status sind
  Aufklapplisten mit Häkchen. Nichts angehakt = alle. Innerhalb eines Filters gilt „oder“
  (z. B. Giro oder Tagesgeld), zwischen den Filtern „und“. „Auswahl aufheben“ setzt einen
  Filter zurück; ein Tipp daneben schließt die Liste.
- **Kategorie:** Eine angehakte Hauptkategorie umfasst alle ihre Unterkategorien (diese
  erscheinen dann angehakt und gesperrt). Haupt- und einzelne Unterkategorien anderer
  Gruppen lassen sich mischen.
- **Mehrere Konten:** Eine Umbuchung zwischen zwei gewählten Konten erscheint einmal und
  ohne Wirkung (Geld bleibt in der Auswahl). Eine Umbuchung zu einem nicht gewählten Konto
  zählt mit + / − aus Sicht des gewählten Kontos.
- Antippen einer Zeile in der Analyse „Nach Empfänger/Absender“ wählt genau diesen einen aus.
- **Zukunft bis 2050 und Zukunftsmonate:** gleiche Kartenfarbe wie alle anderen Bereiche
  (ersetzt den getönten Hintergrund aus Etappe 5). Als Annahme gekennzeichnet bleiben die
  Werte durch Kursivschrift.

## D73 – „Alle Buchungen“ als Tabelle mit Sortierung per Spaltenkopf
*Wunsch des Nutzers: mehrstufig, Standardspalten, am Handy kompakt*

- **Am PC (ab 768 px):** Tabelle mit den Spalten Datum · Empfänger/Absender · Kategorie
  (Haupt › Unter) · Konto · Notiz · Betrag. Die Kopfzeile bleibt beim Scrollen oben stehen.
  Zeilen leicht gestreift, Antippen öffnet wie bisher die Buchung. „vorgemerkt“ und „Archiv“
  bleiben als Marke beim Empfänger/Absender.
- *Seit D103 nur noch eine Sortierstufe – der folgende Absatz gilt nicht mehr.*
- **Sortieren:** Klick auf einen Spaltenkopf macht diese Spalte zur ersten Sortierstufe. Die
  vorher angeklickten Spalten bleiben als 2. und 3. Stufe erhalten (höchstens 3). Ein erneuter
  Klick auf die erste Spalte dreht die Richtung um. Ziffern im Kopf zeigen die Reihenfolge,
  über der Tabelle steht sie als Text („Sortiert nach Betrag ↓, dann Kategorie ↑ …“).
  „Sortierung zurücksetzen“ führt zurück zu Datum, neueste zuerst.
- Erste Richtung: Datum und Betrag absteigend, Texte A–Z. Leere Texte stehen am Ende.
  Bei vollständigem Gleichstand entscheidet das Datum (Richtung der ersten Stufe).
- **Betrag mit Vorzeichen:** absteigend = größte Einnahmen zuerst, aufsteigend = größte
  Ausgaben zuerst. Umbuchungen ohne Kontofilter zählen als 0 und stehen untereinander nach Höhe.
- **Am Handy:** zweizeilige Zeilen wie bisher (oben Empfänger/Absender, darunter Datum ·
  Kategorie · Konto · Notiz, rechts der Betrag). Darüber Sortierknöpfe Datum, An/Von,
  Kategorie, Betrag mit derselben Logik. Ohne Empfänger/Absender steht oben die Kategorie.
- Die Sortierung bleibt erhalten, solange die App offen ist (wie die Filter).

## D74 – Relevante Ausgaben (Block unten im Tab „Projekte“)
*Wunsch des Nutzers: allgemeine Sammlung, eine Liste mit Gruppen, Erfassung wie eine Buchung,
Belege unbedingt (eigener Drive-Ordner), Anzeige nach Jahren mit Summen*

- **Zweck:** eine Sammelliste wichtiger Ausgaben, z. B. für Garantie, Steuer oder als Nachweis –
  auch aus früheren Jahren (Datum ab 1990 möglich, gedacht ab 2010).
- **Zwei Quellen:**
  1. **Eigene Einträge** (neue Sammlung `relevant`, Datenversion 10): Betrag, Empfänger,
     Kategorie (optional, Ausgaben-Kategorien), Datum, Gruppe, Notiz, Belege. Sie gehören zu
     keinem Konto und zählen **nirgends** mit – nicht im Kontostand, nicht im Budget, nicht in
     der Prognose, nicht unter „Alle Buchungen“.
  2. **Echte Ausgaben mit Häkchen** „Relevante Ausgabe“ im Buchungsdialog (Felder `relevant`,
     `relevantGruppe` an der Buchung). Sie erscheinen automatisch in der Liste; es wird nichts
     kopiert. Ändert man die Buchung, ändert sich die Zeile mit. Nur bei Ausgaben.
     Markierte Buchungen aus archivierten Jahren erscheinen (nur lesen), wenn das Archiv auf
     dem Gerät geladen ist.
- **Gruppe:** freier Text mit Vorschlägen (z. B. „Haus“, „Garantie“), Groß/klein egal. Über der
  Liste kann man nach Gruppe filtern (auch „Ohne Gruppe“).
- **Anzeige:** Gesamtsumme, darunter je Jahr ein aufklappbarer Block (neuestes Jahr offen) mit
  Anzahl und Jahressumme; darin eine Tabelle wie unter „Alle Buchungen“ (Datum · Empfänger ·
  Kategorie · Gruppe · Notiz · Betrag). Markierte Buchungen tragen ihr Konto als Marke, 📎 zeigt
  Belege. Antippen öffnet den Eintrag bzw. die Buchung. Am Handy zweizeilig.
- **Belege in Google Drive:** neuer Ordner `Finanzapp/Relevante Ausgaben`.
  - Belege eigener Einträge werden direkt dort abgelegt.
  - Belege markierter Buchungen liegen wie immer unter `Belege`; zusätzlich legt der Abgleich
    eine **Kopie** in `Relevante Ausgaben` an (`beleg.relevantDriveId`). Wird das Häkchen
    entfernt oder die Buchung in den Papierkorb gelegt, kommt die Kopie in den Drive-Papierkorb
    (das Original bleibt). Wird ein Beleg entfernt oder die Buchung endgültig gelöscht, gehen
    Original und Kopie in den Drive-Papierkorb.
- **Löschen:** eigene Einträge kommen zuerst in den Papierkorb (Stammdaten → Papierkorb,
  eigener Abschnitt „Relevante Ausgaben“), von dort wiederherstellen oder endgültig löschen.
- Testdaten (nur localhost): drei erfundene Einträge (2012, 2018, 2021) und die Test-Buchung
  „Architekturbüro Muster“ mit Häkchen.

## D75 – Schlankere Übersicht am Handy
*Wunsch des Nutzers – gilt nur am Handy (Bildschirm schmaler als 768 px), am PC bleibt alles gleich*

- **Kennzahlen oben:** Die drei wählbaren Kategorien (Auswahlliste + Betrag + Budget) entfallen.
  Ihre Auswahl bleibt gespeichert und erscheint am PC weiter.
- **Buchungen eines Kontos (Monatsansicht):** ohne Kategorie. Oben steht der Empfänger/Absender,
  ohne Angabe die Notiz, ohne beides ausnahmsweise die Unterkategorie. Darunter nur noch die
  Notiz (wenn es einen Empfänger/Absender gibt). Die Tageszeilen mit Datum und Tagesstand
  bleiben (Wunsch des Nutzers), die Reihenfolge bleibt chronologisch nach Buchungsdatum.
- **Noch erwartet bis Monatsende:** ohne Datum und Kategorie; darunter nur Empfänger/Absender
  bzw. bei Umbuchungen das Zielkonto. Die Reihenfolge bleibt nach Fälligkeitsdatum.
- **Zukunft bis 2050:** sichtbar sind der Rest des laufenden Jahres und die nächsten drei Jahre.
  Die späteren Jahre bis 2050 blendet der Knopf „Weitere Jahre bis 2050 anzeigen“ ein (und
  wieder aus); die Wahl bleibt erhalten, solange die App offen ist.

## D76 – Übersicht am Handy: einzeilige Buchungen, Umbuchungen ausblendbar
*Wunsch des Nutzers – ergänzt D75, gilt nur am Handy (unter 768 px), am PC bleibt alles gleich*

- **Buchungen eines Kontos:** genau eine Zeile – Empfänger/Absender und Betrag. Ohne Angabe
  steht die Notiz dort, ohne beides „Ausgabe“ bzw. „Einnahme“. Keine Kategorie, keine
  Unterkategorie, keine zweite Zeile. Zu lange Namen werden mit „…“ abgeschnitten (der volle
  Name steht im Tooltip und im Buchungsdialog). Die Marke „vorgemerkt“ bleibt.
- **Noch erwartet bis Monatsende:** ebenfalls eine Zeile – Empfänger/Absender, ohne Angabe die
  Bezeichnung; Marken „einmalig“/„überfällig“ bleiben.
- **Umbuchungen:** in beiden Listen standardmäßig ausgeblendet; ein Tag, an dem nur Umbuchungen
  stehen, verschwindet samt Tageszeile. Der Knopf „Umbuchungen einblenden (n)“ blendet sie ein
  (und wieder aus); die Wahl gilt für alle Listen der Übersicht, bis die App geschlossen wird.
  Summen, Tagesstände und Prognose rechnen unverändert mit den Umbuchungen.
- Bewusst unverändert (Wunsch des Nutzers): Budgethinweise, die Budget-Zeilen unter „Noch
  erwartet“ und die Posten in „Zukunft bis 2050“.

## D77 – Umbuchungen auch unter „Alle Buchungen“ am Handy ausblendbar
*Wunsch des Nutzers – nur am Handy (unter 768 px), am PC unverändert*

- Wie in der Übersicht (D76) sind Umbuchungen in der Liste „Alle Buchungen“ am Handy zunächst
  ausgeblendet. Der Knopf „Umbuchungen einblenden (n)“ über der Liste blendet sie ein und wieder
  aus. Es ist derselbe Schalter wie in der Übersicht – die Wahl gilt für beide Listen, bis die
  App geschlossen wird.
- Ausnahme: Ist im Filter „Art“ ausdrücklich „Umbuchungen“ angehakt, werden sie sofort gezeigt
  (ohne Knopf) – sonst wäre die gefilterte Liste leer.
- Summen, Zähler, Analyse und CSV-Export bleiben unverändert (sie enthalten die Umbuchungen wie
  bisher; Umbuchungen zählen ohnehin nicht als Einnahme oder Ausgabe).

## D78 – Übersicht am PC als Tabelle, Umbuchungen überall ausblendbar, ohne drei Kategorien
*Wunsch des Nutzers: Tabelle mit Stand-Spalte, ohne Sortieren per Klick, Umbuchungen zunächst aus*

- **Buchungen eines Kontos am PC (ab 768 px):** Tabelle wie unter „Alle Buchungen“ mit den
  Spalten Datum · Empfänger/Absender · Kategorie (Haupt › Unter) · Notiz · Betrag · **Stand**.
  „Stand“ ist der Kontostand nach dieser Buchung. Keine Tageszeilen mehr, neueste Buchung oben,
  immer nach Datum (kein Sortieren per Spaltenkopf – sonst passte der Stand nicht zur
  Reihenfolge). Antippen öffnet die Buchung. Am Handy bleibt die Ansicht aus D75/D76.
- **Umbuchungen:** jetzt auch am PC in der Übersicht (Buchungen und „Noch erwartet“) und unter
  „Alle Buchungen“ zunächst ausgeblendet, mit dem Knopf „Umbuchungen einblenden (n)“. Ersetzt
  „am PC unverändert“ aus D76/D77. Der Stand rechnet die ausgeblendeten Umbuchungen mit; Summen,
  Analyse und CSV-Export bleiben unverändert.
- **Kennzahlen oben:** Die drei wählbaren Kategorien entfallen auch am PC (ersetzt die in
  CLAUDE.md genannte „Budgetauslastung der wichtigsten Kategorien“ in der Kennzahlen-Leiste;
  Budgets sieht man weiter unter „Noch erwartet“ und in den Budgethinweisen). Die früher
  gespeicherte Auswahl (Einstellung „uebersicht“) bleibt unbenutzt liegen und stört nicht.

## D79 – Übersicht: 10er-Grenze ohne Umbuchungen, Tageszeilen am PC, Zukunft auch am PC eingeklappt
*Wunsch des Nutzers*

- **„Letzte 10 Buchungen“:** Umbuchungen zählen nicht mit. Gezeigt werden die letzten zehn echten
  Buchungen (Einnahmen/Ausgaben); Umbuchungen dazwischen erscheinen nur, wenn sie eingeblendet
  sind. Auch die Anzahl in der Kopfzeile („Letzte 10 von N Buchungen“) und „Alle N Buchungen
  anzeigen“ zählen ohne Umbuchungen. Gilt am Handy und am PC.
- **PC-Tabelle:** Die Tageszeilen mit Datum und Tagesstand stehen wieder als Zwischenzeilen in
  der Tabelle (ergänzt D78). Ein Tag mit nur Umbuchungen verschwindet samt Tageszeile, solange
  Umbuchungen ausgeblendet sind. Die Spalte „Stand“ je Buchung bleibt.
- **Zukunft bis 2050:** auch am PC nur Rest des laufenden Jahres plus die nächsten drei Jahre;
  die übrigen Jahre bis 2050 per Knopf „Weitere Jahre bis 2050 anzeigen“ (wie D75 am Handy).

## D80 – PC-Tabelle der Übersicht ohne Spalte „Stand“
*Wunsch des Nutzers – mehr Platz für die übrigen Spalten*

- Die Spalte „Stand“ je Buchung (D78) entfällt. Der Kontostand am Ende des Tages steht in der
  Tageszeile rechtsbündig unter der Spalte „Betrag“ (D79). Spalten jetzt: Datum ·
  Empfänger/Absender · Kategorie · Notiz · Betrag.

## D81 – Updates sofort sichtbar: Service Worker umgeht den Browser-Zwischenspeicher
*Anlass: Nach dem Hochladen zeigte der PC noch die alte Spalte „Stand“*

- **Ursache:** GitHub Pages erlaubt Browsern, jede Datei bis zu 10 Minuten aufzuheben
  (`Cache-Control: max-age=600`). Der Service Worker holte Dateien „Netz zuerst“, aber über diesen
  Browser-Zwischenspeicher – und füllte bei einem Update sogar seinen Offline-Speicher damit. So
  konnte kurz nach dem Hochladen noch die alte Version erscheinen.
- **Lösung:** Der Service Worker fragt jetzt bei jeder Datei mit `cache: 'no-cache'` beim Server
  nach (ist nichts geändert, antwortet der Server nur kurz „unverändert“), und beim Installieren
  einer neuen Version lädt er alle Dateien mit `cache: 'reload'` frisch. Offline bleibt alles wie
  bisher (gespeicherte Kopie).
- Geräte mit der alten Version bekommen diese Verbesserung beim nächsten Update automatisch; bis
  dahin hilft Strg+F5 bzw. App schließen und nach einigen Minuten neu öffnen.

## D82 – Tageszeilen in der PC-Tabelle farblich abgehoben
*Wunsch des Nutzers*

- Die Tageszeile mit Datum und Tagesstand (D79/D80) hat in der PC-Tabelle der Übersicht einen
  leicht getönten Hintergrund (Farbe `--flaeche-2`, im hellen und dunklen Modus passend), runde
  Ecken, etwas Abstand nach oben und kräftigere Schrift. So trennt sie die Tage sichtbar von den
  Buchungen. Am Handy unverändert.

## D83 – App-Login: ein Passwort für alle Geräte, Passkey je Gerät (ersetzt die PIN aus D67)
*Wunsch des Nutzers: Passwort mind. 8 Zeichen, immer Pflicht, „vergessen“ über Google-Anmeldung,
Sperrzeit wie bisher wählbar (Standard 5 Minuten)*

- **Passwort für alle Geräte:** Gespeichert wird nur ein Prüfwert (PBKDF2-SHA-256, 210.000 Runden,
  zufälliges Salz) als Eintrag `login` in der Sammlung `einstellungen`. Damit wird er wie alle Daten
  mit Google Drive abgeglichen und gilt auf allen Geräten. Das Passwort selbst wird nie gespeichert.
  Keine neue Datenversion nötig (neuer Eintrag in einer bestehenden Sammlung).
- **Pflicht:** Ohne Passwort ist die App nicht nutzbar. Gibt es noch keins (erster Start nach dem
  Update, neues Gerät), erscheint „Passwort festlegen“; ausschalten lässt sich der Login nicht.
  Die alte PIN je Gerät entfällt.
- **Weiteres Gerät:** „Von Google Drive holen“ meldet sich bei Google an, liest das Passwort aus der
  Datendatei (nur lesen, kein Abgleich) und zeigt dann die Anmeldung. Legt man auf einem neuen Gerät
  ohne Abgleich ein eigenes Passwort fest, übernimmt der erste Abgleich das Passwort aus Drive
  (das neue Gerät hat sonst keine Daten); hatten beide Geräte schon eigene Daten, fragt der Abgleich
  wie bei jedem Widerspruch nach.
- **Passkey:** je Gerät einzurichten (Stammdaten → App-Login, mit Passwort bestätigt); gespeichert
  wird nur die Kennung auf diesem Gerät (meta `sperre`). Das Gerät prüft Fingerabdruck/Gesicht bzw.
  Windows Hello (userVerification „required“). Das Passwort funktioniert immer zusätzlich.
- **Passwort vergessen:** Anmeldung mit dem Google-Konto; nur wenn darin der Finanzen-Datenstand
  liegt, darf ein neues Passwort festgelegt werden (gilt nach dem Abgleich überall). Fehlt auf dem
  Gerät die Client-ID, wird sie abgefragt. Keine Daten gehen verloren.
- **Sperrzeit:** je Gerät wählbar (sofort, 1, 5, 15, 30 Minuten im Hintergrund), Standard 5 Minuten.
  Nach 5 falschen Passwörtern wartet die App 30 s, danach jeweils doppelt so lange.
- **Kein Abgleich hinter dem Anmeldebildschirm:** Solange gesperrt ist, gleicht die App nicht ab
  (Rückfragen würden sonst Buchungsdaten zeigen); nach dem Anmelden wird nachgeholt.
- „Alles löschen und neu beginnen“ behält das Passwort.
- **Grenze (bewusst, Möglichkeit A):** Der Login schützt den Zugang zur Oberfläche, verschlüsselt die
  Daten im Browser aber nicht (Möglichkeit B „echte Verschlüsselung“ wurde besprochen und verworfen).

## D84 – Eigene Reihenfolge der Konten (▲/▼)
*Wunsch des Nutzers: Pfeilknöpfe statt Ziehen*

- Konten tragen das Feld `reihenfolge` (Datenversion 11). Die Migration startet mit der bisherigen
  Ordnung: alphabetisch, archivierte zuletzt. Neue Konten kommen ans Ende.
- **Stammdaten → Konten:** Jedes aktive Konto hat ▲ und ▼; ein Tipp tauscht es mit dem Nachbarn.
  Oben bzw. unten sind die Pfeile ausgegraut. Archivierte Konten haben keine Pfeile und stehen
  immer hinter den aktiven.
- Die Reihenfolge gilt überall gleich: Kontoknöpfe in der Übersicht, Kontoauswahl beim Buchen,
  bei wiederkehrenden und geplanten Buchungen und Budgets, Filter unter „Alle Buchungen“.
- Sie wird wie alle Daten über Google Drive abgeglichen (gilt also auf PC und Handy). Ändert man
  sie gleichzeitig auf zwei Geräten, fragt der Abgleich wie bei jedem Widerspruch nach.

## D85 – Budgets gelten je Konto
*Wunsch des Nutzers; ersetzt in D34 „Belastetes Konto“ die Regel, dass alle Konten das Budget verbrauchen*

- Ein Budget gilt für **eine Hauptkategorie auf einem Konto** und einen Monat. Verbraucht wird es
  nur von Ausgaben auf diesem Konto: echte Buchungen, offene wiederkehrende Buchungen und (in der
  Zukunft) geplante Einmalbuchungen. Projektausgaben zählen weiter nicht (D52).
- **Konto ohne eigenes Budget** (Vorschlag angenommen): Eine Ausgabe dort zählt gegen kein Budget –
  sie ist eine normale Ausgabe im Kontostand und in der Prognose. Wer auch dieses Konto im Blick
  haben will, legt dort ein eigenes Budget an.
- Pro Hauptkategorie ist jetzt **je Konto** ein wiederkehrendes Budget erlaubt
  (z. B. Lebensmittel: Giro 400 €, Kreditkarte 100 €). Doppelt auf demselben Konto bleibt gesperrt.
- **Budgethinweise je Konto:** Die Prüfung „N Monate in Folge über/unter Budget“ läuft je Konto und
  Kategorie; die Karte nennt das Konto („Lebensmittel (Giro)“). „Übernehmen“ ändert das Budget
  genau dieses Kontos. Entscheidungen (übernommen/abgelehnt/später) speichern das Konto mit; ältere
  Entscheidungen ohne Konto gelten für alle Konten der Kategorie, bis sie auslaufen.
- In der Zeitleiste trägt ein Budgetposten das Konto im Namen, wenn die Kategorie auf mehreren
  Konten ein Budget hat. „Nur diesen Monat ändern“ trifft das Budget des richtigen Kontos.
- Keine neue Datenversion nötig: Jedes Budget hatte schon ein Konto (D34).

## D86 – Budgets im Annahmen-Tab nach Konten gruppiert
*Wunsch des Nutzers*

- Die Budgetliste ist nach Konten gruppiert, in der eigenen Konten-Reihenfolge (D84). Innerhalb
  eines Kontos alphabetisch nach Kategorie, wiederkehrende vor einmaligen Budgets.
- Unter jeder Gruppe steht eine **Zwischensumme** des Kontos für den laufenden Monat
  (wiederkehrende Beträge dieses Monats + einmalige Budgets dieses Monats). Darunter wie bisher die
  Gesamtsumme aller Budgets des Monats.
- Das Konto steht nicht mehr in jeder Zeile, weil es die Gruppenüberschrift nennt.

## D87 – Budgetsummen im Annahmen-Tab für den Folgemonat
*Wunsch des Nutzers; ändert D86*

- Die Zwischensummen je Konto und die Gesamtsumme der Budgets beziehen sich immer auf den
  **Folgemonat** (z. B. im November auf Dezember), damit sie zur Planung des nächsten Monats passen.
- Gezählt wird, was in diesem Monat gilt: wiederkehrende Budgets mit ihrer dann gültigen Stufe bzw.
  Monatsausnahme und einmalige Budgets genau dieses Monats.
- Die Beträge in den einzelnen Zeilen bleiben unverändert (wiederkehrend: der Betrag, der jetzt gilt;
  künftige Änderungen stehen darunter).

## D88 – „Zukunft bis 2050“ unter jedem Monat
*Wunsch des Nutzers*

- In der Übersicht (einzelnes Konto) steht der Bereich „Zukunft bis 2050“ jetzt unter **jedem**
  Monat – auch beim Blättern in vergangene oder künftige Monate. Bisher stand er nur unter dem
  aktuellen Monat, sonst ein Hinweis „steht unter dem aktuellen Monat“.
- Inhalt und Startpunkt bleiben gleich: Die Zeitleiste beginnt immer mit dem Monat nach heute,
  unabhängig vom angezeigten Monat. Aufgeklappte Jahre/Monate bleiben beim Blättern aufgeklappt.

## D89 – „Zukunft bis 2050“ am Handy einzeilig
*Wunsch des Nutzers: wie die Buchungen*

- Nur am Handy (bis 767 px) steht in „Zukunft bis 2050“ jede Zeile einzeilig:
  - Monatszeilen mit kurzem Monatsnamen („Dez. 2026“), Veränderung und Stand.
  - Monatssumme beim Aufklappen kurz: „Ein. … · Aus. … · Umb. …“.
  - Posten: Datum, Text, Betrag; die Marken „wiederkehrend/geplant/Budget/gebucht“ und
    „nur dieser Monat geändert“ entfallen (Wahl des Nutzers). Zu lange Texte enden mit „…“.
- Gilt ebenso für die Posten, wenn man in einen Zukunftsmonat blättert (gleiche Liste).
- Am PC bleibt alles wie bisher, mit Marken und ausgeschriebenen Monaten.

## D90 – Jahresbudgets in Tranchen
*Wunsch des Nutzers; Antworten auf die Rückfragen in Klammern*

- Neben monatlichen und einmaligen Budgets gibt es **jährliche** (typ `jaehrlich`, Datenversion 12).
  Sie gelten je Hauptkategorie und Konto, wiederholen sich jedes Jahr ab einem Startjahr, optional
  bis zu einem Endjahr. Einen anderen Betrag ab einem Jahr erreicht man mit einem zweiten
  Jahresbudget, das nach dem Endjahr des ersten beginnt.
- **Verteilung im Jahr:**
  - *Zu einem Zeitpunkt:* ganzer Betrag zum Ende eines gewählten Monats (Monat statt Datum).
  - *Hälftig:* je die Hälfte zum 30.06. und 31.12.
  - *Je Quartalsende:* eigene Beträge in Euro je Quartal (Euro statt Prozent); das Jahresbudget ist die Summe.
- **Verbrauch:** Eine Tranche wird von den Ausgaben dieser Kategorie auf diesem Konto seit der vorigen
  Tranche verbraucht (die erste seit 1.1.). Echte, wiederkehrende und geplante Ausgaben zählen,
  Projektausgaben nicht (D52).
- **Rest und Überziehung:** Ist der Monat einer Tranche vorbei, wandert ihr Rest ins **Restbudget zum
  31.12.** Eine Überziehung verringert dieses Restbudget – das Jahr zählt als Ganzes (Wahl: „Ja“).
  Was am 31.12. übrig ist, verfällt; kein Übertrag ins neue Jahr.
- **Prognose:** Eine Tranche, die noch vor uns liegt, wirkt in ihrem Monat wie eine erwartete Ausgabe
  (nur ihr noch offener Rest). Im laufenden Monat steht sie unter „Noch erwartet“ als
  „Budget … (Jahresbudget)“ bzw. „(Restbudget Jahr)“, in „Zukunft bis 2050“ als „Budget … (Jahr)“ bzw.
  „Restbudget … (Jahr)“. Diese Posten lassen sich nicht einzeln für einen Monat ändern.
- **Entweder oder** (Wahl): Pro Kategorie und Konto gilt im selben Zeitraum entweder ein Monatsbudget
  (mit einmaligen) oder ein Jahresbudget; Überschneidungen lehnt die App beim Speichern ab.
- Jahresbudgets erzeugen keine Budgethinweise (die Regel „N Monate in Folge“ passt nicht zu Tranchen).
- Annahmen-Tab: Zeile „Jährlich · … · ab JJJJ“, Betrag „… / Jahr“, bei Quartalen die Aufteilung.
  Die Zwischensumme des Folgemonats (D87) zählt eine dort fällige Tranche mit (ohne Übertrag).
- Testdaten: Jahresbudget Kleidung auf der Kreditkarte, hälftig, 600 € pro Jahr.

## D91 – Budgets je Konto nach Art gruppiert
*Wunsch des Nutzers; ergänzt D86*

- Im Annahmen-Tab bleibt die Gruppierung nach Konten (D86). Innerhalb eines Kontos stehen die Budgets
  jetzt in Untergruppen **Monatlich – Jährlich – Einmalig** (nur Gruppen, die es gibt), darin
  alphabetisch nach Kategorie.
- Zwischensumme je Konto (Folgemonat, D87) und Gesamtsumme bleiben unverändert.

## D92 – Monatsbudgets: feste Abweichungen je Kalendermonat
*Wunsch des Nutzers: „Freizeit monatlich 100 €, immer im Juli 200 € und im Dezember 200 €“*

- Monatliche Budgets haben das Feld `kalenderMonate: [{ monat 1..12, betragCent }]` (Datenversion 13).
  Im Budget-Dialog unter „Abweichende Monate (jedes Jahr)“: Monat wählen, Betrag eintragen.
- **Fester Betrag** (Wahl des Nutzers): Im Juli gelten immer genau 200 €, auch wenn sich der normale
  Monatsbetrag später ändert („Betrag ändern ab …“). 0 € = in diesem Monat kein Budget.
- **Vorrang:** Einzel-Ausnahme für genau einen Monat (Zeitleiste, „nur diesen Monat ändern“) vor
  Kalendermonat-Abweichung vor der geltenden Stufe. Das Zurücksetzen einer Einzel-Ausnahme führt auf
  den Kalendermonat-Betrag zurück.
- Gilt überall, wo Monatsbudgets rechnen: laufender Monat, Zeitleiste bis 2050, Budgethinweise
  (Vergleich mit dem Budget des jeweiligen Monats) und die Zwischensummen im Annahmen-Tab.
- Anzeige im Annahmen-Tab: „jeden Juli: 200,00 € · jeden Dezember: 200,00 €“ unter dem Budget.
- Datenversion 13 sorgt dafür, dass ältere App-Versionen zum Aktualisieren auffordern (sonst würden
  sie die Abweichungen beim Bearbeiten verlieren).

## D93 – Unterkategorien verschieben
*Wunsch des Nutzers*

- Jede Unterkategorie hat in den Stammdaten einen Knopf **„Verschieben“**. Der Dialog zeigt die bisherige
  Hauptkategorie, die möglichen Ziele und wie viele Buchungen und wiederkehrende/geplante Buchungen
  betroffen sind.
- **Nur zwischen Hauptkategorien gleicher Art** (Ausgabe ↔ Ausgabe, Einnahme ↔ Einnahme), nicht in
  archivierte. Grund: Unterkategorien erben die Art von der Hauptkategorie; eine Ausgaben-Buchung unter
  einer Einnahmen-Kategorie wäre widersprüchlich. Das gilt auch für das Feld „Gehört zu Hauptkategorie“
  im Bearbeiten-Dialog (vorher waren dort alle Hauptkategorien wählbar).
- Gibt es im Ziel schon eine Unterkategorie mit gleichem Namen, lehnt die App ab (vorher umbenennen).
- Buchungen, Vorlagen und Annahmen verweisen auf die Unterkategorie und zählen danach automatisch zur
  neuen Hauptkategorie – **auch rückwirkend** (Alle Buchungen, Budgets, Budgethinweise). Die Buchungen
  selbst werden nicht verändert. Bereits archivierte Jahre behalten ihre damalige Zuordnung.
- Nebenbei behoben: Die Zählung der Annahmen für eine Kategorie (Löschsperre) zählte fälschlich fast
  alle wiederkehrenden und geplanten Buchungen mit, weil `gegenkontoId === null` als Treffer galt.
- Am Handy brechen die vier Knöpfe einer Unterkategorie jetzt um.

## D94 – Wiederkehrende Buchungen: feste Abweichungen je Kalendermonat
*Wunsch des Nutzers: wie D92 bei Budgets, z. B. Gehalt mit Weihnachtsgeld im November*

- Wiederkehrende Buchungen haben das Feld `kalenderMonate: [{ monat 1..12, betragCent }]`
  (Datenversion 14). Im Dialog unter dem Betrag: „Abweichende Monate (jedes Jahr)“.
- Gilt für alle Arten (Einnahme, Ausgabe, Umbuchung) – der Dialog ist derselbe, und es schadet nicht.
- Ein Termin, der in diesen Kalendermonat fällt (maßgeblich ist der ursprüngliche Termin, nicht ein
  verschobenes Datum), bekommt jedes Jahr den **festen Betrag** – unabhängig von „Betrag ändern ab …“.
  Bei vierteljährlichen/jährlichen Buchungen wirkt es nur, wenn ein Termin in diesen Monat fällt.
- Vorrang: Änderung eines einzelnen Termins (Übersicht/Zeitleiste) vor Kalendermonat vor Stufe.
- Betrag muss größer 0 sein (eine Buchung über 0 € lässt sich nicht buchen); einzelne Termine
  weglassen geht weiter mit „Überspringen“.
- Wirkt überall, wo Termine rechnen: fällige Termine und „Buchen“, Monatsprognose, Zeitleiste,
  Jahresbudgets (erwartete Ausgaben). Anzeige in der Liste: „jeden November: 4.800,00 €“.

## D95 – Zukunftsmonat: erwartete Posten in zwei Blöcken
*Wunsch des Nutzers*

- Blättert man in der Übersicht in einen Folgemonat, stehen die erwarteten Posten jetzt getrennt:
  **„Wiederkehrende und geplante Buchungen“** und darunter **„Budgets“**, jeweils mit Summe –
  wie unter „Noch erwartet“ im laufenden Monat. Leere Blöcke entfallen.
- Am PC und am Handy gleich; Posten bleiben antippbar zum Ändern für diesen Monat.

## D96 – Wiederkehrende Buchungen: optionale Notiz statt Pflicht-Bezeichnung
*Wunsch des Nutzers: „analog dem Buchungsdialog“*

- Das Pflichtfeld **Bezeichnung** entfällt bei wiederkehrenden Buchungen. Dafür gibt es wie im
  Buchungsdialog eine optionale **Notiz** (Datenversion 15). Kein eindeutiger Mehrwert der Bezeichnung:
  Empfänger/Absender und Kategorie beschreiben eine Buchung bereits.
- **Titel** in Listen, „Noch erwartet“, Zeitleiste und Dialogen: „Empfänger/Absender · Notiz“; ist beides
  leer, die Unterkategorie bzw. „Umbuchung“ (`annahmeTitel`). Steht der Empfänger schon im Titel,
  wird er in der Zeile darunter nicht wiederholt.
- **Buchen** eines Termins übernimmt die Notiz in die echte Buchung (vorher die Bezeichnung).
- **Migration 15:** Die bisherige Bezeichnung wird zur Notiz (nichts geht verloren), das Feld
  `bezeichnung` entfällt. „Als wiederkehrend anlegen“ aus einer Buchung übernimmt deren Notiz.
- **Geplante Einmalbuchungen** behalten ihre Bezeichnung (nicht Teil des Wunsches).

## D97 – Wiederkehrende Buchungen nach Konto und Zeithorizont gruppiert
*Wunsch des Nutzers: „ähnlich wie die Budgets“ (D86/D91)*

- Im Annahmen-Tab stehen die wiederkehrenden Buchungen nach **Konto** gruppiert (eigene
  Konten-Reihenfolge, D84), darin in Untergruppen **Monatlich – Vierteljährlich – Jährlich**
  (nur vorhandene). Innerhalb einer Gruppe: Einnahmen, Ausgaben, Umbuchungen, jeweils alphabetisch.
- Eine Umbuchung steht beim abgebenden Konto, mit „→ Zielkonto“ in der Zeile.
- Konto und Intervall stehen in den Überschriften und werden in der Zeile nicht wiederholt
  („zum Monatsletzten“ bleibt sichtbar).
- Keine Zwischensummen (anders als bei Budgets) – nicht gewünscht.

## D98 – Umbuchungen optional einem Budget zuordnen
*Wunsch des Nutzers: Urlaubsbudget liegt auf dem Girokonto, bezahlt wird per PayPal*

- Problem ohne Zuordnung: Die Umbuchung Giro → PayPal senkt den Giro-Stand, das Budget gilt aber weiter als
  unverbraucht – die Prognose plant das Geld doppelt ein.
- Umbuchungen (echte, wiederkehrende und geplante) haben das optionale Feld **„Zählt gegen Budget“**
  (`budgetKategorieId`, eine Ausgaben-Hauptkategorie; Datenversion 16). Bei echten Umbuchungen steht es an
  beiden Hälften, verbraucht wird nur auf der **abgebenden** Seite.
- Die Umbuchung verbraucht dann das Monats- bzw. Jahresbudget dieser Kategorie auf dem abgebenden Konto:
  im laufenden Monat (echte + offene Termine), in der Zeitleiste, bei Jahresbudgets und in den
  Budgethinweisen. Gibt es dort kein Budget, passiert nichts.
- Sie bleibt eine **Umbuchung**: keine Ausgabe in Kennzahlen, „Alle Buchungen“-Auswertungen und Kontoständen.
  Die eigentliche Ausgabe wird auf dem Zielkonto (PayPal) gebucht.
- Anzeige: „… → PayPal · Budget Freizeit“ in „Alle Buchungen“ und in der Übersicht am PC. „Buchen“ eines
  wiederkehrenden oder geplanten Termins übernimmt die Zuordnung.
- Grenze: Hat auch das Zielkonto ein Budget dieser Kategorie, verbrauchen Umbuchung und spätere Ausgabe beide
  ihr jeweiliges Budget. Kein automatischer Hinweis (bewusst einfach gehalten).
- Die Löschsperre einer Hauptkategorie zählt solche Zuordnungen mit.

## D99 – Monatsbudget auch im laufenden Monat nur für diesen Monat ändern
*Wunsch des Nutzers; ergänzt D58 (bisher nur Zukunftsmonate)*

- In der Übersicht unter „Noch erwartet → Budgets“ lässt sich ein **Monatsbudget antippen**. Es öffnet sich
  derselbe Dialog wie bei Zukunftsmonaten: Betrag nur für den laufenden Monat (Einzel-Ausnahme),
  „Zurücksetzen“ führt auf den regulären Betrag zurück.
- **Abgeschlossene Monate** lassen sich nicht ändern (sie zeigen keine Budgets mehr).
- **Jahresbudgets** (D90) sind dort nicht antippbar – sie werden unter „Annahmen“ geändert.
- Kleiner Hinweis unter den Budgets: „Budget antippen, um es nur für diesen Monat zu ändern.“

## D100 – Vorgemerkte Buchungen dezenter
*Wunsch des Nutzers*

- Die Marke „vorgemerkt“ (Übersicht PC/Handy, Alle Buchungen, Projekte) hat einen eigenen, ruhigen Stil:
  grau, transparenter Hintergrund, feiner Rahmen (`.marke-vorgemerkt`) – statt der orangefarbenen
  Warnfarbe.
- Echte Hinweise wie „überfällig“, „heute fällig“ oder „einmalig“ behalten die Warnfarbe.


## D101 – Relevante Ausgaben: Spalte „Beleg“ statt „Gruppe“
*Wunsch des Nutzers; ändert die Tabelle aus D74*

- Die Tabellenspalte **„Gruppe“ entfällt**. Gruppen bleiben erhalten: Filter-Knöpfe über der Liste und
  das Feld „Gruppe“ im Dialog funktionieren wie bisher.
- Neue Spalte **„Beleg“ ganz rechts**: ohne Beleg ein grauer Strich; mit Beleg ein 📎-Knopf, der den
  Beleg **direkt öffnet** (Bild im Fenster, PDF in neuem Tab), ohne den Eintrag zu öffnen. Bei mehreren
  Belegen zeigt der Knopf die Anzahl und öffnet erst eine kleine Auswahlliste.
- Die bisherige 📎-Marke neben dem Empfänger entfällt dort (steht jetzt in der eigenen Spalte).
- Am Handy sitzt der Beleg-Knopf rechts neben dem Betrag.

## D102 – Sortierung in „Alle Buchungen“ korrigiert
*Fehlermeldung des Nutzers; ergänzt D73*

- **Fehler:** Nach „Betrag“ und dann „Datum“ stand Datum zwar an erster Stelle, wurde beim Vergleich aber
  übersprungen. Es entschied weiter der Betrag, und das Umschalten ↓/↑ beim Datum wirkte kaum.
- **Jetzt:** Jede Stufe vergleicht wirklich, also auch das Datum. Die zuletzt angeklickte Spalte entscheidet,
  die früheren gelten nur bei Gleichstand (z. B. am selben Tag nach Betrag).
- Bleibt danach noch Gleichstand: Datum, Erfassungszeit, interne ID, und zwar in der Richtung der
  Datums-Stufe, ohne Datums-Stufe „neueste zuerst“. Die Reihenfolge ist damit immer eindeutig und springt
  beim Neuzeichnen nicht.
- Unverändert: Eine neu angeklickte Spalte beginnt bei Datum und Betrag absteigend, bei Texten A–Z.
  Erneutes Antippen dreht die Richtung um. „Sortierung zurücksetzen“ führt auf Datum ↓.


## D103 – Sortierung in „Alle Buchungen“ nur nach einer Spalte
*Vereinfachung, vom Nutzer bestätigt; ersetzt die Mehrstufigkeit aus D73*

- Ein Klick auf einen Spaltenkopf sortiert **nur** nach dieser Spalte. Ein erneuter Klick dreht die
  Richtung um. Die erste Richtung ist bei Datum und Betrag absteigend, bei Texten A–Z.
- Bei Gleichstand steht immer die neueste Buchung oben. Bei Sortierung nach Datum gilt dessen
  Richtung, danach die Erfassungszeit.
- Grund: Die Stufen („Betrag, dann Kategorie, dann Datum“) waren schwer zu durchschauen und die
  Ursache des Fehlers aus D102. Die Funktion `sortiere()` kann intern weiterhin mehrere Stufen, die
  Oberfläche setzt aber nur eine.

## D104 – Vorlagen für häufige Buchungen
*Aus CLAUDE.md „Komfort“, vom Nutzer bestätigt: selbst anlegen, Betrag optional*

- Neue Sammlung `vorlagen` (Datenversion 17, DB-Struktur 9), wird mit Drive abgeglichen.
  Datensatz: Name, Art, Konto, bei Umbuchung Zielkonto und optional Budget, sonst optional
  Unterkategorie, Empfänger/Absender, Notiz, optional Betrag, Reihenfolge.
- **Anlegen:** im Buchungsdialog unten „☆ Als Vorlage speichern“. Es nimmt die gerade eingetragenen
  Werte, der Name wird aus dem Empfänger bzw. der Kategorie vorgeschlagen. „Betrag mitspeichern“
  ist ein Häkchen.
- **Benutzen:** Im Dialog „Neue Buchung“ stehen oben die Vorlagen als Knöpfe. Ein Tipp füllt die
  Felder und setzt den Cursor ins Betragsfeld. Beim Buchen eines fälligen Termins erscheint die
  Leiste nicht.
- **Verwalten:** Stammdaten → Vorlagen: ▲/▼ (wie bei Konten), Bearbeiten (Name, Konto, Kategorie,
  Empfänger, Notiz, Betrag), Löschen. Buchungen bleiben dabei unverändert.
- Archivierte oder gelöschte Konten/Kategorien einer Vorlage werden beim Anwenden weggelassen,
  dann gilt der normale Vorschlag.

## D105 – Kurzbefehle am App-Symbol
*Vom Nutzer bestätigt*

- Im Manifest stehen drei `shortcuts`: „Neue Ausgabe“ (`?neu=ausgabe`), „Neue Einnahme“
  (`?neu=einnahme`) und „Belegfoto“ (`?neu=beleg`). Unter Android erscheinen sie bei langem Druck auf
  das App-Symbol, unter Windows per Rechtsklick auf das Symbol der installierten App.
- Die App öffnet den Dialog erst **nach dem Anmelden** und entfernt den Zusatz danach aus der Adresse.
  Ein Neuladen öffnet ihn deshalb nicht noch einmal.
- „Belegfoto“ öffnet eine neue Ausgabe mit dem Belegfeld ganz oben. Die Kamera selbst darf der Browser
  erst nach einem Tipp öffnen, deshalb ist „📷 Foto aufnehmen“ ein Tipp entfernt.

## D106 – Belege per „Teilen“ an die App schicken (Android)
*Vom Nutzer bestätigt*

- Das Manifest meldet die App als Teilen-Ziel (`share_target`, POST an `./teilen`) für Bilder und PDF.
- Der Service Worker nimmt die Dateien an und legt sie kurz in einen eigenen Zwischenspeicher
  (`finanzapp-geteilt`, nur auf diesem Gerät, keine Finanzdaten außer der Belegdatei selbst). Dann
  öffnet er die App mit `?geteilt=1`.
- Nach dem Anmelden holt die App die Dateien, löscht den Zwischenspeicher und öffnet „Neue Buchung mit
  Beleg“ (Ausgabe) mit den angehängten Dateien. Sie werden verkleinert wie bei „Datei wählen“.
- Funktioniert nur, wenn die App auf dem Handy **installiert** ist („Zum Startbildschirm hinzufügen“).
  Nach dem Update muss sie einmal neu geöffnet werden, damit Android das neue Teilen-Ziel kennt.

## D107 – Verlauf: Vorjahresvergleich und Sparquote
*Seit D126 zeigt der Verlauf nur Ausgaben; die Sparquote entfällt dort.*
*Vom Nutzer bestätigt: im bestehenden „Verlauf je Monat“*

- Knopf „Vorjahr zeigen“: Neben jedem Monat stehen blasse Balken für denselben Monat ein Jahr früher,
  mit denselben Filtern außer dem Zeitraum. Monate vor der ersten erfassten Buchung zählen als „noch
  nicht erfasst“, nicht als 0 €. Der Knopf erscheint nur, wenn es Vorjahresdaten gibt.
- **Sparquote** = (Einnahmen − Ausgaben) / Einnahmen. Sie steht über dem Diagramm für den ganzen
  Zeitraum, je Monat im Tooltip und in der Tabellenansicht (dort auch eine Summenzeile). Ohne
  Einnahmen in der Auswahl gibt es keine Quote (z. B. bei Filter auf eine Ausgabenkategorie).
- Der Tooltip zeigt mit Vorjahr auch die Veränderung in Prozent.
- Am Handy beginnt das seitlich scrollbare Diagramm bei den neuesten Monaten.

## D108 – Vorschau vor dem Wiederherstellen eines Backups
*„Notfallprobe Datensicherung“, vom Nutzer bestätigt: Vorschau*

- „Wiederherstellen“ bei einem Drive-Backup ersetzt nicht mehr sofort. Die App lädt das Backup zuerst
  und zeigt jetzigen Stand und Backup nebeneinander: Anzahl Buchungen, letzte Buchung, Papierkorb,
  wiederkehrende, Budgets, geplante, Projekte, Vorlagen und den Kontostand je Konto bis heute.
  Unterschiede sind hervorgehoben.
- Erst der Knopf „Wiederherstellen“ im Dialog ersetzt die Daten. Wie bisher wird der jetzige Stand
  vorher als Backup gesichert. Das Backup wird dafür nur einmal heruntergeladen.

## D109 – Lange Erklärtexte hinter „ⓘ“
*Vereinfachung, vom Nutzer bestätigt*

- Lange, rein erklärende Absätze (Klasse `erklaerung`) sind eingeklappt. Ein kleines „ⓘ“ an der
  zugehörigen Überschrift blendet sie ein und aus. Was aufgeklappt ist, bleibt so, solange die App
  offen ist.
- Sichtbar bleiben kurze Hinweise, Statuszeilen und Warnungen (z. B. bei „Alles löschen“).
- Umgesetzt zentral in `ui.js` (`richteErklaerungenEin`). Ein Beobachter erledigt das auch für
  Bereiche, die sich später neu zeichnen.

## D110 – Niedrigster erwarteter Stand je Konto; offene Posten nach Einnahmen und Ausgaben
*Wunsch des Nutzers (Umbuchungen: geändert durch D111)*

- **Niedrigster erwarteter Stand** (laufender Monat, je Konto) = Kontostand heute
  − schon erfasste Belastungen mit späterem Datum im Monat
  − offene Ausgaben-Termine (wiederkehrend und geplant, auch überfällige) und abgehende Umbuchungen
  − offener Budgetrest.
  **Noch ausstehende Einnahmen und eingehende Umbuchungen zählen nicht mit.** Das ist der ungünstigste
  Fall, wenn Geld erst nach den Abbuchungen kommt.
- Er steht im Kontokopf dezent unter „Prognose Monatsende“, mit „– unter Mindestsaldo“, falls zutreffend.
  Der Tooltip erklärt die Berechnung. Bezeichnung: „Niedrigster erwarteter Stand“ (Wunsch des Nutzers:
  „zu erwartender niedrigster Saldo“).
- Die **Mindestsaldo-Warnung** für den laufenden Monat prüft diesen Wert statt der Prognose zum
  Monatsende („… kann bis zum Monatsende unter den Mindestsaldo fallen“). „Heute“ und die Zukunftsmonate
  (erster betroffener Monat, D48) bleiben wie bisher.
- In der Zwischensummen-Karte des laufenden Monats steht statt „Noch offene wiederkehrende Buchungen“
  jetzt getrennt: **„Noch offene Einnahmen“**, dann **„Noch offene Ausgaben“**, dann wie bisher
  „Noch offener Budgetrest“. Umbuchungen zählen je nach Richtung zu Einnahmen bzw. Ausgaben dieses
  Kontos. Zeilen mit 0 € entfallen.

## D111 – Niedrigster Stand mit Umbuchungen; ruhigere Farben in der Übersicht
*Wunsch des Nutzers (ändert D110)*

- Beim **niedrigsten erwarteten Stand** zählen Umbuchungen jetzt in **beide** Richtungen mit, also auch
  eingehende. Erfasste und offene gleichermaßen. Ausgelassen werden nur noch ausstehende **echte
  Einnahmen**: Stand heute + alle bis Monatsende erwarteten Bewegungen außer Einnahmen − offener Budgetrest.
- Kennzahlen oben in der Übersicht: Der Wert „Einnahmen“ steht in normaler Schrift, nicht mehr grün.
- Zwischensummen-Karte (Monatsblock): Die Beschriftungen „Einnahmen“ und „Noch offene Einnahmen“ haben
  dieselbe Schriftfarbe wie „Ausgaben“. Die Beträge bleiben farbig (Einnahmen grün, Ausgaben rot).

## D112 – Übersicht: Blöcke eingeklappt, feste Monatspfeile, Abstimmung rechts
*Wunsch des Nutzers*

- Die **Monatsübersicht** (Zwischensummen unter der Monatsauswahl) ist standardmäßig eingeklappt. Im Kopf
  steht das Ergebnis: im laufenden Monat „Prognose Monatsende“, in vergangenen Monaten „Stand Monatsende“.
  Der Block „Prognose“ in Zukunftsmonaten verhält sich genauso.
- **„Noch erwartet bis Monatsende“** ist ebenfalls standardmäßig eingeklappt. Im Kopf steht die Summe aus
  offenen Buchungen und Budgetrest. Die Summenzeilen „Wiederkehrende und geplante Buchungen“ und „Budgets“
  sind fett und etwas größer. Eine dünne Linie trennt die beiden Teile.
- Aufgeklappt bleibt aufgeklappt, solange die App offen ist (auch beim Blättern). Nach dem Neustart ist
  wieder alles zu. Baustein: `klappBereich()` in `ui.js`.
- Der **Monatsname** hat eine feste Breite, damit die Pfeile ‹ › beim Blättern nicht springen.
- **„Zuletzt abgestimmt …“** steht rechtsbündig in derselben Zeile wie „Niedrigster erwarteter Stand“.
  Am Handy rutscht es bei Platzmangel in die nächste Zeile, bleibt aber rechtsbündig.

## D113 – Übersicht nachgeschärft (Kontokopf, Klappköpfe, Handy)
*Rückmeldung des Nutzers zu D112, geprüft in Pixel-9-Pro-Breite (427 px), 800 px und 1280/1600 px*

- **Kontokopf als Raster:** oben links die Stände, oben rechts „Abstimmen“. Die letzte Zeile reicht über
  die volle Breite: links „Niedrigster erwarteter Stand“, **ganz rechts** (bündig mit dem Knopf)
  „Zuletzt abgestimmt …“. Am Handy rutscht der Abstimm-Text bei Platzmangel in eine eigene Zeile,
  bleibt aber rechtsbündig.
- **Köpfe der Klappblöcke immer einzeilig:** Der Titel kürzt sich notfalls mit „…“, der Betrag bricht nie um.
  Am Handy steht kürzer „Prognose 5.663,44 €“ bzw. „Monatsende …“. Die Marke „Annahme“ entfällt dort,
  die kursive Schrift kennzeichnet die Annahme.
- „Noch erwartet“ am Handy: Summenzeile „Wiederkehrend und geplant“ (statt der langen Fassung).
  Die Unterzeile eines Budgets bricht um, statt abgeschnitten zu werden.
- „Noch erwartet bis Monatsende“ erscheint wie bisher nur im **laufenden** Monat, nicht in
  abgeschlossenen Monaten und nicht unter „Alle Konten“.

## D114 – Übersicht: Feinschliff „Noch erwartet“, Kontoauswahl, Handy-Kopf
*Rückmeldung des Nutzers zu D113*

- „Noch erwartet bis Monatsende“: Die Budgetnamen sind jetzt kursiv wie die erwarteten Buchungen
  (Kennzeichen für Annahmen). Die Linien zwischen den einzelnen Budgets entfallen. Die Trennlinie
  zwischen „Wiederkehrend/geplant“ und „Budgets“ ist doppelt so dick (2 px). Die Summenzeilen haben
  mindestens die Schriftgröße der Einträge.
- **Kontoauswahl:** bleibt eine seitlich scrollbare Leiste. Der graue Strich darunter am Handy ist ihr
  Scrollbalken und zeigt, dass man wischen kann. Ein kurzer Umbau auf „umbrechen“ wurde auf Wunsch des
  Nutzers wieder zurückgenommen.
- **Kontokopf am Handy:** „Zuletzt abgestimmt …“ steht wieder in einer eigenen Zeile unter „Niedrigster
  erwarteter Stand“, linksbündig. Am PC bleibt es rechtsbündig in derselben Zeile (D113).

## D115 – Übersicht: Kacheln Einnahmen/Ausgaben entfallen, Budgettext kürzer
*Wunsch des Nutzers*

- Oben in der Übersicht stehen nur noch „Alle Konten heute“ und „Prognose Monatsende“. Die Kacheln
  „Einnahmen/Ausgaben des Monats“ entfallen. Die Monatswerte je Konto stehen in der Monatsübersicht,
  über alle Konten unter „Alle Buchungen“.
- „Noch erwartet“ → Budgets: Die Unterzeile endet mit „Rest x €“ (ohne „in der Prognose“).
- Die Trennlinie zwischen „Wiederkehrend/geplant“ und „Budgets“ ist 3 px dick.

## D116 – Kennzahl „Prognose Jahresende“
*Wunsch des Nutzers*

- Oben in der Übersicht steht neben „Alle Konten heute“ und „Prognose Monatsende“ jetzt
  **„Prognose Jahresende JJJJ“**: der erwartete Stand aller Konten am 31.12. des laufenden Jahres. Er kommt
  aus derselben Zeitleiste wie „Zukunft bis 2050“ (Dezember-Zeile unter „Alle Konten“), im Dezember
  selbst ist es die Prognose zum Monatsende. Kursiv, weil Annahme.
- **PC:** drei gleich breite Spalten. **Handy:** „Alle Konten heute“ etwas größer über die ganze Breite,
  darunter die beiden Prognosen nebeneinander.
- Funktion `prognoseJahresende(zl, heute)` in `prognose.js`, mit Test.

## D117 – Budgethinweise einklappbar
*Wunsch des Nutzers*

- Die Budgethinweise oben in der Übersicht stehen in einem gemeinsamen Klappblock mit Akzentstreifen.
  Eingeklappt zeigt er nur eine Zeile, zum Beispiel „2 Budgethinweise · Lebensmittel, Freizeit“.
- Standardmäßig ist er eingeklappt. Aufgeklappt bleibt er, solange die App offen ist (auch nach
  „Übernehmen/Ablehnen/Später“).
- Aufgeklappt sehen die Hinweise aus wie bisher: am PC nebeneinander, am Handy untereinander mit einer
  feinen Linie dazwischen.
- Grund: Am Handy füllten zwei Hinweise fast den ganzen ersten Bildschirm, die Konten kamen erst nach
  dem Wischen.

## D118 – „Alle Konten“: Aufstellung je Konto
*Wunsch des Nutzers*

- Bei „Alle Konten“ wiederholte der Block unter der Kontoauswahl nur die Werte aus dem Kopf. Er ist
  ersetzt durch eine **Aufstellung je Konto**: Stand heute, Prognose Monatsende und Prognose Jahresende,
  darunter die Summe „Alle Konten“. Das sind dieselben Werte wie oben im Kopf.
- Prognosen kursiv (Annahme). Werte unter dem Mindestsaldo des Kontos in Warnfarbe, mit Tooltip.
- Eine Zeile antippen öffnet das Konto.
- Am PC eine Tabelle mit vier Spalten. Am Handy steht der Kontoname über den drei Werten.
- Der Kopf (Kennzahlen oben) und „Zukunft bis 2050“ (alle Konten) bleiben unverändert.
- `prognoseJahresende(zl, heute, kontoId)` liefert den Wert auch je Konto, mit Test (Konten zusammen =
  Gesamtwert).

## D119 – „Alle Konten“ am Handy einzeilig ohne Jahresende
*Wunsch des Nutzers (ergänzt D118)*

- Am Handy zeigt die Aufstellung je Konto nur **Stand heute** und **Prognose Monatsende**, zusammen mit dem
  Kontonamen in **einer Zeile**. Lange Namen werden mit „…“ gekürzt.
- Am PC bleibt die Spalte „Jahresende“. Die Kennzahl „Prognose Jahresende“ oben im Kopf bleibt auf beiden
  Geräten (D116).

## D120 – „Alle Buchungen“: Summe, Anzahl, Ø; nur gebuchte; Kategorien aufklappbar
*Wunsch des Nutzers*

- **Summenblock** über „Liste/Analyse“: Einnahmen, Ausgaben, **Summe** (Einnahmen − Ausgaben, früher
  „Saldo“), **Anzahl** und **Ø je Buchung** (Summe ÷ Anzahl). Alles bezieht sich auf die gefilterten
  Einnahmen und Ausgaben. Umbuchungen zählen nicht mit, ihre Zahl steht als Hinweis daneben
  („1 Umbuchung nicht mitgezählt“).
- **Umbuchungen** sind in der Liste wie bisher ausgeblendet und per Knopf „Umbuchungen einblenden“
  sichtbar (D77/D78). Bisher wurden sie aber in „x Buchungen“ mitgezählt, jetzt nicht mehr.
- **Nur gebuchte:** Der Standardfilter zeigt nur Buchungen mit Status „gebucht“. Vorgemerkte holt man
  bei Bedarf über „Weitere Filter → Status“ dazu. „Filter zurücksetzen“ führt wieder auf „gebucht“.
  Geplante Einmalbuchungen und wiederkehrende Termine sind Annahmen und standen ohnehin nie in der Liste.
  Die Analyse folgt demselben Filter.
- **Kategorienfilter:** Zunächst stehen nur die Hauptkategorien da, jeweils mit „+“. Ein Tipp klappt
  ihre Unterkategorien auf, „−“ wieder zu. Ist schon eine Unterkategorie gewählt, ist ihre Gruppe
  offen. Die Beschriftung lautet jetzt „Lebensmittel (Ausgabe)“ statt „Lebensmittel – alle (Ausgabe)“.

## D121 – „Alle Buchungen“: nur bis heute; Kopf nur Summe, Anzahl, Ø
*Wunsch des Nutzers (ergänzt D120)*

- Liste und Analyse zeigen nur Buchungen **bis zum heutigen Datum**. Schon erfasste Buchungen mit späterem
  Datum (z. B. eine Lastschrift für den 20.) erscheinen erst an ihrem Tag. In der Übersicht und in der
  Prognose zählen sie wie bisher. Der Zeitraum im Summenblock endet entsprechend höchstens heute
  („01.11.2026 – 09.11.2026“).
- Der Summenblock zeigt nur noch **Summe, Anzahl und Ø je Buchung**. Die Kacheln „Einnahmen“ und
  „Ausgaben“ entfallen.

## D122 – „Alle Buchungen“: Zeitraum-Kacheln neu, Standard „Alles“
*Wunsch des Nutzers*

- Reihenfolge der Zeitraum-Kacheln: **Alles** (Standard) · **Dieses Jahr** · **Dieser Monat** ·
  **Letzte 3 Monate** · Eigener Zeitraum. „Vormonat“ und „Vorjahr“ entfallen als Kacheln.
- „Letzte 3 Monate“ sind die drei zuletzt **abgeschlossenen** Monate. Am 09.11.2026 sind das
  01.08.–31.10.2026, auch über den Jahreswechsel richtig.
- „Eigener Zeitraum“ bleibt, auch weil „Ansehen“ eines archivierten Jahres (Stammdaten) ihn nutzt.
- Bei „Alles“ steht im Summenblock „Alles bis TT.MM.JJJJ“ (nur Buchungen bis heute, D121).

## D123 – „Alle Buchungen“: Suche und Betrag oben, Status und „ohne Beleg“ entfallen
*Wunsch des Nutzers*

- **Suche, Betrag ab und Betrag bis** stehen ganz oben im Filterbereich, über den Zeitraum-Kacheln und den
  Auswahllisten. Am PC in einer Zeile, am Handy die Suche über den beiden Beträgen.
- Der Filter **Status** entfällt. Es werden ohnehin nur gebuchte Buchungen gezeigt (D120).
- **„Nur Buchungen ohne Beleg“** entfällt vorerst (CLAUDE.md angepasst). Die Filterlogik
  (`filter.ohneBeleg`) bleibt im Code, falls er wiederkommen soll.
- Damit gibt es keinen aufklappbaren Bereich „Weitere Filter“ mehr.

## D124 – „Alle Buchungen“: zunächst 20 Buchungen
*Wunsch des Nutzers*

- Die Liste zeigt zunächst die ersten **20 Buchungen** in der gewählten Sortierung. Darunter blendet der Knopf
  „Alle weiteren anzeigen (x Buchungen)“ den Rest auf einmal ein (bisher je 200).
- Ausgeblendete Umbuchungen zählen bei den 20 nicht mit (wie D79 in der Übersicht). Filtert man ausdrücklich
  nach Umbuchungen, zählen sie.
- Ein neuer Zeitraum, eine Filteränderung oder „Filter zurücksetzen“ beginnt wieder mit 20. Beim Sortieren
  und nach dem Bearbeiten einer Buchung bleibt die aufgeklappte Liste offen.
- Summenblock, Analyse und CSV-Export beziehen sich weiterhin auf **alle** gefilterten Buchungen.

## D125 – Analyse: Trend, Vorperiode, Ist vs. Budget, größte Buchungen, Filtern per Tipp
*Vorschläge, vom Nutzer bestätigt*

- **Kategorie antippen = filtern:** Eine Hauptkategorie antippen klappt wie bisher ihre Unterkategorien auf.
  Darunter steht „Alle Buchungen ‚X‘ anzeigen“. Eine Unterkategorie antippen wechselt direkt zur Liste,
  gefiltert auf diese Kategorie.
- **Trend je Kategorie:** Statt des Anteilsbalkens hat jede Hauptkategorie einen Mini-Verlauf der letzten
  12 Monate bis zum Ende des gezeigten Zeitraums (Tooltip: Monat und Betrag). Er folgt allen Filtern
  außer dem Zeitraum.
- **Vergleich zur Vorperiode** (Zusatzzeile je Hauptkategorie und bei „Gesamt“):
  - Dieses Jahr → Vorjahr bis zum gleichen Tag
  - Dieser Monat → Vormonat bis zum gleichen Tag
  - Letzte 3 Monate → die 3 Monate davor
  - Eigener Zeitraum → gleich viele Tage davor
  - „Alles“ hat keine Vorperiode.

  Liegt die Vorperiode vor der ersten erfassten Buchung, entfällt der Vergleich, weil „0 €“ dort
  irreführend wäre. Eine Abweichung über 10 % in die ungünstige Richtung steht in Warnfarbe.
- **Ist vs. Budget** (nur Ausgaben, nur mit abgeschlossenen Monaten): „Budget Ø x €/Monat · Ist ±y %“.
  Grundlage sind die Monatsbudgets in denselben Monaten wie der Ø, summiert über die gefilterten Konten
  (ohne Kontofilter: alle). Jahresbudgets zählen mit einem Zwölftel je Monat, ausgeschaltete Budgets
  nicht. Über dem Budget: Warnfarbe.
- **Größte Ausgaben/Einnahmen:** Neuer Block mit den 10 größten Einzelbuchungen der gewählten Art im
  Zeitraum. Antippen öffnet die Buchung.
- **Aufgeräumt:** Der Verlauf je Monat erscheint erst ab zwei Monaten. Die Kategorientabelle hat am PC
  Spaltenköpfe. Die Erklärung (inkl. Ø und Budget) liegt hinter „ⓘ“. Am Handy stehen Trend und Zusatzzeile
  unter dem Namen.
- Reine Rechenfunktionen in `auswertung.js` (`vorperiode`, `monatsSummenJeKategorie`, `letzteZwoelfMonate`,
  `budgetSchnitt`, `groessteBuchungen`, `veraenderungProzent`), mit Tests in `tests/analyse.test.js`.

## D126 – Analyse: Ausgaben-Verlauf mit Prognose, Art-Standard „Ausgaben“, farbige Filter
*Wunsch des Nutzers*

- **Art-Filter:** Standard ist jetzt „Ausgaben“. Ist genau eine Art gefiltert, entfällt in der Analyse der
  Umschalter Ausgaben/Einnahmen, die Analyse folgt dann der gefilterten Art.
- **Aktive Filter farbig:** Eine Auswahlliste mit Auswahl sowie ausgefüllte Felder (Suche, Betrag ab/bis)
  haben Akzent-Rahmen und -Hintergrund. Das gilt auch für den Standard „Ausgaben“, weil das ein echter
  Filter ist.
- **„Ausgaben je Monat“** (ersetzt „Verlauf je Monat“) zeigt nur Ausgaben, immer die **letzten 12 und die
  nächsten 12 Monate**, unabhängig vom gewählten Zeitraum. Die übrigen Filter gelten, die Art ist immer
  „Ausgabe“.
  - Vergangene Monate: gebuchte Ausgaben (kräftig).
  - Laufender Monat: gebucht (kräftig) und darauf gestapelt **heller** die noch erwarteten: vorgemerkte und
    später datierte erfasste Ausgaben, offene Ausgaben-Termine (wiederkehrend/geplant, auch überfällige)
    und der offene Budgetrest.
  - Folgemonate: nur die erwarteten Auszahlungen aus der Zeitleiste (Budgets, wiederkehrende, geplante,
    schon erfasste), im selben hellen Ton. Umbuchungen zählen nicht.
  - Erwartete Werte berücksichtigen Konto- und Kategoriefilter. Bei Filtern auf Empfänger, Suche oder
    Betrag lassen sie sich nicht zuordnen und entfallen (Hinweis im Diagramm).
  - „Vorjahr zeigen“ bleibt (blasse Balken). Die Sparquote entfällt, weil sie Einnahmen braucht. Die
    Tabellenansicht zeigt Gebucht, Erwartet und Zusammen. Am Handy rückt der laufende Monat in die Mitte.
- Rechenfunktion `ausgabenVerlauf()` in `auswertung.js` mit Test. Die Zeitleisten-Posten tragen dafür
  jetzt `hauptId`/`unterId`.

## D127 – Ausgaben je Monat: 6 zurück, 6 voraus; leere Monate weg; Monatsnamen lesbar
*Wunsch des Nutzers (ändert D126)*

- Das Diagramm zeigt die letzten **6 abgeschlossenen Monate**, den laufenden Monat und die **nächsten
  6 Monate** (statt 12/12).
- Vergangene Monate **vor der ersten erfassten Buchung** entfallen, weil es dort noch keine Werte gibt.
  Vorjahresbalken erscheinen nur, wo es im Vorjahr Ausgaben gibt. Der Knopf „Vorjahr zeigen“ erscheint
  wie bisher nur, wenn es überhaupt Vorjahreswerte gibt.
- **Monatsnamen:** Jeder Monat ist beschriftet, mit mehr Platz in der Höhe und etwas breiteren Spalten.
  Am PC wurden die Namen bisher unten teilweise abgeschnitten bzw. überlappten.

## D128 – Ausgaben je Monat ↔ Kategorien verknüpft; Diagramm nachgeschärft
*Wunsch des Nutzers (ändert D125)*

- **Diagramm:**
  - Mehr Abstand zur Legende, damit die oberste Gitterlinie mit ihrem Betrag frei steht.
  - Die Gitterlinien reichen über die ganze Breite, auch über die Zukunftsmonate und beim seitlichen
    Wischen am Handy.
  - Der **laufende Monat** hat einen leichten Rahmen.
- **Monatsbalken antippen** (nur Monate mit gebuchten Ausgaben): Alles darunter zeigt nur diesen Monat,
  also Summenblock, Kategorien/Empfänger, größte Ausgaben und auf Wunsch die Liste. Technisch ist das
  der Zeitraum „Eigener Zeitraum“ für diesen Monat. Der Balken ist hervorgehoben. Erneut antippen stellt
  den vorherigen Zeitraum wieder her, ebenso eine Zeitraum-Kachel oder „Filter zurücksetzen“. Das
  Diagramm selbst zeigt weiter seine 6+6 Monate.
- **Kategorie oder Empfänger antippen:** setzt den Filter und springt zur Einzelpostenliste. Das gilt
  jetzt auch für **Hauptkategorien**. Weil das Diagramm allen Filtern folgt, zeigt „Ausgaben je Monat“
  danach den Verlauf genau dieser Kategorie bzw. dieses Empfängers.
- **Hauptkategorien** haben wieder den Anteilsbalken, der Mini-Trend aus D125 entfällt, weil der Verlauf
  im Diagramm steht. Ein **„+“** links klappt die Unterkategorien auf, „−“ wieder zu. Der Knopf
  „Alle Buchungen ‚X‘ anzeigen“ entfällt, weil die Zeile selbst das jetzt tut.

## D129 – Analyse: Auswahl ohne Seitenwechsel, Anteile je Hauptkategorie, mehr Gitterlinien
*Wunsch des Nutzers (ändert D128)*

- **In der Analyse bleiben:** Kategorie (Haupt/Unter) oder Empfänger antippen setzt den Filter. Man bleibt
  auf der Analyse-Seite, Diagramm und Summen folgen sofort. Die Liste („Liste“) ist ebenfalls gefiltert.
  Die gewählte Zeile ist hervorgehoben. **Erneut antippen hebt den Filter auf.**
- **Unterkategorie gefiltert:** Die Kategorientabelle zeigt ihre Hauptkategorie trotzdem vollständig, also
  mit Gesamtsumme und allen Unterkategorien, aufgeklappt. Die gewählte Unterkategorie ist hervorgehoben.
  Liste, Summenblock und Diagramm bleiben auf die Unterkategorie gefiltert.
- **Anteil der Unterkategorien** bezieht sich immer auf ihre Hauptkategorie, zusammen 100 %. Die
  Hauptkategorien zeigen weiter ihren Anteil am Gesamtwert.
- **Gitterlinien** im Diagramm verdoppelt (9 statt 5 Linien, jeweils beschriftet).

## D130 – Analyse ruhiger: neutrale Balken, Art als Einfachauswahl, Diagramm nur bei Ausgaben
*Wunsch des Nutzers*

- **Alle Balken** in der Analyse (Diagramm, Kategorien, Empfänger) sind neutral grau-blau statt
  Orange/Blau. Gebucht ist kräftig, erwartet und Vorjahr sind heller (Deckkraft). Ersetzt die Farbwahl
  aus D30 für die Analyse.
- **Summenblock** über Liste/Analyse: Positive Werte (Einnahmen überwiegen) erscheinen im bisherigen
  Grün, negative weiter rot.
- **Art** ist eine **Einfachauswahl** (runde Punkte): Ausgaben, Einnahmen oder Umbuchungen.
  „Auswahl aufheben“ bedeutet alle Arten. Die Liste schließt sich nach der Wahl.
- Ist bei Art nur **Einnahmen oder Umbuchungen** gewählt, entfällt das Diagramm „Ausgaben je Monat“. Bei
  „Ausgaben“ oder allen Arten ist es da.
- **Laufender Monat** im Diagramm: kein Rahmen mehr, die Beschriftung ist fett und unterstrichen
  (ändert D128).

## D131 – Ausgaben je Monat nur als Diagramm
*Wunsch des Nutzers*

- Der Knopf „Als Tabelle“ und die Tabellenansicht von „Ausgaben je Monat“ entfallen. Das Diagramm reicht,
  die Einzelwerte zeigt der Tooltip beim Antippen bzw. Überfahren eines Balkens.

## D132 – Filter einzeilig, nur mögliche Optionen, keine Top-10 bei Empfänger-Filter
*Wunsch des Nutzers*

- **Einzeilig:** Die Anzeige eines Filters (z. B. „Gesundheit & Pflege, Versicherungen“), die Optionen in
  den Aufklapplisten und die Feldbeschriftungen bleiben einzeilig. Zu lange Texte werden mit „…“
  abgeschnitten, der volle Text steht im Tooltip.
- **Nur mögliche Optionen:** Beim Öffnen einer Auswahlliste (Konto, Art, Kategorie, Empfänger/Absender)
  stehen nur Werte zur Wahl, die zusammen mit allen **übrigen** Filtern noch Buchungen ergeben. Beispiel:
  Konto „Kreditkarte“ → bei Kategorie nur noch die Kategorien mit Kreditkarten-Buchungen. Schon Gewähltes
  bleibt immer sichtbar, damit man es abwählen kann. Gibt es nichts, steht ein kurzer Hinweis da.
- **Empfänger/Absender gefiltert:** Der Block „Größte Ausgaben/Einnahmen“ entfällt, weil er dann nur die
  Liste wiederholt.

## D133 – „Größte Ausgaben“ nur in der Ansicht „Nach Kategorien“
*Wunsch des Nutzers (ergänzt D132)*

- Der Block „Größte Ausgaben/Einnahmen“ erscheint nur, wenn die Analyse „Nach Kategorien“ zeigt. In der
  Ansicht „Nach Empfänger/Absender“ entfällt er, ebenso weiterhin bei einem Empfänger-Filter.

## D134 – Summenblock: drei Werte bündig ausgerichtet
*Wunsch des Nutzers*

- Über „Liste/Analyse“ stehen Summe, Anzahl und Ø je Buchung in drei gleich breiten Spalten:
  **Summe linksbündig, Anzahl mittig, Ø rechtsbündig**. Die Zeile schließt damit links und rechts mit dem
  Kasten ab. Bisher waren alle drei linksbündig, sodass „Ø je Buchung“ am Handy zu weit links wirkte.

## D135 – Anzahl: Zahl unter dem „A“, am Handy ohne „Buchungen“
*Wunsch des Nutzers (ergänzt D134)*

- Die Kachel „Anzahl“ steht als Block in der Mitte, Beschriftung und Zahl sind darin linksbündig. Die Zahl
  beginnt also genau unter dem „A“ von „Anzahl“.
- Am Handy steht nur die Zahl (z. B. „43“), am PC weiterhin „43 Buchungen“.

## D136 – Anzahl am Handy mittig
*Wunsch des Nutzers (ändert D135 nur fürs Handy)*

- Am Handy steht die Zahl unter „Anzahl“ wieder **mittig** (weiterhin ohne „Buchungen“). Am PC bleibt sie
  unter dem „A“, mit „Buchungen“.

## D137 – Umbuchungen innerhalb eines Tages am Ende
*Wunsch des Nutzers*

- In der Übersicht (Monatsliste je Konto, PC und Handy) und in „Alle Buchungen“ (Sortierung nach Datum,
  in beide Richtungen) stehen Umbuchungen innerhalb eines Tages immer **nach** den Einnahmen und Ausgaben.
- Der Stand je Zeile in der Übersicht folgt dieser Reihenfolge. Der Tagesstand am Abend ändert sich nicht.

## D138 – Annahmen: Zeilen einzeilig
*Wunsch des Nutzers*

- **Budgets** (PC und Handy) stehen in einer Zeile. Am PC: Kategorie · Rhythmus · Abweichungen (notfalls
  mit „…“ gekürzt), Betrag rechts. Am Handy nur Kategorie und Betrag.
- **Wiederkehrende Buchungen** (PC und Handy) stehen in einer Zeile. Am PC: Titel · nächster Termin ·
  Kategorie · Abweichungen. Am Handy der Empfänger/Absender (sonst der Titel, bei Umbuchungen das
  Zielkonto), notfalls gekürzt.
- **Geplante Einmalbuchungen**: Am Handy eine Zeile (Bezeichnung und Betrag), am PC wie bisher mit Datum
  und Zuordnung darunter.
- Der vollständige Text steht jeweils im Tooltip, Antippen öffnet wie bisher den Dialog.

## D139 – Annahmen: keine Budget-Summen, geplante Einmalbuchungen einzeilig
*Wunsch des Nutzers (ändert D86/D87, ergänzt D138)*

- Bei den Budgets entfallen die Zwischensummen je Konto und die Gesamtsumme für den Folgemonat.
- **Geplante Einmalbuchungen** stehen jetzt auch am PC in einer Zeile: Bezeichnung (mit Marken wie
  „überfällig“ oder Projekt) · Datum · Konto/Kategorie, Betrag rechts. Am Handy nur Bezeichnung und Betrag
  (die Projekt-Marke entfällt dort, „überfällig“ bleibt als Warnung).
