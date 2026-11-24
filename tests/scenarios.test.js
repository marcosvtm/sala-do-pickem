import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  defaults,
  validate,
  newDraft,
  personalSettings,
} from '../dist/js/state.js';
import {
  BASE_MODELS,
  PRESETS,
  makeMatrix,
  fieldStrength,
  mixWeights,
  mixPercentages,
} from '../dist/js/models.js';
import { project, fixProjected, mergeOfficial, kickoffCountdown } from '../dist/js/bracket.js';
import { currentGames } from '../dist/js/schedule.js';
import { parseSchedule } from '../server/agenda.js';
import { openDb } from '../scripts/local-db.js';
import { cardsApi } from '../server/api.js';
import { CLOSE } from '../server/results.js';
import stage from '../dist/data/stage.json' with { type: 'json' };
import agenda from '../dist/data/schedule.json' with { type: 'json' };

test('bracket countdown changes format at an hour and stops at kickoff', () => {
  const now = Date.UTC(2026, 10, 24);
  for (const [delta, display] of [
    [360000000, '100:00:00'], [3600000, '01:00:00'], [3599000, '59:59'],
    [601000, '10:01'], [1, '00:01'], [0, '00:00'], [-3000, '00:00'],
  ]) assert.equal(kickoffCountdown(now + delta, now), display);
});

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
  const rows = agenda.games.map((g) => ({
    leftTeamKey: 'heroic', rightTeamKey: 'imperial_esports', leftScore: 0, rightScore: 0,
    format: 'BO' + g.bo, date: '24.11.2026', round: g.round === 1 ? 'opening round' : 'round ' + g.round,
    time: '12:00', timeZone: 'SGT', status: 'upcoming', maps: [{map: 'de_nuke', leftScore: 8, rightScore: 7}],
  }));
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
  const s = defaults(stage.card);
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

test('five-way mixes average series probabilities and retain team adjustments', () => {
  const s = newDraft();
  s.trust[3] = 25;
  s.bonus[6] = 8;
  const pure = {};
  for (const key of PRESETS) {
    const weights = Object.fromEntries(
      PRESETS.map((k) => [k, k === key ? 31 : 0])
    );
    const previous = { ...personalSettings(s), base: key, weight: 100 };
    delete previous.weights;
    pure[key] =
      key === 'neutral'
        ? makeMatrix(stage.teams, 'neutral', s)
        : makeMatrix(stage.teams, 'custom', previous);
    assert.deepEqual(
      makeMatrix(stage.teams, 'custom', { ...s, weights }),
      pure[key]
    );
  }
  s.weights = { neutral: 8, vrs: 5, hltv: 2, elo: 1, study: 4 };
  const matrix = makeMatrix(stage.teams, 'custom', s);
  for (const bo of [1, 3]) {
    for (let a = 0; a < 16; a++) {
      for (let b = 0; b < 16; b++) {
        const expected =
          PRESETS.reduce(
            (sum, k) => sum + s.weights[k] * pure[k][bo][a][b],
            0
          ) / 20;
        assert.ok(Math.abs(matrix[bo][a][b] - expected) < 1e-12);
        assert.ok(Math.abs(matrix[bo][a][b] + matrix[bo][b][a] - 1) < 1e-12);
      }
    }
  }
  const scaled = { neutral: 80, vrs: 50, hltv: 20, elo: 10, study: 40 };
  assert.deepEqual(
    makeMatrix(stage.teams, 'custom', { ...s, weights: scaled }),
    matrix
  );
  const zeros = { neutral: 0, vrs: 0, hltv: 0, elo: 0, study: 0 };
  assert.deepEqual(
    makeMatrix(stage.teams, 'custom', { ...s, weights: zeros }),
    pure.neutral
  );
  assert.deepEqual(mixPercentages(zeros), {
    neutral: 100,
    vrs: 0,
    hltv: 0,
    elo: 0,
    study: 0,
  });
  assert.deepEqual(mixPercentages({ ...zeros, vrs: 1, hltv: 1, elo: 1 }), {
    neutral: 0,
    vrs: 33.3,
    hltv: 33.3,
    elo: 33.3,
    study: 0,
  });
  assert.deepEqual(mixWeights({ base: 'hltv', weight: 51 }), {
    ...zeros,
    neutral: 49,
    hltv: 51,
  });
  for (const invalid of [
    null,
    {},
    { ...s.weights, elo: 101 },
    { ...s.weights, vrs: 0.5 },
    { ...s.weights, fake: 0 },
    { ...s.weights, study: null },
    { ...s.weights, study: -1 },
  ]) {
    assert.equal(validate({ ...s, weights: invalid }, { draft: true }), false);
  }
  assert.equal(
    validate({ ...s, base: 'vrs', weight: 50 }, { draft: true }),
    false
  );
});

