// Tests zu D155–D157 (Kategorie-Farben, Rückblick, Sparziele) – nur erfundene Testdaten
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PALETTE, farbenZuordnung, farbeVon } from '../js/farben.js';
import { monatsRueckblick, jahresRueckblick, waehlbareZeitraeume, plusMonat, monatKurz } from '../js/rueckblick.js';
import { baueSparziel, sparzielStand, monateZwischen } from '../js/sparziele.js';
import { migriereDaten } from '../js/migrationen.js';

test('D155: Farben – gewählte gelten, übrige automatisch und stabil, Unterkategorien erben', () => {
  const kategorien = [
    { id: 'h1', name: 'Wohnen', erstelltAm: '2026-01-01' },
    { id: 'h2', name: 'Freizeit', erstelltAm: '2026-01-02', farbe: 'blau' },
    { id: 'h3', name: 'Mobilität', erstelltAm: '2026-01-03' },
    { id: 'u1', name: 'Miete', elternId: 'h1' },
  ];
  const z = farbenZuordnung(kategorien);
  assert.equal(z.get('h2').schluessel, 'blau');
  assert.equal(z.get('h1').schluessel, 'gruen', 'Blau ist schon vergeben → nächste freie Farbe');
  assert.equal(z.get('h3').schluessel, 'orange');
  // Neue Kategorie verschiebt die bestehenden nicht
  const z2 = farbenZuordnung([...kategorien, { id: 'h4', name: 'Neu', erstelltAm: '2026-05-01' }]);
  assert.equal(z2.get('h1').schluessel, 'gruen');
  assert.equal(z2.get('h3').schluessel, 'orange');
  const katMap = new Map(kategorien.map((k) => [k.id, k]));
  assert.equal(farbeVon('u1', katMap, z), z.get('h1').hex);
  assert.equal(farbeVon('gibtsnicht', katMap, z), null);
  // Mehr Kategorien als Farben: Palette beginnt von vorn
  const viele = Array.from({ length: PALETTE.length + 1 }, (_, i) => ({ id: `k${i}`, name: `K${i}`, erstelltAm: `2026-01-${String(i + 1).padStart(2, '0')}` }));
  assert.equal(farbenZuordnung(viele).get(`k${PALETTE.length}`).schluessel, PALETTE[0].schluessel);
});

const kategorien = [
  { id: 'h1', name: 'Wohnen' }, { id: 'u1', name: 'Miete', elternId: 'h1' },
  { id: 'h2', name: 'Lebensmittel' }, { id: 'u2', name: 'Supermarkt', elternId: 'h2' },
  { id: 'e1', name: 'Einkommen' }, { id: 'eu', name: 'Gehalt', elternId: 'e1' },
];
const b = (id, datum, art, cent, kat, extra = {}) => ({ id, datum, art, betragCent: cent, kategorieId: kat, ...extra });
const buchungen = [
  b('1', '2026-08-01', 'einnahme', 300000, 'eu'), b('2', '2026-08-03', 'ausgabe', 95000, 'u1'), b('3', '2026-08-10', 'ausgabe', 20000, 'u2'),
  b('4', '2026-09-01', 'einnahme', 300000, 'eu'), b('5', '2026-09-03', 'ausgabe', 95000, 'u1'), b('6', '2026-09-12', 'ausgabe', 30000, 'u2'),
  b('7', '2026-10-01', 'einnahme', 320000, 'eu'), b('8', '2026-10-03', 'ausgabe', 95000, 'u1'), b('9', '2026-10-15', 'ausgabe', 25000, 'u2'),
  b('10', '2026-10-20', 'ausgabe', 99900, 'u2', { geloeschtAm: 'X' }),
  b('11', '2026-10-21', 'umbuchung', 50000, null, { richtung: 'ab' }),
  b('12', '2025-10-05', 'ausgabe', 90000, 'u1'), b('13', '2025-10-01', 'einnahme', 280000, 'eu'), b('14', '2025-12-20', 'ausgabe', 50000, 'u2'),
];

test('D156: Monatsrückblick mit den beiden Vormonaten', () => {
  const rb = monatsRueckblick(buchungen, kategorien, '2026-10', '2026-11-12');
  assert.deepEqual(rb.spalten, ['Aug 26', 'Sep 26', 'Okt 26']);
  assert.deepEqual(rb.perioden.map((p) => p.ausgaben), [115000, 125000, 120000], 'Papierkorb und Umbuchung zählen nicht');
  assert.deepEqual(rb.perioden.map((p) => p.einnahmen), [300000, 300000, 320000]);
  assert.equal(rb.perioden[2].saldo, 200000);
  assert.equal(rb.perioden[2].sparquote, 200000 / 320000);
  assert.equal(rb.laufend, false);
  assert.deepEqual(rb.kategorien.map((k) => [k.name, k.werte, k.differenz]), [
    ['Wohnen', [95000, 95000, 95000], 0],
    ['Lebensmittel', [20000, 30000, 25000], -5000],
  ]);
  assert.deepEqual(rb.groesste.map((x) => x.id), ['8', '9']);
  // laufender Monat: nur bis heute
  const lfd = monatsRueckblick([...buchungen, b('20', '2026-11-20', 'ausgabe', 1000, 'u2')], kategorien, '2026-11', '2026-11-12');
  assert.equal(lfd.laufend, true);
  assert.equal(lfd.perioden[2].ausgaben, 0, 'Buchung nach heute zählt nicht');
  assert.equal(plusMonat('2026-01', -2), '2025-11');
  assert.equal(monatKurz('2026-03'), 'Mär 26');
});

