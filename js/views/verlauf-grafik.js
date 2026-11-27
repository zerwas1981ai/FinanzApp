// D251: Kleine Verlaufsgrafik im Kontokopf – echter Stand bis gestern (durchgezogen), erwarteter Stand ab heute
// (gestrichelt) für den gewählten Monat, dazu die Linie des Mindestsaldos mit getönter Fläche darunter.
// Antippen/Überfahren zeigt Tag und Stand; ohne Zeiger steht dort der Tiefpunkt.
// Die Zeichenfläche wird in der Breite gestreckt (preserveAspectRatio="none"); Texte und Punkte liegen daher als
// HTML darüber, damit sie nicht verzerrt werden.

import { h } from '../dom.js';
import { formatEuro, formatDatum } from '../format.js';

const B = 300; // Breite der Zeichenfläche (Einheiten)
const H = 80;  // Höhe

/**
 * verlauf: [{ datum, stand, prognose }] aus kopfWerte (Index 0 = Ende des Vortags, also Monatsanfang)
 * mindestCent: Mindestsaldo des Kontos oder null
 */
export function verlaufGrafik(verlauf, mindestCent) {
  if (!verlauf?.length) return null;
  const werte = verlauf.map((x) => x.stand);
  let min = Math.min(...werte, ...(mindestCent != null ? [mindestCent] : []));
  let max = Math.max(...werte, ...(mindestCent != null ? [mindestCent] : []));
  if (max === min) { max += 100; min -= 100; }
  const rand = (max - min) * 0.12;
  min -= rand;
  max += rand;
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
  // Mindestsaldo: getönte Fläche darunter und gestrichelte Linie
  if (mindestCent != null && mindestCent > min) {
    const y = Math.min(H, yVon(mindestCent));
    flaeche.append(svg('rect', { x: 0, y, width: B, height: H - y, class: 'vg-unter-mindest' }));
    flaeche.append(svg('line', { x1: 0, x2: B, y1: y, y2: y, class: 'vg-mindest' }));
  }
  if (min < 0 && max > 0) flaeche.append(svg('line', { x1: 0, x2: B, y1: yVon(0), y2: yVon(0), class: 'vg-null' }));
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
  const tiefPunkt = h('span', { class: 'vg-punkt vg-tief' + (mindestCent != null && werte[tiefIndex] < mindestCent ? ' warn' : '') });
  Object.assign(tiefPunkt.style, { left: prozentX(tiefIndex), top: prozentY(werte[tiefIndex]) });
  const zeiger = h('span', { class: 'vg-punkt vg-zeiger', hidden: true });

  const tagText = (i) => (i === 0 ? 'Monatsanfang' : formatDatum(verlauf[i].datum));
  const info = h('span', { class: 'vg-info' });
  const zeigeInfo = (i) => {
    const x = verlauf[i];
    info.replaceChildren(`${tagText(i)}: `,
      h('span', { class: (x.prognose ? 'annahme' : '') + (mindestCent != null && x.stand < mindestCent ? ' warn-text' : '') }, formatEuro(x.stand)),
      x.prognose ? ' (erwartet)' : '');
  };
  const zeigeTief = () => {
    info.replaceChildren('Tiefpunkt ', tagText(tiefIndex), ': ',
      h('span', { class: (verlauf[tiefIndex].prognose ? 'annahme' : '') + (mindestCent != null && werte[tiefIndex] < mindestCent ? ' warn-text' : '') },
        formatEuro(werte[tiefIndex])));
  };
  zeigeTief();

  const zeichnung = h('div', { class: 'vg-zeichnung' }, flaeche, tiefPunkt, zeiger,
    h('span', { class: 'vg-y vg-y-oben' }, formatEuro(Math.max(...werte))),
    h('span', { class: 'vg-y vg-y-unten' }, formatEuro(Math.min(...werte))));
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

  const letzterTag = Number(verlauf[n - 1].datum.slice(8, 10));
  return h('div', {
    class: 'verlauf-grafik',
    role: 'img',
    'aria-label': `Verlauf des Kontostands im Monat: Tiefpunkt ${tagText(tiefIndex)} ${formatEuro(werte[tiefIndex])}` +
      (mindestCent != null ? `, Mindestsaldo ${formatEuro(mindestCent)}` : ''),
  },
  h('div', { class: 'vg-kopf klein' }, info),
  zeichnung,
  h('div', { class: 'vg-x klein' }, h('span', {}, '1.'), h('span', {}, '15.'), h('span', {}, `${letzterTag}.`)),
  h('div', { class: 'vg-legende klein' },
    echt.length > 1 && h('span', {}, h('i', { class: 'vg-l-echt' }), 'Stand'),
    erwartet.length > 1 && h('span', {}, h('i', { class: 'vg-l-erwartet' }), 'erwartet'),
    mindestCent != null && h('span', {}, h('i', { class: 'vg-l-mindest' }), `Mindestsaldo ${formatEuro(mindestCent)}`)));
}
