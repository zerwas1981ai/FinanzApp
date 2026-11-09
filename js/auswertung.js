// Filtern, Sortieren und Auswerten von Buchungen (Tab "Alle Buchungen").
// Reine Funktionen ohne Datenbank – mit `npm test` geprüft.
//
// Ein "Eintrag" ist eine Zeile der Liste:
//   { buchung, wirkung }   wirkung = Cent aus Sicht des Kontos (+/−), bei Umbuchung ohne
//                          Kontofilter 0 (sie verschiebt nur Geld zwischen eigenen Konten)
// Umbuchungen erscheinen als EINE Zeile (die "ab"-Hälfte). Ist nach einem Konto gefiltert,
// wird die Hälfte dieses Kontos genommen, damit + / − aus dessen Sicht stimmt.

import { wirkungCent, istAktiv } from './rechnen.js';
import { isoMonatsanfang, naechsterMonat, vorigerMonat } from './format.js';

export const STANDARD_FILTER = Object.freeze({
  zeitraum: 'alles', // alles | jahr | monat | letzte3 | eigen (vormonat/vorjahr nur noch intern) – Standard „Alles“ (D122)
  von: '',
  bis: '',
  // Mehrfachauswahl (D72): leere Liste = alle
  kontoIds: Object.freeze([]),
  arten: Object.freeze([]), // einnahme | ausgabe | umbuchung
  kategorieIds: Object.freeze([]), // Haupt- oder Unterkategorien
  partner: Object.freeze([]), // Empfänger/Absender: Namen oder OHNE_PARTNER
  status: Object.freeze(['gebucht']), // gebucht | vorgemerkt – Standard nur gebuchte (D120)
  betragMin: null, // Cent
  betragMax: null, // Cent
  suche: '',
  ohneBeleg: false,
});

/** Filterwert für "Buchungen ohne Empfänger/Absender" */
export const OHNE_PARTNER = '__ohne';

/** Vergleichsschlüssel für Empfänger/Absender: ohne Leerzeichen am Rand, Groß/klein egal */
export const partnerSchluessel = (name) => (name ?? '').trim().toLocaleLowerCase('de');

/**
 * Alle bisher verwendeten Empfänger/Absender (für Vorschläge und den Filter),
 * häufigste zuerst. Als Name gilt die zuletzt verwendete Schreibweise.
 */
export function partnerListe(buchungen) {
  const gruppen = new Map();
  for (const b of [...buchungen].sort((x, y) => y.datum.localeCompare(x.datum))) {
    if (b.geloeschtAm || b.art === 'umbuchung') continue;
    const k = partnerSchluessel(b.partner);
    if (!k) continue;
    if (!gruppen.has(k)) gruppen.set(k, { name: b.partner.trim(), anzahl: 0 });
    gruppen.get(k).anzahl += 1;
  }
  return [...gruppen.values()].sort((a, b) => b.anzahl - a.anzahl || a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }));
}

/**
 * Sortierung (D103, vereinfacht D73): genau EINE Spalte. Bei Gleichstand gilt das Datum
 * (neueste zuerst; bei Sortierung nach Datum in dessen Richtung). Die Form { stufen: [...] }
 * bleibt, damit sortiere() auch mehrere Stufen könnte – die Oberfläche setzt aber nur eine.
 */
export const STANDARD_SORTIERUNG = Object.freeze({ stufen: Object.freeze([Object.freeze({ feld: 'datum', richtung: 'ab' })]) });

/** Neue Sortierung nach Klick auf eine Spalte (reine Funktion) */
export function sortiereNach(sortierung, feld) {
  const aktuell = (sortierung.stufen ?? [sortierung])[0];
  // Gleiche Spalte erneut: Richtung umdrehen
  if (aktuell?.feld === feld) return { stufen: [{ feld, richtung: aktuell.richtung === 'ab' ? 'auf' : 'ab' }] };
  // Neue Spalte: Zahlen und Datum zuerst absteigend, Texte zuerst A–Z
  return { stufen: [{ feld, richtung: feld === 'datum' || feld === 'betrag' ? 'ab' : 'auf' }] };
}

