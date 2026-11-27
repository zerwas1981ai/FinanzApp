// Tests zu D233 (Abschlagsrechner Strom und Gas) – nur erfundene Testdaten
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GAS_PROMILLE, parseZahl, gewicht, zeitraum, folgeZeitraum, faktor, verbrauch, preisAm, kosten, abschlagsRechnung,
  offeneAblesungen, baueZaehler, mitAblesung, ohneAblesung, ablesungsVerlauf, mitNeuemAbschlag, abschlagBuchung,
} from '../js/energie.js';
import { migriereDaten, DATENMODELL_VERSION } from '../js/migrationen.js';

const nah = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

const strom = {
  id: 'z1', name: 'Strom (Test)', art: 'strom', einheit: 'kwh', vertragId: 'v1', abrechnungsEnde: '03-31',
  preise: [{ ab: '2026-04-01', arbeitCt: 30, grundCent: 1000 }],
  ablesungen: [{ datum: '2026-03-31', stand: 10000 }, { datum: '2026-10-31', stand: 11400 }],
};
const gas = {
  id: 'z2', name: 'Gas (Test)', art: 'gas', einheit: 'm3', brennwert: 11, zustandszahl: 0.95, abrechnungsEnde: '05-31',
  preise: [{ ab: '2025-06-01', arbeitCt: 10, grundCent: 1500 }],
  ablesungen: [{ datum: '2026-05-31', stand: 1000 }, { datum: '2026-10-31', stand: 1100 }],
};

test('Gradtagszahlen ergeben zusammen 1000 Promille; Strom gleichmäßig', () => {
  nah(GAS_PROMILLE.reduce((s, x) => s + x, 0), 1000);
  nah(gewicht('gas', '2026-05-31', '2027-05-31'), 1000);
  nah(gewicht('strom', '2026-03-31', '2027-03-31'), 1000);
  nah(gewicht('gas', '2026-05-31', '2026-10-31'), 150, 0.001); // Juni–August je 13⅓, September 30, Oktober 80
});

test('Kommazahlen deutsch lesen', () => {
  assert.equal(parseZahl('12.345,6', 'Stand'), 12345.6);
  assert.equal(parseZahl('0,9563', 'Zustandszahl'), 0.9563);
  assert.equal(parseZahl('32.45', 'Preis'), 32.45);
  assert.equal(parseZahl('  ', 'Stand'), null);
  assert.throws(() => parseZahl('12a', 'Stand'), /Stand: bitte eine Zahl/);
});

test('Abrechnungszeitraum je Zähler, auch unterjährig gestartet', () => {
  assert.deepEqual(zeitraum(strom, '2026-11-21'), { start: '2026-04-01', ende: '2027-03-31' });
  assert.deepEqual(zeitraum(strom, '2027-03-31'), { start: '2026-04-01', ende: '2027-03-31' });
  assert.deepEqual(zeitraum(strom, '2027-04-01'), { start: '2027-04-01', ende: '2028-03-31' });
  assert.deepEqual(zeitraum(gas, '2026-11-21'), { start: '2026-06-01', ende: '2027-05-31' });
  assert.deepEqual(folgeZeitraum({ start: '2026-04-01', ende: '2027-03-31' }), { start: '2027-04-01', ende: '2028-03-31' });
  assert.deepEqual(zeitraum({ abrechnungsEnde: '02-29' }, '2026-11-21'), { start: '2026-03-01', ende: '2027-02-28' });
});

test('Gas in m³: Umrechnung und Hochrechnung nach Gradtagszahlen', () => {
  nah(faktor(gas), 10.45);
  assert.equal(faktor({ ...gas, einheit: 'kwh' }), 1);
  const v = verbrauch(gas, zeitraum(gas, '2026-11-21'), '2026-11-21');
  assert.equal(v.quelle, 'ablesung');
  nah(v.kwh, 1045);
  nah(v.rate, 1045 / 150, 0.0001);
  // Juni bis Oktober sind nur 15 % des Jahres – hochgerechnet ≈ 6967 kWh, nicht linear ≈ 2490 kWh
  const k = kosten(gas, v.rate, '2026-05-31', '2027-05-31');
  nah(k.kwh, 6966.67, 0.1);
  nah(k.cent, Math.round(6966.67 * 10 + 12 * 1500), 2);
});

