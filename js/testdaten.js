// Erfundene Testdaten zum Ausprobieren. Alle Testdatensätze tragen das Feld
// testdaten: true; Konten und Kategorien zusätzlich "(Test)" im Namen.
// "Testdaten löschen" entfernt genau diese Datensätze (plus alles, was an Testkonten
// und Testkategorien hängt), eigene Einträge bleiben unberührt.
//
// Etappe 4: Die Daten decken die letzten drei abgeschlossenen Monate plus den laufenden
// Monat ab. Budgets sind so gewählt, dass zwei Budgethinweise erscheinen
// (Lebensmittel deutlich über, Freizeit deutlich unter Budget), und ein Termin
// ("Internet & Telefon") ist im laufenden Monat bewusst noch nicht gebucht.
// Etappe 5: geplante Einmalbuchungen und zwei Projekte (Umbau Bad, Sommerurlaub).

import * as db from './db.js';
import { neueKategorie } from './startdaten.js';
import { baueBuchungen } from './buchungen.js';
import { heuteIso } from './format.js';
import { plusMonate, monatsende } from './prognose.js';
import { plusMonate as plusMonateIso } from './vertraege.js';

const SAMMLUNGEN_MIT_TESTDATEN = ['konten', 'kategorien', 'buchungen', 'budgets', 'wiederkehrend', 'geplant', 'projekte', 'relevant', 'vertraege', 'sparziele'];

function konto(name, anfangssaldoCent, stichtag, mindestsaldoCent, archiviert = false) {
  const jetzt = new Date().toISOString();
  return {
    id: crypto.randomUUID(), name, anfangssaldoCent, stichtag, mindestsaldoCent, archiviert,
    erstelltAm: jetzt, geaendertAm: jetzt, testdaten: true,
  };
}

export function hatTestdaten(...listen) {
  return listen.some((liste) => (liste ?? []).some((x) => x.testdaten));
}

