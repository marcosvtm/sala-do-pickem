import assert from 'node:assert/strict';
import test from 'node:test';
import { coverageContext, addRoundScores } from '../server/round-scores.js';
import { currentCT } from '../dist/js/schedule.js';

const now = Date.parse('2026-11-25T06:26:00Z');
const off = async () => new Response('', { status: 503 });
const noFrame = async () => null;
const fixture = () => ({ at: now - 26 * 60000, round: 3, slot: 1, bo: 1, status: 'upcoming', a: 2, b: 8, stream: 'main' });

test('an independently verified match becomes live before PGL, survives a stale poll, then yields to official results', async () => {
  const game = fixture();
  const cstv = () => ({ phase: 'first', map: 'de_inferno', ct: 'M80', tr: 'HEROIC', ctScore: 5, trScore: 4, rounds: 9 });
  await addRoundScores([game], [], off, now, cstv);
  assert.equal(game.status, 'live');
  assert.equal(game.liveSource, 'CSTV PGL');
  assert.deepEqual(game.map.score, [4, 5]);
  assert.equal(currentCT(game), 8);
  const repeat = fixture();
  await addRoundScores([repeat], [game], off, now + 15000, noFrame);
  assert.equal(repeat.status, 'live');
  assert.deepEqual(repeat.map.score, [4, 5]);
  const last = fixture();
  const final = () => ({ phase: 'second', map: 'de_inferno', tr: 'M80', ct: 'HEROIC', ctScore: 13, trScore: 9, rounds: 22 });
  await addRoundScores([last], [repeat], off, now + 60000, final);
  assert.equal(last.status, 'live');
  assert.equal(last.awaitingOfficial, true);
  const ended = { ...fixture(), status: 'end', map: null, series: [1, 0] };
  await addRoundScores([ended], [last], off, now + 75000, noFrame);
  assert.equal(ended.awaitingOfficial, undefined);
  assert.deepEqual(ended.map.score, [13, 9]);
  const corrected = { ...ended, map: null, series: [0, 1] };
  await addRoundScores([corrected], [last], off, now + 75000, noFrame);
  assert.equal(corrected.map, null);
});

test('neither schedule, old round, warmup nor a different broadcast can start a match', async () => {
  const game = fixture();
  const warmup = { warmup: true, phase: 'first', map: 'de_inferno', ct: 'HEROIC', tr: 'M80', ctScore: 0, trScore: 0, rounds: 0 };
  for (const frame of [null, warmup, { ...warmup, warmup: false, tr: 'Liquid' }]) {
    const row = { ...game };
    await addRoundScores([row], [], off, now, () => frame);
    assert.equal(row.status, 'upcoming');
    assert.equal(row.map, undefined);
  }
  const future = { ...game, at: now + 3600000 };
  await addRoundScores([future], [], () => assert.fail('too early'), now, () => assert.fail('too early'));
  const cached = { ...game, coverage: { id: '46756', reversed: false } };
  for (const events of [
    [{ map: { name: 'de_inferno' }, scoreA: 0, scoreB: 0, title: 'Pré-jogo', eventDate: now / 1000 }],
    [{ map: { name: 'de_inferno' }, scoreA: 4, scoreB: 5, eventDate: now / 1000 - 720 }],
  ]) {
    const row = { ...game };
    await addRoundScores([row], [cached], async () => Response.json({ data: events }), now, noFrame);
    assert.equal(row.status, 'upcoming');
  }
});

test('a positive round from the matching DRAFT5 playoff or Swiss game starts the same fixture with reversed teams', async () => {
  for (const [stage, round, subtitle] of [[2, 3, 'Stage 2<br>Rodada #3'], [4, 2, 'Playoffs<br>Semifinal'], [4, 4, 'Grande Final']]) {
    const g = { ...fixture(), bo: stage === 4 && round === 4 ? 5 : 3, a: 0, b: 1, round };
    const teams = [{ id: 'g2', name: 'G2', short: 'G2' }, { id: 'liquid', name: 'Liquid', short: 'LIQ' }];
    const coverage = coverageContext(teams, { games: [], links: [] }, stage);
    const fetcher = async url => {
      if (url === 'https://draft5.gg/') return new Response('<a href="/partida/555-Liquid-vs-G2-PGL-Major-Singapore-2026">');
      if (url.endsWith('/live')) return Response.json({ data: [{ scoreA: 2, scoreB: 5, map: { name: 'de_nuke' }, eventDate: now / 1000 }] });
      return Response.json({ data: { teamA: { teamName: 'Liquid' }, teamB: { teamName: 'G2' },
        tournament: { tournamentId: 1801 }, bestOf: g.bo, matchParticularity: subtitle } });
    };
    await addRoundScores([g], [], fetcher, now, noFrame, coverage);
    assert.equal(g.liveSource, 'DRAFT5');
    assert.deepEqual(g.map.score, [5, 2]);
  }
});
