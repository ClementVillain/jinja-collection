// Tests de messages.js (sanctuaires envoyés entre amis) : npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../messages.js');

test('identifiant de sanctuaire', () => {
  assert.ok(m.isShrineId('n260408025'));
  assert.ok(!m.isShrineId('N1'));
  assert.ok(!m.isShrineId('n1/../x'));
  assert.ok(!m.isShrineId(42));
  assert.ok(!m.isShrineId(`n${'1'.repeat(30)}`));
});

test('conversation triée, plus ancien d\'abord', () => {
  const out = m.sortThread([
    { shrine: 'b', date: '2026-11-02T00:00:00Z' },
    { shrine: 'a', date: '2026-11-01T00:00:00Z' },
    { shrine: 'c', date: '2026-11-02T00:00:00Z' },
  ]);
  assert.deepEqual(out.map((x) => x.shrine), ['a', 'b', 'c']);
  assert.deepEqual(m.sortThread(undefined), []);
});

test('non-lus : total, par ami, amis retirés ignorés', () => {
  assert.deepEqual(m.unread({ a: 2, b: 1, c: 0 }), { total: 3, byFriend: { a: 2, b: 1 } });
  assert.deepEqual(m.unread({ a: 2, b: 1 }, ['b']), { total: 1, byFriend: { b: 1 } });
  assert.deepEqual(m.unread(null), { total: 0, byFriend: {} });
  assert.equal(m.countLabel(1), '1 sanctuaire');
  assert.equal(m.countLabel(3), '3 sanctuaires');
});