test('study trust interpolates between the original matchup and an average opponent', () => {
  const s = newDraft();
  s.weights = { neutral: 0, vrs: 0, hltv: 0, elo: 0, study: 100 };
  const original = makeMatrix(stage.teams, 'study', s);
  assert.deepEqual(makeMatrix(stage.teams, 'custom', s), original);
  const a = 15,
    b = 7;
  s.trust[a] = 50;
  const adjusted = makeMatrix(stage.teams, 'custom', s);
  for (const bo of [1, 3]) {
    const averageAgainstB = 1 - fieldStrength(original[bo])[b];
    const expected = (original[bo][a][b] + averageAgainstB) / 2;
    assert.ok(Math.abs(adjusted[bo][a][b] - expected) < 1e-12);
    assert.ok(Math.abs(adjusted[bo][b][a] - (1 - expected)) < 1e-12);
    assert.equal(adjusted[bo][0][1], original[bo][0][1]);
  }
});

test('legacy four-weight models retain their probabilities and serialized settings', () => {
  const settings = newDraft();
  settings.weights = { neutral: 25, vrs: 50, hltv: 10, elo: 15 };
  const explicit = { ...settings, weights: { ...settings.weights, study: 0 } };
  assert.ok(validate(settings, { draft: true }));
  assert.equal(mixWeights(settings).study, 0);
  assert.deepEqual(personalSettings(explicit).weights, settings.weights);
  assert.equal(
    JSON.stringify(personalSettings(settings)),
    JSON.stringify(personalSettings(explicit))
  );
  const oldMix = makeMatrix(stage.teams, 'custom', settings);
  const parts = Object.entries(settings.weights).map(([key, points]) => [
    makeMatrix(stage.teams, key, settings),
    points / 100,
  ]);
  for (const bo of [1, 3]) {
    oldMix[bo].forEach((row, a) =>
      row.forEach((p, b) => {
        const expected = parts.reduce(
          (sum, [m, w]) => sum + m[bo][a][b] * w,
          0
        );
        assert.ok(Math.abs(p - expected) < 1e-12);
      })
    );
  }
});

test('new Elo and archived Elo retain their own matchup probabilities across personal versions', () => {
  const fresh = newDraft();
  fresh.weights = { neutral: 0, vrs: 0, hltv: 0, elo: 100 };
  const old = { ...fresh };
  delete old.formVersion;
  assert.equal(fresh.formVersion, 2);
  const fixture = (state) => makeMatrix(stage.teams, 'elo', state)[1][15][7];
  assert.ok(Math.abs(fixture(old) - 0.6897528426259973) < 1e-10);
  assert.ok(Math.abs(fixture(fresh) - 0.6181103163) < 1e-9);
  for (const draft of [fresh, old, { ...old, formVersion: 1 }]) {
    const saved = personalSettings(draft);
    assert.equal(
      makeMatrix(stage.teams, 'custom', saved)[1][15][7],
      fixture(draft)
    );
  }
  assert.deepEqual(
    personalSettings(old),
    personalSettings({ ...old, formVersion: 1 })
  );
  assert.equal(validate({ ...fresh, formVersion: 3 }, { draft: true }), false);
  assert.ok(
    stage.teams.every(
      ({ formEvidence: e }) =>
        e.externalOpponents <= e.opponents &&
        e.opponents <= e.series &&
        e.externalSeries + e.unknownSeries <= e.series
    )
  );
});

test('mixed weights round trip through both a shared model and a saved card', async () => {
  const db = openDb(),
    state = newDraft();
  state.weights = { neutral: 0, vrs: 20, hltv: 66, elo: 13, study: 41 };
  state.bonus[4] = 3;
  state.card = [...stage.card];
  db.sqlite.function('unixepoch', () => CLOSE / 1000 - 15);
  try {
    for (const path of ['models', 'cards']) {
      const id = randomUUID(),
        body = { id, nick: 'Misto' };
      if (path === 'cards') body.state = state;
      else body.settings = personalSettings(state);
      const res = await cardsApi(
        new Request('https://example.org/api/' + path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
        db,
        CLOSE - 1000
      );
      assert.ok(res.ok);
      const { id: saved } = await res.json();
      const model = await (
        await cardsApi(
          new Request('https://example.org/api/models/' + saved),
          db
        )
      ).json();
      assert.deepEqual(personalSettings(model), personalSettings(state));
    }
  } finally {
    db.sqlite.close();
  }
});

test('publish and share a standalone model without picks; retries and changed versions remain distinct', async () => {
  const db = openDb(),
    state = { ...defaults(Array(10).fill(-1)), base: 'hltv', weight: 50 };
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
