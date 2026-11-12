// Tests zu D148 (Verträge) – nur erfundene Testdaten
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  plusMonate, laufzeitEnde, kuendigungsTag, baueVertrag, vertragsStand, kuendigungsHinweise, vertragVon,
  vertragsBuchungen, vertragsKosten, vertragsUebersicht, endeVorschlag, zuordnungsKandidaten, fristText,
} from '../js/vertraege.js';
import { migriereDaten } from '../js/migrationen.js';
import { baueBuchungen } from '../js/buchungen.js';

const basis = { id: 'v1', name: 'Internet (Test)', beginn: '2024-12-01', mindestlaufzeitMonate: 24, verlaengerungMonate: 1, fristAnzahl: 1, fristEinheit: 'monate', erinnerungTage: 28 };

test('Datumsrechnung: Monate, Laufzeitende, Kündigungstag', () => {
  assert.equal(plusMonate('2026-01-31', 1), '2026-02-28');
  assert.equal(plusMonate('2024-01-31', 1), '2024-02-29');
  assert.equal(plusMonate('2026-11-15', -12), '2025-11-15');
  assert.equal(plusMonate('2026-03-31', -1), '2026-02-28');
  assert.equal(laufzeitEnde('2025-03-01', 24), '2027-02-28');
  assert.equal(laufzeitEnde('2025-03-15', 12), '2026-03-14');
  assert.equal(kuendigungsTag('2026-12-31', 3, 'monate'), '2026-09-30');
  assert.equal(kuendigungsTag('2026-12-31', 6, 'wochen'), '2026-11-19');
  assert.equal(kuendigungsTag('2026-12-31', 14, 'tage'), '2026-12-17');
  assert.equal(fristText({ fristAnzahl: 1, fristEinheit: 'monate' }), '1 Monat');
  assert.equal(fristText({ fristAnzahl: 6, fristEinheit: 'wochen' }), '6 Wochen');
});

test('Vertrag bauen: Pflichtfelder und Prüfungen', () => {
  const v = baueVertrag({ name: '  Handy ', anbieter: ' Telefon AG (Test) ', mindestlaufzeitMonate: '24', beginn: '2025-01-01', verlaengerungMonate: '1', fristAnzahl: '1', fristEinheit: 'monate', erinnerungTage: '' }, { jetzt: 'T' });
  assert.equal(v.name, 'Handy');
  assert.equal(v.mindestlaufzeitMonate, 24);
  assert.equal(v.erinnerungTage, 28, 'Standard 4 Wochen');
  assert.equal(v.anbieter, 'Telefon AG (Test)');
  assert.throws(() => baueVertrag({ name: '' }), /Namen/);
  assert.throws(() => baueVertrag({ name: 'handy', anbieter: 'A' }, { vertraege: [v] }), /gibt es schon/);
  assert.throws(() => baueVertrag({ name: 'X', anbieter: '   ' }), /Empfänger/, 'D150: Empfänger ist Pflicht');
  assert.throws(() => baueVertrag({ name: 'X', anbieter: 'A', mindestlaufzeitMonate: '12' }), /Vertragsbeginn/);
  assert.throws(() => baueVertrag({ name: 'X', anbieter: 'A', fristAnzahl: '1,5' }), /ganze Zahl/);
  assert.throws(() => baueVertrag({ name: 'X', anbieter: 'A', beginn: '2025-05-01', gekuendigtZum: '2025-04-01' }), /vor dem Vertragsbeginn/);
  // Bearbeiten: ID und Unterlagen bleiben, „Behalten“ bleibt
  const neu = baueVertrag({ name: 'Handy', anbieter: 'Telefon AG (Test)', erinnerungAusBis: undefined }, { alt: { ...v, belege: [{ id: 'b' }], erinnerungAusBis: '2026-11-30' }, vertraege: [v] });
  assert.equal(neu.id, v.id);
  assert.deepEqual(neu.belege, [{ id: 'b' }]);
  assert.equal(neu.erinnerungAusBis, '2026-11-30');
});

