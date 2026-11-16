import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { initializeApp, deleteApp } from '@firebase/app';
import { connectAuthEmulator, getAuth, GoogleAuthProvider, signInWithCredential } from '@firebase/auth';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from '@firebase/functions';

const base = { projectId: 'demo-cabutan-nama', apiKey: 'demo-key' };
const apps = [];
async function client(index, authenticate = true) {
  const app = initializeApp(base, 'audit-' + index);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const functions = getFunctions(app, 'asia-southeast1');
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  if (authenticate) {
    const profile = { sub: 'cabut-uid-' + index, email: 'cabut-ujian-' + index + '@example.test', email_verified: true };
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
  const require = createRequire(new URL('../functions/package.json', import.meta.url));
  const { initializeApp: initializeAdmin, deleteApp: deleteAdmin } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  const adminApp = initializeAdmin({ projectId: base.projectId }, 'legacy-test');
  try {
    const db = getFirestore(adminApp);
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
  console.log('LULUS: rekod lama dan baharu, Auth Google, Firestore Rules, urusetia, tuntutan serentak, ulangan, penerima unik, nama stabil, auto-sah, UAT, reset dan penyertaan terhad.');
} finally {
  await Promise.all(apps.map(deleteApp));
}
