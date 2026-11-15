# Finanzen – private Finanz-App (PWA)

Private Finanz-App für eine Person: Einnahmen und Ausgaben werden von Hand erfasst (keine Bankanbindung),
mehrere Konten, Budgets, Prognose bis 2050. Läuft im Browser am PC und als installierte App auf Android.
Daten liegen auf dem Gerät und in deinem Google Drive – nie im Programmcode.

Stand: **15.11.2026** · Entscheidung **D216** · Datenmodell-Version **24** · Cache `finanzapp-v117` · 189 Tests.
Ziele und Regeln: `CLAUDE.md` · fachliche Details: `SPEC.md` · alle Entscheidungen: `DECISIONS.md` · aktueller Stand: `NOTES.md`.

## Was die App kann (Überblick)

| Tab | Inhalt |
|---|---|
| **Übersicht** | Kontostände heute, zum Monats- und Jahresende; Monatsansicht je Konto mit Tagesständen; Zukunftsmonate bis 2050; Hinweise (Budgets, Erkennung, Monatsabschluss) |
| **Alle Buchungen** | Liste mit Filter und Sortierung, Analyse nach Kategorien oder Empfängern, Monats-/Jahresrückblick, Belege |
| **Projekte** | Projekte (z. B. Umbau, Urlaub), Relevante Ausgaben (z. B. für Garantie), **Auslagen** |
| **Annahmen** | Budgets, wiederkehrende Buchungen, Verträge, geplante Einmalbuchungen |
| **Stammdaten** | Konten, Kategorien, Empfänger, Daten & Sicherheit (Drive, App-Login, Export, Archiv), Notfall-Mappe, Papierkorb, Einstellungen |

Neu in Runde 9:
- **Auslagen (D214):** Ausgabe im Buchungsdialog unter „Weitere Angaben“ als „Auslage – bekomme ich zurück“ markieren;
  die Rückzahlung bei der Einnahme zuordnen (die App schlägt passende Auslagen vor). Offene Auslagen und Rückzahlungen
  zählen nicht als Ausgabe/Einnahme und nicht gegen Budgets. Übersicht unter Projekte → Auslagen.
- **Aufrunden auf volle Euro (D215):** Stammdaten → Einstellungen → „Aufrunden auf volle Euro“ einschalten und die Konten
  wählen (z. B. Girokonto → Sparkonto). Ausgaben mit Cent-Betrag bekommen dann eine Umbuchung über den Rest.
- **Ausgaben automatisch ausgleichen (D216):** Stammdaten → Einstellungen → „Ausgaben automatisch ausgleichen“, z. B.
  Ausgaben auf PayPal, ausgeglichen vom Girokonto. Jede PayPal-Ausgabe bekommt eine Umbuchung in gleicher Höhe;
  sie zählt gegen das Budget auf dem Girokonto.

Bei Aufrunden und Ausgleich steht im Buchungsdialog ein vorgewähltes Häkchen, das du im Einzelfall abwählen kannst.
Die Umbuchung folgt ihrer Ausgabe beim Ändern, Löschen und Wiederherstellen. Bisherige Buchungen bleiben unverändert.

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

## Google Drive einrichten (einmalig, ca. 10 Minuten)

Die App braucht eine **Client-ID** von Google. Sie ist kein Passwort, sondern sagt Google nur,
welche App sich anmelden möchte. Du trägst sie in der App ein; sie steht nicht im Code.

1. **Projekt anlegen:** <https://console.cloud.google.com> öffnen, mit deinem Google-Konto
   anmelden. Oben auf die Projektauswahl → **Neues Projekt** → Name z. B. `Finanzapp` → Erstellen.
   Danach sicherstellen, dass oben dieses Projekt ausgewählt ist.
2. **Drive-Schnittstelle einschalten:** Menü ☰ → **APIs und Dienste → Bibliothek** →
   „Google Drive API“ suchen → **Aktivieren**.
3. **Anmeldebildschirm einrichten:** Menü ☰ → **Google Auth Platform** (früher
   „OAuth-Zustimmungsbildschirm“) → **Jetzt starten**:
   - App-Name: `Finanzapp`, Support-E-Mail: deine Adresse
   - Zielgruppe: **Extern**
   - Kontakt-E-Mail: deine Adresse → Richtlinie akzeptieren → **Erstellen**
4. **Dich als Testnutzer eintragen:** In der Google Auth Platform → **Zielgruppe** →
   Testnutzer → **+ Nutzer hinzufügen** → deine Gmail-Adresse → Speichern.
   *(Optional: Unter „Zielgruppe“ auf **App veröffentlichen** klicken. Weil die App nur die
   unkritische Berechtigung „drive.file“ nutzt, ist dafür keine Prüfung durch Google nötig, und
   du musst die Freigabe nicht jede Woche neu bestätigen.)*
