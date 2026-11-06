// Etappe 6: Bereiche in den Stammdaten – Google Drive (Verbindung, Abgleich, Backups) und Export.

import { h } from '../dom.js';
import * as db from '../db.js';
import { heuteIso } from '../format.js';
import { frage, toast, herunterladen } from '../ui.js';
import * as abgleich from '../sync/abgleich.js';
import { buchungenAlsCsv, exportName } from '../export.js';
import { DATENMODELL_VERSION } from '../migrationen.js';

const zeit = (iso) => (iso ? new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : '–');
const groesse = (bytes) => `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** Fehler als kurze Meldung zeigen statt die Seite zu ersetzen */
const sicher = (fn) => async (...args) => {
  try { await fn(...args); } catch (err) { toast(err.message ?? String(err)); }
};

export function driveBereich(neu) {
  const eingerichtet = abgleich.istEingerichtet();
  const id = h('input', {
    id: 'drive-client-id', type: 'text', autocomplete: 'off', spellcheck: 'false',
    value: abgleich.clientId(), placeholder: '1234567890-abc….apps.googleusercontent.com',
  });
  const statusZeile = h('p', { class: 'hinweis', role: 'status' });
  const zeigeStatus = (s = abgleich.status) => {
    statusZeile.textContent = `Status: ${s.text}` + (s.letzter ? ` · letzter Abgleich ${zeit(s.letzter)}` : '');
  };
  zeigeStatus();
  window.addEventListener('sync-status', (e) => statusZeile.isConnected && zeigeStatus(e.detail));

  const backupListe = h('div', { class: 'backup-liste' }, h('p', { class: 'leer' }, 'Wird geladen …'));
  const backups = h('details', {
    class: 'erledigt-liste',
    ontoggle: sicher(async (e) => {
      if (!e.target.open) return;
      if (abgleich.status.zustand === 'anmelden') await abgleich.jetzt();
      const liste = await abgleich.backups();
      backupListe.replaceChildren(liste.length === 0
        ? h('p', { class: 'leer' }, 'Noch keine Backups.')
        : h('ul', { class: 'liste' }, liste.map((b) => h('li', { class: 'zeile' },
          h('div', {}, h('div', { class: 'zeile-titel' }, zeit(b.zeit)), h('div', { class: 'zeile-info' }, groesse(b.groesse))),
          h('div', { class: 'zeile-aktionen' }, h('button', {
            type: 'button',
            class: 'knopf knopf-klein',
            onclick: sicher(async () => {
              const ok = await frage({
                titel: 'Backup wiederherstellen?',
                text: [`Der Stand vom ${zeit(b.zeit)} ersetzt deine Daten auf diesem Gerät und in Google Drive.`,
                  'Der jetzige Stand wird vorher selbst als Backup gesichert – du kannst also zurück.'],
                jaText: 'Wiederherstellen',
                gefahr: true,
              });
              if (!ok) return;
              await abgleich.wiederherstellen(b.id);
              toast(`Stand vom ${zeit(b.zeit)} wiederhergestellt`);
            }),
          }, 'Wiederherstellen'))))));
    }),
  }, h('summary', {}, 'Backups in Drive anzeigen'), backupListe);

  return h('section', { class: 'bereich', 'aria-labelledby': 'titel-drive' },
    h('h2', { id: 'titel-drive' }, 'Google Drive'),
    h('p', { class: 'hinweis' },
      'Deine Daten liegen auf diesem Gerät und werden mit einer Datei in deinem Google Drive abgeglichen ' +
      '(Ordner „Finanzapp“). So hast du dieselben Daten auf PC und Handy. Die App sieht in deinem Drive nur ' +
      'die Dateien, die sie selbst angelegt hat. Bei jedem Speichern entsteht ein Backup (die letzten 30 ' +
      'und je eins pro Tag der letzten 30 Tage).'),
    h('div', { class: 'feld' },
      h('label', { for: 'drive-client-id' }, 'Client-ID (aus der Google Cloud Console)'),
      id,
      h('small', { class: 'feld-hilfe' }, 'Wird nur auf diesem Gerät gespeichert. Wie du sie bekommst, steht in der README unter „Google Drive einrichten“.')),
    statusZeile,
    h('div', { class: 'knopfreihe' },
      !eingerichtet && h('button', {
        type: 'button',
        class: 'knopf knopf-primaer',
        onclick: sicher(async () => {
          if (!id.value.trim()) throw new Error('Bitte zuerst die Client-ID eintragen.');
          abgleich.setzeClientId(id.value);
          await abgleich.verbinden();
          toast('Mit Google Drive verbunden');
          neu();
        }),
      }, 'Mit Google Drive verbinden'),
      eingerichtet && h('button', {
        type: 'button',
        class: 'knopf knopf-primaer',
        onclick: sicher(async () => {
          if (id.value.trim() !== abgleich.clientId()) abgleich.setzeClientId(id.value);
          await abgleich.jetzt();
          toast(abgleich.status.text);
        }),
      }, 'Jetzt abgleichen'),
      eingerichtet && h('button', {
        type: 'button',
        class: 'knopf',
        onclick: sicher(async () => {
          const ok = await frage({
            titel: 'Von Google Drive trennen?',
            text: 'Die Daten bleiben auf diesem Gerät und in Drive. Es wird nur nicht mehr abgeglichen, bis du wieder verbindest.',
            jaText: 'Trennen',
          });
          if (!ok) return;
          await abgleich.trennen();
          neu();
        }),
      }, 'Trennen')),
    eingerichtet && backups,
  );
}

export function exportBereich() {
  return h('section', { class: 'bereich', 'aria-labelledby': 'titel-export' },
    h('h2', { id: 'titel-export' }, 'Export'),
    h('p', { class: 'hinweis' },
      'Alle Buchungen (ohne Papierkorb) als CSV-Datei, die Excel direkt öffnet. Eine gefilterte Liste ' +
      'exportierst du unter „Alle Buchungen“. Zusätzlich lässt sich der komplette Datenstand als JSON sichern.'),
    h('div', { class: 'knopfreihe' },
      h('button', {
        type: 'button',
        class: 'knopf',
        onclick: sicher(async () => {
          const [buchungen, konten, kategorien, projekte] = await Promise.all(['buchungen', 'konten', 'kategorien', 'projekte'].map((s) => db.alle(s)));
          herunterladen(buchungenAlsCsv(buchungen, { konten, kategorien, projekte }), exportName('buchungen', heuteIso()), 'text/csv;charset=utf-8');
        }),
      }, 'Buchungen als CSV (Excel)'),
      h('button', {
        type: 'button',
        class: 'knopf',
        onclick: sicher(async () => {
          const daten = { ...(await db.leseDatenstand()), version: DATENMODELL_VERSION };
          herunterladen(JSON.stringify(daten, null, 1), `finanzen-datenstand-${heuteIso()}.json`, 'application/json');
        }),
      }, 'Kompletter Datenstand (JSON)')),
  );
}
