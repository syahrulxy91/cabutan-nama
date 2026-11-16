import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import { connectFirestoreEmulator, doc, getDocFromServer, getFirestore } from 'firebase/firestore';

const base = { projectId: 'demo-cabutan-nama', apiKey: 'demo-key' };
const apps = [];
async function client(index, authenticate = true) {
  const app = initializeApp(base, 'audit-' + index);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const functions = getFunctions(app, 'asia-southeast1');
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  if (authenticate) {
    const profile = { sub: 'cabut-uid-' + index, email: 'cabut-ujian-' + index + '@example.test', email_verified: true };
    await signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify(profile)));
  }
  const callable = httpsCallable(functions, 'cabutNama');
  return { db, call: async (action, data) => (await callable({ action, ...data })).data };
}

try {
  const [owner, first, second, anonymous] = await Promise.all([client(1), client(2), client(3), client(4, false)]);
  await assert.rejects(anonymous.call('list'), { code: 'functions/unauthenticated' });
  const names = ['Ali', 'Abu', 'Raju'];
  const { id } = await owner.call('create', { title: 'Ujian berbilang akaun', names });
  const state = await owner.call('get', { id, ownerView: true });
  const payload = { id, revision: state.revision };
  await assert.rejects(getDocFromServer(doc(first.db, 'cabutNamaPrograms', id)), { code: 'permission-denied' });
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
  assert.ok(draws.every(d => d.own.recipient === null && d.records.length === 0));
  assert.equal(draws[1].own.confirmBy, draws[3].own.confirmBy);
  await new Promise(resolve => setTimeout(resolve, 2200));
  const revealed = await Promise.all([owner, winner, loser].map(c => c.call('get', { id })));
  assert.equal(new Set(revealed.map(d => d.own.recipient)).size, 3);
  assert.ok(revealed.every(d => d.own.recipient !== d.own.row && d.records.length === 0));
  const manual = await owner.call('confirm', payload);
  assert.equal(manual.own.status, 'confirmed');
  assert.equal(manual.own.recipient, revealed[0].own.recipient);
  await new Promise(resolve => setTimeout(resolve, Math.max(0, Math.max(...revealed.map(d => d.own.confirmBy)) - Date.now()) + 100));
  const admin = await owner.call('get', { id, ownerView: true });
  assert.equal(admin.confirmed, 3);
  assert.equal(admin.records.length, 3);
  assert.equal((await owner.call('acceptance', payload)).passed, 12);
  await owner.call('reset', payload);
  const reset = await owner.call('get', { id, ownerView: true });
  assert.equal(reset.confirmed, 0);
  assert.notEqual(reset.revision, state.revision);
  await assert.rejects(winner.call('draw', payload), { code: 'functions/failed-precondition' });
  console.log('LULUS: Google Auth emulator, rules deny, pengasingan urusetia, tuntutan serentak, pendua RPC, tiga penerima unik, auto-sah, UAT dan reset.');
} finally {
  await Promise.all(apps.map(deleteApp));
}
