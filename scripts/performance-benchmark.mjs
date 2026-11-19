import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from '@firebase/app';
import { connectAuthEmulator, getAuth, GoogleAuthProvider, signInWithCredential } from '@firebase/auth';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from '@firebase/functions';
import { performance } from 'node:perf_hooks';

const project = { projectId: 'demo-cabutan-nama', apiKey: 'demo-key' };
const apps = [];
const samples = 5;
const sizes = [2, 3, 10, 100, 250];

async function client(label, email) {
  const app = initializeApp(project, 'perf-' + label);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const functions = getFunctions(app, 'asia-southeast1');
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  const profile = { sub: 'cabut-perf-' + label, email, email_verified: true };
  await signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify(profile)));
  const callable = httpsCallable(functions, 'cabutNama');
  return {
    call: async (action, data = {}) => (await callable({ action, responseVersion: 2, ...data })).data
  };
}

function percentile(values, percent) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(percent * sorted.length) - 1)];
}

function stats(values) {
  return {
    p50Ms: Math.round(percentile(values, 0.50) * 100) / 100,
    p95Ms: Math.round(percentile(values, 0.95) * 100) / 100
  };
}

try {
  const owner = await client('owner', 'perf-owner@example.test');
  const participant = await client('participant', 'perf-participant@gmail.com');
  for (const size of sizes) {
    const names = Array.from({ length: size }, (_, index) => 'Nama Sintetik ' + (index + 1));
    const emails = names.map((_, index) => index === 0
      ? 'perf-participant@gmail.com'
      : 'perf-' + size + '-' + index + '@example.test');
    const program = await owner.call('create-restricted', {
      title: 'Benchmark sintetik ' + size + ' ' + Date.now(),
      names,
      emails
    });

    const ownerWarm = await owner.call('get', { id: program.id, ownerView: true });
    const catalogWarm = await owner.call('list');
    const participantWarm = await participant.call('get', { id: program.id });
    assert.deepEqual(ownerWarm.names, names);
    assert.equal(participantWarm.eligibleRow, 0);
    assert.equal(participantWarm.names[0], names[0]);
    assert.ok(participantWarm.names.slice(1).every(name => name === null));
    assert.equal(Object.hasOwn(participantWarm, 'emails'), false);

    const serial = [];
    const combined = [];
    const participantGet = [];
    for (let sample = 0; sample < samples; sample++) {
      let started = performance.now();
      const catalog = await owner.call('list');
      assert.ok(catalog.some(item => item.id === program.id));
      const ownerView = await owner.call('get', { id: program.id, ownerView: true });
      assert.deepEqual(ownerView.names, names);
      serial.push(performance.now() - started);

      started = performance.now();
      const entry = await owner.call('coordinator-entry', { id: program.id });
      assert.ok(entry.catalog.some(item => item.id === program.id));
      assert.deepEqual(entry.program.names, names);
      combined.push(performance.now() - started);

      started = performance.now();
      const view = await participant.call('get', { id: program.id });
      assert.equal(view.eligibleRow, 0);
      assert.equal(view.names[0], names[0]);
      assert.ok(view.names.slice(1).every(name => name === null));
      participantGet.push(performance.now() - started);
    }

    console.log(JSON.stringify({
      scenario: 'synthetic-emulator',
      size,
      samples,
      coordinatorSequentialListGet: stats(serial),
      coordinatorCombinedEntry: stats(combined),
      participantGet: stats(participantGet),
      responseBytes: {
        coordinatorSequentialListGet: Buffer.byteLength(JSON.stringify(ownerWarm)) + Buffer.byteLength(JSON.stringify(catalogWarm)),
        coordinatorCombinedEntry: Buffer.byteLength(JSON.stringify({ catalog: catalogWarm, program: ownerWarm })),
        restrictedParticipant: Buffer.byteLength(JSON.stringify(participantWarm))
      },
      callableRequestsPerEntry: { coordinatorBefore: 2, coordinatorAfter: 1, participant: 1 }
    }));
  }
} finally {
  await Promise.all(apps.map(deleteApp));
}
