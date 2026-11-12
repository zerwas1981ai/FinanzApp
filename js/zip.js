// D167: Kleiner ZIP-Ersteller ohne Fremdbibliothek (Dateien unkomprimiert gespeichert – Belege sind
// als JPG/PDF ohnehin schon komprimiert). Dateinamen in UTF-8 (Umlaute). Reine Funktion, mit `npm test` geprüft.

const CRC_TABELLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(daten) {
  let c = 0xffffffff;
  for (let i = 0; i < daten.length; i++) c = CRC_TABELLE[(c ^ daten[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** dateien: [{ name, daten: Uint8Array }] → Uint8Array (ZIP-Datei) */
export function erzeugeZip(dateien, jetzt = new Date()) {
  const enc = new TextEncoder();
  const zeit = ((jetzt.getHours() << 11) | (jetzt.getMinutes() << 5) | Math.floor(jetzt.getSeconds() / 2)) & 0xffff;
  const datum = (((jetzt.getFullYear() - 1980) << 9) | ((jetzt.getMonth() + 1) << 5) | jetzt.getDate()) & 0xffff;
  const teile = [];
  const verzeichnis = [];
  let versatz = 0;
  for (const d of dateien) {
    const name = enc.encode(d.name);
    const crc = crc32(d.daten);
    const kopf = new DataView(new ArrayBuffer(30));
    kopf.setUint32(0, 0x04034b50, true); // lokaler Dateikopf
    kopf.setUint16(4, 20, true); // benötigte Version
    kopf.setUint16(6, 0x0800, true); // Bit 11: Name in UTF-8
    kopf.setUint16(8, 0, true); // Methode 0 = gespeichert
    kopf.setUint16(10, zeit, true);
    kopf.setUint16(12, datum, true);
    kopf.setUint32(14, crc, true);
    kopf.setUint32(18, d.daten.length, true);
    kopf.setUint32(22, d.daten.length, true);
    kopf.setUint16(26, name.length, true);
    kopf.setUint16(28, 0, true);
    teile.push(new Uint8Array(kopf.buffer), name, d.daten);

    const zentral = new DataView(new ArrayBuffer(46));
    zentral.setUint32(0, 0x02014b50, true);
    zentral.setUint16(4, 20, true);
    zentral.setUint16(6, 20, true);
    zentral.setUint16(8, 0x0800, true);
    zentral.setUint16(10, 0, true);
    zentral.setUint16(12, zeit, true);
    zentral.setUint16(14, datum, true);
    zentral.setUint32(16, crc, true);
    zentral.setUint32(20, d.daten.length, true);
    zentral.setUint32(24, d.daten.length, true);
    zentral.setUint16(28, name.length, true);
    zentral.setUint32(42, versatz, true);
    verzeichnis.push(new Uint8Array(zentral.buffer), name);
    versatz += 30 + name.length + d.daten.length;
  }
  const groesse = verzeichnis.reduce((s, x) => s + x.length, 0);
  const ende = new DataView(new ArrayBuffer(22));
  ende.setUint32(0, 0x06054b50, true);
  ende.setUint16(8, dateien.length, true);
  ende.setUint16(10, dateien.length, true);
  ende.setUint32(12, groesse, true);
  ende.setUint32(16, versatz, true);
  const alle = [...teile, ...verzeichnis, new Uint8Array(ende.buffer)];
  const ergebnis = new Uint8Array(alle.reduce((s, x) => s + x.length, 0));
  let pos = 0;
  for (const x of alle) { ergebnis.set(x, pos); pos += x.length; }
  return ergebnis;
}
