// Etappe 6: Bereiche in den Stammdaten – Google Drive (Verbindung, Abgleich, Backups) und Export.

import { h } from '../dom.js';
import * as db from '../db.js';
import { heuteIso } from '../format.js';
import { frage, toast, herunterladen, dialog, eingabe } from '../ui.js';
import * as abgleich from '../sync/abgleich.js';
import { buchungenAlsCsv, exportName } from '../export.js';
import { DATENMODELL_VERSION } from '../migrationen.js';
import { naechstesArchivJahr, letztesArchiv } from '../archiv.js';

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

/* ---------- Alles löschen und neu beginnen (D66) ---------- */

export function neuBeginnenBereich() {
  const mitDrive = abgleich.istEingerichtet();
  return h('section', { class: 'bereich gefahrenzone', 'aria-labelledby': 'titel-neu' },
    h('h2', { id: 'titel-neu' }, 'Alles löschen und neu beginnen'),
    h('p', { class: 'hinweis' },
      'Löscht wirklich alle Daten: Konten, Buchungen (auch im Papierkorb), wiederkehrende und geplante Buchungen, ' +
      'Budgets, Projekte, Abstimmungen, Belege und eigene Kategorien. Danach ist nur der Kategorie-Startsatz da. ' +
      (mitDrive
        ? 'Auch in Google Drive werden die Daten, alle Backups, Belege und Archive endgültig gelöscht. ' +
          'Deine anderen Geräte fragen beim nächsten Abgleich, ob sie ebenfalls leeren sollen.'
        : 'Google Drive ist auf diesem Gerät nicht verbunden – dort wird nichts gelöscht.')),
    h('p', { class: 'hinweis' }, 'Die Verbindung zu Google Drive (Client-ID) und die App-Sperre bleiben erhalten.'),
    h('button', {
      type: 'button',
      class: 'knopf knopf-gefahr',
      onclick: sicher(async () => {
        const ok = await frage({
          titel: 'Wirklich alles löschen?',
          text: ['Alle Daten werden endgültig gelöscht' + (mitDrive ? ' – auf diesem Gerät und in Google Drive (inklusive aller Backups).' : ' – auf diesem Gerät.'),
            'Das lässt sich nicht rückgängig machen. Tipp: Vorher unter „Export“ den kompletten Datenstand als JSON sichern.'],
          jaText: 'Weiter',
          gefahr: true,
        });
        if (!ok) return;
        const bestaetigt = await new Promise((resolve) => {
          let ja = false;
          const feld = eingabe({ label: 'Zur Bestätigung LÖSCHEN eintippen', autocomplete: 'off', autofocus: true });
          const dlg = dialog({
            titel: 'Letzte Bestätigung',
            inhalt: [feld.feld],
            speichernText: 'Endgültig löschen',
            gefahr: true,
            onSpeichern: () => {
              if (feld.input.value.trim().toLocaleUpperCase('de') !== 'LÖSCHEN') throw new Error('Bitte genau LÖSCHEN eintippen.');
              ja = true;
            },
          });
          dlg.addEventListener('close', () => resolve(ja));
        });
        if (!bestaetigt) return;
        toast(await abgleich.allesNeuBeginnen());
        location.hash = '#stammdaten';
      }),
    }, 'Alles löschen …'));
}

/* ---------- Archiv alter Jahre (D68) ---------- */

export async function archivBereich(neu) {
  const [buchungen, archive] = await Promise.all([db.alle('buchungen'), db.alle('archive')]);
  const naechstes = naechstesArchivJahr({ buchungen }, heuteIso());
  const letztes = letztesArchiv({ archive });
  const sortiert = [...archive].sort((a, b) => b.jahr - a.jahr);

  const ansehen = (jahr) => {
    sessionStorage.setItem('finanzapp-bestand', String(jahr));
    location.hash = '#buchungen';
  };

  return h('section', { class: 'bereich', 'aria-labelledby': 'titel-archiv' },
    h('h2', { id: 'titel-archiv' }, 'Archiv alter Jahre'),
    h('p', { class: 'hinweis' },
      'Ein abgeschlossenes Jahr kann in eine eigene Datei in Google Drive wandern. Das passiert nur, wenn du es hier ' +
      'auslöst – nie automatisch. Ebenso holst du ein Jahr nur von Hand zurück. ' +
      'Die Konten starten danach am 1. Januar mit dem Kontostand vom 31. Dezember – die Kontostände ändern sich nicht.'),
    h('p', { class: 'hinweis' },
      'Unter „Alle Buchungen“ bleiben archivierte Jahre in Liste, Filtern, Analyse und Durchschnitten enthalten ' +
      '(gekennzeichnet mit „Archiv“, nur lesen). Nur die Budgethinweise der Übersicht schauen auf die letzten Monate ' +
      'außerhalb des Archivs – deshalb am besten erst im Frühjahr archivieren.'),
    sortiert.length > 0 && h('ul', { class: 'liste' }, sortiert.map((a) => h('li', { class: 'zeile' },
      h('div', {},
        h('div', { class: 'zeile-titel' }, `Jahr ${a.jahr}`),
        h('div', { class: 'zeile-info' }, `${a.anzahlBuchungen} Buchungen · archiviert am ${zeit(a.erstelltAm)}`)),
      h('div', { class: 'zeile-aktionen' },
        h('button', { type: 'button', class: 'knopf knopf-klein', onclick: () => ansehen(a.jahr) }, 'Ansehen'),
        a.id === letztes?.id && h('button', {
          type: 'button',
          class: 'knopf knopf-klein',
          onclick: sicher(async () => {
            const ok = await frage({
              titel: `${a.jahr} zurückholen?`,
              text: `Die ${a.anzahlBuchungen} Buchungen aus ${a.jahr} kommen zurück in die App, die Konten beginnen wieder wie vorher. ` +
                'Die Archivdatei kommt in den Drive-Papierkorb.',
              jaText: 'Zurückholen',
            });
            if (!ok) return;
            await abgleich.holeArchivZurueck(a);
            toast(`${a.jahr} ist wieder in der App`);
            neu();
          }),
        }, 'Zurückholen'))))),
    naechstes
      ? h('div', {},
        h('p', {}, `Als Nächstes archivierbar: ${naechstes.jahr} (${naechstes.anzahl} Buchungen).`),
        naechstes.hindernis && h('p', { class: 'warn-text klein' }, naechstes.hindernis),
        h('button', {
          type: 'button',
          class: 'knopf',
          disabled: Boolean(naechstes.hindernis),
          onclick: sicher(async () => {
            const ok = await frage({
              titel: `${naechstes.jahr} archivieren?`,
              text: [
                `${naechstes.anzahl} Buchungen und die Kontoabstimmungen aus ${naechstes.jahr} wandern in die Datei ` +
                `„finanzapp-archiv-${naechstes.jahr}.json“ in deinem Google Drive.`,
                `Die Konten beginnen danach am 01.01.${naechstes.jahr + 1} mit ihrem Stand vom 31.12.${naechstes.jahr}. ` +
                'Du kannst das zuletzt archivierte Jahr jederzeit zurückholen.',
              ],
              jaText: 'Archivieren',
            });
            if (!ok) return;
            await abgleich.archiviereJahr(naechstes.jahr);
            toast(`${naechstes.jahr} archiviert`);
            neu();
          }),
        }, `${naechstes.jahr} archivieren`))
      : h('p', { class: 'leer' }, 'Zurzeit gibt es kein abgeschlossenes Jahr zum Archivieren.'),
  );
}