test('Ersatz: Vorjahresverbrauch, solange Ablesungen fehlen', () => {
  const ohne = { ...strom, ablesungen: [{ datum: '2026-11-20', stand: 5 }], vorjahrKwh: 2500 };
  const v = verbrauch(ohne, zeitraum(ohne, '2026-11-21'), '2026-11-21');
  assert.equal(v.quelle, 'vorjahr');
  nah(kosten(ohne, v.rate, '2026-03-31', '2027-03-31').kwh, 2500);
  assert.equal(verbrauch({ ...ohne, vorjahrKwh: null }, zeitraum(ohne, '2026-11-21'), '2026-11-21'), null);
  // kurze Messung = ungenau
  const kurz = { ...strom, ablesungen: [{ datum: '2026-11-01', stand: 1 }, { datum: '2026-11-20', stand: 120 }] };
  assert.equal(verbrauch(kurz, zeitraum(kurz, '2026-11-21'), '2026-11-21').ungenau, true);
});

test('Preise gelten ab Datum, auch mitten im Zeitraum', () => {
  const preise = [{ ab: '2026-04-01', arbeitCt: 30, grundCent: 1000 }, { ab: '2027-01-01', arbeitCt: 40, grundCent: 1200 }];
  assert.equal(preisAm(preise, '2026-12-31').arbeitCt, 30);
  assert.equal(preisAm(preise, '2027-01-01').arbeitCt, 40);
  assert.equal(preisAm(preise, '2020-01-01').arbeitCt, 30, 'vor dem ersten Preis: der erste');
  // 1000 kWh im Jahr gleichmäßig: 275 Tage zu 30 ct, 90 Tage zu 40 ct
  const k = kosten({ art: 'strom', preise }, 1, '2026-03-31', '2027-03-31');
  nah(k.cent, Math.round(1000 * 275 / 365 * 30 + 1000 * 90 / 365 * 40 + 9 * 1000 + 3 * 1200), 2);
});

test('Abschlagsrechnung: echte Zahlungen, offene Termine, Guthaben und Vorschlag', () => {
  const wk = { id: 'w1', art: 'ausgabe', vertragId: 'v1', aktiv: true, intervall: 'monatlich', start: '2026-04-15', stufen: [{ ab: '2026-04-15', betragCent: 7000 }], ausnahmen: [] };
  const monate = ['04', '05', '06', '07', '08', '09', '10', '11'];
  const buchungen = monate.map((m, i) => ({ id: `b${i}`, art: 'ausgabe', datum: `2026-${m}-15`, betragCent: 7000, wiederkehrendId: 'w1', faelligAm: `2026-${m}-15` }));
  buchungen.push({ id: 'alt', art: 'ausgabe', datum: '2026-03-15', betragCent: 7000, wiederkehrendId: 'w1', faelligAm: '2026-03-15' }); // voriger Zeitraum
  buchungen.push({ id: 'pk', art: 'ausgabe', datum: '2026-11-16', betragCent: 9999, vertragId: 'v1', geloeschtAm: 'x' }); // Papierkorb
  const r = abschlagsRechnung(strom, { wiederkehrend: [wk], buchungen }, '2026-11-21');
  assert.equal(r.fehlt, null);
  assert.equal(r.gezahltCent, 56000);
  assert.equal(r.offen.length, 4, 'Dezember bis März');
  assert.equal(r.offenCent, 28000);
  const jahresKwh = 1400 / 214 * 365;
  nah(r.jahresKwh, jahresKwh, 0.5);
  nah(r.jahresCent, Math.round(jahresKwh * 30 + 12 * 1000), 3);
  assert.equal(r.saldoCent, r.jahresCent - 56000 - 28000);
  assert.ok(r.saldoCent < 0, 'leichtes Guthaben');
  assert.equal(r.vorschlagCent, Math.ceil((r.jahresCent - 56000) / 4 / 100) * 100);
  assert.equal(r.folge.vorschlagCent % 100, 0, 'auf volle Euro');
  assert.equal(abschlagBuchung(strom, [wk]).id, 'w1');
});

