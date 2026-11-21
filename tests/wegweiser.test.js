// D236: Prüft automatisch, ob die Wegweiser (DECISIONS.md „Was gilt aktuell“, CLAUDE.md „Aktueller Stand“)
// und die Offline-Liste in sw.js zum Code passen. Schlägt ein Test fehl, wurde beim letzten Schritt
// vergessen, dort nachzutragen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATENMODELL_VERSION } from '../js/migrationen.js';

const lies = (datei) => readFileSync(new URL(`../${datei}`, import.meta.url), 'utf8');
const decisions = lies('DECISIONS.md');
const claude = lies('CLAUDE.md');
const sw = lies('sw.js');

const letzteD = Math.max(...[...decisions.matchAll(/^#{2,3} D(\d+)/gm)].map((m) => Number(m[1])));
const cache = sw.match(/const CACHE = '(finanzapp-v\d+)'/)[1];
const dbStruktur = Number(lies('js/db.js').match(/const DB_STRUKTUR_VERSION = (\d+)/)[1]);

test('D236: Wegweiser in DECISIONS.md ist auf dem neuesten Stand', () => {
  const zeile = decisions.match(/^\*\*Stand:\*\* D(\d+) · Datenmodell (\d+) · DB-Struktur (\d+) · Cache (\S+)$/m);
  assert.ok(zeile, 'Zeile „**Stand:** D… · Datenmodell … · DB-Struktur … · Cache …“ fehlt im Wegweiser');
  assert.equal(Number(zeile[1]), letzteD, 'Wegweiser: letzte D-Nummer nachtragen');
  assert.equal(Number(zeile[2]), DATENMODELL_VERSION, 'Wegweiser: Datenmodell-Version nachtragen');
  assert.equal(Number(zeile[3]), dbStruktur, 'Wegweiser: DB-Struktur nachtragen');
  assert.equal(zeile[4], cache, 'Wegweiser: Cache-Version aus sw.js nachtragen');
});

test('D236: CLAUDE.md nennt die aktuelle Entscheidung und Versionen', () => {
  const zeile = claude.match(/Letzte Entscheidung: D(\d+), Cache-Version in sw\.js: (\S+), Datenmodell-Version (\d+)\./);
  assert.ok(zeile, 'Zeile „Letzte Entscheidung: …“ fehlt in CLAUDE.md');
  assert.equal(Number(zeile[1]), letzteD, 'CLAUDE.md: letzte D-Nummer nachtragen');
  assert.equal(zeile[2], cache, 'CLAUDE.md: Cache-Version nachtragen');
  assert.equal(Number(zeile[3]), DATENMODELL_VERSION, 'CLAUDE.md: Datenmodell-Version nachtragen');
});

test('D236: sw.js enthält alle Programmdateien und keine fehlenden', () => {
  const liste = [...sw.matchAll(/'\.\/([^'?]*)'/g)].map((m) => m[1]).filter(Boolean);
  const wurzel = new URL('..', import.meta.url);
  for (const datei of liste) assert.ok(existsSync(new URL(datei, wurzel)), `sw.js nennt ${datei}, die Datei gibt es nicht`);
  const alleJs = (ordner) => readdirSync(new URL(ordner, wurzel), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? alleJs(`${ordner}${e.name}/`) : e.name.endsWith('.js') ? [join(ordner, e.name).replaceAll('\\', '/')] : []));
  for (const datei of alleJs('js/')) assert.ok(liste.includes(datei), `${datei} fehlt in sw.js (Offline-Liste)`);
});
