const { createHash, randomUUID } = require('node:crypto');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { clean, norm, drawStatus, newRound, makeMatches } = require('./draw.cjs');

initializeApp();
const projects = getFirestore().collection('cabutNamaPrograms');
const maximumRoster = 250;
const programIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const failure = (code, message) => new HttpsError(code, message);
const normalizedEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';

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

function validatedEmails(raw, names, restricted) {
  if (!restricted) return null;
  if (!Array.isArray(raw) || raw.length !== names.length) {
    throw failure('invalid-argument', 'Masukkan satu e-mel Google untuk setiap nama mengikut turutan senarai.');
  }
  const emails = raw.map(normalizedEmail);
  if (emails.some(email => email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) || new Set(emails).size !== emails.length) {
    throw failure('invalid-argument', 'Setiap nama memerlukan alamat e-mel yang sah dan unik.');
  }
  return emails;
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

function eligibleRow(round, user) {
  if (!round.emails) return null;
  const row = round.emails.indexOf(normalizedEmail(user.email));
  if (row < 0) throw failure('permission-denied', 'Gunakan akaun Google yang didaftarkan oleh urusetia.');
  return row;
}

function drawLabels(participant, round) {
  const draw = participant.draw;
  return {
    giverName: draw.giverName ?? participant.name,
    recipientName: draw.recipientName ?? (round.legacyNames ?? round.names)[draw.recipient]
  };
}

function publicParticipant(participant, round, now) {
  const { draw } = participant;
  const base = { name: participant.name, row: participant.row, status: drawStatus(draw, now) };
  if (!draw) return base;
  const visible = now >= draw.revealAt;
  const labels = drawLabels(participant, round);
  return { ...base, giverName: labels.giverName, recipient: visible ? draw.recipient : null,
    recipientName: visible ? labels.recipientName : null, revealAt: draw.revealAt, confirmBy: draw.confirmBy };
}

function snapshot(id, program, round, row, own, now, ownerView = false) {
  return {
    id, title: program.title, revision: program.round,
    names: !round.emails || ownerView ? round.names : round.names.map((name, index) => index === row ? name : null),
    restricted: Boolean(round.emails), eligibleRow: row,
    own: own ? publicParticipant(own, round, now) : null, records: [], now
  };
}

async function loadProgram(data, user) {
  if (typeof data.id !== 'string' || !programIdPattern.test(data.id)) throw failure('not-found', 'Program tidak ditemui.');
  const ref = projects.doc(data.id);
  return ref.firestore.runTransaction(async tx => {
    const head = await tx.get(ref);
    if (!head.exists) throw failure('not-found', 'Program tidak ditemui.');
    const program = head.data();
    const ownerView = data.ownerView === true;
    if (ownerView) requireOwner(program, user);
    const roundRef = ref.collection('rounds').doc(program.round);
    const round = (await tx.get(roundRef)).data();
    const row = ownerView ? null : eligibleRow(round, user);
    const members = roundRef.collection('participants');
    const legacy = round.participants ?? {};
    const own = (await tx.get(members.doc(user.uid))).data() ?? (Object.hasOwn(legacy, user.uid) ? legacy[user.uid] : null);
    if (own && row !== null && own.row !== row) {
      throw failure('permission-denied', 'Gunakan akaun Google yang didaftarkan oleh urusetia.');
    }
    const result = snapshot(ref.id, program, round, row, own, Date.now(), ownerView);
    const { now } = result;
    if (ownerView || Object.keys(legacy).length) {
      const participants = new Map(Object.entries(legacy));
      for (const doc of (await tx.get(members)).docs) participants.set(doc.id, doc.data());
      result.confirmed = [...participants.values()].filter(p => drawStatus(p.draw, now) === 'confirmed').length;
      result.records = ownerView ? [...participants.values()].filter(p => p.draw)
        .map(p => ({ ...publicParticipant(p, round, now), email: p.email })) : [];
    } else {
      result.confirmed = (await tx.get(members.where('effectiveConfirmAt', '<=', now).count())).data().count;
      result.records = [];
    }
    result.taken = [];
    if (!ownerView && (!own || data.includeTaken) && !round.emails) {
      const claims = await tx.get(roundRef.collection('claims').select());
      result.taken = [...new Set([...Object.keys(round.claims ?? {}), ...claims.docs.map(doc => doc.id)])].map(Number).filter(index => index !== own?.row);
    }
    return result;
  }, { readOnly: true });
}

async function createProgram(data, user) {
  const title = validatedTitle(data.title);
  const names = validatedNames(data.names);
  const restricted = data.action === 'create-restricted';
  const emails = validatedEmails(data.emails, names, restricted);
  if (data.requestId !== undefined && (typeof data.requestId !== 'string' || !programIdPattern.test(data.requestId))) {
    throw failure('invalid-argument', 'ID permintaan penciptaan tidak sah.');
  }
  const ref = projects.doc(randomUUID());
  const round = randomUUID();
  const now = Date.now();
  if (data.requestId !== undefined) {
    const key = createHash('sha256').update(JSON.stringify([user.uid, data.requestId])).digest('hex');
    const intent = getFirestore().collection('cabutNamaCreateRequests').doc(key);
    const fingerprint = createHash('sha256').update(JSON.stringify([title, names, emails])).digest('hex');
    return ref.firestore.runTransaction(async tx => {
      const previous = await tx.get(intent);
      if (previous.exists) {
        if (previous.get('fingerprint') !== fingerprint) {
          throw failure('already-exists', 'ID permintaan ini telah digunakan untuk program yang berbeza.');
        }
        return { id: previous.get('programId') };
      }
      tx.create(ref, { title, owner: user.uid, round, createdAt: now });
      tx.create(ref.collection('rounds').doc(round), newRound(names, now, emails));
      tx.create(intent, { fingerprint, programId: ref.id, createdAt: now });
      return { id: ref.id };
    });
  }
  const batch = ref.firestore.batch();
  batch.create(ref, { title, owner: user.uid, round, createdAt: now });
  batch.create(ref.collection('rounds').doc(round), newRound(names, now, emails));
  await batch.commit();
  return { id: ref.id };
}

async function renameParticipant(tx, roundRef, round, row, raw) {
  const name = validatedName(round, row, raw);
  if (name === round.names[row]) return name;
  const aliases = roundRef.collection('nameAliases');
  const key = value => createHash('sha256').update(norm(value)).digest('hex');
  const existing = await tx.get(aliases.doc(key(name)));
  if (existing.exists && existing.get('row') !== row) {
    throw failure('invalid-argument', 'Nama ini pernah digunakan oleh peserta lain dalam pusingan ini.');
  }
  tx.set(aliases.doc(key(round.names[row])), { row });
  const fields = {};
  if (round.participants && !round.legacyNames) {
    fields.legacyNames = [...round.names];
    round.legacyNames = fields.legacyNames;
  }
  round.names[row] = name;
  tx.update(roundRef, { ...fields, names: round.names });
  return name;
}

async function updateProgram(data, user) {
  if (typeof data.id !== 'string' || !programIdPattern.test(data.id)) throw failure('not-found', 'Program tidak ditemui.');
  const ref = projects.doc(data.id);
  return ref.firestore.runTransaction(async tx => {
    const head = await tx.get(ref);
    if (!head.exists) throw failure('not-found', 'Program tidak ditemui.');
    const program = head.data();
    const ownerAction = ['rename', 'acceptance', 'reset', 'reset-list', 'replace', 'replace-restricted'].includes(data.action);
    if (ownerAction) requireOwner(program, user);
    const roundRef = ref.collection('rounds').doc(program.round);
    const round = (await tx.get(roundRef)).data();
    const row = ownerAction ? null : eligibleRow(round, user);
    if (data.revision !== program.round) throw failure('failed-precondition', 'Pusingan telah berubah. Muat semula dan cuba lagi.');
    if (data.action === 'rename') {
      tx.update(ref, { title: validatedTitle(data.title) });
      return {};
    }
    const members = roundRef.collection('participants');
    if (data.action === 'acceptance') {
      const participants = [...Object.values(round.participants ?? {}), ...(await tx.get(members)).docs.map(doc => doc.data())];
      const valid = matches => matches.length === round.names.length && new Set(matches).size === matches.length &&
        matches.every((recipient, index) => Number.isInteger(recipient) && recipient >= 0 && recipient < matches.length && recipient !== index);
      if (round.names.length < 2 || !valid(round.matches) || participants.some(p => p.draw && round.matches[p.row] !== p.draw.recipient)) {
        throw failure('failed-precondition', 'Padanan program tidak lengkap atau bercanggah dengan rekod cabutan.');
      }
      for (let i = 0; i < 12; i++) {
        if (!valid(makeMatches(round.names.length))) throw failure('internal', 'Ujian padanan gagal.');
      }
      return { passed: 12, count: round.names.length };
    }
    if (['reset', 'reset-list', 'replace', 'replace-restricted'].includes(data.action)) {
      const names = data.action === 'reset' ? round.names : data.action === 'reset-list' ? [] : validatedNames(data.names);
      const restricted = data.action === 'replace-restricted' || Boolean(round.emails);
      if (data.action === 'replace' && round.emails) {
        throw failure('failed-precondition', 'Gunakan akses e-mel berdaftar untuk menggantikan senarai program ini.');
      }
      const emails = data.action === 'reset' ? round.emails : data.action === 'reset-list' ? (restricted ? [] : null) : validatedEmails(data.emails, names, restricted);
      const next = randomUUID();
      const now = Date.now();
      tx.update(roundRef, { endedAt: now });
      tx.create(ref.collection('rounds').doc(next), newRound(names, now, emails));
      tx.update(ref, { round: next });
      return {};
    }

    const memberRef = members.doc(user.uid);
    const legacy = round.participants ?? {};
    let participant = (await tx.get(memberRef)).data() ?? (Object.hasOwn(legacy, user.uid) ? legacy[user.uid] : null);
    if (data.action === 'claim') {
      const choice = data.row;
      if (!Number.isInteger(choice) || choice < 0 || choice >= round.names.length) throw failure('invalid-argument', 'Pilih nama daripada senarai.');
      if (row !== null && choice !== row) throw failure('permission-denied', 'Gunakan nama yang sepadan dengan e-mel Google anda.');
      if (participant && participant.row !== choice) throw failure('already-exists', 'Akaun ini sudah memilih satu nama.');
      if (!participant) {
        const claimRef = roundRef.collection('claims').doc(String(choice));
        if (round.claims?.[choice] || (await tx.get(claimRef)).exists) throw failure('already-exists', 'Nama ini sudah dipilih. Semak semula senarai.');
        if (data.expectedName !== round.names[choice]) throw failure('failed-precondition', 'Nama dalam senarai telah berubah. Semak semula.');
        const name = data.name === undefined ? round.names[choice] : await renameParticipant(tx, roundRef, round, choice, data.name);
        participant = { row: choice, name, email: user.email, draw: null };
        tx.create(memberRef, participant);
        tx.create(claimRef, { uid: user.uid });
      }
    } else {
      if (!participant) throw failure('failed-precondition', 'Sahkan nama anda dahulu.');
      if (row !== null && participant.row !== row) throw failure('permission-denied', 'Gunakan akaun Google yang didaftarkan oleh urusetia.');
      if (data.action === 'edit') {
        if (participant.draw) Object.assign(participant.draw, drawLabels(participant, round));
        participant.name = await renameParticipant(tx, roundRef, round, participant.row, data.name);
        tx.set(memberRef, participant);
      } else if (data.action === 'draw') {
        if (!participant.draw) {
          if (data.agreed !== true || data.confirmedName !== participant.name) {
            throw failure('failed-precondition', 'Sahkan nama semasa dan setuju dengan syarat undian.');
          }
          const recipient = round.matches[participant.row];
          if (!Number.isInteger(recipient) || recipient === participant.row || !round.names[recipient]) {
            throw failure('failed-precondition', 'Padanan program tidak sah. Hubungi urusetia.');
          }
          const now = Date.now();
          participant.draw = { recipient, giverName: participant.name, recipientName: round.names[recipient], revealAt: now + 2000, confirmBy: now + 12000, confirmedAt: null };
          participant.effectiveConfirmAt = participant.draw.confirmBy;
          tx.set(memberRef, participant);
        }
      } else if (data.action === 'confirm') {
        const draw = participant.draw;
        const now = Date.now();
        if (!draw || now < draw.revealAt) throw failure('failed-precondition', 'Tunggu nama penerima dipaparkan.');
        if (drawStatus(draw, now) === 'pending') {
          Object.assign(draw, drawLabels(participant, round));
          draw.confirmedAt = now;
          participant.effectiveConfirmAt = now;
          tx.set(memberRef, participant);
        }
      } else {
        throw failure('invalid-argument', 'Tindakan tidak dikenali.');
      }
    }
    return snapshot(ref.id, program, round, row, participant, Date.now());
  });
}

exports.cabutNama = onCall({ region: 'asia-southeast1', maxInstances: 10 }, async request => {
  const user = caller(request.auth);
  const data = request.data ?? {};
  if (data.action === 'list') {
    const owned = await projects.where('owner', '==', user.uid).get();
    return owned.docs.map(doc => ({ id: doc.id, title: doc.get('title') })).sort((a, b) => a.title.localeCompare(b.title, 'ms-MY'));
  }
  if (data.action === 'create' || data.action === 'create-restricted') return createProgram(data, user);
  if (data.action === 'get') return loadProgram(data, user);
  const result = await updateProgram(data, user);
  if (data.responseVersion !== 2 && result.id) {
    return loadProgram({ id: result.id, includeTaken: true }, user);
  }
  return result;
});
