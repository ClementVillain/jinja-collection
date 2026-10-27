// Tests de api/profile.js et api/discoveries.js : noms uniques et « Découvert par ».
process.env.PROXIMITY_RULE_START = '2026-01-01T00:00:00Z';
const test = require('node:test');
const assert = require('node:assert/strict');
const { blobs, call } = require('./helpers/fake-server');
const profile = require('../api/profile');
const discoveries = require('../api/discoveries');
const sync = require('../api/sync');

const SHRINE = 'n260408025'; // 烏森神社 : 35.6668, 139.75682
const ago = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
const visit = (proof = { lat: 35.667, lon: 139.757, at: ago(1) }) => ({
  visits: { [SHRINE]: { date: ago(0), note: 'note privée', proof } }, deleted: {}, wishlist: {}, wishDeleted: {},
});

test('nom d\'utilisateur : choix, unicité, changement', async () => {
  assert.equal((await call(profile, { user: 'u1' })).body.username, null);
  assert.equal((await call(profile, { method: 'PUT', user: 'u1', body: { username: 'Kitsune' } })).body.username, 'kitsune');
  assert.equal((await call(profile, { user: 'u1' })).body.username, 'kitsune');
  const taken = await call(profile, { method: 'PUT', user: 'u2', body: { username: 'kitsune' } });
  assert.equal(taken.status, 409);
  assert.equal((await call(profile, { method: 'PUT', user: 'u2', body: { username: 'a b' } })).status, 400);
  // Changement de nom : l'ancien est libéré.
  assert.equal((await call(profile, { method: 'PUT', user: 'u1', body: { username: 'tanuki' } })).body.username, 'tanuki');
  assert.equal((await call(profile, { method: 'PUT', user: 'u2', body: { username: 'kitsune' } })).body.username, 'kitsune');
  assert.equal((await call(profile, { user: 'u1' })).body.username, 'tanuki');
  // Aucun identifiant Google ni e-mail dans les chemins publics.
  for (const p of blobs.keys()) assert.ok(!/u1|u2|example/.test(p.replace(/^users\/[0-9a-f]+\//, '')), p);
});

test('revendications simultanées : le plus ancien gagne', async () => {
  const results = await Promise.all(['r1', 'r2'].map((user) => call(profile, { method: 'PUT', user, body: { username: 'tengu' } })));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
});

test('Découvert par : premier visiteur vérifié', async () => {
  await call(profile, { method: 'PUT', user: 'd1', body: { username: 'premier' } });
  await call(profile, { method: 'PUT', user: 'd2', body: { username: 'second' } });
  // Visite non vérifiée (trop loin) : ne compte pas.
  await call(sync, { method: 'PUT', user: 'd3', body: visit({ lat: 34.7, lon: 135.5, at: ago(1) }) });
  assert.equal((await call(discoveries)).body[SHRINE], undefined);
  await call(sync, { method: 'PUT', user: 'd1', body: visit() });
  await call(sync, { method: 'PUT', user: 'd2', body: visit() });
  assert.equal((await call(discoveries)).body[SHRINE], 'premier');
  // Resynchroniser ne change rien ; un changement de nom se reflète.
  await call(sync, { method: 'PUT', user: 'd2', body: visit() });
  await call(profile, { method: 'PUT', user: 'd1', body: { username: 'premier_bis' } });
  assert.equal((await call(discoveries)).body[SHRINE], 'premier_bis');
});
