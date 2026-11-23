import { MODELS } from './models.js';
import { ROUND_SIZES, ROUND_START } from './swiss.js';

export const STAGE = 'sg26-s1-v1';
const zeros = (n, v) => Array(n).fill(v);
export function defaults(card) {
  return {
    stage: STAGE,
    card: [...card],
    model: 'neutral',
    form: 50,
    trust: zeros(16, 100),
    bonus: zeros(16, 0),
    locks: zeros(33, -1),
  };
}
const inRange = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
const intArray = (x, n, min, max) =>
  Array.isArray(x) && x.length === n && x.every((i) => inRange(i, min, max));
export function validate(value) {
  if (!value || value.stage !== STAGE || !Object.hasOwn(MODELS, value.model))
    return false;
  if (!intArray(value.card, 10, 0, 15) || new Set(value.card).size !== 10)
    return false;
  if (
    !inRange(value.form, 0, 100) ||
    !intArray(value.trust, 16, 0, 100) ||
    !intArray(value.bonus, 16, -15, 15)
  )
    return false;
  if (!intArray(value.locks, 33, -1, 1)) return false;
  let incomplete = false;
  for (let r = 0; r < 5; r++) {
    const group = value.locks.slice(
      ROUND_START[r],
      ROUND_START[r] + ROUND_SIZES[r]
    );
    if (incomplete && group.some((x) => x !== -1)) return false;
    if (group.includes(-1)) incomplete = true;
  }
  return true;
}
export function updateLock(state, round, index, side) {
  state.locks[index] = side;
  if (round < 4) state.locks.fill(-1, ROUND_START[round + 1]);
}
export function swap(card, slot, team) {
  const old = card.indexOf(team);
  if (old >= 0) card[old] = card[slot];
  card[slot] = team;
}
