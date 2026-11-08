// D94: Wiederkehrende Buchungen mit festen Abweichungen je Kalendermonat (z. B. Weihnachtsgeld). Nur erfundene Testdaten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { termine, terminBetrag, zeitleiste } from '../js/prognose.js';
import { baueWiederkehrend, mitAusnahme } from '../js/annahmen.js';
import { migriereDaten } from '../js/migrationen.js';

const konten = [{ id: 'giro', name: 'Giro', anfangssaldoCent: 0, stichtag: '2026-01-01', mindestsaldoCent: null }];
const kategorien = [
  { id: 'eink', name: 'Einkommen', elternId: null, art: 'einnahme' },
  { id: 'gehalt', name: 'Gehalt', elternId: 'eink' },
];
const gehalt = {
  id: 'g', bezeichnung: 'Gehalt', art: 'einnahme', kontoId: 'giro', gegenkontoId: null, kategorieId: 'gehalt',
  intervall: 'monatlich', start: '2026-01-25', ende: null, monatsletzter: false,
  stufen: [{ ab: '2026-01-25', betragCent: 300000 }, { ab: '2028-01-25', betragCent: 320000 }],
  ausnahmen: [], kalenderMonate: [{ monat: 11, betragCent: 480000 }], erstelltAm: '2026-01-01T00:00:00Z',
};

test('Termin im abweichenden Monat bekommt jedes Jahr den festen Betrag', () => {
  const t = termine(gehalt, '2026-10-01', '2028-12-31');
  const betrag = (datum) => t.find((x) => x.datum === datum).betragCent;
  assert.equal(betrag('2026-10-25'), 300000);
  assert.equal(betrag('2026-11-25'), 480000);
  assert.equal(betrag('2027-11-25'), 480000);
  assert.equal(betrag('2028-02-25'), 320000, 'neue Stufe');
  assert.equal(betrag('2028-11-25'), 480000, 'November bleibt fest');
  assert.equal(terminBetrag({ ...gehalt, kalenderMonate: undefined }, '2027-11-25'), 300000, 'ältere Datensätze ohne Feld');
});

test('Einzelne Termin-Änderung hat Vorrang; gleich dem Novemberbetrag = keine Ausnahme', () => {
  const geaendert = mitAusnahme(gehalt, '2026-11-25', 'aendern', '2026-11-25', 500000);
  assert.equal(termine(geaendert, '2026-11-01', '2026-11-30')[0].betragCent, 500000);
  assert.equal(termine(geaendert, '2027-11-01', '2027-11-30')[0].betragCent, 480000);
  assert.deepEqual(mitAusnahme(gehalt, '2026-11-25', 'aendern', '2026-11-25', 480000).ausnahmen, []);
});

test('Vierteljährlich: nur Termine im gewählten Monat weichen ab', () => {
  const q = { ...gehalt, intervall: 'vierteljaehrlich', start: '2026-03-31', stufen: [{ ab: '2026-03-31', betragCent: 1000 }], kalenderMonate: [{ monat: 12, betragCent: 5000 }] };
  assert.deepEqual(termine(q, '2026-01-01', '2026-12-31').map((t) => t.betragCent), [1000, 1000, 1000, 5000]);
});

test('Zeitleiste rechnet mit dem Novemberbetrag', () => {
  const zl = zeitleiste({ konten, kategorien, buchungen: [], budgets: [], wiederkehrende: [gehalt], geplant: [] }, '2026-12-06', '2027-12');
  const ein = (m) => zl.jeKonto.get('giro').find((z) => z.monat === m).einnahmen;
  assert.equal(ein('2027-10'), 300000);
  assert.equal(ein('2027-11'), 480000);
});

test('Anlegen: Abweichungen prüfen (Betrag größer 0)', () => {
  const eingabe = {
    bezeichnung: 'Gehalt', art: 'einnahme', kontoId: 'giro', kategorieId: 'gehalt', intervall: 'monatlich',
    start: '2026-12-25', monatsletzter: false, ende: '', stufen: [{ ab: '', betragCent: 300000 }], partner: '',
  };
  const w = baueWiederkehrend({ ...eingabe, kalenderMonate: [{ monat: '11', betragCent: 480000 }] }, { konten, kategorien });
  assert.deepEqual(w.kalenderMonate, [{ monat: 11, betragCent: 480000 }]);
  assert.throws(() => baueWiederkehrend({ ...eingabe, kalenderMonate: [{ monat: '11', betragCent: 0 }] }, { konten, kategorien }), /größer 0/);
  assert.deepEqual(baueWiederkehrend(eingabe, { konten, kategorien, alt: w }).kalenderMonate, w.kalenderMonate, 'ohne Angabe bleibt es');
});

test('Migration auf Version 14 ergänzt das Feld', () => {
  const v13 = { version: 13, konten: [], kategorien: [], buchungen: [], wiederkehrend: [{ id: 'w' }] };
  assert.deepEqual(migriereDaten(v13).daten.wiederkehrend[0].kalenderMonate, []);
});
