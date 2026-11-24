import test from 'node:test';
import assert from 'node:assert/strict';
import { addRoundScores } from '../server/round-scores.js';
import { publicLiveState, mapSnapshot } from '../server/cito-score.js';
import { agendaScore, currentCT } from '../dist/js/schedule.js';

test('round coverage follows both opponents, map and publication time, including reversed team order', async () => {
  const game = { round: 1, status: 'live', a: 0, b: 8, bo: 1, map: { name: 'nuke', score: null } };
  const detail = {
    tournament: { tournamentId: 1801 }, bestOf: 1, matchParticularity: 'Stage 1<br>Rodada #1',
    teamA: { teamName: 'M80' }, teamB: { teamName: 'Ninjas in Pyjamas' },
  };
  const fetcher = async (url) => {
    if (url.endsWith('.gg/')) return new Response('<a href="/partida/46738-M80-vs-Ninjas-in-Pyjamas-PGL-Major-Singapore-2026">');
    if (!url.endsWith('/live')) return Response.json({ data: detail });
    return Response.json({ data: [
      { map: { name: 'de_inferno' }, scoreA: 1, scoreB: 2, eventDate: 90 },
      { map: { name: 'de_nuke' }, scoreA: null, scoreB: null, eventDate: 30 },
      { map: { name: 'de_nuke' }, scoreA: 3, scoreB: 0, eventDate: 25 },
      { map: { name: 'de_nuke' }, scoreA: 2, scoreB: 0, eventDate: 20 },
    ] });
  };
  const fresh = structuredClone(game);
  await addRoundScores([fresh], [], fetcher);
  assert.deepEqual(fresh.map, { name: 'nuke', score: [0, 3], reportedAt: 25000 });
  assert.equal(fresh.status, 'live');
  const later = structuredClone(game);
  await addRoundScores([later], [fresh], async () => { throw Error('offline'); });
  assert.deepEqual(later.map, fresh.map);
  later.map = { name: 'inferno', score: null };
  await addRoundScores([later], [fresh], async () => { throw Error('offline'); });
  assert.equal(later.map.score, null);
  for (const mismatch of [{ round: 2 }, { a: 9 }, { bo: 3 }]) {
    const other = { ...structuredClone(game), ...mismatch };
    await addRoundScores([other], [], fetcher);
    assert.equal(other.map.score, null);
  }
});

test('live state follows the named opponents and swaps sides before round 13 even on the round-end snapshot', async () => {
  const now = Date.UTC(2026, 10, 24, 5, 32);
  const id = 'cs2-match-2400496';
  const game = { round: 1, slot: 3, a: 0, b: 8, bo: 1, status: 'live', map: { name: 'mirage', score: [5, 4] } };
  const state = {
    entityType: 'cs2_live_state', matchId: id, status: 'live', source: 'live', dataAvailable: true,
    teams: { team1Name: 'Ninjas in Pyjamas', team2Name: 'M80' },
    currentMap: 'de_mirage', currentRound: 12, score: { team1: 5, team2: 7 },
    ctTeam: 'team1', tTeam: 'team2', lastVerified: new Date(now).toISOString(),
  };
  const resolve = (name) => ({ 'Ninjas in Pyjamas': 0, M80: 8 })[name];
  const html = (frame) => '<script>self.__next_f.push(' +
    JSON.stringify([1, '20:' + JSON.stringify(['$', 'main', { initialState: frame }]) + '\n']) + ')</script>';
  assert.deepEqual(publicLiveState(html(state), id), state);
  assert.equal(publicLiveState(html(state), 'cs2-match-other'), null);
  assert.equal(currentCT({ ...game, map: { score: [5, 6], startingCT: 0 } }), 0);
  for (const frame of [state, { ...state, currentRound: 13, ctTeam: 'team2', tTeam: 'team1' }]) {
    const map = mapSnapshot(frame, game, resolve, now);
    assert.deepEqual(map.score, [5, 7]);
    assert.equal(map.startingCT, 0);
    assert.equal(currentCT({ ...game, map }), 8);
    assert.deepEqual(mapSnapshot(frame, { ...game, a: 8, b: 0 }, resolve, now).score, [7, 5]);
  }
  assert.equal(mapSnapshot(state, { ...game, b: 6 }, resolve, now), null);
  assert.equal(mapSnapshot({ ...state, currentMap: 'de_nuke' }, game, resolve, now), null);
  assert.equal(mapSnapshot(state, game, resolve, now + 181000), null);
  const live = { ...state, currentRound: 14, ctTeam: 'team2', tTeam: 'team1', score: { team1: 6, team2: 7 } };
  const reader = (frame) => async (url) => url.startsWith('https://cito.gg/')
    ? new Response(html(frame)) : new Response('', { status: 503 });
  const fresh = structuredClone(game);
  await addRoundScores([fresh], [], reader(live), now);
  assert.deepEqual(agendaScore(fresh), [6, 7]);
  assert.equal(currentCT(fresh), 8);
  assert.equal(fresh.map.source, 'Cito');
  const next = structuredClone(game);
  await addRoundScores([next], [fresh], reader(state), now);
  assert.deepEqual(next.map.score, [6, 7]);
});

