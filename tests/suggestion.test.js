import test from 'node:test';
import assert from 'node:assert/strict';
import stage from '../dist/data/stage.json' with { type: 'json' };
import {
  createSearch,
  drawSample,
  passCount,
  QUICK_STARTS,
} from '../dist/js/suggestion-search.js';
import { makeMatrix } from '../dist/js/models.js';
import { tournament, score } from '../dist/js/swiss.js';
import { newDraft, validate } from '../dist/js/state.js';
import { randomStream } from '../dist/js/simulation.js';

test('suggestion scoring matches the tournament scorer for mixed odds and fixed results', () => {
  const state = newDraft();
  state.weights = { neutral: 0, vrs: 60, hltv: 30, elo: 10 };
  state.trust[0] = 40;
  state.bonus[3] = 7;
  state.locks.fill(1, 0, 12);
  const matrix = makeMatrix(stage.teams, 'custom', state);
  function decider() {
    const rand = randomStream(927);
    return (a, b, bo, i) => {
      const draw = rand();
      return state.locks[i] >= 0
        ? state.locks[i] === 0
        : draw < matrix[bo][a][b];
    };
  }
  const play = decider(),
    count = 512;
  const expected = Array.from({ length: count }, () =>
    score(stage.card, tournament(play))
  ).filter((n) => n >= 5).length;
  assert.equal(passCount(drawSample(count, decider()), stage.card), expected);
});

test('quick and continued search produce usable drafts and separate paired validation estimates', () => {
  const state = newDraft();
  state.card[2] = 3;
  const original = structuredClone(state),
    search = createSearch(stage.teams, state);
  for (let i = 0; i < QUICK_STARTS; i++) search.step();
  const quick = search.result();
  assert.ok(validate({ ...state, card: quick.card }));
  assert.equal(quick.current, null);
  assert.equal(quick.count, 32768);
  assert.equal(quick.starts, 8);
  search.step();
  const refined = search.result();
  assert.ok(refined.comparisons > quick.comparisons);
  assert.ok(validate({ ...state, card: refined.card }));
  assert.equal(refined.count, 65536);
  assert.deepEqual(state, original);
  const full = { ...state, card: stage.card };
  const initial = createSearch(stage.teams, full).result();
  const rand = randomStream(307),
    matrix = makeMatrix(stage.teams, full.model, full);
  const checked = drawSample(32768, (a, b, bo) => rand() < matrix[bo][a][b]);
  assert.equal(initial.current, passCount(checked, stage.card) / 32768);
  assert.equal(initial.rate, passCount(checked, initial.card) / 32768);
  assert.ok(initial.rate >= initial.current);
});

test('a settled stage uses the actual outcomes and retains a passing current card', () => {
  const state = newDraft();
  state.locks = state.locks.map((_, i) => i % 2);
  const finish = tournament((a, b, bo, i) => state.locks[i] === 0);
  const found = createSearch(stage.teams, state).result();
  assert.equal(found.fixed, true);
  assert.equal(found.count, 1);
  assert.equal(found.rate, 1);
  assert.equal(score(found.card, finish), 10);
  const full = createSearch(stage.teams, {
    ...state,
    card: found.card,
  }).result();
  assert.equal(full.keep, true);
  assert.deepEqual(full.card, found.card);
});
