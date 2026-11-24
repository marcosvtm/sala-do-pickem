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
