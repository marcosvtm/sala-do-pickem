import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cardsApi } from '../server/api.js';
import { overallStandings } from '../server/standings.js';
import { openDb } from '../scripts/local-db.js';
import { START } from '../server/results.js';
import { defaults } from '../dist/js/state.js';
import { progress } from '../dist/js/progress.js';
import stage from '../dist/data/stage.json' with { type: 'json' };

test('overall sums by participant identity, distinguishes zero from absence and keeps unlinked names separate', () => {
  const cards = [
    { id: 'first', nick: 'A', stage: 's1', hits: 2 },
    { id: 'second', participantId: 'first', nick: 'New nick', stage: 's2', hits: 3 },
    { id: 'third', nick: 'A', stage: 's2', hits: 0 },
  ];
  const [leader, other] = overallStandings(cards);
  assert.equal(leader.hits, 5);
  assert.equal(leader.phases.s2.id, 'second');
  assert.equal(other.hits, 0);
  assert.equal(other.phases.s1, undefined);
});

test('leaderboard ranks confirmed picks, shares places on ties across the overall and phase views', async () => {
  const db = openDb(),
    locks = Array(33).fill(0),
    now = START + 3600000;
  try {
    db.sqlite
      .prepare(
        'INSERT INTO stage_results(stage,locks,checked,attempted) VALUES(?,?,?,?)'
      )
      .run(stage.id, JSON.stringify(locks), now, now);
    const teams = progress(locks).teams.map((t, i) => ({ ...t, i }));
    const perfect = [
      ...teams.filter((t) => t.wins === 3 && t.losses === 0),
      ...teams.filter((t) => t.wins === 3 && t.losses > 0),
      ...teams.filter((t) => t.losses === 3 && t.wins === 0),
    ].map((t) => t.i);
    const outside = teams.map((t) => t.i).filter((i) => !perfect.includes(i));
    const ids = {};
    for (const [nick, misses] of [
      ['mrk', 0],
      ['Empate', 0],
      ['Terceiro', 1],
      ['Quarto', 2],
    ]) {
      const card = [...perfect];
      card.splice(0, misses, ...outside.slice(0, misses));
      ids[nick] = randomUUID();
      db.sqlite
        .prepare(
          'INSERT INTO cards(id,stage,nick,nick_key,submitted,settings) VALUES(?,?,?,?,?,?)'
        )
        .run(
          ids[nick],
          stage.id,
          nick,
          nick.toLowerCase(),
          1,
          JSON.stringify(defaults(card))
        );
    }
    const query = async (path) =>
      cardsApi(new Request('https://example.org' + path), db, now, async () =>
        Response.json({})
      );
    const board = await (await query('/api/ranking')).json();
    assert.deepEqual(
      board.rows.map((r) => [r.place, r.hits]),
      [
        [1, 10],
        [1, 10],
        [3, 9],
        [4, 8],
      ]
    );
    const overall = await (await query('/api/ranking/geral')).json();
    assert.deepEqual(overall.rows.map(r => r.place), [1, 1, 3, 4]);
    assert.equal(overall.rows[0].phases[stage.id].hits, 10);
    assert.equal(overall.rows[0].phases[stage.id].model, defaults([]).model);
    assert.equal((await query('/api/ranking/geral?page=invalid')).status, 400);
    const byStage = await (await query('/api/cards?focus=' + ids.Terceiro)).json();
    assert.equal(byStage.cards.find(c => c.id === ids.Terceiro).place, 3);
    db.sqlite.prepare('UPDATE cards SET removed_at=1 WHERE id=?').run(ids.mrk);
    assert.deepEqual(
      (await (await query('/api/ranking')).json()).rows.map((r) => r.place),
      [1, 2, 3]
    );
    const insert = db.sqlite.prepare(
      'INSERT INTO cards(id,stage,nick,nick_key,submitted,settings) VALUES(?,?,?,?,?,?)'
    );
    for (let i = 0; i < 30; i++) {
      const nick = 'Participante ' + i;
      insert.run(randomUUID(), stage.id, nick, nick, i, JSON.stringify(defaults(perfect)));
    }
    const focused = await (await query('/api/cards?focus=' + ids.Quarto)).json();
    assert.equal(focused.page, 1);
    assert.equal(focused.cards.find(c => c.id === ids.Quarto).place, 33);
    const secondPage = await (await query('/api/ranking/geral?page=1')).json();
    assert.deepEqual(secondPage.rows.map(r => r.place), [1, 32, 33]);
  } finally {
    db.sqlite.close();
  }
});
