// D251/D252: Verlaufsgrafik im Kontokopf – echter Stand bis gestern (durchgezogen), erwarteter Stand ab heute
// (gestrichelt) für den gewählten Monat, dazu die Linie des Mindestsaldos mit getönter Fläche darunter.
// D252: Raster mit runden Euro-Werten (waagerecht) und Tagesmarken (senkrecht), größere Zeichnung.
// D253: senkrechte Linie für jeden Tag (1., 5., 10. … etwas kräftiger), jeder Tag beschriftet (am Handy jeder zweite);
// feinere Euro-Stufen (etwa 8 statt 4).
// Antippen/Überfahren zeigt Tag und Stand; ohne Zeiger steht dort der Tiefpunkt.
// Die Zeichenfläche wird in der Breite gestreckt (preserveAspectRatio="none"); Texte und Punkte liegen daher als
// HTML darüber, damit sie nicht verzerrt werden.

import { h } from '../dom.js';
import { formatEuro, formatDatum } from '../format.js';

const B = 300; // Breite der Zeichenfläche (Einheiten)
const H = 100; // Höhe

/** Euro ohne Cent für Achsenbeschriftungen: 1.250 € */
const euroKurz = (cent) => `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(Math.round(cent / 100))} €`;

/** D252/D253: runde Rasterschritte (1, 2, 2,5, 5 × 10ⁿ Euro) für etwa 8 Linien; Ergebnis in Cent */
export function rasterSchritte(min, max, ziel = 8) {
  const spanne = Math.max(max - min, 800); // mindestens 1-€-Schritte
  const roh = spanne / ziel;
  const zehner = 10 ** Math.floor(Math.log10(roh));
  const schritt = [1, 2, 2.5, 5, 10].map((f) => f * zehner).find((s) => s >= roh);
  let von = Math.floor(min / schritt) * schritt;
  let bis = Math.ceil(max / schritt) * schritt;
  if (bis === von) { von -= schritt; bis += schritt; } // gleichbleibender Stand: Linie in der Mitte
  // Etwas Luft am Rand, damit Tief- und Höchstpunkt nicht auf der Kante liegen
  if (min - von < schritt / 4) von -= schritt;
  if (bis - max < schritt / 4) bis += schritt;
  const linien = [];
  for (let w = von; w <= bis + schritt / 2; w += schritt) linien.push(Math.round(w));
  return { von, bis, linien };
}

/** D252: Tage mit kräftigerer Linie: 1., 5., 10., 15., 20., 25. und der Monatsletzte (im Februar ohne den 25.) */
export function tagesMarken(letzterTag) {
  const marken = [1, 5, 10, 15, 20, 25].filter((t) => t <= letzterTag - 4);
  return [...marken, letzterTag];
}

/**
 * D253: Beschriftung jedes Tages; schmal = auch am Handy sichtbar (ungerade Tage und der Monatsletzte,
 * der Tag davor entfällt dort, wenn der Monatsletzte gerade ist).
 */
export function tagesBeschriftung(letzterTag) {
  const liste = [];
  for (let t = 1; t <= letzterTag; t++) {
    const schmal = t === letzterTag || (t % 2 === 1 && !(t === letzterTag - 1));
    liste.push({ tag: t, schmal });
  }
  return liste;
}

/**
 * verlauf: [{ datum, stand, prognose }] aus kopfWerte (Index 0 = Ende des Vortags, also Monatsanfang; Index t = Tag t)
 * mindestCent: Mindestsaldo des Kontos oder null
 */
