// Vorlagen für häufige Buchungen (D104): Leiste im Buchungsdialog, "Als Vorlage speichern",
// Verwaltung in den Stammdaten.

import { h } from '../dom.js';
import * as db from '../db.js';
import { formatEuro, parseEuro, centZuEingabe } from '../format.js';
import { dialog, toast, eingabe, auswahl, frage, knopf } from '../ui.js';
import { baueVorlage, sortiereVorlagen, namensVorschlag, MAX_NAME } from '../vorlagen.js';
import { verschiebeKonto, sortiereKonten } from '../konten.js';

const ART_TEXT = { ausgabe: 'Ausgabe', einnahme: 'Einnahme', umbuchung: 'Umbuchung' };

/** Knöpfe oben im Dialog "Neue Buchung". wendeAn(vorlage) füllt die Felder. null = keine Vorlagen. */
export function vorlagenLeiste(vorlagen, wendeAn) {
  if (vorlagen.length === 0) return null;
  const knoepfe = sortiereVorlagen(vorlagen).map((v) => h('button', {
    type: 'button',
    class: 'chip vorlage-chip',
    'aria-pressed': 'false',
    title: [ART_TEXT[v.art], v.betragCent != null ? formatEuro(v.betragCent) : ''].filter(Boolean).join(' · '),
    onclick: () => {
      knoepfe.forEach((k) => k.setAttribute('aria-pressed', String(k === knopfVon.get(v.id))));
      wendeAn(v);
    },
  }, v.name));
  const knopfVon = new Map(sortiereVorlagen(vorlagen).map((v, i) => [v.id, knoepfe[i]]));
  return h('div', { class: 'vorlagen-leiste' },
    h('span', { class: 'feld-label' }, 'Vorlage'),
    h('div', { class: 'chips', role: 'group', 'aria-label': 'Vorlagen' }, knoepfe));
}

/**
 * Kleiner Dialog „Als Vorlage speichern“. werte: aktuelle Werte des Buchungsdialogs
 * ({ art, betragCent, kontoId, gegenkontoId, kategorieId, budgetKategorieId, partner, notiz }).
 */
export async function vorlageSpeichernDialog(werte) {
  const [konten, kategorien, vorlagen] = await Promise.all(['konten', 'kategorien', 'vorlagen'].map((s) => db.alle(s)));
  const name = eingabe({ label: 'Name der Vorlage', maxlength: MAX_NAME, value: namensVorschlag(werte, kategorien), autofocus: true });
  const hatBetrag = Number.isInteger(werte.betragCent) && werte.betragCent > 0;
  const mitBetrag = h('input', { type: 'checkbox', disabled: !hatBetrag });
  dialog({
    titel: 'Als Vorlage speichern',
    inhalt: [
      h('p', { class: 'hinweis' }, 'Die Vorlage füllt bei einer neuen Buchung Art, Konto, Kategorie, Empfänger/Absender und Notiz aus.'),
      name.feld,
      h('label', { class: 'schalter feld-schalter' }, mitBetrag,
        hatBetrag ? `Betrag mitspeichern (${formatEuro(werte.betragCent)})` : 'Betrag mitspeichern (erst einen Betrag eingeben)'),
    ],
    speichernText: 'Vorlage speichern',
    onSpeichern: async () => {
      const v = baueVorlage({ ...werte, name: name.input.value, mitBetrag: mitBetrag.checked }, { konten, kategorien, vorhandene: vorlagen });
      await db.speichere('vorlagen', v);
      toast(`Vorlage „${v.name}“ gespeichert`);
    },
  });
}

/* =========================== Stammdaten =========================== */

