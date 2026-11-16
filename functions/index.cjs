const { randomUUID } = require('node:crypto');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { clean, norm, drawStatus, newRound, makeMatches } = require('./draw.cjs');

initializeApp();
const projects = getFirestore().collection('cabutNamaPrograms');
const maximumRoster = 250;
const programIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const failure = (code, message) => new HttpsError(code, message);

function caller(auth) {
  if (!auth || auth.token.firebase?.sign_in_provider !== 'google.com' || auth.token.email_verified !== true || typeof auth.token.email !== 'string') {
    throw failure('unauthenticated', 'Log masuk dengan akaun Google yang disahkan.');
  }
  return { uid: auth.uid, email: auth.token.email };
}

function validatedTitle(raw) {
  const title = clean(raw);
  if (!title || title.length > 90) throw failure('invalid-argument', 'Masukkan nama program sehingga 90 aksara.');
  return title;
}

function validatedNames(raw) {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > maximumRoster) {
    throw failure('invalid-argument', 'Senarai mesti mempunyai 2 hingga 250 nama.');
  }
  const names = raw.map(clean);
  if (names.some(name => !name || name.length > 130) || new Set(names.map(norm)).size !== names.length) {
    throw failure('invalid-argument', 'Setiap nama mesti unik dan mengandungi 1 hingga 130 aksara.');
  }
  return names;
}

function validatedName(round, row, raw) {
  const name = clean(raw);
  if (!name || name.length > 130 || round.names.some((existing, index) => index !== row && norm(existing) === norm(name))) {
    throw failure('invalid-argument', 'Masukkan nama unik sehingga 130 aksara.');
  }
  return name;
}

function requireOwner(program, user) {
  if (program.owner !== user.uid) throw failure('permission-denied', 'Hanya urusetia program ini boleh menguruskannya.');
}

function publicParticipant(participant, now) {
  const draw = participant.draw;
  const base = { name: participant.name, row: participant.row, status: drawStatus(draw, now) };
  if (!draw) return base;
  const visible = now >= draw.revealAt;
  return { ...base, recipient: visible ? draw.recipient : null, revealAt: draw.revealAt, confirmBy: draw.confirmBy };
}

function snapshot(id, program, round, user, ownerView, now) {
  const participants = Object.values(round.participants);
  const own = Object.hasOwn(round.participants, user.uid) ? round.participants[user.uid] : null;
  return {
    id,
    title: program.title,
    revision: program.round,
    names: round.names,
    taken: Object.keys(round.claims).filter(row => round.claims[row] !== user.uid).map(Number),
    confirmed: participants.filter(p => drawStatus(p.draw, now) === 'confirmed').length,
    own: own ? publicParticipant(own, now) : null,
    records: ownerView ? participants.filter(p => p.draw).map(p => ({ ...publicParticipant(p, now), email: p.email })) : [],
    now
  };
}

async function loadProgram(data, user) {
  if (!programIdPattern.test(data.id ?? '')) throw failure('not-found', 'Program tidak ditemui.');
  const ref = projects.doc(data.id);
  return ref.firestore.runTransaction(async tx => {
    const head = await tx.get(ref);
    if (!head.exists) throw failure('not-found', 'Program tidak ditemui.');
    const program = head.data();
    if (data.ownerView) requireOwner(program, user);
    const doc = await tx.get(ref.collection('rounds').doc(program.round));
    return snapshot(ref.id, program, doc.data(), user, data.ownerView === true, Date.now());
  }, { readOnly: true });
}

async function createProgram(data, user) {
  const title = validatedTitle(data.title);
  const names = validatedNames(data.names);
  const ref = projects.doc(randomUUID());
  const round = randomUUID();
  const now = Date.now();
  const batch = ref.firestore.batch();
  batch.create(ref, { title, owner: user.uid, round, createdAt: now });
  batch.create(ref.collection('rounds').doc(round), newRound(names, now));
  await batch.commit();
  return { id: ref.id };
}

