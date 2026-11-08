// Service Worker: macht die App installierbar und offline nutzbar.
// Strategie "Netz zuerst": Ist Internet/Server da, kommt immer die neueste Version.
// Nur wenn das Netz fehlt, wird die zuletzt gespeicherte Kopie verwendet.
// Finanzdaten werden hier NICHT gespeichert – nur Programmdateien.

const CACHE = 'finanzapp-v33';

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
  './js/archiv.js',
  './js/relevant.js',
  './js/views/relevant.js',
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

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((namen) => Promise.all(namen.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

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
