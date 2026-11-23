import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cardsApi } from '../server/api.js';
import { matchProfile, monthProfiles } from '../server/broxas.js';
import { openDb } from '../scripts/local-db.js';
import { START } from '../server/results.js';
import { defaults } from '../dist/js/state.js';
import { progress } from '../dist/js/progress.js';
import stage from '../dist/data/stage.json' with { type: 'json' };

const months = [
  {
    year: 2026,
    month: 11,
    monthStats: {
      players: [
        { name: 'mr.K', ratingColumn: 'D', notaTotal: 24, jogos: 66, participates: true },
        { name: 'Vitox', ratingColumn: 'E', notaTotal: 0, jogos: 12, participates: false },
        { name: 'LighT.', ratingColumn: 'F', notaTotal: 27, jogos: 60, participates: true },
        { name: 'Empate', ratingColumn: 'G', notaTotal: 24, jogos: 40, participates: true },
        { name: 'Reserva', ratingColumn: 'H', notaTotal: 30, jogos: 4, participates: false },
      ],
    },
    matches: [
      {
        gameFinishedAt: '2026-11-14T09:00Z',
        statsByColumn: { D: { gcLevel: 19 } },
      },
      {
        gameFinishedAt: '2026-11-01T09:00Z',
        statsByColumn: { D: { gcLevel: 18 } },
      },
    ],
  },
];
test('monthly profiles match unique nicks and use the latest observed level independently of the monthly score', () => {
  const november = monthProfiles(months, 2026, 11);
  assert.deepEqual(matchProfile(november, 'mrk'), {
    name: 'mr.K',
    level: 19,
    choppPlace: 2,
    score: 24,
    games: 66,
  });
  assert.equal(matchProfile(november, 'Vitox').score, 0);
  assert.equal(matchProfile(november, 'Vitox').choppPlace, null);
  assert.equal(matchProfile(november, 'Empate').choppPlace, 3);
  assert.equal(matchProfile(november, 'mr'), null);
  assert.equal(matchProfile([...november, { name: 'M-rK' }], 'mrk'), null);
  const next = matchProfile(monthProfiles(months, 2026, 12), 'MRK');
  assert.equal(next.level, 19);
  assert.equal(next.score, null);
  assert.equal(next.choppPlace, null);
});

test('leaderboard ranks confirmed picks, shares places on ties and exposes group stats only through a saved card', async () => {
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
        Response.json(months)
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
    const profile = await (
      await query('/api/ranking/' + ids.mrk + '/perfil')
    ).json();
    assert.equal(profile.member.name, 'mr.K');
    assert.equal(profile.member.level, 19);
    assert.equal(
      (await (await query('/api/ranking/' + ids.Quarto + '/perfil')).json())
        .member,
      null
    );
    assert.equal(
      (await query('/api/ranking/' + randomUUID() + '/perfil')).status,
      404
    );
    db.sqlite.prepare('UPDATE cards SET removed_at=1 WHERE id=?').run(ids.mrk);
    assert.equal(
      (await query('/api/ranking/' + ids.mrk + '/perfil')).status,
      404
    );
    assert.deepEqual(
      (await (await query('/api/ranking')).json()).rows.map((r) => r.place),
      [1, 2, 3]
    );
  } finally {
    db.sqlite.close();
  }
});