const letzterTag = (jahr, monat) => {
  const [nj, nm] = naechsterMonat(jahr, monat);
  const d = new Date(nj, nm - 1, 0);
  return `${jahr}-${String(monat).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Zeitraum als { von, bis } (beide einschließlich, '' = offen) */
export function zeitraumFuer(filter, heute) {
  const j = Number(heute.slice(0, 4));
  const m = Number(heute.slice(5, 7));
  switch (filter.zeitraum) {
    case 'monat': return { von: isoMonatsanfang(j, m), bis: letzterTag(j, m) };
    case 'vormonat': {
      const [vj, vm] = vorigerMonat(j, m);
      return { von: isoMonatsanfang(vj, vm), bis: letzterTag(vj, vm) };
    }
    case 'jahr': return { von: `${j}-01-01`, bis: `${j}-12-31` };
    case 'letzte3': {
      // D122: die letzten drei abgeschlossenen Monate (heute im November → August bis Oktober)
      const [ej, em] = vorigerMonat(j, m);
      let [sj, sm] = [ej, em];
      for (let i = 0; i < 2; i++) [sj, sm] = vorigerMonat(sj, sm);
      return { von: isoMonatsanfang(sj, sm), bis: letzterTag(ej, em) };
    }
    case 'vorjahr': return { von: `${j - 1}-01-01`, bis: `${j - 1}-12-31` };
    case 'eigen': return { von: filter.von || '', bis: filter.bis || '' };
    default: return { von: '', bis: '' };
  }
}

/** Wendet alle Filter an und liefert die Einträge (unsortiert) */
export function filtere(buchungen, filter, { kategorien = [], konten = [], heute }) {
  const { von, bis } = zeitraumFuer(filter, heute);
  const kat = new Map(kategorien.map((k) => [k.id, k]));
  const kontoName = new Map(konten.map((k) => [k.id, k.name]));
  const suche = filter.suche.trim().toLocaleLowerCase('de');
  const konten_ = new Set(filter.kontoIds);
  const arten = new Set(filter.arten);
  const status = new Set(filter.status);
  const kategorienGewaehlt = new Set(filter.kategorieIds);
  const partnerGewaehlt = new Set(filter.partner.map((p) => (p === OHNE_PARTNER ? '' : partnerSchluessel(p))));

  const ergebnis = [];
  for (const b of buchungen) {
    if (!istAktiv(b)) continue;

    // Kontofilter / Umbuchung nur einmal. Umbuchung zwischen zwei gewählten Konten: einmal, ohne Wirkung.
    let intern = false;
    if (konten_.size) {
      if (!konten_.has(b.kontoId)) continue;
      if (b.art === 'umbuchung' && konten_.has(b.gegenkontoId)) {
        if (b.richtung === 'zu') continue;
        intern = true;
      }
    } else if (b.richtung === 'zu') {
      continue;
    }

    if (von && b.datum < von) continue;
    if (bis && b.datum > bis) continue;
    // D121: nur Buchungen bis heute – schon erfasste mit späterem Datum erscheinen erst an ihrem Tag
    if (b.datum > heute) continue;
    if (arten.size && !arten.has(b.art)) continue;
    if (status.size && !status.has(b.status)) continue;
    if (filter.betragMin != null && b.betragCent < filter.betragMin) continue;
    if (filter.betragMax != null && b.betragCent > filter.betragMax) continue;
    if (filter.ohneBeleg && b.belege?.length) continue;

    if (partnerGewaehlt.size) {
      // Umbuchungen haben keinen Empfänger/Absender und fallen bei diesem Filter weg
      if (b.art === 'umbuchung') continue;
      if (!partnerGewaehlt.has(partnerSchluessel(b.partner))) continue;
    }

    if (kategorienGewaehlt.size) {
      // Eine gewählte Hauptkategorie umfasst alle ihre Unterkategorien
      const unter = kat.get(b.kategorieId);
      if (!unter || (!kategorienGewaehlt.has(unter.id) && !kategorienGewaehlt.has(unter.elternId))) continue;
    }

    if (suche) {
      const unter = kat.get(b.kategorieId);
      const text = [
        b.partner,
        b.notiz,
        unter?.name,
        kat.get(unter?.elternId)?.name,
        kontoName.get(b.kontoId),
        kontoName.get(b.gegenkontoId),
      ].filter(Boolean).join(' ').toLocaleLowerCase('de');
      if (!text.includes(suche)) continue;
    }

    const wirkung = b.art === 'umbuchung' && (!konten_.size || intern) ? 0 : wirkungCent(b);
    ergebnis.push({ buchung: b, wirkung });
  }
  return ergebnis;
}

/**
 * Sortiert Einträge. sortierung: { stufen: [{ feld, richtung }] } (oder eine einzelne { feld, richtung }).
 * feld: datum | betrag | partner | kategorie | konto | notiz, richtung: auf | ab.
 * Betrag zählt mit Vorzeichen (+ Einnahme, − Ausgabe); Umbuchung ohne Kontofilter = 0.
 */
export function sortiere(eintraege, sortierung, { kategorien = [], konten = [] } = {}) {
  const stufen = sortierung.stufen ?? [sortierung];
  const kat = new Map(kategorien.map((k) => [k.id, k]));
  const kontoName = new Map(konten.map((k) => [k.id, k.name]));
  const text = (x, y) => x.localeCompare(y, 'de', { sensitivity: 'base' });
  // Leere Texte ans Ende (bei aufsteigender Sortierung)
  const mitLeer = (x, y) => text(x || '\uffff', y || '\uffff');
  const katText = (b) => {
    if (b.art === 'umbuchung') return 'Umbuchung';
    const unter = kat.get(b.kategorieId);
    return `${kat.get(unter?.elternId)?.name ?? ''} ${unter?.name ?? ''}`;
  };
  const vergleicher = {
    // Datum vergleicht wirklich (D102) – früher stand hier "0", dann entschied bei
    // Datum vor Betrag trotzdem der Betrag und die Richtung des Datums wirkte nicht.
    datum: (a, b) => a.buchung.datum.localeCompare(b.buchung.datum),
    // Umbuchungen ohne Kontofilter (Wirkung 0) untereinander nach ihrer Höhe
    betrag: (a, b) => a.wirkung - b.wirkung
      || (a.wirkung === 0 && b.wirkung === 0 ? a.buchung.betragCent - b.buchung.betragCent : 0),
    partner: (a, b) => mitLeer(partnerSchluessel(a.buchung.partner), partnerSchluessel(b.buchung.partner)),
    kategorie: (a, b) => text(katText(a.buchung), katText(b.buchung)),
    konto: (a, b) => text(kontoName.get(a.buchung.kontoId) ?? '', kontoName.get(b.buchung.kontoId) ?? ''),
    notiz: (a, b) => mitLeer((a.buchung.notiz ?? '').trim(), (b.buchung.notiz ?? '').trim()),
  };
  // Bei Gleichstand: Datum (falls noch nicht als Stufe gewählt), dann Erfassungszeit, dann id –
  // in der Richtung der Datums-Stufe, sonst neueste zuerst. So ist die Reihenfolge immer eindeutig.
  const datumRichtung = stufen.find((x) => x.feld === 'datum')?.richtung ?? 'ab';
  const zuletzt = (a, b) => a.buchung.datum.localeCompare(b.buchung.datum)
    || (a.buchung.erstelltAm ?? '').localeCompare(b.buchung.erstelltAm ?? '')
    || String(a.buchung.id ?? '').localeCompare(String(b.buchung.id ?? ''));
  return [...eintraege].sort((a, b) => {
    for (const { feld, richtung } of stufen) {
      const v = (vergleicher[feld] ?? (() => 0))(a, b);
      if (v) return richtung === 'auf' ? v : -v;
    }
    return (datumRichtung === 'auf' ? 1 : -1) * zuletzt(a, b);
  });
}

/**
 * Summen über die Einträge. Umbuchungen zählen nie als Einnahme/Ausgabe.
 * D120: anzahl, summe und schnitt beziehen sich nur auf Einnahmen und Ausgaben
 * (summe = Einnahmen − Ausgaben, schnitt = summe je Buchung); Umbuchungen stehen extra in anzahlUmbuchungen.
 */
export function summen(eintraege) {
  let einnahmen = 0;
  let ausgaben = 0;
  let umbuchungen = 0;
  let anzahl = 0;
  let anzahlUmbuchungen = 0;
  for (const { buchung: b, wirkung } of eintraege) {
    if (b.art === 'einnahme') { einnahmen += b.betragCent; anzahl += 1; }
    else if (b.art === 'ausgabe') { ausgaben += b.betragCent; anzahl += 1; }
    else { umbuchungen += wirkung; anzahlUmbuchungen += 1; }
  }
  const saldo = einnahmen - ausgaben;
  return {
    anzahl, anzahlUmbuchungen, einnahmen, ausgaben, saldo, summe: saldo, umbuchungen,
    schnitt: anzahl ? Math.round(saldo / anzahl) : null,
  };
}

/** Monate (als [jahr, monat]) von–bis einschließlich */
export function monateZwischen(vonIso, bisIso) {
  const ergebnis = [];
  let j = Number(vonIso.slice(0, 4));
  let m = Number(vonIso.slice(5, 7));
  const zielJ = Number(bisIso.slice(0, 4));
  const zielM = Number(bisIso.slice(5, 7));
  while (j < zielJ || (j === zielJ && m <= zielM)) {
    ergebnis.push([j, m]);
    [j, m] = naechsterMonat(j, m);
  }
  return ergebnis;
}

/**
 * Ab wann wird erfasst? Datum der frühesten (nicht gelöschten) Buchung –
 * bei Kontofilter nur der gewählten Konten. Kategorie-, Such- und andere Filter spielen
 * bewusst keine Rolle: Eine seltene Kategorie (z. B. Urlaub) soll über alle
 * erfassten Monate gemittelt werden, nicht erst ab ihrer ersten Buchung.
 */
export function ersterErfassterTag(buchungen, filter = {}) {
  let erster = null;
  for (const b of buchungen) {
    if (!istAktiv(b)) continue;
    if (filter.kontoIds?.length && !filter.kontoIds.includes(b.kontoId)) continue;
    if (erster === null || b.datum < erster) erster = b.datum;
  }
  return erster;
}

/**
 * Welche Monate deckt die Auswertung ab (für Verlauf und Durchschnitt)?
 * - Beginn: Anfang des Zeitraums, aber nie vor dem ersten erfassten Monat.
 *   (Bei "Dieses Jahr" mit Daten erst ab September also September, nicht Januar.)
 * - Ende: Ende des Zeitraums, aber nie nach dem aktuellen Monat – außer es gibt
 *   schon spätere Buchungen.
 * Leere Monate dazwischen zählen mit.
 */
export function monateDerAuswertung(eintraege, filter, heute, erster) {
  if (!erster) return [];
  const { von, bis } = zeitraumFuer(filter, heute);
  const letzteBuchung = eintraege.reduce((max, e) => (e.buchung.datum > max ? e.buchung.datum : max), heute);
  const start = von && von > erster ? von : erster;
  const ende = bis && bis < letzteBuchung ? bis : letzteBuchung;
  if (start > ende) return [];
  return monateZwischen(start, ende);
}

/** Einnahmen, Ausgaben und Saldo je Monat */
export function verlaufJeMonat(eintraege, monate) {
  const index = new Map(monate.map(([j, m], i) => [isoMonatsanfang(j, m).slice(0, 7), i]));
  const zeilen = monate.map(([jahr, monat]) => ({ jahr, monat, einnahmen: 0, ausgaben: 0, saldo: 0 }));
  for (const { buchung: b } of eintraege) {
    const i = index.get(b.datum.slice(0, 7));
    if (i === undefined || b.art === 'umbuchung') continue;
    if (b.art === 'einnahme') zeilen[i].einnahmen += b.betragCent;
    else zeilen[i].ausgaben += b.betragCent;
  }
  for (const z of zeilen) z.saldo = z.einnahmen - z.ausgaben;
  return zeilen;
}

/**
 * Sparquote (D107): Anteil der Einnahmen, der übrig bleibt = (Einnahmen − Ausgaben) / Einnahmen.
 * Ohne Einnahmen gibt es keine Quote (null). Negativ = mehr ausgegeben als eingenommen.
 */
export function sparquote(einnahmen, ausgaben) {
  return einnahmen > 0 ? (einnahmen - ausgaben) / einnahmen : null;
}

/**
 * Vorjahreswerte zu jedem Monat (D107): gleicher Monat ein Jahr früher, mit denselben Filtern
 * außer dem Zeitraum (eintraegeOhneZeitraum). Monate vor der ersten erfassten Buchung → null,
 * damit „noch nichts erfasst“ nicht wie „0 €“ aussieht.
 */
export function vorjahrJeMonat(eintraegeOhneZeitraum, monate, erster) {
  const vorher = monate.map(([j, m]) => [j - 1, m]);
  const werte = verlaufJeMonat(eintraegeOhneZeitraum, vorher);
  const ersterMonat = erster ? erster.slice(0, 7) : null;
  return werte.map((z) => (ersterMonat && isoMonatsanfang(z.jahr, z.monat).slice(0, 7) >= ersterMonat ? z : null));
}

/** Nur die abgeschlossenen Monate (vor dem aktuellen Monat) – Grundlage für den Ø */
export function abgeschlosseneMonate(monate, heute) {
  const aktuell = heute.slice(0, 7);
  return monate.filter(([j, m]) => isoMonatsanfang(j, m).slice(0, 7) < aktuell);
}

/**
 * Summen je Hauptkategorie (mit Unterkategorien) für eine Art.
 * Liefert absteigend sortiert: [{ id, name, summe, anteil, schnittSumme, schnitt, unter: [...] }]
 * - anteil = 0..1 an der Gesamtsumme (alle Einträge)
 * - schnitt = Durchschnitt pro Monat, NUR aus den übergebenen schnittMonaten
 *   (abgeschlossene Monate). Der laufende Monat würde den Ø verfälschen, weil er
 *   noch nicht vorbei ist. Ohne schnittMonate ist schnitt = null.
 */
export function summenJeKategorie(eintraege, kategorien, art, schnittMonate = []) {
  const kat = new Map(kategorien.map((k) => [k.id, k]));
  const schnittSchluessel = new Set(schnittMonate.map(([j, m]) => isoMonatsanfang(j, m).slice(0, 7)));
  const haupt = new Map();
  let gesamt = 0;
  for (const { buchung: b } of eintraege) {
    if (b.art !== art) continue;
    const zaehltFuerSchnitt = schnittSchluessel.has(b.datum.slice(0, 7));
    const unter = kat.get(b.kategorieId);
    const hk = kat.get(unter?.elternId);
    const hId = hk?.id ?? 'unbekannt';
    if (!haupt.has(hId)) haupt.set(hId, { id: hId, name: hk?.name ?? 'Unbekannte Kategorie', summe: 0, schnittSumme: 0, unter: new Map() });
    const h = haupt.get(hId);
    const uId = unter?.id ?? 'unbekannt';
    if (!h.unter.has(uId)) h.unter.set(uId, { id: uId, name: unter?.name ?? 'Unbekannt', summe: 0, schnittSumme: 0 });
    for (const ziel of [h, h.unter.get(uId)]) {
      ziel.summe += b.betragCent;
      if (zaehltFuerSchnitt) ziel.schnittSumme += b.betragCent;
    }
    gesamt += b.betragCent;
  }
  const n = schnittMonate.length;
  const mitAnteil = (x) => ({
    ...x,
    anteil: gesamt ? x.summe / gesamt : 0,
    schnitt: n ? Math.round(x.schnittSumme / n) : null,
  });
  return [...haupt.values()]
    .map((h) => ({ ...mitAnteil(h), unter: [...h.unter.values()].map(mitAnteil).sort((a, b) => b.summe - a.summe) }))
    .sort((a, b) => b.summe - a.summe);
}

/**
 * Summen je Empfänger/Absender für eine Art, absteigend.
 * [{ id (Schlüssel bzw. OHNE_PARTNER), name, anzahl, summe, anteil, schnitt }] – schnitt wie bei summenJeKategorie.
 */
export function summenJePartner(eintraege, art, schnittMonate = []) {
  const schnittSchluessel = new Set(schnittMonate.map(([j, m]) => isoMonatsanfang(j, m).slice(0, 7)));
  const gruppen = new Map();
  let gesamt = 0;
  for (const { buchung: b } of [...eintraege].sort((x, y) => y.buchung.datum.localeCompare(x.buchung.datum))) {
    if (b.art !== art) continue;
    const k = partnerSchluessel(b.partner) || OHNE_PARTNER;
    if (!gruppen.has(k)) gruppen.set(k, { id: k, name: k === OHNE_PARTNER ? 'Ohne Angabe' : b.partner.trim(), anzahl: 0, summe: 0, schnittSumme: 0 });
    const g = gruppen.get(k);
    g.anzahl += 1;
    g.summe += b.betragCent;
    if (schnittSchluessel.has(b.datum.slice(0, 7))) g.schnittSumme += b.betragCent;
    gesamt += b.betragCent;
  }
  const n = schnittMonate.length;
  return [...gruppen.values()]
    .map((g) => ({ ...g, anteil: gesamt ? g.summe / gesamt : 0, schnitt: n ? Math.round(g.schnittSumme / n) : null }))
    .sort((a, b) => b.summe - a.summe);
}

/** "Schöne" Obergrenze für eine Diagrammachse, z. B. 3.712 → 4.000 */
export function schoeneObergrenze(wert) {
  if (wert <= 0) return 1;
  const potenz = 10 ** Math.floor(Math.log10(wert));
  for (const schritt of [1, 2, 2.5, 5, 10]) {
    if (schritt * potenz >= wert) return schritt * potenz;
  }
  return 10 * potenz;
}
