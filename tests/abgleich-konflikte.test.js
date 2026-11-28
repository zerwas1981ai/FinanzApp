// Prüft die unverletzliche Regel "Bei Konflikten MUSS die App nachfragen und darf nie still
// überschreiben" am ECHTEN Ablauf des Abgleichs (js/sync/abgleich.js, D60–D66, D259).
// Statt Google Drive und IndexedDB laufen hier zwei kleine Nachbauten im Speicher.
// Dafür braucht `npm test` den Schalter --experimental-test-module-mocks (siehe package.json).

import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SAMMLUNGEN, LOKALE_SAMMLUNGEN } from '../js/db.js';
import { DATENMODELL_VERSION } from '../js/migrationen.js';
import { fuehreZusammen, stabil } from '../js/sync/zusammenfuehren.js';

/* ---------- Nachbau: lokale Datenbank ---------- */

const lokal = { daten: {}, meta: new Map() };
const fakeDb = {
  SAMMLUNGEN,
  LOKALE_SAMMLUNGEN,
  leseDatenstand: async () => structuredClone({ version: lokal.meta.get('datenVersion'), ...lokal.daten }),
  schreibeDatenstand: async (d) => {
    for (const s of SAMMLUNGEN) lokal.daten[s] = structuredClone(d[s] ?? []);
    lokal.meta.set('datenVersion', d.version);
    lokal.schreibvorgaenge += 1;
  },
  leseMeta: async (k) => structuredClone(lokal.meta.get(k)),
  schreibeMeta: async (k, w) => { lokal.meta.set(k, structuredClone(w)); },
  alle: async (s) => structuredClone(lokal.daten[s] ?? []),
  hole: async (s, id) => structuredClone((lokal.daten[s] ?? []).find((x) => x.id === id)),
  speichere: async (s, d) => { lokal.daten[s] = [...(lokal.daten[s] ?? []).filter((x) => x.id !== d.id), d]; },
  leere: async () => {},
  leererStand: () => Object.fromEntries([['version', DATENMODELL_VERSION], ...SAMMLUNGEN.map((s) => [s, []])]),
};

/* ---------- Nachbau: Google Drive ---------- */

const wolke = { datei: null, backups: [], hochgeladen: 0, vorDemHochladen: null };
let naechsteId = 1;
const fakeDrive = {
  istAngemeldet: () => true,
  NichtAngemeldet: class extends Error {},
  ordner: async () => ({ haupt: 'h', backups: 'b', belege: 'be', relevant: 'r', vertraege: 'v' }),
  datenDatei: async () => (wolke.datei ? { id: wolke.datei.id, version: wolke.datei.version } : null),
  metadaten: async () => {
    // Hier kann ein Test ein "anderes Gerät" genau vor dem Hochladen speichern lassen
    if (wolke.vorDemHochladen) { const f = wolke.vorDemHochladen; wolke.vorDemHochladen = null; f(); }
    return { id: wolke.datei.id, version: wolke.datei.version };
  },
  ladeJson: async (id) => {
    if (wolke.datei && id === wolke.datei.id) return JSON.parse(wolke.datei.inhalt);
    return JSON.parse(wolke.backups.find((b) => b.id === id).inhalt);
  },
  speichereDatei: async ({ id, name, inhalt, art }) => {
    if (art === 'backup') {
      const b = { id: `bk${naechsteId++}`, name, inhalt, modifiedTime: new Date().toISOString() };
      wolke.backups.push(b);
      return b;
    }
    wolke.hochgeladen += 1;
    wolke.datei = { id: id ?? `d${naechsteId++}`, version: String(Number(wolke.datei?.version ?? 0) + 1), inhalt };
    return { id: wolke.datei.id, version: wolke.datei.version };
  },
  backupListe: async () => wolke.backups,
  inPapierkorb: async () => {},
  kopiere: async () => ({ id: 'kopie' }),
};

const speicher = new Map([['drive-client-id', 'test'], ['drive-aktiv', '1']]);
mock.module('../js/db.js', { namedExports: fakeDb });
mock.module('../js/sync/drive.js', { namedExports: fakeDrive });
mock.module('../js/ui.js', { namedExports: { geraet: { lies: (k) => speicher.get(k) ?? null, schreib: (k, w) => speicher.set(k, w) } } });

globalThis.window = new EventTarget();
Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });

