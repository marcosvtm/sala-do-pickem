import test from 'node:test';
import assert from 'node:assert/strict';
import { agendaScore, seriesMaps, seriesPhase, seriesStakes } from '../dist/js/schedule.js';

const first = { status: 'end', name: 'mirage', score: [9, 13] };
const next = { status: 'upcoming', name: 'nuke', score: null };
const third = { status: 'upcoming', name: 'ancient', score: null };
const interval = { status: 'live', bo: 3, series: [0, 1], maps: [first, next, third] };

test('agenda switches the headline between live rounds, maps at intermission, and the final series', () => {
  assert.equal(seriesPhase(interval, interval.maps), 'interval');
  assert.deepEqual(agendaScore(interval), [0, 1]);
  for (const score of [[0, 0], [8, 6], [15, 14]]) {
    const current = { ...next, status: 'live', score };
    const game = { ...interval, map: current, maps: [first, current, third] };
    assert.deepEqual(agendaScore(game), score);
    assert.equal(seriesPhase(game, game.maps), 'live');
  }
  const maps = [first, { ...next, status: 'end', score: [14, 16] }, { ...third, status: 'unplayed' }];
  const deciding = { ...interval, maps, series: [0, 2] };
  assert.equal(seriesPhase(deciding, maps), 'confirming');
  assert.deepEqual(agendaScore(deciding), [0, 2]);
  assert.deepEqual(agendaScore({ ...deciding, status: 'end' }), [0, 2]);
  assert.deepEqual(seriesMaps(deciding), maps);
});

test('scheduled series and legacy cached snapshots never invent round scores', () => {
  const scheduled = { bo: 3, status: 'upcoming' };
  assert.equal(agendaScore(scheduled), null);
  assert.deepEqual(seriesMaps(scheduled).map((m) => m.score), [null, null, null]);
  const old = {
    bo: 3, status: 'live', series: [1, 0], completedMaps: ['mirage'],
    map: { name: 'nuke', score: null },
  };
  assert.deepEqual(seriesMaps(old).map((m) => m.status), ['end', 'upcoming', 'upcoming']);
  assert.deepEqual(agendaScore(old), [1, 0]);
  const end = { ...old, status: 'end', series: [2, 0], map: { name: 'nuke', score: [13, 11] } };
  assert.deepEqual(seriesMaps(end).map((m) => m.score), [null, [13, 11], null]);
  assert.equal(seriesMaps(end)[2].status, 'unplayed');
});

test('the round 3 group comes from earlier completed series regardless of team order', () => {
  const game = { round: 3, bo: 3, a: 0, b: 4 };
  const firstWin = { round: 1, a: 0, b: 2, status: 'end', series: [1, 0] };
  const secondWin = { round: 2, a: 1, b: 0, status: 'end', series: [0, 1] };
  assert.equal(seriesStakes(game, [firstWin, secondWin]), 'Classificação');
  assert.equal(seriesStakes(game, [{ ...firstWin, series: [0, 1] }, { ...secondWin, series: [1, 0] }]), 'Eliminação');
  assert.equal(seriesStakes(game, [firstWin, { ...secondWin, status: 'live' }]), '');
  assert.equal(seriesStakes({ ...game, bo: 1 }, [firstWin, secondWin]), '');
  assert.equal(seriesStakes({ ...game, round: 5 }, []), 'Classificação ou eliminação');
});
