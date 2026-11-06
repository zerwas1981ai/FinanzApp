// Kleiner lokaler Webserver nur zum Testen am PC.
// Start: npm start  →  dann im Browser http://localhost:8080 öffnen.
// Er liefert nur die Dateien dieses Ordners aus und ist nur von diesem PC erreichbar.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;

const TYPEN = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/plain; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let relativ = decodeURIComponent(url.pathname);
    if (relativ.endsWith('/')) relativ += 'index.html';

    const datei = path.normalize(path.join(WURZEL, relativ));
    // Nichts außerhalb des Projektordners ausliefern
    if (!datei.startsWith(WURZEL + path.sep)) {
      res.writeHead(403).end('Verboten');
      return;
    }
    // Keine versteckten Ordner (.git usw.) und keine Pakete ausliefern
    const teile = path.relative(WURZEL, datei).split(path.sep);
    if (teile.some((t) => t.startsWith('.')) || teile[0] === 'node_modules') {
      res.writeHead(404).end('Nicht gefunden');
      return;
    }

    const inhalt = await readFile(datei);
    res.writeHead(200, {
      'Content-Type': TYPEN[path.extname(datei).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(inhalt);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Nicht gefunden');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Finanz-App läuft: http://localhost:${PORT}`);
  console.log('Beenden mit Strg + C');
});
