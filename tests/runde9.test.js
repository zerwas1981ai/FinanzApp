// Tests zu D214 (Auslagen) – nur erfundene Testdaten
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zaehltCent, auslageWirkungCent, monatsuebersicht, kontostand, ausgabenVergleich } from '../js/rechnen.js';
import { auslagenUebersicht, passendeAuslagen, auslageAbschliessen, auslageWiederOeffnen, auslageTitel } from '../js/auslagen.js';
import { summen, summenJeKategorie } from '../js/auswertung.js';
import { ausgabenJeKontoUndKategorie, budgetSchluessel } from '../js/prognose.js';
import { periodenSummen } from '../js/rueckblick.js';
import { baueBuchungen, aufrundungCent, aufrundenGilt, aufrundungAnpassen, aufrundungenVon, ausgleichGilt, ausgleichAnpassen, ausgleicheVon } from '../js/buchungen.js';
import { migriereDaten } from '../js/migrationen.js';

const konto = { id: 'k1', name: 'Testkonto', anfangssaldoCent: 100000, stichtag: '2026-01-01' };
const kategorien = [
  { id: 'leb', elternId: null, art: 'ausgabe', name: 'Lebensmittel' }, { id: 'super', elternId: 'leb', name: 'Supermarkt' },
  { id: 'ges', elternId: null, art: 'ausgabe', name: 'Gesundheit' }, { id: 'arzt', elternId: 'ges', name: 'Arzt' },
  { id: 'ein', elternId: null, art: 'einnahme', name: 'Sonstiges' }, { id: 'erst', elternId: 'ein', name: 'Erstattung' },
];
const b = (id, art, betragCent, datum, extra = {}) => ({
  id, art, betragCent, datum, kontoId: 'k1', kategorieId: art === 'einnahme' ? 'erst' : 'super', partner: '', notiz: '', ...extra,
});
const daten = () => [
  b('normal', 'ausgabe', 5000, '2026-03-02'),
  b('arztrechnung', 'ausgabe', 10000, '2026-03-05', { kategorieId: 'arzt', partner: 'Praxis Muster', auslage: { fuer: 'Testkasse', erledigtAm: null, restCent: null } }),
  b('geschenk', 'ausgabe', 3000, '2026-03-06', { auslage: { fuer: 'Max Muster', erledigtAm: null, restCent: null } }),
  b('kasse', 'einnahme', 8000, '2026-03-20', { partner: 'Testkasse', auslageId: 'arztrechnung' }),
];

test('D214: offene Auslagen und Rückzahlungen zählen nicht, Kontostand schon', () => {
  const [normal, arzt, , kasse] = daten();
  assert.equal(zaehltCent(normal), 5000);
  assert.equal(zaehltCent(arzt), 0);
  assert.equal(zaehltCent(kasse), 0);
  assert.equal(auslageWirkungCent(arzt), -10000);
  assert.equal(auslageWirkungCent(kasse), 8000);
  assert.equal(kontostand(konto, daten(), '2026-03-31'), 100000 - 5000 - 10000 - 3000 + 8000);

  const m = monatsuebersicht(konto, daten(), 2026, 3);
  assert.equal(m.ausgaben, 5000);
  assert.equal(m.einnahmen, 0);
  assert.equal(m.auslagen, -10000 - 3000 + 8000);
  assert.equal(m.anfang + m.einnahmen - m.ausgaben + m.auslagen, m.ende, 'Summenzeilen ergeben den Stand');
});

test('D214: Abschließen mit Rest – Rest zählt als normale Ausgabe und gegen das Budget', () => {
  const liste = daten();
  const arzt = auslagenUebersicht(liste).find((a) => a.buchung.id === 'arztrechnung');
  assert.deepEqual([arzt.status, arzt.zurueckCent, arzt.offenCent], ['offen', 8000, 2000]);
  const fertig = auslageAbschliessen(arzt, 'T');
  assert.equal(fertig.auslage.restCent, 2000);
  assert.equal(zaehltCent(fertig), 2000);
  const neu = liste.map((x) => (x.id === fertig.id ? fertig : x));
  assert.equal(auslagenUebersicht(neu).find((a) => a.buchung.id === fertig.id).status, 'abgeschlossen');

  const budget = ausgabenJeKontoUndKategorie(neu, kategorien, '2026-03');
  assert.equal(budget.get(budgetSchluessel('k1', 'ges')), 2000, 'nur der Rest verbraucht Budget');
  assert.equal(budget.get(budgetSchluessel('k1', 'leb')), 5000, 'offenes Geschenk verbraucht kein Budget');
  const m = monatsuebersicht(konto, neu, 2026, 3);
  assert.equal(m.anfang + m.einnahmen - m.ausgaben + m.auslagen, m.ende);

  assert.equal(zaehltCent(auslageWiederOeffnen(fertig, 'T2')), 0);
});

