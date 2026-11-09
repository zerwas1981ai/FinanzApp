// D104: Vorlagen für häufige Buchungen. Nur erfundene Testdaten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baueVorlage, vorlageZuWerten, namensVorschlag, sortiereVorlagen } from '../js/vorlagen.js';
import { verschiebeKonto } from '../js/konten.js';

const konten = [
  { id: 'giro', name: 'Giro (Test)' },
  { id: 'tg', name: 'Tagesgeld (Test)' },
  { id: 'alt', name: 'Altes Konto', archiviert: true },
];
const kategorien = [
  { id: 'leben', name: 'Lebensmittel', elternId: null, art: 'ausgabe' },
  { id: 'baeck', name: 'Bäckerei', elternId: 'leben' },
  { id: 'eink', name: 'Einkommen', elternId: null, art: 'einnahme' },
  { id: 'gehalt', name: 'Gehalt', elternId: 'eink' },
  { id: 'weg', name: 'Alt', elternId: 'leben', archiviert: true },
];
const ctx = { konten, kategorien, jetzt: '2026-11-09T10:00:00Z' };

test('Vorlage bauen: Pflichtfelder, Name eindeutig, Betrag optional', () => {
  const v = baueVorlage({ name: ' Bäcker  Muster ', art: 'ausgabe', kontoId: 'giro', kategorieId: 'baeck', partner: 'Bäcker Muster', notiz: '', betragCent: 450 }, ctx);
  assert.equal(v.name, 'Bäcker Muster');
  assert.equal(v.betragCent, null, 'ohne „mitBetrag“ kein Betrag');
  assert.equal(v.reihenfolge, 0);
  assert.equal(v.gegenkontoId, null);
  const mit = baueVorlage({ name: 'Fitness', art: 'ausgabe', kontoId: 'giro', kategorieId: 'baeck', betragCent: 2990, mitBetrag: true }, { ...ctx, vorhandene: [v] });
  assert.equal(mit.betragCent, 2990);
  assert.equal(mit.reihenfolge, 1, 'neue Vorlage ans Ende');
  assert.throws(() => baueVorlage({ name: 'bäcker muster', art: 'ausgabe', kontoId: 'giro' }, { ...ctx, vorhandene: [v] }), /schon eine Vorlage/);
  assert.throws(() => baueVorlage({ name: '', art: 'ausgabe', kontoId: 'giro' }, ctx), /Namen/);
  assert.throws(() => baueVorlage({ name: 'X', art: 'ausgabe', kontoId: 'giro', mitBetrag: true, betragCent: null }, ctx), /Betrag/);
  assert.throws(() => baueVorlage({ name: 'X', art: 'einnahme', kontoId: 'giro', kategorieId: 'baeck' }, ctx), /passt nicht/);
  // Bearbeiten: Name darf gleich bleiben, ID/Erstellzeit/Reihenfolge bleiben
  const neu = baueVorlage({ name: 'Bäcker Muster', art: 'ausgabe', kontoId: 'tg', kategorieId: 'baeck' }, { ...ctx, vorhandene: [v, mit], alt: v, jetzt: '2026-12-01T00:00:00Z' });
  assert.equal(neu.id, v.id);
  assert.equal(neu.erstelltAm, v.erstelltAm);
  assert.equal(neu.reihenfolge, 0);
  assert.equal(neu.kontoId, 'tg');
});

test('Umbuchung als Vorlage: Zielkonto nötig, kein Empfänger', () => {
  const u = baueVorlage({ name: 'Sparen', art: 'umbuchung', kontoId: 'giro', gegenkontoId: 'tg', partner: 'X', kategorieId: 'baeck' }, ctx);
  assert.equal(u.gegenkontoId, 'tg');
  assert.equal(u.partner, '');
  assert.equal(u.kategorieId, null);
  assert.throws(() => baueVorlage({ name: 'S', art: 'umbuchung', kontoId: 'giro', gegenkontoId: 'giro' }, ctx), /verschieden/);
});

test('Vorbelegen: archivierte Konten/Kategorien werden weggelassen', () => {
  const v = { art: 'ausgabe', kontoId: 'alt', kategorieId: 'weg', partner: 'P', notiz: 'N', betragCent: 100 };
  assert.deepEqual(vorlageZuWerten(v, { konten, kategorien }), {
    art: 'ausgabe', kontoId: null, gegenkontoId: null, kategorieId: null, budgetKategorieId: null, partner: 'P', notiz: 'N', betragCent: 100,
  });
  const ok = vorlageZuWerten({ art: 'ausgabe', kontoId: 'giro', kategorieId: 'baeck', betragCent: null }, { konten, kategorien });
  assert.equal(ok.kontoId, 'giro');
  assert.equal(ok.kategorieId, 'baeck');
  assert.equal(ok.betragCent, null);
});

test('Namensvorschlag und Reihenfolge', () => {
  assert.equal(namensVorschlag({ art: 'ausgabe', partner: ' Tankstelle ', kategorieId: 'baeck' }, kategorien), 'Tankstelle');
  assert.equal(namensVorschlag({ art: 'ausgabe', partner: '', kategorieId: 'baeck' }, kategorien), 'Bäckerei');
  assert.equal(namensVorschlag({ art: 'umbuchung' }, kategorien), 'Umbuchung');
  const liste = [{ id: 'a', name: 'A', reihenfolge: 1 }, { id: 'b', name: 'B', reihenfolge: 0 }];
  assert.deepEqual(sortiereVorlagen(liste).map((v) => v.id), ['b', 'a']);
  assert.deepEqual(verschiebeKonto(liste, 'a', -1).map((v) => [v.id, v.reihenfolge]), [['a', 0], ['b', 1]], '▲/▼ wie bei Konten');
});