async function updateProgram(data, user) {
  if (!programIdPattern.test(data.id ?? '')) throw failure('not-found', 'Program tidak ditemui.');
  const ref = projects.doc(data.id);
  return ref.firestore.runTransaction(async tx => {
    const head = await tx.get(ref);
    if (!head.exists) throw failure('not-found', 'Program tidak ditemui.');
    const program = head.data();
    if (data.revision !== program.round) throw failure('failed-precondition', 'Pusingan telah berubah. Muat semula dan cuba lagi.');
    const roundRef = ref.collection('rounds').doc(program.round);
    const now = Date.now();

    if (data.action === 'rename') {
      requireOwner(program, user);
      tx.update(ref, { title: validatedTitle(data.title) });
      return {};
    }

    const round = (await tx.get(roundRef)).data();
    if (data.action === 'acceptance') {
      requireOwner(program, user);
      const valid = matches => matches.length === round.names.length && new Set(matches).size === matches.length &&
        matches.every((recipient, row) => Number.isInteger(recipient) && recipient >= 0 && recipient < matches.length && recipient !== row);
      if (round.names.length < 2 || !valid(round.matches) || Object.values(round.participants).some(p => p.draw && round.matches[p.row] !== p.draw.recipient)) {
        throw failure('failed-precondition', 'Padanan program tidak lengkap atau bercanggah dengan rekod cabutan.');
      }
      for (let i = 0; i < 12; i++) {
        if (!valid(makeMatches(round.names.length))) throw failure('internal', 'Ujian padanan gagal.');
      }
      return { passed: 12, count: round.names.length };
    }
    if (['reset', 'reset-list', 'replace'].includes(data.action)) {
      requireOwner(program, user);
      const names = data.action === 'reset' ? round.names : data.action === 'reset-list' ? [] : validatedNames(data.names);
      const next = randomUUID();
      tx.update(roundRef, { endedAt: now });
      tx.create(ref.collection('rounds').doc(next), newRound(names, now));
      tx.update(ref, { round: next });
      return {};
    }

    let participant = Object.hasOwn(round.participants, user.uid) ? round.participants[user.uid] : null;
    if (data.action === 'claim') {
      const row = data.row;
      if (!Number.isInteger(row) || row < 0 || row >= round.names.length) throw failure('invalid-argument', 'Pilih nama daripada senarai.');
      if (participant && participant.row !== row) throw failure('already-exists', 'Akaun ini sudah memilih satu nama.');
      if (round.claims[row] && round.claims[row] !== user.uid) throw failure('already-exists', 'Nama ini sudah dipilih. Semak semula senarai.');
      if (!participant) {
        if (data.expectedName !== round.names[row]) throw failure('failed-precondition', 'Nama dalam senarai telah berubah. Semak semula.');
        const name = data.name === undefined ? round.names[row] : validatedName(round, row, data.name);
        round.names[row] = name;
        participant = { row, name, email: user.email, draw: null };
        round.participants[user.uid] = participant;
        round.claims[row] = user.uid;
        tx.set(roundRef, round);
      }
    } else {
      if (!participant) throw failure('failed-precondition', 'Sahkan nama anda dahulu.');
      if (data.action === 'edit') {
        const name = validatedName(round, participant.row, data.name);
        round.names[participant.row] = name;
        participant.name = name;
        tx.set(roundRef, round);
      } else if (data.action === 'draw') {
        if (!participant.draw) {
          if (data.agreed !== true || data.confirmedName !== participant.name) {
            throw failure('failed-precondition', 'Sahkan nama semasa dan setuju dengan syarat undian.');
          }
          const recipient = round.matches[participant.row];
          if (!Number.isInteger(recipient) || recipient === participant.row || !round.names[recipient]) {
            throw failure('failed-precondition', 'Padanan program tidak sah. Hubungi urusetia.');
          }
          participant.draw = { recipient, revealAt: now + 2000, confirmBy: now + 12000, confirmedAt: null };
          tx.set(roundRef, round);
        }
      } else if (data.action === 'confirm') {
        const draw = participant.draw;
        if (!draw || now < draw.revealAt) throw failure('failed-precondition', 'Tunggu nama penerima dipaparkan.');
        if (drawStatus(draw, now) === 'pending') {
          draw.confirmedAt = now;
          tx.set(roundRef, round);
        }
      } else {
        throw failure('invalid-argument', 'Tindakan tidak dikenali.');
      }
    }
    return snapshot(ref.id, program, round, user, false, now);
  });
}

exports.cabutNama = onCall({ region: 'asia-southeast1', maxInstances: 10 }, async request => {
  const user = caller(request.auth);
  const data = request.data ?? {};
  if (data.action === 'list') {
    const owned = await projects.where('owner', '==', user.uid).get();
    return owned.docs.map(doc => ({ id: doc.id, title: doc.get('title') })).sort((a, b) => a.title.localeCompare(b.title, 'ms-MY'));
  }
  if (data.action === 'create') return createProgram(data, user);
  if (data.action === 'get') return loadProgram(data, user);
  return updateProgram(data, user);
});
