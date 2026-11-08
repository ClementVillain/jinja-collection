// Tests de GET /api/friends?visits=1 : amis par sanctuaire (noms et photos seulement),
// photos lues en un seul list() Blob, ami sans collection ou illisible ignoré.
process.env.PROXIMITY_RULE_START = '2026-01-01T00:00:00Z';
const test = require('node:test');
const assert = require('node:assert/strict');
const { blobs, call } = require('./helpers/fake-server');

// Compte les list() par préfixe (avant de charger les fonctions, qui gardent leur propre référence).
const blob = require('@vercel/blob');
const listed = [];
const realList = blob.list;
blob.list = (opts) => { listed.push(opts?.prefix || ''); return realList(opts); };

const profile = require('../api/profile');
const friends = require('../api/friends');
const { publicId, setProfileImage } = require('../lib/profiles');
const { writeShared } = require('../lib/friends');

const post = (user, action, username) => call(friends, { method: 'POST', user, body: { action, username } });
const jpeg = Buffer.alloc(2000, 1);

test('visites des amis par sanctuaire', async () => {
  await call(profile, { method: 'PUT', user: 'moi', body: { username: 'moi' } });
  for (const [sub, name] of [['a', 'aki'], ['b', 'ben'], ['c', 'chie'], ['d', 'dan']]) {
    await call(profile, { method: 'PUT', user: sub, body: { username: name } });
    await post('moi', 'add', name);
    if (sub !== 'd') await post(sub, 'add', 'moi'); // dan : demande seulement, pas encore ami
  }
  await call(profile, { method: 'PUT', user: 'x', body: { username: 'inconnu' } });
  await setProfileImage(publicId('a'), 'avatar', jpeg);
  await writeShared(publicId('moi'), { n1: { date: '2026-10-05T00:00:00Z' } });
  await writeShared(publicId('a'), { n1: { date: '2026-10-01T00:00:00Z', note: 'secret' }, n2: { date: '2026-10-02T00:00:00Z' } });
  await writeShared(publicId('b'), { n1: { date: '2026-10-03T00:00:00Z' } });
  await writeShared(publicId('d'), { n3: { date: '2026-10-03T00:00:00Z' } });
  await writeShared(publicId('x'), { n4: { date: '2026-10-03T00:00:00Z' } });
  // chie n'a pas de collection partagée.

  listed.length = 0;
  const { status, body } = await call(friends, { user: 'moi', query: { visits: '1' } });
  assert.equal(status, 200);
  assert.equal(listed.filter((p) => p.startsWith('profiles/')).length, 1, listed.join(', '));
  assert.deepEqual(Object.keys(body), ['shrines']);
  assert.deepEqual(Object.keys(body.shrines).sort(), ['n1', 'n2']);
  assert.deepEqual(body.shrines.n1.map((v) => v.username), ['ben', 'aki']); // plus récente d'abord, pas moi
  assert.match(body.shrines.n1[1].avatar, /avatar-/);
  assert.equal(body.shrines.n1[0].avatar, null);
  assert.deepEqual(Object.keys(body.shrines.n1[0]).sort(), ['avatar', 'date', 'username']);
  assert.ok(!JSON.stringify(body).includes('secret'));
});

test('collection d\'un ami illisible : ignorée, les autres restent', async () => {
  const shared = [...blobs.keys()].find((p) => p.startsWith(`shared/${publicId('b')}/`));
  blobs.get(shared).body = 'pas du json';
  const { status, body } = await call(friends, { user: 'moi', query: { visits: '1' } });
  assert.equal(status, 200);
  assert.deepEqual(body.shrines.n1.map((v) => v.username), ['aki']);
});

test('sans nom d\'utilisateur : 403 ; réponses existantes inchangées', async () => {
  assert.equal((await call(friends, { user: 'sans_nom', query: { visits: '1' } })).status, 403);
  const { body } = await call(friends, { user: 'moi' });
  assert.deepEqual(Object.keys(body).sort(), ['friends', 'incoming', 'outgoing']);
  assert.deepEqual(body.friends.map((f) => f.username), ['aki', 'ben', 'chie']);
});
