import test from 'node:test';
import assert from 'node:assert/strict';
import { addRoundScores } from '../server/round-scores.js';

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
    await addRoundScores([fresh], previous, async () => Response.json({ data: [round, announcement] }));
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
