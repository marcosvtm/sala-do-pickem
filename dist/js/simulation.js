import { tournament, score } from './swiss.js';
import { makeMatrix, MODELS } from './models.js';

// sfc32 with fixed independent state words. Reusing the stream pairs scenarios
// across models and cards. Every path consumes 33 uniforms, even for locked games.
export function randomStream(seed = 0) {
  let a = 0x213edbf2,
    b = 0x369aca3d,
    c = 0x71ff1205,
    d = 0x166832d1 ^ seed;
  const next = () => {
    const t = (a + b + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = (((c << 21) | (c >>> 11)) + t) >>> 0;
    return t / 4294967296;
  };
  for (let i = 0; i < 24; i++) next();
  return next;
}

export function sampleRun(teams, state, models = Object.keys(MODELS)) {
  const rand = randomStream(),
    uniforms = new Float64Array(33);
  const entries = models.map((id) => ({
    id,
    matrix: makeMatrix(teams, id, state),
    hist: Array(11).fill(0),
  }));
  let count = 0;
  return {
    next() {
      for (let i = 0; i < 33; i++) uniforms[i] = rand();
      for (const { matrix, hist } of entries) {
        const finish = tournament((a, b, bo, i) =>
          state.locks[i] === -1
            ? uniforms[i] < matrix[bo][a][b]
            : state.locks[i] === 0
        );
        hist[score(state.card, finish)]++;
      }
      count++;
    },
    snapshot() {
      const histograms = Object.fromEntries(
        entries.map(({ id, hist }) => [id, hist.map((x) => x / count)])
      );
      return { kind: 'sample', count, histograms };
    },
  };
}

// Each binary path appears once. Locked results are given, so their factors
// equal one. Weighted sums stay stable for long runs via compensated addition.
function accumulate(sums, errors, index, x) {
  const y = x - errors[index],
    t = sums[index] + y;
  errors[index] = t - sums[index] - y;
  sums[index] = t;
}
export function exactRun(teams, state) {
  const total = 2 ** state.locks.filter((x) => x === -1).length;
  const matrix = makeMatrix(teams, state.model, state);
  const hist = Array(11).fill(0),
    errors = Array(11).fill(0);
  let count = 0;
  return {
    total,
    next() {
      if (count === total) return;
      let bits = count,
        mass = 1;
      const result = tournament((a, b, bo, i) => {
        if (state.locks[i] !== -1) return state.locks[i] === 0;
        const left = bits % 2 === 0;
        bits = Math.floor(bits / 2);
        mass *= left ? matrix[bo][a][b] : 1 - matrix[bo][a][b];
        return left;
      });
      accumulate(hist, errors, score(state.card, result), mass);
      count++;
    },
    snapshot() {
      const mass = hist.reduce((a, b) => a + b, 0);
      const lower = hist.slice(5).reduce((a, b) => a + b, 0);
      return {
        kind: 'exact',
        count,
        total,
        lower,
        upper: Math.min(1, lower + Math.max(0, 1 - mass)),
        histograms: count === total ? { [state.model]: [...hist] } : {},
      };
    },
  };
}
export function wilson(p, n) {
  const z = 1.96,
    d = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / d,
    radius = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) / d;
  return [Math.max(0, center - radius), Math.min(1, center + radius)];
}