5. **Client-ID erstellen:** Google Auth Platform → **Clients** → **+ Client erstellen**:
   - Anwendungstyp: **Webanwendung**, Name: `Finanzapp Web`
   - **Autorisierte JavaScript-Quellen** → URI hinzufügen: `http://localhost:8080`
     (später zusätzlich die GitHub-Pages-Adresse, siehe unten)
   - Weiterleitungs-URIs: leer lassen → **Erstellen**
   - Die angezeigte **Client-ID** kopieren (endet auf `.apps.googleusercontent.com`).
     Ein „Clientschlüssel“ wird nicht gebraucht.
6. **In der App:** Stammdaten → **Daten & Sicherheit** → **Google Drive** → Client-ID einfügen → **Mit Google Drive
   verbinden**. Im Google-Fenster dein Konto wählen. Erscheint „Google hat diese App nicht
   überprüft“: auf **Weiter** (es ist ja deine eigene App) → Zugriff erlauben.

Danach legt die App in deinem Drive den Ordner **Finanzapp** an (Datendatei, `Belege/`,
`Backups/`, `Relevante Ausgaben/`). Sie sieht in deinem Drive **nur** Dateien, die sie selbst angelegt hat.

**Zweites Gerät (z. B. Handy):** Dort ebenfalls die Client-ID eintragen und verbinden. Die App
fragt dann, ob sie den Stand aus Drive übernehmen soll.

**Anmeldung:** Google erlaubt nur eine Anmeldung für etwa eine Stunde. Ist sie abgelaufen (oder
nach einem Neustart), erneuert die App sie beim nächsten Antippen von selbst – ein Google-Fenster
blitzt kurz auf. Danach gleicht sie automatisch ab (beim Speichern, wenn das Gerät wieder online
ist und wenn die App in den Vordergrund kommt). Zeigt der Wolken-Knopf „⬆ N nicht hochgeladen“,
sind Änderungen noch nicht in Drive: einfach darauf tippen. Ohne Anmeldung arbeitet die App ganz
normal auf dem Gerät weiter.

## Veröffentlichen mit GitHub Pages (für Android)

Damit die App auf dem Handy läuft, muss der **Programmcode** im Internet liegen (nur Code und
erfundene Testdaten – keine Finanzdaten, keine Zugangsdaten).

1. Auf <https://github.com> ein kostenloses Konto anlegen.
2. **New repository** → Name `FinanzApp` → **Public** (GitHub Pages ist für kostenlose Konten nur
   bei öffentlichen Repositorys möglich) → ohne README → **Create repository**.
3. Den Code hochladen (macht Claude nach deiner Freigabe; beim ersten Mal öffnet sich ein
   GitHub-Anmeldefenster).
4. Im Repository: **Settings → Pages** → Source **Deploy from a branch** → Branch `main`,
   Ordner `/ (root)` → **Save**. Nach 1–2 Minuten ist die App unter
   `https://DEINNAME.github.io/FinanzApp/` erreichbar.
5. In der Google Cloud Console beim Client unter **Autorisierte JavaScript-Quellen**
   `https://DEINNAME.github.io` ergänzen (ohne `/FinanzApp` am Ende).
6. **Android:** Die Adresse in Chrome öffnen → Menü ⋮ → **App installieren** bzw. **Zum
   Startbildschirm hinzufügen**. Dann in der App die Client-ID eintragen und verbinden.

Neue Versionen: Nach jeder Änderung wird der Code wieder hochgeladen (`git push`); die App holt
sich die neue Version beim nächsten Öffnen mit Internet.

## Testdaten und „Neu beginnen“

- **Testdaten** (erfundene Konten und Buchungen) gibt es nur beim Entwickeln auf `localhost`:
  Stammdaten → **Testdaten** → laden bzw. wieder löschen. In der veröffentlichten App fehlt dieser Bereich.
- **„Alles löschen und neu beginnen“** ist seit D140 ausgeblendet, weil die App mit echten Daten läuft.
  Zum Wiedereinblenden in `js/views/stammdaten.js` den Wert `ZEIGE_NEU_BEGINNEN` auf `true` setzen.

## App-Login

Die App ist nur mit Passwort nutzbar (Pflicht). Beim ersten Start legst du das Passwort fest
(mindestens 8 Zeichen). Es gilt für **alle Geräte**: Es wird (nur als Prüfwert, nie im Klartext) über
Google Drive abgeglichen. Auf einem weiteren Gerät beim ersten Start „Von Google Drive holen“ tippen.

- **Passkey:** Stammdaten → Daten & Sicherheit → **App-Login** → „Passkey einrichten“ (Fingerabdruck, Gesicht bzw.
  Windows Hello) – je Gerät einmal. Das Passwort funktioniert immer zusätzlich.
