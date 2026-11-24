import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDb } from '../scripts/local-db.js';
import { cardsApi } from '../server/api.js';
import { CLOSE } from '../server/results.js';
import stageOne from '../dist/data/stage.json' with { type: 'json' };
import { defaults, newDraft, validate } from '../dist/js/state.js';

const secondId = 'sg26-s2-v1';
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
      ['cards/' + id, 'GET'], ['models/m-' + modelId, 'GET'], ['ranking/' + id + '/perfil', 'GET'],
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