test('Stand: verlängert sich bei verpasster Frist, Erinnerung im Vorlauf', () => {
  // Erstes Ende 30.11.2026, kündigen bis 30.10.2026 – verpasst → verlängert bis 31.12.2026, kündigen bis 30.11.2026
  const s = vertragsStand(basis, '2026-11-12');
  assert.equal(s.status, 'laufend');
  assert.equal(s.ende, '2026-12-31');
  assert.equal(s.kuendigenBis, '2026-11-30');
  assert.equal(s.tageBisFrist, 18);
  assert.equal(s.erinnern, true);
  // Mitten in der Mindestlaufzeit: keine Erinnerung
  const frueh = vertragsStand(basis, '2025-06-01');
  assert.equal(frueh.ende, '2026-11-30');
  assert.equal(frueh.erinnern, false);
  // „Behalten“ blendet nur diesen Termin aus
  assert.equal(vertragsStand({ ...basis, erinnerungAusBis: '2026-11-30' }, '2026-11-12').erinnern, false);
  assert.equal(vertragsStand({ ...basis, erinnerungAusBis: '2026-11-30' }, '2026-12-10').erinnern, true);
  // Gekündigt / beendet / endet von selbst / unbefristet
  assert.equal(vertragsStand({ ...basis, gekuendigtZum: '2026-12-31' }, '2026-11-12').status, 'gekuendigt');
  assert.equal(vertragsStand({ ...basis, gekuendigtZum: '2026-10-31' }, '2026-11-12').status, 'beendet');
  assert.equal(vertragsStand({ ...basis, verlaengerungMonate: 0 }, '2026-11-12').status, 'laeuft-aus');
  assert.equal(vertragsStand({ ...basis, verlaengerungMonate: 0 }, '2026-12-01').status, 'beendet');
  const frei = vertragsStand({ name: 'Abo', fristAnzahl: 1, fristEinheit: 'monate' }, '2026-11-12');
  assert.equal(frei.status, 'unbefristet');
  assert.equal(frei.ende, '2026-12-12');
  assert.equal(frei.erinnern, false);
});

test('Hinweise: nur fällige, dringendste zuerst', () => {
  const kfz = { id: 'v2', name: 'Kfz', beginn: '2021-01-01', mindestlaufzeitMonate: 12, verlaengerungMonate: 12, fristAnzahl: 1, fristEinheit: 'monate', erinnerungTage: 60 };
  const strom = { id: 'v3', name: 'Strom', beginn: '2023-03-01', mindestlaufzeitMonate: 12, verlaengerungMonate: 12, fristAnzahl: 6, fristEinheit: 'wochen', erinnerungTage: 28 };
  const h = kuendigungsHinweise([kfz, basis, strom], '2026-11-12');
  assert.deepEqual(h.map((x) => x.vertrag.id), ['v2', 'v1'], 'gleicher Termin: Reihenfolge bleibt');
  assert.deepEqual(h.map((x) => x.stand.kuendigenBis), ['2026-11-30', '2026-11-30']);
  assert.ok(!h.some((x) => x.vertrag.id === 'v3'), 'Strom: Frist erst im Januar');
});