const abgleich = await import('../js/sync/abgleich.js');

/* ---------- Hilfen ---------- */

const leer = () => Object.fromEntries([['version', DATENMODELL_VERSION], ...SAMMLUNGEN.map((s) => [s, []])]);
const buchung = (id, betragCent) => ({ id, art: 'ausgabe', betragCent, datum: '2026-11-01', kontoId: 'g' });
const stand = (buchungen, extra = {}) => ({ ...leer(), konten: [{ id: 'g', name: 'Giro' }], buchungen, ...extra });
const betraege = (liste) => Object.fromEntries(liste.map((b) => [b.id, b.betragCent]));
const lokaleBetraege = () => betraege(lokal.daten.buchungen);
const wolkenBetraege = () => betraege(JSON.parse(wolke.datei.inhalt).buchungen);

/** Beide Seiten auf denselben Stand bringen, als wäre schon einmal abgeglichen worden */
async function abgeglichen(daten) {
  await fakeDb.schreibeDatenstand(daten);
  wolke.datei = null;
  await abgleich.gleicheAb();
  assert.equal(abgleich.status.zustand, 'ok');
  lokal.schreibvorgaenge = 0;
  wolke.hochgeladen = 0;
  wolke.backups = [];
}
/** Ein "anderes Gerät" speichert in Drive */
function anderesGeraetSpeichert(daten) {
  wolke.datei = { ...wolke.datei, version: String(Number(wolke.datei.version) + 1), inhalt: JSON.stringify(daten) };
}

let gefragt;
beforeEach(() => {
  for (const s of SAMMLUNGEN) lokal.daten[s] = [];
  lokal.meta = new Map([['datenVersion', DATENMODELL_VERSION]]);
  lokal.schreibvorgaenge = 0;
  Object.assign(wolke, { datei: null, backups: [], hochgeladen: 0, vorDemHochladen: null });
  gefragt = [];
  abgleich.setzeFragen({
    erstesVerbinden: async (x) => { gefragt.push(['erstesVerbinden', x]); return null; },
    konflikte: async (k) => { gefragt.push(['konflikte', k]); return null; },
    neustart: async () => { gefragt.push(['neustart']); return null; },
  });
});

/* ---------- Tests ---------- */

test('Abgleich: beide Geräte ändern dieselbe Buchung → Nachfrage; „später“ ändert nichts', async () => {
  await abgeglichen(stand([buchung('a', 100)]));
  await fakeDb.schreibeDatenstand(stand([buchung('a', 111)]));
  anderesGeraetSpeichert(stand([buchung('a', 122)]));
  const vorher = wolke.datei.version;

  await abgleich.gleicheAb();

  assert.equal(gefragt.length, 1);
  assert.equal(gefragt[0][0], 'konflikte');
  assert.deepEqual(gefragt[0][1].map((k) => [k.id, k.lokal.betragCent, k.remote.betragCent]), [['a', 111, 122]]);
  assert.equal(abgleich.status.zustand, 'konflikt');
  assert.deepEqual(lokaleBetraege(), { a: 111 }, 'dieses Gerät unverändert');
  assert.equal(wolke.datei.version, vorher, 'Drive unverändert');
  assert.deepEqual(wolkenBetraege(), { a: 122 });
});

test('Abgleich: Konflikt, Drive-Fassung gewählt → übernommen, eigene Fassung als Backup gesichert', async () => {
  await abgeglichen(stand([buchung('a', 100), buchung('b', 200)]));
  await fakeDb.schreibeDatenstand(stand([buchung('a', 111), buchung('b', 200), buchung('neu', 5)]));
  anderesGeraetSpeichert(stand([buchung('a', 122), buchung('b', 222)]));
  abgleich.setzeFragen({ konflikte: async (k) => { gefragt.push(k); return new Map([['buchungen|a', 'remote']]); } });

  await abgleich.gleicheAb();

  assert.equal(gefragt.length, 1);
  assert.deepEqual(lokaleBetraege(), { a: 122, b: 222, neu: 5 }, 'Konflikt nach Wahl, Rest zusammengeführt');
  assert.deepEqual(wolkenBetraege(), { a: 122, b: 222, neu: 5 });
  const gesichert = wolke.backups.find((x) => x.name.includes('-geraet'));
  assert.ok(gesichert, 'verworfene Fassung liegt als Backup in Drive');
  assert.deepEqual(betraege(JSON.parse(gesichert.inhalt).buchungen), { a: 111, b: 200, neu: 5 });
});

