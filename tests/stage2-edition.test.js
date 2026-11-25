import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { prepareEdition, advancingSeeds, ratePool } from '../scripts/prepare-stage2-edition.js';
import { rehearsal, fixtureRows } from './fixtures/stage2.js';
import { createSwissResultReader, emptyLocks } from '../server/results.js';
import { openDb } from '../scripts/local-db.js';
import { sampleRun, exactRun } from '../dist/js/simulation.js';
import { createSearch } from '../dist/js/suggestion-search.js';
import { newDraft } from '../dist/js/state.js';

test('Stage 2 freezes a rated field only after the 33 Stage 1 results agree with all eight PGL opening pairs', () => {
  const { first, second, input, edition } = rehearsal();
  const half = structuredClone(first);
  half.at(-1).status = 'live';
  assert.throws(() => prepareEdition(input, second, half), /33 resultados/);
  const swapped = structuredClone(second);
  [swapped[0].rightTeamKey, swapped[1].rightTeamKey] = [swapped[1].rightTeamKey, swapped[0].rightTeamKey];
  assert.throws(() => prepareEdition(input, swapped, first), /seeds/);
  assert.throws(() => prepareEdition({ ...input, teams: input.teams.slice(1) }, second, first), /forças/);
  assert.throws(() => prepareEdition({ ...input, cutoff: '2026-11-28T03:00:01Z' }, second, first), /corte/);
  assert.equal(edition.teams.length, 16);
  assert.equal(edition.games.length, 33);
  assert.deepEqual(edition.teams.slice(0, 3).map(t => t.id), ['fut_esports', 'nemiga', 'g2_esports']);
  assert.deepEqual(edition.teams.map(t => t.id), prepareEdition({ ...input, teams: [...input.teams].reverse() }, second, first).teams.map(t => t.id));
  const locks = Array.from({ length: 33 }, (_, i) => (i % 3 === 0 ? 1 : 0));
  const promoted = advancingSeeds(locks);
  assert.deepEqual(promoted.map(t => t.id), ['pvision', 'wildcard', 'liquid', 'eternal_fire',
    'lynn_vision_gaming', '9z_globant', '100_thieves', 'gosh']);
});

test('Stage 2 reads its own official schedule and settles its worker results independently in D1', async () => {
  const { edition } = rehearsal();
  const url = 'https://news.pglesports.com/api/groupStageEndpoint?stage=2';
  const read = createSwissResultReader(edition, url);
  const rows = fixtureRows(edition.teams, '28.11.2026', true);
  const db = openDb();
  try {
    const firstId = 'sg26-s1-v1';
    db.sqlite.prepare('INSERT INTO stage_results(stage,locks,checked,attempted) VALUES(?,?,1,1)')
      .run(firstId, JSON.stringify(emptyLocks()));
    const snapshot = await read(db, Date.parse(edition.startsAt), async source => {
      assert.equal(source, url);
      return Response.json(rows);
    }, true);
    assert.equal(snapshot.stale, false);
    assert.deepEqual(snapshot.locks, Array(33).fill(0));
    assert.deepEqual(JSON.parse(db.sqlite.prepare('SELECT locks FROM stage_results WHERE stage=?').get(firstId).locks), emptyLocks());
    assert.equal(snapshot.schedule.filter(g => g.status === 'end').length, 33);
    const state = { ...newDraft(edition.id), model: 'vrs', card: Array.from({ length: 10 }, (_, i) => i),
      locks: snapshot.locks };
    const suggestion = createSearch(edition.teams, state).result();
    assert.equal(suggestion.card.length, 10);
    state.card = suggestion.card;
    const exact = exactRun(edition.teams, state);
    const sample = sampleRun(edition.teams, state, ['vrs']);
    exact.next(); sample.next();
    assert.equal(exact.snapshot().histograms.vrs.slice(5).reduce((sum, value) => sum + value, 0), 1);
    assert.deepEqual(sample.snapshot().histograms.vrs, exact.snapshot().histograms.vrs);
  } finally { db.sqlite.close(); }
});

test('the rated candidate pool incorporates only settled S1 series and detects stale form at installation', t => {
  const interpreter = process.env.STAGE2_PYTHON || (process.platform === 'win32' ? 'py' : 'python3');
  if (spawnSync(interpreter, ['--version']).status !== 0) return t.skip('Python is needed for the historical replay');
  const { first, second } = rehearsal();
  const cutoff = Date.parse('2026-11-27T15:00:00Z');
  const beforeFinal = structuredClone(first);
  beforeFinal.at(-1).status = 'live';
  const pending = ratePool(beforeFinal, cutoff);
  const complete = ratePool(first, cutoff);
  assert.equal(complete.teams.length, 24);
  const finalist = first.at(-1).leftTeamKey;
  const before = pending.teams.find(team => team.id === finalist);
  const after = complete.teams.find(team => team.id === finalist);
  assert.equal(after.formEvidence.series, before.formEvidence.series + 1);
  assert(after.formElo > before.formElo);
  assert.deepEqual(complete.teams[0], pending.teams[0]); // An invited team did not play this series.
  assert.throws(() => prepareEdition(pending, second, first), /desatualizada/);
  const edition = prepareEdition(complete, second, first);
  assert.equal(edition.teams.length, 16);
  assert.equal(edition.formCoverage, 'history-plus-stage1');
  const state = { ...newDraft(edition.id), model: 'vrs', card: Array.from({ length: 10 }, (_, i) => i) };
  const simulation = sampleRun(edition.teams, state, ['vrs', 'hltv', 'elo']);
  simulation.next();
  for (const histogram of Object.values(simulation.snapshot().histograms))
    assert.equal(histogram.reduce((sum, p) => sum + p, 0), 1);
});
