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
test('legacy card creation is named and idempotent, with public picks and no hypothetical results', async () => {
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
test('card owners can revise and remove cards before closing, including concurrent and retried writes', async () => {
  const db = openDb(),
    key = randomUUID(),
    body = input();
  let dbTime = CLOSE / 1000 - 5;
  db.sqlite.function('unixepoch', () => dbTime);
  const write = (method, payload, secret = key, now = CLOSE - 1) =>
    cardsApi(
      new Request(
        'https://example.org/api/cards' +
          (method === 'POST' ? '' : '/' + body.id),
        {
          method,
          headers: { 'Content-Type': 'application/json', 'X-Card-Key': secret },
          body: JSON.stringify(payload),
        }
      ),
      db,
      now
    );
  const update = {
    ...body,
    nick: 'Vitox',
    revision: 1,
    state: {
      ...body.state,
      model: 'study',
      card: [...body.state.card].reverse(),
    },
  };
  try {
    assert.equal((await write('POST', body)).status, 201);
    const legacy = input();
    legacy.nick = 'Registro anterior';
    assert.equal((await cardsApi(post(legacy), db, CLOSE - 1)).status, 201);
    const publicView = await (await cardsApi(get(''), db, CLOSE - 1)).json();
    assert.equal(publicView.cards.length, 2);
    assert.equal(JSON.stringify(publicView).includes(key), false);
    assert.equal('edit_hash' in publicView.cards[0], false);
    for (const method of ['PUT', 'DELETE'])
      assert.equal((await write(method, update, body.id)).status, 403);
    assert.equal(
      (await write('PUT', { ...update, nick: legacy.nick })).status,
      409
    );
    assert.equal((await write('PUT', update)).status, 200);
    assert.equal((await write('PUT', update)).status, 200);
    assert.equal(
      (await write('PUT', { ...update, nick: 'Desatualizado' })).status,
      409
    );
    assert.equal((await write('DELETE', { revision: 1 })).status, 409);
    const read = await (await cardsApi(get('/' + body.id), db)).json();
    assert.equal(read.revision, 2);
    assert.equal(read.nick, 'Vitox');
    assert.deepEqual(read.settings.card, update.state.card);
    assert.equal(read.settings.model, 'study');
    for (const method of ['PUT', 'DELETE']) {
      const payload = { ...update, revision: 2 };
      assert.equal((await write(method, payload, key, CLOSE)).status, 409);
      dbTime = CLOSE / 1000;
      assert.equal((await write(method, payload)).status, 409);
      dbTime -= 5;
    }
    assert.equal((await write('DELETE', { revision: 2 })).status, 200);
    assert.equal((await write('DELETE', { revision: 2 })).status, 200);
    assert.equal((await write('POST', body)).status, 409);
    assert.equal((await cardsApi(get('/' + body.id), db)).status, 404);
    const shared = new Request('https://example.org/api/models/' + body.id);
    assert.equal((await cardsApi(shared, db)).status, 404);
    const saved = await (await cardsApi(get(''), db, CLOSE - 1)).json();
    assert.deepEqual(
      saved.cards.map((c) => c.id),
      [legacy.id]
    );
    assert.equal(
      (await cardsApi(post({ ...input(), nick: 'Vitox' }), db, CLOSE - 1))
        .status,
      201
    );
  } finally {
    db.sqlite.close();
  }
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
      rows.push({
        leftTeamKey: a, rightTeamKey: b,
        leftScore: done ? Math.ceil(g.bo / 2) : 0, rightScore: 0,
        format: 'BO' + (g?.bo || 1), date: '24.11.2026', time: '12:00',
        timeZone: 'SGT', round: r === 0 ? 'opening round m1' : 'round ' + (r + 1),
        status: done ? 'end' : 'upcoming', maps: [],
      });
      if (done) locks[g.match] = 0;
    }
  }
  return rows;
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
  const fetcher = async (url) => {
    assert.equal(url, 'https://news.pglesports.com/api/groupStageEndpoint?stage=1');
    return Response.json(fixture(8));
  };
  const first = await liveResults(db, START + 2000, fetcher);
  assert.equal(first.locks.filter((x) => x >= 0).length, 8);
  const later = await liveResults(db, START + 64000, async () => {
    throw Error('offline');
  });
  assert.deepEqual(later.locks, first.locks);
  assert.equal(later.stale, true);
  db.sqlite.close();
});
