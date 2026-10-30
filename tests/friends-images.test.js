// Tests de la liste d'amis : photos de tous les amis lues en un seul list() Blob, réponse inchangée.
process.env.PROXIMITY_RULE_START = '2026-01-01T00:00:00Z';
const test = require('node:test');
const assert = require('node:assert/strict');
const { call } = require('./helpers/fake-server');

// Compte les list() par préfixe (avant de charger les fonctions, qui gardent leur propre référence).
const blob = require('@vercel/blob');
const listed = [];
const realList = blob.list;
blob.list = (opts) => { listed.push(opts?.prefix || ''); return realList(opts); };

const profile = require('../api/profile');
const friends = require('../api/friends');
const { publicId, setProfileImage } = require('../lib/profiles');

const post = (user, action, username) => call(friends, { method: 'POST', user, body: { action, username } });
const jpeg = Buffer.alloc(2000, 1);

test('liste d\'amis : une seule liste des photos, avatars et forme de réponse', async () => {
  await call(profile, { method: 'PUT', user: 'moi', body: { username: 'moi' } });
  for (let i = 0; i < 5; i++) {
    await call(profile, { method: 'PUT', user: `a${i}`, body: { username: `ami_${i}` } });
    await post('moi', 'add', `ami_${i}`);
    await post(`a${i}`, 'add', 'moi');
  }
  await call(profile, { method: 'PUT', user: 'zed', body: { username: 'zed' } });
  await post('zed', 'add', 'moi'); // demande reçue
  await setProfileImage(publicId('a1'), 'avatar', jpeg);
  await setProfileImage(publicId('a1'), 'avatar', jpeg); // remplace la précédente
  await setProfileImage(publicId('a3'), 'banner', jpeg); // bannière seule : pas d'avatar

  listed.length = 0;
  const { status, body } = await call(friends, { user: 'moi' });
  assert.equal(status, 200);
  assert.equal(listed.filter((p) => p.startsWith('profiles/')).length, 1, listed.join(', '));
  assert.deepEqual(Object.keys(body).sort(), ['friends', 'incoming', 'outgoing']);
  assert.deepEqual(body.friends.map((f) => f.username), ['ami_0', 'ami_1', 'ami_2', 'ami_3', 'ami_4']);
  assert.deepEqual(body.incoming, ['zed']);
  const avatars = Object.fromEntries(body.friends.map((f) => [f.username, f.avatar]));
  assert.match(avatars.ami_1, /^https:\/\/blob\.test\/profiles\/.+\/avatar-/);
  assert.equal(avatars.ami_0, null);
  assert.equal(avatars.ami_3, null);
  assert.deepEqual(Object.keys(body.friends[0]).sort(), ['avatar', 'count', 'last', 'username']);
});

test('profil : avatar et bannière inchangés, date d\'inscription toujours fournie', async () => {
  const me = (await call(profile, { user: 'a1' })).body;
  assert.match(me.avatar, /avatar-/);
  assert.equal(me.banner, null);
  assert.ok(me.since);
  assert.equal(me.friends, 1);
});