test('Abschlagsrechnung: bisher gezahlt von Hand ersetzt Buchungen bis zu diesem Tag', () => {
  const wk = { id: 'w1', art: 'ausgabe', vertragId: 'v1', aktiv: true, intervall: 'monatlich', start: '2026-04-15', stufen: [{ ab: '2026-04-15', betragCent: 7000 }], ausnahmen: [] };
  const buchungen = [{ id: 'b1', art: 'ausgabe', datum: '2026-11-15', betragCent: 7000, wiederkehrendId: 'w1', faelligAm: '2026-11-15' },
    { id: 'b0', art: 'ausgabe', datum: '2026-10-15', betragCent: 7000, vertragId: 'v1' }];
  const z = { ...strom, gezahltManuell: { bis: '2026-10-31', cent: 49000 } };
  const r = abschlagsRechnung(z, { wiederkehrend: [wk], buchungen }, '2026-11-21');
  assert.equal(r.gezahltCent, 56000, 'Oktober-Buchung steckt schon in der Summe von Hand');
  assert.equal(r.offen.length, 4, 'nicht gebuchte Termine vor der Summe zählen nicht als offen');
  // Summe aus dem vorigen Zeitraum zählt nicht
  const alt = abschlagsRechnung({ ...strom, gezahltManuell: { bis: '2026-02-28', cent: 49000 } }, { wiederkehrend: [wk], buchungen }, '2026-11-21');
  assert.equal(alt.gezahltCent, 14000);
});

test('Abschlagsrechnung: ohne Preise oder Ablesungen nur Hinweis; ohne Abschlag-Buchung Vorschlag nach Monaten', () => {
  assert.equal(abschlagsRechnung({ ...strom, preise: [] }, { wiederkehrend: [], buchungen: [] }, '2026-11-21').fehlt, 'preis');
  assert.equal(abschlagsRechnung({ ...strom, ablesungen: [] }, { wiederkehrend: [], buchungen: [] }, '2026-11-21').fehlt, 'ablesung');
  const r = abschlagsRechnung({ ...strom, vertragId: null }, { wiederkehrend: [], buchungen: [] }, '2026-11-21');
  assert.equal(r.saldoCent, null);
  assert.equal(r.restMonate, 4);
  assert.equal(r.vorschlagCent, Math.ceil(r.jahresCent / 4 / 100) * 100);
});

test('D238: offene Ablesungen zum Monatsende (für den Monatsabschluss)', () => {
  const z = [{ ...strom, ablesungen: [{ datum: '2026-10-31', stand: 1 }] }, { ...gas, ablesungen: [{ datum: '2026-10-27', stand: 1 }] }];
  assert.deepEqual(offeneAblesungen(z, '2026-10').map((x) => x.id), ['z2'], 'Strom am Letzten, Gas zu früh');
  assert.equal(offeneAblesungen(z, '2026-11').length, 2);
  assert.deepEqual(offeneAblesungen([{ ...strom, ablesungen: [{ datum: '2026-11-03', stand: 2 }] }], '2026-10'), [], 'später nachgetragen zählt');
  assert.deepEqual(offeneAblesungen([{ ...gas, aktiv: false }], '2026-11'), []);
  assert.equal(offeneAblesungen([{ ...strom, ablesungen: [{ datum: '2027-02-25', stand: 1 }] }], '2027-02').length, 0, 'Februar: ab 25.02.');
});

test('Zähler bauen: Prüfungen', () => {
  const ein = { name: ' Gas Haus ', art: 'gas', einheit: 'm3', abrechnungsEnde: '05-31', brennwert: 11.2, zustandszahl: 0.95, preise: [{ ab: '2026-06-01', arbeitCt: 9.5, grundCent: 1200 }] };
  const z = baueZaehler(ein, { jetzt: 'T' });
  assert.equal(z.name, 'Gas Haus');
  assert.equal(z.einheit, 'm3');
  assert.deepEqual(z.ablesungen, []);
  assert.equal(baueZaehler({ ...ein, art: 'strom' }).einheit, 'kwh', 'Strom immer kWh');
  assert.equal(baueZaehler({ ...ein, einheit: 'kwh' }).brennwert, null);
  assert.throws(() => baueZaehler({ ...ein, name: '' }), /Namen/);
  assert.throws(() => baueZaehler(ein, { zaehler: [z] }), /gibt es schon/);
  assert.throws(() => baueZaehler({ ...ein, brennwert: null }), /Brennwert/);
  assert.throws(() => baueZaehler({ ...ein, abrechnungsEnde: '13-01' }), /Abrechnungsjahres/);
  assert.throws(() => baueZaehler({ ...ein, preise: [{ ab: '2026-06-01', arbeitCt: 0, grundCent: 0 }] }), /Arbeitspreis/);
  // Bearbeiten: Ablesungen und Verknüpfung zur geplanten Buchung bleiben
  const mit = { ...z, ablesungen: [{ datum: '2026-06-01', stand: 5 }], geplantId: 'g1' };
  const neu = baueZaehler({ ...ein, name: 'Gas' }, { zaehler: [z], alt: mit });
  assert.equal(neu.id, z.id);
  assert.equal(neu.geplantId, 'g1');
  assert.equal(neu.ablesungen.length, 1);
});

