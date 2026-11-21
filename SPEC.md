# Finanzapp: fachliche Spezifikation

Details zu Datenmodell, Oberfläche und Rechenlogik (aus CLAUDE.md verschoben). Begründungen stehen in DECISIONS.md unter der jeweiligen D-Nummer.

## Datenmodell
- Konto: Name, Anfangssaldo, Stichtag, Mindestsaldo, Reihenfolge (per ▲/▼, D84), Farbe (optional, D228: Kontoname dann als farbiges Etikett)
- Kategorie: Hauptkategorie mit Unterkategorien (Startsatz vorbelegt, in den
  Stammdaten anpassbar; Unterkategorien zwischen Hauptkategorien gleicher Art
  verschiebbar, D93; Unterkategorien zusammenführbar, D210)
- Buchung: Datum, Betrag, Art (Einnahme/Ausgabe), Konto, Empfänger/Absender
  (optional), Unterkategorie, Notiz, Projekt (optional), Belege (mehrere
  möglich, PDF/JPG), Status, Auslage bzw. Rückzahlung (D214)
- Umbuchung: zwei verknüpfte Buchungen (Abgang Konto A, Zugang Konto B).
  Zählt in Auswertungen NICHT als Einnahme oder Ausgabe. Optional einem Budget
  zugeordnet: verbraucht dann das Budget dieser Hauptkategorie auf dem
  abgebenden Konto (auch wiederkehrend/geplant, D98).
- Auslage (D214): Ausgabe, die ich zurückbekomme; Rückzahlungen sind Einnahmen mit Verweis darauf. Offene Auslagen und
  Rückzahlungen zählen nicht als Ausgabe/Einnahme und nicht gegen Budgets, nur im Kontostand.
- Aufrunden (D215): Ausgaben vom gewählten Konto bekommen eine Umbuchung bis zum vollen Euro aufs gewählte Sparkonto.
- Ausgleich (D216): Ausgaben auf z. B. PayPal bekommen eine Umbuchung in gleicher Höhe vom Girokonto (mit Budget-Zuordnung).
- Gekoppelte Umbuchung (D227): wiederkehrende Ausgabe mit „Gekoppelte Umbuchung von Konto“ → beim Buchen eines Termins Umbuchung in gleicher Höhe von dort (Häkchen, vorgewählt; ersetzt den Ausgleich D216), in der Prognose als abgeleitete Umbuchung (nie gespeichert).
- Budget: pro Hauptkategorie und Konto, monatlich, jährlich (in Tranchen, D90) oder einmalig (D85);
  je Kategorie und Konto entweder Monats- oder Jahresbudget
- Monatsnotiz (D165): ein Satz je Monat
- Vertrag (D148): Name, Empfänger (Pflicht, D150), Kategorie (Hauptkategorie, gruppiert, D194), Vertragsnummer, Beginn, Mindestlaufzeit oder Ende der Laufzeit (Datum, D225), Verlängerung,
  Kündigungsfrist (zum Laufzeit-, Monats- oder Quartalsende, D192), Erinnerung, gekündigt zum, Unterlagen; Klammer um Buchungen und wiederkehrende
  Buchungen (Feld „Vertrag“, rückwirkend über die wiederkehrende Buchung). Kosten (D219): / Monat nur aus monatlichen
  Zahlungen, / Jahr aus allen; Zwischensumme je Kategorie immer, Gesamtsumme = Summe der Verträge.
  Zeile (D220/D221): immer Monat · Quartal/Halbjahr · Jahr in dieser Reihenfolge, der Wert passend zur Zahlweise groß und gerade (wie die Gesamtsumme);
  laufende Verträge ohne wiederkehrende Buchung bekommen einen Hinweis.
  Aus einer wiederkehrenden Buchung ohne Vertrag: „Vertrag daraus anlegen …“ (Empfänger + Hauptkategorie vorausgefüllt, D224); in der Liste der wiederkehrenden Buchungen zeigt vorne 📄 (mit Vertrag) bzw. ○ (ohne) an, ob ein Vertrag zugeordnet ist (D226)
