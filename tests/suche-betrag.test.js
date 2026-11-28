// Tests zu D261: Betragsvergleiche in der Suche (Lupe) – nur erfundene Testdaten
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suche, zerlegeSuche } from '../js/suche.js';

test('D261: Suchbegriff zerlegen – Vergleiche und Bereiche werden Betragsbedingungen', () => {
  assert.deepEqual(zerlegeSuche('> 100'), { woerter: [], betrag: [{ von: 10001, bis: Infinity }] });
  assert.deepEqual(zerlegeSuche('>=100').betrag, [{ von: 10000, bis: Infinity }]);
  assert.deepEqual(zerlegeSuche('< 20').betrag, [{ von: 0, bis: 1999 }]);
  assert.deepEqual(zerlegeSuche('<= 49,99').betrag, [{ von: 0, bis: 4999 }]);
  assert.deepEqual(zerlegeSuche('50-100').betrag, [{ von: 5000, bis: 10000 }]);
  assert.deepEqual(zerlegeSuche('Markt 1.000 - 1.200,5').betrag, [{ von: 100000, bis: 120050 }]);
  assert.deepEqual(zerlegeSuche('Markt 1.000 - 1.200,5').woerter, ['markt']);
  assert.deepEqual(zerlegeSuche('Rewe >50 <100'), { woerter: ['rewe'], betrag: [{ von: 5001, bis: Infinity }, { von: 0, bis: 9999 }] });
  // Kein Vergleich: bleibt ein Suchwort
  assert.deepEqual(zerlegeSuche('85,00 2026-11 100-50 a-b >x').woerter, ['85,00', '2026-11', '100-50', 'a-b', '>x']);
  assert.deepEqual(zerlegeSuche('85,00').betrag, []);
});

test('D261: Suche mit Betragsbedingung – auch kombiniert mit Wörtern', () => {
  const daten = {
    konten: [{ id: 'giro', name: 'Giro (Test)' }],
    kategorien: [{ id: 'h1', name: 'Lebensmittel' }, { id: 'u1', name: 'Supermarkt', elternId: 'h1' }],
    projekte: [{ id: 'p1', name: 'Markt-Projekt', rahmenCent: 500000 }],
    vertraege: [{ id: 'v1', name: 'Markt-Vertrag' }],
    buchungen: [
      { id: 'klein', art: 'ausgabe', datum: '2026-11-01', betragCent: 1999, kontoId: 'giro', kategorieId: 'u1', partner: 'Markt Muster' },
      { id: 'mittel', art: 'ausgabe', datum: '2026-11-02', betragCent: 5000, kontoId: 'giro', kategorieId: 'u1', partner: 'Markt Muster' },
      { id: 'gross', art: 'ausgabe', datum: '2026-11-03', betragCent: 14999, kontoId: 'giro', kategorieId: 'u1', partner: 'Bäcker Beispiel' },
      { id: 'weg', art: 'ausgabe', datum: '2026-11-04', betragCent: 90000, kontoId: 'giro', kategorieId: 'u1', geloeschtAm: 'X' },
    ],
    relevant: [{ id: 'r1', datum: '2026-01-01', betragCent: 120000, notiz: 'Fernseher' }],
    wiederkehrend: [{ id: 'w1', art: 'ausgabe', partner: 'Markt Abo', kontoId: 'giro', kategorieId: 'u1', intervall: 'monatlich', start: '2026-01-01', stufen: [{ ab: '2026-01-01', betragCent: 999 }] }],
    geplant: [{ id: 'g1', art: 'ausgabe', bezeichnung: 'Waschmaschine', datum: '2026-12-01', betragCent: 60000, kontoId: 'giro' }],
  };
  const ids = (r) => Object.values(r).flat().map((t) => t.id).sort();
  assert.deepEqual(ids(suche('> 100', daten)), ['g1', 'gross', 'r1'], 'Papierkorb, Projekte und Verträge nie');
  assert.deepEqual(ids(suche('< 20', daten)), ['klein', 'w1']);
  assert.deepEqual(ids(suche('<= 19,99', daten)), ['klein', 'w1'], 'Grenze zählt mit');
  assert.deepEqual(ids(suche('muster > 20', daten)), ['mittel']);
  assert.deepEqual(ids(suche('50-150', daten)), ['gross', 'mittel']);
  assert.deepEqual(ids(suche('50 - 149,98', daten)), ['mittel']);
  assert.deepEqual(ids(suche('markt', daten)), ['gross', 'klein', 'mittel', 'p1', 'v1', 'w1'], 'ohne Bedingung wie bisher (auch „Supermarkt“)');
});
