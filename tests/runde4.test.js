// Tests zu D163–D168 (Frei verfügbar, Leistbarkeit, Monatsnotiz, Preisentwicklung, Steuer, Notfall) – erfundene Daten
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freiVerfuegbar, leistbarkeit, resttage } from '../js/frei.js';
import { baueMonatsnotiz } from '../js/monatsnotizen.js';
import { preisVerlauf } from '../js/vertraege.js';
import { steuerthemaVon, steuerJahr, steuerJahre, steuerCsv, zipNamen } from '../js/steuer.js';
import { crc32, erzeugeZip } from '../js/zip.js';
import { notfallDaten } from '../js/notfall.js';
import { baueBuchungen } from '../js/buchungen.js';
import { migriereDaten } from '../js/migrationen.js';

test('D163: Frei verfügbar je Konto und gesamt (Tagesgeld ausgeschlossen)', () => {
  const jeKonto = new Map([
    ['giro', { konto: { id: 'giro', mindestsaldoCent: 50000 }, prognose: 120000, niedrigster: 90000 }],
    ['kredit', { konto: { id: 'kredit', mindestsaldoCent: null }, prognose: -20000, niedrigster: -20000 }],
    ['tg', { konto: { id: 'tg', mindestsaldoCent: null, freiVerfuegbar: false }, prognose: 800000, niedrigster: 800000 }],
  ]);
  const f = freiVerfuegbar(jeKonto, '2026-11-12');
  assert.equal(resttage('2026-11-12'), 19);
  assert.equal(f.jeKonto.get('giro').frei, 70000);
  assert.equal(f.jeKonto.get('giro').proTag, Math.floor(70000 / 19));
  assert.equal(f.jeKonto.get('tg').frei, 800000, 'je Konto trotzdem sichtbar');
  assert.equal(f.gesamt.frei, 50000, 'Giro + Kreditkarte, ohne Tagesgeld');
  assert.equal(f.gesamt.anzahl, 2);
  assert.equal(freiVerfuegbar(new Map([['x', { konto: {}, prognose: -100 }]]), '2026-11-30').gesamt.proTag, 0);
});

test('D163: Kann ich mir das leisten? – ja, knapp, nein', () => {
  const kd = { konto: { mindestsaldoCent: 50000 }, prognose: 150000, niedrigster: 130000 };
  const zeilen = [{ monat: '2026-12', stand: 160000 }, { monat: '2027-01', stand: 120000 }, { monat: '2027-02', stand: 170000 }];
  const ja = leistbarkeit({ kd, zeilen, heute: '2026-11-12', betragCent: 20000, datum: '2026-11-15' });
  assert.equal(ja.urteil, 'ja');
  assert.equal(ja.freiVorher, 100000);
  assert.equal(ja.freiNachher, 80000);
  assert.equal(ja.luft, 50000, 'Januar: 120.000 − 20.000 − 50.000');
  const knapp = leistbarkeit({ kd, zeilen, heute: '2026-11-12', betragCent: 66000, datum: '2026-11-15' });
  assert.equal(knapp.urteil, 'knapp');
  const nein = leistbarkeit({ kd, zeilen, heute: '2026-11-12', betragCent: 80000, datum: '2026-11-15' });
  assert.equal(nein.urteil, 'nein');
  assert.deepEqual(nein.ersterUnter, { monat: '2027-01', stand: 40000 }, 'November bleibt genau auf dem Mindestsaldo, der Januar fällt darunter');
  // Kauf erst im Februar: November–Januar zählen nicht
  const spaeter = leistbarkeit({ kd, zeilen, heute: '2026-11-12', betragCent: 80000, datum: '2027-02-01' });
  assert.equal(spaeter.urteil, 'ja');
  assert.equal(spaeter.freiNachher, null);
  // Konto fällt ohnehin im Januar unter die Grenze: kleine Ausgabe trotzdem „ja“ mit Hinweis
  const eng = [{ monat: '2026-12', stand: 160000 }, { monat: '2027-01', stand: 30000 }];
  const klein = leistbarkeit({ kd, zeilen: eng, heute: '2026-11-12', betragCent: 5000, datum: '2026-11-15' });
  assert.equal(klein.urteil, 'ja');
  assert.deepEqual(klein.schonVorherUnter, { monat: '2027-01', stand: 30000 });
});

