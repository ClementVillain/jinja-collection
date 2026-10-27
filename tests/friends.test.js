// Tests de api/friends.js : demande, acceptation, collection d'un ami, retrait.
process.env.PROXIMITY_RULE_START = '2026-01-01T00:00:00Z';
const test = require('node:test');
const assert = require('node:assert/strict');
const { blobs, call } = require('./helpers/fake-server');
const profile = require('../api/profile');
const friends = require('../api/friends');
const sync = require('../api/sync');

const SHRINE = 'n260408025';
const ago = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
const post = (user, action, username) => call(friends, { method: 'POST', user, body: { action, username } });

test('amis : demande, acceptation, collection, retrait', async () => {
  assert.equal((await call(friends, { user: 'aki' })).status, 403); // pas encore de nom
  await call(profile, { method: 'PUT', user: 'aki', body: { username: 'aki' } });
  await call(profile, { method: 'PUT', user: 'ben', body: { username: 'ben' } });
  await call(sync, { method: 'PUT', user: 'ben', body: {
    visits: {
      [SHRINE]: { date: ago(1), note: 'secret', proof: { lat: 35.667, lon: 139.757, at: ago(2) } },
      w123: { date: '2025-01-01T00:00:00.000Z', note: '' },
    },
    deleted: {}, wishlist: {}, wishDeleted: {},
  } });

  assert.equal((await post('aki', 'add', 'personne')).status, 404);
  assert.equal((await post('aki', 'add', 'aki')).status, 400);
  assert.equal((await post('aki', 'add', 'BEN')).status, 200);
  assert.deepEqual((await call(friends, { user: 'aki' })).body, { friends: [], incoming: [], outgoing: ['ben'] });
  assert.deepEqual((await call(friends, { user: 'ben' })).body.incoming, ['aki']);
  // Pas encore amis : collection invisible.
  assert.equal((await call(friends, { user: 'aki', query: { user: 'ben' } })).status, 404);

  await post('ben', 'add', 'aki'); // acceptation
  const list = (await call(friends, { user: 'aki' })).body;
  assert.equal(list.friends.length, 1);
  assert.equal(list.friends[0].username, 'ben');
  assert.equal(list.friends[0].count, 2);
  assert.equal(list.friends[0].last.id, SHRINE);
  const col = (await call(friends, { user: 'aki', query: { user: 'ben' } })).body;
  assert.deepEqual(Object.keys(col.visits).sort(), [SHRINE, 'w123'].sort());
  // Ni note, ni position, ni e-mail / identifiant dans la réponse.
  assert.ok(!/secret|139\.757|example|"sub"/.test(JSON.stringify(col)), JSON.stringify(col));

  await post('ben', 'remove', 'aki');
  assert.deepEqual((await call(friends, { user: 'aki' })).body, { friends: [], incoming: [], outgoing: [] });
  assert.equal([...blobs.keys()].filter((p) => p.startsWith('friends/')).length, 0);
});

test('refus d\'une demande reçue', async () => {
  await call(profile, { method: 'PUT', user: 'cho', body: { username: 'cho' } });
  await call(profile, { method: 'PUT', user: 'dai', body: { username: 'dai' } });
  await post('cho', 'add', 'dai');
  await post('dai', 'remove', 'cho');
  assert.deepEqual((await call(friends, { user: 'cho' })).body.outgoing, []);
});
