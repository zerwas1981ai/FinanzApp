// Service Worker: macht die App installierbar und offline nutzbar.
// Strategie "Netz zuerst": Ist Internet/Server da, kommt immer die neueste Version.
// Nur wenn das Netz fehlt, wird die zuletzt gespeicherte Kopie verwendet.
// Finanzdaten werden hier NICHT gespeichert – nur Programmdateien.

const CACHE = 'finanzapp-v113';

const APP_DATEIEN = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/theme.js',
  './js/app.js',
  './js/db.js',
  './js/dom.js',
  './js/ui.js',
  './js/format.js',
  './js/migrationen.js',
  './js/startdaten.js',
  './js/testdaten.js',
  './js/rechnen.js',
  './js/buchungen.js',
  './js/auswertung.js',
  './js/views/alle-buchungen.js',
  './js/views/projekte.js',
  './js/prognose.js',
  './js/annahmen.js',
  './js/views/annahmen.js',
  './js/views/kennzahlen.js',
  './js/views/zeitleiste.js',
  './js/views/posten-dialog.js',
  './js/views/belege.js',
  './js/belegliste.js',
  './js/erkennung.js',
  './js/views/erkennung.js',
  './js/views/sync-dialoge.js',
  './js/views/drive-bereich.js',
  './js/sync/zusammenfuehren.js',
  './js/sync/drive.js',
  './js/sync/abgleich.js',
  './js/export.js',
  './js/sperre.js',
  './js/login.js',
  './js/konten.js',
  './js/jahresbudget.js',
  './js/kategorien.js',
  './js/archiv.js',
  './js/relevant.js',
  './js/views/relevant.js',
  './js/suche.js',
  './js/views/suche.js',
  './js/vertraege.js',
  './js/views/vertraege.js',
  './js/farben.js',
  './js/rueckblick.js',
  './js/views/rueckblick.js',
  './js/monatsnotizen.js',
  './js/views/monatsnotiz.js',
  './js/notfall.js',
  './js/views/notfall.js',
  './js/datensicherung.js',
  './js/views/sperre-ui.js',
  './js/views/stammdaten.js',
  './js/views/uebersicht.js',
  './js/views/buchung-dialog.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

// Den Browser-Zwischenspeicher umgehen (D81): GitHub Pages erlaubt Browsern, Dateien bis zu
// 10 Minuten aufzuheben. Ohne "no-cache" käme nach einem Update kurz noch die alte Version.
// "no-cache" fragt jedes Mal beim Server nach – ist nichts geändert, kommt nur eine kurze Antwort.
const frisch = (req) => (req.mode === 'navigate'
  ? fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
  : fetch(req, { cache: 'no-cache' }));

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_DATEIEN.map((url) => new Request(url, { cache: 'reload' })))));
  self.skipWaiting();
});

// Geteilte Belege (D106) liegen kurz in einem eigenen Zwischenspeicher, bis die App sie abholt.
// Er ist KEIN Programm-Cache und wird beim Aktualisieren nicht gelöscht.
const GETEILT = 'finanzapp-geteilt';

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((namen) => Promise.all(namen.filter((n) => n !== CACHE && n !== GETEILT).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

// "Teilen an Finanzen" (Android, D106): Die geteilten Dateien kommen als Formular (POST) an.
// Sie werden nur auf diesem Gerät zwischengespeichert, dann öffnet sich die App mit ?geteilt=1
// und legt daraus eine neue Buchung an (Belege wie aus "Datei wählen").
async function nimmGeteilteAn(req) {
  try {
    const form = await req.formData();
    const dateien = form.getAll('belege').filter((f) => f && typeof f === 'object' && f.size > 0);
    const speicher = await caches.open(GETEILT);
    for (const alt of await speicher.keys()) await speicher.delete(alt);
    let n = 0;
    for (const f of dateien) {
      n += 1;
      await speicher.put(new Request(`./geteilt/${n}`), new Response(f, {
        headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-Dateiname': encodeURIComponent(f.name || `Beleg ${n}`) },
      }));
    }
  } catch (err) {
    // Ohne lesbare Datei öffnet sich trotzdem eine neue Buchung
  }
  return Response.redirect('./?geteilt=1', 303);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method === 'POST' && url.origin === self.location.origin && url.pathname.endsWith('/teilen')) {
    event.respondWith(nimmGeteilteAn(req));
    return;
  }
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    frisch(req)
      .then((antwort) => {
        if (antwort.ok) {
          const kopie = antwort.clone();
          caches.open(CACHE).then((c) => c.put(req, kopie));
        }
        return antwort;
      })
      .catch(async () => {
        const treffer = await caches.match(req, { ignoreSearch: true });
        if (treffer) return treffer;
        if (req.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      }),
  );
});