test('Abgleich: gelöscht auf einem Gerät, geändert auf dem anderen → Nachfrage', async () => {
  await abgeglichen(stand([buchung('a', 100)]));
  await fakeDb.schreibeDatenstand(stand([]));
  anderesGeraetSpeichert(stand([buchung('a', 150)]));

  await abgleich.gleicheAb();

  assert.equal(gefragt.length, 1);
  assert.deepEqual(gefragt[0][1].map((k) => [k.id, k.lokal, k.remote?.betragCent]), [['a', null, 150]]);
  assert.deepEqual(lokaleBetraege(), {});
  assert.deepEqual(wolkenBetraege(), { a: 150 });
});

test('Abgleich: verschiedene Einträge geändert → ohne Nachfrage zusammengeführt', async () => {
  await abgeglichen(stand([buchung('a', 100), buchung('b', 200)]));
  await fakeDb.schreibeDatenstand(stand([buchung('a', 111), buchung('b', 200)]));
  anderesGeraetSpeichert(stand([buchung('a', 100), buchung('b', 222)]));

  await abgleich.gleicheAb();

  assert.equal(gefragt.length, 0);
  assert.equal(abgleich.status.zustand, 'ok');
  assert.deepEqual(lokaleBetraege(), { a: 111, b: 222 });
  assert.deepEqual(wolkenBetraege(), { a: 111, b: 222 });
});

test('Abgleich: nur Drive geändert → übernommen, nichts hochgeladen', async () => {
  await abgeglichen(stand([buchung('a', 100)]));
  anderesGeraetSpeichert(stand([buchung('a', 100), buchung('b', 7)]));

  await abgleich.gleicheAb();

  assert.equal(gefragt.length, 0);
  assert.deepEqual(lokaleBetraege(), { a: 100, b: 7 });
  assert.equal(wolke.hochgeladen, 0);
  assert.equal(wolke.backups.length, 0, 'kein Gerät-Backup nötig');
});

test('Abgleich: anderes Gerät speichert genau vor dem Hochladen → erst zusammenführen, nicht überschreiben', async () => {
  await abgeglichen(stand([buchung('a', 100), buchung('b', 200)]));
  await fakeDb.schreibeDatenstand(stand([buchung('a', 111), buchung('b', 200)]));
  wolke.vorDemHochladen = () => anderesGeraetSpeichert(stand([buchung('a', 100), buchung('b', 222)]));

  await abgleich.gleicheAb();

  assert.equal(gefragt.length, 0);
  assert.deepEqual(wolkenBetraege(), { a: 111, b: 222 }, 'Änderung des anderen Geräts bleibt erhalten');
  assert.deepEqual(lokaleBetraege(), { a: 111, b: 222 });
});

test('Abgleich: anderes Gerät ändert DENSELBEN Eintrag kurz vor dem Hochladen → Nachfrage', async () => {
  await abgeglichen(stand([buchung('a', 100)]));
  await fakeDb.schreibeDatenstand(stand([buchung('a', 111)]));
  wolke.vorDemHochladen = () => anderesGeraetSpeichert(stand([buchung('a', 122)]));

  await abgleich.gleicheAb();

  assert.equal(gefragt.length, 1);
  assert.deepEqual(lokaleBetraege(), { a: 111 });
  assert.deepEqual(wolkenBetraege(), { a: 122 });
});

test('Abgleich: während der Nachfrage hier weiter gebucht → neue Buchung geht nicht verloren', async () => {
  await abgeglichen(stand([buchung('a', 100)]));
  await fakeDb.schreibeDatenstand(stand([buchung('a', 111)]));
  anderesGeraetSpeichert(stand([buchung('a', 122)]));
  abgleich.setzeFragen({
    konflikte: async (k) => {
      gefragt.push(k);
      if (gefragt.length === 1) await fakeDb.speichere('buchungen', buchung('waehrenddessen', 9));
      return new Map([['buchungen|a', 'remote']]);
    },
  });

  await abgleich.gleicheAb();

  assert.equal(gefragt.length, 2, 'nach der Änderung wird neu verglichen und erneut gefragt');
  assert.deepEqual(lokaleBetraege(), { a: 122, waehrenddessen: 9 });
  assert.deepEqual(wolkenBetraege(), { a: 122, waehrenddessen: 9 });
});

