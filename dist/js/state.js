import { MODELS, BASE_MODELS, PRESETS } from './models.js';
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
export function newDraft() {
  return {
    ...defaults(zeros(10, -1)),
    model: 'custom',
    weights: { neutral: 25, vrs: 25, hltv: 25, elo: 25 },
  };
}
const inRange = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
const intArray = (x, n, min, max) =>
  Array.isArray(x) && x.length === n && x.every((i) => inRange(i, min, max));
export function validPersonal(settings) {
  if (
    !settings ||
    !intArray(settings.trust, 16, 0, 100) ||
    !intArray(settings.bonus, 16, -15, 15)
  )
    return false;
  if (settings.weights !== undefined) {
    const w = settings.weights;
    return Boolean(
      w &&
        typeof w === 'object' &&
        !Array.isArray(w) &&
        settings.base === undefined &&
        settings.weight === undefined &&
        Object.keys(w).length === PRESETS.length &&
        PRESETS.every((key) => Object.hasOwn(w, key) && inRange(w[key], 0, 100))
    );
  }
  if (settings.base !== undefined || settings.weight !== undefined)
    return (
      BASE_MODELS.includes(settings.base) && inRange(settings.weight, 0, 100)
    );
  return inRange(settings.form, 0, 100);
}
export function personalSettings(s) {
  const formula = s.weights
    ? {
        weights: Object.fromEntries(
          PRESETS.map((key) => [key, s.weights[key]])
        ),
      }
    : s.base
      ? { base: s.base, weight: s.weight }
      : { form: s.form };
  return {
    ...formula,
    trust: [...s.trust],
    bonus: [...s.bonus],
  };
}
export function validate(value, { draft = false } = {}) {
  if (!value || value.stage !== STAGE || !Object.hasOwn(MODELS, value.model))
    return false;
  if (!intArray(value.card, 10, draft ? -1 : 0, 15)) return false;
  const picks = value.card.filter((team) => team !== -1);
  if (new Set(picks).size !== picks.length) return false;
  if (!validPersonal(value)) return false;
  if (
    value.description !== undefined &&
    (typeof value.description !== 'string' || value.description.length > 280)
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
