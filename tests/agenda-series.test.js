import test from 'node:test';
import assert from 'node:assert/strict';
import base from '../dist/data/schedule.json' with { type: 'json' };
import { parseSchedule } from '../server/agenda.js';
import { addRoundScores } from '../server/round-scores.js';

const a = 'imperial_esports', b = 'flyquest';
const board = (name, left = 0, right = 0, first = a, second = b) => ({
  map: name ? 'de_' + name : '', leftTeamKey: first, rightTeamKey: second,
  leftScore: left, rightScore: right,
});
function series({ status = 'live', wins = [0, 0], maps = [], bo = 3 } = {}) {
  const rows = base.games.map((g) => ({
    date: '25.11.2026', time: '16:00', timeZone: 'SGT',
    round: g.round === 1 ? 'opening round m1' : 'round ' + g.round,
    format: 'BO' + g.bo, status: 'upcoming', leftScore: 0, rightScore: 0, maps: [],
  }));
  const index = base.games.findIndex((g) => g.round === 3 && g.bo === 3);
  Object.assign(rows[index], {
    status, format: 'BO' + bo, leftTeamKey: a, rightTeamKey: b,
    leftScore: wins[0], rightScore: wins[1], maps,
  });
  return parseSchedule(rows)[index];
}
const unavailable = async () => new Response('', { status: 503 });
const noBroadcast = async () => null;

test('series preserve ordered maps, keep veto slots empty and distinguish intervals and unplayed maps', () => {
  const empty = series({ status: 'upcoming', maps: [board(null), board(null), board(null)] });
  assert.deepEqual(empty.maps, Array(3).fill({ name: null, score: null, status: 'upcoming' }));
  const first = board('mirage', 14, 16, b, a);
  const second = board('nuke', 8, 9);
  const final = board('ancient');
  const interval = series({ wins: [1, 0], maps: [first, board('nuke'), final] });
  assert.deepEqual(interval.maps, [
    { name: 'mirage', score: [16, 14], status: 'end' },
    { name: 'nuke', score: null, status: 'upcoming' },
    { name: 'ancient', score: null, status: 'upcoming' },
  ]);
  const live = series({ wins: [1, 0], maps: [first, second, final] });
  assert.equal(live.maps[1].status, 'live');
  assert.deepEqual(live.map, { name: 'nuke', score: [8, 9] });
  const prematureEnd = series({ status: 'end', wins: [1, 0], maps: [first, board('nuke'), final] });
  assert.equal(prematureEnd.status, 'live');
  assert.deepEqual(prematureEnd.maps, interval.maps);
  const sweep = series({ status: 'end', wins: ['2', '0'], maps: [first, board('nuke', 13, 9), final] });
  assert.deepEqual(sweep.maps.map((m) => m.status), ['end', 'end', 'unplayed']);
  assert.equal(sweep.maps[2].score, null);
  const three = series({ status: 'end', wins: [2, 1], maps: [first, board('nuke', 8, 13), board('ancient', 9, 13, b, a)] });
  assert.deepEqual(three.maps[2], { name: 'ancient', score: [13, 9], status: 'end' });
  assert.deepEqual(three.map, { name: 'ancient', score: [13, 9] });
  const five = series({ status: 'end', wins: [3, 0], bo: 5 });
  assert.deepEqual(five.maps.map((m) => m.status), ['end', 'end', 'end', 'unplayed', 'unplayed']);
  const mismatch = series({ wins: [1, 0], maps: [first, board('nuke', 3, 7, 'other', b)] });
  assert.equal(mismatch.maps[1].score, null);
});

test('an official map win can retain the last decisive round score, without treating a partial score as final', async () => {
  const makeInterval = () => series({ wins: [1, 0], maps: [board('mirage'), board('nuke')] });
  for (const [score, expected] of [[[13, 10], [13, 10]], [[16, 14], [16, 14]], [[15, 14], null]]) {
    const lastSeen = series({ maps: [board('mirage', ...score)] });
    const interval = makeInterval();
    await addRoundScores([interval], [lastSeen], unavailable, 10000, noBroadcast);
    assert.deepEqual(interval.maps[0].score, expected);
    assert.equal(interval.maps[1].score, null);
  }
});

test('refresh keeps confirmed history, live score and timestamp across a delayed feed; the next map has fresh sides', async () => {
  const read = (game, prev, now) => addRoundScores([game], prev, unavailable, now, noBroadcast);
  const first = board('mirage', 13, 7);
  const latest = series({ wins: [1, 0], maps: [first, board('nuke', 7, 8)] });
  await read(latest, [], 10000);
  latest.map.startingCT = latest.a;
  const partial = series({ wins: [1, 0], maps: [board(null), board('nuke', 5, 5)] });
  await read(partial, [latest], 25000);
  assert.deepEqual(partial.maps[0], latest.maps[0]);
  assert.deepEqual(partial.maps[1], latest.maps[1]);
  assert.equal(partial.map.reportedAt, 10000);
  const earlier = series({ maps: [board('mirage', 4, 5)] });
  await read(earlier, [partial], 40000);
  assert.deepEqual(earlier.series, [1, 0]);
  assert.deepEqual(earlier.maps[1], latest.maps[1]);
  const interval = series({ wins: [1, 1], maps: [first, board('nuke', 7, 13), board('ancient')] });
  await read(interval, [latest], 55000);
  assert.deepEqual(interval.maps[2], { name: 'ancient', score: null, status: 'upcoming' });
  assert.deepEqual(interval.map, { name: 'ancient', score: null });
  const official = series({ status: 'end', wins: [1, 2], maps: [first, board('nuke', 7, 13), board('ancient', 12, 16)] });
  await read(official, [interval], 70000);
  assert.deepEqual(official.maps[2], { name: 'ancient', score: [12, 16], status: 'end' });
});

test('auxiliary reports update just the current map; a preview alone does not start the second map at zero', async () => {
  const now = 222000;
  const make = () => series({ wins: [1, 0], maps: [board('mirage', 13, 10), board('nuke'), board('ancient')] });
  const watch = async (game, event) => {
    const prev = { ...make(), coverage: { id: 'fixture', reversed: true } };
    await addRoundScores([game], [prev], async (url) => url.endsWith('/live')
      ? Response.json({ data: [event] }) : new Response('', { status: 503 }), now, noBroadcast);
  };
  const game = make();
  await watch(game, { map: { name: 'de_mirage' }, scoreA: 10, scoreB: 13, eventDate: 100 });
  assert.equal(game.maps[1].status, 'upcoming');
  await watch(game, { map: { name: 'de_nuke' }, scoreA: 0, scoreB: 0, eventDate: 101,
    title: 'Mapa definido', description: 'Imperial de CT.' });
  assert.deepEqual(game.maps[1], { name: 'nuke', score: null, status: 'upcoming' });
  await watch(game, { map: { name: 'de_nuke' }, scoreA: 3, scoreB: 7, eventDate: 202 });
  assert.deepEqual(game.maps[1], { name: 'nuke', score: [7, 3], status: 'live' });
  assert.deepEqual(game.maps[0].score, [13, 10]);
  assert.equal(game.maps[2].score, null);
});
