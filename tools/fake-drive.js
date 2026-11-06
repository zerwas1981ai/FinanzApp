// NUR ZUM TESTEN im Browser (wird von der App nie geladen):
// Ersetzt Google-Anmeldung und Drive durch eine Attrappe im Arbeitsspeicher, damit sich der
// Abgleich ohne echtes Google-Konto prüfen lässt. In der Browser-Konsole:
//   await import('/tools/fake-drive.js')
// Danach liegt die Attrappe unter window.__fakeDrive (Map id → Datei).

const files = new Map();
let n = 0;
window.__fakeDrive = files;
window.google = {
  accounts: {
    oauth2: {
      initTokenClient: (cfg) => ({
        callback: cfg.callback,
        requestAccessToken() { setTimeout(() => this.callback({ access_token: 'test-token', expires_in: 3600 }), 10); },
      }),
      hasGrantedAllScopes: () => true,
      revoke: () => {},
    },
  },
};
const echtFetch = window.fetch.bind(window);
const meta = (f) => ({ id: f.id, name: f.name, version: String(f.version), modifiedTime: f.modifiedTime, size: String(f.size ?? 0), mimeType: f.mimeType, appProperties: f.appProperties });
const touch = (f) => { f.version += 1; f.modifiedTime = new Date(Date.now() + (n += 1)).toISOString(); };

window.fetch = async (url, opt = {}) => {
  url = String(url);
  if (!url.includes('googleapis.com')) return echtFetch(url, opt);
  const u = new URL(url);
  const m = opt.method ?? 'GET';
  const ok = (body, status = 200) => new Response(typeof body === 'string' || body instanceof Blob ? body : JSON.stringify(body), { status });
  const idMatch = u.pathname.match(/files\/([^/]+)$/);
  if (u.pathname.startsWith('/upload/')) {
    const text = await opt.body.text();
    const grenze = opt.headers['Content-Type'].split('boundary=')[1];
    const teile = text.split(`--${grenze}`);
    const md = JSON.parse(teile[1].split('\r\n\r\n')[1]);
    const inhalt = teile[2].split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, '');
    let f = idMatch ? files.get(idMatch[1]) : null;
    if (!f) { f = { id: `f${n += 1}`, version: 0, ...md, trashed: false }; files.set(f.id, f); }
    f.content = inhalt;
    f.size = inhalt.length;
    touch(f);
    return ok(meta(f));
  }
  if (idMatch && m === 'DELETE') { files.delete(idMatch[1]); return new Response(null, { status: 204 }); }
  if (idMatch && m === 'PATCH') { const f = files.get(idMatch[1]); Object.assign(f, JSON.parse(opt.body)); touch(f); return ok(meta(f)); }
  if (idMatch && u.searchParams.get('alt') === 'media') return ok(files.get(idMatch[1]).content);
  if (idMatch) { const f = files.get(idMatch[1]); return f ? ok(meta(f)) : ok({}, 404); }
  if (m === 'POST') {
    const md = JSON.parse(opt.body);
    const f = { id: `f${n += 1}`, version: 1, modifiedTime: new Date().toISOString(), ...md, trashed: false };
    files.set(f.id, f);
    return ok({ id: f.id });
  }
  const q = u.searchParams.get('q');
  const wert = q.match(/value='([^']+)'/)[1];
  const eltern = q.match(/'([^']+)' in parents/)?.[1];
  const treffer = [...files.values()].filter((f) => !f.trashed && f.appProperties?.finanzapp === wert && (!eltern || f.parents?.includes(eltern)));
  return ok({ files: treffer.map(meta) });
};
