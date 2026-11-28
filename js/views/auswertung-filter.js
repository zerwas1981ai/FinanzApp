// Tab „Auswertungen“: Filterbereich (Zeitraum, Konten, Kategorien, Art, Empfänger …) und Mehrfachauswahl (D72).
// Bis D258 Teil von alle-buchungen.js.

import { h } from '../dom.js';
import { heuteIso, parseEuro } from '../format.js';
import { merkeScroll } from '../ui.js';
import { STANDARD_FILTER, filtere, OHNE_PARTNER, partnerListe, partnerSchluessel } from '../auswertung.js';
import { sortiereKonten } from '../konten.js';
import { nachName, SEITE, zustand, ZEITRAEUME } from './auswertung-zustand.js';

/* =========================== Filter =========================== */

function filterGeaendert() {
  return Object.keys(STANDARD_FILTER).some((k) => JSON.stringify(zustand.filter[k]) !== JSON.stringify(STANDARD_FILTER[k]));
}

// Offene Mehrfachauswahl schließen, wenn daneben getippt wird (einmal für die ganze App)
document.addEventListener('click', (e) => {
  for (const d of document.querySelectorAll('details.mehrfach[open]')) {
    if (!d.contains(e.target)) d.open = false;
  }
});

/**
 * Aufklappliste mit Häkchen (Mehrfachauswahl, D72). Nichts angehakt = alle.
 * optionen: [{ wert, text, kurz?, gruppe?, eltern? }] – gruppe = Hauptkategorie (umfasst ihre
 * Unterkategorien), eltern = wert der zugehörigen Hauptkategorie, kurz = Text für die Anzeige.
 */