export function verlaufGrafik(verlauf, mindestCent, { beschreibung = 'Verlauf des Kontostands im Monat' } = {}) {
  if (!verlauf?.length) return null;
  const werte = verlauf.map((x) => x.stand);
  const extra = mindestCent != null ? [mindestCent] : [];
  const { von: min, bis: max, linien } = rasterSchritte(Math.min(...werte, ...extra), Math.max(...werte, ...extra));
  const n = verlauf.length;
  const xVon = (i) => (n === 1 ? B / 2 : (i / (n - 1)) * B);
  const yVon = (cent) => H - ((cent - min) / (max - min)) * H;
  const prozentX = (i) => `${(xVon(i) / B) * 100}%`;
  const prozentY = (cent) => `${(yVon(cent) / H) * 100}%`;
  const svg = (tag, attrs) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  };
  const pfad = (punkte) => punkte.map(([i, c], k) => `${k ? 'L' : 'M'}${xVon(i).toFixed(2)},${yVon(c).toFixed(2)}`).join(' ');

  const flaeche = svg('svg', { viewBox: `0 0 ${B} ${H}`, preserveAspectRatio: 'none', class: 'vg-flaeche', 'aria-hidden': 'true' });
  // Mindestsaldo: getönte Fläche darunter (unter dem Raster)
  if (mindestCent != null && mindestCent > min) {
    const y = Math.min(H, yVon(mindestCent));
    flaeche.append(svg('rect', { x: 0, y, width: B, height: H - y, class: 'vg-unter-mindest' }));
  }
  // Raster: waagerecht je Euro-Stufe (0 € etwas kräftiger), senkrecht je Tagesmarke
  for (const w of linien) flaeche.append(svg('line', { x1: 0, x2: B, y1: yVon(w), y2: yVon(w), class: w === 0 ? 'vg-raster vg-null' : 'vg-raster' }));
  // D254: je eine schwächere Zwischenlinie ohne Beschriftung zwischen zwei beschrifteten Stufen
  for (let k = 1; k < linien.length; k++) {
    const y = yVon((linien[k - 1] + linien[k]) / 2);
    flaeche.append(svg('line', { x1: 0, x2: B, y1: y, y2: y, class: 'vg-raster vg-fein' }));
  }
  const letzterTag = Number(verlauf[n - 1].datum.slice(8, 10));
  const marken = new Set(tagesMarken(letzterTag));
  for (let t = 1; t <= letzterTag && t < n; t++) {
    flaeche.append(svg('line', { x1: xVon(t), x2: xVon(t), y1: 0, y2: H, class: marken.has(t) ? 'vg-raster' : 'vg-raster vg-fein' }));
  }
  if (mindestCent != null && mindestCent > min) {
    const y = yVon(mindestCent);
    flaeche.append(svg('line', { x1: 0, x2: B, y1: y, y2: y, class: 'vg-mindest' }));
  }
  // Heute: senkrechte Linie am ersten erwarteten Tag, wenn der Monat echte und erwartete Stände hat
  const ersterErwartet = verlauf.findIndex((x) => x.prognose);
  if (ersterErwartet > 0) flaeche.append(svg('line', { x1: xVon(ersterErwartet), x2: xVon(ersterErwartet), y1: 0, y2: H, class: 'vg-heute' }));
  const echt = verlauf.map((x, i) => [i, x.stand]).filter(([i]) => !verlauf[i].prognose);
  // Erwarteter Verlauf beginnt am letzten echten Punkt, damit die Linie ohne Lücke weitergeht
  const erwartet = verlauf.map((x, i) => [i, x.stand]).filter(([i]) => verlauf[i].prognose || i === ersterErwartet - 1);
  if (echt.length > 1) flaeche.append(svg('path', { d: pfad(echt), class: 'vg-linie' }));
  if (erwartet.length > 1) flaeche.append(svg('path', { d: pfad(erwartet), class: 'vg-linie vg-erwartet' }));
  const fadenkreuz = svg('line', { x1: 0, x2: 0, y1: 0, y2: H, class: 'vg-faden', visibility: 'hidden' });
  flaeche.append(fadenkreuz);

  // Tiefpunkt (erster Tag mit dem niedrigsten Stand) als Punkt
  const tiefIndex = werte.indexOf(Math.min(...werte));
  const unterMindest = (cent) => mindestCent != null && cent < mindestCent;
  const tiefPunkt = h('span', { class: 'vg-punkt vg-tief' + (unterMindest(werte[tiefIndex]) ? ' warn' : '') });
  Object.assign(tiefPunkt.style, { left: prozentX(tiefIndex), top: prozentY(werte[tiefIndex]) });
  const zeiger = h('span', { class: 'vg-punkt vg-zeiger', hidden: true });

  const tagText = (i) => (i === 0 ? 'Monatsanfang' : formatDatum(verlauf[i].datum));
  const betrag = (x) => h('span', { class: (x.prognose ? 'annahme' : '') + (unterMindest(x.stand) ? ' warn-text' : '') }, formatEuro(x.stand));
  const info = h('span', { class: 'vg-info' });
  const zeigeInfo = (i) => info.replaceChildren(`${tagText(i)}: `, betrag(verlauf[i]), verlauf[i].prognose ? ' (erwartet)' : '');
  const zeigeTief = () => info.replaceChildren(`Tiefpunkt ${tagText(tiefIndex)}: `, betrag(verlauf[tiefIndex]));
  zeigeTief();

  const zeichnung = h('div', { class: 'vg-zeichnung' }, flaeche, tiefPunkt, zeiger);
  const bewege = (e) => {
    const r = zeichnung.getBoundingClientRect();
    const i = Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) / r.width) * (n - 1))));
    fadenkreuz.setAttribute('x1', xVon(i));
    fadenkreuz.setAttribute('x2', xVon(i));
    fadenkreuz.setAttribute('visibility', 'visible');
    zeiger.hidden = false;
    Object.assign(zeiger.style, { left: prozentX(i), top: prozentY(verlauf[i].stand) });
    zeigeInfo(i);
  };
  zeichnung.addEventListener('pointermove', bewege);
  zeichnung.addEventListener('pointerdown', bewege);
  zeichnung.addEventListener('pointerleave', () => {
    fadenkreuz.setAttribute('visibility', 'hidden');
    zeiger.hidden = true;
    zeigeTief();
  });

  // Achsen als HTML: links die Euro-Stufen, unten die Tagesmarken
  const yAchse = h('div', { class: 'vg-y-achse', 'aria-hidden': 'true' },
    linien.map((w) => {
      const el = h('span', { class: 'vg-y' }, euroKurz(w));
      el.style.top = prozentY(w);
      return el;
    }));
  const xAchse = h('div', { class: 'vg-x-achse', 'aria-hidden': 'true' },
    tagesBeschriftung(letzterTag).filter(({ tag }) => tag < n).map(({ tag, schmal }) => {
      const el = h('span', { class: 'vg-x' + (schmal ? '' : ' nur-breit-x') }, String(tag));
      el.style.left = prozentX(tag);
      return el;
    }));

  return h('div', {
    class: 'verlauf-grafik',
    role: 'img',
    'aria-label': `${beschreibung}: Tiefpunkt ${tagText(tiefIndex)} ${formatEuro(werte[tiefIndex])}` +
      (mindestCent != null ? `, Mindestsaldo ${formatEuro(mindestCent)}` : ''),
  },
  h('div', { class: 'vg-kopf klein' }, info),
  h('div', { class: 'vg-plot' }, yAchse, zeichnung, h('span'), xAchse),
  h('div', { class: 'vg-legende klein' },
    echt.length > 1 && h('span', {}, h('i', { class: 'vg-l-echt' }), 'Stand'),
    erwartet.length > 1 && h('span', {}, h('i', { class: 'vg-l-erwartet' }), 'erwartet'),
    mindestCent != null && h('span', {}, h('i', { class: 'vg-l-mindest' }), `Mindestsaldo ${formatEuro(mindestCent)}`)));
}