/** Bereich „Vorlagen“ in den Stammdaten */
export function vorlagenBereich(vorlagen, konten, kategorien, neu) {
  const sortiert = sortiereVorlagen(vorlagen);
  const kontoName = new Map(konten.map((k) => [k.id, k.name]));
  const katName = new Map(kategorien.map((k) => [k.id, k.name]));

  const zeile = (v, platz) => h('li', { class: 'zeile' },
    h('div', {},
      h('div', { class: 'zeile-titel' }, v.name),
      h('div', { class: 'zeile-info' }, [
        ART_TEXT[v.art],
        v.art === 'umbuchung'
          ? `${kontoName.get(v.kontoId) ?? '?'} → ${kontoName.get(v.gegenkontoId) ?? '?'}`
          : [katName.get(v.kategorieId), kontoName.get(v.kontoId)].filter(Boolean).join(' · '),
        v.partner,
      ].filter(Boolean).join(' · '))),
    h('div', { class: 'zeile-betrag' }, v.betragCent != null ? formatEuro(v.betragCent) : h('small', {}, 'Betrag frei')),
    h('div', { class: 'zeile-aktionen' },
      h('span', { class: 'reihenfolge-knoepfe' },
        h('button', {
          type: 'button', class: 'knopf knopf-klein', disabled: platz === 0,
          'aria-label': `${v.name} nach oben`, title: 'Nach oben', onclick: () => schiebe(v, -1),
        }, '▲'),
        h('button', {
          type: 'button', class: 'knopf knopf-klein', disabled: platz === sortiert.length - 1,
          'aria-label': `${v.name} nach unten`, title: 'Nach unten', onclick: () => schiebe(v, 1),
        }, '▼')),
      knopf('Bearbeiten', () => vorlageDialog(v, { vorlagen, konten, kategorien }, neu)),
      knopf('Löschen', async () => {
        if (!await frage({ titel: 'Vorlage löschen?', text: `„${v.name}“ wird gelöscht. Buchungen bleiben unverändert.`, jaText: 'Löschen', gefahr: true })) return;
        await db.loesche('vorlagen', v.id);
        toast('Vorlage gelöscht');
        neu();
      }, 'knopf-gefahr')));

  const schiebe = async (v, richtung) => {
    const geaendert = verschiebeKonto(vorlagen, v.id, richtung);
    if (!geaendert.length) return;
    await db.speichere('vorlagen', geaendert);
    neu();
  };

  return h('section', { class: 'bereich', 'aria-labelledby': 'titel-vorlagen' },
    h('div', { class: 'bereich-kopf' }, h('h2', { id: 'titel-vorlagen' }, 'Vorlagen')),
    h('p', { class: 'hinweis erklaerung' }, 'Vorlagen erscheinen oben im Dialog „Neue Buchung“. Neue Vorlagen legst du im Buchungsdialog '
      + 'mit „☆ Als Vorlage speichern“ an.'),
    sortiert.length === 0
      ? h('p', { class: 'leer' }, 'Noch keine Vorlagen.')
      : h('ul', { class: 'liste' }, sortiert.map(zeile)));
}

/** Vorlage bearbeiten: Name, Konto(en), Kategorie, Empfänger/Absender, Notiz, Betrag (leer = frei) */
function vorlageDialog(v, { vorlagen, konten, kategorien }, neu) {
  const aktiveKonten = sortiereKonten(konten.filter((k) => !k.archiviert || k.id === v.kontoId || k.id === v.gegenkontoId));
  const kontoOptionen = aktiveKonten.map((k) => ({ wert: k.id, text: k.name }));
  const name = eingabe({ label: 'Name', maxlength: MAX_NAME, value: v.name, autofocus: true });
  const konto = auswahl({ label: v.art === 'umbuchung' ? 'Von Konto' : 'Konto', optionen: kontoOptionen, wert: v.kontoId });
  const gegenkonto = v.art === 'umbuchung' && auswahl({ label: 'Auf Konto', optionen: kontoOptionen, wert: v.gegenkontoId });
  const kategorie = v.art !== 'umbuchung' && auswahl({
    label: 'Kategorie (optional)',
    optionen: [{ wert: '', text: 'Keine' }, ...kategorien
      .filter((hk) => !hk.elternId && hk.art === v.art)
      .flatMap((hk) => kategorien.filter((u) => u.elternId === hk.id && (!u.archiviert || u.id === v.kategorieId))
        .map((u) => ({ wert: u.id, text: `${hk.name} › ${u.name}` })))
      .sort((a, b) => a.text.localeCompare(b.text, 'de'))],
    wert: v.kategorieId ?? '',
  });
  const partner = v.art !== 'umbuchung' && eingabe({ label: v.art === 'einnahme' ? 'Von (Absender, optional)' : 'An (Empfänger, optional)', maxlength: 80, value: v.partner ?? '' });
  const notiz = eingabe({ label: 'Notiz (optional)', maxlength: 200, value: v.notiz ?? '' });
  const betrag = eingabe({
    label: 'Betrag in € (optional)', inputmode: 'decimal', placeholder: 'leer = bei jeder Buchung eintippen',
    value: v.betragCent != null ? centZuEingabe(v.betragCent) : '',
  });

  dialog({
    titel: `Vorlage „${v.name}“ (${ART_TEXT[v.art]})`,
    inhalt: [name.feld, konto.feld, gegenkonto?.feld, kategorie?.feld, partner?.feld, notiz.feld, betrag.feld].filter(Boolean),
    onSpeichern: async () => {
      const betragCent = betrag.input.value.trim() ? parseEuro(betrag.input.value, 'Betrag') : null;
      const neuV = baueVorlage({
        ...v,
        name: name.input.value,
        kontoId: konto.select.value,
        gegenkontoId: gegenkonto ? gegenkonto.select.value : null,
        kategorieId: kategorie ? kategorie.select.value || null : null,
        partner: partner ? partner.input.value : '',
        notiz: notiz.input.value,
        betragCent,
        mitBetrag: betragCent != null,
      }, { konten, kategorien, vorhandene: vorlagen, alt: v });
      await db.speichere('vorlagen', neuV);
      toast('Vorlage gespeichert');
      neu();
    },
  });
}
