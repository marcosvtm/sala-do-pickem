import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { openDb } from '../scripts/local-db.js';
import { cardsApi } from '../server/api.js';
import { stageTwoActivation, STAGE_TWO } from '../server/stage2-activation.js';
import { newDraft } from '../dist/js/state.js';
import { rehearsal } from './fixtures/stage2.js';

const gate = Date.parse('2026-11-27T10:00:00-04:00');
const closed = Date.parse('2026-11-27T23:00:00-04:00');

test('automatic activation requires official results, pairings and both clocks, then survives new requests', async () => {
  const { first, second } = rehearsal();
  const db = openDb();
  const reads = [];
  let now = gate - 1, databaseTime = now;
  db.sqlite.function('unixepoch', () => Math.floor(databaseTime / 1000));
  let stage1 = structuredClone(first), stage2 = structuredClone(second);
  stage1.at(-1).status = 'live';
  const fetcher = async url => {
    reads.push(url);
    if (url.includes('groupStageEndpoint')) return Response.json(url.endsWith('=1') ? stage1 : stage2);
    return new Response(null, { status: 503 });
  };
  const get = async (route, options) => cardsApi(new Request('https://test.invalid' + route, options), db, now, fetcher);
  const clock = value => { now = value; databaseTime = value; };
  const status = async () => (await get('/api/stage2/activation')).json();
  try {
    assert.equal((await status()).picksOpen, false);
    assert.equal(reads.length, 0);
    clock(gate);
    assert.match((await status()).detail, /33 resultados/);
    assert.equal((await status()).picksOpen, false);
    assert.equal(reads.length, 1); // one upstream check for multiple devices
    clock(now + 60000);
    stage1 = first;
    stage2[0].rightTeamKey = '';
    assert.match((await status()).detail, /confrontos/);
    clock(now + 60000);
    stage2 = second;
    // A rescheduled fifth round can move the real opening later than the originally announced time.
    stage1 = structuredClone(first);
    const last = stage1.at(-1);
    last.date = '27.11.2026'; last.time = '20:00';
    assert.match((await status()).detail, /horário/);
    clock(gate + 3600000);
    databaseTime = closed; // the DB deadline wins if network processing crosses the cutoff
    assert.equal((await status()).picksOpen, false);
    clock(now + 60000);
    const open = await status();
    assert.equal(open.picksOpen, true);
    assert.equal(open.opensNotBefore, gate + 3600000);
    assert.equal(open.modelStatus.study, 'pending');
    assert.equal(open.modelStatus.vrs, 'pending');
    assert.equal(open.modelStatus.hltv, 'ready');
    assert.equal(open.modelStatus.elo, 'ready');

    const roster = await (await get('/data/edition-s2.json')).json();
    assert.equal(roster.teams.length, 16);
    assert.equal(roster.editionVersion, open.editionVersion);
    const catalog = await (await get('/api/stages')).json();
    assert.equal(catalog.stages[1].editionVersion, roster.editionVersion);
    assert.equal(catalog.defaultStage, STAGE_TWO);
    assert.equal(catalog.stages[0].completed, true);
    const settings = newDraft(STAGE_TWO, roster.teams, roster.modelStatus);
    settings.card = Array.from({ length: 10 }, (_, i) => i);
    const post = (route, body) => get('/api/' + route + '?stage=' + STAGE_TWO, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post('cards', { id: randomUUID(), nick: 'Teste', state: settings })).status, 201);
    const invalid = { ...settings, weights: { ...settings.weights, study: 1 } };
    assert.equal((await post('models', { id: randomUUID(), nick: 'Mistura IA', settings: invalid })).status, 409);
    assert.equal((await post('models', { id: randomUUID(), nick: 'Mistura', settings })).status, 200);
    const listing = await (await get('/api/cards?stage=' + STAGE_TWO)).json();
    assert.equal(listing.editionVersion, open.editionVersion);
    assert.equal(listing.cards.length, 1);
    clock(closed);
    assert.equal((await status()).picksOpen, false);
    assert.equal((await (await get('/data/edition-s2.json')).json()).editionVersion, roster.editionVersion);
  } finally { db.sqlite.close(); }
});

test('the confirmed roster opens before model providers return and a retry fills only pending predictors', async () => {
  const { first, second } = rehearsal();
  const db = openDb();
  let now = gate, mode = 0, sourceReads = 0;
  db.sqlite.function('unixepoch', () => Math.floor(now / 1000));
  const fetcher = async url => { sourceReads++; return Response.json(url.endsWith('=1') ? first : second); };
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const delay = new Promise(resolve => { release = resolve; });
  const rate = async (teams, games, cutoff) => {
    assert.equal(cutoff, gate);
    assert.equal(games.length, 33);
    if (!mode) { entered(); await delay; }
    return {
      teams: teams.map(t => ({ ...t, hltvRank: mode ? 2 : 1, vrs: mode ? 1200 : null })),
      modelStatus: { hltv: 'ready', vrs: mode ? 'ready' : 'pending' },
      sources: { hltv: mode ? 'changed' : 'first', vrs: 'verified' },
      modelDates: { hltv: mode ? 'changed' : 'first', vrs: 'verified' },
    };
  };
  const refresh = () => stageTwoActivation(db, now, fetcher, { rate });
  try {
    const firstCheck = refresh();
    await started;
    const inFlight = await refresh();
    assert.equal(inFlight.edition.modelStatus.neutral, 'ready');
    assert.equal(inFlight.edition.modelStatus.hltv, 'pending');
    release();
    const opened = await firstCheck;
    mode++;
    now += 300000;
    const [a, b] = await Promise.all([refresh(), refresh()]);
    const enriched = a.edition.modelStatus.vrs === 'ready' ? a.edition : b.edition;
    assert.equal(enriched.version, opened.edition.version);
    assert.equal(enriched.revision, opened.edition.revision + 1);
    assert.deepEqual(enriched.teams.map(t => t.id), opened.edition.teams.map(t => t.id));
    assert.equal(enriched.teams[0].hltvRank, 1);
    assert.equal(enriched.teams[0].vrs, 1200);
    assert.equal(enriched.modelDates.hltv, 'first');
    assert.equal(enriched.sources.hltv, 'first');
    assert.equal(sourceReads, 2); // retry consumes the already-verified Stage 1 history
  } finally { release(); db.sqlite.close(); }
});
