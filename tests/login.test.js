import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pruefePasswort, baueLogin, passwortStimmt, loginAusStand, LOGIN_ID } from '../js/login.js';

test('Passwortregeln (D83)', () => {
  assert.throws(() => pruefePasswort('kurz'), /mindestens 8/);
  assert.throws(() => pruefePasswort(''), /mindestens 8/);
  assert.throws(() => pruefePasswort(' leerzeichen-vorn'), /Leerzeichen/);
  assert.doesNotThrow(() => pruefePasswort('Test-Passwort 1'));
});

test('Login bauen und prüfen: nur Prüfwert, nie das Passwort', async () => {
  const login = await baueLogin('Beispiel-Passwort', { jetzt: 'T1' });
  assert.equal(login.id, LOGIN_ID);
  assert.equal(login.erstelltAm, 'T1');
  assert.ok(!JSON.stringify(login).includes('Beispiel-Passwort'), 'Passwort steht nirgends im Klartext');
  assert.equal(await passwortStimmt('Beispiel-Passwort', login), true);
  assert.equal(await passwortStimmt('beispiel-passwort', login), false, 'Groß/klein zählt');
  assert.equal(await passwortStimmt('Beispiel-Passwort', null), false, 'ohne Login nie richtig');

  // Ändern: neues Salz, erstelltAm bleibt, altes Passwort gilt nicht mehr
  const neu = await baueLogin('Anderes-Passwort', { alt: login, jetzt: 'T2' });
  assert.equal(neu.erstelltAm, 'T1');
  assert.equal(neu.geaendertAm, 'T2');
  assert.notEqual(neu.passwort.salz, login.passwort.salz);
  assert.equal(await passwortStimmt('Beispiel-Passwort', neu), false);
  assert.equal(await passwortStimmt('Anderes-Passwort', neu), true);
});

test('Login aus einem Datenstand (z. B. Google Drive) lesen', async () => {
  const login = await baueLogin('Beispiel-Passwort');
  assert.equal(loginAusStand({ einstellungen: [{ id: 'hinweise' }, login] }), login);
  assert.equal(loginAusStand({ einstellungen: [{ id: 'hinweise' }] }), null);
  assert.equal(loginAusStand(null), null);
});
