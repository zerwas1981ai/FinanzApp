// Tests zu D201–D206 – nur erfundene Testdaten
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wiederkehrendJeMonat, monatsBetrag } from '../js/vertraege.js';
import { preisAenderungen, mitWertAenderung } from '../js/erkennung.js';
import { abstimmVorschlaege } from '../js/abstimmhilfe.js';
import { empfaengerListe, aehnlicheGruppen, namensKern, umbenennen, offeneGruppen, getrenntMerken } from '../js/empfaenger.js';
import { abschlussMonat, abschlussPruefung } from '../js/abschluss.js';
import { budgetVorschlag } from '../js/prognose.js';
import { ausgabenVergleich } from '../js/rechnen.js';
import { zusammenfuehrZiele, unterkategorieZusammenfuehren } from '../js/kategorien.js';
import { verschluesseln, entschluesseln, istVerschluesselt, pruefePasswort } from '../js/verschluesselung.js';

const stufe = (betragCent, ab = '2026-01-01') => [{ ab, betragCent }];

test('D201: wiederkehrende Buchungen je Monat', () => {
  const liste = [
    { art: 'ausgabe', intervall: 'monatlich', start: '2026-01-01', stufen: stufe(8500) },
    { art: 'ausgabe', intervall: 'vierteljaehrlich', start: '2026-01-15', stufen: stufe(5508) },
    { art: 'ausgabe', intervall: 'jaehrlich', start: '2026-01-10', stufen: stufe(48000) },
    { art: 'einnahme', intervall: 'monatlich', start: '2026-01-01', stufen: stufe(300000) },
    { art: 'ausgabe', intervall: 'monatlich', start: '2026-01-01', stufen: stufe(999), aktiv: false },
    { art: 'ausgabe', intervall: 'monatlich', start: '2026-01-01', ende: '2026-10-31', stufen: stufe(999) },
    { art: 'ausgabe', intervall: 'monatlich', start: '2027-01-01', stufen: stufe(999) },
    { art: 'umbuchung', intervall: 'monatlich', start: '2026-01-01', stufen: stufe(25000) },
  ];
  assert.equal(monatsBetrag(liste[1], '2026-11-14'), 1836);
  assert.deepEqual(wiederkehrendJeMonat(liste, '2026-11-14'), { einnahmen: 300000, ausgaben: 8500 + 1836 + 4000 + 999 }, 'künftig beginnende zählen mit');
});

test('D203: Preisänderung erkennen', () => {
  const w = { id: 'strom', art: 'ausgabe', intervall: 'monatlich', start: '2026-01-03', stufen: stufe(8500, '2026-01-03') };
  const b = (id, monat, betragCent) => ({ id, art: 'ausgabe', datum: `2026-${monat}-03`, faelligAm: `2026-${monat}-03`, wiederkehrendId: 'strom', betragCent });
  const zweimal = [b('a', '09', 8500), b('b', '10', 9200), b('c', '11', 9200)];
  const v = preisAenderungen([w], zweimal, '2026-11-14');
  assert.equal(v.length, 1);
  assert.deepEqual([v[0].altCent, v[0].neuCent, v[0].ab], [8500, 9200, '2026-12-03']);
  // nur einmal abweichend → noch kein Vorschlag
  assert.equal(preisAenderungen([w], [b('a', '10', 8500), b('b', '11', 9200)], '2026-11-14').length, 0);
  // zwei verschiedene neue Beträge → kein Vorschlag
  assert.equal(preisAenderungen([w], [b('a', '10', 9800), b('b', '11', 9200)], '2026-11-14').length, 0);
  // kleine Abweichung (unter 2 %) zählt nicht
  assert.equal(preisAenderungen([w], [b('a', '10', 8600), b('b', '11', 8600)], '2026-11-14').length, 0);
  // abgelehnt
  assert.equal(preisAenderungen([w], zweimal, '2026-11-14', ['strom|9200']).length, 0);
  // übernommen → kein Vorschlag mehr
  const neu = mitWertAenderung(w, '2026-12-03', 9200);
  assert.deepEqual(neu.stufen, [{ ab: '2026-01-03', betragCent: 8500 }, { ab: '2026-12-03', betragCent: 9200 }]);
  assert.equal(preisAenderungen([neu], zweimal, '2026-11-14').length, 0);
});

