// Tests zu D227 (gekoppelte wiederkehrende Umbuchung) – nur erfundene Testdaten
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nurWirksam, gekoppelteUmbuchungen, offeneTermine, zeitleiste, faelligListe } from '../js/prognose.js';
import { baueWiederkehrend } from '../js/annahmen.js';
import { baueBuchungen, ausgleichAnpassen } from '../js/buchungen.js';

const giro = { id: 'giro', name: 'Giro (Test)', anfangssaldoCent: 100000, stichtag: '2026-11-01' };
const pp = { id: 'pp', name: 'Bezahldienst (Test)', anfangssaldoCent: 0, stichtag: '2026-11-01' };
const konten = [giro, pp];
const kategorien = [
  { id: 'frei', name: 'Freizeit', elternId: null, art: 'ausgabe' },
  { id: 'stream', name: 'Streaming', elternId: 'frei' },
];
const abo = {
  id: 'abo', art: 'ausgabe', kontoId: 'pp', gegenkontoId: null, kategorieId: 'stream', partner: 'Streaming Muster', notiz: '',
  intervall: 'monatlich', start: '2026-11-15', stufen: [{ ab: '2026-11-15', betragCent: 1399 }], ausnahmen: [],
  erstelltAm: '2026-11-01T00:00:00Z', umbuchungVonKontoId: 'giro',
};

test('D227: Feld „Umbuchung von Konto“ prüfen', () => {
  const eingabe = {
    art: 'ausgabe', kontoId: 'pp', kategorieId: 'stream', intervall: 'monatlich', start: '2026-11-15',
    stufen: [{ ab: '', betragCent: 1399 }], umbuchungVonKontoId: 'giro',
  };
  assert.equal(baueWiederkehrend(eingabe, { konten, kategorien }).umbuchungVonKontoId, 'giro');
  assert.equal(baueWiederkehrend({ ...eingabe, umbuchungVonKontoId: '' }, { konten, kategorien }).umbuchungVonKontoId, null);
  assert.throws(() => baueWiederkehrend({ ...eingabe, umbuchungVonKontoId: 'pp' }, { konten, kategorien }), /anderes Konto/);
  // Nur bei Ausgaben; undefined = unverändert
  assert.equal(baueWiederkehrend({ ...eingabe, art: 'umbuchung', gegenkontoId: 'giro', kontoId: 'pp' }, { konten, kategorien }).umbuchungVonKontoId, null);
  assert.equal(baueWiederkehrend({ ...eingabe, umbuchungVonKontoId: undefined }, { konten, kategorien, alt: { id: 'x', umbuchungVonKontoId: 'giro' } }).umbuchungVonKontoId, 'giro');
});

test('D227: abgeleitete Umbuchung in der Prognose, nicht einzeln buchbar', () => {
  const [u] = gekoppelteUmbuchungen([abo], kategorien);
  assert.deepEqual([u.art, u.kontoId, u.gegenkontoId, u.budgetKategorieId, u.notiz, u.gekoppelt], ['umbuchung', 'giro', 'pp', 'frei', 'Umbuchung für Streaming Muster', abo]);
  assert.equal(gekoppelteUmbuchungen([{ ...abo, umbuchungVonKontoId: null }]).length, 0);
  assert.equal(gekoppelteUmbuchungen([{ ...abo, aktiv: false }]).length, 1, 'Filter macht nurWirksam');
  assert.equal(nurWirksam({ wiederkehrend: [{ ...abo, aktiv: false }], kategorien }).wiederkehrende.length, 0);

  const daten = nurWirksam({ konten, kategorien, buchungen: [], budgets: [], wiederkehrend: [abo], geplant: [] });
  assert.equal(daten.wiederkehrende.length, 2);
  // Fällig-Liste und offene Termine ohne die gekoppelte; mit Schalter dabei
  assert.equal(faelligListe(daten, '2026-11-14').length, 1);
  assert.equal(offeneTermine(daten, '2026-11-14', '2026-11-30').length, 1);
  assert.equal(offeneTermine(daten, '2026-11-14', '2026-11-30', { mitGekoppelten: true }).length, 2);

  // Zeitleiste (Nov. offen, dann Dez./Jan.): Giro −13,99 je Monat, Bezahldienst bleibt bei 0
  const zl = zeitleiste(daten, '2026-11-14', '2027-01');
  assert.deepEqual(zl.jeKonto.get('pp').map((z) => z.stand), [0, 0]);
  assert.deepEqual(zl.jeKonto.get('giro').map((z) => z.stand), [100000 - 2 * 1399, 100000 - 3 * 1399]);
  // Antippen in der Zeitleiste ändert die Ausgabe, nicht die abgeleitete Umbuchung
  const posten = zl.jeKonto.get('giro')[0].posten[0];
  assert.equal(posten.ref.wiederkehrend, abo);

  // Gebuchter Termin (die Ausgabe) erledigt auch die gekoppelte Umbuchung
  const [b] = baueBuchungen({ art: 'ausgabe', betragCent: 1399, datum: '2026-11-15', kontoId: 'pp', kategorieId: 'stream', wiederkehrendId: 'abo', faelligAm: '2026-11-15' }, { konten, jetzt: 'T' });
  const mitBuchung = { ...daten, buchungen: [b] };
  assert.equal(offeneTermine(mitBuchung, '2026-11-16', '2026-11-30', { mitGekoppelten: true }).length, 0);
});

test('D227: beim Buchen entsteht die Umbuchung über die Ausgleich-Technik', () => {
  const e = { id: 'gekoppelt', aktiv: true, kontoId: 'pp', vonKontoId: 'giro', notiz: 'Umbuchung für' };
  const [b] = baueBuchungen({ art: 'ausgabe', betragCent: 1399, datum: '2026-11-15', kontoId: 'pp', kategorieId: 'stream', partner: 'Streaming Muster' }, { konten, jetzt: 'T' });
  const neu = ausgleichAnpassen(b, e, [b], { konten, kategorien, jetzt: 'T' });
  assert.deepEqual(neu.map((x) => [x.richtung, x.kontoId, x.betragCent, x.ausgleichFuer]), [['ab', 'giro', 1399, b.id], ['zu', 'pp', 1399, b.id]]);
  assert.equal(neu[0].notiz, 'Umbuchung für Streaming Muster');
});