export async function ladeTestdaten() {
  const alt = await Promise.all(SAMMLUNGEN_MIT_TESTDATEN.map((s) => db.alle(s)));
  if (hatTestdaten(...alt)) return false;
  const kategorien = alt[1];
  const jetzt = new Date().toISOString();

  // Zeitraum: drei abgeschlossene Monate + laufender Monat
  const heute = heuteIso();
  const aktuell = heute.slice(0, 7);
  const monate = [-3, -2, -1, 0].map((n) => plusMonate(aktuell, n));
  const stichtag = `${monate[0]}-01`;

  const giro = konto('Girokonto (Test)', 245000, stichtag, 50000);
  const tagesgeld = konto('Tagesgeld (Test)', 800000, stichtag, null);
  const kredit = konto('Kreditkarte (Test)', -32050, stichtag, -150000);
  const neueKonten = [giro, tagesgeld, kredit, konto('Altes Sparbuch (Test)', 15000, '2020-01-01', null, true)];
  await db.speichere('konten', neueKonten);

  const extra = { testdaten: true };
  const haustier = neueKategorie({ name: 'Haustier (Test)', art: 'ausgabe', extra });
  const neueKats = [
    haustier,
    neueKategorie({ name: 'Futter', elternId: haustier.id, extra }),
    neueKategorie({ name: 'Tierarzt', elternId: haustier.id, extra }),
  ];
  const einkommen = kategorien.find((k) => !k.elternId && k.name === 'Einkommen');
  if (einkommen) neueKats.push(neueKategorie({ name: 'Flohmarkt (Test)', elternId: einkommen.id, extra }));
  await db.speichere('kategorien', neueKats);

  const alleKats = [...kategorien, ...neueKats];
  const hauptId = (name) => alleKats.find((k) => !k.elternId && k.name === name)?.id;
  const kat = (haupt, unter) => {
    const hk = hauptId(haupt);
    return hk && alleKats.find((k) => k.elternId === hk && k.name === unter)?.id;
  };

  // Erfundene Empfänger/Absender je Unterkategorie (Datenversion 8)
  const PARTNER = {
    Gehalt: 'Muster GmbH', Miete: 'Vermietung Beispiel', Strom: 'Stadtwerke Muster',
    'Internet & Telefon': 'Telefon AG (Test)', 'Restaurant & Café': 'Pizzeria Beispiel',
    'Kraftstoff & Laden': 'Tankstelle Muster', Futter: 'Tierbedarf Muster', 'Abos & Streaming': 'Streaming-Dienst (Test)',
    'Lieferdienste (Pizza & Co.)': 'Lieferdienst Beispiel', 'Bäcker & Markt': 'Bäckerei Muster',
    Rundfunkbeitrag: 'Beitragsservice (Test)', 'Kfz-Versicherung': 'Versicherung Muster',
  };

  /* ---------- Wiederkehrende Buchungen ---------- */
  const wk = {};
  const wiederkehrend = (schluessel, notiz, art, k, betragCent, intervall, start, extraFelder = {}) => {
    if (art !== 'umbuchung' && !extraFelder.kategorieId) return; // Kategorie fehlt → weglassen
    wk[schluessel] = {
      id: crypto.randomUUID(), notiz, art, kontoId: k.id, gegenkontoId: null, kategorieId: null,
      intervall, start, ende: null, stufen: [{ ab: start, betragCent }], ausnahmen: [],
      monatsletzter: false, aktiv: true, partner: '',
      erstelltAm: jetzt, geaendertAm: jetzt, testdaten: true, ...extraFelder,
    };
    const unterName = alleKats.find((k) => k.id === wk[schluessel].kategorieId)?.name;
    wk[schluessel].partner = PARTNER[unterName] ?? '';
  };
  const tag = (monat, t) => `${monat}-${String(t).padStart(2, '0')}`;
  wiederkehrend('gehalt', 'Gehalt', 'einnahme', giro, 320000, 'monatlich', tag(monate[0], 1), { kategorieId: kat('Einkommen', 'Gehalt') });
  wiederkehrend('spar', 'Sparrate', 'umbuchung', giro, 20000, 'monatlich', tag(monate[0], 2), { gegenkontoId: tagesgeld.id });
  wiederkehrend('miete', 'Miete', 'ausgabe', giro, 95000, 'monatlich', tag(monate[0], 3), { kategorieId: kat('Wohnen', 'Miete') });
  if (wk.miete) wk.miete.stufen.push({ ab: `${Number(heute.slice(0, 4)) + 1}-01-03`, betragCent: 99000 }); // Mieterhöhung
  wiederkehrend('strom', 'Strom-Abschlag', 'ausgabe', giro, 8500, 'monatlich', tag(monate[0], 3), { kategorieId: kat('Wohnen', 'Strom') });
  wiederkehrend('internet', 'Internet & Telefon', 'ausgabe', giro, 3999, 'monatlich', tag(monate[0], 5), { kategorieId: kat('Wohnen', 'Internet & Telefon') });
  wiederkehrend('streaming', 'Streaming-Abo', 'ausgabe', kredit, 1299, 'monatlich', tag(monate[0], 14), { kategorieId: kat('Freizeit', 'Abos & Streaming') });
  wiederkehrend('ausgleich', 'Ausgleich Kreditkarte', 'umbuchung', giro, 25000, 'monatlich', tag(monate[0], 15), { gegenkontoId: kredit.id });
  wiederkehrend('rundfunk', 'Rundfunkbeitrag', 'ausgabe', giro, 5508, 'vierteljaehrlich', tag(aktuell, 15), { kategorieId: kat('Wohnen', 'Rundfunkbeitrag') });
  wiederkehrend('kfz', 'Kfz-Versicherung', 'ausgabe', giro, 48000, 'jaehrlich', `${Number(heute.slice(0, 4)) + 1}-01-10`, { kategorieId: kat('Versicherungen', 'Kfz-Versicherung') });
  /* ---------- Verträge (D148, erfunden) ---------- */
  // Internet: 24 Monate ab vor knapp 2 Jahren → Kündigungsfrist naht (Hinweis oben in der Übersicht)
  const jahr = Number(heute.slice(0, 4));
  const vertrag = (felder) => ({
    id: crypto.randomUUID(), anbieter: '', vertragsnummer: '', beginn: null, mindestlaufzeitMonate: null, verlaengerungMonate: null,
    fristAnzahl: null, fristEinheit: 'monate', erinnerungTage: 28, gekuendigtZum: null, erinnerungAusBis: null, notiz: '',
    belege: [], erstelltAm: jetzt, geaendertAm: jetzt, testdaten: true, ...felder,
  });
  const beginnInternet = `${jahr - 2}-${heute.slice(5, 7)}-01`;
  const vertraege = {
    internet: vertrag({ name: 'Internet (Test)', anbieter: 'Telefon AG (Test)', vertragsnummer: 'TEST-4711', beginn: plusMonateIso(beginnInternet, 1),
      mindestlaufzeitMonate: 24, verlaengerungMonate: 1, fristAnzahl: 1, fristEinheit: 'monate' }),
    strom: vertrag({ name: 'Strom (Test)', anbieter: 'Stadtwerke Muster', beginn: `${jahr - 3}-03-01`, mindestlaufzeitMonate: 12,
      verlaengerungMonate: 12, fristAnzahl: 6, fristEinheit: 'wochen' }),
    streaming: vertrag({ name: 'Streaming (Test)', anbieter: 'Streaming-Dienst (Test)', fristAnzahl: 1, fristEinheit: 'monate', notiz: 'Monatlich kündbar' }),
    kfz: vertrag({ name: 'Kfz-Versicherung (Test)', anbieter: 'Versicherung Muster', beginn: `${jahr - 5}-01-01`, mindestlaufzeitMonate: 12,
      verlaengerungMonate: 12, fristAnzahl: 1, fristEinheit: 'monate' }),
  };
  await db.speichere('vertraege', Object.values(vertraege));
  // Sparziele (D157, erfunden): Notgroschen auf dem Tagesgeld bis Ende nächsten Jahres
  await db.speichere('sparziele', [{
    id: crypto.randomUUID(), name: 'Notgroschen (Test)', kontoId: tagesgeld.id, zielCent: 1000000, zielDatum: `${jahr + 1}-12-31`,
    notiz: '', abgeschlossen: false, erstelltAm: jetzt, geaendertAm: jetzt, testdaten: true,
  }]);
  if (wk.internet) wk.internet.vertragId = vertraege.internet.id;
  if (wk.strom) wk.strom.vertragId = vertraege.strom.id;
  if (wk.streaming) wk.streaming.vertragId = vertraege.streaming.id;
  if (wk.kfz) wk.kfz.vertragId = vertraege.kfz.id;
  await db.speichere('wiederkehrend', Object.values(wk));

  /* ---------- Buchungen ---------- */
  const vorlagen = [
    // [Tag, Art, Konto, Cent, Hauptkategorie, Unterkategorie / Gegenkonto, Notiz, wiederkehrend, nur abgeschlossene Monate]
    [1, 'einnahme', giro, 320000, 'Einkommen', 'Gehalt', '', 'gehalt'],
    [2, 'umbuchung', giro, 20000, null, tagesgeld, 'Sparrate', 'spar'],
    [3, 'ausgabe', giro, 95000, 'Wohnen', 'Miete', '', 'miete'],
    [3, 'ausgabe', giro, 8500, 'Wohnen', 'Strom', 'Abschlag', 'strom'],
    [5, 'ausgabe', giro, 3999, 'Wohnen', 'Internet & Telefon', '', 'internet', true],
    [6, 'ausgabe', giro, 6240, 'Lebensmittel', 'Supermarkt', ''],
    [8, 'ausgabe', kredit, 4580, 'Freizeit', 'Restaurant & Café', ''],
    [10, 'ausgabe', giro, 5800, 'Mobilität', 'Kraftstoff & Laden', ''],
    [12, 'ausgabe', giro, 2390, 'Haustier (Test)', 'Futter', ''],
    [13, 'ausgabe', giro, 4815, 'Lebensmittel', 'Supermarkt', ''],
    [14, 'ausgabe', kredit, 1299, 'Freizeit', 'Abos & Streaming', '', 'streaming'],
    [15, 'umbuchung', giro, 25000, null, kredit, 'Ausgleich Kreditkarte', 'ausgleich'],
    [18, 'ausgabe', giro, 2450, 'Freizeit', 'Lieferdienste (Pizza & Co.)', ''],
    [20, 'ausgabe', giro, 7190, 'Lebensmittel', 'Supermarkt', ''],
    [27, 'ausgabe', giro, 3999, 'Lebensmittel', 'Supermarkt', ''],
  ];

  const datensaetze = [];
  for (const monat of monate) {
    for (const [t, art, k, betragCent, haupt, unter, notiz, wkSchluessel, nurAbgeschlossen] of vorlagen) {
      const datum = tag(monat, t);
      if (datum > heute) continue;
      if (nurAbgeschlossen && monat === aktuell) continue; // bleibt im laufenden Monat "fällig"
      // Supermarkt abwechselnd bei zwei erfundenen Märkten, ein Einkauf je Monat ohne Angabe
      const supermarkt = { 6: 'Supermarkt Muster', 13: 'Discounter Beispiel', 20: 'Supermarkt Muster', 27: '' };
      const partner = unter === 'Supermarkt' ? supermarkt[t] : (PARTNER[unter] ?? '');
      const eingabe = { art, betragCent, datum, kontoId: k.id, notiz, partner, status: 'gebucht' };
      if (art === 'umbuchung') eingabe.gegenkontoId = unter.id;
      else {
        eingabe.kategorieId = kat(haupt, unter);
        if (!eingabe.kategorieId) continue;
      }
      const vorlage = wk[wkSchluessel];
      if (vorlage) {
        eingabe.wiederkehrendId = vorlage.id;
        eingabe.faelligAm = datum;
      }
      datensaetze.push(...baueBuchungen(eingabe, { konten: neueKonten }));
    }
  }
  const baecker = kat('Lebensmittel', 'Bäcker & Markt');
  if (baecker) {
    datensaetze.push(...baueBuchungen(
      { art: 'ausgabe', betragCent: 3320, datum: heute, kontoId: giro.id, kategorieId: baecker, notiz: 'Kartenzahlung', partner: 'Bäckerei Muster', status: 'vorgemerkt' },
      { konten: neueKonten },
    ));
  }
  await db.speichere('buchungen', datensaetze.map((b) => ({ ...b, testdaten: true })));

  /* ---------- Budgets ---------- */
  const budget = (hauptName, k, betragCent) => {
    const id = hauptId(hauptName);
    return id && {
      id: crypto.randomUUID(), kategorieId: id, kontoId: k.id, typ: 'wiederkehrend', notiz: '', aktiv: true,
      startMonat: monate[0], endMonat: null, stufen: [{ ab: monate[0], betragCent }],
      erstelltAm: jetzt, geaendertAm: jetzt, testdaten: true,
    };
  };
  const budgets = [
    budget('Lebensmittel', giro, 15000), // Ist ca. 222 € → deutlich drüber → Hinweis
    budget('Freizeit', kredit, 10000), // Ist auf der Kreditkarte ca. 59 € → deutlich drunter → Hinweis (D85: Giro zählt nicht)
    budget('Mobilität', giro, 6000), // Ist 58 € → knapp drunter → kein Hinweis
    budget('Wohnen', giro, 110000), // Ist ca. 1.075 € → knapp drunter → kein Hinweis
  ];
  const sonstiges = hauptId('Sonstiges');
  if (sonstiges) {
    budgets.push({
      id: crypto.randomUUID(), kategorieId: sonstiges, kontoId: giro.id, typ: 'einmalig', notiz: 'Weihnachtsgeschenke', aktiv: true,
      monat: plusMonate(aktuell, 1), betragCent: 30000, erstelltAm: jetzt, geaendertAm: jetzt, testdaten: true,
    });
  }
  // Jahresbudget (D90): Kleidung auf der Kreditkarte, hälftig zum 30.06. und 31.12.
  const kleidung = hauptId('Kleidung');
  if (kleidung) {
    budgets.push({
      id: crypto.randomUUID(), kategorieId: kleidung, kontoId: kredit.id, typ: 'jaehrlich', notiz: '', aktiv: true,
      startJahr: Number(heute.slice(0, 4)), endJahr: null, verteilung: 'halbjahr', betragCent: 60000,
      erstelltAm: jetzt, geaendertAm: jetzt, testdaten: true,
    });
  }
  await db.speichere('budgets', budgets.filter(Boolean));

  /* ---------- Etappe 5: geplante Einmalbuchungen und Projekte ---------- */
  const projekt = (name, rahmenCent, notiz) => ({
    id: crypto.randomUUID(), name, rahmenCent, notiz, abgeschlossen: false, erstelltAm: jetzt, geaendertAm: jetzt, testdaten: true,
  });
  const bad = projekt('Umbau Bad (Test)', 1200000, 'Neue Fliesen, Dusche und Waschtisch');
  const urlaub = projekt('Sommerurlaub (Test)', 350000, '');
  await db.speichere('projekte', [bad, urlaub]);

  const geplant = (bezeichnung, art, k, betragCent, datum, kategorieId, projektId = null) => kategorieId && ({
    id: crypto.randomUUID(), bezeichnung, art, kontoId: k.id, gegenkontoId: null, kategorieId, datum, betragCent,
    erledigtAm: null, aktiv: true, projektId, partner: '', erstelltAm: jetzt, geaendertAm: jetzt, testdaten: true,
  });
  const inTagen = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const reparatur = kat('Wohnen', 'Einrichtung & Reparaturen');
  const reise = kat('Freizeit', 'Urlaub');
  const architekt = geplant('Planung Badumbau', 'ausgabe', giro, 80000, tag(monate[2], 18), reparatur, bad.id);
  await db.speichere('geplant', [
    geplant('Zahnarzt-Rechnung', 'ausgabe', giro, 8500, inTagen(2), kat('Gesundheit & Pflege', 'Arzt & Zuzahlungen')),
    geplant('Autoreparatur', 'ausgabe', giro, 60000, tag(plusMonate(aktuell, 2), 15), kat('Mobilität', 'Werkstatt & Wartung')),
    geplant('Steuererstattung', 'einnahme', giro, 45000, tag(plusMonate(aktuell, 5), 20), kat('Einkommen', 'Erstattungen')),
    // Projekt "Umbau Bad": eine Planung ist schon (teurer) gebucht, eine ist überfällig, zwei kommen noch
    architekt,
    geplant('Fliesen', 'ausgabe', giro, 120000, inTagen(-3), reparatur, bad.id),
    geplant('Handwerker Rechnung', 'ausgabe', giro, 600000, tag(plusMonate(aktuell, 1), 20), reparatur, bad.id),
    geplant('Dusche & Waschtisch', 'ausgabe', giro, 280000, tag(plusMonate(aktuell, 2), 5), reparatur, bad.id),
    // Projekt "Sommerurlaub"
    geplant('Ferienwohnung', 'ausgabe', giro, 140000, tag(plusMonate(aktuell, 8), 1), reise, urlaub.id),
    geplant('Mietwagen', 'ausgabe', kredit, 45000, tag(plusMonate(aktuell, 8), 2), reise, urlaub.id),
  ].filter(Boolean));

  // Echte Projektbuchungen (Ist)
  const projektBuchungen = [];
  if (architekt) {
    projektBuchungen.push(...baueBuchungen({
      art: 'ausgabe', betragCent: 95000, datum: tag(monate[2], 20), kontoId: giro.id, kategorieId: reparatur,
      notiz: 'Planung Badumbau', partner: 'Architekturbüro Muster', status: 'gebucht', geplantId: architekt.id, projektId: bad.id,
      relevant: true, relevantGruppe: 'Haus (Test)',
    }, { konten: neueKonten }));
  }
  if (reise) {
    projektBuchungen.push(...baueBuchungen({
      art: 'ausgabe', betragCent: 64000, datum: heute, kontoId: kredit.id, kategorieId: reise,
      notiz: 'Flüge', partner: 'Fluglinie Beispiel', status: 'gebucht', projektId: urlaub.id,
    }, { konten: neueKonten }));
  }
  await db.speichere('buchungen', projektBuchungen.map((b) => ({ ...b, testdaten: true })));

  /* ---------- Relevante Ausgaben (D74): eigene Einträge aus früheren Jahren ---------- */
  const relevant = (datum, betragCent, partner, kategorieId, gruppe, notiz) => ({
    id: crypto.randomUUID(), datum, betragCent, partner, kategorieId: kategorieId ?? null, gruppe, notiz,
    belege: [], geloeschtAm: null, erstelltAm: jetzt, geaendertAm: jetzt, testdaten: true,
  });
  await db.speichere('relevant', [
    relevant('2012-05-03', 650000, 'Küchenstudio Muster', reparatur, 'Haus (Test)', 'Einbauküche'),
    relevant('2018-09-14', 129900, 'Elektromarkt Beispiel', null, 'Garantie (Test)', 'Waschmaschine, 5 Jahre Garantie'),
    relevant('2021-03-22', 980000, 'Heizungsbau Muster', reparatur, 'Haus (Test)', 'Neue Heizung'),
  ]);
  return true;
}

