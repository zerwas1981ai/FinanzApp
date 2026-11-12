// D165: Monatsnotiz bauen und prüfen – reine Funktion, mit `npm test` geprüft.

/** Liefert den Datensatz oder null (leerer Text = Notiz löschen). */
export function baueMonatsnotiz(monat, text, { alt = null, jetzt = new Date().toISOString() } = {}) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monat)) throw new Error('Ungültiger Monat.');
  const sauber = String(text ?? '').trim().replace(/\s+/g, ' ').slice(0, 200);
  if (!sauber) return null;
  return { id: monat, text: sauber, erstelltAm: alt?.erstelltAm ?? jetzt, geaendertAm: jetzt };
}
