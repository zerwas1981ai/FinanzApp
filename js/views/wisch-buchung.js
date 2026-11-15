// D211: Buchungen in Listen wischen (Handy): nach rechts = in den Papierkorb (mit Rückfrage und „Rückgängig“),
// nach links = Kopie mit heutigem Datum. Ereignisse werden am Listen-Container abgefangen (auch für später
// nachgeladene Zeilen). Jede Zeile braucht li[data-bid] mit der Buchungs-ID; bewegt wird ihr erstes Kind.

import { frage, toast, datenGeaendert } from '../ui.js';
import { heuteIso } from '../format.js';
import { gruppeVon, inPapierkorb, wiederherstellen } from '../buchungen.js';
import { oeffneBuchungsdialog } from './buchung-dialog.js';

const SCHWELLE = 90; // Pixel, ab denen die Aktion ausgelöst wird
const eingerichtet = new WeakSet();

async function loeschen(b, alle) {
  if (b.archivJahr) { toast(`Archiv ${b.archivJahr}: nur lesen.`); return; }
  const name = b.partner || b.notiz || (b.art === 'umbuchung' ? 'Umbuchung' : 'Buchung');
  const ok = await frage({ titel: 'In den Papierkorb?', text: `„${name}“ vom ${b.datum.slice(8, 10)}.${b.datum.slice(5, 7)}. kommt in den Papierkorb.`, jaText: 'In den Papierkorb', gefahr: true });
  if (!ok) return;
  const gruppe = gruppeVon(b, alle);
  await inPapierkorb(gruppe);
  toast('In den Papierkorb gelegt', {
    aktion: 'Rückgängig',
    beiAktion: async () => { await wiederherstellen(gruppe); toast('Wiederhergestellt'); datenGeaendert(); },
  });
  datenGeaendert();
}

function kopieren(b, alle) {
  // Bei Umbuchungen immer die abgehende Hälfte als Vorlage (Von-Konto → Auf-Konto)
  const q = b.art === 'umbuchung' ? (gruppeVon(b, alle).find((x) => x.richtung === 'ab') ?? b) : b;
  oeffneBuchungsdialog(null, {
    art: q.art, betragCent: q.betragCent, kontoId: q.kontoId,
    gegenkontoId: q.art === 'umbuchung' ? q.gegenkontoId : undefined,
    budgetKategorieId: q.art === 'umbuchung' ? q.budgetKategorieId ?? null : undefined,
    kategorieId: q.art === 'umbuchung' ? undefined : q.kategorieId ?? undefined,
    partner: q.partner ?? '', notiz: q.notiz ?? '', projektId: q.projektId ?? null,
    relevant: Boolean(q.relevant), relevantGruppe: q.relevantGruppe ?? '', vertragId: q.vertragId ?? null,
    datum: heuteIso(), titel: 'Kopie der Buchung',
  });
}

/** Wischen für alle Buchungszeilen in `root` einrichten. holeBuchungen(): aktuelle Liste aller Buchungen. */
export function buchungenWischbar(root, holeBuchungen) {
  if (eingerichtet.has(root)) return;
  eingerichtet.add(root);
  let s = null; // { li, ziel, x, y, dx, aktiv }
  const zuruecksetzen = (li, ziel) => {
    ziel.style.transition = 'transform .15s ease';
    ziel.style.transform = '';
    setTimeout(() => { ziel.style.transition = ''; li.classList.remove('wisch-aktiv', 'wisch-bereit'); delete li.dataset.richtung; }, 170);
  };
  root.addEventListener('touchstart', (e) => {
    const li = e.touches.length === 1 && e.target.closest('li[data-bid]');
    if (!li || !root.contains(li) || e.target.closest('.marke-ungewoehnlich')) { s = null; return; }
    const t = e.touches[0];
    s = { li, ziel: li.firstElementChild, x: t.clientX, y: t.clientY, dx: 0, aktiv: false };
  }, { passive: true });
  root.addEventListener('touchmove', (e) => {
    if (!s) return;
    const t = e.touches[0];
    const mx = t.clientX - s.x;
    const my = t.clientY - s.y;
    if (!s.aktiv) {
      if (Math.abs(my) > 12 && Math.abs(my) > Math.abs(mx)) { s = null; return; } // senkrecht: normales Scrollen
      if (Math.abs(mx) < 12) return;
      s.aktiv = true;
      s.li.classList.add('wisch-aktiv');
    }
    s.dx = mx;
    s.ziel.style.transform = `translateX(${mx}px)`;
    s.li.dataset.richtung = mx > 0 ? 'rechts' : 'links';
    s.li.classList.toggle('wisch-bereit', Math.abs(mx) > SCHWELLE);
  }, { passive: true });
  root.addEventListener('touchend', () => {
    if (!s) return;
    const { li, ziel, dx, aktiv } = s;
    s = null;
    if (!aktiv) return;
    zuruecksetzen(li, ziel);
    // den Klick, den manche Browser nach dem Wischen noch auslösen, verschlucken
    li.dataset.geradeGewischt = '1';
    setTimeout(() => { delete li.dataset.geradeGewischt; }, 400);
    if (Math.abs(dx) <= SCHWELLE) return;
    const alle = holeBuchungen() ?? [];
    const b = alle.find((x) => x.id === li.dataset.bid);
    if (!b) return;
    if (dx > 0) loeschen(b, alle); else kopieren(b, alle);
  });
  root.addEventListener('touchcancel', () => { if (s?.aktiv) zuruecksetzen(s.li, s.ziel); s = null; });
  root.addEventListener('click', (e) => {
    if (e.target.closest('li[data-gerade-gewischt]')) { e.stopPropagation(); e.preventDefault(); }
  }, true);
}