function mehrfachAuswahl({ optionen, gewaehlt, alleText, gleich = (a, b) => a === b, beiAenderung, einzeln = false, moeglich = null }) {
  let auswahl = [...gewaehlt];
  let d = null; // die Aufklappliste (wird unten erzeugt)
  const gruppenName = `einzeln-${Math.random().toString(36).slice(2, 8)}`;
  const istGewaehlt = (wert) => auswahl.some((w) => gleich(w, wert));
  const anzeige = h('span', { class: 'mehrfach-text' });
  const kaesten = [];

  const leeren = h('button', {
    type: 'button',
    class: 'mehrfach-leeren',
    onclick: () => {
      auswahl = [];
      aktualisiereAnzeige();
      beiAenderung(auswahl);
    },
  }, 'Auswahl aufheben');

  function aktualisiereAnzeige() {
    const namen = optionen.filter((o) => istGewaehlt(o.wert)).map((o) => o.kurz ?? o.text);
    anzeige.textContent = namen.length === 0 ? alleText
      : namen.length <= 2 ? namen.join(', ')
        : `${namen.length} ausgewählt`;
    for (const { o, input } of kaesten) {
      // Unterkategorie ist schon enthalten, wenn ihre Hauptkategorie angehakt ist
      const durchEltern = o.eltern != null && istGewaehlt(o.eltern);
      input.checked = durchEltern || istGewaehlt(o.wert);
      input.disabled = durchEltern;
    }
    leeren.hidden = auswahl.length === 0;
    anzeige.title = anzeige.textContent; // vollständiger Text als Tooltip, falls abgeschnitten
    // D126: ein aktiver Filter ist farbig hervorgehoben
    d?.classList.toggle('aktiv', auswahl.length > 0);
  }

  // D120: Unterkategorien zunächst eingeklappt; „+“ an der Hauptkategorie klappt sie auf.
  // Ist schon eine Unterkategorie gewählt, steht ihre Gruppe von Anfang an offen.
  const offeneGruppen = new Set(optionen.filter((o) => o.eltern != null && istGewaehlt(o.wert)).map((o) => o.eltern));
  const unterZeilen = new Map(); // Hauptkategorie → ihre Zeilen
  const zeilen = optionen.map((o) => {
    const input = h('input', {
      type: einzeln ? 'radio' : 'checkbox', // D130: Einfachauswahl mit runden Punkten
      name: einzeln ? gruppenName : null,
      onchange: () => {
        if (einzeln) {
          // D130: nur eine Auswahl (z. B. Art) – die vorige wird abgewählt, die Liste schließt sich
          auswahl = input.checked ? [o.wert] : [];
          aktualisiereAnzeige();
          beiAenderung(auswahl);
          if (d) d.open = false;
          return;
        }
        auswahl = input.checked
          ? [...auswahl, o.wert]
          : auswahl.filter((w) => !gleich(w, o.wert));
        // Hauptkategorie angehakt: einzeln gewählte Unterkategorien sind darin schon enthalten
        if (o.gruppe && input.checked) {
          const unter = optionen.filter((u) => u.eltern === o.wert).map((u) => u.wert);
          auswahl = auswahl.filter((w) => !unter.includes(w));
        }
        aktualisiereAnzeige();
        beiAenderung(auswahl);
      },
    });
    const klasse = 'mehrfach-option' + (o.gruppe ? ' gruppe' : '') + (o.eltern != null ? ' unter' : '');
    const zeile = h('label', { class: klasse, hidden: o.eltern != null && !offeneGruppen.has(o.eltern), title: o.text }, input, h('span', {}, o.text));
    kaesten.push({ o, input, zeile });
    if (o.eltern != null) {
      if (!unterZeilen.has(o.eltern)) unterZeilen.set(o.eltern, []);
      unterZeilen.get(o.eltern).push(zeile);
    }
    if (!o.gruppe || !optionen.some((u) => u.eltern === o.wert)) return zeile;
    const knopf = h('button', {
      type: 'button',
      class: 'mehrfach-klapp',
      'aria-expanded': String(offeneGruppen.has(o.wert)),
      'aria-label': `Unterkategorien von ${o.kurz ?? o.text} anzeigen`,
      onclick: () => {
        const auf = knopf.getAttribute('aria-expanded') !== 'true';
        knopf.setAttribute('aria-expanded', String(auf));
        knopf.textContent = auf ? '−' : '+';
        for (const z of unterZeilen.get(o.wert) ?? []) z.hidden = !auf;
      },
    }, offeneGruppen.has(o.wert) ? '−' : '+');
    const gruppe = h('div', { class: 'mehrfach-gruppe-zeile' }, zeile, knopf);
    kaesten.at(-1).aussen = gruppe;
    return gruppe;
  });

  // D132: Beim Öffnen nur Optionen zeigen, die mit den übrigen Filtern noch Buchungen ergeben.
  // Schon Gewähltes bleibt immer sichtbar (damit man es abwählen kann).
  const keine = h('p', { class: 'mehrfach-keine', hidden: true }, 'Mit den übrigen Filtern gibt es hier keine weitere Auswahl.');
  const pruefeMoeglich = () => {
    if (!moeglich) return;
    const set = moeglich();
    let sichtbar = 0;
    for (const k of kaesten) {
      const ok = istGewaehlt(k.o.wert) || (k.o.eltern != null && istGewaehlt(k.o.eltern)) || set.has(k.o.schluessel ?? k.o.wert);
      (k.aussen ?? k.zeile).classList.toggle('nicht-moeglich', !ok);
      if (ok) sichtbar += 1;
    }
    keine.hidden = sichtbar > 0;
  };

  d = h('details', { class: 'mehrfach', ontoggle: () => { if (d.open) pruefeMoeglich(); } },
    h('summary', { class: 'mehrfach-knopf', title: '' }, anzeige),
    h('div', { class: 'mehrfach-liste' }, leeren, keine, zeilen));
  aktualisiereAnzeige();
  return d;
}