test('Zuordnung rückwirkend über die wiederkehrende Buchung, Kosten je Monat/Jahr', () => {
  const wk = [
    { id: 'w1', vertragId: 'v1', art: 'ausgabe', intervall: 'monatlich', stufen: [{ ab: '2024-12-01', betragCent: 3499 }, { ab: '2026-03-01', betragCent: 3999 }], aktiv: true },
    { id: 'w2', vertragId: 'v1', art: 'ausgabe', intervall: 'jaehrlich', stufen: [{ ab: '2025-01-01', betragCent: 1200 }], aktiv: true },
    { id: 'w3', vertragId: 'v1', art: 'ausgabe', intervall: 'monatlich', stufen: [{ ab: '2025-01-01', betragCent: 999 }], aktiv: false },
    { id: 'w4', vertragId: 'v1', art: 'ausgabe', intervall: 'monatlich', stufen: [{ ab: '2025-01-01', betragCent: 500 }], ende: '2026-01-31' },
    { id: 'w5', vertragId: 'v2', art: 'ausgabe', intervall: 'vierteljaehrlich', stufen: [{ ab: '2025-01-01', betragCent: 3000 }] },
  ];
  const buchungen = [
    { id: 'b1', datum: '2026-10-05', wiederkehrendId: 'w1', art: 'ausgabe', betragCent: 3999 },
    { id: 'b2', datum: '2026-09-05', wiederkehrendId: 'w1', art: 'ausgabe', betragCent: 3999, vertragId: 'v9' },
    { id: 'b3', datum: '2026-08-20', vertragId: 'v1', art: 'ausgabe', betragCent: 4900, partner: 'Telefon AG' },
    { id: 'b4', datum: '2026-07-05', wiederkehrendId: 'w1', art: 'ausgabe', betragCent: 3999, geloeschtAm: 'X' },
  ];
  const wkMap = new Map(wk.map((w) => [w.id, w]));
  assert.equal(vertragVon(buchungen[0], wkMap), 'v1');
  assert.equal(vertragVon(buchungen[1], wkMap), 'v9', 'eigene Zuordnung hat Vorrang');
  assert.deepEqual(vertragsBuchungen('v1', buchungen, wk).map((b) => b.id), ['b1', 'b3']);
  const k = vertragsKosten('v1', wk, '2026-11-12');
  assert.deepEqual(k.posten.map((w) => w.id), ['w1', 'w2'], 'ausgeschaltete und beendete zählen nicht');
  assert.equal(k.jahrCent, 3999 * 12 + 1200);
  assert.equal(k.monatCent, Math.round((3999 * 12 + 1200) / 12));
  const u = vertragsUebersicht([basis, { id: 'v2', name: 'B', fristAnzahl: 1, fristEinheit: 'monate' }, { id: 'v3', name: 'C', gekuendigtZum: '2026-01-31' }], wk, '2026-11-12');
  assert.equal(u.anzahl, 2, 'beendete zählen nicht');
  assert.equal(u.jahrCent, 3999 * 12 + 1200 + 3000 * 4);
  // Kündigung: Vorschlag, wiederkehrende zu beenden
  assert.deepEqual(endeVorschlag('v1', '2026-12-31', wk).map((w) => w.id), ['w1', 'w2', 'w3']);
  // Zuordnen: Kandidaten nach Suchbegriff, ohne schon zugeordnete
  const kandidaten = zuordnungsKandidaten('v1', 'telefon', [...buchungen, { id: 'b5', datum: '2026-06-01', art: 'ausgabe', partner: 'Telefon AG', betragCent: 100 }], wk);
  assert.deepEqual(kandidaten.map((b) => b.id), ['b5']);
});

test('Migration auf 18 und Feld vertragId an Buchungen', () => {
  const { daten } = migriereDaten({ version: 17, buchungen: [{ id: 'b' }], wiederkehrend: [{ id: 'w' }] });
  assert.deepEqual(daten.vertraege, []);
  assert.equal(daten.buchungen[0].vertragId, null);
  assert.equal(daten.wiederkehrend[0].vertragId, null);
  const konten = [{ id: 'giro', name: 'Giro', stichtag: '2026-01-01' }];
  const eingabe = { art: 'ausgabe', betragCent: 100, datum: '2026-10-01', kontoId: 'giro', kategorieId: 'k1' };
  const [b] = baueBuchungen({ ...eingabe, vertragId: 'v1' }, { konten });
  assert.equal(b.vertragId, 'v1');
  assert.equal(baueBuchungen({ ...eingabe }, { konten, bestehende: [b] })[0].vertragId, 'v1', 'undefined = unverändert');
  assert.equal(baueBuchungen({ ...eingabe, vertragId: '' }, { konten, bestehende: [b] })[0].vertragId, null);
});