- **Wann erneut anmelden:** dort je Gerät wählbar (Standard: nach 5 Minuten im Hintergrund).
- **Passwort ändern:** dort mit dem aktuellen Passwort; gilt nach dem Abgleich überall.
- **Passwort vergessen:** auf dem Anmeldebildschirm „Passwort vergessen?“ → mit dem Google-Konto
  anmelden, in dem deine Finanzen-Daten liegen → neues Passwort festlegen. Die Daten bleiben erhalten.
- Der Login schützt den Zugang; die Daten im Browser werden nicht verschlüsselt.

## Archiv alter Jahre

Stammdaten → Daten & Sicherheit → **Archiv alter Jahre**: Ein abgeschlossenes Jahr wandert – nur wenn du es auslöst –
in eine eigene Datei in Google Drive; die Konten starten danach mit dem Jahresendstand. Unter
„Alle Buchungen“ sind archivierte Jahre weiter in Liste und Analyse enthalten (nur lesen). Das
zuletzt archivierte Jahr lässt sich von Hand zurückholen.

## Weitere Befehle

| Befehl | Was er tut |
|---|---|
| `npm test` | automatische Tests (Beträge, Datum, Migrationen, Prognose, Budgets, Abgleich, Export, Archiv, Auslagen, Aufrunden, Ausgleich) |
| `npm run icons` | App-Symbole neu erzeugen |

## Ordner

```
index.html, manifest.webmanifest, sw.js   App-Rahmen und PWA-Dateien (sw.js: Offline-Cache, Version hochzählen)
server.js                                  lokaler Testserver
css/style.css                              Design (Hell/Dunkel)
js/app.js, js/theme.js                     Start, Tab-Navigation, Hell/Dunkel
js/db.js, js/migrationen.js                Datenbank (mit Zwischenspeicher), Versionen, Migrationen
js/format.js, js/dom.js, js/ui.js          Euro-/Datumsformat, Bausteine der Oberfläche
js/buchungen.js                            Buchungsregeln, Papierkorb, Aufrunden (D215), Ausgleich (D216)
js/rechnen.js                              Kontostände, Monatssummen, Zählregel für Auslagen (zaehltCent)
js/auslagen.js                             Auslagen und Rückzahlungen (D214)
js/auswertung.js, js/rueckblick.js         Filter, Sortierung, Analysen, Monats-/Jahresrückblick
js/prognose.js, js/annahmen.js             Budgets, wiederkehrende/geplante Buchungen, Projekte, Prognose
js/jahresbudget.js                         Jahresbudgets in Tranchen (D90)
js/vertraege.js                            Verträge, Kündigungsfristen (D148)
js/erkennung.js, js/abstimmhilfe.js        Hinweise ohne KI: Erkennung, Ausreißer, Preisänderung, Abstimmhilfe
js/abschluss.js                            Monatsabschluss-Checkliste (D206)
js/empfaenger.js                           Empfänger vereinheitlichen und zusammenfassen (D205)
js/kategorien.js, js/konten.js, js/farben.js  Kategorien verschieben/zusammenführen, Konto-Reihenfolge, Farben
js/relevant.js, js/belegliste.js           Relevante Ausgaben, Belegliste
js/monatsnotizen.js, js/suche.js           Monatsnotizen, Suche
js/notfall.js                              Notfall-Mappe
js/sync/                                   Google Drive: Anmeldung, Abgleich, Zusammenführen, Backups
js/export.js, js/datensicherung.js         CSV-Export, Sicherungsdatei, Vorschau vor dem Wiederherstellen
js/verschluesselung.js                     Sicherungsdatei mit Passwort (D212)
js/login.js, js/sperre.js, js/archiv.js    App-Login (Passwort, Passkey), Archiv alter Jahre
js/startdaten.js, js/testdaten.js          Kategorie-Startsatz, erfundene Testdaten (nur localhost)
js/views/                                  die Tabs und Dialoge
tests/                                     automatische Tests
tools/                                     Hilfsskripte (App-Symbole, Drive-Attrappe für Tests)
```

## Wo liegen die Daten?

- **Auf dem Gerät** im Browser (IndexedDB) – die App funktioniert auch offline.
- **In deinem Google Drive** (wenn verbunden): Ordner `Finanzapp` mit der Datendatei, den
  Belegen und den Backups (die letzten 30 Stände und je einer pro Tag der letzten 30 Tage).
- Unter Stammdaten → Daten & Sicherheit → **Export** gibt es die Buchungen als CSV für Excel und den kompletten
  Datenstand als Sicherungsdatei (wahlweise mit Passwort verschlüsselt).
