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

## D32 – Bargeldabhebungen
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
