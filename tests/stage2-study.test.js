import assert from 'node:assert/strict';
import test from 'node:test';
import stage from '../dist/data/stage.json' with { type: 'json' };
import invited from '../dist/data/stage2-invites.json' with { type: 'json' };
import { newDraft } from '../dist/js/state.js';
import { modelAvailable, makeMatrix } from '../dist/js/models.js';
import { sampleRun } from '../dist/js/simulation.js';
import { validateStage2Study } from '../scripts/prepare-stage2-study.js';

function example() {
  const guests = invited.teams.map(team => team.id);
  const promoted = stage.teams.slice(0, 8).map(team => team.logo.split('.')[0]);
  const schedule = guests.map((leftTeamKey, i) => ({
    leftTeamKey, rightTeamKey: promoted[i], timeZone: 'SGT', round: 'opening round m' + (i + 1),
    date: '28.11.2026', time: '12:00',
  }));
  const teamIds = [...promoted, ...guests];
  const matrix = teamIds.map((_, a) => teamIds.map((_, b) => (a === b ? 0.5 : a > b ? 0.57123456789 : 1 - 0.57123456789)));
  const study = { stage: 'sg26-s2-v1', version: 'test', cutoff: '2026-11-27T21:00:00Z',
    teamIds, probabilities: { 1: matrix, 3: structuredClone(matrix) } };
  return { study, schedule };
}

test('Stage 2 accepts a complete frozen study in its own order, preserving precision', () => {
  const { study, schedule } = example();
  assert.deepEqual(validateStage2Study(study, schedule), study);
  schedule.find(match => match.leftTeamKey === 'nemiga').leftTeamKey = 'nemiga_gaming';
  schedule.find(match => match.leftTeamKey === '1win').leftTeamKey = 'the_one';
  const officialIds = study.teamIds.map(id => id === '1win' ? 'the_one' : id);
  assert.deepEqual(validateStage2Study({ ...study, teamIds: officialIds }, schedule), study);
  const edited = structuredClone(study);
  edited.probabilities[3][9][0] = 0.15;
  assert.throws(() => validateStage2Study(edited, schedule), /Probabilidade/);
  assert.throws(() => validateStage2Study({ ...study, cutoff: '2026-11-28T03:00:01Z' }, schedule), /corte/);
  schedule[0].rightTeamKey = '';
  assert.throws(() => validateStage2Study(study, schedule), /confrontos/);
});

test('an unpublished Stage 2 study never reuses Stage 1, even for identical team names', () => {
  const settings = newDraft('sg26-s2-v1');
  const teams = stage.teams;
  assert.equal(modelAvailable(teams, 'study', settings), false);
  assert.equal(modelAvailable(teams, 'custom', settings), false);
  assert.throws(() => makeMatrix(teams, 'study', settings), /Modelo IA/);
  const simulation = sampleRun(teams, settings);
  simulation.next();
  assert.deepEqual(Object.keys(simulation.snapshot().histograms), ['neutral', 'vrs', 'hltv', 'elo']);
  settings.weights.study = 0;
  assert.equal(modelAvailable(teams, 'custom', settings), true);
  assert.ok(Number.isFinite(makeMatrix(teams, 'custom', settings)[3][1][3]));
  assert.equal(modelAvailable(teams, 'study', newDraft()), true);
});
