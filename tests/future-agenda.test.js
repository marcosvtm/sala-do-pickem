import assert from 'node:assert/strict';
import test from 'node:test';
import { cardsApi } from '../server/api.js';
import { openDb } from '../scripts/local-db.js';
import { futureAgendaConfig, parseFutureAgenda } from '../server/future-agenda.js';
import { majorPhases } from '../dist/js/major-phases.js';
import { matchLink } from '../dist/js/schedule.js';

const [swiss, playoffs] = majorPhases.slice(2);

test('Stage 3 keeps 33 BO3s; playoffs use quarters, semis, third place and a BO5 final with verified links', () => {
  for (const phase of [swiss, playoffs]) {
    const { rows } = futureAgendaConfig(phase.id);
    const { teams, games } = parseFutureAgenda(phase.id, rows);
    assert.deepEqual(teams, []);
    assert(games.every(g => g.a === null && g.b === null && g.status === 'upcoming'));
    assert.equal(new Set(games.map(g => matchLink(g))).size, rows.length);
    if (phase === swiss) assert.equal(games.filter(g => g.bo === 3).length, 33);
    else {
      assert.deepEqual(games.map(g => g.round), [1,1,1,1,2,2,3,4]);
      assert.equal(games.at(-1).bo, 5);
      assert.equal(games.at(-2).roundLabel, 'Disputa de 3º lugar');
      assert.match(matchLink(games.at(-2)), /third|3rd/);
      assert.match(matchLink(games.at(-1)), /grand-final/);
      assert.deepEqual(parseFutureAgenda(phase.id, [...rows].reverse()).games, games);
      assert.throws(() => parseFutureAgenda(phase.id, [...rows.slice(0,-1),rows[0]]));
    }
  }
});

test('public future agendas track confirmed live opponents with stable IDs, keep last data offline and never open picks', async () => {
  const db = openDb();
  const phase = playoffs;
  const config = futureAgendaConfig(phase.id);
  const source = structuredClone(config.rows);
  Object.assign(source[0], { leftTeamKey:'vitality', leftTeam:'Vitality', leftStrict:'VIT',
    rightTeamKey:'furia', rightTeam:'FURIA', rightStrict:'FUR',
    status:'live', leftScore:0, rightScore:0, maps:[{map:'de_nuke',leftScore:5,rightScore:3}] });
  const now = Date.parse('2026-12-10T17:15:00+08:00');
  let offline = false, polls = 0;
  const fetcher = async url => {
    if (url === config.source) { polls++; if (!offline) return Response.json(source); }
    return new Response(null, {status:503});
  };
  const get = (path, when) => cardsApi(new Request('https://local.test/api/' + path), db, when, fetcher);
  const route = 'results?stage=' + phase.id;
  try {
    const first = await (await get(route, now)).json();
    assert.equal(first.schedule[0].status,'live');
    assert.deepEqual(first.schedule[0].map.score,[5,3]);
    assert.deepEqual(first.teams.map(t => t.logo),['vitality.svg','furia.webp']);
    assert.equal((await (await get(route, now + 1000)).json()).scheduleChecked, now);
    assert.equal(polls,1);
    const catalog = await (await get('stages',now + 1000)).json();
    const status = catalog.stages.find(s => s.id === phase.id);
    assert.equal(status.displayStatus,'live');
    assert.equal(status.picksOpen,false);
    assert.equal(status.rosterConfirmed,false);
    offline = true;
    const next = await (await get(route,now + 190000)).json();
    assert.equal(next.scheduleChecked,now);
    assert.equal(next.stale,true);
    assert.deepEqual(next.schedule[0].map.score,[5,3]);
    assert.equal((await get('cards?stage=' + phase.id,now)).status,409);
  } finally { db.sqlite.close(); }
});
