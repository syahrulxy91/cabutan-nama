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

function newRound(names, now) {
  return {
    names,
    matches: names.length ? makeMatches(names.length) : [],
    participants: {},
    claims: {},
    startedAt: now
  };
}

module.exports = { clean, norm, makeMatches, drawStatus, newRound };
