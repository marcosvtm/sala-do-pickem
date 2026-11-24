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
  const now = findStage(first.id).closesAt - 1000;
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
