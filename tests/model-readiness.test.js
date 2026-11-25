import test from 'node:test';
import assert from 'node:assert/strict';
import stage from '../dist/data/stage.json' with { type: 'json' };
import { newDraft } from '../dist/js/state.js';
import { modelAvailable, omitPendingWeights, mixPercentages } from '../dist/js/models.js';
import { sampleRun } from '../dist/js/simulation.js';

test('a new S2 draft uses available models, with pending weights zero in the mixer and simulation', () => {
  const teams = stage.teams.map(team => ({ ...team, vrs: null }));
  const draft = newDraft('sg26-s2-v1', teams);
  assert.deepEqual(draft.weights, { neutral: 20, vrs: 0, hltv: 20, elo: 20, study: 0 });
  assert.equal(mixPercentages(draft.weights).study, 0);
  assert.equal(modelAvailable(teams, 'vrs', draft), false);
  assert.equal(modelAvailable(teams, 'custom', draft), true);
  assert.equal(modelAvailable(teams, 'elo', draft, { elo: 'pending' }), false);
  const sample = sampleRun(teams, draft);
  sample.next();
  assert.deepEqual(Object.keys(sample.snapshot().histograms), ['neutral', 'hltv', 'elo', 'custom']);
  assert.ok(Object.values(sample.snapshot().histograms).flat().every(Number.isFinite));
});

test('copying a Stage 1 model only zeroes pending inputs in the editable Stage 2 copy', () => {
  const original = { ...newDraft(), weights: { neutral: 7, vrs: 43, hltv: 28, elo: 12, study: 10 } };
  const draft = { ...structuredClone(original), stage: 'sg26-s2-v1' };
  const omitted = omitPendingWeights(stage.teams, draft);
  assert.deepEqual(omitted, ['study']);
  assert.deepEqual(draft.weights, { neutral: 7, vrs: 43, hltv: 28, elo: 12, study: 0 });
  assert.equal(original.weights.study, 10);
});