test('D214: Auswertungen, Rückblick und Vormonatsvergleich ohne Auslagen', () => {
  const eintraege = daten().map((x) => ({ buchung: x, wirkung: x.art === 'einnahme' ? x.betragCent : -x.betragCent }));
  const s = summen(eintraege);
  assert.deepEqual([s.ausgaben, s.einnahmen, s.anzahl, s.anzahlAuslagen], [5000, 0, 1, 3]);
  assert.deepEqual(summenJeKategorie(eintraege, kategorien, 'ausgabe').map((k) => [k.id, k.summe]), [['leb', 5000]]);
  const p = periodenSummen(daten(), kategorien, '2026-03-01', '2026-03-31', '2026-03-31');
  assert.deepEqual([p.einnahmen, p.ausgaben], [0, 5000]);
  assert.equal(ausgabenVergleich(konto, daten(), '2026-03-31').jetzt, 5000);
});

test('D214: Übersicht, Vorschläge und Titel', () => {
  const liste = [...daten(), b('kasse2', 'einnahme', 2000, '2026-03-25', { partner: 'Testkasse', auslageId: 'arztrechnung' })];
  const ueb = auslagenUebersicht(liste);
  assert.deepEqual(ueb.map((a) => [a.buchung.id, a.status]), [['geschenk', 'offen'], ['arztrechnung', 'zurueck']], 'offene zuerst');
  assert.equal(auslageTitel(ueb[0].buchung), 'Max Muster');

  const offen = auslagenUebersicht(daten());
  assert.deepEqual(passendeAuslagen({ partner: 'testkasse', betragCent: 2000 }, offen).map((a) => a.buchung.id), ['arztrechnung'], 'Name und Rest passen');
  assert.deepEqual(passendeAuslagen({ partner: 'Jemand', betragCent: 3000 }, offen).map((a) => a.buchung.id), ['geschenk'], 'nur Betrag');
  assert.deepEqual(passendeAuslagen({ partner: 'Jemand', betragCent: 1 }, offen), []);
  // gelöschte Rückzahlung zählt nicht mehr
  const ohne = daten().map((x) => (x.id === 'kasse' ? { ...x, geloeschtAm: 'T' } : x));
  assert.equal(auslagenUebersicht(ohne).find((a) => a.buchung.id === 'arztrechnung').offenCent, 10000);
});

test('D214: Buchung speichern behält bzw. entfernt die Auslage', () => {
  const konten = [konto];
  const basis = { art: 'ausgabe', betragCent: 4200, datum: '2026-03-10', kontoId: 'k1', kategorieId: 'super' };
  const [neu] = baueBuchungen({ ...basis, auslage: { fuer: ' Max Muster ' } }, { konten, jetzt: 'T' });
  assert.deepEqual(neu.auslage, { fuer: 'Max Muster', erledigtAm: null, restCent: null });
  const abgeschlossen = { ...neu, auslage: { ...neu.auslage, erledigtAm: 'T', restCent: 200 } };
  const [geaendert] = baueBuchungen({ ...basis, notiz: 'neu', auslage: { fuer: 'Max Muster' } }, { konten, bestehende: [abgeschlossen], jetzt: 'T2' });
  assert.equal(geaendert.auslage.restCent, 200, 'Abschluss bleibt beim Bearbeiten');
  const [weg] = baueBuchungen({ ...basis, auslage: null }, { konten, bestehende: [abgeschlossen], jetzt: 'T3' });
  assert.equal(weg.auslage, null);
  const [ein] = baueBuchungen({ ...basis, art: 'einnahme', kategorieId: 'erst', auslageId: neu.id, auslage: { fuer: 'x' } }, { konten, jetzt: 'T' });
  assert.deepEqual([ein.auslage, ein.auslageId], [null, neu.id], 'Einnahme ist nie selbst eine Auslage');
});

test('D214: Migration auf Version 24', () => {
  const { daten: d } = migriereDaten({ version: 23, konten: [], kategorien: [], buchungen: [{ id: 'x', art: 'ausgabe' }] });
  assert.equal(d.version, 26);
  assert.deepEqual([d.buchungen[0].auslage, d.buchungen[0].auslageId], [null, null]);
});