test('D204: Abstimmhilfe', () => {
  const t = { datum: '2026-11-05', wiederkehrend: { id: 'tel' } };
  const buchungen = [
    { id: 'v', kontoId: 'giro', art: 'ausgabe', betragCent: 3320, datum: '2026-11-13', status: 'vorgemerkt' },
    { id: 's', kontoId: 'giro', art: 'ausgabe', betragCent: 1299, datum: '2026-11-15' },
    { id: 'x', kontoId: 'kk', art: 'ausgabe', betragCent: 3999, datum: '2026-11-15' },
  ];
  const termine = [{ t, wirkung: -3999 }];
  const vor = (differenz) => abstimmVorschlaege({ kontoId: 'giro', buchungen, termine, datum: '2026-11-14', differenz })
    .map((v) => v.teile.map((k) => k.art).join('+'));
  assert.deepEqual(vor(-3999), ['termin'], 'fälliger Termin bei der Bank schon abgebucht');
  assert.deepEqual(vor(-1299), ['spaeter'], 'Buchung nach dem Datum, bei der Bank schon da');
  assert.deepEqual(vor(3320), ['vorgemerkt'], 'vorgemerkt, bei der Bank noch nicht');
  assert.deepEqual(vor(-3999 - 1299), ['termin+spaeter'], 'zwei Posten zusammen');
  assert.deepEqual(vor(-1), []);
  assert.deepEqual(vor(0), []);
});

test('D205: Empfänger vereinheitlichen', () => {
  assert.equal(namensKern('REWE Markt GmbH'), 'rewe');
  assert.equal(namensKern('Müller & Co. KG'), 'mueller');
  const daten = {
    buchungen: [
      { partner: 'Rewe', art: 'ausgabe' }, { partner: 'rewe ', art: 'ausgabe' }, { partner: 'REWE Markt', art: 'ausgabe' },
      { partner: 'Rewe City', art: 'ausgabe' }, { partner: 'Amazon', art: 'ausgabe' }, { partner: 'Amazon Marketplace', art: 'ausgabe' },
      { partner: 'Aldi', art: 'ausgabe' }, { partner: 'Alt', art: 'ausgabe', geloeschtAm: 'X' }, { partner: '', art: 'umbuchung' },
    ],
    wiederkehrend: [{ partner: 'Stadtwerke' }],
    vertraege: [{ anbieter: 'Stadtwerke' }],
  };
  const liste = empfaengerListe(daten);
  assert.deepEqual(liste.slice(0, 2).map((e) => [e.name, e.anzahl]), [['Rewe', 2], ['Stadtwerke', 2]]);
  assert.ok(!liste.some((e) => e.name === 'Alt'), 'Papierkorb zählt nicht');
  const gruppen = aehnlicheGruppen(liste).map((g) => g.map((e) => e.name).sort());
  assert.deepEqual(gruppen, [['REWE Markt', 'Rewe', 'Rewe City'], ['Amazon', 'Amazon Marketplace']]);
  const aend = umbenennen(daten, ['rewe markt', 'rewe city'], 'Rewe', 'T');
  assert.deepEqual(aend.buchungen.map((b) => b.partner), ['Rewe', 'Rewe']);
  const vertrag = umbenennen(daten, ['stadtwerke'], 'Stadtwerke Muster', 'T');
  assert.equal(vertrag.vertraege[0].anbieter, 'Stadtwerke Muster');
  assert.equal(vertrag.wiederkehrend[0].partner, 'Stadtwerke Muster');
  assert.throws(() => umbenennen(daten, ['rewe'], '  '));
});

