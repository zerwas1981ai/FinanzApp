import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baueBuchungen, gruppeVon, anzahlFuerKonto, anzahlFuerKategorien } from '../js/buchungen.js';
import { wirkungCent, kontostand, monatsuebersicht, vorgemerktBis } from '../js/rechnen.js';
import { migriereDaten } from '../js/migrationen.js';

const giro = { id: 'giro', name: 'Giro', anfangssaldoCent: 100000, stichtag: '2026-09-15' };
const tg = { id: 'tg', name: 'Tagesgeld', anfangssaldoCent: 500000, stichtag: '2026-09-01' };
const konten = [giro, tg];

const neu = (eingabe) => baueBuchungen({ status: 'gebucht', notiz: '', ...eingabe }, { konten })[0];

test('normale Buchung wird gebaut', () => {
  const b = neu({ art: 'ausgabe', betragCent: 1250, datum: '2026-10-01', kontoId: 'giro', kategorieId: 'k1', notiz: ' Test ' });
  assert.equal(b.art, 'ausgabe');
  assert.equal(b.betragCent, 1250);
  assert.equal(b.notiz, 'Test');
  assert.equal(b.geloeschtAm, null);
  assert.deepEqual(b.belege, []);
  assert.equal(b.umbuchungId, null);
});

test('Prüfungen: Betrag, Kategorie, Stichtag', () => {
  const basis = { art: 'ausgabe', datum: '2026-10-01', kontoId: 'giro', kategorieId: 'k1' };
  assert.throws(() => neu({ ...basis, betragCent: null }), /Betrag/);
  assert.throws(() => neu({ ...basis, betragCent: 0 }), /Betrag/);
  assert.throws(() => neu({ ...basis, betragCent: -5 }), /ohne Minus/);
  assert.throws(() => neu({ ...basis, betragCent: 5, kategorieId: null }), /Kategorie/);
  assert.throws(() => neu({ ...basis, betragCent: 5, datum: '2026-09-14' }), /Stichtag/);
  assert.ok(neu({ ...basis, betragCent: 5, datum: '2026-09-15' }), 'am Stichtag selbst erlaubt');
});

test('Umbuchung ergibt zwei verknüpfte Hälften', () => {
  const [ab, zu] = baueBuchungen(
    { art: 'umbuchung', betragCent: 20000, datum: '2026-10-02', kontoId: 'giro', gegenkontoId: 'tg' },
    { konten },
  );
  assert.equal(ab.umbuchungId, zu.umbuchungId);
  assert.equal(ab.richtung, 'ab');
  assert.equal(zu.richtung, 'zu');
  assert.equal(ab.kontoId, 'giro');
  assert.equal(zu.kontoId, 'tg');
  assert.equal(wirkungCent(ab) + wirkungCent(zu), 0);
  assert.deepEqual(gruppeVon(zu, [ab, zu]).map((b) => b.id).sort(), [ab.id, zu.id].sort());

  assert.throws(() => baueBuchungen({ art: 'umbuchung', betragCent: 1, datum: '2026-10-02', kontoId: 'giro', gegenkontoId: 'giro' }, { konten }), /verschiedene/);
  // Stichtag gilt für beide Konten
  assert.throws(() => baueBuchungen({ art: 'umbuchung', betragCent: 1, datum: '2026-09-10', kontoId: 'tg', gegenkontoId: 'giro' }, { konten }), /Giro/);
});

test('Bearbeiten behält IDs, Erstellzeit und Verknüpfung', () => {
  const alt = baueBuchungen({ art: 'umbuchung', betragCent: 100, datum: '2026-10-02', kontoId: 'giro', gegenkontoId: 'tg' }, { konten, jetzt: 'T1' });
  const neuStand = baueBuchungen({ art: 'umbuchung', betragCent: 300, datum: '2026-10-03', kontoId: 'giro', gegenkontoId: 'tg' }, { konten, bestehende: alt, jetzt: 'T2' });
  assert.deepEqual(neuStand.map((b) => b.id), alt.map((b) => b.id));
  assert.equal(neuStand[0].umbuchungId, alt[0].umbuchungId);
  assert.equal(neuStand[0].erstelltAm, 'T1');
  assert.equal(neuStand[0].geaendertAm, 'T2');
  assert.equal(neuStand[1].betragCent, 300);
});

