import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { stageTwoRatings, replayForm, valvePoints } from '../server/stage2-ratings.js';
import checkpoint from '../research/stage2-form-checkpoint.json' with { type: 'json' };
import stageOne from '../dist/data/stage.json' with { type: 'json' };
import { parseSchedule } from '../server/agenda.js';
import { rehearsal } from './fixtures/stage2.js';

const cutoff = Date.parse('2026-11-27T14:00:00Z');
const revision = 'e'.repeat(40);

function sample() {
  const { first, edition } = rehearsal();
  const games = parseSchedule(first).map(g => ({ at: g.at / 1000,
    a: stageOne.teams[g.a].logo.split('.')[0], b: stageOne.teams[g.b].logo.split('.')[0],
    bo: g.bo, winA: Number(g.series[0] > g.series[1]) }));
  return { games, field: edition.teams };
}

function standings(ids, date) {
  return '### Standings as of ' + date.replaceAll('-', '_') + '<br />\n' + ids.map((id, i) =>
    '| ' + (i + 1) + ' | ' + (1800 - i) + ' | Nome de exibição | ' + checkpoint.teams[id].roster.join(', ') + ' |')
    .join('\n');
}

test('the Worker reproduces the frozen Python replay and 120-day evidence for all 24 candidates', () => {
  const { games } = sample();
  const scores = replayForm(games, cutoff / 1000);
  const rows = Object.keys(scores).sort().map(id => [id, scores[id]]);
  assert.equal(rows.length, 24);
  // Produced by scripts/prepare-stage2-edition.js ratePool, from the full 14,148-series history.
  assert.equal(createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
    'dcb16522d0f201ceff831ae7d6fa43e5ca72a781d770b448bf55bd6473f4732d');
  assert.throws(() => replayForm([...games, { ...games[0], at: cutoff / 1000 + 1 }], cutoff / 1000));
});

test('the latest official VRS published by cutoff uses the roster core and a pinned source', async () => {
  const { games, field } = sample();
  const ids = field.map(t => t.id);
  const captured = [];
  const fake = async url => {
    captured.push(url);
    if (url.includes('/commits?')) return Response.json([{ sha: revision, commit: { committer: { date: '2026-11-26T20:00:00Z' } } }]);
    if (url.includes('/contents/')) return Response.json(['2026_11_02', '2026_11_26', '2026_11_28'].map(date =>
      ({ name: 'standings_global_' + date + '.md' })));
    return new Response(standings(ids, '2026-11-26'));
  };
  const edition = await stageTwoRatings(field, games, cutoff, fake);
  assert.equal(edition.modelStatus.vrs, 'ready');
  assert.equal(edition.teams.at(-1).vrs, 1785);
  assert.equal(edition.modelDates.vrs, '2026-11-26');
  assert(edition.sources.vrs.includes('/' + revision + '/live/2026/standings_global_2026_11_26.md'));
  assert(captured[0].includes(encodeURIComponent(new Date(cutoff).toISOString())));
  assert.equal(edition.modelStatus.study, 'pending');
  assert.equal(edition.modelStatus.elo, 'ready');
  assert.equal(edition.formCoverage, 'history-plus-stage1');
  assert.equal(edition.modelStatus.hltv, 'ready');
  const ambiguous = standings(ids, '2026-11-26') + '\n| 55 | 1000 | Mesmo elenco | ' + checkpoint.teams[ids[0]].roster.join(', ') + ' |';
  assert.equal(valvePoints(ambiguous, ids, '2026-11-26'), null);
});

test('a missing update locks only its model and the pending sources can be retried', async () => {
  const { games, field } = sample();
  const unavailable = async () => new Response('', { status: 503 });
  const initial = await stageTwoRatings(field, games, cutoff, unavailable);
  assert.equal(initial.modelStatus.vrs, 'pending');
  assert.equal(initial.teams[0].vrs, null);
  assert.equal(initial.modelStatus.elo, 'ready');
  assert.equal(initial.modelStatus.hltv, 'ready');
  const incomplete = await stageTwoRatings(field, games.slice(1), cutoff, unavailable);
  assert.equal(incomplete.modelStatus.elo, 'pending');
  assert.equal(incomplete.teams[0].formElo, null);
  assert.equal(incomplete.teams[0].formEvidence, null);
  assert.equal(incomplete.modelStatus.custom, 'ready');
  assert.equal(incomplete.modelStatus.neutral, 'ready');
  const obsolete = await stageTwoRatings(field, games, Date.parse('2026-12-01T12:00:00Z'), unavailable);
  assert.equal(obsolete.modelStatus.hltv, 'pending');
  assert.equal(obsolete.teams[0].hltvRank, null);
});