test('D165: Monatsnotiz bauen', () => {
  assert.deepEqual(baueMonatsnotiz('2026-10', '  Autoreparatur,   deshalb hoch ', { jetzt: 'T' }), { id: '2026-10', text: 'Autoreparatur, deshalb hoch', erstelltAm: 'T', geaendertAm: 'T' });
  assert.equal(baueMonatsnotiz('2026-10', '   '), null, 'leer = löschen');
  assert.throws(() => baueMonatsnotiz('2026-13', 'x'), /Monat/);
  assert.equal(baueMonatsnotiz('2026-10', 'neu', { alt: { erstelltAm: 'A' }, jetzt: 'B' }).erstelltAm, 'A');
  const { daten } = migriereDaten({ version: 20 });
  assert.deepEqual(daten.monatsnotizen, []);
  assert.equal(daten.version, 21);
});

test('D166: Preisentwicklung je Jahr', () => {
  const b = (datum, cent, extra = {}) => ({ datum, betragCent: cent, art: 'ausgabe', ...extra });
  const v = preisVerlauf([b('2025-03-05', 3499), b('2025-04-05', 3499), b('2026-03-05', 3999), b('2026-04-05', 3999),
    b('2026-05-05', 500, { art: 'einnahme' }), b('2026-06-05', 9999, { geloeschtAm: 'X' })]);
  assert.deepEqual(v.map((x) => [x.jahr, x.anzahl, x.schnittCent]), [[2025, 2, 3499], [2026, 2, 3999]]);
  assert.equal(v[0].veraenderung, null);
  assert.ok(Math.abs(v[1].veraenderung - 500 / 3499) < 1e-9);
});

test('D167: Steuerthema – Kategorie, Abweichung je Buchung, Jahressummen, CSV', () => {
  const kategorien = [{ id: 'h', name: 'Wohnen' }, { id: 'u1', name: 'Einrichtung & Reparaturen', elternId: 'h', steuerthema: 'handwerker' },
    { id: 'u2', name: 'Spenden', elternId: 'h', steuerthema: 'spenden' }, { id: 'u3', name: 'Miete', elternId: 'h' }];
  const kat = new Map(kategorien.map((k) => [k.id, k]));
  const b = (id, datum, cent, kategorieId, extra = {}) => ({ id, datum, betragCent: cent, art: 'ausgabe', kategorieId, ...extra });
  const buchungen = [
    b('1', '2025-03-01', 120000, 'u1', { partner: 'Maler Muster', belege: [{ name: '2025-03-01 Maler.pdf' }] }),
    b('2', '2025-05-01', 5000, 'u2'),
    b('3', '2025-06-01', 80000, 'u1', { steuerthema: 'kein' }),
    b('4', '2025-07-01', 95000, 'u3', { steuerthema: 'haushaltsnah' }),
    b('5', '2025-08-01', 10000, 'u2', { geloeschtAm: 'X' }),
    b('6', '2026-01-01', 7000, 'u2'),
    { id: '7', datum: '2025-09-01', betragCent: 5000, art: 'einnahme', kategorieId: 'u2' },
  ];
  assert.equal(steuerthemaVon(buchungen[0], kat), 'handwerker');
  assert.equal(steuerthemaVon(buchungen[2], kat), null, '„nicht steuerlich“ hat Vorrang');
  assert.equal(steuerthemaVon(buchungen[3], kat), 'haushaltsnah', 'Buchung abweichend von der Kategorie');
  const j = steuerJahr(buchungen, kategorien, 2025, '2026-11-12');
  assert.deepEqual(j.themen.map((t) => [t.schluessel, t.summeCent, t.buchungen.length]), [['handwerker', 120000, 1], ['haushaltsnah', 95000, 1], ['spenden', 5000, 1]]);
  assert.equal(j.gesamtCent, 220000);
  assert.deepEqual(steuerJahre(buchungen, kategorien, '2026-11-12'), [2026, 2025]);
  const csv = steuerCsv(j, { kategorien }).replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(csv[1], 'Handwerkerleistungen;01.03.2025;Maler Muster;Wohnen › Einrichtung & Reparaturen;;;1200,00;2025-03-01 Maler.pdf');
  assert.equal(csv.at(-1), 'Gesamt 2025;;;;;;2200,00;');
  assert.deepEqual(zipNamen([{ thema: 'handwerker', beleg: { name: 'a.pdf' } }, { thema: 'handwerker', beleg: { name: 'a.pdf' } }, { thema: 'spenden', beleg: { name: 'x/y.jpg' } }]),
    ['Handwerkerleistungen/a.pdf', 'Handwerkerleistungen/a (2).pdf', 'Spenden/x-y.jpg']);
  // Buchung speichert das Feld, Einnahmen nie
  const konten = [{ id: 'giro', name: 'Giro', stichtag: '2025-01-01' }];
  const [neu] = baueBuchungen({ art: 'ausgabe', betragCent: 100, datum: '2025-02-01', kontoId: 'giro', kategorieId: 'u3', steuerthema: 'spenden' }, { konten });
  assert.equal(neu.steuerthema, 'spenden');
  assert.equal(baueBuchungen({ art: 'ausgabe', betragCent: 100, datum: '2025-02-01', kontoId: 'giro', kategorieId: 'u3' }, { konten, bestehende: [neu] })[0].steuerthema, 'spenden');
  assert.equal(baueBuchungen({ art: 'einnahme', betragCent: 100, datum: '2025-02-01', kontoId: 'giro', kategorieId: 'u3', steuerthema: 'spenden' }, { konten })[0].steuerthema, null);
});

