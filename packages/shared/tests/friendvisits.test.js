// Tests de friendvisits.js (visites des amis sur la carte) : npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fv = require('../friendvisits.js');

const v = (username, date) => ({ username, avatar: null, date });

test('3 avatars au plus, puis « +N »', () => {
  const five = ['a', 'b', 'c', 'd', 'e'].map((u) => v(u, '2026-10-01T00:00:00Z'));
  assert.deepEqual(fv.stack(five).shown.map((x) => x.username), ['a', 'b', 'c']);
  assert.equal(fv.stack(five).more, 2);
  assert.equal(fv.stack(five.slice(0, 2)).more, 0);
  assert.deepEqual(fv.stack(undefined), { shown: [], more: 0 });
});

test('zone affichée, zoom minimal, plafond et filtre', () => {
  const pos = { n1: { lat: 35, lon: 135 }, n2: { lat: 35.1, lon: 135.1 }, far: { lat: 43, lon: 141 } };
  const shrines = { n1: [v('a', '2026-01-01')], n2: [v('a', '2026-01-01'), v('b', '2026-01-02')], far: [v('a', '2026-01-01')], gone: [v('a', '2026-01-01')] };
  const bounds = { west: 134, south: 34, east: 136, north: 36 };
  const position = (id) => pos[id];
  assert.deepEqual(fv.visible(shrines, position, bounds, { zoom: 12 }), ['n2', 'n1']);
  assert.deepEqual(fv.visible(shrines, position, bounds, { zoom: 10 }), []);
  assert.deepEqual(fv.visible(shrines, position, bounds, { zoom: 12, limit: 1 }), ['n2']);
  assert.deepEqual(fv.visible(shrines, position, bounds, { zoom: 12, keep: (id) => id !== 'n2' }), ['n1']);
  assert.deepEqual(fv.visible(null, position, bounds, { zoom: 12 }), []);
});

test('nouvelles visites depuis le dernier passage', () => {
  const shrines = { x: [v('a', '2026-10-03T10:00:00Z'), v('b', '2026-09-01T00:00:00Z')], y: [v('a', '2026-10-02T00:00:00Z')] };
  assert.deepEqual(fv.newVisits(shrines, '2026-10-01T00:00:00Z'), { total: 2, byFriend: { a: 2 } });
  assert.deepEqual(fv.newVisits(shrines, null), { total: 0, byFriend: {} });
  assert.equal(fv.newVisits(shrines, '2026-11-01T00:00:00Z').total, 0);
});

test('liste en français et initiale', () => {
  assert.equal(fv.joinFr(['a']), 'a');
  assert.equal(fv.joinFr(['a', 'b']), 'a et b');
  assert.equal(fv.joinFr(['a', 'b', 'c']), 'a, b et c');
  assert.equal(fv.initial('kenji'), 'K');
  assert.equal(fv.initial(''), '?');
});