test('D215: Aufrunden auf den nächsten vollen Euro', () => {
  assert.equal(aufrundungCent(1230), 70);
  assert.equal(aufrundungCent(1299), 1);
  assert.equal(aufrundungCent(1201), 99);
  assert.equal(aufrundungCent(1200), 0);
  const spar = { id: 'k2', name: 'Sparkonto (Test)', anfangssaldoCent: 0, stichtag: '2026-01-01' };
  const konten = [konto, spar];
  const e = { id: 'aufrunden', aktiv: true, vonKontoId: 'k1', zielKontoId: 'k2' };
  assert.ok(aufrundenGilt(e, 'k1'));
  assert.ok(!aufrundenGilt(e, 'k2'), 'nur vom Von-Konto');
  assert.ok(!aufrundenGilt({ ...e, aktiv: false }, 'k1'));
  assert.ok(!aufrundenGilt({ ...e, zielKontoId: 'k1' }, 'k1'), 'nicht auf dasselbe Konto');

  const [ausgabe] = baueBuchungen({ art: 'ausgabe', betragCent: 1230, datum: '2026-03-10', kontoId: 'k1', kategorieId: 'super' }, { konten, jetzt: 'T' });
  const neu = aufrundungAnpassen(ausgabe, e, [ausgabe], { konten, jetzt: 'T' });
  assert.equal(neu.length, 2, 'Umbuchung mit beiden Hälften');
  assert.deepEqual(neu.map((b) => [b.richtung, b.kontoId, b.betragCent, b.aufrundungFuer, b.datum]),
    [['ab', 'k1', 70, ausgabe.id, '2026-03-10'], ['zu', 'k2', 70, ausgabe.id, '2026-03-10']]);
  assert.equal(neu[0].notiz, 'Aufrundung');

  // Betrag geändert → dieselbe Umbuchung, neuer Betrag
  const geaendert = { ...ausgabe, betragCent: 1255 };
  const anders = aufrundungAnpassen(geaendert, e, [ausgabe, ...neu], { konten, jetzt: 'T2' });
  assert.deepEqual(anders.map((b) => [b.id, b.betragCent]), neu.map((b) => [b.id, 45]));
  // glatter Betrag, Häkchen aus oder Ausgabe gelöscht → alte Umbuchung in den Papierkorb
  for (const [a, an] of [[{ ...ausgabe, betragCent: 1300 }, true], [ausgabe, false], [{ ...ausgabe, geloeschtAm: 'T' }, true]]) {
    const weg = aufrundungAnpassen(a, e, [ausgabe, ...neu], { konten, an, jetzt: 'T3' });
    assert.deepEqual(weg.map((b) => [b.id, b.geloeschtAm]), neu.map((b) => [b.id, 'T3']));
  }
  // ohne bestehende Umbuchung und ohne Aufrundung: nichts zu tun
  assert.deepEqual(aufrundungAnpassen({ ...ausgabe, betragCent: 1300 }, e, [ausgabe], { konten }), []);
  assert.deepEqual(aufrundungAnpassen(ausgabe, { ...e, aktiv: false }, [ausgabe], { konten }), []);
  assert.equal(aufrundungenVon([ausgabe.id], [ausgabe, ...neu]).length, 2);
});

test('D216: Ausgaben eines Kontos automatisch ausgleichen (z. B. PayPal aus dem Girokonto)', () => {
  const paypal = { id: 'pp', name: 'Bezahldienst (Test)', anfangssaldoCent: 0, stichtag: '2026-01-01' };
  const konten = [konto, paypal];
  const e = { id: 'ausgleich', aktiv: true, kontoId: 'pp', vonKontoId: 'k1' };
  assert.ok(ausgleichGilt(e, 'pp'));
  assert.ok(!ausgleichGilt(e, 'k1'));
  assert.ok(!ausgleichGilt({ ...e, aktiv: false }, 'pp'));

  const [ausgabe] = baueBuchungen({ art: 'ausgabe', betragCent: 2399, datum: '2026-03-12', kontoId: 'pp', kategorieId: 'super', partner: 'Shop Muster' }, { konten, jetzt: 'T' });
  const neu = ausgleichAnpassen(ausgabe, e, [ausgabe], { konten, kategorien, jetzt: 'T' });
  assert.deepEqual(neu.map((b) => [b.richtung, b.kontoId, b.betragCent, b.datum, b.ausgleichFuer, b.budgetKategorieId]),
    [['ab', 'k1', 2399, '2026-03-12', ausgabe.id, 'leb'], ['zu', 'pp', 2399, '2026-03-12', ausgabe.id, 'leb']]);
  assert.equal(neu[0].notiz, 'Ausgleich Shop Muster');
  // Budget auf dem Girokonto verbraucht, PayPal-Konto bleibt bei 0
  const alle = [ausgabe, ...neu];
  assert.equal(ausgabenJeKontoUndKategorie(alle, kategorien, '2026-03').get(budgetSchluessel('k1', 'leb')), 2399);
  assert.equal(kontostand(paypal, alle, '2026-03-31'), 0);

  // Betrag geändert → gleiche Umbuchung; Projekt oder Auslage → ohne Budget
  const anders = ausgleichAnpassen({ ...ausgabe, betragCent: 1000, projektId: 'p1' }, e, alle, { konten, kategorien, jetzt: 'T2' });
  assert.deepEqual(anders.map((b) => [b.id, b.betragCent, b.budgetKategorieId]), neu.map((b) => [b.id, 1000, null]));
  const auslage = ausgleichAnpassen({ ...ausgabe, auslage: { fuer: 'x' } }, e, alle, { konten, kategorien });
  assert.equal(auslage[0].budgetKategorieId, null);
  // Häkchen aus, anderes Konto, Einnahme → alte Umbuchung in den Papierkorb
  for (const [a, an] of [[ausgabe, false], [{ ...ausgabe, kontoId: 'k1' }, true], [{ ...ausgabe, art: 'einnahme' }, true]]) {
    assert.deepEqual(ausgleichAnpassen(a, e, alle, { konten, kategorien, an, jetzt: 'T3' }).map((b) => b.geloeschtAm), ['T3', 'T3']);
  }
  assert.equal(ausgleicheVon([ausgabe.id], alle).length, 2);
});
