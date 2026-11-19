import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { initializeApp, deleteApp } from '@firebase/app';
import { connectAuthEmulator, getAuth, GoogleAuthProvider, signInWithCredential } from '@firebase/auth';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from '@firebase/functions';

const base = { projectId: 'demo-cabutan-nama', apiKey: 'demo-key' };
const apps = [];
async function client(index, authenticate = true, email = `cabut-ujian-${index}@example.test`) {
  const app = initializeApp(base, 'audit-' + index);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const functions = getFunctions(app, 'asia-southeast1');
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  if (authenticate) {
    const profile = { sub: 'cabut-uid-' + index, email, email_verified: true };
    await signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify(profile)));
  }
  const callable = httpsCallable(functions, 'cabutNama');
  return {
    token: () => auth.currentUser.getIdToken(),
    call: async (action, data) => (await callable({ action, responseVersion: 2, ...data })).data
  };
}

try {
  const [owner, first, second, anonymous] = await Promise.all([client(1), client(2), client(3), client(4, false)]);
  await assert.rejects(anonymous.call('list'), { code: 'functions/unauthenticated' });
  const names = ['Ali', 'Abu', 'Raju'];
  const operationId = '00000000-0000-4000-8000-000000000044';
  const createDetails = { title: 'Ujian operasi berulang', names, operationId };
  const repeated = await Promise.all([owner.call('create', createDetails), owner.call('create', createDetails)]);
  assert.equal(repeated[0].id, repeated[1].id);
  assert.equal((await owner.call('list')).filter(p => p.title === createDetails.title).length, 1);
  await assert.rejects(owner.call('create', { ...createDetails, title: 'Butiran berlainan' }), { code: 'functions/already-exists' });
  await assert.rejects(owner.call('create', { ...createDetails, operationId: 'tidak-sah' }), { code: 'functions/invalid-argument' });
  const secondProgram = await second.call('create', createDetails);
  assert.notEqual(secondProgram.id, repeated[0].id);
  const ownerEntry = await owner.call('coordinator-entry', { id: repeated[0].id });
  assert.deepEqual(ownerEntry.catalog.map(program => program.id), [repeated[0].id]);
  assert.equal(ownerEntry.program.id, repeated[0].id);
  const fallbackEntry = await second.call('coordinator-entry', { id: repeated[0].id });
  assert.deepEqual(fallbackEntry.catalog.map(program => program.id), [secondProgram.id]);
  assert.equal(fallbackEntry.program.id, secondProgram.id);
  assert.notEqual(fallbackEntry.program.id, repeated[0].id);
  const emptyForeignEntry = await first.call('coordinator-entry', { id: repeated[0].id });
  assert.deepEqual(emptyForeignEntry.catalog, []);
  assert.equal(emptyForeignEntry.program, null);
  await assert.rejects(anonymous.call('coordinator-entry', { id: repeated[0].id }), { code: 'functions/unauthenticated' });
  const { id } = await owner.call('create', { title: 'Ujian berbilang akaun', names });
  const state = await owner.call('get', { id, ownerView: true });
  const payload = { id, revision: state.revision };
  const firestore = 'http://127.0.0.1:8080/v1/projects/demo-cabutan-nama/databases/(default)/documents';
  const direct = await fetch(firestore + '/cabutNamaPrograms/' + id, { headers: { Authorization: 'Bearer ' + await first.token() } });
  assert.equal(direct.status, 403);
  await assert.rejects(first.call('get', { id, ownerView: true }), { code: 'functions/permission-denied' });
  await assert.rejects(first.call('rename', { ...payload, title: 'Akses lain' }), { code: 'functions/permission-denied' });
  assert.equal((await first.call('list')).length, 0);
  assert.deepEqual((await second.call('get', { id })).names, names);
  const [claimA, claimB] = await Promise.allSettled([first, second].map(c => c.call('claim', { ...payload, row: 1, expectedName: 'Abu' })));
  assert.equal([claimA, claimB].filter(c => c.status === 'fulfilled').length, 1);
  const [winner, loser] = claimA.status === 'fulfilled' ? [first, second] : [second, first];
  await Promise.all([loser.call('claim', { ...payload, row: 2, expectedName: 'Raju' }), owner.call('claim', { ...payload, row: 0, expectedName: 'Ali', name: 'Ali Uji' })]);
  await assert.rejects(owner.call('draw', { ...payload, agreed: false, confirmedName: 'Ali Uji' }), { code: 'functions/failed-precondition' });
  const draws = await Promise.all([owner, winner, loser, winner].map((c, i) => c.call('draw', { ...payload, agreed: true, confirmedName: ['Ali Uji', 'Abu', 'Raju', 'Abu'][i] })));
  for (const { own, now, records } of draws) {
    assert.equal(own.recipient === null, now < own.revealAt);
    assert.equal(own.recipientName === null, now < own.revealAt);
    assert.equal(records?.length ?? 0, 0);
  }
  assert.equal(draws[1].own.confirmBy, draws[3].own.confirmBy);
  await new Promise(resolve => setTimeout(resolve, Math.max(0, Math.max(...draws.map(d => d.own.revealAt)) - Date.now()) + 100));
  const revealed = await Promise.all([owner, winner, loser].map(c => c.call('get', { id })));
  assert.equal(new Set(revealed.map(d => d.own.recipient)).size, 3);
  assert.ok(revealed.every(d => d.own.recipient !== d.own.row && d.records.length === 0));
  const manual = await owner.call('confirm', payload);
  assert.equal(manual.own.status, 'confirmed');
  assert.equal(manual.own.recipient, revealed[0].own.recipient);
  const recipient = [owner, winner, loser][manual.own.recipient];
  await recipient.call('edit', { ...payload, name: 'Ejaan Dikemas Kini' });
  await assert.rejects(owner.call('edit', { ...payload, name: manual.own.recipientName }), { code: 'functions/invalid-argument' });
  await owner.call('edit', { ...payload, name: 'Ali Dibetulkan' });
  const stable = await owner.call('get', { id });
  assert.equal(stable.own.recipientName, manual.own.recipientName);
  assert.equal(stable.own.giverName, manual.own.giverName);
  assert.equal(stable.own.name, 'Ali Dibetulkan');
  await new Promise(resolve => setTimeout(resolve, Math.max(0, Math.max(...revealed.map(d => d.own.confirmBy)) - Date.now()) + 100));
  const admin = await owner.call('get', { id, ownerView: true });
  assert.equal(admin.confirmed, 3);
  assert.equal(admin.records.length, 3);
  const record = admin.records.find(entry => entry.row === manual.own.row);
  assert.equal(record.recipientName, manual.own.recipientName);
  assert.equal(record.giverName, manual.own.giverName);
  assert.equal((await owner.call('acceptance', payload)).passed, 12);
  await owner.call('reset', payload);
  const reset = await owner.call('get', { id, ownerView: true });
  assert.equal(reset.confirmed, 0);
  assert.notEqual(reset.revision, state.revision);
  assert.equal(reset.expiresAt, state.expiresAt);
  await assert.rejects(winner.call('draw', payload), { code: 'functions/failed-precondition' });
  await assert.rejects(owner.call('create-restricted', {
    title: 'Ujian e-mel berganda', names,
    emails: ['cabut-ujian-1@example.test', 'CABUT-UJIAN-1@example.test', 'cabut-ujian-2@example.test']
  }), { code: 'functions/invalid-argument' });
  const emails = [' CABUT-UJIAN-2@EXAMPLE.TEST ', 'cabut-ujian-3@example.test'];
  const restricted = await owner.call('create-restricted', { title: 'Ujian terhad', names: names.slice(0, 2), emails });
  const restrictedState = await owner.call('get', { ...restricted, ownerView: true });
  const restrictedRound = { ...restricted, revision: restrictedState.revision };
  assert.equal(restrictedState.restricted, true);
  assert.equal(Object.hasOwn(restrictedState, 'emails'), false);
  await assert.rejects(owner.call('get', restricted), { code: 'functions/permission-denied' });
  await assert.rejects(first.call('get', { ...restricted, ownerView: true }), { code: 'functions/permission-denied' });
  const ownRow = await first.call('get', restricted);
  assert.equal(ownRow.eligibleRow, 0);
  assert.deepEqual(ownRow.names, ['Ali', null]);
  assert.equal(Object.hasOwn(ownRow, 'emails'), false);
  await assert.rejects(first.call('claim', { ...restrictedRound, row: 1, expectedName: 'Abu' }), { code: 'functions/permission-denied' });
  const eligible = await first.call('claim', { ...restrictedRound, row: 0, expectedName: 'Ali' });
  assert.equal(eligible.own.row, 0);
  const repeatClaim = await first.call('claim', { ...restrictedRound, row: 0, expectedName: 'Ali' });
  assert.equal(repeatClaim.own.row, 0);
  const sealed = await first.call('draw', { ...restrictedRound, agreed: true, confirmedName: 'Ali' });
  await new Promise(resolve => setTimeout(resolve, Math.max(0, sealed.own.revealAt - Date.now()) + 100));
  const disclosed = await first.call('get', restricted);
  assert.deepEqual(disclosed.names, ['Ali', null]);
  assert.equal(disclosed.own.recipientName, 'Abu');
  await owner.call('reset', restrictedRound);
  const restarted = await first.call('get', restricted);
  assert.equal(restarted.restricted, true);
  assert.equal(restarted.own, null);
  await owner.call('reset-list', { ...restricted, revision: restarted.revision });
  const empty = await owner.call('get', { ...restricted, ownerView: true });
  assert.equal(empty.restricted, true);
  assert.equal(empty.names.length, 0);
  await assert.rejects(first.call('get', restricted), { code: 'functions/permission-denied' });
  await assert.rejects(owner.call('replace', { ...restricted, revision: empty.revision, names: names.slice(0, 2) }),
    { code: 'functions/failed-precondition' });
  await owner.call('replace-restricted', { ...restricted, revision: empty.revision, names: names.slice(0, 2), emails });
  const reopened = await first.call('get', restricted);
  assert.equal(reopened.restricted, true);
  assert.equal(reopened.eligibleRow, 0);
  const gmail = 'cabutnama-emulator-ujian-peribadi@gmail.com';
  const personal = await client('gmail', true, gmail);
  const personalProgram = await owner.call('create-restricted', { title: 'Gmail peribadi', names: names.slice(0, 2), emails: [gmail, emails[1]] });
  const personalState = await personal.call('get', personalProgram);
  assert.equal(personalState.eligibleRow, 0);
  assert.equal(personalState.names[0], 'Ali');
  await personal.call('claim', { ...personalProgram, revision: personalState.revision, row: 0, expectedName: 'Ali' });
  const require = createRequire(new URL('../functions/package.json', import.meta.url));
  const { initializeApp: initializeAdmin, deleteApp: deleteAdmin } = require('firebase-admin/app');
  const { getFirestore, Timestamp } = require('firebase-admin/firestore');
  const { purgeExpiredPrograms, queueName, retentionDeadline } = require('./retention.cjs');
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  const adminApp = initializeAdmin({ projectId: base.projectId }, 'legacy-test');
  try {
    const db = getFirestore(adminApp);
    const ownerUid = JSON.parse(Buffer.from((await owner.token()).split('.')[1], 'base64url').toString()).user_id;
    const creationQuota = db.collection('cabutNamaQuotas').doc(`create-${ownerUid}`);
    await creationQuota.set({ window: Math.floor(Date.now() / 86_400_000), count: 30 });
    await assert.rejects(owner.call('create', { title: 'Had program', names }), { code: 'functions/resource-exhausted' });
    assert.equal((await owner.call('create', createDetails)).id, repeated[0].id);
    await creationQuota.delete();
    const readQuota = db.collection('cabutNamaQuotas').doc(`read-${ownerUid}`);
    const readWindow = Math.floor(Date.now() / 60_000);
    await readQuota.set({ window: readWindow, count: 120 });
    await assert.rejects(owner.call('get', { id, ownerView: true }), { code: 'functions/resource-exhausted' });
    await readQuota.set({ window: readWindow, count: 119 });
    await assert.rejects(owner.call('coordinator-entry', { id }), { code: 'functions/resource-exhausted' });
    await readQuota.set({ window: readWindow, count: 118 });
    const quotaEntry = await owner.call('coordinator-entry', { id });
    assert.equal(quotaEntry.program.id, id);
    assert.equal((await readQuota.get()).get('count'), 120);
    await readQuota.delete();
    const personalRef = db.collection('cabutNamaPrograms').doc(personalProgram.id);
    const saved = (await personalRef.get()).data();
    assert.equal(saved.expiresAt.toMillis(), retentionDeadline(saved.createdAt).toMillis());
    const personalRound = personalRef.collection('rounds').doc(personalState.revision);
    const claim = personalRound.collection('claims').doc('0');
    assert.equal((await claim.get()).exists, true);
    const expired = Timestamp.fromMillis(Date.now() - 1000);
    const queue = db.collection(queueName).doc(personalProgram.id);
    await db.batch().update(personalRef, { expiresAt: expired }).update(queue, { expiresAt: expired }).commit();
    await assert.rejects(personal.call('get', personalProgram), { code: 'functions/not-found' });
    await assert.rejects(owner.call('reset', { ...personalProgram, revision: personalState.revision }), { code: 'functions/not-found' });
    assert.equal((await owner.call('list')).some(program => program.id === personalProgram.id), false);
    assert.deepEqual(await purgeExpiredPrograms(db), { purged: 1, failed: 0 });
    for (const reference of [personalRef, personalRound, claim, queue]) assert.equal((await reference.get()).exists, false);
    assert.equal((await db.collection('cabutNamaPrograms').doc(id).get()).exists, true);

    const migratedId = '00000000-0000-4000-8000-000000000071';
    const migrated = db.collection('cabutNamaPrograms').doc(migratedId);
    await migrated.set({ title: 'Program pra polisi', owner: ownerUid, createdAt: Date.now() - 40 * 24 * 60 * 60 * 1000 });
    const transitionStart = new Date();
    const migratedAt = retentionDeadline(transitionStart.getTime());
    const migration = ['scripts/prepare-retention.cjs', '--project', base.projectId, '--start', transitionStart.toISOString()];
    const execute = promisify(execFile);
    const preview = await execute(process.execPath, migration);
    assert.equal(JSON.parse(preview.stdout).eligible, 1);
    assert.equal((await migrated.get()).get('expiresAt'), undefined);
    const applied = await execute(process.execPath, [...migration, '--apply']);
    assert.equal(JSON.parse(applied.stdout).updated, 1);
    const retried = await execute(process.execPath, [...migration, '--apply']);
    assert.equal(JSON.parse(retried.stdout).updated, 0);
    assert.equal((await migrated.get()).get('retentionMigrated'), true);
    assert.equal((await db.collection(queueName).doc(migratedId).get()).get('expiresAt').toMillis(), migratedAt.toMillis());
    const { id: legacyId } = await owner.call('create', { title: 'Pusingan lama', names: ['Lama A', 'Lama B'] });
    const old = await owner.call('get', { id: legacyId, ownerView: true });
    const tokenData = JSON.parse(Buffer.from((await first.token()).split('.')[1], 'base64url').toString());
    const uid = tokenData.user_id;
    const past = Date.now() - 15000;
    const legacyRef = db.collection('cabutNamaPrograms').doc(legacyId).collection('rounds').doc(old.revision);
    await legacyRef.set({
      names: ['Lama A', 'Lama B'], matches: [1, 0], startedAt: past,
      participants: { [uid]: { name: 'Lama A', row: 0, email: tokenData.email,
        draw: { recipient: 1, revealAt: past + 2000, confirmBy: past + 12000, confirmedAt: null } } },
      claims: { 0: uid }
    });
    const before = await first.call('get', { id: legacyId });
    assert.equal(before.own.recipientName, 'Lama B');
    assert.equal(before.confirmed, 1);
    const legacyClient = await second.call('claim', {
      id: legacyId, revision: old.revision, row: 1, expectedName: 'Lama B', name: 'Baharu B', responseVersion: 1
    });
    assert.equal(legacyClient.confirmed, 1);
    assert.deepEqual(legacyClient.taken, [0]);
    await first.call('edit', { id: legacyId, revision: old.revision, name: 'Baharu A' });
    const after = await owner.call('get', { id: legacyId, ownerView: true });
    assert.equal(after.confirmed, 1);
    assert.equal(after.records.length, 1);
    assert.equal(after.records[0].recipientName, 'Lama B');
    assert.equal(after.records[0].giverName, 'Lama A');
    assert.deepEqual(after.names, ['Baharu A', 'Baharu B']);
  } finally {
    await deleteAdmin(adminApp);
  }
  console.log('LULUS: rekod lama dan baharu, Gmail peribadi, kelayakan peserta, tuntutan serentak, idempotensi, kuota, reset, tempoh 30 hari dan pemadaman program beserta subkoleksi.');
  if (process.env.CABUT_LOAD_TEST === '1') {
    const count = 100;
    const names = Array.from({ length: count }, (_, i) => `Peserta Beban ${i + 1}`);
    const emails = names.map((_, i) => `cabutnama-emulator-beban-${i + 1}@gmail.com`);
    const participants = [];
    for (let start = 0; start < count; start += 10) {
      const batch = emails.slice(start, start + 10);
      participants.push(...await Promise.all(batch.map((email, index) => client(`load-${start + index}`, true, email))));
    }
    const { id } = await owner.call('create-restricted', { title: 'Beban 100 peserta', names, emails });
    async function concurrent(label, cohort, callback) {
      const started = Date.now();
      const durations = [];
      const result = await Promise.all(cohort.map(async (participant, index) => {
        const began = Date.now();
        const value = await callback(participant, index);
        durations.push(Date.now() - began);
        return value;
      }));
      durations.sort((a, b) => a - b);
      const at = percentile => durations[Math.max(0, Math.ceil(cohort.length * percentile) - 1)];
      const elapsed = Date.now() - started;
      const rate = Math.round(cohort.length * 1000 / Math.max(1, elapsed) * 100) / 100;
      console.log('BEBAN ' + label + ': ' + result.length + '/' + cohort.length + ' berjaya; p50 ' + at(0.50) + ' ms; p95 ' + at(0.95) + ' ms; p99 ' + at(0.99) + ' ms; maks ' + durations.at(-1) + ' ms; jumlah ' + elapsed + ' ms; kadar ' + rate + ' req/s');
      return result;
    }
    await concurrent('get-10', participants.slice(0, 10), (participant, index) => participant.call('get', { id }).then(state => {
      assert.equal(state.eligibleRow, index);
      return state;
    }));
    const states = await concurrent('get-100', participants, (participant, index) => participant.call('get', { id }).then(state => {
      assert.equal(state.eligibleRow, index);
      return state;
    }));
    await concurrent('claim-100', participants, (participant, index) => participant.call('claim', { id, revision: states[index].revision, row: index, expectedName: names[index] }));
    const draws = await concurrent('draw-100', participants, (participant, index) => participant.call('draw', { id, revision: states[index].revision, agreed: true, confirmedName: names[index] }));
    await new Promise(resolve => setTimeout(resolve, Math.max(0, Math.max(...draws.map(draw => draw.own.revealAt)) - Date.now()) + 100));
    const results = await concurrent('confirm-100', participants, (participant, index) => participant.call('confirm', { id, revision: states[index].revision }));
    assert.equal(new Set(results.map(result => result.own.recipient)).size, count);
    assert.ok(results.every((result, index) => result.own.recipient !== index && result.own.status === 'confirmed'));
    const summary = await owner.call('get', { id, ownerView: true });
    assert.equal(summary.confirmed, count);
    assert.equal(summary.records.length, count);
    console.log('LULUS BEBAN: 100 peserta serentak, 100 padanan unik dan disahkan.');
  }
} finally {
  await Promise.all(apps.map(deleteApp));
}
