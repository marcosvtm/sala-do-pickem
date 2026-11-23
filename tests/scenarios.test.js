import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  defaults,
  validate,
  newDraft,
  personalSettings,
} from '../dist/js/state.js';
import { BASE_MODELS, makeMatrix, fieldStrength } from '../dist/js/models.js';
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
  assert.deepEqual(list.models, [
    { id, nick: 'João', source: 'card', submitted: CLOSE / 1000 - 5 },
  ]);
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

test('personal weights have exact endpoints; team confidence and Major adjustments preserve reciprocity', () => {
  const s = newDraft();
  for (const base of BASE_MODELS) {
    s.base = base;
    s.weight = 100;
    s.bonus.fill(0);
    s.trust.fill(100);
    const original = makeMatrix(stage.teams, base, s);
    assert.deepEqual(makeMatrix(stage.teams, 'custom', s), original);
    s.weight = 40;
    const middle = makeMatrix(stage.teams, 'custom', s);
    for (const bo of [1, 3]) {
      assert.equal(middle[bo][0][6], 0.5 + 0.4 * (original[bo][0][6] - 0.5));
      assert.equal(
        fieldStrength(original[bo])[0],
        original[bo][0].slice(1).reduce((sum, p) => sum + p, 0) / 15
      );
    }
    s.weight = 100;
    s.trust.fill(0);
    s.bonus[0] = 5;
    for (const bo of [1, 3]) {
      const tuned = makeMatrix(stage.teams, 'custom', s)[bo];
      assert.ok(Math.abs(tuned[0][6] - 0.55) < 1e-12);
      assert.ok(Math.abs(tuned[0][6] + tuned[6][0] - 1) < 1e-12);
    }
    s.weight = 0;
    assert.ok(
      Object.values(makeMatrix(stage.teams, 'custom', s))
        .flat(2)
        .every((p) => p === 0.5)
    );
  }
});

test('publish and share a standalone model without picks; retries and changed versions remain distinct', async () => {
  const db = openDb(),
    state = newDraft();
  state.base = 'hltv';
  state.trust[13] = 42;
  state.bonus[13] = 3;
  const id = randomUUID(),
    nick = 'Equipe Brasil';
  const save = (settings, token = id) =>
    cardsApi(
      new Request('https://example.org/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: token, nick, settings }),
      }),
      db
    );
  const get = async (path) =>
    (await cardsApi(new Request('https://example.org' + path), db)).json();
  const settings = personalSettings(state);
  const first = await (await save(settings)).json();
  assert.equal(first.id, 'm-' + id);
  assert.deepEqual(await (await save(settings, randomUUID())).json(), first);
  const next = await (
    await save({ ...settings, weight: 70 }, randomUUID())
  ).json();
  assert.notEqual(next.id, first.id);
  assert.equal((await get('/api/models/' + first.id)).weight, 50);
  assert.equal((await get('/api/models/' + next.id)).weight, 70);
  assert.equal((await get('/api/models')).models.length, 2);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM cards').get().n, 0);
  assert.equal((await save({ ...settings, base: 'custom' })).status, 400);
  assert.equal((await save({ ...settings, weight: -1 })).status, 400);
  db.sqlite.close();
});
