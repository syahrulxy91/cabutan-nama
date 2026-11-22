const { randomInt } = require('node:crypto');

const clean = value => typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/gu, ' ') : '';
const norm = value => clean(value).toLocaleLowerCase('ms-MY');

function makeMatches(size, pick = randomInt) {
  if (!Number.isInteger(size) || size < 2) throw new RangeError('Sekurang-kurangnya dua nama diperlukan.');
  const matches = Array.from({ length: size }, (_, row) => row);
  do {
    for (let i = size - 1; i > 0; i--) {
      const j = pick(i + 1);
      [matches[i], matches[j]] = [matches[j], matches[i]];
    }
  } while (matches.some((id, row) => id === row));
  return matches;
}

function drawStatus(draw, now) {
  if (!draw) return 'named';
  return draw.confirmedAt !== null || now >= draw.confirmBy ? 'confirmed' : 'pending';
}

// Gmail ignores dots and anything after "+" in the local part, so compare the mailbox Google delivers to.
function canonicalEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const at = email.lastIndexOf('@');
  if (at < 1) return email;
  const domain = email.slice(at + 1);
  if (domain !== 'gmail.com' && domain !== 'googlemail.com') return email;
  return email.slice(0, at).split('+')[0].replaceAll('.', '') + '@gmail.com';
}

function editDistance(a, b) {
  const left = [...a];
  const right = [...b];
  let previous = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i++) {
    const current = [i];
    for (let j = 1; j <= right.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[right.length];
}

// Participants may correct the spelling of their own name, but not replace it with unrelated text.
const maximumNameChange = original => Math.max(4, Math.ceil([...norm(original)].length * 0.4));
const isNameCorrection = (original, name) => editDistance(norm(original), norm(name)) <= maximumNameChange(original);

function newRound(names, now, emails) {
  return {
    names,
    matches: names.length ? makeMatches(names.length) : [],
    ...(emails ? { emails } : {}),
    startedAt: now
  };
}

module.exports = { clean, norm, makeMatches, drawStatus, newRound, canonicalEmail, editDistance, isNameCorrection, maximumNameChange };