test('Ablesungen: ergänzen, ersetzen, nicht rückwärts, Verlauf', () => {
  let z = mitAblesung({ ...strom, ablesungen: [] }, { datum: '2026-10-31', stand: 11400 });
  z = mitAblesung(z, { datum: '2026-03-31', stand: 10000 });
  assert.deepEqual(z.ablesungen.map((a) => a.datum), ['2026-03-31', '2026-10-31']);
  assert.throws(() => mitAblesung(z, { datum: '2026-11-30', stand: 11000 }), /nur vorwärts/);
  assert.throws(() => mitAblesung(z, { datum: '2026-06-30', stand: 12000 }), /größer als/);
  z = mitAblesung(z, { datum: '2026-10-31', stand: 11500 });
  assert.equal(z.ablesungen.length, 2, 'gleiches Datum ersetzt');
  const verlauf = ablesungsVerlauf(z);
  assert.equal(verlauf[0].kwh, 1500);
  assert.equal(verlauf[0].tage, 214);
  assert.equal(ohneAblesung(z, '2026-03-31').ablesungen.length, 1);
});

test('Neuer Abschlag als Stufe der wiederkehrenden Buchung', () => {
  const wk = { id: 'w1', start: '2026-04-15', stufen: [{ ab: '2026-04-15', betragCent: 7000 }] };
  const neu = mitNeuemAbschlag(wk, '2026-12-15', 7500, 'T');
  assert.deepEqual(neu.stufen, [{ ab: '2026-04-15', betragCent: 7000 }, { ab: '2026-12-15', betragCent: 7500 }]);
  assert.deepEqual(mitNeuemAbschlag(neu, '2026-12-15', 8000).stufen.at(-1), { ab: '2026-12-15', betragCent: 8000 });
  assert.throws(() => mitNeuemAbschlag(wk, '2026-01-01', 7500), /vor dem Start/);
});

test('Migration auf Datenversion 26: Sammlung „zaehler“', () => {
  assert.equal(DATENMODELL_VERSION, 28);
  const { daten } = migriereDaten({ version: 25, konten: [] });
  assert.deepEqual(daten.zaehler, []);
});

