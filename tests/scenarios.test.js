import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { defaults, validate } from '../dist/js/state.js';
import { project, fixProjected, mergeOfficial } from '../dist/js/bracket.js';
import { currentGames } from '../dist/js/schedule.js';
import { parseSchedule } from '../server/agenda.js';
import { openDb } from '../scripts/local-db.js';
import { cardsApi } from '../server/api.js';
import { CLOSE } from '../server/results.js';
import stage from '../dist/data/stage.json' with { type: 'json' };
import agenda from '../dist/data/schedule.json' with { type: 'json' };

test('exploratory picks alter the draw; future locks preserve the exact opponents and clear invalidated rounds', () => {
  const s = defaults(stage.card),
    official = [...s.locks],
    previews = new Map();
  const before = project(s.locks, official, previews);
  previews.set(before.games[0].key, before.games[0].b);
  const after = project(s.locks, official, previews);
  assert.notDeepEqual(after.games.slice(8, 16), before.games.slice(8, 16));
  assert.deepEqual(s.locks, official);
  const g = after.games[24];
  fixProjected(s.locks, official, after.games, g, 1);
  assert.ok(validate(s));
  assert.equal(s.locks.filter((x) => x >= 0).length, 25);
  const confirmed = project(s.locks, official, new Map());
  assert.deepEqual([confirmed.games[24].a, confirmed.games[24].b], [g.a, g.b]);
  official[0] = 0;
  const merged = mergeOfficial(s.locks, official);
  assert.equal(merged[0], 0);
  assert.ok(merged.slice(8).every((v) => v === -1));
  const fixed = s.locks[0];
  fixProjected(s.locks, official, after.games, after.games[0], 1);
  assert.equal(s.locks[0], fixed);
});
test('agenda switches between two rounds on the same date using status, preserves live matches and has 33 HLTV fixtures', () => {
  const games = structuredClone(agenda.games);
  assert.equal(games[0].at, Date.parse(stage.startsAt));
  assert.equal(new Set(agenda.links).size, 33);
  games.slice(0, 8).forEach((g) => (g.status = 'end'));
  games[8].status = 'live';
  assert.deepEqual(
    currentGames(games).map((g) => g.round),
    Array(8).fill(2)
  );
  assert.equal(currentGames(games)[0].status, 'live');
  const rows = agenda.games
    .map(
      (g) =>
        '{leftTeam:"A",leftTeamKey:"heroic",rightTeamKey:"imperial_esports",leftScore:0,rightScore:0,format:"BO' +
        g.bo +
        '",date:"24.11.2026",round:"' +
        (g.round === 1 ? 'opening round' : 'round ' + g.round) +
        '",time:"12:00",timeZone:"SGT",status:"upcoming",maps:[{map:"de_nuke",leftScore:8,rightScore:7}]}'
    )
    .join(',');
  const live = parseSchedule(rows)[0];
  assert.equal(live.status, 'live');
  assert.deepEqual(live.map, { name: 'nuke', score: [8, 7] });
  assert.equal(live.at, games[0].at);
});
test('a public model is accessible by stable id even for a card scored with a preset; copies do not change the saved model', async () => {
  const db = openDb(),
    id = randomUUID(),
    state = defaults(stage.card);
  state.description = 'Hipótese de João';
  state.trust[13] = 31;
  db.sqlite.function('unixepoch', () => CLOSE / 1000 - 5);
  const request = (path) => new Request('https://example.org' + path);
  const res = await cardsApi(
    new Request('https://example.org/api/cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, nick: 'João', state }),
    }),
    db,
    CLOSE - 3000
  );
  assert.equal(res.status, 201);
  const list = await (await cardsApi(request('/api/models?page=0'), db)).json();
  assert.deepEqual(list.models, [{ id, nick: 'João' }]);
  const read = async () =>
    await (await cardsApi(request('/api/models/' + id), db)).json();
  const copy = await read();
  assert.equal(copy.description, state.description);
  assert.equal(copy.card, undefined);
  copy.trust[13] = 0;
  assert.equal((await read()).trust[13], 31);
  assert.equal((await cardsApi(request('/api/models/bad-id'), db)).status, 404);
  db.sqlite.close();
});