- Zähler (D233, Annahmen → Energie): Strom oder Gas (Gas in m³ mit Brennwert × Zustandszahl oder direkt in kWh), Vertrag,
  Ende des Abrechnungsjahres (Tag/Monat), Preise ab Datum (Arbeitspreis ct/kWh, Grundpreis €/Monat), Zählerstände,
  optional Vorjahresverbrauch und „bisher gezahlt bis“. Hochrechnung aufs Abrechnungsjahr: Strom gleichmäßig, Gas nach
  Gradtagszahlen (Promille je Monat 170/150/130/80/40/13⅓/13⅓/13⅓/30/80/120/160). Gezahlt = Ausgaben des Vertrags im
  Zeitraum (ohne geplante Nachzahlung); noch erwartet = offene Termine der wiederkehrenden Ausgabe des Vertrags.
  Vorschläge (Abschlag bis zur Abrechnung, Abschlag fürs neue Jahr = Kosten ÷ 12, auf volle Euro aufgerundet) werden
  erst nach Klick übernommen (neue Betragsstufe bzw. geplante Einmalbuchung). Hinweis „Zählerstände ablesen“ in der
  Übersicht vom Monatsletzten bis zum 5. des Folgemonats (je Monat wegklickbar, nur dieses Gerät).
- Wiederkehrende Buchung: Intervall (monatlich/vierteljährlich/halbjährlich/jährlich, D197),
  Start, optional Ende, Wertänderungen ab Datum, feste Abweichung je
  Kalendermonat (jedes Jahr, D94), einzelne Monate überspringen oder verschieben;
  keine Pflicht-Bezeichnung, sondern optionale Notiz wie bei Buchungen (D96)
- Geplante Einmalbuchung: bekannt, aber nicht wiederkehrend. Wird bei
  Eingang der echten Buchung als erledigt markiert und nicht doppelt gezählt
  (Soll/Ist-Abgleich).
- Gelöschte Buchungen kommen zuerst in einen Papierkorb.

## Oberfläche (5 Tabs)
1. Übersicht
   - Oben: Kasten „Übersicht“ (D164) mit Gesamtkontostand heute und prognostiziert zum Monats- und Jahresende (alle
     Konten, D116) ( Einnahmen/Ausgaben des Monats entfallen, D115), Warnung bei Unterschreiten des
     Mindestsaldos (mit erstem betroffenen Monat; im laufenden Monat nach dem
     niedrigsten erwarteten Stand ohne offene echte Einnahmen, D110/D111), max. 2 Budget-Hinweise
     (eingeklappt in einer Zeile, D117).
     Keine Kategorie-Kacheln (Budgetauslastung steht je Konto unter „Noch
     erwartet“, siehe DECISIONS.md D78)
   - „Alle Konten“: Aufstellung je Konto (heute, Monats-, Jahresende) mit Summe (D118)
   - Konten nebeneinander oder umschaltbar, je Konto Monatsansicht mit
     Zwischensummen; am PC Buchungen als Tabelle mit Tageszeilen (Tagesstand), am Handy
     einzeilig. Umbuchungen per Knopf ein-/ausblendbar (D75–D78)
   - Unter dem aktuellen Monat die Zukunftsmonate: Rest des laufenden Jahres
     immer sichtbar (komprimiert, aufklappbar), Folgejahre bis 2050 einzeln
     ein- und ausblendbar. Zukunftswerte optisch klar als Annahme
     gekennzeichnet (z. B. kursiv oder schraffiert).
2. Alle Buchungen (Umschalter Liste · Analyse · Belege, D191): über alle Konten filtern, sortieren, analysieren, Monats-/Jahresrückblick (D156); nur gebuchte
   Buchungen bis heute (D120/D121); Filter "ohne Beleg" vorerst entfallen (D123)
3. Projekte (Umschalter Projekte · Relevante Ausgaben · Auslagen, D153/D191/D214): Einmalausgaben (echte und geplante Buchungen) einem Projekt
   zuordnen, z. B. Umbau oder Urlaub; Gesamtkosten mit optionalem Rahmen.
   Projektausgaben zählen nicht gegen das Monatsbudget. (Ersetzt die
   früher geplanten Szenarien „Was wäre wenn“, siehe DECISIONS.md D51.)
