import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tournament, score, availableGames } from '../dist/js/swiss.js';
import {
  defaults,
  newDraft,
  validate,
  updateLock,
  swap,
} from '../dist/js/state.js';
import { makeMatrix, modelName } from '../dist/js/models.js';
import { exactRun, sampleRun } from '../dist/js/simulation.js';

const read = (relative) =>
  JSON.parse(readFileSync(new URL(relative, import.meta.url)));
const { teams, card } = read('../dist/data/stage.json');
const initial = () => defaults(card);
const close = (a, b, tol = 1e-10) =>
  assert.ok(Math.abs(a - b) < tol, a + ' <> ' + b);

test('replays all 33 Cologne fixtures, formats and winners with no rematches', () => {
  const { games } = read('./cologne.json');
  const remaining = [...games];
  const result = tournament((a, b, bo) => {
    const i = remaining.findIndex(
      (g) => (g.a === a && g.b === b) || (g.a === b && g.b === a)
    );
    assert.notEqual(i, -1);
    const [game] = remaining.splice(i, 1);
    assert.equal(bo, game.bo);
    return game.winner === a;
  });
  assert.equal(remaining.length, 0);
  assert.deepEqual(
    [0, 1, 2, 3].map((k) => result.filter((x) => x === k).length),
    [2, 6, 2, 6]
  );
});
test('first visit and partial drafts have no saved owner and require ten unique teams to submit', () => {
  const s = newDraft();
  assert.deepEqual(s.card, Array(10).fill(-1));
  assert.equal(modelName(s.model), 'Modelo personalizado');
  assert.equal(modelName(s.model, 'mrk'), 'Modelo mrk');
  swap(s.card, 3, 0);
  swap(s.card, 4, 0);
  assert.equal(s.card[3], -1);
  assert.ok(validate(JSON.parse(JSON.stringify(s)), { draft: true }));
  assert.equal(validate(s), false);
  s.card[3] = 0;
  assert.equal(validate(s, { draft: true }), false);
  s.card = [...card];
  assert.ok(validate(s));
});
test('card buckets are exclusive and swapping between buckets keeps ten distinct picks', () => {
  const state = initial();
  assert.ok(validate(state));
  const outcomes = Array(16).fill(3);
  state.card.forEach((t, i) => (outcomes[t] = i < 2 ? 0 : i < 8 ? 1 : 2));
  assert.equal(score(state.card, outcomes), 10);
  outcomes[state.card[2]] = 0;
  assert.equal(score(state.card, outcomes), 9);
  swap(state.card, 0, state.card[8]);
  assert.ok(validate(state));
  state.card[1] = state.card[0];
  assert.equal(validate(state), false);
});
test('recent form and VRS reproduce the archived BO1 and are reciprocal in both formats', () => {
  const state = initial();
  for (const [key, expected] of [
    ['neutral', 0.5],
    ['elo', 0.40020459728493996],
    ['vrs', 0.5686807300803753],
  ]) {
    const m = makeMatrix(teams, key, state);
    close(m[1][1][9], expected);
    for (const bo of [1, 3])
      for (let a = 0; a < 16; a++)
        for (let b = 0; b < 16; b++) close(m[bo][a][b] + m[bo][b][a], 1);
  }
  state.form = 100;
  const base = makeMatrix(teams, 'elo', state)[1][13][5];
  close(makeMatrix(teams, 'custom', state)[1][13][5], base);
  state.trust[13] = 0;
  assert.notEqual(makeMatrix(teams, 'custom', state)[1][13][5], base);
  state.bonus[1] = 5;
  const equalOpponents = teams.map((t) => ({ ...t, vrs: 1400, elo: 0 }));
  close(makeMatrix(equalOpponents, 'custom', state)[3][1][9], 0.55);
});
test('known results unlock the next round and editing a round clears dependent picks', () => {
  const s = initial();
  assert.equal(availableGames(s.locks).length, 1);
  s.locks.fill(0, 0, 8);
  assert.equal(availableGames(s.locks).length, 2);
  s.locks[8] = 1;
  updateLock(s, 0, 0, -1);
  assert.equal(s.locks[8], -1);
  s.locks[30] = 0;
  assert.equal(validate(s), false);
});
test('weighted enumeration of the final match agrees with direct scoring and bounds', () => {
  const s = initial();
  s.model = 'elo';
  s.locks.fill(0);
  s.locks[32] = -1;
  const last = availableGames(s.locks)[4][2];
  const p = makeMatrix(teams, 'elo', s)[last.bo][last.a][last.b];
  const expected = Array(11).fill(0);
  for (const side of [0, 1]) {
    const res = tournament((a, b, bo, i) => i !== 32 || side === 0);
    expected[score(card, res)] += side === 0 ? p : 1 - p;
  }
  const run = exactRun(teams, s);
  run.next();
  const midway = run.snapshot(),
    pass = expected.slice(5).reduce((a, b) => a + b, 0);
  assert.ok(midway.lower <= pass + 1e-12 && midway.upper >= pass - 1e-12);
  assert.deepEqual(midway.histograms, {});
  run.next();
  run.next();
  assert.equal(run.snapshot().count, 2);
  run.snapshot().histograms.elo.forEach((x, i) => close(x, expected[i]));
  s.locks[32] = 0;
  const done = exactRun(teams, s);
  done.next();
  assert.equal(done.total, 1);
  close(done.snapshot().upper, done.snapshot().lower);
});
test('neutral Monte Carlo reproduces the analytic mean and is repeatable', () => {
  const s = initial(),
    run = sampleRun(teams, s),
    copy = sampleRun(teams, s);
  for (let i = 0; i < 4; i++) {
    run.next();
    copy.next();
  }
  assert.deepEqual(run.snapshot(), copy.snapshot());
  for (let i = 4; i < 12000; i++) run.next();
  const hist = run.snapshot().histograms.neutral;
  close(
    hist.reduce((a, b) => a + b, 0),
    1
  );
  close(
    hist.reduce((a, b, i) => a + i * b, 0),
    2.75,
    0.06
  );
});
