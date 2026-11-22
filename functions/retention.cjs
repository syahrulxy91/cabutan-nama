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

const retryDelayMs = 15 * 60 * 1000;

async function purgeExpiredPrograms(db, now = Date.now(), log = () => {}) {
  const jobs = await db.collection(queueName)
    .where('expiresAt', '<=', Timestamp.fromMillis(now)).orderBy('expiresAt').limit(20).get();
  let purged = 0;
  let failed = 0;
  let rescheduled = 0;
  for (const job of jobs.docs) {
    const program = db.collection('cabutNamaPrograms').doc(job.id);
    try {
      const head = await program.get();
      if (head.exists && !isExpired(head.data(), now)) {
        // The program's deadline moved, so move the job too instead of leaving it at the front of the queue.
        const expiresAt = head.get('expiresAt');
        if (expiresAt) await job.ref.set({ expiresAt });
        else await job.ref.delete();
        rescheduled++;
        continue;
      }
      // The queue lives outside the program so a partial delete can be retried.
      await db.recursiveDelete(program);
      await job.ref.delete();
      purged++;
    } catch (error) {
      failed++;
      log({ programId: job.id, error: error?.message ?? String(error) });
      // Push a failing job back so it cannot block the rest of the queue.
      await job.ref.update({ expiresAt: Timestamp.fromMillis(now + retryDelayMs), attempts: (job.get('attempts') ?? 0) + 1 }).catch(() => {});
    }
  }
  return { purged, failed, rescheduled };
}

module.exports = { expiryMillis, isExpired, purgeExpiredPrograms, queueName, retentionDeadline, setRetention };