test('D206: Monatsabschluss-Checkliste', () => {
  assert.equal(abschlussMonat('2026-12-01'), '2026-11');
  assert.equal(abschlussMonat('2026-01-10'), '2025-12');
  assert.equal(abschlussMonat('2026-12-11'), null);
  const daten = {
    konten: [{ id: 'giro', name: 'Giro', stichtag: '2026-01-01' }, { id: 'tg', name: 'Tagesgeld', stichtag: '2026-01-01' }],
    abstimmungen: [
      { kontoId: 'giro', datum: '2026-11-30', bankstandCent: 100, berechnetCent: 100 },
      { kontoId: 'tg', datum: '2026-10-31', bankstandCent: 100, berechnetCent: 100 },
    ],
    buchungen: [
      { id: 'v', art: 'ausgabe', datum: '2026-11-20', status: 'vorgemerkt' },
      { id: 'r', art: 'ausgabe', datum: '2026-11-05', relevant: true, belege: [] },
      { id: 'r2', art: 'ausgabe', datum: '2026-11-06', relevant: true, belege: [{ id: 'b' }] },
    ],
    relevant: [{ datum: '2026-11-07', belege: [] }],
  };
  const p = abschlussPruefung(daten, [{ datum: '2026-11-15' }, { datum: '2026-12-03' }], '2026-11');
  assert.deepEqual(p.map((x) => [x.id, x.ok]), [['abgestimmt', false], ['vorgemerkt', false], ['termine', false], ['belege', false]]);
  assert.match(p[0].text, /Tagesgeld/);
  assert.match(p[2].text, /^1 Termin/);
  assert.match(p[3].text, /^2 relevante/);
  const leer = abschlussPruefung({ ...daten, buchungen: [], relevant: [], abstimmungen: [
    { kontoId: 'giro', datum: '2026-12-01', bankstandCent: 1, berechnetCent: 1 }, { kontoId: 'tg', datum: '2026-11-30', bankstandCent: 1, berechnetCent: 1 }] }, [], '2026-11');
  assert.ok(leer.every((x) => x.ok));
});

test('D207: Schreibweisen bewusst getrennt lassen', () => {
  const e = (schluessel) => ({ schluessel, name: schluessel, anzahl: 1 });
  const gruppen = [[e('rewe'), e('rewe city')], [e('amazon'), e('amazon marketplace')]];
  const getrennt = getrenntMerken([], ['rewe city', 'rewe']);
  assert.deepEqual(getrennt, [['rewe', 'rewe city']]);
  assert.deepEqual(offeneGruppen(gruppen, getrennt).map((g) => g[0].schluessel), ['amazon'], 'abgelehnte Gruppe verborgen');
  // neue Schreibweise kommt dazu → nur diese Gruppe erscheint wieder, mit allen Schreibweisen
  const mitNeu = [[e('rewe'), e('rewe city'), e('rewe markt')], [e('amazon'), e('amazon marketplace')]];
  const offen = offeneGruppen(mitNeu, [...getrennt, ['amazon', 'amazon marketplace']]);
  assert.deepEqual(offen.map((g) => g.map((x) => x.schluessel)), [['rewe', 'rewe city', 'rewe markt']]);
  // erneut getrennt lassen: größere Gruppe ersetzt die kleinere
  assert.deepEqual(getrenntMerken(getrennt, ['rewe', 'rewe city', 'rewe markt']), [['rewe', 'rewe city', 'rewe markt']]);
  // Teilmenge einer abgelehnten Gruppe bleibt verborgen
  assert.equal(offeneGruppen([[e('rewe'), e('rewe city')]], [['rewe', 'rewe city', 'rewe markt']]).length, 0);
});

test('D208: Budget-Vorschlag aus den letzten Monaten', () => {
  const kat = [{ id: 'leb', elternId: null, art: 'ausgabe' }, { id: 'super', elternId: 'leb' }];
  const b = (datum, betragCent, extra = {}) => ({ datum, betragCent, art: 'ausgabe', kontoId: 'giro', kategorieId: 'super', ...extra });
  const liste = [
    b('2026-05-10', 60000), b('2026-08-03', 30000), b('2026-09-03', 40000), b('2026-10-03', 20000), b('2026-10-20', 10000),
    b('2026-11-02', 99900), // laufender Monat zählt nicht
    b('2026-10-05', 50000, { projektId: 'p' }), // Projekt zählt nicht
    b('2026-10-05', 50000, { kontoId: 'kk' }),
  ];
  const v = budgetVorschlag(liste, kat, 'giro', 'leb', '2026-11-15');
  assert.equal(v.schnitt3, Math.round((40000 + 30000 + 30000) / 3));
  assert.equal(v.monate, 6);
  assert.equal(v.schnitt6, Math.round((60000 + 0 + 0 + 30000 + 40000 + 30000) / 6));
  // erst seit zwei Monaten Buchungen → nur diese Monate zählen
  const kurz = budgetVorschlag([b('2026-09-03', 30000), b('2026-10-03', 10000)], kat, 'giro', 'leb', '2026-11-15');
  assert.deepEqual([kurz.schnitt3, kurz.monate], [20000, 2]);
  assert.equal(budgetVorschlag([], kat, 'giro', 'leb', '2026-11-15'), null);
});