test('D234: Zählerwechsel mitten im Abrechnungsjahr', () => {
  let z = { ...strom, zaehlernummer: 'ALT-1', ablesungen: [{ datum: '2026-03-31', stand: 10000 }, { datum: '2026-06-30', stand: 10600 }] };
  // neuer Zähler am 15.08.: alter endet bei 10950, neuer beginnt bei 0
  z = mitAblesung(z, { datum: '2026-08-15', stand: 0, wechsel: { endstandAlt: 10950, zaehlernummerNeu: ' NEU-2 ' } });
  assert.equal(z.zaehlernummer, 'NEU-2');
  assert.deepEqual(z.ablesungen[2], { datum: '2026-08-15', stand: 0, wechsel: { endstandAlt: 10950, zaehlernummerAlt: 'ALT-1' } });
  z = mitAblesung(z, { datum: '2026-10-31', stand: 450 });
  // 600 + 350 + 450 = 1400 kWh – wie ohne Wechsel
  const v = verbrauch(z, zeitraum(z, '2026-11-21'), '2026-11-21');
  assert.equal(v.kwh, 1400);
  const verlauf = ablesungsVerlauf(z);
  assert.deepEqual(verlauf.map((x) => x.kwh), [450, 350, 600]);
  // Prüfungen: alter Endstand nicht kleiner als davor, neuer Stand nach dem Wechsel nicht unter dem Anfangsstand
  assert.throws(() => mitAblesung(z, { datum: '2026-08-15', stand: 0, wechsel: { endstandAlt: 10500 } }), /Endstand des alten Zählers ist kleiner/);
  assert.throws(() => mitAblesung(z, { datum: '2026-11-30', stand: 400 }), /nur vorwärts/);
  assert.throws(() => mitAblesung(z, { datum: '2026-08-15', stand: 0, wechsel: { endstandAlt: null } }), /Endstand des alten Zählers eingeben/);
  // ohne Wechsel kleiner eingeben → Hinweis auf „Zählerwechsel“
  assert.throws(() => mitAblesung({ ...strom }, { datum: '2026-11-30', stand: 3 }), /Zählerwechsel/);
  // Wechsel erneut bearbeiten: alte Nummer bleibt erhalten
  const nochmal = mitAblesung(z, { datum: '2026-08-15', stand: 2, wechsel: { endstandAlt: 10960, zaehlernummerNeu: 'NEU-2' } });
  assert.equal(nochmal.ablesungen[2].wechsel.zaehlernummerAlt, 'ALT-1');
  // Gas in m³: gleiche Rechnung mit Umrechnung
  const g = mitAblesung({ ...gas, ablesungen: [{ datum: '2026-05-31', stand: 1000 }] }, { datum: '2026-09-15', stand: 0, wechsel: { endstandAlt: 1060 } });
  const g2 = mitAblesung(g, { datum: '2026-10-31', stand: 40 });
  nah(verbrauch(g2, zeitraum(g2, '2026-11-21'), '2026-11-21').kwh, 1045);
  // ohne neue Nummer bleibt die alte am Zähler
  assert.equal(g.zaehlernummer, gas.zaehlernummer);
});

test('D235: Ergebnis je Ablesung zeigt, ob der Verbrauch zu- oder abnimmt', async () => {
  const { ergebnisVerlauf } = await import('../js/energie.js');
  const wk = { id: 'w1', art: 'ausgabe', vertragId: 'v1', aktiv: true, intervall: 'monatlich', start: '2026-04-15', stufen: [{ ab: '2026-04-15', betragCent: 7000 }], ausnahmen: [] };
  const buchungen = ['04', '05', '06', '07', '08', '09', '10'].map((m, i) => ({ id: `b${i}`, art: 'ausgabe', datum: `2026-${m}-15`, betragCent: 7000, wiederkehrendId: 'w1', faelligAm: `2026-${m}-15` }));
  // gleichmäßig 6 kWh/Tag bis Ende Juli, danach 9 kWh/Tag
  const z = { ...strom, ablesungen: [
    { datum: '2026-03-31', stand: 10000 }, { datum: '2026-05-31', stand: 10366 }, { datum: '2026-07-31', stand: 10732 }, { datum: '2026-09-30', stand: 11281 },
  ] };
  const v = ergebnisVerlauf(z, { wiederkehrend: [wk], buchungen });
  assert.equal(v.has('2026-03-31'), false, 'erste Ablesung: noch nichts zu rechnen');
  assert.equal(v.get('2026-05-31').trend, null);
  nah(v.get('2026-07-31').trend, 0, 2);
  assert.ok(v.get('2026-09-30').trend > 0, 'höherer Verbrauch → teurer');
  // Rechnung am 31.05.: gezahlt nur April und Mai, die übrigen 10 Termine noch offen
  const mai = abschlagsRechnung({ ...z, ablesungen: z.ablesungen.slice(0, 2) }, { wiederkehrend: [wk], buchungen }, '2026-05-31');
  assert.equal(mai.gezahltCent, 14000);
  assert.equal(mai.offen.length, 10);
  assert.equal(v.get('2026-05-31').saldoCent, mai.saldoCent);
  // ohne Abschlag-Buchung: Trend der Jahreskosten
  const ohne = ergebnisVerlauf({ ...z, vertragId: null }, { wiederkehrend: [], buchungen: [] });
  assert.equal(ohne.get('2026-09-30').saldoCent, null);
  assert.ok(ohne.get('2026-09-30').trend > 0);
});
