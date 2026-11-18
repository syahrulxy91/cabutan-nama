const { createHash, randomUUID } = require('node:crypto');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineBoolean } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const { clean, norm, drawStatus, newRound, makeMatches } = require('./draw.cjs');
const { expiryMillis, isExpired, purgeExpiredPrograms, queueName, retentionDeadline } = require('./retention.cjs');

initializeApp();
const projects = getFirestore().collection('cabutNamaPrograms');
const quotas = projects.firestore.collection('cabutNamaQuotas');
const createLimit = 30;
const readLimit = 120;
const dayMs = 86_400_000;
const minuteMs = 60_000;
const enforceAppCheck = defineBoolean('CABUT_ENFORCE_APP_CHECK', { default: false });
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

function requireActive(program) {
  if (isExpired(program, Date.now())) throw failure('not-found', 'Program tidak tersedia atau tempoh simpanan 30 hari telah tamat.');
}

async function checkQuota(tx, ref, now, period, limit) {
  const previous = (await tx.get(ref)).data();
  const window = Math.floor(now / period);
  const count = previous?.window === window ? previous.count : 0;
  if (count >= limit) throw failure('resource-exhausted', 'Had permintaan dicapai. Cuba lagi kemudian.');
  return { window, count: count + 1, expiresAt: new Date(now + 2 * period) };
}

async function reserveRead(user) {
  const ref = quotas.doc(`read-${user.uid}`);
  await ref.firestore.runTransaction(async tx => {
    tx.set(ref, await checkQuota(tx, ref, Date.now(), minuteMs, readLimit));
  });
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
    id, title: program.title, revision: program.round, expiresAt: expiryMillis(program),
    retentionMigrated: program.retentionMigrated === true,
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
    if (!head.exists) throw failure('not-found', 'Program tidak ditemui atau tempoh simpanan telah tamat.');
    const program = head.data();
    requireActive(program);
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
      const hasLegacy = Object.keys(legacy).length > 0;
      const records = hasLegacy ? members : members.where('effectiveConfirmAt', '>=', 0);
      for (const doc of (await tx.get(records)).docs) participants.set(doc.id, doc.data());
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
    requireActive(program);
    return result;
  }, { readOnly: true });
}

async function createProgram(data, user) {
  const title = validatedTitle(data.title);
  const names = validatedNames(data.names);
  const restricted = data.action === 'create-restricted';
  const emails = validatedEmails(data.emails, names, restricted);
  const operationId = data.operationId;
  if (operationId !== undefined && (typeof operationId !== 'string' || !programIdPattern.test(operationId))) {
    throw failure('invalid-argument', 'Pengenal permintaan tidak sah. Buka semula borang program.');
  }
  const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const operation = operationId ? projects.firestore.collection('cabutNamaCreateOperations').doc(digest([user.uid, operationId])) : null;
  const fingerprint = operation ? digest([title, names, emails]) : null;
  const quota = quotas.doc(`create-${user.uid}`);
  const ref = projects.doc(randomUUID());
  const round = randomUUID();
  return ref.firestore.runTransaction(async tx => {
    const saved = operation ? (await tx.get(operation)).data() : null;
    if (saved) {
      if (saved.fingerprint !== fingerprint) throw failure('already-exists', 'Pengenal ini sudah digunakan untuk program dengan butiran berlainan.');
      return { id: saved.id };
    }
    const now = Date.now();
    const counter = await checkQuota(tx, quota, now, dayMs, createLimit);
    const expiresAt = retentionDeadline(now);
    tx.create(ref, { title, owner: user.uid, round, createdAt: now, expiresAt });
    tx.create(ref.firestore.collection(queueName).doc(ref.id), { expiresAt });
    tx.create(ref.collection('rounds').doc(round), newRound(names, now, emails));
    if (operation) tx.create(operation, { id: ref.id, fingerprint, createdAt: now, expiresAt: new Date(now + 7 * dayMs) });
    tx.set(quota, counter);
    return { id: ref.id };
  });
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
    if (!head.exists) throw failure('not-found', 'Program tidak ditemui atau tempoh simpanan telah tamat.');
    const program = head.data();
    requireActive(program);
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

async function handleRequest(request) {
  const user = caller(request.auth);
  const data = request.data ?? {};
  if (data.action === 'list') {
    await reserveRead(user);
    const owned = await projects.where('owner', '==', user.uid).get();
    const now = Date.now();
    return owned.docs.filter(doc => !isExpired(doc.data(), now))
      .map(doc => ({ id: doc.id, title: doc.get('title') })).sort((a, b) => a.title.localeCompare(b.title, 'ms-MY'));
  }
  if (data.action === 'create' || data.action === 'create-restricted') return createProgram(data, user);
  if (data.action === 'get') {
    await reserveRead(user);
    return loadProgram(data, user);
  }
  const result = await updateProgram(data, user);
  if (data.responseVersion !== 2 && result.id) {
    return loadProgram({ id: result.id, includeTaken: true }, user);
  }
  return result;
}

const measuredActions = new Set([
  'list', 'get', 'create', 'create-restricted', 'claim', 'edit', 'draw',
  'confirm', 'rename', 'acceptance', 'reset', 'reset-list', 'replace', 'replace-restricted'
]);
exports.cabutNama = onCall({ region: 'asia-southeast1', maxInstances: 10, enforceAppCheck }, async request => {
  const started = performance.now();
  const requested = request.data?.action;
  const action = measuredActions.has(requested) ? requested : 'unknown';
  let outcome = 'ok';
  try {
    return await handleRequest(request);
  } catch (error) {
    outcome = error instanceof HttpsError ? error.code : 'internal';
    throw error;
  } finally {
    logger.info('Cabut Nama callable', {
      action, outcome, durationMs: Math.round(performance.now() - started)
    });
  }
});

exports.purgeCabutNama = onSchedule({
  schedule: 'every 5 minutes', region: 'asia-southeast1', timeoutSeconds: 240, maxInstances: 1, concurrency: 1
}, async () => {
  const result = await purgeExpiredPrograms(projects.firestore);
  logger.info('Cabut Nama retention cleanup', result);
  if (result.failed) throw new Error('Some Cabut Nama retention jobs could not be completed.');
});