test('Kontostand und Monatsübersicht', () => {
  const buchungen = [
    neu({ art: 'einnahme', betragCent: 300000, datum: '2026-10-01', kontoId: 'giro', kategorieId: 'gehalt' }),
    neu({ art: 'ausgabe', betragCent: 95000, datum: '2026-10-03', kontoId: 'giro', kategorieId: 'miete' }),
    neu({ art: 'ausgabe', betragCent: 5000, datum: '2026-09-20', kontoId: 'giro', kategorieId: 'x' }),
    { ...neu({ art: 'ausgabe', betragCent: 99999, datum: '2026-10-05', kontoId: 'giro', kategorieId: 'x' }), geloeschtAm: 'T' },
    { ...neu({ art: 'ausgabe', betragCent: 1000, datum: '2026-10-05', kontoId: 'giro', kategorieId: 'x' }), status: 'vorgemerkt' },
    ...baueBuchungen({ art: 'umbuchung', betragCent: 20000, datum: '2026-10-02', kontoId: 'giro', gegenkontoId: 'tg' }, { konten }),
  ];

  assert.equal(kontostand(giro, buchungen, '2026-09-30'), 95000);
  assert.equal(kontostand(giro, buchungen, '2026-10-31'), 95000 + 300000 - 20000 - 95000 - 1000);
  assert.equal(kontostand(tg, buchungen, '2026-10-31'), 520000);
  assert.equal(vorgemerktBis(giro, buchungen, '2026-10-31'), -1000);

  const okt = monatsuebersicht(giro, buchungen, 2026, 10);
  assert.equal(okt.anfang, 95000);
  assert.equal(okt.einnahmen, 300000);
  assert.equal(okt.ausgaben, 96000, 'Papierkorb zählt nicht, Umbuchung ist keine Ausgabe');
  assert.equal(okt.umbuchungen, -20000);
  assert.equal(okt.ende, 279000);
  assert.deepEqual(okt.tage.map((t) => t.datum), ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-05']);
  assert.equal(okt.tage[0].standAbend, 395000);
  assert.equal(okt.tage.at(-1).standAbend, okt.ende);

  const sep = monatsuebersicht(giro, buchungen, 2026, 9);
  assert.ok(sep.stichtagImMonat);
  assert.equal(sep.anfang, 100000);
  assert.equal(sep.ende, 95000);
  assert.ok(monatsuebersicht(giro, buchungen, 2026, 8).vorStichtag);
});

test('Zählen für die Löschsperre (Papierkorb zählt mit)', () => {
  const b = [
    { kontoId: 'giro', kategorieId: 'a' },
    { kontoId: 'giro', kategorieId: 'b', geloeschtAm: 'T' },
    { kontoId: 'tg', kategorieId: null },
  ];
  assert.equal(anzahlFuerKonto('giro', b), 2);
  assert.equal(anzahlFuerKategorien(['a', 'b'], b), 2);
  assert.equal(anzahlFuerKategorien(['z'], b), 0);
});

test('Migration 1 → aktuell ergänzt leere Sammlungen und behält Daten', () => {
  const v1 = { version: 1, konten: [{ id: 'k' }], kategorien: [{ id: 'c' }] };
  const { daten, angewendet } = migriereDaten(v1);
  assert.equal(daten.version, 3);
  assert.deepEqual(angewendet, [2, 3]);
  assert.deepEqual(daten.buchungen, []);
  assert.deepEqual(daten.abstimmungen, []);
  assert.deepEqual(daten.konten, [{ id: 'k' }]);
});