test('D167: ZIP-Datei – Prüfsumme und Aufbau', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const zip = erzeugeZip([{ name: 'Spenden/ä.txt', daten: new TextEncoder().encode('Hallo') }], new Date(2026, 10, 12, 10, 30, 0));
  const v = new DataView(zip.buffer);
  assert.equal(v.getUint32(0, true), 0x04034b50, 'lokaler Kopf');
  assert.equal(v.getUint16(6, true) & 0x0800, 0x0800, 'UTF-8-Namen');
  assert.equal(v.getUint32(zip.length - 22, true), 0x06054b50, 'Verzeichnis-Ende');
  assert.equal(v.getUint16(zip.length - 22 + 10, true), 1, 'eine Datei');
  const nameLaenge = v.getUint16(26, true);
  assert.equal(new TextDecoder().decode(zip.slice(30 + nameLaenge, 30 + nameLaenge + 5)), 'Hallo');
});

test('D168: Notfall-Mappe stellt Konten, Verträge und Zahlungen zusammen', () => {
  const konten = [{ id: 'giro', name: 'Giro (Test)', anfangssaldoCent: 100000, stichtag: '2026-01-01', reihenfolge: 0 },
    { id: 'alt', name: 'Alt', archiviert: true, anfangssaldoCent: 0, stichtag: '2026-01-01' }];
  const d = notfallDaten({
    konten,
    buchungen: [{ id: 'b', kontoId: 'giro', art: 'ausgabe', betragCent: 2000, datum: '2026-02-01' }],
    abstimmungen: [{ kontoId: 'giro', datum: '2026-10-31' }, { kontoId: 'giro', datum: '2026-09-30' }],
    vertraege: [{ id: 'v', name: 'Internet', anbieter: 'Telefon AG', vertragsnummer: 'T-1', fristAnzahl: 1, fristEinheit: 'monate' },
      { id: 'v2', name: 'Alt', gekuendigtZum: '2025-01-31' }],
    wiederkehrend: [{ id: 'w', vertragId: 'v', art: 'ausgabe', kontoId: 'giro', partner: 'Telefon AG', intervall: 'monatlich', stufen: [{ ab: '2026-01-01', betragCent: 3999 }] },
      { id: 'w2', art: 'einnahme', kontoId: 'giro', partner: 'Muster GmbH', intervall: 'monatlich', stufen: [{ ab: '2026-01-01', betragCent: 300000 }] },
      { id: 'w3', art: 'ausgabe', kontoId: 'giro', partner: 'Aus', intervall: 'monatlich', stufen: [{ ab: '2026-01-01', betragCent: 1 }], aktiv: false }],
    heute: '2026-11-12',
  });
  assert.deepEqual(d.konten, [{ name: 'Giro (Test)', standCent: 98000, abgestimmtAm: '2026-10-31' }]);
  assert.equal(d.vertraege.length, 1, 'beendete Verträge fehlen');
  assert.equal(d.vertraege[0].monatCent, 3999);
  assert.equal(d.vertraege[0].ende, 'jederzeit kündbar');
  assert.deepEqual(d.zahlungen.map((z) => z.text), ['Muster GmbH', 'Telefon AG'], 'Einnahmen zuerst, ausgeschaltete fehlen');
});
