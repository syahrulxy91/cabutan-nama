const { Timestamp } = require('firebase-admin/firestore');

const retentionMs = 30 * 24 * 60 * 60 * 1000;
const queueName = 'cabutNamaRetention';
const retentionDeadline = start => Timestamp.fromMillis(start + retentionMs);
const expiryMillis = program => program.expiresAt?.toMillis() ?? null;
const isExpired = (program, now) => {
  const expiry = expiryMillis(program);
  return expiry !== null && now >= expiry;
};

function setRetention(tx, program, expiresAt) {
  tx.update(program, { expiresAt, retentionMigrated: true });
  tx.set(program.firestore.collection(queueName).doc(program.id), { expiresAt });
}

async function purgeExpiredPrograms(db, now = Date.now()) {
  const jobs = await db.collection(queueName)
    .where('expiresAt', '<=', Timestamp.fromMillis(now)).orderBy('expiresAt').limit(20).get();
  let purged = 0;
  let failed = 0;
  for (const job of jobs.docs) {
    const program = db.collection('cabutNamaPrograms').doc(job.id);
    try {
      const head = await program.get();
      if (head.exists && !isExpired(head.data(), now)) continue;
      // The queue lives outside the program so a partial delete can be retried.
      await db.recursiveDelete(program);
      await job.ref.delete();
      purged++;
    } catch {
      failed++;
    }
  }
  return { purged, failed };
}

module.exports = { expiryMillis, isExpired, purgeExpiredPrograms, queueName, retentionDeadline, setRetention };