test('D209: Ausgaben bis heute im Vergleich zum Vormonat', () => {
  const b = (datum, betragCent, extra = {}) => ({ datum, betragCent, art: 'ausgabe', kontoId: 'giro', ...extra });
  const liste = [b('2026-11-02', 1000), b('2026-11-15', 500), b('2026-11-16', 9999), b('2026-10-10', 700), b('2026-10-15', 100),
    b('2026-10-20', 9999), b('2026-11-03', 9999, { art: 'umbuchung' }), b('2026-11-03', 9999, { kontoId: 'kk' })];
  assert.deepEqual(ausgabenVergleich({ id: 'giro' }, liste, '2026-11-15'), { jetzt: 1500, vorher: 800, vorBis: '2026-10-15' });
  assert.equal(ausgabenVergleich({ id: 'giro' }, [], '2026-03-31').vorBis, '2026-02-28', 'kürzerer Vormonat');
});

test('D210: Unterkategorien zusammenführen', () => {
  const kat = [
    { id: 'leb', elternId: null, art: 'ausgabe', name: 'Lebensmittel' }, { id: 'super', elternId: 'leb', name: 'Supermarkt' },
    { id: 'disc', elternId: 'leb', name: 'Discounter' }, { id: 'frei', elternId: null, art: 'ausgabe', name: 'Freizeit' },
    { id: 'kino', elternId: 'frei', name: 'Kino' }, { id: 'alt', elternId: 'frei', name: 'Alt', archiviert: true },
    { id: 'ein', elternId: null, art: 'einnahme', name: 'Einkommen' }, { id: 'gehalt', elternId: 'ein', name: 'Gehalt' },
  ];
  assert.deepEqual(zusammenfuehrZiele(kat[2], kat).map((k) => k.pfad), ['Lebensmittel › Supermarkt', 'Freizeit › Kino'], 'gleiche Hauptkategorie zuerst');
  const daten = {
    buchungen: [{ id: '1', kategorieId: 'disc' }, { id: '2', kategorieId: 'super' }],
    wiederkehrend: [{ id: 'w', kategorieId: 'disc' }], geplant: [], relevant: [{ id: 'r', kategorieId: 'disc' }],
  };
  const a = unterkategorieZusammenfuehren('disc', 'super', daten, 'T');
  assert.deepEqual(Object.keys(a), ['buchungen', 'wiederkehrend', 'relevant']);
  assert.deepEqual(a.buchungen.map((x) => [x.id, x.kategorieId]), [['1', 'super']]);
  assert.throws(() => unterkategorieZusammenfuehren('disc', 'disc', daten));
});

test('D212: Sicherungsdatei mit Passwort', async () => {
  const text = JSON.stringify({ konten: [{ id: 'k', name: 'Testkonto' }], buchungen: [] });
  const datei = await verschluesseln(text, 'Test-Passwort-123', { durchlaeufe: 1000 });
  assert.ok(istVerschluesselt(datei));
  assert.ok(!JSON.stringify(datei).includes('Testkonto'), 'Inhalt ist nicht lesbar');
  assert.equal(await entschluesseln(datei, 'Test-Passwort-123'), text);
  await assert.rejects(entschluesseln(datei, 'falsch-falsch'), /Passwort passt nicht/);
  assert.ok(!istVerschluesselt({ konten: [], buchungen: [] }));
  assert.throws(() => pruefePasswort('kurz', 'kurz'), /8 Zeichen/);
  assert.throws(() => pruefePasswort('lang-genug-1', 'lang-genug-2'), /stimmen nicht/);
  pruefePasswort('lang-genug-1', 'lang-genug-1');
});