export function filterBereich({ konten, kategorien, buchungen }, aktualisiere, neuZeichnen) {
  const f = zustand.filter;
  const setze = (schluessel, wert, ganzNeu = false) => {
    f[schluessel] = wert;
    if (ganzNeu) { zustand.sichtbar = SEITE; zustand.vorMonatswahl = null; neuZeichnen(); }
    else {
      resetKnopf.hidden = !filterGeaendert();
      aktualisiere();
    }
  };

  // Zeitraum-Schnellwahl
  const zeitraum = merkeScroll(h('div', { class: 'chips', role: 'group', 'aria-label': 'Zeitraum' },
    ZEITRAEUME.map(([wert, text]) => h('button', {
      type: 'button',
      class: 'chip',
      'aria-pressed': String(f.zeitraum === wert),
      onclick: () => setze('zeitraum', wert, true),
    }, text))), 'zeitraum'); // D171

  const eigenerZeitraum = f.zeitraum === 'eigen' && h('div', { class: 'filter-reihe' },
    feld('Von', h('input', { type: 'date', value: f.von, onchange: (e) => setze('von', e.target.value) })),
    feld('Bis', h('input', { type: 'date', value: f.bis, onchange: (e) => setze('bis', e.target.value) })),
  );

  // D132: Welche Werte sind mit allen ÜBRIGEN Filtern noch möglich? (beim Öffnen einer Liste berechnet)
  const ctx = { kategorien, konten, heute: heuteIso() };
  const ohne = (schluessel) => filtere(buchungen, { ...zustand.filter, [schluessel]: [] }, ctx);
  const moeglichKonten = () => new Set(ohne('kontoIds').flatMap((e) => [e.buchung.kontoId, e.buchung.gegenkontoId].filter(Boolean)));
  const moeglichArten = () => new Set(ohne('arten').map((e) => e.buchung.art));
  const moeglichKategorien = () => {
    const kat = new Map(kategorien.map((k) => [k.id, k]));
    const set = new Set();
    for (const { buchung: b } of ohne('kategorieIds')) {
      if (!b.kategorieId) continue;
      set.add(b.kategorieId);
      const eltern = kat.get(b.kategorieId)?.elternId;
      if (eltern) set.add(eltern);
    }
    return set;
  };
  const moeglichPartner = () => new Set(ohne('partner').filter((e) => e.buchung.art !== 'umbuchung')
    .map((e) => partnerSchluessel(e.buchung.partner) || OHNE_PARTNER));

  // Auswahllisten mit Häkchen (Mehrfachauswahl, D72)
  const kontoAuswahl = mehrfachAuswahl({
    moeglich: moeglichKonten,
    optionen: sortiereKonten(konten).map((k) => ({ wert: k.id, text: k.name + (k.archiviert ? ' (archiviert)' : ''), kurz: k.name })),
    gewaehlt: f.kontoIds,
    alleText: 'Alle Konten',
    beiAenderung: (w) => setze('kontoIds', w),
  });
  const artAuswahl = mehrfachAuswahl({
    moeglich: moeglichArten,
    optionen: [{ wert: 'ausgabe', text: 'Ausgaben' }, { wert: 'einnahme', text: 'Einnahmen' }, { wert: 'umbuchung', text: 'Umbuchungen' }],
    gewaehlt: f.arten,
    alleText: 'Alle Arten',
    einzeln: true, // D130
    // Art bestimmt, ob das Ausgaben-Diagramm erscheint → ganze Seite neu zeichnen
    beiAenderung: (w) => setze('arten', w, true),
  });

  const katOptionen = ['einnahme', 'ausgabe'].flatMap((art) => kategorien
    .filter((k) => !k.elternId && k.art === art)
    .sort(nachName)
    .flatMap((hk) => [
      { wert: hk.id, text: `${hk.name} (${art === 'einnahme' ? 'Einnahme' : 'Ausgabe'})`, kurz: hk.name, gruppe: true },
      ...kategorien.filter((u) => u.elternId === hk.id).sort(nachName)
        .map((u) => ({ wert: u.id, text: u.name + (u.archiviert ? ' (archiviert)' : ''), kurz: u.name, eltern: hk.id })),
    ]));
  const kategorieAuswahl = mehrfachAuswahl({
    moeglich: moeglichKategorien,
    optionen: katOptionen,
    gewaehlt: f.kategorieIds,
    alleText: 'Alle Kategorien',
    beiAenderung: (w) => setze('kategorieIds', w),
  });

  // Empfänger/Absender: alle bisher verwendeten Namen, häufigste zuerst
  const partner = partnerListe(buchungen);
  const partnerGleich = (a, b) => (a === OHNE_PARTNER || b === OHNE_PARTNER ? a === b : partnerSchluessel(a) === partnerSchluessel(b));
  const partnerAuswahl = mehrfachAuswahl({
    moeglich: moeglichPartner,
    optionen: [
      { wert: OHNE_PARTNER, text: 'Ohne Angabe' },
      ...partner.map((p) => ({ wert: p.name, text: `${p.name} (${p.anzahl})`, kurz: p.name, schluessel: partnerSchluessel(p.name) })),
    ],
    gewaehlt: f.partner,
    alleText: 'Alle',
    gleich: partnerGleich,
    beiAenderung: (w) => setze('partner', w),
  });

  // Suche: bei jeder Eingabe, leicht verzögert
  let timer;
  const suche = h('input', {
    type: 'search',
    placeholder: 'Suchen in An/Von, Notiz, Kategorie, Konto …',
    value: f.suche,
    'aria-label': 'Suchen',
    class: f.suche.trim() ? 'aktiv' : null,
    oninput: (e) => {
      e.target.classList.toggle('aktiv', e.target.value.trim() !== ''); // D126: aktiver Filter farbig
      clearTimeout(timer);
      timer = setTimeout(() => setze('suche', e.target.value), 200);
    },
  });

  // Betrag von/bis
  const betragFeld = (schluessel, label) => {
    const fehler = h('small', { class: 'feld-fehler' });
    const input = h('input', {
      type: 'text',
      inputmode: 'decimal',
      placeholder: label === 'Betrag ab' ? 'z. B. 50' : 'z. B. 500',
      value: f[schluessel] == null ? '' : String(f[schluessel] / 100).replace('.', ','),
      class: f[schluessel] != null ? 'aktiv' : null,
      onchange: (e) => {
        try {
          const cent = parseEuro(e.target.value, label);
          fehler.textContent = '';
          e.target.classList.toggle('aktiv', cent !== null);
          setze(schluessel, cent === null ? null : Math.abs(cent));
        } catch (err) {
          fehler.textContent = err.message;
        }
      },
    });
    return feld(label + ' (€)', input, fehler);
  };

  const resetKnopf = h('button', {
    type: 'button',
    class: 'knopf knopf-klein',
    hidden: !filterGeaendert(),
    onclick: () => {
      zustand.filter = { ...STANDARD_FILTER };
      zustand.sichtbar = SEITE;
      zustand.vorMonatswahl = null;
      neuZeichnen();
    },
  }, 'Filter zurücksetzen');

  // D123: Suche und Betrag ganz oben; Status („nur gebuchte“, D120) und „ohne Beleg“ entfallen
  // in der Oberfläche – damit gibt es keinen Bereich „Weitere Filter“ mehr
  return h('section', { class: 'bereich filter' },
    h('div', { class: 'filter-suche' },
      feld('Suche', suche),
      betragFeld('betragMin', 'Betrag ab'),
      betragFeld('betragMax', 'Betrag bis'),
    ),
    zeitraum,
    eigenerZeitraum,
    h('div', { class: 'filter-raster' },
      feld('Konto', kontoAuswahl),
      feld('Art', artAuswahl),
      feld('Kategorie', kategorieAuswahl),
      feld('Empfänger/Absender', partnerAuswahl),
    ),
    h('div', { class: 'filter-fuss' }, resetKnopf),
  );
}

function feld(label, steuerelement, zusatz = null) {
  return h('label', { class: 'feld' }, h('span', { class: 'feld-label' }, label), steuerelement, zusatz);
}

function auswahlListe(optionen, wert, beiAenderung) {
  const s = h('select', { onchange: (e) => beiAenderung(e.target.value) },
    optionen.map((o) => h('option', { value: o.wert }, o.text)));
  s.value = wert;
  return s;
}
