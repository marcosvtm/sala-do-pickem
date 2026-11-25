import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../scripts/local-db.js';
import { emptyLocks, liveResults } from '../server/results.js';
import { matchLink } from '../dist/js/schedule.js';
import stage from '../dist/data/stage.json' with { type: 'json' };
import calendar from '../dist/data/schedule.json' with { type: 'json' };

test('a temporary PGL outage still refreshes live rounds from a verified fixture without settling picks', async () => {
  const game = calendar.games[0];
  const now = game.at + 5 * 60000;
  const checked = now - 90000;
  const db = openDb();
  const id = 'cs2-match-' + new URL(matchLink(game, calendar)).pathname.split('/')[2];
  const state = {
    entityType: 'cs2_live_state', matchId: id, status: 'live', source: 'live', dataAvailable: true,
    teams: { team1Name: stage.teams[game.a].name, team2Name: stage.teams[game.b].name },
    currentMap: 'de_ancient', currentRound: 5, score: { team1: 3, team2: 1 },
    ctTeam: 'team1', tTeam: 'team2', lastVerified: new Date(now).toISOString(),
  };
  const chunk = '1:' + JSON.stringify(['$', 'main', { initialState: state }]) + '\n';
  const fetcher = async url => {
    if (url.startsWith('https://cito.gg/matches/' + id))
      return new Response('<script>self.__next_f.push(' + JSON.stringify([1, chunk]) + ')</script>');
    return new Response(null, { status: 503 });
  };
  try {
    db.sqlite.prepare('INSERT INTO stage_results(stage,locks,checked,attempted,schedule) VALUES(?,?,?,?,?)')
      .run(stage.id, JSON.stringify(emptyLocks()), checked, checked, JSON.stringify({ games: [game], checked }));
    const result = await liveResults(db, now, fetcher, true);
    assert.equal(result.checked, checked);
    assert.deepEqual(result.locks, emptyLocks());
    assert.equal(result.scheduleChecked, now);
    assert.equal(result.schedule[0].status, 'live');
    assert.equal(result.schedule[0].map.name, 'ancient');
    assert.deepEqual(result.schedule[0].map.score, [3, 1]);
  } finally { db.sqlite.close(); }
});
