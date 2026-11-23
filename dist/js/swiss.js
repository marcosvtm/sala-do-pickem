// Valve's ordered pairing rows for the six-team groups in rounds four and five.
const priorities = [
  '16 25 34',
  '16 24 35',
  '15 26 34',
  '15 24 36',
  '14 26 35',
  '14 25 36',
  '16 23 45',
  '15 23 46',
  '13 26 45',
  '13 25 46',
  '14 23 56',
  '13 24 56',
  '12 36 45',
  '12 35 46',
  '12 34 56',
].map((row) =>
  row.split(' ').map((pair) => [Number(pair[0]) - 1, Number(pair[1]) - 1])
);

const teams = Array.from({ length: 16 }, (_, i) => i);
export const ROUND_SIZES = [8, 8, 8, 6, 3];
export const ROUND_START = [0, 8, 16, 24, 30];

function pairEarly(group, seen) {
  if (!group.length) return [];
  const first = group[0];
  for (let j = group.length - 1; j > 0; j--) {
    const other = group[j];
    if (seen[first] & (1 << other)) continue;
    const tail = pairEarly([...group.slice(1, j), ...group.slice(j + 1)], seen);
    if (tail) return [[first, other], ...tail];
  }
  return null;
}

function pairGroup(group, seen, round) {
  if (round < 3) return pairEarly(group, seen);
  const pattern = priorities.find((row) =>
    row.every(([i, j]) => !(seen[group[i]] & (1 << group[j])))
  );
  if (!pattern) throw new Error('Grupo sem pareamento válido');
  return pattern.map(([i, j]) => [group[i], group[j]]);
}

export function tournament(decide) {
  const wins = Array(16).fill(0),
    losses = Array(16).fill(0),
    seen = Array(16).fill(0);
  let match = 0;
  for (let round = 0; round < 5; round++) {
    let games;
    if (round === 0) {
      games = teams.slice(0, 8).map((a) => [a, a + 8]);
    } else {
      const difficulty = seen.map((mask) => {
        let sum = 0;
        while (mask) {
          const opponent = 31 - Math.clz32(mask & -mask);
          sum += wins[opponent] - losses[opponent];
          mask &= mask - 1;
        }
        return sum;
      });
      const groups = [[], [], []];
      for (const t of teams)
        if (wins[t] < 3 && losses[t] < 3) groups[wins[t]].push(t);
      games = [];
      for (let w = 2; w >= 0; w--) {
        const group = groups[w];
        if (!group.length) continue;
        group.sort((a, b) => difficulty[b] - difficulty[a] || a - b);
        games.push(...pairGroup(group, seen, round));
      }
    }
    for (const [a, b] of games) {
      const bo = wins[a] === 2 || losses[a] === 2 ? 3 : 1;
      const left = decide(a, b, bo, match++, round);
      wins[left ? a : b]++;
      losses[left ? b : a]++;
      seen[a] |= 1 << b;
      seen[b] |= 1 << a;
    }
  }
  // The three scoring buckets, followed by every other eliminated team.
  return teams.map((t) =>
    wins[t] === 3 ? (losses[t] === 0 ? 0 : 1) : wins[t] === 0 ? 2 : 3
  );
}

export function score(card, records) {
  let hits = 0;
  for (let i = 0; i < 10; i++) {
    const bucket = i < 2 ? 0 : i < 8 ? 1 : 2;
    if (records[card[i]] === bucket) hits++;
  }
  return hits;
}

// Later rounds become available as soon as every earlier result has been entered.
export function availableGames(locks) {
  const rounds = [];
  let available = true;
  tournament((a, b, bo, match, round) => {
    if (match === ROUND_START[round] && round > 0) {
      available =
        available &&
        locks.slice(ROUND_START[round - 1], match).every((side) => side !== -1);
    }
    if (available) (rounds[round] ??= []).push({ a, b, bo, match });
    return locks[match] !== 1;
  });
  return rounds;
}
