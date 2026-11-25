import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { openDb } from '../scripts/local-db.js';
import { cardsApi } from '../server/api.js';
import { findStage, navigationCatalog } from '../server/stages.js';
import { defaults } from '../dist/js/state.js';
import { majorPhases, selectedPhase } from '../dist/js/major-phases.js';

const [first, second] = majorPhases;
test('an original receipt recovers the same participant across stages and devices without sharing edit access', async () => {
  const db = openDb();
  const s2 = findStage(second.id);
  let now = findStage(first.id).closesAt - 1000;
  const live = async () => ({ locks: Array(33).fill(0), stale: false });
  const keys = { first: randomUUID(), second: randomUUID() };
  const ids = { first: randomUUID(), second: randomUUID() };
  const code = randomBytes(16).toString('hex');
  const original = defaults(Array.from({ length: 10 }, (_, i) => i));
  const make = (id, nick, state) => ({ id, nick, state });
  const query = (path, method = 'GET', headers = {}, body) => cardsApi(
    new Request('https://example.org/api/' + path, {
      method, headers: { 'Content-Type': 'application/json', ...headers },
      body: body && JSON.stringify(body),
    }), db, now, async () => { throw Error('fixture offline'); }
  );
  const proof = { 'X-Major-Code': code, 'X-Participant-Card': ids.first, 'X-Card-Key': keys.first };
  try {
    db.sqlite.function('unixepoch', () => Math.floor(now / 1000));
    assert.equal((await query('cards', 'POST', { 'X-Card-Key': keys.first },
      make(ids.first, 'Antigo', original))).status, 201);
    // A migrated Stage 1 row still uses its original ID and receipt.
    db.sqlite.prepare('UPDATE cards SET participant_id=NULL WHERE id=?').run(ids.first);
    assert.equal((await query('participant', 'POST', { ...proof, 'X-Card-Key': randomUUID() })).status, 403);
    assert.equal((await query('participant', 'POST', proof)).status, 200);
    assert.equal((await query('participant', 'POST', proof)).status, 200);
    const recovered = await (await query('participant', 'GET', { 'X-Major-Code': code })).json();
    assert.deepEqual(recovered, { id: ids.first, nick: 'Antigo' });
    assert.notEqual(db.sqlite.prepare('SELECT recovery_hash FROM participants').get().recovery_hash, code);
    assert.equal((await query('cards/' + ids.first, 'DELETE', { 'X-Major-Code': code }, { revision: 1 })).status, 403);

    // Rehearse a confirmed second stage only in this isolated database.
    now = s2.closesAt - 60000;
    s2.rosterConfirmed = true;
    s2.readResults = live;
    const route = 'cards?stage=' + second.id;
    const settings = { ...original, stage: second.id };
    const headers = { 'X-Card-Key': keys.second, 'X-Major-Code': code };
    const card = make(ids.second, 'Novo nick', settings);
    assert.equal((await query(route, 'POST', { ...headers, 'X-Major-Code': 'bad' }, card)).status, 403);
    assert.equal((await query(route, 'POST', headers, card)).status, 201);
    assert.equal((await query(route, 'POST', headers, card)).status, 200);
    assert.equal((await query(route, 'POST', headers, make(randomUUID(), 'Duplicado', settings))).status, 409);
    assert.equal((await query(route, 'POST', {}, make(randomUUID(), 'Antigo', settings))).status, 201);
    const ranking = await (await query('ranking/geral')).json();
    assert.equal(ranking.rows.length, 2);
    const player = ranking.rows.find(p => p.id === ids.first);
    assert.equal(player.phases[first.id].id, ids.first);
    assert.equal(player.phases[second.id].id, ids.second);
    assert.equal(player.hits, player.phases[first.id].hits + player.phases[second.id].hits);
    assert.equal((await (await query('cards/' + ids.first)).json()).nick, 'Antigo');
  } finally {
    s2.rosterConfirmed = false;
    delete s2.readResults;
    db.sqlite.close();
  }
});

test('only 33 official series promote the next agenda; old shared links still select Stage 1', async () => {
  const db = openDb();
  try {
    const locks = Array(33).fill(0);
    locks[32] = -1;
    const save = db.sqlite.prepare('INSERT OR REPLACE INTO stage_results(stage,locks,checked,attempted) VALUES(?,?,1,1)');
    save.run(first.id, JSON.stringify(locks));
    assert.equal((await navigationCatalog(db, Date.now())).defaultStage, first.id);
    locks[32] = 1;
    save.run(first.id, JSON.stringify(locks));
    assert.equal((await navigationCatalog(db, Date.now())).defaultStage, second.id);
    for (const suffix of ['?simular=abc', '?editar=abc', '?modelo=abc', '#c=old', '?fase=stage-1'])
      assert.equal(selectedPhase(new URL('https://example.org/' + suffix), second.id).id, first.id);
    assert.equal(selectedPhase(new URL('https://example.org/'), second.id).id, second.id);
  } finally { db.sqlite.close(); }
});

