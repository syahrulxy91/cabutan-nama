const { createRequire } = require('node:module');
const { parseArgs } = require('node:util');
const fromFunctions = createRequire(require.resolve('../functions/package.json'));
const { initializeApp, deleteApp } = fromFunctions('firebase-admin/app');
const { FieldPath, getFirestore } = fromFunctions('firebase-admin/firestore');
const { retentionDeadline, setRetention } = require('../functions/retention.cjs');

async function main() {
  const { values } = parseArgs({ options: { project: { type: 'string' }, start: { type: 'string' }, apply: { type: 'boolean' } } });
  const { project, start, apply } = values;
  const startedAt = Date.parse(start);
  if (!/^[a-z][a-z0-9-]{4,29}$/.test(project ?? '') || !/Z$/.test(start ?? '') || !Number.isFinite(startedAt)) {
    throw new Error('Gunakan --project PROJECT_ID --start TARIKH_ISO_UTC [--apply].');
  }
  const expiresAt = retentionDeadline(startedAt);
  if (expiresAt.toMillis() <= Date.now()) throw new Error('Tarikh tamat mesti pada masa hadapan.');

  const app = initializeApp({ projectId: project });
  try {
    const db = getFirestore(app);
    const batch = db.collection('cabutNamaPrograms').orderBy(FieldPath.documentId()).limit(100);
    let cursor;
    let eligible = 0;
    let updated = 0;
    while (true) {
      const page = await (cursor ? batch.startAfter(cursor) : batch).get();
      for (const doc of page.docs) {
        if (doc.get('expiresAt')) continue;
        eligible++;
        if (!apply) continue;
        const changed = await db.runTransaction(async tx => {
          const current = await tx.get(doc.ref);
          if (!current.exists || current.get('expiresAt')) return false;
          setRetention(tx, doc.ref, expiresAt);
          return true;
        });
        if (changed) updated++;
      }
      if (page.size < 100) break;
      cursor = page.docs.at(-1);
    }
    console.log(JSON.stringify({ project, apply: Boolean(apply), expiresAt: expiresAt.toDate().toISOString(), eligible, updated }));
  } finally {
    await deleteApp(app);
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
