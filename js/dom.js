// Kleiner Helfer, um HTML-Elemente sicher zu erzeugen.
// Texte werden immer als Text eingefügt (nie als HTML) – so können Namen wie
// "<b>Konto</b>" nichts Unerwartetes anrichten.
//
// Beispiel: h('button', { class: 'knopf', onclick: () => ... }, 'Speichern')

export function h(tag, attribute = {}, ...kinder) {
  const el = document.createElement(tag);
  for (const [name, wert] of Object.entries(attribute ?? {})) {
    if (wert === null || wert === undefined || wert === false) continue;
    if (name.startsWith('on') && typeof wert === 'function') {
      el.addEventListener(name.slice(2), wert);
    } else if (name === 'class') {
      el.className = wert;
    } else if (wert === true) {
      el.setAttribute(name, '');
    } else {
      el.setAttribute(name, String(wert));
    }
  }
  for (const kind of kinder.flat(Infinity)) {
    if (kind === null || kind === undefined || kind === false) continue;
    el.append(kind instanceof Node ? kind : String(kind));
  }
  return el;
}
