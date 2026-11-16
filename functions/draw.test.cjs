const assert = require('node:assert/strict');
const test = require('node:test');
const { makeMatches, drawStatus, newRound } = require('./draw.cjs');

test('sets a different and unique recipient for every odd and even roster size', () => {
  for (const size of [2, 3, 4, 5, 19, 20, 249, 250]) {
    for (let i = 0; i < 64; i++) {
      const result = makeMatches(size);
      assert.equal(new Set(result).size, size);
      assert.ok(result.every((recipient, row) => recipient >= 0 && recipient < size && recipient !== row));
    }
  }
});

test('rejects rosters with fewer than two names and supports resetting the list', () => {
  assert.throws(() => makeMatches(1), RangeError);
  assert.deepEqual(newRound([], 100).matches, []);
});

test('automatically confirms at the stored deadline without altering the recipient', () => {
  const draw = { recipient: 2, revealAt: 2000, confirmBy: 12000, confirmedAt: null };
  assert.equal(drawStatus(undefined, 12000), 'named');
  assert.equal(drawStatus(draw, 11999), 'pending');
  assert.equal(drawStatus(draw, 12000), 'confirmed');
  assert.equal(draw.recipient, 2);
  assert.equal(drawStatus({ ...draw, confirmedAt: 2300 }, 2300), 'confirmed');
});
