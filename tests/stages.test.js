import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDb } from '../scripts/local-db.js';
import { cardsApi } from '../server/api.js';
import { CLOSE } from '../server/results.js';
import stageOne from '../dist/data/stage.json' with { type: 'json' };
import { defaults, newDraft, validate } from '../dist/js/state.js';
import { copyTeamSettings } from '../dist/js/previous-models.js';
import { findStage, stageCatalog } from '../server/stages.js';

const secondId = 'sg26-s2-v1';

test('phase badges distinguish confirmed live play, a break, the pick deadline and completion', () => {
  const now = CLOSE + 4000000;
  const locks = Array(33).fill(-1);
  const snapshot = (game, checked, winners = locks) => [{
    stage: stageOne.id, locks: JSON.stringify(winners),
    schedule: JSON.stringify({ games: [{ status: game }], checked }),
  }];
  const status = rows => stageCatalog(now, rows).stages[0].displayStatus;
  assert.equal(stageCatalog(CLOSE - 1).stages[0].displayStatus, 'picks-open');
  assert.equal(status(snapshot('upcoming', now)), 'starting');
  assert.equal(status(snapshot('live', now)), 'live');
  assert.equal(status(snapshot('live', now - 180001)), 'in-progress');
  assert.equal(status(snapshot('end', now)), 'in-progress');
  assert.equal(status(snapshot('live', now, Array(33).fill(0))), 'completed');
  assert.deepEqual(stageCatalog(now).stages.slice(1).map(s => [s.displayStatus, s.startDate]),
    [['future', '28/11'], ['future', '02/12'], ['future', '10/12']]);
});

test('pick windows follow the last scheduled MD3 plus three hours and require a confirmed roster', async () => {
  const at = Date.parse('2026-11-27T10:00:00-04:00');
  const dates = stageCatalog(at).stages.map(stage => stage.opensNotBefore);
  assert.deepEqual(dates, [null, at, Date.parse('2026-12-01T10:00:00-04:00'), Date.parse('2026-12-06T10:00:00-04:00')]);
  const phase = findStage(secondId);
  const db = openDb();
  const original = phase.readResults;
  try {
    const delayed = at + 90 * 60000;
    const games = [1, 2, 3].map(slot => ({ round: 5, bo: 3, slot, at: delayed - (6 - slot) * 3600000 }));
    db.sqlite.prepare('INSERT INTO stage_results(stage,locks,schedule,checked,attempted) VALUES(?,?,?,1,1)')
      .run(stageOne.id, JSON.stringify(Array(33).fill(-1)), JSON.stringify({ games }));
    const detail = now => cardsApi(request('stage?stage=' + secondId), db, now).then(response => response.json());
    assert.equal((await detail(delayed + 1)).status, 'preparing');
    phase.rosterConfirmed = true;
    phase.readResults = async () => ({ locks: Array(33).fill(-1) });
    const catalog = await (await cardsApi(request('stages'), db, at)).json();
    assert.equal(catalog.stages[1].opensNotBefore, delayed);
    assert.equal((await detail(delayed - 1)).picksOpen, false);
    const early = await cardsApi(new Request('https://example.org/api/cards?stage=' + secondId, { method: 'POST' }), db, delayed - 1);
    assert.equal(early.status, 409);
    assert.equal((await detail(delayed)).picksOpen, true);
    assert.equal((await detail(phase.closesAt)).status, 'locked');
  } finally {
    phase.rosterConfirmed = false;
    if (original) phase.readResults = original;
    else delete phase.readResults;
    db.sqlite.close();
  }
});

