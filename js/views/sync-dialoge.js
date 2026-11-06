// Etappe 6: Rückfragen beim Abgleich mit Drive und die Statusanzeige oben rechts.
// Die App überschreibt nie still: Bei Widersprüchen entscheidet der Nutzer (D60).

import { h } from '../dom.js';
import { formatEuro, formatDatum } from '../format.js';
import { dialog, toast } from '../ui.js';
import * as abgleich from '../sync/abgleich.js';

const SAMMLUNG_TEXT = {
  konten: 'Konto', kategorien: 'Kategorie', buchungen: 'Buchung', abstimmungen: 'Kontoabstimmung',
  budgets: 'Budget', wiederkehrend: 'Wiederkehrende Buchung', hinweise: 'Budgethinweis',
  einstellungen: 'Einstellung', geplant: 'Geplante Einmalbuchung', projekte: 'Projekt',
};

const zeit = (iso) => (iso ? new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '');

/** Kurze, verständliche Beschreibung eines Datensatzes */
function beschreibe(sammlung, x, kategorien) {
  if (!x) return 'gelöscht';
  const kat = (id) => kategorien.find((k) => k.id === id)?.name;
  switch (sammlung) {
    case 'buchungen':
      return [formatDatum(x.datum), x.partner, kat(x.kategorieId) ?? (x.art === 'umbuchung' ? 'Umbuchung' : ''),
        (x.art === 'einnahme' ? '+' : '−') + formatEuro(x.betragCent), x.notiz, x.geloeschtAm ? 'im Papierkorb' : '']
        .filter(Boolean).join(' · ');
    case 'konten': return `${x.name} · Anfangssaldo ${formatEuro(x.anfangssaldoCent)}`;
    case 'kategorien': return x.name + (x.archiviert ? ' (archiviert)' : '');
    case 'wiederkehrend':
    case 'geplant': return [x.bezeichnung, x.partner, formatEuro(x.betragCent ?? x.stufen?.at(-1)?.betragCent ?? 0), x.aktiv === false ? 'ausgeschaltet' : ''].filter(Boolean).join(' · ');
    case 'budgets': return `${kat(x.kategorieId) ?? 'Budget'} · ${formatEuro(x.betragCent ?? x.stufen?.at(-1)?.betragCent ?? 0)}`;
    case 'projekte': return x.name + (x.rahmenCent != null ? ` · Rahmen ${formatEuro(x.rahmenCent)}` : '');
    default: return x.name ?? x.id;
  }
}

/** Beim ersten Verbinden, wenn hier und in Drive schon (verschiedene) Daten liegen */
function erstesVerbinden({ lokal, remote }) {
  return new Promise((resolve) => {
    let wahl = null;
    const knopf = (wert, text, erklaerung) => h('label', { class: 'wahl-karte' },
      h('input', { type: 'radio', name: 'erstes-verbinden', value: wert, checked: wert === 'drive' }),
      h('span', {}, h('strong', {}, text), h('small', { class: 'feld-hilfe' }, erklaerung)));
    const dlg = dialog({
      titel: 'Daten in Drive gefunden',
      inhalt: [
        h('p', {}, `In Google Drive liegen schon Daten (${remote}). Auf diesem Gerät sind ebenfalls Daten (${lokal}).`),
        knopf('drive', 'Drive-Stand übernehmen', 'Empfohlen, wenn dieses Gerät neu ist. Die Daten auf diesem Gerät werden ersetzt (vorher als Backup in Drive gesichert).'),
        knopf('zusammen', 'Zusammenführen', 'Beides behalten. Einträge, die es hier und dort gibt, aber verschieden sind, fragt die App einzeln ab. Achtung: gleich benannte Kategorien können doppelt erscheinen.'),
      ],
      speichernText: 'Weiter',
      onSpeichern: () => { wahl = dlg.querySelector('input[name="erstes-verbinden"]:checked')?.value ?? null; },
    });
    dlg.addEventListener('close', () => resolve(wahl));
  });
}