test('D156: Jahresrückblick – laufendes Jahr gegen Vorjahr bis zum gleichen Tag', () => {
  const rb = jahresRueckblick(buchungen, kategorien, 2026, '2026-11-12');
  assert.equal(rb.laufend, true);
  assert.equal(rb.vorjahrBis, '2025-11-12');
  assert.deepEqual(rb.spalten, ['2025', '2026']);
  assert.equal(rb.perioden[0].ausgaben, 90000, 'Dezember 2025 zählt im Vergleich nicht');
  assert.equal(rb.perioden[1].ausgaben, 360000);
  assert.equal(rb.monate.length, 11, 'Januar bis November');
  assert.equal(rb.monate[9].saldo, 200000);
  const vj = jahresRueckblick(buchungen, kategorien, 2025, '2026-11-12');
  assert.equal(vj.laufend, false);
  assert.equal(vj.perioden[1].ausgaben, 140000);
  assert.equal(vj.monate.length, 12);
  const w = waehlbareZeitraeume(buchungen, '2026-11-12');
  assert.equal(w.monate[0], '2026-11');
  assert.equal(w.monate.at(-1), '2025-10');
  assert.deepEqual(w.jahre, [2026, 2025]);
});

test('D157: Sparziel bauen und Stand mit Prognose', () => {
  const konten = [{ id: 'tg', name: 'Tagesgeld' }];
  assert.throws(() => baueSparziel({ name: '', kontoId: 'tg', zielCent: 100 }, { konten }), /Namen/);
  assert.throws(() => baueSparziel({ name: 'X', kontoId: 'nix', zielCent: 100 }, { konten }), /Konto/);
  assert.throws(() => baueSparziel({ name: 'X', kontoId: 'tg', zielCent: 0 }, { konten }), /Zielbetrag/);
  const z = baueSparziel({ name: ' Notgroschen ', kontoId: 'tg', zielCent: 1000000, zielDatum: '2027-12-31' }, { konten, jetzt: 'T' });
  assert.equal(z.name, 'Notgroschen');
  assert.throws(() => baueSparziel({ name: 'notgroschen', kontoId: 'tg', zielCent: 5 }, { konten, sparziele: [z] }), /gibt es schon/);

  const zeilen = [];
  for (let m = '2026-12', stand = 820000; m <= '2028-12'; m = plusMonat(m, 1), stand += 20000) zeilen.push({ monat: m, stand });
  const s = sparzielStand(z, { standHeute: 780000, prognoseMonatsende: 800000, zeilen, heute: '2026-11-12' });
  assert.equal(s.anteil, 0.78);
  assert.equal(s.erreicht, false);
  assert.equal(s.erreichtMonat, '2027-09', 'Dez 820.000 + 9 × 20.000 = 1.000.000 im September 2027');
  assert.equal(s.rechtzeitig, true);
  // Ziel früher: nicht rechtzeitig → Fehlbetrag und nötige Rate
  const knapp = sparzielStand({ ...z, zielDatum: '2027-03-31' }, { standHeute: 780000, prognoseMonatsende: 800000, zeilen, heute: '2026-11-12' });
  assert.equal(knapp.rechtzeitig, false);
  assert.equal(knapp.standZumZiel, 880000);
  assert.equal(knapp.fehlbetragCent, 120000);
  assert.equal(knapp.noetigProMonatCent, 30000, '1.200 € auf 4 Monate (Dez–März)');
  // ohne Zieldatum, schon erreicht
  const da = sparzielStand({ ...z, zielDatum: null }, { standHeute: 1200000, prognoseMonatsende: 1200000, zeilen, heute: '2026-11-12' });
  assert.equal(da.erreicht, true);
  assert.equal(da.rechtzeitig, null);
  assert.equal(da.anteil, 1);
  // nie erreicht
  assert.equal(sparzielStand({ ...z, zielCent: 99999999 }, { standHeute: 0, prognoseMonatsende: 0, zeilen, heute: '2026-11-12' }).erreichtMonat, null);
  assert.equal(monateZwischen('2026-11', '2027-03'), 4);
});

test('Migration auf 19: Sparziele', () => {
  const { daten } = migriereDaten({ version: 18, vertraege: [] });
  assert.deepEqual(daten.sparziele, []);
  assert.equal(daten.version, 19);
});