test('choosing a public participant links a new stage without granting edit access or merging lookalike nicks', async () => {
  const db = openDb();
  const stage = findStage(second.id);
  const cutoff = findStage(first.id).closesAt;
  let now = cutoff - 1000;
  db.sqlite.function('unixepoch', () => Math.floor(now / 1000));
  const settings = defaults(Array.from({ length: 10 }, (_, i) => i));
  const body = (nick, id = randomUUID()) => ({ id, nick, state: settings });
  const submit = (path, method = 'GET', value, key) => cardsApi(new Request('https://example.org/api/' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(key && { 'X-Card-Key': key }) },
    body: value && JSON.stringify(value),
  }), db, now, async () => { throw Error('offline'); });
  const directory = () => submit('stage/participants?stage=' + second.id).then(res => res.json());
  try {
    const old = body('mr.K'), other = body('mrk');
    for (const entry of [old, other]) assert.equal((await submit('cards', 'POST', entry)).status, 201);
    db.sqlite.prepare('UPDATE cards SET participant_id=NULL WHERE id=?').run(old.id);
    assert.equal((await directory()).participants.length, 2);
    assert.deepEqual((await directory()).participants.find(p => p.id === old.id), { id: old.id, nick: 'mr.K', cardId: null });

    now = stage.closesAt - 60000;
    stage.rosterConfirmed = true;
    stage.readResults = async () => ({ locks: Array(33).fill(-1), stale: false });
    stage.editionVersion = 'ensaio-de-participacao';
    stage.teams = Array.from({ length: 16 }, (_, i) => ({ id: 'participante-ficticio-' + i }));
    const route = 'cards?stage=' + second.id;
    const joined = { ...body('mr.K'), state: { ...settings, stage: second.id }, participantId: old.id };
    const key = randomUUID();
    const aiState = { ...joined.state, model: 'study' };
    assert.equal((await submit(route, 'POST', { ...joined, state: aiState }, key)).status, 409);
    const mixed = { ...joined.state, model: 'custom', weights: {neutral: 10, vrs: 10, hltv: 10, elo: 10, study: 10} };
    assert.equal((await submit(route, 'POST', { ...joined, state: mixed }, key)).status, 409);
    assert.equal((await submit(route, 'POST', { ...joined, participantId: randomUUID() }, key)).status, 409);
    assert.equal((await submit(route, 'POST', { ...joined, nick: 'mrk' }, key)).status, 409);
    assert.equal((await submit(route, 'POST', { ...joined, participantId: null }, key)).status, 409);
    const concurrent = [{ ...joined }, { ...joined, id: randomUUID() }];
    const responses = await Promise.all(concurrent.map(card => submit(route, 'POST', card, key)));
    assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
    const winningCard = concurrent[responses.findIndex(r => r.status === 201)];
    const snapshot = JSON.parse(db.sqlite.prepare('SELECT settings FROM cards WHERE id=?').get(winningCard.id).settings);
    assert.equal(snapshot.editionVersion, stage.editionVersion);
    assert.equal(Object.hasOwn(snapshot, 'studyVersion'), false);
    const duplicate = await responses.find(r => r.status === 409).json();
    assert.equal(duplicate.cardId, winningCard.id);
    assert.equal((await submit(route, 'POST', winningCard, key)).status, 200);
    assert.equal((await directory()).participants.find(p => p.id === old.id).cardId, winningCard.id);
    const editRoute = 'cards/' + winningCard.id + '?stage=' + second.id;
    assert.equal((await submit(editRoute, 'PUT', { ...winningCard, nick: other.nick, revision: 1 }, key)).status, 409);
    assert.equal((await submit(editRoute, 'PUT', { ...winningCard, revision: 1 }, randomUUID())).status, 403);
    assert.equal((await submit(editRoute, 'DELETE', { revision: 1 }, randomUUID())).status, 403);
    const newPerson = { ...winningCard, id: randomUUID(), nick: 'Pessoa nova', participantId: null };
    assert.equal((await submit(route, 'POST', newPerson, randomUUID())).status, 201);
    now = stage.closesAt;
    assert.equal((await submit(route, 'POST', winningCard, key)).status, 200);
    assert.equal((await submit(route, 'POST', { ...newPerson, id: randomUUID(), nick: 'Atrasada' }, randomUUID())).status, 409);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM cards WHERE stage=?').get(second.id).n, 2);
  } finally {
    stage.rosterConfirmed = false;
    delete stage.readResults;
    delete stage.editionVersion;
    delete stage.teams;
    db.sqlite.close();
  }
});
