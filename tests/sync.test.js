// Tests de api/sync.js : règle de proximité (1 km dans les 48 h) vérifiée par le serveur.
process.env.PROXIMITY_RULE_START = '2026-01-01T00:00:00Z';
const test = require('node:test');
const assert = require('node:assert/strict');
const { call } = require('./helpers/fake-server');
const sync = require('../api/sync');
const prox = require('../proximity');

// 烏森神社 (Shinbashi) : 35.6668, 139.75682
const SHRINE = 'n260408025';
const ago = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
const state = (visits) => ({ visits, deleted: {}, wishlist: {}, wishDeleted: {} });

test('proximity.js : passages et preuve', () => {
  let list = prox.addSighting([], { lat: 35.67, lon: 139.76, at: ago(50) }); // trop vieux pour une visite maintenant
  list = prox.addSighting(list, { lat: 35.0, lon: 135.0, at: ago(1), acc: 20 });
  assert.equal(prox.findProof(list, { lat: 35.6668, lon: 139.75682 }), null);
  list = prox.addSighting(list, { lat: 35.6700, lon: 139.7600, at: ago(0.5), acc: 30 }); // ~450 m
  assert.deepEqual(prox.findProof(list, { lat: 35.6668, lon: 139.75682 }), { lat: 35.67, lon: 139.76, at: list.at(-1).at });
  // Position trop imprécise : ignorée.
  assert.equal(prox.addSighting([], { lat: 35.67, lon: 139.76, acc: 2000 }).length, 0);
  // Passage à 1,5 km : refusé.
  assert.equal(prox.isProof({ lat: 35.6803, lon: 139.75682, at: ago(1) }, { lat: 35.6668, lon: 139.75682 }, ago(0)), false);
});

test('refuse sans connexion', async () => {
  assert.equal((await call(sync, { method: 'PUT', body: state({}) })).status, 401);
});

test('visite avec preuve valable : vérifiée, preuve gardée', async () => {
  const date = ago(0);
  const r = await call(sync, { method: 'PUT', user: 'alice', body: state({ [SHRINE]: { date, note: '', proof: { lat: 35.668, lon: 139.758, at: ago(20) } } }) });
  assert.equal(r.status, 200);
  assert.equal(r.body.state.visits[SHRINE].verified, true);
  assert.equal(r.body.state.visits[SHRINE].proof.lat, 35.668);
  const g = await call(sync, { user: 'alice' });
  assert.equal(g.body.state.visits[SHRINE].verified, true);
  // Renvoyée plus tard sans preuve (autre appareil) : le statut enregistré est conservé.
  const again = await call(sync, { method: 'PUT', user: 'alice', body: state({ [SHRINE]: { date, note: 'souvenir' } }) });
  assert.equal(again.body.state.visits[SHRINE].verified, true);
  assert.equal(again.body.state.visits[SHRINE].note, 'souvenir');
});

test('preuve trop loin ou trop ancienne : visite marquée non vérifiée', async () => {
  const far = await call(sync, { method: 'PUT', user: 'bob', body: state({ [SHRINE]: { date: ago(0), note: '', proof: { lat: 34.7, lon: 135.5, at: ago(1) } } }) });
  assert.equal(far.body.state.visits[SHRINE].verified, false);
  assert.equal(far.body.state.visits[SHRINE].proof, undefined);
  const old = await call(sync, { method: 'PUT', user: 'carol', body: state({ [SHRINE]: { date: ago(0), note: '', proof: { lat: 35.668, lon: 139.758, at: ago(49) } } }) });
  assert.equal(old.body.state.visits[SHRINE].verified, false);
  const none = await call(sync, { method: 'PUT', user: 'dave', body: state({ [SHRINE]: { date: ago(0), note: '' } }) });
  assert.equal(none.body.state.visits[SHRINE].verified, false);
  // Une preuve valable envoyée ensuite la fait passer en vérifiée.
  const date = none.body.state.visits[SHRINE].date;
  const fixed = await call(sync, { method: 'PUT', user: 'dave', body: state({ [SHRINE]: { date, note: '', proof: { lat: 35.667, lon: 139.757, at: ago(2) } } }) });
  assert.equal(fixed.body.state.visits[SHRINE].verified, true);
});

test('visites antérieures à la règle (migration du navigateur) : restent valides', async () => {
  const r = await call(sync, { method: 'PUT', user: 'erin', body: state({ [SHRINE]: { date: '2025-05-01T10:00:00.000Z', note: 'ancienne' } }) });
  assert.equal(r.body.state.visits[SHRINE].verified, undefined);
  assert.equal(r.body.state.visits[SHRINE].note, 'ancienne');
});
