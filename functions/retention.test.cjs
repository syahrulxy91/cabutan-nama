const assert = require('node:assert/strict');
const test = require('node:test');
const { Timestamp } = require('firebase-admin/firestore');
const { purgeExpiredPrograms } = require('./retention.cjs');

function fakeDb({ programs, jobs, failDelete = new Set() }) {
  const deleted = [];
  const updates = new Map();
  const jobDoc = ([id, data]) => ({
    id, get: key => data[key],
    ref: {
      delete: async () => { jobs.delete(id); },
      set: async value => { updates.set(id, value); },
      update: async value => { updates.set(id, value); }
    }
  });
  return {
    deleted, updates,
    collection(name) {
      if (name === 'cabutNamaPrograms') {
        return { doc: id => ({ id, get: async () => ({ exists: programs.has(id), data: () => programs.get(id), get: key => programs.get(id)?.[key] }) }) };
      }
      return { where: () => ({ orderBy: () => ({ limit: () => ({ get: async () => ({ docs: [...jobs].map(jobDoc) }) }) }) }) };
    },
    async recursiveDelete(ref) {
      if (failDelete.has(ref.id)) throw new Error('quota exceeded');
      deleted.push(ref.id);
    }
  };
}

test('logs failed cleanup jobs and moves them back so they cannot block the queue', async () => {
  const now = 1_000_000;
  const past = Timestamp.fromMillis(now - 1);
  const db = fakeDb({
    programs: new Map([['a', { expiresAt: past }], ['b', { expiresAt: past }], ['c', { expiresAt: Timestamp.fromMillis(now + 5000) }]]),
    jobs: new Map([['a', { expiresAt: past }], ['b', { expiresAt: past }], ['c', { expiresAt: past }]]),
    failDelete: new Set(['b'])
  });
  const logged = [];
  const result = await purgeExpiredPrograms(db, now, detail => logged.push(detail));
  assert.deepEqual(result, { purged: 1, failed: 1, rescheduled: 1 });
  assert.deepEqual(db.deleted, ['a']);
  assert.deepEqual(logged, [{ programId: 'b', error: 'quota exceeded' }]);
  assert.ok(db.updates.get('b').expiresAt.toMillis() > now);
  assert.equal(db.updates.get('b').attempts, 1);
  assert.equal(db.updates.get('c').expiresAt.toMillis(), now + 5000);
});