test('finished best-of-ones show rounds even in overtime and finished best-of-threes show series wins', () => {
  const ended = { status: 'end', bo: 1, map: { name: 'mirage', score: [14, 16] }, series: [0, 1] };
  assert.deepEqual(agendaScore(ended), [14, 16]);
  assert.deepEqual(agendaScore({ ...ended, bo: 3, series: [2, 1] }), [2, 1]);
  assert.deepEqual(agendaScore({ ...ended, map: null }), [0, 1]);
  assert.equal(agendaScore({ status: 'upcoming' }), null);
});

test('opening sides belong to the named teams and map, even when PGL has the newer score', async () => {
  const game = { round: 1, status: 'live', bo: 1, a: 7, b: 15, map: { name: 'inferno', score: [12, 8] } };
  const previous = [{ ...game, coverage: { id: 'test', reversed: true } }];
  const kickoff = {
    eventDate: 2, map: { name: null }, scoreA: null, scoreB: null,
    description: 'Inferno na telinha!\n\n9z vem de CT, Lynn Vision de TR.',
  };
  const round = { eventDate: 3, map: { name: 'de_inferno' }, scoreA: 7, scoreB: 11 };
  async function loadWith(announcement, bo = 1, score = [12, 8]) {
    const fresh = { ...game, bo, map: { name: 'inferno', score } };
    await addRoundScores([fresh], [{ ...previous[0], bo }], async () => Response.json({ data: [round, announcement] }));
    return fresh.map;
  }
  assert.deepEqual(await loadWith(kickoff), { name: 'inferno', score: [12, 8], startingCT: 7 });
  const updated = await loadWith(kickoff, 1, [10, 7]);
  assert.deepEqual(updated, { name: 'inferno', score: [11, 7], reportedAt: 3000, startingCT: 7 });
  assert.equal((await loadWith({ ...kickoff, description: 'Lynn Vision de CT e 9z de TR.' })).startingCT, 15);
  for (const invalid of [
    { eventDate: 4 }, { map: { name: 'de_nuke' } }, { scoreA: 1 },
    { description: '9z de CT.' }, { description: '9z de CT e Lynn Vision de CT.' },
  ]) assert.equal((await loadWith({ ...kickoff, ...invalid })).startingCT, undefined);
  assert.equal((await loadWith(kickoff, 3)).startingCT, undefined);
  assert.equal((await loadWith({ ...kickoff, map: round.map }, 3)).startingCT, 7);
  const advanced = { ...game, map: { name: 'inferno', score: [12, 9] } };
  await addRoundScores([advanced], [{ ...previous[0], map: updated }], async () => { throw Error('offline'); });
  assert.deepEqual(advanced.map, { name: 'inferno', score: [12, 9], startingCT: 7 });
});
