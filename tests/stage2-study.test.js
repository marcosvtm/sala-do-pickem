import assert from 'node:assert/strict';
import test from 'node:test';
import stage from '../dist/data/stage.json' with { type: 'json' };
import invited from '../dist/data/stage2-invites.json' with { type: 'json' };
import { newDraft } from '../dist/js/state.js';
import { modelAvailable, makeMatrix } from '../dist/js/models.js';
import { sampleRun } from '../dist/js/simulation.js';
import { validateStage2Study } from '../scripts/prepare-stage2-study.js';
import studyS2 from '../dist/data/study-s2.js';
import { createSearch } from '../dist/js/suggestion-search.js';
import { openDb } from '../scripts/local-db.js';
import { cardsApi } from '../server/api.js';
import { stageTwoCandidates } from '../server/stage2-field.js';
import calendar from '../dist/data/stage2-schedule.json' with { type: 'json' };

function example() {
  const guests = invited.teams.map(team => team.id);
  const promoted = stage.teams.slice(0, 8).map(team => team.logo.split('.')[0]);
  const schedule = guests.map((leftTeamKey, i) => ({
    leftTeamKey, rightTeamKey: promoted[i], timeZone: 'SGT', round: 'opening round m' + (i + 1),
    date: '28.11.2026', time: '12:00',
  }));
  const teamIds = [...promoted, ...guests];
  const matrix = teamIds.map((_, a) => teamIds.map((_, b) => (a === b ? 0.5 : a > b ? 0.57123456789 : 1 - 0.57123456789)));
  const study = { stage: 'sg26-s2-v1', version: 'test', cutoff: '2026-11-27T21:00:00Z',
    teamIds, probabilities: { 1: matrix, 3: structuredClone(matrix) } };
  return { study, schedule };
}

test('Stage 2 accepts a complete frozen study in its own order, preserving precision', () => {
  const { study, schedule } = example();
  assert.deepEqual(validateStage2Study(study, schedule), study);
  schedule.find(match => match.leftTeamKey === 'nemiga').leftTeamKey = 'nemiga_gaming';
  schedule.find(match => match.leftTeamKey === '1win').leftTeamKey = 'the_one';
  const officialIds = study.teamIds.map(id => id === '1win' ? 'the_one' : id);
  assert.deepEqual(validateStage2Study({ ...study, teamIds: officialIds }, schedule), study);
  const edited = structuredClone(study);
  edited.probabilities[3][9][0] = 0.15;
  assert.throws(() => validateStage2Study(edited, schedule), /Probabilidade/);
  assert.throws(() => validateStage2Study({ ...study, cutoff: '2026-11-28T03:00:01Z' }, schedule), /corte/);
  schedule[0].rightTeamKey = '';
  assert.throws(() => validateStage2Study(study, schedule), /confrontos/);
});

test('Stage 2 refuses a field outside its frozen study and never reuses Stage 1', () => {
  const settings = newDraft('sg26-s2-v1');
  const teams = stage.teams;
  assert.equal(modelAvailable(teams, 'study', settings), false);
  assert.equal(modelAvailable(teams, 'custom', settings), false);
  assert.throws(() => makeMatrix(teams, 'study', settings), /Modelo IA/);
  const simulation = sampleRun(teams, settings);
  simulation.next();
  assert.deepEqual(Object.keys(simulation.snapshot().histograms), ['neutral', 'vrs', 'hltv', 'elo']);
  settings.weights.study = 0;
  assert.equal(modelAvailable(teams, 'custom', settings), true);
  assert.ok(Number.isFinite(makeMatrix(teams, 'custom', settings)[3][1][3]));
  assert.equal(modelAvailable(teams, 'study', newDraft()), true);
});

test('the published S2 study is selected by team ID, including series and custom predictions', () => {
  const teams = [...studyS2.teamIds].reverse().map(id => ({ id }));
  const state = newDraft(studyS2.stage);
  state.model = 'study';
  state.weights = { neutral: 0, vrs: 0, hltv: 0, elo: 0, study: 100 };
  const matrix = makeMatrix(teams, 'study', state);
  for (const bo of [1, 3]) {
    for (const [a, left] of teams.entries()) {
      const row = studyS2.probabilities[bo][studyS2.teamIds.indexOf(left.id)];
      assert.deepEqual(matrix[bo][a], teams.map(right => row[studyS2.teamIds.indexOf(right.id)]));
    }
  }
  const fut = teams.findIndex(t => t.id === 'fut_esports'), fly = teams.findIndex(t => t.id === 'flyquest');
  assert.equal(matrix[1][fut][fly], 0.514386343254678);
  assert.equal(matrix[3][fut][fly], 0.5683149248245571);
  assert.deepEqual(makeMatrix(teams, 'custom', state), matrix);
  state.card = createSearch(teams, state).result().card;
  assert.equal(new Set(state.card).size, 10);
  const run = sampleRun(teams, state, ['study', 'custom']);
  for (let i = 0; i < 128; i++) run.next();
  const { histograms } = run.snapshot();
  assert.deepEqual(histograms.custom, histograms.study);
});

test('S2 saves stamp the active study and retries preserve the original snapshot across a catalog update', async () => {
  const db = openDb();
  const now = Date.parse(studyS2.cutoff);
  db.sqlite.function('unixepoch', () => Math.floor(now / 1000));
  const teams = studyS2.teamIds.map(id => stageTwoCandidates.find(team => team.id === id));
  const edition = { id: studyS2.stage, version: 'field', revision: 1, startsAt: '2026-11-28T04:00:00Z',
    opensNotBefore: now, cutoff: studyS2.cutoff, teams, games: calendar.games, modelStatus: { study: 'pending' } };
  const stage = studyS2.stage;
  const post = (path, data) => cardsApi(new Request('https://test.invalid/api/' + path + '?stage=' + stage,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }), db, now);
  try {
    db.sqlite.prepare('INSERT INTO stage_editions(stage,attempted,activated_at,edition) VALUES(?,?,?,?)')
      .run(stage, now, now, JSON.stringify(edition));
    const state = newDraft(stage);
    state.model = 'study';
    state.card = Array.from({ length: 10 }, (_, i) => i);
    state.weights = { neutral: 75, vrs: 0, hltv: 0, elo: 0, study: 25 };
    const body = { id: crypto.randomUUID(), nick: 'Teste', state };
    assert.equal((await post('cards', body)).status, 201);
    const read = () => db.sqlite.prepare('SELECT settings FROM cards WHERE id=?').get(body.id).settings;
    const original = read();
    assert.equal(JSON.parse(original).studyVersion, studyS2.version);
    edition.revision++;
    db.sqlite.prepare('UPDATE stage_editions SET edition=? WHERE stage=?').run(JSON.stringify(edition), stage);
    assert.equal((await post('cards', body)).status, 200);
    assert.equal(read(), original);
    const modelo = await post('models', { id: crypto.randomUUID(), nick: body.nick, settings: state });
    assert.equal(modelo.status, 200);
    const { id } = await modelo.json();
    const published = await cardsApi(new Request('https://test.invalid/api/models/' + id + '?stage=' + stage), db, now);
    const snapshot = await published.json();
    assert.equal(snapshot.studyVersion, studyS2.version);
    assert.deepEqual(snapshot.weights, state.weights);
  } finally { db.sqlite.close(); }
});