export async function loescheTestdaten() {
  const [konten, kategorien, buchungen, budgets, wiederkehrend, geplant, projekte, relevant, vertraege, sparziele, hinweise] = await Promise.all(
    [...SAMMLUNGEN_MIT_TESTDATEN, 'hinweise'].map((s) => db.alle(s)),
  );
  const kontoIds = new Set(konten.filter((k) => k.testdaten).map((k) => k.id));
  const katIds = new Set(kategorien.filter((k) => k.testdaten).map((k) => k.id));
  // Auch selbst angelegte Unterkategorien unter einer Test-Hauptkategorie entfernen
  for (const k of kategorien) if (k.elternId && katIds.has(k.elternId)) katIds.add(k.id);

  // Buchungen: Testbuchungen und alles an Testkonten/-kategorien (inkl. Umbuchungs-Partner)
  const weg = buchungen.filter((b) => b.testdaten || kontoIds.has(b.kontoId) || kontoIds.has(b.gegenkontoId) || katIds.has(b.kategorieId));
  const umbuchungIds = new Set(weg.map((b) => b.umbuchungId).filter(Boolean));
  const buchungIds = new Set(weg.map((b) => b.id));
  for (const b of buchungen) if (b.umbuchungId && umbuchungIds.has(b.umbuchungId)) buchungIds.add(b.id);

  const budgetWeg = budgets.filter((b) => b.testdaten || kontoIds.has(b.kontoId) || katIds.has(b.kategorieId));
  const wkWeg = wiederkehrend.filter((w) => w.testdaten || kontoIds.has(w.kontoId) || kontoIds.has(w.gegenkontoId) || katIds.has(w.kategorieId));
  // Entscheidungen zu Budgethinweisen, die sich auf Test-Budgets bezogen
  const budgetKats = new Set(budgetWeg.map((b) => b.kategorieId));
  const hinweisWeg = hinweise.filter((x) => katIds.has(x.kategorieId) || budgetKats.has(x.kategorieId));

  const geplantWeg = geplant.filter((g) => g.testdaten || kontoIds.has(g.kontoId) || kontoIds.has(g.gegenkontoId) || katIds.has(g.kategorieId));
  const projektWeg = new Set(projekte.filter((p) => p.testdaten).map((p) => p.id));

  await db.loesche('buchungen', [...buchungIds]);
  await db.loesche('budgets', budgetWeg.map((b) => b.id));
  await db.loesche('wiederkehrend', wkWeg.map((w) => w.id));
  await db.loesche('geplant', geplantWeg.map((g) => g.id));
  await db.loesche('projekte', [...projektWeg]);
  await db.loesche('relevant', relevant.filter((x) => x.testdaten).map((x) => x.id));
  // Verträge (D148): Test-Verträge weg; eigene Buchungen/wiederkehrende, die dazu gehörten, behalten – ohne Vertrag
  const vertragWeg = new Set(vertraege.filter((v) => v.testdaten).map((v) => v.id));
  await db.loesche('vertraege', [...vertragWeg]);
  await db.loesche('sparziele', sparziele.filter((z) => z.testdaten || kontoIds.has(z.kontoId)).map((z) => z.id)); // D157
  for (const [name, liste, ids] of [['buchungen', buchungen, buchungIds], ['wiederkehrend', wiederkehrend, new Set(wkWeg.map((w) => w.id))]]) {
    const betroffen = liste.filter((x) => !ids.has(x.id) && vertragWeg.has(x.vertragId));
    if (betroffen.length) await db.speichere(name, betroffen.map((x) => ({ ...x, vertragId: null })));
  }
  // Eigene Buchungen/Planungen, die einem Test-Projekt zugeordnet waren, behalten – ohne Projekt
  const geplantIds = new Set(geplantWeg.map((g) => g.id));
  for (const [name, liste, ids] of [['buchungen', buchungen, buchungIds], ['geplant', geplant, geplantIds]]) {
    const betroffen = liste.filter((x) => !ids.has(x.id) && projektWeg.has(x.projektId));
    if (betroffen.length) await db.speichere(name, betroffen.map((x) => ({ ...x, projektId: null })));
  }
  await db.loesche('hinweise', hinweisWeg.map((x) => x.id));
  await db.loesche('konten', [...kontoIds]);
  await db.loesche('kategorien', [...katIds]);
  return {
    konten: kontoIds.size, kategorien: katIds.size, buchungen: buchungIds.size,
    budgets: budgetWeg.length, wiederkehrend: wkWeg.length + geplantWeg.length,
  };
}
