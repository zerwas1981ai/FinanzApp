// D168: Notfall-Mappe „Wenn mir etwas passiert“ – stellt die Angaben für Angehörige zusammen.
// Bewusst OHNE Zugangsdaten, Passwörter, PINs. Reine Funktion, mit `npm test` geprüft.

import { kontostand } from './rechnen.js';
import { vertragsStand, vertragsKosten, fristText, aktuellerBetrag } from './vertraege.js';
import { sortiereKonten } from './konten.js';

const INTERVALL = { monatlich: 'monatlich', vierteljaehrlich: 'vierteljährlich', halbjaehrlich: 'halbjährlich', jaehrlich: 'jährlich' };

export function notfallDaten({ konten = [], buchungen = [], abstimmungen = [], vertraege = [], wiederkehrend = [], kategorien = [], heute }) {
  const kat = new Map(kategorien.map((k) => [k.id, k]));
  const kontoName = new Map(konten.map((k) => [k.id, k.name]));
  const aktiveKonten = sortiereKonten(konten.filter((k) => !k.archiviert));

  const kontenListe = aktiveKonten.map((k) => {
    const letzte = abstimmungen.filter((a) => a.kontoId === k.id).sort((a, b) => b.datum.localeCompare(a.datum))[0];
    return { name: k.name, standCent: kontostand(k, buchungen, heute), abgestimmtAm: letzte?.datum ?? null };
  });

  const vertragsListe = vertraege
    .map((v) => ({ v, stand: vertragsStand(v, heute) }))
    .filter(({ stand }) => stand.status !== 'beendet')
    .sort((a, b) => a.v.name.localeCompare(b.v.name, 'de'))
    .map(({ v, stand }) => {
      const kosten = vertragsKosten(v.id, wiederkehrend, heute);
      const ende = stand.status === 'gekuendigt' ? `gekündigt zum ${stand.ende}`
        : stand.status === 'laufend' ? `nächstes Ende ${stand.ende}, kündigen bis ${stand.kuendigenBis}`
          : stand.status === 'laeuft-aus' ? `endet ${stand.ende}` : 'jederzeit kündbar';
      return {
        name: v.name, empfaenger: v.anbieter ?? '', vertragsnummer: v.vertragsnummer ?? '',
        monatCent: kosten.posten.length ? kosten.monatCent : null, frist: fristText(v), ende, notiz: v.notiz ?? '',
      };
    });

  const zahlungen = wiederkehrend
    .filter((w) => w.aktiv !== false && !(w.ende && w.ende < heute))
    .map((w) => {
      const unter = kat.get(w.kategorieId);
      return {
        text: w.partner || w.notiz || unter?.name || (w.art === 'umbuchung' ? 'Umbuchung' : 'Zahlung'),
        art: w.art,
        konto: w.art === 'umbuchung' ? `${kontoName.get(w.kontoId) ?? '?'} → ${kontoName.get(w.gegenkontoId) ?? '?'}` : kontoName.get(w.kontoId) ?? '?',
        kategorie: unter ? [kat.get(unter.elternId)?.name, unter.name].filter(Boolean).join(' › ') : '',
        betragCent: aktuellerBetrag(w, heute),
        intervall: INTERVALL[w.intervall] ?? w.intervall,
      };
    })
    .sort((a, b) => ({ einnahme: 0, ausgabe: 1, umbuchung: 2 }[a.art] - { einnahme: 0, ausgabe: 1, umbuchung: 2 }[b.art]) || a.text.localeCompare(b.text, 'de'));

  return { konten: kontenListe, vertraege: vertragsListe, zahlungen };
}