/** Einträge, die auf beiden Geräten verschieden geändert wurden: je Eintrag wählen */
function konflikte(liste, lokal) {
  return new Promise((resolve) => {
    let ergebnis = null;
    const kategorien = lokal.kategorien ?? [];
    const zeilen = liste.map((k, i) => {
      const name = `konflikt-${i}`;
      const seite = (wert, titel, x) => h('label', { class: 'wahl-karte' },
        h('input', { type: 'radio', name, value: wert, checked: wert === 'lokal' }),
        h('span', {},
          h('strong', {}, titel),
          h('span', { class: 'buchung-unter' }, beschreibe(k.sammlung, x, kategorien)),
          x?.geaendertAm && h('small', { class: 'feld-hilfe' }, `geändert ${zeit(x.geaendertAm)}`)));
      return h('fieldset', { class: 'konflikt' },
        h('legend', {}, SAMMLUNG_TEXT[k.sammlung] ?? k.sammlung),
        seite('lokal', 'Dieses Gerät', k.lokal),
        seite('remote', 'Google Drive (anderes Gerät)', k.remote));
    });
    const alle = (wert) => h('button', {
      type: 'button',
      class: 'knopf knopf-klein',
      onclick: () => dlg.querySelectorAll(`input[value="${wert}"]`).forEach((r) => { r.checked = true; }),
    }, wert === 'lokal' ? 'Überall „Dieses Gerät“' : 'Überall „Drive“');

    const dlg = dialog({
      titel: liste.length === 1 ? '1 Eintrag auf beiden Geräten geändert' : `${liste.length} Einträge auf beiden Geräten geändert`,
      inhalt: [
        h('p', { class: 'hinweis' }, 'Alles andere wurde schon zusammengeführt. Wähle je Eintrag, welche Fassung gelten soll. ' +
          'Die andere Fassung bleibt im Backup in Drive erhalten.'),
        h('div', { class: 'knopfreihe' }, alle('lokal'), alle('remote')),
        ...zeilen,
      ],
      speichernText: 'Übernehmen',
      abbrechenText: 'Später',
      onSpeichern: () => {
        ergebnis = new Map(liste.map((k, i) => [`${k.sammlung}|${k.id}`, dlg.querySelector(`input[name="konflikt-${i}"]:checked`)?.value ?? 'lokal']));
      },
    });
    dlg.addEventListener('close', () => resolve(ergebnis));
  });
}

/* ---------- Statusanzeige oben rechts ---------- */

const SYMBOL = { aus: '☁', anmelden: '☁', laeuft: '⟳', ok: '✓', offline: '⚡', fehler: '!', konflikt: '?' };

export function richteSyncEin() {
  abgleich.setzeFragen({ erstesVerbinden, konflikte });
  const knopf = document.getElementById('sync-status');
  const zeige = (s) => {
    knopf.hidden = s.zustand === 'aus';
    knopf.dataset.zustand = s.zustand;
    knopf.querySelector('.sync-symbol').textContent = SYMBOL[s.zustand] ?? '☁';
    const text = s.text + (s.zustand === 'ok' && s.letzter ? ` (${zeit(s.letzter)})` : '');
    knopf.title = text;
    knopf.setAttribute('aria-label', `Google Drive: ${text}`);
    knopf.querySelector('.sync-text').textContent = { anmelden: 'Anmelden', konflikt: 'Entscheiden', fehler: 'Fehler', offline: 'Offline' }[s.zustand] ?? '';
  };
  window.addEventListener('sync-status', (e) => zeige(e.detail));
  knopf.addEventListener('click', async () => {
    try {
      if (abgleich.status.zustand === 'fehler') toast(abgleich.status.text);
      await abgleich.jetzt();
    } catch (err) {
      toast(err.message ?? String(err));
    }
  });
  abgleich.starteAutomatik();
  zeige(abgleich.status);
}
