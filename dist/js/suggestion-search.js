import { tournament } from './swiss.js';
import { makeMatrix } from './models.js';
import { randomStream } from './simulation.js';

export const QUICK_STARTS = 8;
const TRAINING_SIZE = 8192;
const VALIDATION_BATCH = 32768;
const bits = new Uint8Array(1 << 16);
for (let i = 1; i < bits.length; i++) bits[i] = bits[i >>> 1] + (i & 1);

const group = (slot) => (slot < 2 ? 0 : slot < 8 ? 1 : slot < 10 ? 2 : 3);
function masks(order) {
  const result = [0, 0, 0];
  for (let slot = 0; slot < 10; slot++) result[group(slot)] |= 1 << order[slot];
  return result;
}

// Three 16-bit team masks encode exactly the three scoring buckets for a stage.
export function drawSample(count, play) {
  const sample = new Uint16Array(count * 3);
  for (let i = 0; i < count; i++) {
    const finish = tournament(play);
    for (let id = 0; id < finish.length; id++) {
      if (finish[id] < 3) sample[3 * i + finish[id]] |= 1 << id;
    }
  }
  return sample;
}

export function passCount(sample, card) {
  const [perfect, advance, eliminated] = masks(card);
  let passed = 0;
  for (let i = 0; i < sample.length; i += 3) {
    const hits =
      bits[perfect & sample[i]] +
      bits[advance & sample[i + 1]] +
      bits[eliminated & sample[i + 2]];
    if (hits >= 5) passed++;
  }
  return passed;
}

function completeOrder(card, ids) {
  const remaining = ids.filter((id) => !card.includes(id));
  return [...card.map((id) => (id < 0 ? remaining.shift() : id)), ...remaining];
}

function shuffle(order, rand) {
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

export function createSearch(teams, state) {
  const matrix = makeMatrix(teams, state.model, state);
  const fixed = state.locks.every((side) => side >= 0);
  const ids = teams.map((_, i) => i);
  const averageFinish = tournament((a, b, bo, i) =>
    state.locks[i] < 0 ? matrix[bo][a][b] >= 0.5 : state.locks[i] === 0
  );
  const predicted = [...ids].sort(
    (a, b) => averageFinish[a] - averageFinish[b]
  );
  const fromDraft = completeOrder(state.card, predicted);
  const entireCard = !state.card.includes(-1);
  const searchRand = randomStream(101),
    selectRand = randomStream(211),
    checkRand = randomStream(307),
    shuffleRand = randomStream(401);
  function sample(n, rand) {
    return drawSample(fixed ? 1 : n, (a, b, bo, i) => {
      const draw = rand();
      return state.locks[i] < 0
        ? draw < matrix[bo][a][b]
        : state.locks[i] === 0;
    });
  }
  // Selection compares finalists across different training batches. Validation
  // uses a third stream and never feeds the search or its restarts.
  const selection = sample(16384, selectRand);
  const validation = [];
  let train,
    starts = 0,
    comparisons = 0,
    incumbent = fixed ? predicted : fromDraft;
  let bestScore = passCount(selection, incumbent);
  function consider(order) {
    const score = passCount(selection, order);
    if (score > bestScore) {
      bestScore = score;
      incumbent = order.slice();
    }
  }
  consider(predicted);

  function step() {
    if (fixed) return;
    if (starts % QUICK_STARTS === 0) train = sample(TRAINING_SIZE, searchRand);
    let order =
      starts % QUICK_STARTS === 0
        ? incumbent.slice()
        : shuffle([...ids], shuffleRand);
    starts++;
    let score = passCount(train, order);
    while (true) {
      let improveA = -1,
        improveB = -1,
        high = score;
      for (let i = 0; i < 10; i++) {
        for (let j = i + 1; j < order.length; j++) {
          if (group(i) === group(j)) continue;
          [order[i], order[j]] = [order[j], order[i]];
          const candidate = passCount(train, order);
          comparisons++;
          if (candidate > high) {
            high = candidate;
            improveA = i;
            improveB = j;
          }
          [order[i], order[j]] = [order[j], order[i]];
        }
      }
      if (improveA < 0) break;
      [order[improveA], order[improveB]] = [order[improveB], order[improveA]];
      score = high;
    }
    consider(order);
  }

  function result() {
    if (!validation.length || (!fixed && validation.length < 4))
      validation.push(sample(VALIDATION_BATCH, checkRand));
    const count = validation.reduce((sum, batch) => sum + batch.length / 3, 0);
    const chance = (order) =>
      validation.reduce((sum, batch) => sum + passCount(batch, order), 0) /
      count;
    const current = entireCard ? chance(state.card) : null;
    const candidate = chance(incumbent);
    const keep = current !== null && current >= candidate;
    return {
      card: keep ? [...state.card] : incumbent.slice(0, 10),
      current,
      rate: keep ? current : candidate,
      keep,
      count,
      fixed,
      starts,
      comparisons,
    };
  }
  return { step, result, fixed, progress: () => ({ starts, comparisons }) };
}