test('Abgleich: erstes Verbinden mit verschiedenen Ständen → Nachfrage; Abbrechen ändert nichts', async () => {
  await fakeDb.schreibeDatenstand(stand([buchung('hier', 1)]));
  wolke.datei = { id: 'd0', version: '5', inhalt: JSON.stringify(stand([buchung('dort', 2)])) };

  await abgleich.gleicheAb();

  assert.deepEqual(gefragt.map((x) => x[0]), ['erstesVerbinden']);
  assert.deepEqual(lokaleBetraege(), { hier: 1 });
  assert.deepEqual(wolkenBetraege(), { dort: 2 });
  assert.equal(wolke.datei.version, '5');
});

test('Abgleich: Neubeginn auf anderem Gerät → Nachfrage; „später“ lässt dieses Gerät unverändert', async () => {
  await abgeglichen(stand([buchung('a', 100)]));
  wolke.datei = { ...wolke.datei, version: '99', inhalt: JSON.stringify({ ...leer(), neustartId: 'neu' }) };

  await abgleich.gleicheAb();

  assert.deepEqual(gefragt.map((x) => x[0]), ['neustart']);
  assert.deepEqual(lokaleBetraege(), { a: 100 });
  assert.equal(lokal.schreibvorgaenge, 0);
});

/* ---------- Zufallstest der reinen Zusammenführung ---------- */

test('Zusammenführen (500 Zufallsfälle): jede Änderung landet im Ergebnis oder in einer Nachfrage', () => {
  let saat = 42;
  const zufall = (n) => { saat = (saat * 1103515245 + 12345) % 2147483648; return saat % n; };
  const variante = (b) => {
    const w = zufall(4); // 0 gleich, 1 geändert, 2 gelöscht, 3 anders geändert
    if (w === 0) return b;
    if (w === 2) return undefined;
    return b ? { ...b, betragCent: b.betragCent + w } : buchung(`x${zufall(3)}`, w);
  };
  for (let fall = 0; fall < 500; fall++) {
    const ids = ['a', 'b', 'c', 'd'];
    const basisListe = ids.filter(() => zufall(3)).map((id) => buchung(id, 100));
    const lokalListe = [];
    const remoteListe = [];
    for (const id of ids) {
      const bw = basisListe.find((x) => x.id === id);
      const lw = bw ? variante(bw) : (zufall(3) === 0 ? buchung(id, 7) : undefined);
      const rw = bw ? variante(bw) : (zufall(3) === 0 ? buchung(id, 7 + zufall(2)) : undefined);
      if (lw) lokalListe.push({ ...lw, id });
      if (rw) remoteListe.push({ ...rw, id });
    }
    const mitBasis = zufall(4) !== 0;
    const basis = mitBasis ? stand(basisListe) : null;
    const { daten, konflikte } = fuehreZusammen(basis, stand(lokalListe), stand(remoteListe), DATENMODELL_VERSION);
    const konfliktIds = new Set(konflikte.map((k) => k.id));
    const s = (x) => (x === undefined ? 'fehlt' : stabil(x));
    for (const id of ids) {
      const bw = mitBasis ? basisListe.find((x) => x.id === id) : undefined;
      const lw = lokalListe.find((x) => x.id === id);
      const rw = remoteListe.find((x) => x.id === id);
      const ew = daten.buchungen.find((x) => x.id === id);
      const lokalGeaendert = mitBasis ? s(lw) !== s(bw) : lw !== undefined;
      const remoteGeaendert = mitBasis ? s(rw) !== s(bw) : rw !== undefined;
      if (s(lw) === s(rw)) {
        assert.ok(!konfliktIds.has(id) && s(ew) === s(lw), `Fall ${fall}, ${id}: gleich → übernommen`);
      } else if (lokalGeaendert && remoteGeaendert) {
        assert.ok(konfliktIds.has(id), `Fall ${fall}, ${id}: beide geändert → MUSS nachfragen`);
      } else {
        assert.ok(!konfliktIds.has(id), `Fall ${fall}, ${id}: nur eine Seite geändert → keine Nachfrage`);
        assert.equal(s(ew), s(lokalGeaendert ? lw : rw), `Fall ${fall}, ${id}: Änderung übernommen`);
      }
    }
  }
});