test('copying a model carries adjustments by PGL id, including legacy logo ids, with fresh arrays', () => {
  const model = newDraft(stageOne.id);
  model.trust[2] = 45;
  model.bonus[2] = 5;
  model.bonus[6] = -6;
  const ranked = stageOne.teams.map(team => ({ name: team.name, id: team.logo.split('.')[0] })).reverse();
  ranked[9] = { id: 'newcomer', name: 'Nova equipe' };
  const { settings, adjusted } = copyTeamSettings(model, stageOne.teams, ranked);
  assert.deepEqual(adjusted, [stageOne.teams[2].name]);
  assert.equal(settings.trust[13], 45);
  assert.equal(settings.bonus[13], 5);
  assert.equal(settings.trust[9], 100);
  assert.equal(settings.bonus[9], 0);
  settings.weights.study = 0;
  assert.equal(model.weights.study, 20);
  assert.equal(model.bonus[6], -6);
});

test('pausing Stage 2 blocks card writes while preserving saved cards, models and links', async () => {
  const phase = findStage(secondId);
  const original = { ...phase };
  const now = phase.closesAt - 60000;
  const db = openDb();
  const id = randomUUID(), key = randomUUID(), modelId = randomUUID();
  phase.rosterConfirmed = true;
  phase.readResults = async () => ({ locks: Array(33).fill(-1), stale: false });
  db.sqlite.function('unixepoch', () => Math.floor(now / 1000));
  const query = (path, method, body, paused = false) => cardsApi(new Request(
    'https://example.org/api/' + path + '?stage=' + secondId, {
      method, headers: { 'Content-Type': 'application/json', 'X-Card-Key': key },
      ...(body && { body: JSON.stringify(body) }),
    }), db, now, undefined, undefined, paused ? secondId : null);
  try {
    const state = defaults(stageOne.card, secondId);
    assert.equal((await query('cards', 'POST', { id, nick: 'Jogador', state })).status, 201);
    assert.equal((await query('models', 'POST', { id: modelId, nick: 'Jogador', settings: state })).status, 200);
    const read = async (path, paused) => (await query(path, 'GET', null, paused)).json();
    const card = await read('cards/' + id), model = await read('models/m-' + modelId);
    assert.equal((await read('stage', true)).picksOpen, false);
    assert.equal((await query('cards', 'POST', { id: randomUUID(), nick: 'Outro', state }, true)).status, 409);
    for (const method of ['PUT', 'DELETE'])
      assert.equal((await query('cards/' + id, method, { revision: 1, state, nick: 'Jogador' }, true)).status, 409);
    assert.deepEqual(await read('cards/' + id, true), card);
    assert.deepEqual(await read('models/m-' + modelId, true), model);
    assert.equal((await read('stage', false)).picksOpen, true);
    assert.deepEqual(await read('cards/' + id), card);
  } finally {
    Object.assign(phase, original);
    if (!original.readResults) delete phase.readResults;
    db.sqlite.close();
  }
});
const request = (path, method = 'GET', body) =>
  new Request('https://example.org/api/' + path, {
    method,
    ...(body && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });

test('stage catalog keeps the legacy cutoff and does not unlock a stage waiting for confirmation', async () => {
  const time = CLOSE - 1;
  const catalog = await (await cardsApi(request('stages'), null, time)).json();
  const [s1, s2] = catalog.stages;
  assert.equal(catalog.defaultStage, stageOne.id);
  assert.equal(s1.picksOpen, true);
  assert.equal(s1.closesAt, CLOSE);
  assert.equal(s2.id, secondId);
  assert.equal(s2.status, 'preparing');
  assert.equal(s2.rosterConfirmed, false);
  assert.equal(s2.picksOpen, false);
  assert.equal(new Date(s2.startsAt).toISOString(), '2026-11-28T04:00:00.000Z');
  assert.equal(s2.startsAt - s2.closesAt, 3600000);
  assert.equal((await (await cardsApi(request('stage'), null, CLOSE)).json()).status, 'locked');
  const detail = await (await cardsApi(request('stage?stage=' + secondId), null, s2.closesAt - 1)).json();
  assert.equal(detail.picksOpen, false);
  assert.equal(detail.invitedTeams.length, 8);
  assert.equal(new Set(detail.invitedTeams.map(team => team.id)).size, 8);
  assert.ok(detail.invitedTeams.every(team => typeof team.name === 'string' && team.name.length > 0));
  assert.equal((await cardsApi(request('cards?stage=unknown'), null, time)).status, 404);
  assert.equal((await cardsApi(request('cards?stage=' + stageOne.id + '&stage=' + secondId), null, time)).status, 400);
});

test('the Stage 2 calendar presents the 33 scheduled series as a dated preview with no teams or results', async () => {
  const calendar = await (await cardsApi(request('results?stage=' + secondId), null)).json();
  assert.equal(calendar.stage, secondId);
  assert.equal(calendar.source, 'https://news.pglesports.com/api/groupStageEndpoint?stage=2');
  assert.equal(calendar.asOf, '2026-11-24');
  assert.equal(calendar.preview, true);
  assert.equal(calendar.scheduleChecked, null);
  assert.deepEqual(calendar.locks, Array(33).fill(-1));
  assert.deepEqual([1, 2, 3, 4, 5].map(round => calendar.schedule.filter(g => g.round === round).length), [8, 8, 8, 6, 3]);
  assert.equal(new Set(calendar.schedule.map(g => g.round + '/' + g.slot)).size, 33);
  assert.ok(calendar.schedule.every(g => g.a === null && g.b === null && g.status === 'upcoming'));
  assert.equal(calendar.schedule.filter(g => g.round === 3 && g.bo === 3).length, 4);
});

test('stage-scoped drafts and the server keep mismatched, unconfirmed and legacy cards and models isolated', async () => {
  const db = openDb();
  const now = CLOSE - 1;
  db.sqlite.function('unixepoch', () => Math.floor(now / 1000));
  const legacy = defaults(stageOne.card);
  const second = defaults(stageOne.card, secondId);
  const draft = newDraft(secondId);
  assert.ok(validate(draft, { draft: true, stageId: secondId }));
  assert.equal(validate(draft, { draft: true }), false);
  assert.equal(validate(legacy, { stageId: secondId }), false);
  const id = randomUUID(), modelId = randomUUID(), nick = 'Participante';
  const card = { id, nick, state: legacy };
  const model = { id: modelId, nick, settings: legacy };
  const read = async (path) => (await cardsApi(request(path), db, now)).json();
  const send = async (path, method, body) => (await cardsApi(request(path, method, body), db, now)).status;
  try {
    assert.equal(await send('cards', 'POST', card), 201);
    assert.equal(await send('models', 'POST', model), 200);
    const savedCard = await read('cards/' + id);
    const savedModel = await read('models/m-' + modelId);
    assert.deepEqual(await read('cards/' + id + '?stage=' + stageOne.id), savedCard);
    assert.deepEqual(await read('models/m-' + modelId + '?stage=' + stageOne.id), savedModel);
    for (const [route, method, body] of [
      ['cards', 'POST', card], ['cards/' + id, 'PUT', card], ['cards/' + id, 'DELETE', { revision: 1 }],
      ['models', 'POST', model], ['stage/cards', 'GET'], ['cards', 'GET'], ['ranking', 'GET'],
      ['cards/' + id, 'GET'], ['models/m-' + modelId, 'GET'],
    ]) {
      assert.equal(await send(route + '?stage=' + secondId, method, body), 409, method + ' ' + route);
    }
    assert.equal(await send('models', 'POST', { ...model, settings: second }), 400);
    assert.equal(await send('cards', 'POST', { ...card, state: second }), 400);
    assert.equal(await send('cards/' + id, 'DELETE', { stage: secondId, revision: 1 }), 400);
    assert.deepEqual(await read('cards/' + id), savedCard);
    assert.deepEqual(await read('models/m-' + modelId), savedModel);
    for (const table of ['cards', 'personal_models', 'stage_results'])
      assert.equal(db.sqlite.prepare('SELECT count(*) n FROM ' + table + ' WHERE stage=?').get(secondId).n, 0);
  } finally {
    db.sqlite.close();
  }
});