4. Annahmen (Umschalter Budgets · Wiederkehrende · Verträge · Geplante, D160/D191/D193): wiederkehrende Buchungen, Budgets für die Zukunft, geplante
   Einmalbuchungen. Nur absolute Werte, KEINE Prozentsteigerungen oder
   Inflation. Ein/Aus-Schalter je Posten, um ihn für die Prognose
   auszuschalten, ohne etwas zu löschen.
5. Stammdaten (Umschalter Konten · Kategorien · Empfänger · Daten & Sicherheit · Notfall-Mappe · Papierkorb · Einstellungen, D180/D205)

## Rechenlogik
- Zukunftsmonate werden bei jedem Öffnen berechnet, nicht gespeichert.
- Budget: Es gilt pro Hauptkategorie, Konto und Monat. Nur Buchungen
  (echte, wiederkehrende, geplante) auf Unterkategorien auf DIESEM Konto
  verbrauchen es; Ausgaben auf Konten ohne eigenes Budget zählen gegen kein
  Budget (D85). Nicht verbrauchter Rest verfällt am Monatsende.
- Jahresbudget (D90): wirkt zu einem Monatsende, hälftig zum 30.06./31.12. oder
  je Quartalsende (Euro je Quartal). Rest einer abgelaufenen Tranche geht ins
  Restbudget zum 31.12., Überziehung verringert es; kein Übertrag ins neue Jahr.
- Monatsbudget mit festen Abweichungen je Kalendermonat (z. B. jeden Juli 200 €,
  D92); eine Einzel-Ausnahme für genau einen Monat hat Vorrang.
- Zukunft: Das Budget wirkt wie eine wiederkehrende Ausgabe in der vom
  Nutzer vorgegebenen Höhe.
- Laufender Monat: Prognose = echte Buchungen bisher + noch offener
  Budgetrest, mindestens aber die echten Buchungen.
- Budgethinweis (je Konto, D85): Wenn eine Hauptkategorie auf einem Konto 3 Monate in Folge über oder unter
  dem Budget liegt (Durchschnittsabweichung mehr als 10 %, beides einstellbar),
  erscheint eine ruhige Hinweiskarte (kein Pop-up) mit Zahlen und einem
  Vorschlag zur Anpassung. Nutzer wählt: übernehmen (ab welchem Monat),
  ablehnen, später erinnern. Die App ändert nie selbst etwas.
- Kontoabstimmung: Der Nutzer gibt den echten Bankstand ein, die App zeigt
  die Differenz zum berechneten Stand.

## Komfort und Sicherheit
- Schnellerfassung: Betrag, Kategorie, fertig. Datum Standard heute, Konto
  zuletzt benutzt. „Erfassen & weitere“, Rechnen im Betragsfeld, häufige Kategorien oben (D175). Kurzbefehle am
  App-Symbol (D105), Belege per „Teilen“ an die App schicken (Android, D106).
- Hinweise aus eigenen Buchungen, ohne KI: wiederkehrende Zahlungen erkennen (D182), ungewöhnlich hohe
  Ausgaben markieren (D183), Kategorie aus der Notiz vorschlagen (D184), Archiv-Erinnerung (D185),
  Preisänderung erkennen (D203), Hilfe bei der Kontoabstimmung (D204), Monatsabschluss-Checkliste (D206)
- Kamera-Button für Belegfoto, Bilder beim Hochladen verkleinern
- Automatisches Backup bei jedem Speichern (letzte 30 Stände), Export als
  CSV/Excel, kompletter Datenstand als Datei sichern und wiederherstellen (D178), wahlweise mit Passwort verschlüsselt (D212)
- App-Login: Pflicht-Passwort für alle Geräte (über Drive abgeglichen), je Gerät
  ersetzbar durch Passkey (siehe DECISIONS.md D83)
- Dark- und Hell-Modus umschaltbar, Schriftgröße je Gerät (D177); schlichtes, modernes Design

