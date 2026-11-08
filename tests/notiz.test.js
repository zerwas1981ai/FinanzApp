// D96: Wiederkehrende Buchungen ohne Pflicht-Bezeichnung, mit optionaler Notiz. Nur erfundene Testdaten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { annahmeTitel, zeitleiste } from '../js/prognose.js';
import { migriereDaten } from '../js/migrationen.js';

const kategorien = [
  { id: 'wohnen', name: 'Wohnen', elternId: null, art: 'ausgabe' },
  { id: 'miete', name: 'Miete', elternId: 'wohnen' },
];

test('Titel: Empfänger/Absender · Notiz, sonst Unterkategorie bzw. Umbuchung', () => {
  assert.equal(annahmeTitel({ partner: 'Vermietung Beispiel', notiz: 'Wohnung', kategorieId: 'miete' }, kategorien), 'Vermietung Beispiel · Wohnung');
  assert.equal(annahmeTitel({ partner: 'Vermietung Beispiel', notiz: '', kategorieId: 'miete' }, kategorien), 'Vermietung Beispiel');
  assert.equal(annahmeTitel({ partner: '', notiz: 'Wohnung', kategorieId: 'miete' }, kategorien), 'Wohnung');
  assert.equal(annahmeTitel({ partner: '', notiz: '', kategorieId: 'miete' }, kategorien), 'Miete');
  assert.equal(annahmeTitel({ art: 'umbuchung', partner: '', notiz: '' }, kategorien), 'Umbuchung');
  assert.equal(annahmeTitel({ bezeichnung: 'Autoreparatur', partner: 'Werkstatt' }), 'Autoreparatur', 'geplante behalten die Bezeichnung');
});

test('Migration 15: Bezeichnung wird zur Notiz, nichts geht verloren', () => {
  const v14 = { version: 14, konten: [], kategorien: [], buchungen: [], wiederkehrend: [
    { id: 'a', bezeichnung: 'Miete' }, { id: 'b', bezeichnung: 'Alt', notiz: 'schon da' },
  ], geplant: [{ id: 'g', bezeichnung: 'Autoreparatur' }] };
  const { daten } = migriereDaten(v14);
  assert.deepEqual(daten.wiederkehrend.map(({ id, notiz, bezeichnung }) => ({ id, notiz, bezeichnung })), [{ id: 'a', notiz: 'Miete', bezeichnung: undefined }, { id: 'b', notiz: 'schon da', bezeichnung: undefined }]);
  assert.equal(daten.geplant[0].bezeichnung, 'Autoreparatur', 'geplante unverändert');
});

test('Zeitleiste zeigt den neuen Titel', () => {
  const daten = {
    konten: [{ id: 'giro', name: 'Giro', anfangssaldoCent: 0, stichtag: '2026-01-01', mindestsaldoCent: null }],
    kategorien, buchungen: [], budgets: [], geplant: [],
    wiederkehrende: [{ id: 'w', notiz: '', partner: 'Vermietung Beispiel', art: 'ausgabe', kontoId: 'giro', gegenkontoId: null,
      kategorieId: 'miete', intervall: 'monatlich', start: '2026-12-03', stufen: [{ ab: '2026-12-03', betragCent: 95000 }], ausnahmen: [] }],
  };
  const dez = zeitleiste(daten, '2026-11-06', '2026-12').jeKonto.get('giro')[0];
  assert.equal(dez.posten[0].text, 'Vermietung Beispiel');
});
