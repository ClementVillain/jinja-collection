// Tests de api/messages.js : envoi entre amis, refus, conversation, non-lus.
const test = require('node:test');
const assert = require('node:assert/strict');
const { blobs, call } = require('./helpers/fake-server');
const profile = require('../api/profile');
const friends = require('../api/friends');
const messages = require('../api/messages');

const SHRINE = 'n260408025';
const OTHER = 'n192105120';
const befriend = (a, b) => call(friends, { method: 'POST', user: a, body: { action: 'add', username: b } });
const sendTo = (user, username, shrine) => call(messages, { method: 'POST', user, body: { username, shrine } });

test('messages : envoi, refus, conversation et non-lus', async () => {
  for (const u of ['emi', 'fuj', 'gen']) await call(profile, { method: 'PUT', user: u, body: { username: u } });
  await befriend('emi', 'fuj');

  // Demande pas encore acceptée : refusé.
  assert.equal((await sendTo('emi', 'fuj', SHRINE)).status, 403);
  await befriend('fuj', 'emi');
  assert.equal((await sendTo('emi', 'personne', SHRINE)).status, 404);
  assert.equal((await sendTo('emi', 'gen', SHRINE)).status, 403); // pas amis
  assert.equal((await sendTo('emi', 'fuj', 'x')).status, 400);
  assert.equal((await sendTo('emi', 'fuj', 'n1')).status, 400); // forme valide mais inconnu
  assert.equal((await sendTo('emi', 'fuj', '../n1')).status, 400);
  assert.equal((await call(messages, { user: 'gen', query: { user: 'emi' } })).status, 403);

  // Deux fois le même sanctuaire : deux envois.
  assert.equal((await sendTo('emi', 'fuj', SHRINE)).status, 200);
  assert.equal((await sendTo('emi', 'fuj', SHRINE)).status, 200);
  assert.equal((await sendTo('fuj', 'EMI', OTHER)).status, 200);

  assert.deepEqual((await call(messages, { user: 'fuj' })).body, { unread: { emi: 2 } });
  assert.deepEqual((await call(messages, { user: 'emi' })).body, { unread: { fuj: 1 } });

  const conv = (await call(messages, { user: 'fuj', query: { user: 'emi' } })).body;
  assert.equal(conv.username, 'emi');
  assert.deepEqual(conv.messages.map((m) => [m.shrine, m.mine]), [[SHRINE, false], [SHRINE, false], [OTHER, true]]);
  assert.ok(conv.messages.every((m, i, all) => !i || all[i - 1].date <= m.date));
  // Ouverte : lue. Ni e-mail ni identifiant dans les réponses.
  assert.deepEqual((await call(messages, { user: 'fuj' })).body, { unread: {} });
  assert.ok(!/example|"sub"|_/.test(JSON.stringify(conv)), JSON.stringify(conv));

  // Ami retiré : conversation masquée, envois refusés, non-lus ignorés.
  await call(friends, { method: 'POST', user: 'fuj', body: { action: 'remove', username: 'emi' } });
  assert.equal((await call(messages, { user: 'emi', query: { user: 'fuj' } })).status, 403);
  assert.equal((await sendTo('emi', 'fuj', SHRINE)).status, 403);
  assert.deepEqual((await call(messages, { user: 'emi' })).body, { unread: {} });
  assert.ok([...blobs.keys()].some((p) => p.startsWith('messages/'))); // historique gardé
});

test('messages : nom d\'utilisateur et connexion requis', async () => {
  assert.equal((await call(messages, {})).status, 401);
  assert.equal((await call(messages, { user: 'hana' })).status, 403);
});
