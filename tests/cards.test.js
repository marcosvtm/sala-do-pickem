import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDb } from '../scripts/local-db.js';
import { cardsApi } from '../server/api.js';
import {
  CLOSE,
  START,
  parsePgl,
  liveResults,
  emptyLocks,
} from '../server/results.js';
import { defaults } from '../dist/js/state.js';
import { availableGames, ROUND_SIZES } from '../dist/js/swiss.js';
import { progress, pickStatus, fixtureBrier } from '../dist/js/progress.js';
import stage from '../dist/data/stage.json' with { type: 'json' };

const input = () => ({
  id: randomUUID(),
  nick: 'Pessoa A',
  state: defaults(stage.card),
});
const post = (body) =>
  new Request('https://example.org/api/cards', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
const get = (suffix = '') =>
  new Request('https://example.org/api/cards' + suffix);
test('immutable, named, idempotent cards; global visibility and no hypothetical results persisted', async () => {
  const db = openDb(),
    body = input();
  db.sqlite.function('unixepoch', () => CLOSE / 1000 - 1);
  body.state.locks[0] = 1;
  assert.equal(
    (await cardsApi(post({ ...body, nick: '  ' }), db, CLOSE - 10)).status,
    400
  );
  assert.equal((await cardsApi(post(body), db, CLOSE - 10)).status, 201);
  assert.equal((await cardsApi(post(body), db, CLOSE - 5)).status, 200);
  assert.equal(
    (
      await cardsApi(
        post({ ...body, id: randomUUID(), nick: 'PESSOA A' }),
        db,
        CLOSE - 5
      )
    ).status,
    409
  );
  const res = await (
    await cardsApi(get('?focus=' + body.id), db, CLOSE - 1)
  ).json();
  assert.equal(res.cards.length, 1);
  assert.equal(res.cards[0].nick, 'Pessoa A');
  assert.equal(res.cards[0].settings.locks[0], -1);
  assert.equal(
    (
      await cardsApi(
        post({ ...body, id: randomUUID(), nick: 'Outra pessoa' }),
        db,
        CLOSE
      )
    ).status,
    409
  );
  assert.equal((await cardsApi(post(body), db, CLOSE + 1)).status, 200);
  db.sqlite.function('unixepoch', () => CLOSE / 1000);
  assert.notEqual(
    (
      await cardsApi(
        post({ ...body, id: randomUUID(), nick: 'Chegou na virada' }),
        db,
        CLOSE - 1
      )
    ).status,
    201
  );
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM cards').get().n, 1);
  db.sqlite.close();
});
function fixture(lockCount) {
  const locks = emptyLocks(),
    rows = [];
  for (let r = 0; r < 5; r++) {
    const draw = availableGames(locks)[r] || [];
    for (let j = 0; j < ROUND_SIZES[r]; j++) {
      const g = draw[j],
        done = Boolean(g && g.match < lockCount);
      const key = (i) => stage.teams[i].logo.split('.')[0];
      const a = g ? key(g.a) : '',
        b = g ? key(g.b) : '';
      rows.push(
        '{leftTeam:"A",leftTeamKey:"' +
          a +
          '",rightTeamKey:"' +
          b +
          '",leftScore:' +
          (done ? Math.ceil(g.bo / 2) : 0) +
          ',rightScore:0,format:"BO' +
          (g?.bo || 1) +
          '",date:"24.11.2026",round:"' +
          (r === 0 ? 'opening round m1' : 'round ' + (r + 1)) +
          '",status:"' +
          (done ? 'end' : 'upcoming') +
          '",maps:[]}'
      );
      if (done) locks[g.match] = 0;
    }
  }
  return rows.join(',');
}
test('PGL stages map by opponent, retain pending games and settle every pick at completion', () => {
  assert.equal(parsePgl(fixture(8)).filter((x) => x >= 0).length, 8);
  const p = progress(parsePgl(fixture(33)));
  assert.equal(p.finished.length, 33);
  assert.ok(stage.card.every((t, i) => pickStatus(i, p.teams[t]) !== 'open'));
  assert.equal(pickStatus(2, { wins: 3, losses: 0 }), 'miss');
  assert.equal(pickStatus(9, { wins: 1, losses: 0 }), 'miss');
  assert.equal(pickStatus(0, { wins: 2, losses: 0 }), 'open');
  assert.throws(() => parsePgl('wrong layout'));
  assert.equal(
    fixtureBrier(
      {
        1: [
          [0.5, 0.5],
          [0.5, 0.5],
        ],
      },
      [{ bo: 1, a: 0, b: 1, winner: 0 }]
    ),
    0.25
  );
});
test('feed retains verified results during a source outage and marks them stale', async () => {
  const db = openDb();
  const fetcher = async (url) =>
    new Response(
      String(url).endsWith('.js')
        ? fixture(8)
        : '<script src="/_next/static/chunks/app/cs2/pgl-major-singapore-2026/page-123.js"></script>'
    );
  const first = await liveResults(db, START + 2000, fetcher);
  assert.equal(first.locks.filter((x) => x >= 0).length, 8);
  const later = await liveResults(db, START + 64000, async () => {
    throw Error('offline');
  });
  assert.deepEqual(later.locks, first.locks);
  assert.equal(later.stale, true);
  db.sqlite.close();
});
